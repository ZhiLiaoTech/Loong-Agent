use std::sync::Arc;

use crate::watchdog::{GatewayHealth, GatewayWatchdog};

pub type SharedWatchdog = Arc<GatewayWatchdog>;

#[tauri::command]
pub async fn get_gateway_health(watchdog: tauri::State<'_, SharedWatchdog>) -> Result<GatewayHealth, String> {
    Ok(watchdog.health())
}

#[tauri::command]
pub async fn start_gateway(watchdog: tauri::State<'_, SharedWatchdog>) -> Result<GatewayHealth, String> {
    watchdog.start()
}

#[tauri::command]
pub async fn stop_gateway(watchdog: tauri::State<'_, SharedWatchdog>) -> Result<GatewayHealth, String> {
    watchdog.stop()
}

#[tauri::command]
pub async fn restart_gateway(watchdog: tauri::State<'_, SharedWatchdog>) -> Result<GatewayHealth, String> {
    watchdog.restart()
}

#[tauri::command]
pub async fn force_restart_gateway(
    watchdog: tauri::State<'_, SharedWatchdog>,
) -> Result<GatewayHealth, String> {
    watchdog.stop()?;
    watchdog.start()
}
