use std::path::{Path, PathBuf};

const LOONG_CLI_ENTRY_ENV: &str = "LOONG_CLI_ENTRY";
const LOONG_DATA_ROOT_ENV: &str = "LOONG_DATA_ROOT";
const LOONG_GATEWAY_PORT_ENV: &str = "LOONG_GATEWAY_PORT";
const LOONG_NODE_BINARY_ENV: &str = "LOONG_NODE_BINARY";
const LOONG_DESKTOP_RUNTIME_DIR_ENV: &str = "LOONG_DESKTOP_RUNTIME_DIR";

pub fn resolve_loong_data_root() -> PathBuf {
    if let Some(from_env) = read_non_empty_env_path(LOONG_DATA_ROOT_ENV) {
        return from_env;
    }

    if let Ok(cwd) = std::env::current_dir() {
        if let Some(found) = find_loong_dir_upward(&cwd) {
            return found;
        }
        if let Some(workspace) = find_workspace_root(&cwd) {
            return workspace.join(".loong");
        }
    }

    resolve_platform_data_root().unwrap_or_else(|| PathBuf::from(".loong"))
}

pub fn default_gateway_port() -> u16 {
    std::env::var(LOONG_GATEWAY_PORT_ENV)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(17_357)
}

pub fn resolve_desktop_runtime_root() -> Option<PathBuf> {
    if let Some(from_env) = read_non_empty_env_path(LOONG_DESKTOP_RUNTIME_DIR_ENV) {
        if from_env.is_dir() {
            return Some(from_env);
        }
    }

    let cwd = std::env::current_dir().ok()?;
    let workspace = find_workspace_root(&cwd)?;
    let runtime_root = workspace
        .join("packages")
        .join("desktop")
        .join("src-tauri")
        .join("resources")
        .join("runtime");
    if runtime_root.is_dir() {
        Some(runtime_root)
    } else {
        None
    }
}

pub fn resolve_node_binary(runtime_root: Option<&Path>) -> PathBuf {
    if let Some(from_env) = read_non_empty_env_path(LOONG_NODE_BINARY_ENV) {
        if from_env.is_file() {
            return from_env;
        }
    }

    if let Some(root) = runtime_root {
        let candidate = bundled_node_binary(root);
        if candidate.is_file() {
            return candidate;
        }
    }

    PathBuf::from("node")
}

pub fn resolve_cli_entry(runtime_root: Option<&Path>) -> Option<PathBuf> {
    if let Some(from_env) = read_non_empty_env_path(LOONG_CLI_ENTRY_ENV) {
        if from_env.is_file() {
            return Some(from_env);
        }
    }

    if let Some(root) = runtime_root {
        let candidate = root.join("cli").join("dist").join("index.js");
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    let cwd = std::env::current_dir().ok()?;
    let workspace = find_workspace_root(&cwd)?;
    let entry = workspace.join("packages").join("cli").join("dist").join("index.js");
    if entry.is_file() {
        Some(entry)
    } else {
        None
    }
}

pub fn describe_node_origin(node_binary: &Path, runtime_root: Option<&Path>) -> String {
    if let Some(root) = runtime_root {
        if node_binary == bundled_node_binary(root) {
            return format!("bundled Node ({})", node_binary.display());
        }
    }
    if node_binary.components().count() == 1 {
        "system Node from PATH".to_string()
    } else {
        format!("custom Node ({})", node_binary.display())
    }
}

fn bundled_node_binary(runtime_root: &Path) -> PathBuf {
    if cfg!(windows) {
        runtime_root.join("node").join("node.exe")
    } else {
        runtime_root.join("node").join("bin").join("node")
    }
}

fn read_non_empty_env_path(name: &str) -> Option<PathBuf> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn resolve_platform_data_root() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            return Some(PathBuf::from(local_app_data).join("Loong"));
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = home_dir() {
            return Some(home.join("Library").join("Application Support").join("Loong"));
        }
    }

    if let Some(xdg_data_home) = std::env::var_os("XDG_DATA_HOME") {
        return Some(PathBuf::from(xdg_data_home).join("loong"));
    }

    home_dir().map(|home| home.join(".loong"))
}

fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            return Some(PathBuf::from(profile));
        }
    }

    std::env::var_os("HOME").map(PathBuf::from)
}

fn find_loong_dir_upward(start: &Path) -> Option<PathBuf> {
    let mut current = start.to_path_buf();
    loop {
        let candidate = current.join(".loong");
        if candidate.is_dir() {
            return Some(candidate);
        }
        if !current.pop() {
            break;
        }
    }
    None
}

fn find_workspace_root(start: &Path) -> Option<PathBuf> {
    let mut current = start.to_path_buf();
    loop {
        if current.join("pnpm-workspace.yaml").is_file() {
            return Some(current);
        }
        if !current.pop() {
            break;
        }
    }
    None
}
