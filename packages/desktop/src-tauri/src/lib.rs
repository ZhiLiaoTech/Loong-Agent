mod commands;
mod config;
mod watchdog;

use std::sync::Arc;

use commands::SharedWatchdog;
use watchdog::create_watchdog;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let watchdog: SharedWatchdog = Arc::new(create_watchdog());

    tauri::Builder::default()
        .manage(watchdog)
        .invoke_handler(tauri::generate_handler![
            commands::get_gateway_health,
            commands::start_gateway,
            commands::stop_gateway,
            commands::restart_gateway,
            commands::force_restart_gateway,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Loong desktop");
}
