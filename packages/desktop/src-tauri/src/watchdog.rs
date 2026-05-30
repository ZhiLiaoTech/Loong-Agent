use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;

use crate::config::{default_gateway_port, resolve_cli_entry, resolve_loong_data_root};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GatewayStatus {
    Stopped,
    Starting,
    Running,
    Offline,
    Degraded,
}

#[derive(Debug, Clone, Serialize)]
pub struct GatewayHealth {
    pub status: GatewayStatus,
    pub port: u16,
    pub message: Option<String>,
    pub pid: Option<u32>,
}

pub struct GatewayWatchdog {
    port: u16,
    child: Mutex<Option<Child>>,
}

impl GatewayWatchdog {
    pub fn new(port: u16) -> Self {
        Self {
            port,
            child: Mutex::new(None),
        }
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn health(&self) -> GatewayHealth {
        let pid = self
            .child
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|child| child.id()));

        match probe_http_health(self.port) {
            Ok(message) => GatewayHealth {
                status: GatewayStatus::Running,
                port: self.port,
                message: Some(message),
                pid,
            },
            Err(error) => {
                let status = if pid.is_some() {
                    GatewayStatus::Starting
                } else {
                    GatewayStatus::Offline
                };
                GatewayHealth {
                    status,
                    port: self.port,
                    message: Some(error),
                    pid,
                }
            }
        }
    }

    pub fn start(&self) -> Result<GatewayHealth, String> {
        if probe_http_health(self.port).is_ok() {
            return Ok(self.health());
        }

        let cli_entry = resolve_cli_entry()
            .ok_or_else(|| "Loong CLI entry not found. Build @loong/cli or set LOONG_CLI_ENTRY.".to_string())?;

        let data_root = resolve_loong_data_root();
        let mut command = Command::new("node");
        command
            .arg(&cli_entry)
            .arg("gateway")
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(self.port.to_string())
            .env("LOONG_DATA_ROOT", &data_root)
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        let child = command
            .spawn()
            .map_err(|error| format!("failed to spawn loong gateway: {error}"))?;

        {
            let mut guard = self
                .child
                .lock()
                .map_err(|_| "watchdog lock poisoned".to_string())?;
            *guard = Some(child);
        }

        for _ in 0..40 {
            if probe_http_health(self.port).is_ok() {
                return Ok(self.health());
            }
            std::thread::sleep(Duration::from_millis(250));
        }

        Ok(self.health())
    }

    pub fn stop(&self) -> Result<GatewayHealth, String> {
        let mut guard = self
            .child
            .lock()
            .map_err(|_| "watchdog lock poisoned".to_string())?;
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        Ok(GatewayHealth {
            status: GatewayStatus::Stopped,
            port: self.port,
            message: Some("Gateway stopped".to_string()),
            pid: None,
        })
    }

    pub fn restart(&self) -> Result<GatewayHealth, String> {
        self.stop()?;
        std::thread::sleep(Duration::from_millis(300));
        self.start()
    }
}

pub fn create_watchdog() -> GatewayWatchdog {
    GatewayWatchdog::new(default_gateway_port())
}

fn probe_http_health(port: u16) -> Result<String, String> {
    let url = format!("http://127.0.0.1:{port}/health");
    let response = ureq::get(&url)
        .timeout(Duration::from_secs(2))
        .call()
        .map_err(|error| error.to_string())?;
    if response.status() != 200 {
        return Err(format!("health HTTP {}", response.status()));
    }
    let body = response
        .into_string()
        .map_err(|error| error.to_string())?;
    if body.contains("\"ok\":true") || body.contains("\"ok\": true") {
        Ok("Gateway healthy".to_string())
    } else {
        Err("health response not ok".to_string())
    }
}
