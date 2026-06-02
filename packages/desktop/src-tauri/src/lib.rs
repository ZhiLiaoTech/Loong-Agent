mod app_preferences;
mod commands;
mod config;
mod tray;
mod watchdog;

use std::sync::Arc;

use commands::gateway::SharedWatchdog;
use tauri::{Manager, RunEvent};
use watchdog::create_watchdog;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::gateway::get_gateway_health,
            commands::gateway::start_gateway,
            commands::gateway::stop_gateway,
            commands::gateway::restart_gateway,
            commands::gateway::force_restart_gateway,
        ])
        .setup(|app| tray::setup(app).map_err(Into::into))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if app_preferences::close_to_tray_enabled() {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Loong desktop");

    let runtime_root = app
        .path()
        .resource_dir()
        .ok()
        .map(|resource_dir| resource_dir.join("runtime"))
        .filter(|runtime_dir| runtime_dir.is_dir())
        .or_else(|| {
            std::env::current_exe()
                .ok()
                .and_then(|exe| exe.parent().map(|parent| parent.join("runtime")))
                .filter(|runtime_dir| runtime_dir.is_dir())
        });

    let watchdog: SharedWatchdog = Arc::new(create_watchdog(runtime_root));
    let startup_watchdog = Arc::clone(&watchdog);
    let _ = app.manage(watchdog);

    std::thread::spawn(move || {
        let _ = startup_watchdog.start();
    });

    app.run(|app_handle, event| match event {
        RunEvent::ExitRequested { api, code, .. } => {
            if code.is_none() && app_preferences::close_to_tray_enabled() {
                api.prevent_exit();
            }
        }
        RunEvent::Exit => {
            if let Some(watchdog) = app_handle.try_state::<SharedWatchdog>() {
                let _ = watchdog.stop();
            }
        }
        _ => {}
    });
}
