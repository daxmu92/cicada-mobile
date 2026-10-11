use keyring::{Entry, Error};
use std::sync::Mutex;
static LOCK: Mutex<()> = Mutex::new(());
fn entry() -> Result<Entry, String> {
    Entry::new("com.daxmu.cicada", "webdav").map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn cicada_load_credentials() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let _lock = LOCK.lock().map_err(|e| e.to_string())?;
        match entry()?.get_password() { Ok(secret) => Ok(Some(secret)), Err(Error::NoEntry) => Ok(None), Err(e) => Err(e.to_string()) }
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn cicada_save_credentials(secret: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = LOCK.lock().map_err(|e| e.to_string())?;
        entry()?.set_password(&secret).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn cicada_clear_credentials() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let _lock = LOCK.lock().map_err(|e| e.to_string())?;
        match entry()?.delete_credential() { Ok(()) | Err(Error::NoEntry) => Ok(()), Err(e) => Err(e.to_string()) }
    }).await.map_err(|e| e.to_string())?
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    #[test]
    fn windows_credential_roundtrip_in_isolated_entry() {
        let user = format!("test-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
        let entry = keyring::Entry::new("com.daxmu.cicada.tests",&user).unwrap();
        entry.set_password("isolated-test-secret").unwrap();
        let loaded = entry.get_password();
        entry.delete_credential().unwrap();
        assert_eq!(loaded.unwrap(),"isolated-test-secret");
        assert!(matches!(entry.get_password(),Err(keyring::Error::NoEntry)));
    }
}
