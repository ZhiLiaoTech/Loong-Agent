use std::path::{Path, PathBuf};

/// Aligns with `packages/cli/src/dragon-paths.ts`.
pub fn resolve_dragon_data_root() -> PathBuf {
    if let Ok(from_env) = std::env::var("DRAGON_DATA_ROOT") {
        let trimmed = from_env.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        if let Some(found) = find_dragon_dir_upward(&cwd) {
            return found;
        }
        if let Some(workspace) = find_workspace_root(&cwd) {
            return workspace.join(".dragon");
        }
        return cwd.join(".dragon");
    }

    PathBuf::from(".dragon")
}

pub fn default_gateway_port() -> u16 {
    std::env::var("DRAGON_GATEWAY_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(17_357)
}

/// Dev: `node packages/cli/dist/index.js`. Override with `DRAGON_CLI_ENTRY`.
pub fn resolve_cli_entry() -> Option<PathBuf> {
    if let Ok(entry) = std::env::var("DRAGON_CLI_ENTRY") {
        let path = PathBuf::from(entry.trim());
        if path.is_file() {
            return Some(path);
        }
    }

    let cwd = std::env::current_dir().ok()?;
    let workspace = find_workspace_root(&cwd)?;
    let entry = workspace.join("packages").join("cli").join("dist").join("index.js");
    if entry.is_file() {
        return Some(entry);
    }
    None
}

fn find_dragon_dir_upward(start: &Path) -> Option<PathBuf> {
    let mut current = start.to_path_buf();
    loop {
        let candidate = current.join(".dragon");
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
