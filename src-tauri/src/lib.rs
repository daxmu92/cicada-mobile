use tauri::Manager;
mod transactions;
mod credentials;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
        .manage(transactions::Transactions::default())
        .on_page_load(|window, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                let app = window.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    app.state::<transactions::Transactions>().abort_all().await;
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            transactions::cicada_begin_transaction,
            transactions::cicada_end_transaction,
            transactions::cicada_transaction_query,
            credentials::cicada_load_credentials,
            credentials::cicada_save_credentials,
            credentials::cicada_clear_credentials,
        ])
    .plugin(tauri_plugin_sql::Builder::default().build())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_store::Builder::default().build())
    .setup(|app| {
      #[cfg(desktop)]
      if let Some(window) = app.get_webview_window("main") {
        window.set_title(&format!("{} {}", app.package_info().name, app.package_info().version))?;
      }
      #[cfg(desktop)]
      {
        app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
        app.handle().plugin(tauri_plugin_process::init())?;
      }
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
