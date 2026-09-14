mod simconnect;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Trazabilidad del binario: versión + commit deben coincidir con el log
  // del frontend ("[Announs] Frontend v..."). Si difieren, uno de los dos
  // está desactualizado y hay que recompilar.
  println!(
    "[Announs] Backend  v{} (commit {})",
    env!("CARGO_PKG_VERSION"),
    option_env!("GIT_COMMIT").unwrap_or("unknown")
  );
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      simconnect::simconnect_connect,
      simconnect::simconnect_disconnect,
      simconnect::simconnect_subscribe,
      simconnect::simconnect_poll,
      simconnect::simconnect_emit_telemetry
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
