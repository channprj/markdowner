use std::{
    collections::{BTreeMap, HashMap},
    env,
    path::{Path, PathBuf},
    sync::Mutex,
};

use markdowner_core::{
    EditorMode, EditorRuntime, ThemeKind, ThemeSelection, WorkspaceState,
    storage::CursorPosition,
};
use serde::Serialize;
use serde_json::{Value, json};
use tauri::{
    AppHandle, Emitter, Manager, Runtime, State,
    menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
};

use tauri_plugin_cli::CliExt;

mod diagnostics;

const MENU_COMMAND_EVENT: &str = "markdowner://menu-command";
const MENU_FILE_ID: &str = "file";
const MENU_VIEW_ID: &str = "view";
const MENU_COMMAND_NEW_DOCUMENT: &str = "new-document";
const MENU_COMMAND_OPEN_DOCUMENT: &str = "open-document";
const MENU_COMMAND_OPEN_WORKSPACE: &str = "open-workspace";
const MENU_COMMAND_OPEN_RECENT_DOCUMENT_PREFIX: &str = "open-recent-document:";
const MENU_COMMAND_SAVE_ACTIVE_DOCUMENT: &str = "save-active-document";
const MENU_COMMAND_SAVE_ACTIVE_DOCUMENT_AS: &str = "save-active-document-as";
const MENU_COMMAND_CLOSE_WINDOW: &str = "close-window";
const MENU_COMMAND_QUIT_APP: &str = "quit-app";
const MENU_COMMAND_SET_MODE_WYSIWYG: &str = "mode-wysiwyg";
const MENU_COMMAND_SET_MODE_EDITOR: &str = "mode-editor";
const MENU_COMMAND_SET_MODE_SPLITVIEW: &str = "mode-splitview";
#[cfg(target_os = "macos")]
const MENU_MACOS_APP_ID: &str = "app";
const MENU_FILE_TITLE: &str = "File";
const MENU_EDIT_ID: &str = "edit";
const MENU_EDIT_TITLE: &str = "Edit";
const MENU_VIEW_TITLE: &str = "View";
const MENU_RECENT_ID: &str = "open-recent";
const MENU_RECENT_TITLE: &str = "Open Recent";
const MENU_RECENT_EMPTY_ID: &str = "open-recent-empty";
const MENU_RECENT_EMPTY_LABEL: &str = "No Recent Documents";
const CLI_LAUNCHER_DEFAULT_EXECUTABLE: &str =
    "/Applications/Markdowner.app/Contents/MacOS/markdowner-desktop";
const CLI_LAUNCHER_BEGIN_MARKER: &str = "# >>> markdowner CLI launcher >>>";
const CLI_LAUNCHER_END_MARKER: &str = "# <<< markdowner CLI launcher <<<";

const CLI_BINARY_INSTALL_PATH: &str = "/usr/local/bin/mdner";
const CLI_BINARY_SCRIPT_TAG: &str = "# markdowner-cli-wrapper";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct MenuCommandDescriptor {
    id: &'static str,
    label: &'static str,
    accelerator: Option<&'static str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CliLauncherInstallResult {
    shell_config_path: String,
    alias_command: String,
    already_installed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CliBinaryStatus {
    install_path: String,
    target_executable: String,
    installed: bool,
    in_path: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CliBinaryActionResult {
    install_path: String,
    target_executable: String,
    /// True when install/uninstall was a no-op (already-in-target-state).
    already_done: bool,
}

const FILE_MENU_COMMANDS: &[MenuCommandDescriptor] = &[
    MenuCommandDescriptor {
        id: MENU_COMMAND_NEW_DOCUMENT,
        label: "New Document",
        accelerator: Some("CmdOrCtrl+N"),
    },
    MenuCommandDescriptor {
        id: MENU_COMMAND_OPEN_DOCUMENT,
        label: "Open Markdown…",
        accelerator: Some("CmdOrCtrl+O"),
    },
    MenuCommandDescriptor {
        id: MENU_COMMAND_OPEN_WORKSPACE,
        label: "Open Folder…",
        accelerator: Some("CmdOrCtrl+Shift+O"),
    },
    MenuCommandDescriptor {
        id: MENU_COMMAND_SAVE_ACTIVE_DOCUMENT,
        label: "Save",
        accelerator: Some("CmdOrCtrl+S"),
    },
    MenuCommandDescriptor {
        id: MENU_COMMAND_SAVE_ACTIVE_DOCUMENT_AS,
        label: "Save As…",
        accelerator: Some("CmdOrCtrl+Shift+S"),
    },
    MenuCommandDescriptor {
        id: MENU_COMMAND_CLOSE_WINDOW,
        label: "Close",
        accelerator: Some("CmdOrCtrl+W"),
    },
    MenuCommandDescriptor {
        id: MENU_COMMAND_QUIT_APP,
        label: "Quit Markdowner",
        accelerator: Some("CmdOrCtrl+Q"),
    },
];

// View mode shortcuts use a chord (Cmd+K Cmd+E/W/S) plus an Alt+digit
// alternative — both are handled in the frontend keydown listener.
// macOS NSMenu cannot display chord accelerators, so we surface the chord in
// the label instead and leave the accelerator unset.
const VIEW_MENU_COMMANDS: &[MenuCommandDescriptor] = &[
    MenuCommandDescriptor {
        id: MENU_COMMAND_SET_MODE_WYSIWYG,
        label: "WYSIWYG (⌥1 · ⌘K ⌘W)",
        accelerator: None,
    },
    MenuCommandDescriptor {
        id: MENU_COMMAND_SET_MODE_EDITOR,
        label: "Editor (⌥2 · ⌘K ⌘E)",
        accelerator: None,
    },
    MenuCommandDescriptor {
        id: MENU_COMMAND_SET_MODE_SPLITVIEW,
        label: "Split-view (⌥3 · ⌘K ⌘S)",
        accelerator: None,
    },
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TopLevelMenuSection {
    #[cfg(target_os = "macos")]
    NativeApp,
    File,
    Edit,
    View,
}

fn top_level_menu_sections() -> &'static [TopLevelMenuSection] {
    #[cfg(target_os = "macos")]
    {
        &[
            TopLevelMenuSection::NativeApp,
            TopLevelMenuSection::File,
            TopLevelMenuSection::Edit,
            TopLevelMenuSection::View,
        ]
    }

    #[cfg(not(target_os = "macos"))]
    {
        &[
            TopLevelMenuSection::File,
            TopLevelMenuSection::Edit,
            TopLevelMenuSection::View,
        ]
    }
}

#[derive(Debug, Default, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenTabsPayload {
    pub open_tabs: Vec<String>,
    pub active_tab_path: Option<String>,
    /// Remembered caret per file path. JSON keys are the absolute paths so
    /// the frontend can look up by `DocumentTab.path` directly.
    #[serde(default)]
    pub cursor_positions: HashMap<String, CursorPosition>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub root_dir: Option<String>,
    pub workspace_documents: Vec<String>,
    pub recent_documents: Vec<String>,
    pub active_document_name: Option<String>,
    pub active_document_path: Option<String>,
    pub active_document_source: Option<String>,
    pub active_document_dirty: bool,
    pub mode: EditorMode,
    pub theme: ThemeSelection,
    pub last_error: Option<String>,
}

#[derive(Debug)]
pub struct DesktopBackend {
    runtime: EditorRuntime,
}

impl DesktopBackend {
    pub fn new(session_store: Option<PathBuf>) -> Self {
        Self::new_with_mode(session_store, EditorMode::Wysiwyg)
    }

    pub fn new_with_mode(session_store: Option<PathBuf>, mode: EditorMode) -> Self {
        let mut workspace = WorkspaceState::default();
        workspace.set_mode(mode);
        let runtime = match session_store {
            Some(path) => EditorRuntime::new(workspace).with_session_store(path),
            None => EditorRuntime::new(workspace),
        };

        Self { runtime }
    }

    pub fn restore_session(&mut self) -> Result<(), String> {
        let configured_startup_mode = self.runtime.workspace().mode();
        self.runtime
            .restore_session()
            .map_err(|error| error.to_string())?;
        self.runtime.set_mode(configured_startup_mode);
        Ok(())
    }

    pub fn snapshot(&self) -> AppSnapshot {
        let workspace = self.runtime.workspace();
        let active_document = workspace.active_document();

        AppSnapshot {
            root_dir: workspace
                .root_dir()
                .map(|path| path.to_string_lossy().into_owned()),
            workspace_documents: workspace
                .workspace_documents()
                .iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect(),
            recent_documents: workspace
                .recent_documents()
                .iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect(),
            active_document_name: active_document.map(|document| document.display_name()),
            active_document_path: active_document.and_then(|document| {
                document
                    .backing_path()
                    .map(|path| path.to_string_lossy().into_owned())
            }),
            active_document_source: active_document.map(|document| document.source().to_string()),
            active_document_dirty: active_document.is_some_and(|document| document.is_dirty()),
            mode: workspace.mode(),
            theme: workspace.theme().clone(),
            last_error: workspace.last_error().map(ToOwned::to_owned),
        }
    }

    pub fn new_document(&mut self) -> Result<AppSnapshot, String> {
        self.runtime
            .new_document()
            .map_err(|error| error.to_string())?;
        Ok(self.snapshot())
    }

    pub fn open_document(&mut self, path: &Path) -> Result<AppSnapshot, String> {
        self.runtime
            .open_document(path)
            .map_err(|error| error.to_string())?;
        Ok(self.snapshot())
    }

    pub fn open_workspace(&mut self, path: &Path) -> Result<AppSnapshot, String> {
        self.runtime
            .open_workspace(path)
            .map_err(|error| error.to_string())?;
        Ok(self.snapshot())
    }

    pub fn open_workspace_document(&mut self, path: &Path) -> Result<AppSnapshot, String> {
        self.runtime
            .open_workspace_document(path)
            .map_err(|error| error.to_string())?;
        Ok(self.snapshot())
    }

    pub fn replace_active_document_source(
        &mut self,
        source: impl Into<String>,
    ) -> Result<AppSnapshot, String> {
        self.runtime
            .replace_active_document_source(source)
            .map_err(|error| error.to_string())?;
        Ok(self.snapshot())
    }

    pub fn save_active_document(&mut self) -> Result<AppSnapshot, String> {
        self.runtime
            .save_active_document()
            .map_err(|error| error.to_string())?;
        Ok(self.snapshot())
    }

    pub fn save_active_document_as(&mut self, path: &Path) -> Result<AppSnapshot, String> {
        self.runtime
            .save_active_document_as(path)
            .map_err(|error| error.to_string())?;
        Ok(self.snapshot())
    }

    pub fn has_active_document_external_changes(&mut self) -> Result<bool, String> {
        self.runtime
            .active_document_has_external_modifications()
            .map_err(|error| error.to_string())
    }

    pub fn active_document_disk_source(&mut self) -> Result<String, String> {
        self.runtime
            .active_document_disk_source()
            .map_err(|error| error.to_string())
    }

    pub fn set_mode(&mut self, mode: EditorMode) -> AppSnapshot {
        self.runtime.set_mode(mode);
        self.snapshot()
    }

    pub fn save_open_tabs(
        &self,
        open_tabs: &[String],
        active_tab_path: Option<String>,
        cursor_positions: &HashMap<String, CursorPosition>,
    ) -> Result<(), String> {
        // Persist tabs alongside the existing session payload, keeping
        // mode/theme/recent_documents from live state so the session file
        // stays consistent when only tabs change.
        let Some(session_path) = self.runtime.session_store_path().map(Path::to_path_buf) else {
            return Ok(());
        };
        let workspace = self.runtime.workspace();
        let recent: Vec<PathBuf> = workspace.recent_documents().to_vec();
        let active_document_path = workspace
            .active_document()
            .and_then(|document| document.backing_path())
            .map(Path::to_path_buf);
        let (tabs, active): (Vec<PathBuf>, Option<PathBuf>) =
            if open_tabs.is_empty() && active_tab_path.is_none() {
                match active_document_path {
                    Some(path) => (vec![path.clone()], Some(path)),
                    None => (Vec::new(), None),
                }
            } else {
                (
                    open_tabs.iter().map(PathBuf::from).collect(),
                    active_tab_path.map(PathBuf::from),
                )
            };
        // Drop cursors that no longer correspond to an open tab so the
        // session file doesn't accumulate stale entries forever.
        let tab_paths: std::collections::HashSet<&PathBuf> = tabs.iter().collect();
        let cursor_positions: BTreeMap<PathBuf, CursorPosition> = cursor_positions
            .iter()
            .map(|(path, cursor)| (PathBuf::from(path), *cursor))
            .filter(|(path, _)| tab_paths.contains(path))
            .collect();
        markdowner_core::storage::persist_workspace_session(
            &session_path,
            &recent,
            workspace.mode(),
            workspace.theme(),
            &tabs,
            active.as_deref(),
            &cursor_positions,
        )
        .map_err(|error| error.to_string())
    }

    pub fn load_open_tabs(&self) -> Result<OpenTabsPayload, String> {
        let Some(session_path) = self.runtime.session_store_path().map(Path::to_path_buf) else {
            return Ok(OpenTabsPayload::default());
        };
        let session = markdowner_core::storage::load_workspace_session(&session_path)
            .map_err(|error| error.to_string())?;
        Ok(OpenTabsPayload {
            open_tabs: session
                .open_tabs
                .iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect(),
            active_tab_path: session
                .active_tab_path
                .as_deref()
                .map(|p| p.to_string_lossy().into_owned()),
            cursor_positions: session
                .cursor_positions
                .into_iter()
                .map(|(path, cursor)| (path.to_string_lossy().into_owned(), cursor))
                .collect(),
        })
    }

    pub fn set_theme_kind(&mut self, theme_kind: ThemeKind) -> AppSnapshot {
        self.runtime
            .set_theme(ThemeSelection::new(theme_kind, None));
        self.snapshot()
    }

    pub fn import_theme(&mut self, path: &Path) -> Result<AppSnapshot, String> {
        self.runtime
            .import_theme_from_path(path)
            .map_err(|error| error.to_string())?;
        Ok(self.snapshot())
    }
}

pub struct DesktopAppState(Mutex<DesktopBackend>);

impl DesktopAppState {
    fn new(session_store: Option<PathBuf>, startup_mode: EditorMode) -> Self {
        Self(Mutex::new(DesktopBackend::new_with_mode(
            session_store,
            startup_mode,
        )))
    }
}

fn settings_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_handle
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("settings.json"))
}

fn app_data_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    app_handle.path().app_data_dir().map_err(|e| e.to_string())
}

fn shell_config_path_for_shell(home_dir: &Path, shell: Option<&str>) -> PathBuf {
    let shell_name = shell
        .and_then(|value| Path::new(value).file_name())
        .and_then(|value| value.to_str())
        .unwrap_or("zsh");

    match shell_name {
        "bash" => home_dir.join(".bashrc"),
        "zsh" => home_dir.join(".zshrc"),
        _ => home_dir.join(".zshrc"),
    }
}

fn user_home_dir() -> Result<PathBuf, String> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or_else(|| "Could not determine home directory for CLI launcher install".to_string())
}

fn path_is_macos_app_executable(path: &Path) -> bool {
    let components = path
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>();

    components.windows(3).any(|window| {
        window[0].ends_with(".app") && window[1] == "Contents" && window[2] == "MacOS"
    })
}

fn cli_launcher_executable_path() -> PathBuf {
    env::current_exe()
        .ok()
        .filter(|path| path_is_macos_app_executable(path))
        .unwrap_or_else(|| PathBuf::from(CLI_LAUNCHER_DEFAULT_EXECUTABLE))
}

fn double_quote_shell_value(value: &str) -> String {
    value
        .chars()
        .flat_map(|character| match character {
            '\\' => "\\\\".chars().collect::<Vec<_>>(),
            '"' => "\\\"".chars().collect::<Vec<_>>(),
            '$' => "\\$".chars().collect::<Vec<_>>(),
            '`' => "\\`".chars().collect::<Vec<_>>(),
            _ => vec![character],
        })
        .collect()
}

fn cli_launcher_alias_command_for_path(executable_path: &Path) -> String {
    format!(
        "alias markdowner=\"{}\"",
        double_quote_shell_value(&executable_path.to_string_lossy())
    )
}

fn cli_launcher_managed_block(alias_command: &str) -> String {
    format!("{CLI_LAUNCHER_BEGIN_MARKER}\n{alias_command}\n{CLI_LAUNCHER_END_MARKER}\n")
}

fn remove_cli_launcher_managed_block(contents: &str) -> String {
    let Some(start) = contents.find(CLI_LAUNCHER_BEGIN_MARKER) else {
        return contents.to_string();
    };
    let Some(end_relative) = contents[start..].find(CLI_LAUNCHER_END_MARKER) else {
        return contents.to_string();
    };

    let end = start + end_relative + CLI_LAUNCHER_END_MARKER.len();
    let remove_end = if contents[end..].starts_with("\r\n") {
        end + 2
    } else if contents[end..].starts_with('\n') {
        end + 1
    } else {
        end
    };

    format!("{}{}", &contents[..start], &contents[remove_end..])
}

fn append_cli_launcher_managed_block(mut contents: String, alias_command: &str) -> String {
    if !contents.is_empty() && !contents.ends_with('\n') {
        contents.push('\n');
    }
    if !contents.trim().is_empty() && !contents.ends_with("\n\n") {
        contents.push('\n');
    }
    contents.push_str(&cli_launcher_managed_block(alias_command));
    contents
}

fn install_cli_launcher_alias(
    shell_config_path: &Path,
    alias_command: &str,
) -> Result<CliLauncherInstallResult, String> {
    let existing = match std::fs::read_to_string(shell_config_path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(error.to_string()),
    };
    let managed_block = cli_launcher_managed_block(alias_command);
    let already_installed = existing.contains(&managed_block)
        || existing.lines().any(|line| line.trim() == alias_command);

    if !already_installed {
        if let Some(parent) = shell_config_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let next_contents = append_cli_launcher_managed_block(
            remove_cli_launcher_managed_block(&existing),
            alias_command,
        );
        std::fs::write(shell_config_path, next_contents).map_err(|e| e.to_string())?;
    }

    Ok(CliLauncherInstallResult {
        shell_config_path: shell_config_path.display().to_string(),
        alias_command: alias_command.to_string(),
        already_installed,
    })
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSearchOptions {
    #[serde(default)]
    case_sensitive: bool,
    #[serde(default)]
    whole_word: bool,
    #[serde(default)]
    regex: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSearchMatch {
    line: u32,
    column: u32,
    preview: String,
    match_start: u32,
    match_end: u32,
    absolute_offset: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSearchFile {
    path: String,
    matches: Vec<WorkspaceSearchMatch>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSearchResult {
    files: Vec<WorkspaceSearchFile>,
}

const WORKSPACE_SEARCH_PREVIEW_RADIUS: usize = 80;
const WORKSPACE_SEARCH_MAX_MATCHES_PER_FILE: usize = 200;
const WORKSPACE_SEARCH_MAX_TOTAL_MATCHES: usize = 2000;

fn is_word_char(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn line_column_for_offset(source: &str, offset: usize) -> (u32, u32) {
    let mut line: u32 = 1;
    let mut last_newline: usize = 0;
    for (idx, ch) in source.char_indices() {
        if idx >= offset {
            break;
        }
        if ch == '\n' {
            line += 1;
            last_newline = idx + 1;
        }
    }
    let column_chars = source[last_newline..offset].chars().count();
    (line, (column_chars as u32) + 1)
}

fn preview_window(line_text: &str, match_start_in_line: usize, match_end_in_line: usize) -> (String, usize, usize) {
    let char_indices: Vec<(usize, char)> = line_text.char_indices().collect();
    let start_char_idx = char_indices
        .iter()
        .position(|(byte_idx, _)| *byte_idx >= match_start_in_line)
        .unwrap_or(char_indices.len());
    let end_char_idx = char_indices
        .iter()
        .position(|(byte_idx, _)| *byte_idx >= match_end_in_line)
        .unwrap_or(char_indices.len());
    let preview_char_start = start_char_idx.saturating_sub(WORKSPACE_SEARCH_PREVIEW_RADIUS);
    let preview_char_end = (end_char_idx + WORKSPACE_SEARCH_PREVIEW_RADIUS).min(char_indices.len());
    let preview_byte_start = char_indices
        .get(preview_char_start)
        .map(|(byte_idx, _)| *byte_idx)
        .unwrap_or(0);
    let preview_byte_end = if preview_char_end == char_indices.len() {
        line_text.len()
    } else {
        char_indices[preview_char_end].0
    };
    let preview = line_text[preview_byte_start..preview_byte_end].to_string();
    let highlight_start = match_start_in_line.saturating_sub(preview_byte_start);
    let highlight_end = (match_end_in_line.saturating_sub(preview_byte_start)).min(preview.len());
    (preview, highlight_start, highlight_end)
}

fn search_file_contents(
    source: &str,
    pattern: &regex::Regex,
    whole_word: bool,
    remaining_budget: usize,
) -> Vec<WorkspaceSearchMatch> {
    let mut matches: Vec<WorkspaceSearchMatch> = Vec::new();
    let limit = remaining_budget.min(WORKSPACE_SEARCH_MAX_MATCHES_PER_FILE);
    if limit == 0 {
        return matches;
    }

    let bytes = source.as_bytes();
    for capture in pattern.find_iter(source) {
        let start = capture.start();
        let end = capture.end();
        if start == end {
            continue;
        }

        if whole_word {
            let before_ok = start == 0 || !is_word_char(bytes[start - 1]);
            let after_ok = end >= bytes.len() || !is_word_char(bytes[end]);
            if !(before_ok && after_ok) {
                continue;
            }
        }

        // Find line bounds
        let line_start = source[..start].rfind('\n').map(|p| p + 1).unwrap_or(0);
        let line_end = source[end..]
            .find('\n')
            .map(|offset| end + offset)
            .unwrap_or(source.len());
        let line_text = &source[line_start..line_end];
        let match_start_in_line = start - line_start;
        let match_end_in_line = end - line_start;
        let (preview, highlight_start, highlight_end) =
            preview_window(line_text, match_start_in_line, match_end_in_line);
        let (line, column) = line_column_for_offset(source, start);
        matches.push(WorkspaceSearchMatch {
            line,
            column,
            preview,
            match_start: highlight_start as u32,
            match_end: highlight_end as u32,
            absolute_offset: start as u32,
        });

        if matches.len() >= limit {
            break;
        }
    }

    matches
}

fn compile_search_pattern(query: &str, options: &WorkspaceSearchOptions) -> Result<regex::Regex, String> {
    let escaped = if options.regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    let mut builder = regex::RegexBuilder::new(&escaped);
    builder.case_insensitive(!options.case_sensitive);
    builder.multi_line(true);
    builder
        .build()
        .map_err(|error| format!("Invalid pattern: {}", error))
}

#[tauri::command]
fn search_workspace(
    query: String,
    options: WorkspaceSearchOptions,
    paths: Vec<String>,
) -> Result<WorkspaceSearchResult, String> {
    if query.is_empty() {
        return Ok(WorkspaceSearchResult { files: Vec::new() });
    }

    let pattern = compile_search_pattern(&query, &options)?;
    let mut files: Vec<WorkspaceSearchFile> = Vec::new();
    let mut total = 0usize;

    for raw_path in paths {
        if total >= WORKSPACE_SEARCH_MAX_TOTAL_MATCHES {
            break;
        }
        let path = Path::new(&raw_path);
        let Ok(source) = std::fs::read_to_string(path) else {
            continue;
        };
        let remaining = WORKSPACE_SEARCH_MAX_TOTAL_MATCHES - total;
        let matches = search_file_contents(&source, &pattern, options.whole_word, remaining);
        if matches.is_empty() {
            continue;
        }
        total += matches.len();
        files.push(WorkspaceSearchFile {
            path: raw_path,
            matches,
        });
    }

    Ok(WorkspaceSearchResult { files })
}

#[tauri::command]
fn install_cli_launcher() -> Result<CliLauncherInstallResult, String> {
    let home_dir = user_home_dir()?;
    let shell = env::var("SHELL").ok();
    let shell_config_path = shell_config_path_for_shell(&home_dir, shell.as_deref());
    let executable_path = cli_launcher_executable_path();
    let alias_command = cli_launcher_alias_command_for_path(&executable_path);

    install_cli_launcher_alias(&shell_config_path, &alias_command)
}

fn cli_binary_wrapper_script_for_target(target_executable: &Path) -> String {
    // A tiny POSIX wrapper that forwards all arguments to the app's CLI
    // binary. The tag comment lets uninstall recognise scripts we own and
    // avoid clobbering an unrelated /usr/local/bin/mdner that the user (or
    // a package manager) might have placed there.
    format!(
        "#!/bin/sh\n{tag}\nexec \"{target}\" \"$@\"\n",
        tag = CLI_BINARY_SCRIPT_TAG,
        target = double_quote_shell_value(&target_executable.to_string_lossy()),
    )
}

fn cli_binary_directory_is_in_path(install_path: &Path) -> bool {
    let Some(parent) = install_path.parent() else {
        return false;
    };
    let parent_str = parent.to_string_lossy();
    env::var_os("PATH")
        .map(|raw| {
            env::split_paths(&raw).any(|candidate| {
                candidate.to_string_lossy() == parent_str
            })
        })
        .unwrap_or(false)
}

fn cli_binary_install_is_ours(install_path: &Path) -> bool {
    match std::fs::read_to_string(install_path) {
        Ok(contents) => contents.contains(CLI_BINARY_SCRIPT_TAG),
        Err(_) => false,
    }
}

/// Escape a string so it can be embedded inside an AppleScript double-quoted
/// string literal. AppleScript treats `"` and `\` specially.
#[cfg(target_os = "macos")]
fn apple_script_string_escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            _ => out.push(ch),
        }
    }
    out
}

#[cfg(target_os = "macos")]
fn run_privileged_shell_command(shell_command: &str) -> Result<(), String> {
    let prompt = "Markdowner needs administrator access to update /usr/local/bin.";
    let osa_script = format!(
        r#"do shell script "{}" with prompt "{}" with administrator privileges"#,
        apple_script_string_escape(shell_command),
        apple_script_string_escape(prompt),
    );
    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&osa_script)
        .output()
        .map_err(|error| format!("Could not spawn osascript: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.contains("User canceled") || stderr.contains("(-128)") {
        Err("Cancelled".to_string())
    } else if stderr.is_empty() {
        Err("Admin escalation failed".to_string())
    } else {
        Err(stderr)
    }
}

#[cfg(not(target_os = "macos"))]
fn run_privileged_shell_command(_shell_command: &str) -> Result<(), String> {
    Err("Admin escalation is only supported on macOS in this build".to_string())
}

fn write_cli_binary_script(install_path: &Path, script: &str) -> Result<(), String> {
    if let Some(parent) = install_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            format!("Could not create {}: {error}", parent.display())
        })?;
    }
    std::fs::write(install_path, script).map_err(|error| error.to_string())?;
    set_executable_permission(install_path).map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(unix)]
fn set_executable_permission(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(path)?.permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(path, perms)
}

#[cfg(not(unix))]
fn set_executable_permission(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

fn install_cli_binary_at(
    install_path: &Path,
    target_executable: &Path,
) -> Result<CliBinaryActionResult, String> {
    let script = cli_binary_wrapper_script_for_target(target_executable);

    // No-op if an identical wrapper already exists.
    if let Ok(existing) = std::fs::read_to_string(install_path)
        && existing == script
    {
        return Ok(CliBinaryActionResult {
            install_path: install_path.display().to_string(),
            target_executable: target_executable.display().to_string(),
            already_done: true,
        });
    }

    // Try a plain write first — works when /usr/local/bin/ is user-writable
    // (e.g. dev machines with a chowned prefix). If that fails, escalate.
    let direct_result = write_cli_binary_script(install_path, &script);
    if direct_result.is_ok() {
        return Ok(CliBinaryActionResult {
            install_path: install_path.display().to_string(),
            target_executable: target_executable.display().to_string(),
            already_done: false,
        });
    }

    // Escalation path: write to a temp file, then sudo-move + chmod via
    // osascript so the user only sees one password prompt.
    let mut tmp_path = env::temp_dir();
    tmp_path.push(format!(
        "markdowner-cli-wrapper-{}-{}.sh",
        std::process::id(),
        chrono_nanos_or_zero(),
    ));
    std::fs::write(&tmp_path, &script).map_err(|error| {
        format!("Could not stage wrapper script: {error}")
    })?;

    let parent = install_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("/usr/local/bin"));

    let shell_command = format!(
        "mkdir -p {parent} && mv {tmp} {dest} && chmod 755 {dest}",
        parent = double_quote_shell_value(&parent.to_string_lossy()),
        tmp = format_args!("\"{}\"", double_quote_shell_value(&tmp_path.to_string_lossy())),
        dest = format_args!("\"{}\"", double_quote_shell_value(&install_path.to_string_lossy())),
    );

    let escalation_result = run_privileged_shell_command(&shell_command);
    // Best-effort cleanup if mv didn't consume the tmp file (e.g. on cancel).
    let _ = std::fs::remove_file(&tmp_path);

    escalation_result?;

    Ok(CliBinaryActionResult {
        install_path: install_path.display().to_string(),
        target_executable: target_executable.display().to_string(),
        already_done: false,
    })
}

fn uninstall_cli_binary_at(
    install_path: &Path,
    target_executable: &Path,
) -> Result<CliBinaryActionResult, String> {
    if !install_path.exists() {
        return Ok(CliBinaryActionResult {
            install_path: install_path.display().to_string(),
            target_executable: target_executable.display().to_string(),
            already_done: true,
        });
    }

    if !cli_binary_install_is_ours(install_path) {
        return Err(format!(
            "{} exists but was not installed by Markdowner. Remove it manually.",
            install_path.display()
        ));
    }

    let direct_result = std::fs::remove_file(install_path);
    if direct_result.is_ok() {
        return Ok(CliBinaryActionResult {
            install_path: install_path.display().to_string(),
            target_executable: target_executable.display().to_string(),
            already_done: false,
        });
    }

    let shell_command = format!(
        "rm -f \"{}\"",
        double_quote_shell_value(&install_path.to_string_lossy())
    );
    run_privileged_shell_command(&shell_command)?;
    Ok(CliBinaryActionResult {
        install_path: install_path.display().to_string(),
        target_executable: target_executable.display().to_string(),
        already_done: false,
    })
}

/// Best-effort nanosecond stamp for temp-file uniqueness. We avoid bringing in
/// the `chrono` crate just for this.
fn chrono_nanos_or_zero() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

#[tauri::command]
fn cli_binary_status() -> Result<CliBinaryStatus, String> {
    let install_path = PathBuf::from(CLI_BINARY_INSTALL_PATH);
    let target = cli_launcher_executable_path();
    Ok(CliBinaryStatus {
        installed: install_path.exists() && cli_binary_install_is_ours(&install_path),
        in_path: cli_binary_directory_is_in_path(&install_path),
        install_path: install_path.display().to_string(),
        target_executable: target.display().to_string(),
    })
}

#[tauri::command]
fn install_cli_binary() -> Result<CliBinaryActionResult, String> {
    let install_path = PathBuf::from(CLI_BINARY_INSTALL_PATH);
    let target = cli_launcher_executable_path();
    install_cli_binary_at(&install_path, &target)
}

#[tauri::command]
fn uninstall_cli_binary() -> Result<CliBinaryActionResult, String> {
    let install_path = PathBuf::from(CLI_BINARY_INSTALL_PATH);
    let target = cli_launcher_executable_path();
    uninstall_cli_binary_at(&install_path, &target)
}

fn load_desktop_settings(
    app_handle: &AppHandle,
) -> Result<markdowner_core::settings::Settings, String> {
    let path = settings_path(app_handle)?;
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|_| "{}".to_string());
    let settings: markdowner_core::settings::Settings =
        serde_json::from_str(&raw).unwrap_or_default();
    Ok(settings)
}

fn build_menu_item<R: Runtime>(
    app: &AppHandle<R>,
    descriptor: MenuCommandDescriptor,
) -> tauri::Result<tauri::menu::MenuItem<R>> {
    let mut builder = MenuItemBuilder::with_id(descriptor.id, descriptor.label);
    if let Some(accel) = descriptor.accelerator {
        builder = builder.accelerator(accel);
    }
    builder.build(app)
}

fn recent_document_menu_command(path: &str) -> String {
    format!("{MENU_COMMAND_OPEN_RECENT_DOCUMENT_PREFIX}{path}")
}

fn build_recent_menu<R: Runtime>(
    app: &AppHandle<R>,
    recent_documents: &[String],
) -> tauri::Result<tauri::menu::Submenu<R>> {
    let mut recent_menu_builder = SubmenuBuilder::with_id(app, MENU_RECENT_ID, MENU_RECENT_TITLE);

    if recent_documents.is_empty() {
        let empty_item = MenuItemBuilder::with_id(MENU_RECENT_EMPTY_ID, MENU_RECENT_EMPTY_LABEL)
            .enabled(false)
            .build(app)?;
        recent_menu_builder = recent_menu_builder.item(&empty_item);
    } else {
        for path in recent_documents {
            let item =
                MenuItemBuilder::with_id(recent_document_menu_command(path), path).build(app)?;
            recent_menu_builder = recent_menu_builder.item(&item);
        }
    }

    recent_menu_builder.build()
}

#[cfg(target_os = "macos")]
fn build_native_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    let package_info = app.package_info();
    let config = app.config();
    let about_metadata = tauri::menu::AboutMetadata {
        name: Some(package_info.name.clone()),
        version: Some(package_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config
            .bundle
            .publisher
            .clone()
            .map(|publisher| vec![publisher]),
        ..Default::default()
    };

    SubmenuBuilder::with_id(app, MENU_MACOS_APP_ID, package_info.name.clone())
        .about(Some(about_metadata))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .separator()
        .quit()
        .build()
}

fn build_app_menu<R: Runtime>(
    app: &AppHandle<R>,
    recent_documents: &[String],
) -> tauri::Result<Menu<R>> {
    let mut file_menu_builder = SubmenuBuilder::with_id(app, MENU_FILE_ID, MENU_FILE_TITLE);
    for descriptor in FILE_MENU_COMMANDS {
        let item = build_menu_item(app, *descriptor)?;
        file_menu_builder = file_menu_builder.item(&item);
    }
    let recent_menu = build_recent_menu(app, recent_documents)?;
    file_menu_builder = file_menu_builder.item(&recent_menu);
    let file_menu = file_menu_builder.build()?;

    let edit_menu = SubmenuBuilder::with_id(app, MENU_EDIT_ID, MENU_EDIT_TITLE)
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .separator()
        .select_all()
        .build()?;

    let mut view_menu_builder = SubmenuBuilder::with_id(app, MENU_VIEW_ID, MENU_VIEW_TITLE);
    for descriptor in VIEW_MENU_COMMANDS {
        let item = build_menu_item(app, *descriptor)?;
        view_menu_builder = view_menu_builder.item(&item);
    }
    let view_menu = view_menu_builder.build()?;

    let mut menu_builder = MenuBuilder::new(app);
    for section in top_level_menu_sections() {
        match section {
            #[cfg(target_os = "macos")]
            TopLevelMenuSection::NativeApp => {
                let native_app_menu = build_native_app_menu(app)?;
                menu_builder = menu_builder.item(&native_app_menu);
            }
            TopLevelMenuSection::File => {
                menu_builder = menu_builder.item(&file_menu);
            }
            TopLevelMenuSection::Edit => {
                menu_builder = menu_builder.item(&edit_menu);
            }
            TopLevelMenuSection::View => {
                menu_builder = menu_builder.item(&view_menu);
            }
        }
    }

    menu_builder.build()
}

fn menu_command_from_id(id: &str) -> Option<String> {
    if id.starts_with(MENU_COMMAND_OPEN_RECENT_DOCUMENT_PREFIX) {
        return Some(id.to_string());
    }

    match id {
        MENU_COMMAND_NEW_DOCUMENT => Some(MENU_COMMAND_NEW_DOCUMENT.to_string()),
        MENU_COMMAND_OPEN_DOCUMENT => Some(MENU_COMMAND_OPEN_DOCUMENT.to_string()),
        MENU_COMMAND_OPEN_WORKSPACE => Some(MENU_COMMAND_OPEN_WORKSPACE.to_string()),
        MENU_COMMAND_SAVE_ACTIVE_DOCUMENT => Some(MENU_COMMAND_SAVE_ACTIVE_DOCUMENT.to_string()),
        MENU_COMMAND_SAVE_ACTIVE_DOCUMENT_AS => {
            Some(MENU_COMMAND_SAVE_ACTIVE_DOCUMENT_AS.to_string())
        }
        MENU_COMMAND_CLOSE_WINDOW => Some(MENU_COMMAND_CLOSE_WINDOW.to_string()),
        MENU_COMMAND_QUIT_APP => Some(MENU_COMMAND_QUIT_APP.to_string()),
        MENU_COMMAND_SET_MODE_WYSIWYG => Some(MENU_COMMAND_SET_MODE_WYSIWYG.to_string()),
        MENU_COMMAND_SET_MODE_EDITOR => Some(MENU_COMMAND_SET_MODE_EDITOR.to_string()),
        MENU_COMMAND_SET_MODE_SPLITVIEW => Some(MENU_COMMAND_SET_MODE_SPLITVIEW.to_string()),
        _ => None,
    }
}

fn sync_app_menu<R: Runtime>(app: &AppHandle<R>, backend: &DesktopBackend) {
    let snapshot = backend.snapshot();

    if let Ok(menu) = build_app_menu(app, &snapshot.recent_documents) {
        let _ = app.set_menu(menu);
    }
}

fn session_store_path(app_handle: &AppHandle) -> Option<PathBuf> {
    app_handle
        .path()
        .app_config_dir()
        .ok()
        .map(|path| path.join("workspace-session.json"))
}

fn open_startup_path(backend: &mut DesktopBackend, path: &Path) -> Result<(), String> {
    if path.is_file() {
        backend.open_document(path)?;
        let path_string = path.to_string_lossy().into_owned();
        let open_tabs = vec![path_string.clone()];
        backend.save_open_tabs(&open_tabs, Some(path_string), &HashMap::new())?;
    } else if path.is_dir() {
        backend.open_workspace(path)?;
    }

    Ok(())
}

// Resolve a CLI path argument against an optional working directory. Relative
// paths must be anchored to the shell's CWD so commands like
// `markdowner README.md` open the file the user expects.
fn resolve_cli_path(raw: &str, cwd: Option<&Path>) -> PathBuf {
    let candidate = Path::new(raw);
    if candidate.is_absolute() {
        return candidate.to_path_buf();
    }
    let base = match cwd {
        Some(path) => Some(path.to_path_buf()),
        None => env::current_dir().ok(),
    };
    match base {
        Some(base) => base.join(candidate),
        None => candidate.to_path_buf(),
    }
}

fn with_backend<T>(
    state: State<'_, DesktopAppState>,
    operation: impl FnOnce(&mut DesktopBackend) -> Result<T, String>,
) -> Result<T, String> {
    let mut backend = state
        .0
        .lock()
        .map_err(|_| "Could not lock desktop backend state".to_string())?;
    operation(&mut backend)
}

fn with_backend_and_menu<T>(
    state: State<'_, DesktopAppState>,
    app_handle: AppHandle,
    operation: impl FnOnce(&mut DesktopBackend) -> Result<T, String>,
) -> Result<T, String> {
    let mut backend = state
        .0
        .lock()
        .map_err(|_| "Could not lock desktop backend state".to_string())?;
    let result = operation(&mut backend)?;
    sync_app_menu(&app_handle, &backend);
    Ok(result)
}

#[tauri::command]
fn bootstrap(state: State<'_, DesktopAppState>) -> Result<AppSnapshot, String> {
    with_backend(state, |backend| Ok(backend.snapshot()))
}

#[tauri::command]
fn new_document(
    state: State<'_, DesktopAppState>,
    app_handle: AppHandle,
) -> Result<AppSnapshot, String> {
    with_backend_and_menu(state, app_handle, DesktopBackend::new_document)
}

#[tauri::command]
fn open_document(
    path: String,
    state: State<'_, DesktopAppState>,
    app_handle: AppHandle,
) -> Result<AppSnapshot, String> {
    with_backend_and_menu(state, app_handle, |backend| {
        backend.open_document(Path::new(&path))
    })
}

#[tauri::command]
fn open_workspace(path: String, state: State<'_, DesktopAppState>) -> Result<AppSnapshot, String> {
    with_backend(state, |backend| backend.open_workspace(Path::new(&path)))
}

#[tauri::command]
fn open_workspace_document(
    path: String,
    state: State<'_, DesktopAppState>,
    app_handle: AppHandle,
) -> Result<AppSnapshot, String> {
    with_backend_and_menu(state, app_handle, |backend| {
        backend.open_workspace_document(Path::new(&path))
    })
}

#[tauri::command]
fn replace_active_document_source(
    source: String,
    state: State<'_, DesktopAppState>,
) -> Result<AppSnapshot, String> {
    with_backend(state, |backend| {
        backend.replace_active_document_source(source)
    })
}

#[tauri::command]
fn save_active_document(state: State<'_, DesktopAppState>) -> Result<AppSnapshot, String> {
    with_backend(state, DesktopBackend::save_active_document)
}

#[tauri::command]
fn save_active_document_as(
    path: String,
    state: State<'_, DesktopAppState>,
    app_handle: AppHandle,
) -> Result<AppSnapshot, String> {
    with_backend_and_menu(state, app_handle, |backend| {
        backend.save_active_document_as(Path::new(&path))
    })
}

#[tauri::command]
fn has_active_document_external_changes(state: State<'_, DesktopAppState>) -> Result<bool, String> {
    with_backend(state, DesktopBackend::has_active_document_external_changes)
}

#[tauri::command]
fn active_document_disk_source(state: State<'_, DesktopAppState>) -> Result<String, String> {
    with_backend(state, DesktopBackend::active_document_disk_source)
}

#[tauri::command]
fn set_mode(mode: EditorMode, state: State<'_, DesktopAppState>) -> Result<AppSnapshot, String> {
    with_backend(state, |backend| Ok(backend.set_mode(mode)))
}

#[tauri::command]
fn save_open_tabs(
    open_tabs: Vec<String>,
    active_tab_path: Option<String>,
    cursor_positions: Option<HashMap<String, CursorPosition>>,
    state: State<'_, DesktopAppState>,
) -> Result<(), String> {
    let cursors = cursor_positions.unwrap_or_default();
    with_backend(state, |backend| {
        backend.save_open_tabs(&open_tabs, active_tab_path.clone(), &cursors)
    })
}

#[tauri::command]
fn load_open_tabs(state: State<'_, DesktopAppState>) -> Result<OpenTabsPayload, String> {
    with_backend(state, |backend| backend.load_open_tabs())
}

#[tauri::command]
fn set_theme(
    theme_kind: ThemeKind,
    state: State<'_, DesktopAppState>,
) -> Result<AppSnapshot, String> {
    with_backend(state, |backend| Ok(backend.set_theme_kind(theme_kind)))
}

#[tauri::command]
fn import_theme(path: String, state: State<'_, DesktopAppState>) -> Result<AppSnapshot, String> {
    with_backend(state, |backend| backend.import_theme(Path::new(&path)))
}

#[tauri::command]
fn load_settings(
    app_handle: tauri::AppHandle,
) -> Result<markdowner_core::settings::Settings, String> {
    load_desktop_settings(&app_handle)
}

#[tauri::command]
fn save_settings(
    settings: markdowner_core::settings::Settings,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let previous = load_desktop_settings(&app_handle).unwrap_or_default();
    let path = settings_path(&app_handle)?;
    let diagnostics_dir = app_data_dir(&app_handle)?;

    if previous.diagnostics_enabled && !settings.diagnostics_enabled {
        diagnostics::write_diagnostics_event(
            &diagnostics_dir,
            "diagnostics.disabled",
            json!({ "source": "settings" }),
        )
        .map_err(|e| e.to_string())?;
    }

    let payload = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // Atomic write
    let temp_path = path.with_extension("tmp");
    std::fs::write(&temp_path, payload).map_err(|e| e.to_string())?;
    std::fs::rename(&temp_path, &path).map_err(|e| e.to_string())?;

    if settings.diagnostics_enabled {
        let event_name = if previous.diagnostics_enabled {
            "settings.saved"
        } else {
            "diagnostics.enabled"
        };
        diagnostics::write_diagnostics_event(
            &diagnostics_dir,
            event_name,
            json!({ "diagnosticsEnabled": true }),
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn diagnostics_status(
    app_handle: tauri::AppHandle,
) -> Result<diagnostics::DiagnosticsLogStatus, String> {
    let settings = load_desktop_settings(&app_handle)?;
    let diagnostics_dir = app_data_dir(&app_handle)?;
    Ok(diagnostics::diagnostics_status(
        &diagnostics_dir,
        settings.diagnostics_enabled,
    ))
}

#[tauri::command]
fn record_diagnostics_event(
    event_name: String,
    payload: Value,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let settings = load_desktop_settings(&app_handle)?;
    if !settings.diagnostics_enabled {
        return Ok(());
    }

    let diagnostics_dir = app_data_dir(&app_handle)?;
    diagnostics::write_diagnostics_event(&diagnostics_dir, &event_name, payload)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_dropped_path(
    path: String,
    state: State<'_, DesktopAppState>,
    app_handle: AppHandle,
) -> Result<AppSnapshot, String> {
    with_backend_and_menu(state, app_handle, |backend| {
        let path_obj = Path::new(&path);
        if path_obj.is_file() {
            backend.open_document(path_obj)
        } else if path_obj.is_dir() {
            backend.open_workspace(path_obj)
        } else {
            Err(format!("Path not found: {}", path_obj.display()))
        }
    })
}

#[tauri::command]
fn quit_app(app_handle: AppHandle) {
    app_handle.exit(0);
}

pub fn run() {
    // Capture the shell's working directory before Tauri initializes so
    // relative paths like `markdowner README.md` resolve against where the
    // user launched the command, not the app bundle.
    let startup_cwd = env::current_dir().ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                if argv.len() > 1 {
                    let cwd_path = Path::new(&cwd);
                    let cwd_arg = if cwd_path.as_os_str().is_empty() {
                        None
                    } else {
                        Some(cwd_path)
                    };
                    let resolved = resolve_cli_path(&argv[1], cwd_arg);
                    let state = app.state::<DesktopAppState>();
                    if let Ok(mut backend) = state.0.lock() {
                        let _ = open_startup_path(&mut backend, &resolved);
                        let _ = window.emit("markdowner://update-snapshot", backend.snapshot());
                    }
                }
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .on_menu_event(|app, event| {
            if let Some(command) = menu_command_from_id(event.id().as_ref()) {
                let _ = app.emit(MENU_COMMAND_EVENT, command);
            }
        })
        .setup(move |app| {
            let session_store = session_store_path(app.handle());
            let startup_mode = load_desktop_settings(app.handle())
                .map(|settings| settings.default_mode)
                .unwrap_or(EditorMode::Wysiwyg);
            let mut state = DesktopAppState::new(session_store.clone(), startup_mode);

            if let Ok(backend) = state.0.get_mut() {
                let has_persisted_session =
                    session_store.as_ref().is_some_and(|path| path.exists());

                if has_persisted_session {
                    let _ = backend.restore_session();
                }

                // Open CLI arguments if provided. Resolve relative paths
                // against the shell's working directory (captured before any
                // window setup), not the app bundle CWD.
                if let Ok(matches) = app.cli().matches() {
                    if let Some(arg_data) = matches.args.get("path") {
                        if let Some(val) = arg_data.value.as_str() {
                            let resolved = resolve_cli_path(val, startup_cwd.as_deref());
                            let _ = open_startup_path(backend, &resolved);
                        }
                    }
                }
            }

            let initial_recent_documents = state
                .0
                .lock()
                .map(|backend| backend.snapshot().recent_documents)
                .unwrap_or_default();
            let menu = build_app_menu(app.handle(), &initial_recent_documents)?;
            app.set_menu(menu)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            new_document,
            open_document,
            open_workspace,
            open_workspace_document,
            replace_active_document_source,
            save_active_document,
            save_active_document_as,
            has_active_document_external_changes,
            active_document_disk_source,
            set_mode,
            set_theme,
            import_theme,
            load_settings,
            save_settings,
            install_cli_launcher,
            cli_binary_status,
            install_cli_binary,
            uninstall_cli_binary,
            search_workspace,
            diagnostics_status,
            record_diagnostics_event,
            load_open_tabs,
            save_open_tabs,
            open_dropped_path,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Markdowner desktop shell");
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    use markdowner_core::ThemeKind;
    use tempfile::tempdir;

    use super::{
        CLI_BINARY_SCRIPT_TAG, DesktopBackend, FILE_MENU_COMMANDS, MENU_COMMAND_CLOSE_WINDOW,
        MENU_COMMAND_NEW_DOCUMENT, MENU_COMMAND_OPEN_DOCUMENT, MENU_COMMAND_OPEN_WORKSPACE,
        MENU_COMMAND_QUIT_APP, MENU_COMMAND_SAVE_ACTIVE_DOCUMENT,
        MENU_COMMAND_SAVE_ACTIVE_DOCUMENT_AS, MENU_COMMAND_SET_MODE_SPLITVIEW, MENU_EDIT_TITLE,
        MENU_FILE_TITLE, MENU_VIEW_TITLE, TopLevelMenuSection, VIEW_MENU_COMMANDS,
        cli_binary_install_is_ours, cli_binary_wrapper_script_for_target,
        cli_launcher_alias_command_for_path, install_cli_binary_at, install_cli_launcher_alias,
        menu_command_from_id, open_startup_path, resolve_cli_path, shell_config_path_for_shell,
        top_level_menu_sections, uninstall_cli_binary_at,
    };

    #[test]
    fn backend_snapshot_reflects_active_document_mode_and_theme() {
        let temp = tempdir().unwrap();
        let document_path = temp.path().join("foundation.md");
        fs::write(&document_path, "# Hello\n\nworld").unwrap();

        let mut backend = DesktopBackend::new(None);
        backend.open_document(&document_path).unwrap();
        backend.set_mode(markdowner_core::EditorMode::SplitView);
        backend.set_theme_kind(ThemeKind::BuiltInDark);

        let snapshot = backend.snapshot();

        assert_eq!(
            snapshot.active_document_path.as_deref(),
            Some(document_path.to_string_lossy().as_ref())
        );
        assert_eq!(
            snapshot.active_document_source.as_deref(),
            Some("# Hello\n\nworld")
        );
        assert_eq!(snapshot.mode, markdowner_core::EditorMode::SplitView);
        assert_eq!(snapshot.theme.kind(), ThemeKind::BuiltInDark);
    }

    #[test]
    fn cli_launcher_alias_command_quotes_the_app_executable_path() {
        let alias_command = cli_launcher_alias_command_for_path(Path::new(
            "/Applications/Markdowner.app/Contents/MacOS/markdowner-desktop",
        ));

        assert_eq!(
            alias_command,
            "alias markdowner=\"/Applications/Markdowner.app/Contents/MacOS/markdowner-desktop\""
        );
    }

    #[test]
    fn shell_config_path_defaults_to_zshrc_for_macos_shells() {
        let temp = tempdir().unwrap();

        assert_eq!(
            shell_config_path_for_shell(temp.path(), Some("/bin/zsh")),
            temp.path().join(".zshrc")
        );
        assert_eq!(
            shell_config_path_for_shell(temp.path(), Some("/bin/bash")),
            temp.path().join(".bashrc")
        );
        assert_eq!(
            shell_config_path_for_shell(temp.path(), None),
            temp.path().join(".zshrc")
        );
    }

    #[test]
    fn install_cli_launcher_alias_writes_a_managed_shell_block() {
        let temp = tempdir().unwrap();
        let shell_config_path = temp.path().join(".zshrc");
        fs::write(&shell_config_path, "export EDITOR=vim\n").unwrap();

        let result = install_cli_launcher_alias(
            &shell_config_path,
            "alias markdowner=\"/Applications/Markdowner.app/Contents/MacOS/markdowner-desktop\"",
        )
        .unwrap();

        assert!(!result.already_installed);
        assert_eq!(
            result.shell_config_path,
            shell_config_path.display().to_string()
        );

        let contents = fs::read_to_string(&shell_config_path).unwrap();
        assert!(contents.contains("# >>> markdowner CLI launcher >>>"));
        assert!(contents.contains(
            "alias markdowner=\"/Applications/Markdowner.app/Contents/MacOS/markdowner-desktop\""
        ));
        assert!(contents.contains("# <<< markdowner CLI launcher <<<"));
        assert!(contents.starts_with("export EDITOR=vim\n"));
    }

    #[test]
    fn install_cli_launcher_alias_is_idempotent() {
        let temp = tempdir().unwrap();
        let shell_config_path = temp.path().join(".zshrc");
        let alias_command =
            "alias markdowner=\"/Applications/Markdowner.app/Contents/MacOS/markdowner-desktop\"";

        install_cli_launcher_alias(&shell_config_path, alias_command).unwrap();
        let result = install_cli_launcher_alias(&shell_config_path, alias_command).unwrap();

        assert!(result.already_installed);
        let contents = fs::read_to_string(&shell_config_path).unwrap();
        assert_eq!(contents.matches(alias_command).count(), 1);
    }

    #[test]
    fn cli_binary_wrapper_script_execs_the_target_executable() {
        let script = cli_binary_wrapper_script_for_target(Path::new(
            "/Applications/Markdowner.app/Contents/MacOS/markdowner-desktop",
        ));

        assert!(script.starts_with("#!/bin/sh\n"));
        assert!(script.contains(CLI_BINARY_SCRIPT_TAG));
        assert!(script.contains(
            "exec \"/Applications/Markdowner.app/Contents/MacOS/markdowner-desktop\" \"$@\""
        ));
    }

    #[test]
    fn install_cli_binary_writes_wrapper_at_install_path() {
        let temp = tempdir().unwrap();
        let install_path = temp.path().join("mdner");
        let target = Path::new("/Applications/Markdowner.app/Contents/MacOS/markdowner-desktop");

        let result = install_cli_binary_at(&install_path, target).unwrap();

        assert!(!result.already_done);
        assert_eq!(result.install_path, install_path.display().to_string());
        let contents = fs::read_to_string(&install_path).unwrap();
        assert!(contents.contains(CLI_BINARY_SCRIPT_TAG));
        assert!(contents.contains("markdowner-desktop"));

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = fs::metadata(&install_path).unwrap().permissions();
            assert_eq!(perms.mode() & 0o777, 0o755);
        }
    }

    #[test]
    fn install_cli_binary_is_idempotent_when_script_unchanged() {
        let temp = tempdir().unwrap();
        let install_path = temp.path().join("mdner");
        let target = Path::new("/Applications/Markdowner.app/Contents/MacOS/markdowner-desktop");

        install_cli_binary_at(&install_path, target).unwrap();
        let result = install_cli_binary_at(&install_path, target).unwrap();

        assert!(result.already_done);
    }

    #[test]
    fn uninstall_cli_binary_removes_wrapper_owned_by_markdowner() {
        let temp = tempdir().unwrap();
        let install_path = temp.path().join("mdner");
        let target = Path::new("/Applications/Markdowner.app/Contents/MacOS/markdowner-desktop");

        install_cli_binary_at(&install_path, target).unwrap();
        assert!(cli_binary_install_is_ours(&install_path));

        let result = uninstall_cli_binary_at(&install_path, target).unwrap();
        assert!(!result.already_done);
        assert!(!install_path.exists());
    }

    #[test]
    fn uninstall_cli_binary_refuses_to_remove_foreign_files() {
        let temp = tempdir().unwrap();
        let install_path = temp.path().join("mdner");
        fs::write(&install_path, "#!/bin/sh\necho hello\n").unwrap();
        let target = Path::new("/Applications/Markdowner.app/Contents/MacOS/markdowner-desktop");

        let err = uninstall_cli_binary_at(&install_path, target).unwrap_err();
        assert!(err.contains("not installed by Markdowner"));
        assert!(install_path.exists());
    }

    #[test]
    fn uninstall_cli_binary_no_op_when_path_absent() {
        let temp = tempdir().unwrap();
        let install_path = temp.path().join("mdner-missing");
        let target = Path::new("/Applications/Markdowner.app/Contents/MacOS/markdowner-desktop");

        let result = uninstall_cli_binary_at(&install_path, target).unwrap();
        assert!(result.already_done);
    }

    #[test]
    fn backend_open_workspace_returns_sorted_markdown_files() {
        let temp = tempdir().unwrap();
        let workspace_path = temp.path().join("workspace");
        let nested_path = workspace_path.join("nested");
        let git_path = workspace_path.join(".git");
        let node_modules_path = workspace_path.join("node_modules");
        let dist_path = workspace_path.join("dist");
        fs::create_dir_all(&nested_path).unwrap();
        fs::create_dir_all(&git_path).unwrap();
        fs::create_dir_all(&node_modules_path).unwrap();
        fs::create_dir_all(&dist_path).unwrap();
        let a = workspace_path.join("a.md");
        let b = nested_path.join("b.markdown");
        let c = nested_path.join("c.mdown");
        let d = nested_path.join("d.MKD");
        let ignored = nested_path.join("notes.txt");
        let git_doc = git_path.join("config.md");
        let dependency_doc = node_modules_path.join("package.md");
        let build_doc = dist_path.join("bundle.md");
        fs::write(&a, "# A").unwrap();
        fs::write(&b, "# B").unwrap();
        fs::write(&c, "# C").unwrap();
        fs::write(&d, "# D").unwrap();
        fs::write(&ignored, "ignore me").unwrap();
        fs::write(&git_doc, "# hidden").unwrap();
        fs::write(&dependency_doc, "# dependency").unwrap();
        fs::write(&build_doc, "# build").unwrap();

        let mut backend = DesktopBackend::new(None);
        backend.open_workspace(&workspace_path).unwrap();

        let snapshot = backend.snapshot();
        assert_eq!(
            snapshot.workspace_documents,
            vec![
                a.to_string_lossy().into_owned(),
                b.to_string_lossy().into_owned(),
                c.to_string_lossy().into_owned(),
                d.to_string_lossy().into_owned()
            ]
        );
    }

    #[test]
    fn backend_save_as_retargets_the_snapshot_to_the_new_path() {
        let temp = tempdir().unwrap();
        let original_path = temp.path().join("notes.md");
        let copied_path = temp.path().join("archive").join("notes-copy.md");
        fs::write(&original_path, "# Notes\n\nOriginal").unwrap();

        let mut backend = DesktopBackend::new(None);
        backend.open_document(&original_path).unwrap();
        backend
            .replace_active_document_source("# Notes\n\nCopied")
            .unwrap();
        let snapshot = backend.save_active_document_as(&copied_path).unwrap();

        assert_eq!(
            snapshot.active_document_path.as_deref(),
            Some(copied_path.to_string_lossy().as_ref())
        );
        assert_eq!(
            snapshot.recent_documents,
            vec![
                copied_path.to_string_lossy().into_owned(),
                original_path.to_string_lossy().into_owned(),
            ]
        );
        assert_eq!(
            fs::read_to_string(&copied_path).unwrap(),
            "# Notes\n\nCopied"
        );
        assert_eq!(
            fs::read_to_string(&original_path).unwrap(),
            "# Notes\n\nOriginal"
        );
    }

    #[test]
    fn backend_new_document_snapshot_exposes_an_untitled_draft_without_a_path() {
        let mut backend = DesktopBackend::new(None);

        let snapshot = backend.new_document().unwrap();

        assert_eq!(snapshot.active_document_path, None);
        assert_eq!(
            snapshot.active_document_name.as_deref(),
            Some("Untitled.md")
        );
        assert_eq!(snapshot.active_document_source.as_deref(), Some(""));
        assert!(snapshot.active_document_dirty);
        assert!(snapshot.recent_documents.is_empty());
    }

    #[test]
    fn backend_can_seed_startup_mode_before_any_session_restore() {
        let backend = DesktopBackend::new_with_mode(None, markdowner_core::EditorMode::Editor);

        assert_eq!(backend.snapshot().mode, markdowner_core::EditorMode::Editor);
    }

    #[test]
    fn configured_startup_mode_survives_session_restore() {
        let temp = tempdir().unwrap();
        let session_path = temp.path().join("workspace-session.json");
        fs::write(
            &session_path,
            r#"{
  "recent_documents": [],
  "mode": "SplitView",
  "theme": {
    "kind": "BuiltInLight",
    "stylesheet": null,
    "stylesheet_path": null
  }
}"#,
        )
        .unwrap();

        let mut backend =
            DesktopBackend::new_with_mode(Some(session_path), markdowner_core::EditorMode::Editor);
        backend.restore_session().unwrap();

        assert_eq!(backend.snapshot().mode, markdowner_core::EditorMode::Editor);
    }

    #[test]
    fn app_menu_descriptors_cover_file_and_view_commands() {
        assert_eq!(MENU_FILE_TITLE, "File");
        assert_eq!(MENU_EDIT_TITLE, "Edit");
        assert_eq!(MENU_VIEW_TITLE, "View");
        assert_eq!(
            FILE_MENU_COMMANDS
                .iter()
                .map(|descriptor| descriptor.id)
                .collect::<Vec<_>>(),
            vec![
                MENU_COMMAND_NEW_DOCUMENT,
                MENU_COMMAND_OPEN_DOCUMENT,
                MENU_COMMAND_OPEN_WORKSPACE,
                MENU_COMMAND_SAVE_ACTIVE_DOCUMENT,
                MENU_COMMAND_SAVE_ACTIVE_DOCUMENT_AS,
                MENU_COMMAND_CLOSE_WINDOW,
                MENU_COMMAND_QUIT_APP,
            ]
        );
        assert_eq!(
            VIEW_MENU_COMMANDS
                .iter()
                .map(|descriptor| descriptor.id)
                .collect::<Vec<_>>(),
            vec![
                super::MENU_COMMAND_SET_MODE_WYSIWYG,
                super::MENU_COMMAND_SET_MODE_EDITOR,
                MENU_COMMAND_SET_MODE_SPLITVIEW,
            ]
        );
        assert_eq!(
            VIEW_MENU_COMMANDS
                .iter()
                .map(|descriptor| descriptor.accelerator)
                .collect::<Vec<_>>(),
            vec![None, None, None]
        );
        assert_eq!(
            VIEW_MENU_COMMANDS
                .iter()
                .map(|descriptor| descriptor.label)
                .collect::<Vec<_>>(),
            vec![
                "WYSIWYG (⌥1 · ⌘K ⌘W)",
                "Editor (⌥2 · ⌘K ⌘E)",
                "Split-view (⌥3 · ⌘K ⌘S)",
            ]
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn app_menu_keeps_file_as_a_top_level_menu_on_macos() {
        assert_eq!(
            top_level_menu_sections(),
            &[
                TopLevelMenuSection::NativeApp,
                TopLevelMenuSection::File,
                TopLevelMenuSection::Edit,
                TopLevelMenuSection::View,
            ]
        );
    }

    #[test]
    fn backend_reads_active_document_disk_source_for_compare() {
        let temp = tempdir().unwrap();
        let original_path = temp.path().join("notes.md");
        fs::write(&original_path, "# Initial\n").unwrap();

        let mut backend = DesktopBackend::new(None);
        backend.open_document(&original_path).unwrap();
        backend
            .replace_active_document_source("# Initial\nEdited by app")
            .unwrap();

        fs::write(&original_path, "# External update\n").unwrap();

        let disk_source = backend.active_document_disk_source().unwrap();
        assert_eq!(disk_source, "# External update\n");
    }

    #[test]
    fn menu_command_mapping_only_accepts_supported_command_ids() {
        assert_eq!(
            menu_command_from_id(MENU_COMMAND_SET_MODE_SPLITVIEW),
            Some(MENU_COMMAND_SET_MODE_SPLITVIEW.to_string())
        );
        assert_eq!(
            menu_command_from_id(MENU_COMMAND_CLOSE_WINDOW),
            Some(MENU_COMMAND_CLOSE_WINDOW.to_string())
        );
        assert_eq!(
            menu_command_from_id(MENU_COMMAND_QUIT_APP),
            Some(MENU_COMMAND_QUIT_APP.to_string())
        );
        assert_eq!(menu_command_from_id("unknown-command"), None);
    }

    #[test]
    fn menu_command_mapping_accepts_open_recent_document_prefix() {
        let recent_command = "open-recent-document:/tmp/project/meeting-notes.md";

        assert_eq!(
            menu_command_from_id(recent_command),
            Some(recent_command.to_string())
        );
    }

    #[test]
    fn save_open_tabs_persists_tabs_into_session_file() {
        use markdowner_core::storage_test_helpers::load_workspace_session;

        let temp = tempdir().unwrap();
        let session_path = temp.path().join("workspace-session.json");
        let backend = DesktopBackend::new(Some(session_path.clone()));

        backend
            .save_open_tabs(
                &["/tmp/a.md".to_string(), "/tmp/b.md".to_string()],
                Some("/tmp/b.md".to_string()),
                &HashMap::new(),
            )
            .expect("save_open_tabs ok");

        let loaded = load_workspace_session(&session_path).expect("loaded");
        assert_eq!(
            loaded.open_tabs,
            vec![
                std::path::PathBuf::from("/tmp/a.md"),
                std::path::PathBuf::from("/tmp/b.md"),
            ],
        );
        assert_eq!(
            loaded.active_tab_path,
            Some(std::path::PathBuf::from("/tmp/b.md")),
        );
    }

    #[test]
    fn load_open_tabs_returns_persisted_tabs() {
        let temp = tempdir().unwrap();
        let session_path = temp.path().join("workspace-session.json");
        let backend = DesktopBackend::new(Some(session_path.clone()));

        backend
            .save_open_tabs(
                &["/tmp/x.md".to_string(), "/tmp/y.md".to_string()],
                Some("/tmp/x.md".to_string()),
                &HashMap::new(),
            )
            .expect("save ok");

        let payload = backend.load_open_tabs().expect("load ok");
        assert_eq!(
            payload.open_tabs,
            vec!["/tmp/x.md".to_string(), "/tmp/y.md".to_string()],
        );
        assert_eq!(payload.active_tab_path, Some("/tmp/x.md".to_string()));
    }

    #[test]
    fn startup_file_open_persists_active_tab_for_frontend_restore() {
        let temp = tempdir().unwrap();
        let session_path = temp.path().join("workspace-session.json");
        let document_path = temp.path().join("launched.md");
        fs::write(&document_path, "# Launched\n\nOpened from the shell.").unwrap();
        let mut backend = DesktopBackend::new(Some(session_path));

        open_startup_path(&mut backend, &document_path).unwrap();

        let snapshot = backend.snapshot();
        assert_eq!(
            snapshot.active_document_path.as_deref(),
            Some(document_path.to_string_lossy().as_ref())
        );
        assert_eq!(
            snapshot.active_document_source.as_deref(),
            Some("# Launched\n\nOpened from the shell.")
        );

        let payload = backend.load_open_tabs().unwrap();
        assert_eq!(
            payload.open_tabs,
            vec![document_path.to_string_lossy().into_owned()]
        );
        assert_eq!(
            payload.active_tab_path,
            Some(document_path.to_string_lossy().into_owned())
        );
    }

    #[test]
    fn empty_tab_save_does_not_clobber_startup_active_document() {
        let temp = tempdir().unwrap();
        let session_path = temp.path().join("workspace-session.json");
        let document_path = temp.path().join("startup-race.md");
        fs::write(&document_path, "# Startup race").unwrap();
        let mut backend = DesktopBackend::new(Some(session_path));
        open_startup_path(&mut backend, &document_path).unwrap();

        backend.save_open_tabs(&[], None, &HashMap::new()).unwrap();

        let payload = backend.load_open_tabs().unwrap();
        assert_eq!(
            payload.open_tabs,
            vec![document_path.to_string_lossy().into_owned()]
        );
        assert_eq!(
            payload.active_tab_path,
            Some(document_path.to_string_lossy().into_owned())
        );
    }

    #[test]
    fn load_open_tabs_returns_default_when_no_session_store_configured() {
        let backend = DesktopBackend::new(None);
        let payload = backend.load_open_tabs().expect("load ok");
        assert!(payload.open_tabs.is_empty());
        assert!(payload.active_tab_path.is_none());
    }

    #[test]
    fn resolve_cli_path_anchors_relative_paths_to_the_provided_cwd() {
        let temp = tempdir().unwrap();
        let cwd = temp.path();

        let resolved = resolve_cli_path("README.md", Some(cwd));

        assert_eq!(resolved, cwd.join("README.md"));
    }

    #[test]
    fn resolve_cli_path_preserves_absolute_paths_regardless_of_cwd() {
        let temp = tempdir().unwrap();
        let absolute = temp.path().join("notes.md");

        let resolved = resolve_cli_path(absolute.to_str().unwrap(), Some(Path::new("/tmp/ignored")));

        assert_eq!(resolved, absolute);
    }
}
