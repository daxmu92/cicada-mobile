use tauri::Manager;
mod transactions;
mod credentials;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default();
  #[cfg(desktop)]
  let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
    if let Some(window) = app.get_webview_window("main") {
      let _ = window.unminimize();
      let _ = window.show();
      let _ = window.set_focus();
    }
  }));
  builder
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
      let handle = app.handle().clone();
      tauri::async_runtime::spawn(async move {
        loop {
          tokio::time::sleep(std::time::Duration::from_secs(10)).await;
          handle.state::<transactions::Transactions>().abort_idle(std::time::Duration::from_secs(60)).await;
        }
      });
      #[cfg(desktop)]
      if let Some(window) = app.get_webview_window("main") {
        if let (Ok(Some(monitor)), Ok(size)) = (window.current_monitor(), window.inner_size()) {
          let screen = monitor.size();
          let bounded = tauri::PhysicalSize::new(size.width.min(screen.width * 9 / 10), size.height.min(screen.height * 9 / 10));
          if bounded != size { let _ = window.set_size(bounded); let _ = window.center(); }
        }
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
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      #[cfg(desktop)]
      if let tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } = event {
        if label == "main" { app.exit(0); }
      }
    });
}
