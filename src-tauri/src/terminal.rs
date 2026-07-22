use std::{
    collections::HashMap,
    env,
    io::{Read, Write},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    thread,
};

use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

pub const TERMINAL_OUTPUT_EVENT: &str = "markdowner://terminal-output";
pub const TERMINAL_EXIT_EVENT: &str = "markdowner://terminal-exit";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionResult {
    id: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutputPayload {
    id: u64,
    data: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExitPayload {
    id: u64,
}

struct TerminalSession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
}

pub struct TerminalState {
    next_id: AtomicU64,
    sessions: Arc<Mutex<HashMap<u64, TerminalSession>>>,
}

impl TerminalState {
    pub fn new() -> Self {
        Self {
            next_id: AtomicU64::new(1),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

fn terminal_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.clamp(2, 200),
        cols: cols.clamp(20, 400),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn default_shell() -> String {
    #[cfg(windows)]
    {
        env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    }

    #[cfg(not(windows))]
    {
        env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
    }
}

fn fallback_terminal_cwd() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
        .or_else(|| env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."))
}

fn resolve_terminal_cwd(cwd: Option<String>) -> Result<PathBuf, String> {
    let Some(raw) = cwd else {
        return Ok(fallback_terminal_cwd());
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(fallback_terminal_cwd());
    }
    let path = PathBuf::from(trimmed);
    if !path.is_dir() {
        return Err(format!(
            "Terminal default path is not a directory: {}",
            path.display()
        ));
    }
    Ok(path)
}

fn emit_terminal_exit(app_handle: &AppHandle, id: u64) {
    let _ = app_handle.emit(TERMINAL_EXIT_EVENT, TerminalExitPayload { id });
}

#[tauri::command]
pub fn terminal_start(
    app_handle: AppHandle,
    state: State<'_, TerminalState>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<TerminalSessionResult, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(terminal_size(cols, rows))
        .map_err(|error| error.to_string())?;

    let shell = default_shell();
    let resolved_cwd = resolve_terminal_cwd(cwd)?;
    let mut command = CommandBuilder::new(shell);
    command.cwd(resolved_cwd);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| error.to_string())?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| error.to_string())?;
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);

    {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "Terminal session lock poisoned".to_string())?;
        sessions.insert(
            id,
            TerminalSession {
                writer,
                master: pair.master,
                child,
            },
        );
    }

    let sessions = Arc::clone(&state.sessions);
    let thread_app_handle = app_handle.clone();
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buffer[..n]).into_owned();
                    let _ = thread_app_handle.emit(
                        TERMINAL_OUTPUT_EVENT,
                        TerminalOutputPayload { id, data },
                    );
                }
                Err(_) => break,
            }
        }

        if let Ok(mut sessions) = sessions.lock()
            && let Some(mut session) = sessions.remove(&id)
        {
            let _ = session.child.kill();
            let _ = session.child.wait();
        }
        emit_terminal_exit(&thread_app_handle, id);
    });

    Ok(TerminalSessionResult { id })
}

#[tauri::command]
pub fn terminal_write(
    state: State<'_, TerminalState>,
    id: u64,
    data: String,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal session lock poisoned".to_string())?;
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| format!("Terminal session not found: {id}"))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|error| error.to_string())?;
    session.writer.flush().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn terminal_resize(
    state: State<'_, TerminalState>,
    id: u64,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal session lock poisoned".to_string())?;
    let session = sessions
        .get(&id)
        .ok_or_else(|| format!("Terminal session not found: {id}"))?;
    session
        .master
        .resize(terminal_size(cols, rows))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn terminal_close(state: State<'_, TerminalState>, id: u64) -> Result<(), String> {
    let mut session = {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "Terminal session lock poisoned".to_string())?;
        sessions.remove(&id)
    };

    if let Some(session) = session.as_mut() {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{resolve_terminal_cwd, terminal_size};

    #[test]
    fn terminal_size_clamps_to_safe_bounds() {
        let size = terminal_size(1, 1);
        assert_eq!(size.cols, 20);
        assert_eq!(size.rows, 2);

        let size = terminal_size(1000, 1000);
        assert_eq!(size.cols, 400);
        assert_eq!(size.rows, 200);
    }

    #[test]
    fn resolve_terminal_cwd_trims_and_accepts_directories() {
        let temp = tempfile::tempdir().expect("tempdir");
        let path = temp.path().display().to_string();
        let resolved = resolve_terminal_cwd(Some(format!("  {path}  "))).expect("resolve cwd");
        assert_eq!(resolved, temp.path());
    }

    #[test]
    fn resolve_terminal_cwd_rejects_missing_directories() {
        let missing = "/tmp/markdowner-terminal-missing-directory-for-test";
        let error = resolve_terminal_cwd(Some(missing.to_string())).expect_err("missing path");
        assert!(error.contains("not a directory"));
    }
}
