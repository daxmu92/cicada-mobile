use serde_json::{json, Map, Value};
use sqlx::{Column, Row, Sqlite, Transaction, TypeInfo, ValueRef};
use std::{collections::HashMap, sync::atomic::{AtomicU64, Ordering}};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct Transactions(Mutex<HashMap<String, Transaction<'static, Sqlite>>>);
impl Transactions {
    pub async fn abort_all(&self) { self.0.lock().await.clear(); }
}
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[tauri::command]
pub async fn cicada_begin_transaction(instances: State<'_, DbInstances>, txs: State<'_, Transactions>, database_url: Option<String>) -> Result<String, String> {
    let url = database_url.as_deref().unwrap_or("sqlite:cicada.db");
    if url != "sqlite:cicada.db" && url != "sqlite:cicada-demo.db" { return Err("Unsupported ledger".into()); }
    let pool = {
        let instances = instances.0.read().await;
        match instances.get(url) {
            Some(DbPool::Sqlite(pool)) => pool.clone(),
            _ => return Err("Database not loaded".into()),
        }
    };
    let transaction = pool.begin().await.map_err(|e| e.to_string())?;
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed).to_string();
    txs.0.lock().await.insert(id.clone(), transaction);
    Ok(id)
}

#[tauri::command]
pub async fn cicada_end_transaction(txs: State<'_, Transactions>, transaction_id: String, commit: bool) -> Result<(), String> {
    let transaction = txs.0.lock().await.remove(&transaction_id).ok_or("Transaction not found")?;
    if commit { transaction.commit().await } else { transaction.rollback().await }.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cicada_transaction_query(txs: State<'_, Transactions>, transaction_id: String, sql: String, params: Vec<Value>, select: bool) -> Result<Value, String> {
    let mut transactions = txs.0.lock().await;
    let transaction = transactions.get_mut(&transaction_id).ok_or("Transaction not found")?;
    execute_query(transaction, &sql, params, select).await
}

async fn execute_query(transaction: &mut Transaction<'static, Sqlite>, sql: &str, params: Vec<Value>, select: bool) -> Result<Value, String> {
    let mut query = sqlx::query(sql);
    for value in params {
        query = match value {
            Value::Null => query.bind(Option::<String>::None),
            Value::String(s) => query.bind(s),
            Value::Number(n) => if let Some(i) = n.as_i64() { query.bind(i) } else { query.bind(n.as_f64().ok_or("Invalid SQL number")?) },
            _ => return Err("Unsupported SQL parameter".into()),
        };
    }
    if !select {
        let result = query.execute(&mut **transaction).await.map_err(|e| e.to_string())?;
        return Ok(json!({"lastInsertRowId":result.last_insert_rowid(),"changes":result.rows_affected()}));
    }
    let rows = query.fetch_all(&mut **transaction).await.map_err(|e| e.to_string())?;
    let mut output = Vec::new();
    for row in rows {
        let mut object = Map::new();
        for (i, column) in row.columns().iter().enumerate() {
            let raw = row.try_get_raw(i).map_err(|e| e.to_string())?;
            let value = if raw.is_null() { Value::Null } else {
                match raw.type_info().name() {
                    "TEXT" => json!(row.try_get::<String, _>(i).map_err(|e| e.to_string())?),
                    "INTEGER" | "NUMERIC" => json!(row.try_get::<i64, _>(i).map_err(|e| e.to_string())?),
                    "REAL" => json!(row.try_get::<f64, _>(i).map_err(|e| e.to_string())?),
                    "BLOB" => json!(row.try_get::<Vec<u8>, _>(i).map_err(|e| e.to_string())?),
                    kind => return Err(format!("Unsupported SQL type: {kind}")),
                }
            };
            object.insert(column.name().to_string(), value);
        }
        output.push(Value::Object(object));
    }
    Ok(Value::Array(output))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_query_roundtrip_commit_and_rollback() {
        tauri::async_runtime::block_on(async {
            let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
            sqlx::query("CREATE TABLE ledger(id INTEGER PRIMARY KEY, name TEXT UNIQUE, amount REAL, note TEXT)").execute(&pool).await.unwrap();
            let mut transaction = pool.begin().await.unwrap();
            let written = execute_query(&mut transaction, "INSERT INTO ledger(name,amount,note) VALUES($1,$2,$3)", vec![json!("中文"),json!(1000.15),Value::Null], false).await.unwrap();
            assert_eq!(written["changes"],1);
            let rows = execute_query(&mut transaction,"SELECT id,name,amount,note FROM ledger",vec![],true).await.unwrap();
            assert_eq!(rows[0]["name"],"中文"); assert_eq!(rows[0]["amount"],1000.15); assert!(rows[0]["note"].is_null());
            transaction.commit().await.unwrap();
            let mut transaction = pool.begin().await.unwrap();
            execute_query(&mut transaction,"DELETE FROM ledger",vec![],false).await.unwrap();
            execute_query(&mut transaction,"INSERT INTO ledger(name,amount) VALUES($1,$2)",vec![json!("replacement"),json!(9)],false).await.unwrap();
            assert!(execute_query(&mut transaction,"INSERT INTO ledger(name) VALUES($1)",vec![json!("replacement")],false).await.is_err());
            transaction.rollback().await.unwrap();
            let row: (String,f64) = sqlx::query_as("SELECT name,amount FROM ledger").fetch_one(&pool).await.unwrap();
            assert_eq!(row,("中文".to_string(),1000.15));
        });
    }
}
