use std::process::{Child, Command, Stdio};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::ffi::c_void;
#[cfg(windows)]
use std::mem::size_of;
#[cfg(windows)]
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};

use serde::Serialize;
#[cfg(windows)]
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

use crate::config::{
    default_gateway_port, describe_node_origin, resolve_cli_entry,
    resolve_desktop_runtime_root, resolve_loong_data_root, resolve_node_binary,
};

const HEALTH_POLL_INTERVAL_MS: u64 = 250;
const HEALTH_POLL_ATTEMPTS: usize = 40;
const SUPERVISOR_TICK_MS: u64 = 1_000;
const RESTART_BACKOFF_MS: u64 = 2_000;
const UNHEALTHY_RESTART_THRESHOLD: u8 = 5;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GatewayStatus {
    Stopped,
    Starting,
    Running,
    Degraded,
}

#[derive(Debug, Clone, Serialize)]
pub struct GatewayHealth {
    pub status: GatewayStatus,
    pub port: u16,
    pub message: Option<String>,
    pub pid: Option<u32>,
}

#[derive(Debug)]
struct GatewayWatchdogState {
    desired_running: bool,
    child: Option<Child>,
    external_gateway: bool,
    last_message: Option<String>,
    last_spawn_attempt: Option<Instant>,
    consecutive_unhealthy_checks: u8,
}

type ProcessJob = Option<Arc<ManagedProcessJob>>;

#[cfg(windows)]
#[derive(Debug)]
struct ManagedProcessJob {
    handle: OwnedHandle,
}

#[cfg(not(windows))]
#[derive(Debug)]
struct ManagedProcessJob;

#[derive(Clone)]
pub struct GatewayWatchdog {
    port: u16,
    runtime_root: Option<PathBuf>,
    state: Arc<Mutex<GatewayWatchdogState>>,
    process_job: ProcessJob,
}

impl GatewayWatchdog {
    pub fn new(port: u16, runtime_root: Option<PathBuf>) -> Self {
        let watchdog = Self {
            port,
            runtime_root: runtime_root
                .filter(|path| path.is_dir())
                .or_else(resolve_desktop_runtime_root),
            state: Arc::new(Mutex::new(GatewayWatchdogState {
                desired_running: false,
                child: None,
                external_gateway: false,
                last_message: None,
                last_spawn_attempt: None,
                consecutive_unhealthy_checks: 0,
            })),
            process_job: create_process_job(),
        };
        watchdog.spawn_supervisor();
        watchdog
    }

    pub fn health(&self) -> GatewayHealth {
        let (pid, desired_running, external_gateway, last_message, consecutive_unhealthy_checks) = {
            let state = match self.state.lock() {
                Ok(state) => state,
                Err(_) => {
                    return GatewayHealth {
                        status: GatewayStatus::Degraded,
                        port: self.port,
                        message: Some("watchdog lock poisoned".to_string()),
                        pid: None,
                    };
                }
            };
            (
                state.child.as_ref().map(|child| child.id()),
                state.desired_running,
                state.external_gateway,
                state.last_message.clone(),
                state.consecutive_unhealthy_checks,
            )
        };

        match probe_http_health(self.port) {
            Ok(message) => GatewayHealth {
                status: GatewayStatus::Running,
                port: self.port,
                message: Some(message),
                pid,
            },
            Err(error) => {
                let (status, message) = if desired_running {
                    if pid.is_some() && consecutive_unhealthy_checks == 0 {
                        (GatewayStatus::Starting, last_message.or(Some(error)))
                    } else if external_gateway {
                        (GatewayStatus::Degraded, last_message.or(Some(error)))
                    } else {
                        (GatewayStatus::Degraded, last_message.or(Some(error)))
                    }
                } else {
                    (GatewayStatus::Stopped, last_message.or(Some(error)))
                };

                GatewayHealth {
                    status,
                    port: self.port,
                    message,
                    pid,
                }
            }
        }
    }

    pub fn start(&self) -> Result<GatewayHealth, String> {
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "watchdog lock poisoned".to_string())?;
            state.desired_running = true;
            state.last_message = Some("Gateway start requested".to_string());
            state.external_gateway = false;
            state.consecutive_unhealthy_checks = 0;
        }

        if probe_http_health(self.port).is_ok() {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "watchdog lock poisoned".to_string())?;
            state.external_gateway = true;
            state.last_message = Some("Gateway already running".to_string());
            state.consecutive_unhealthy_checks = 0;
            return Ok(self.health());
        }

        if let Err(error) = self.ensure_spawned() {
            if let Ok(mut state) = self.state.lock() {
                state.last_message = Some(error.clone());
            }
            return Err(error);
        }
        Ok(self.wait_for_ready())
    }

    pub fn stop(&self) -> Result<GatewayHealth, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "watchdog lock poisoned".to_string())?;
        state.desired_running = false;
        state.external_gateway = false;
        state.last_spawn_attempt = None;
        state.consecutive_unhealthy_checks = 0;
        state.last_message = Some("Gateway stopped".to_string());
        if let Some(mut child) = state.child.take() {
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
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "watchdog lock poisoned".to_string())?;
            state.desired_running = true;
            state.external_gateway = false;
            state.last_message = Some("Gateway restart requested".to_string());
            state.last_spawn_attempt = None;
            state.consecutive_unhealthy_checks = 0;
            if let Some(mut child) = state.child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }

        if let Err(error) = self.ensure_spawned() {
            if let Ok(mut state) = self.state.lock() {
                state.last_message = Some(error.clone());
            }
            return Err(error);
        }
        Ok(self.wait_for_ready())
    }

    fn spawn_supervisor(&self) {
        let watchdog = self.clone();
        std::thread::spawn(move || loop {
            watchdog.supervise_once();
            std::thread::sleep(Duration::from_millis(SUPERVISOR_TICK_MS));
        });
    }

    fn supervise_once(&self) {
        let health_result = probe_http_health(self.port);
        let mut child_to_restart = None;
        let should_spawn = {
            let mut state = match self.state.lock() {
                Ok(state) => state,
                Err(_) => return,
            };

            if let Some(child) = state.child.as_mut() {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        state.child = None;
                        state.external_gateway = false;
                        state.consecutive_unhealthy_checks = 0;
                        state.last_message = Some(format!("Gateway exited with status {status}"));
                    }
                    Err(error) => {
                        state.child = None;
                        state.external_gateway = false;
                        state.consecutive_unhealthy_checks = 0;
                        state.last_message = Some(format!("Failed to query Gateway process: {error}"));
                    }
                    Ok(None) => {}
                }
            }

            if !state.desired_running {
                state.consecutive_unhealthy_checks = 0;
                false
            } else if health_result.is_ok() {
                state.consecutive_unhealthy_checks = 0;
                state.external_gateway = true;
                if state.child.is_some() {
                    state.external_gateway = false;
                    state.last_message = Some("Gateway running".to_string());
                } else {
                    state.last_message = Some("Gateway already running".to_string());
                }
                false
            } else {
                let error = health_result
                    .as_ref()
                    .err()
                    .cloned()
                    .unwrap_or_else(|| "Gateway health probe unexpectedly succeeded".to_string());

                if state.child.is_some() {
                    state.consecutive_unhealthy_checks =
                        state.consecutive_unhealthy_checks.saturating_add(1);
                    if state.consecutive_unhealthy_checks < UNHEALTHY_RESTART_THRESHOLD {
                        state.last_message = Some(format!(
                            "Gateway health check failed ({}/{}): {}",
                            state.consecutive_unhealthy_checks, UNHEALTHY_RESTART_THRESHOLD, error
                        ));
                        false
                    } else {
                        child_to_restart = state.child.take();
                        state.external_gateway = false;
                        state.consecutive_unhealthy_checks = 0;
                        state.last_spawn_attempt = None;
                        state.last_message =
                            Some(format!("Gateway became unhealthy, restarting: {error}"));
                        let now = Instant::now();
                        let ready_for_retry = state
                            .last_spawn_attempt
                            .map(|last| {
                                now.duration_since(last)
                                    >= Duration::from_millis(RESTART_BACKOFF_MS)
                            })
                            .unwrap_or(true);
                        if ready_for_retry {
                            state.last_spawn_attempt = Some(now);
                            true
                        } else {
                            false
                        }
                    }
                } else {
                    state.external_gateway = false;
                    state.last_message =
                        Some(format!("Gateway unavailable, recovering: {error}"));
                    let now = Instant::now();
                    let ready_for_retry = state
                        .last_spawn_attempt
                        .map(|last| {
                            now.duration_since(last) >= Duration::from_millis(RESTART_BACKOFF_MS)
                        })
                        .unwrap_or(true);
                    if ready_for_retry {
                        state.last_spawn_attempt = Some(now);
                        true
                    } else {
                        false
                    }
                }
            }
        };

        if let Some(mut child) = child_to_restart {
            let _ = child.kill();
            let _ = child.wait();
        }

        if should_spawn {
            if let Err(error) = self.spawn_gateway_process() {
                if let Ok(mut state) = self.state.lock() {
                    state.last_message = Some(error);
                }
            }
        }
    }

    fn ensure_spawned(&self) -> Result<(), String> {
        {
            let state = self
                .state
                .lock()
                .map_err(|_| "watchdog lock poisoned".to_string())?;
            if state.child.is_some() {
                return Ok(());
            }
        }
        self.spawn_gateway_process()
    }

    fn spawn_gateway_process(&self) -> Result<(), String> {
        let runtime_root = self.runtime_root.as_deref();
        let cli_entry = resolve_cli_entry(runtime_root).ok_or_else(|| {
            "Loong CLI entry not found. Prepare the bundled desktop runtime or set LOONG_CLI_ENTRY."
                .to_string()
        })?;
        let node_binary = resolve_node_binary(runtime_root);
        let node_origin = describe_node_origin(&node_binary, runtime_root);

        let data_root = resolve_loong_data_root();
        let mut command = Command::new(&node_binary);
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

        let mut child = command
            .spawn()
            .map_err(|error| format!("failed to spawn loong gateway: {error}"))?;
        if let Err(error) = bind_child_to_process_job(&self.process_job, &child) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        let pid = child.id();

        let mut state = self
            .state
            .lock()
            .map_err(|_| "watchdog lock poisoned".to_string())?;
        state.child = Some(child);
        state.external_gateway = false;
        state.consecutive_unhealthy_checks = 0;
        state.last_message = Some(format!("Gateway starting (pid {pid}) via {node_origin}"));
        Ok(())
    }

    fn wait_for_ready(&self) -> GatewayHealth {
        for _ in 0..HEALTH_POLL_ATTEMPTS {
            let health = self.health();
            if matches!(health.status, GatewayStatus::Running) {
                return health;
            }
            std::thread::sleep(Duration::from_millis(HEALTH_POLL_INTERVAL_MS));
        }
        self.health()
    }
}

#[cfg(windows)]
impl ManagedProcessJob {
    fn create() -> Result<Self, String> {
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(format!(
                "failed to create process job: {}",
                std::io::Error::last_os_error()
            ));
        }

        let handle = unsafe { OwnedHandle::from_raw_handle(handle) };
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

        let status = unsafe {
            SetInformationJobObject(
                handle.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                &info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION as *const c_void,
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if status == 0 {
            return Err(format!(
                "failed to configure process job: {}",
                std::io::Error::last_os_error()
            ));
        }

        Ok(Self { handle })
    }

    fn assign(&self, child: &Child) -> Result<(), String> {
        let status = unsafe {
            AssignProcessToJobObject(self.handle.as_raw_handle(), child.as_raw_handle())
        };
        if status == 0 {
            return Err(format!(
                "failed to attach gateway to watchdog job: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(())
    }
}

pub fn create_watchdog(runtime_root: Option<PathBuf>) -> GatewayWatchdog {
    GatewayWatchdog::new(default_gateway_port(), runtime_root)
}

fn create_process_job() -> ProcessJob {
    #[cfg(windows)]
    {
        ManagedProcessJob::create().ok().map(Arc::new)
    }

    #[cfg(not(windows))]
    {
        None
    }
}

fn bind_child_to_process_job(process_job: &ProcessJob, child: &Child) -> Result<(), String> {
    #[cfg(windows)]
    {
        let job = process_job
            .as_ref()
            .ok_or_else(|| "watchdog process job unavailable".to_string())?;
        job.assign(child)
    }

    #[cfg(not(windows))]
    {
        let _ = process_job;
        let _ = child;
        Ok(())
    }
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
