use std::{
    collections::{HashMap, HashSet},
    ffi::OsString,
    fmt,
    ops::Deref,
    path::PathBuf,
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, Instant as StdInstant},
};

use markdowner_core::ai_document::{
    AiDocumentEnvelope, ByteRange, SelectionResponse, ValidationError, ValidationIssueCode,
    validate_full_replacement, validate_markdown_insertion, validate_selection_response,
};
use markdowner_core::settings::LocalAgentExecutablePaths;
use serde::{Deserialize, Serialize, Serializer, ser::SerializeStruct};
use tauri::{State, WebviewWindow, ipc::Channel};
use tokio::{sync::Notify, time::Instant};
use tokio_util::sync::CancellationToken;

use self::{
    adapters::{LocalAgentPayload, build_invocation, parse_adapter_result},
    process::{
        MAX_PROCESS_STDIN_BYTES, OwnedProcessInvocation, create_owned_temp_dir, run_process,
    },
};

pub mod adapters;
mod discovery;
mod process;

pub fn discover_all() -> Vec<LocalAgentStatus> {
    discovery::discover_all()
}

pub fn discover_all_with_paths(
    executable_paths: &LocalAgentExecutablePaths,
) -> Vec<LocalAgentStatus> {
    discovery::discover_all_with_paths(executable_paths)
}

pub fn resolve_compatible_agent(kind: LocalAgentKind) -> Result<ResolvedAgent, LocalAgentError> {
    discovery::resolve_compatible_agent(kind)
}

pub(crate) fn login_shell_path_value() -> Option<OsString> {
    discovery::login_shell_path_value()
}

pub(super) const OPEN_CODE_OWNED_AGENT: &str = "markdowner";

const OPEN_CODE_CONFIG_CONTENT: &str = r#"{"share":"disabled","default_agent":"markdowner","tools":{"*":false,"edit":false},"permission":{"*":"deny","read":"deny","edit":"deny","glob":"deny","grep":"deny","list":"deny","bash":"deny","task":"deny","skill":"deny","lsp":"deny","question":"deny","webfetch":"deny","websearch":"deny","external_directory":"deny","todowrite":"deny","doom_loop":"deny"},"agent":{"markdowner":{"mode":"primary","tools":{"*":false,"edit":false},"permission":{"*":"deny","read":"deny","edit":"deny","glob":"deny","grep":"deny","list":"deny","bash":"deny","task":"deny","skill":"deny","lsp":"deny","question":"deny","webfetch":"deny","websearch":"deny","external_directory":"deny","todowrite":"deny","doom_loop":"deny"}}}}"#;

pub const MAX_SOURCE_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_INSTRUCTION_BYTES: usize = 16 * 1024;
pub const MAX_ID_BYTES: usize = 256;
const MAX_PROTECTED_TOKENS: usize = 32 * 1024;
const PREPARED_PROMPT_OVERHEAD_BYTES: usize = 4 * 1024;
const LOCAL_AGENT_TIMEOUT: Duration = Duration::from_secs(5 * 60);

pub(super) fn owned_opencode_environment() -> Vec<(OsString, OsString)> {
    vec![
        (
            OsString::from("OPENCODE_CONFIG_CONTENT"),
            OsString::from(OPEN_CODE_CONFIG_CONTENT),
        ),
        (
            OsString::from("OPENCODE_DISABLE_AUTOUPDATE"),
            OsString::from("true"),
        ),
    ]
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalAgentKind {
    Claude,
    Codex,
    Opencode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalAgentTargetKind {
    Insert,
    Selection,
    Document,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalAgentStatusSource {
    Manual,
    Automatic,
}

impl LocalAgentTargetKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Insert => "insert",
            Self::Selection => "selection",
            Self::Document => "document",
        }
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAgentRunRequest {
    pub request_id: String,
    pub document_id: String,
    pub agent: LocalAgentKind,
    pub target: LocalAgentTargetKind,
    pub source: String,
    pub selection: Option<ByteRange>,
    pub cursor: Option<usize>,
    pub instruction: String,
    pub executable_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InsertDocumentContext<'a> {
    document_id: &'a str,
    source: &'a str,
    cursor: Option<usize>,
}

impl fmt::Debug for LocalAgentRunRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("LocalAgentRunRequest")
            .field("agent", &self.agent)
            .field("target", &self.target)
            .field("source_bytes", &self.source.len())
            .field("instruction_bytes", &self.instruction.len())
            .field("has_selection", &self.selection.is_some())
            .field("has_cursor", &self.cursor.is_some())
            .field("has_executable_path", &self.executable_path.is_some())
            .finish_non_exhaustive()
    }
}

impl LocalAgentKind {
    pub const ALL: [Self; 3] = [Self::Claude, Self::Codex, Self::Opencode];

    pub const fn executable_basename(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Opencode => "opencode",
        }
    }

    pub const fn mention(self) -> &'static str {
        match self {
            Self::Claude => "@claude",
            Self::Codex => "@codex",
            Self::Opencode => "@opencode",
        }
    }

    pub const fn label(self) -> &'static str {
        match self {
            Self::Claude => "Claude Code",
            Self::Codex => "Codex",
            Self::Opencode => "OpenCode",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAgentStatus {
    pub kind: LocalAgentKind,
    pub mention: &'static str,
    pub label: &'static str,
    pub installed: bool,
    pub compatible: bool,
    pub path_label: Option<String>,
    pub version: Option<String>,
    pub reason: Option<String>,
    pub source: Option<LocalAgentStatusSource>,
}

#[derive(Clone, PartialEq, Eq)]
pub struct ResolvedAgent {
    pub kind: LocalAgentKind,
    pub path: PathBuf,
    pub path_label: String,
}

impl fmt::Debug for ResolvedAgent {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ResolvedAgent")
            .field("kind", &self.kind)
            .field("path_label", &self.path_label)
            .finish_non_exhaustive()
    }
}

#[derive(Clone, PartialEq, Eq)]
pub enum LocalAgentError {
    NotInstalled,
    ProbeSpawnFailed,
    ProbeTimedOut,
    ProbeOutputTooLarge,
    MalformedProbeOutput,
    ProbeFailed,
    Incompatible(&'static str),
    InvalidAdapterRequest,
    AdapterSetupFailed,
    InvalidAdapterResult,
    Run(LocalAgentErrorFields),
}

impl LocalAgentError {
    pub fn run(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::Run(LocalAgentErrorFields {
            code: code.into(),
            message: message.into(),
        })
    }

    pub fn reason(&self) -> &str {
        match self {
            Self::NotInstalled => "Executable was not found in PATH.",
            Self::ProbeSpawnFailed => "Capability probe could not start.",
            Self::ProbeTimedOut => discovery::CAPABILITY_PROBE_TIMEOUT_REASON,
            Self::ProbeOutputTooLarge => "Capability probe output exceeded the safe limit.",
            Self::MalformedProbeOutput => "Capability probe returned malformed output.",
            Self::ProbeFailed => "Capability probe failed.",
            Self::Incompatible(reason) => reason,
            Self::InvalidAdapterRequest => "The local agent request is invalid.",
            Self::AdapterSetupFailed => "The local agent could not be prepared.",
            Self::InvalidAdapterResult => "The agent returned an invalid result.",
            Self::Run(fields) => &fields.message,
        }
    }

    fn code_value(&self) -> &str {
        match self {
            Self::NotInstalled => "agent_not_installed",
            Self::ProbeSpawnFailed => "capability_probe_failed",
            Self::ProbeTimedOut => "capability_probe_timeout",
            Self::ProbeOutputTooLarge => "capability_probe_output_too_large",
            Self::MalformedProbeOutput => "capability_probe_invalid",
            Self::ProbeFailed => "capability_probe_failed",
            Self::Incompatible(_) => "agent_incompatible",
            Self::InvalidAdapterRequest => "invalid_adapter_request",
            Self::AdapterSetupFailed => "adapter_setup_failed",
            Self::InvalidAdapterResult => "invalid_agent_result",
            Self::Run(fields) => &fields.code,
        }
    }

    fn legacy_fields(&self) -> &'static LocalAgentErrorFields {
        static NOT_INSTALLED: OnceLock<LocalAgentErrorFields> = OnceLock::new();
        static PROBE_SPAWN: OnceLock<LocalAgentErrorFields> = OnceLock::new();
        static PROBE_TIMEOUT: OnceLock<LocalAgentErrorFields> = OnceLock::new();
        static PROBE_LARGE: OnceLock<LocalAgentErrorFields> = OnceLock::new();
        static PROBE_MALFORMED: OnceLock<LocalAgentErrorFields> = OnceLock::new();
        static PROBE_FAILED: OnceLock<LocalAgentErrorFields> = OnceLock::new();
        static INCOMPATIBLE: OnceLock<LocalAgentErrorFields> = OnceLock::new();
        static INVALID_REQUEST: OnceLock<LocalAgentErrorFields> = OnceLock::new();
        static SETUP_FAILED: OnceLock<LocalAgentErrorFields> = OnceLock::new();
        static INVALID_RESULT: OnceLock<LocalAgentErrorFields> = OnceLock::new();
        let (cell, code, message) = match self {
            Self::NotInstalled => (
                &NOT_INSTALLED,
                "agent_not_installed",
                "Executable was not found in PATH.",
            ),
            Self::ProbeSpawnFailed => (
                &PROBE_SPAWN,
                "capability_probe_failed",
                "Capability probe could not start.",
            ),
            Self::ProbeTimedOut => (
                &PROBE_TIMEOUT,
                "capability_probe_timeout",
                discovery::CAPABILITY_PROBE_TIMEOUT_REASON,
            ),
            Self::ProbeOutputTooLarge => (
                &PROBE_LARGE,
                "capability_probe_output_too_large",
                "Capability probe output exceeded the safe limit.",
            ),
            Self::MalformedProbeOutput => (
                &PROBE_MALFORMED,
                "capability_probe_invalid",
                "Capability probe returned malformed output.",
            ),
            Self::ProbeFailed => (
                &PROBE_FAILED,
                "capability_probe_failed",
                "Capability probe failed.",
            ),
            Self::Incompatible(_) => (
                &INCOMPATIBLE,
                "agent_incompatible",
                "The local agent is incompatible.",
            ),
            Self::InvalidAdapterRequest => (
                &INVALID_REQUEST,
                "invalid_adapter_request",
                "The local agent request is invalid.",
            ),
            Self::AdapterSetupFailed => (
                &SETUP_FAILED,
                "adapter_setup_failed",
                "The local agent could not be prepared.",
            ),
            Self::InvalidAdapterResult => (
                &INVALID_RESULT,
                "invalid_agent_result",
                "The agent returned an invalid result.",
            ),
            Self::Run(_) => unreachable!("run errors own their fields"),
        };
        cell.get_or_init(|| LocalAgentErrorFields {
            code: code.to_string(),
            message: message.to_string(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalAgentErrorFields {
    pub code: String,
    pub message: String,
}

impl Deref for LocalAgentError {
    type Target = LocalAgentErrorFields;

    fn deref(&self) -> &Self::Target {
        match self {
            Self::Run(fields) => fields,
            _ => self.legacy_fields(),
        }
    }
}

impl fmt::Debug for LocalAgentError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("LocalAgentError")
            .field("code", &self.code_value())
            .field("message", &self.reason())
            .finish()
    }
}

impl Serialize for LocalAgentError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("LocalAgentError", 2)?;
        state.serialize_field("code", self.code_value())?;
        state.serialize_field("message", self.reason())?;
        state.end()
    }
}

impl fmt::Display for LocalAgentError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.reason())
    }
}

impl std::error::Error for LocalAgentError {}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAgentRunResult {
    pub schema_version: u8,
    pub request_id: String,
    pub document_id: String,
    pub agent: LocalAgentKind,
    pub target: LocalAgentTargetKind,
    pub markdown: String,
    pub summary: String,
    pub warnings: Vec<String>,
}

impl fmt::Debug for LocalAgentRunResult {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("LocalAgentRunResult")
            .field("schema_version", &self.schema_version)
            .field("agent", &self.agent)
            .field("target", &self.target)
            .field("markdown_bytes", &self.markdown.len())
            .field("summary_bytes", &self.summary.len())
            .field("warning_count", &self.warnings.len())
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum LocalAgentStreamEvent {
    Starting {
        request_id: String,
    },
    Running {
        request_id: String,
    },
    Validating {
        request_id: String,
    },
    Completed {
        request_id: String,
    },
    Failed {
        request_id: String,
        code: String,
        message: String,
    },
    Cancelled {
        request_id: String,
    },
}

#[derive(Clone, Default)]
pub struct LocalAgentState {
    active: Arc<Mutex<HashMap<String, ActiveLocalAgentRun>>>,
    used_request_ids: Arc<Mutex<HashSet<String>>>,
    next_generation: Arc<AtomicU64>,
    idle: Arc<Notify>,
    pending_terminal_deliveries: Arc<AtomicU64>,
    shutdown_started: Arc<AtomicBool>,
}

#[derive(Clone)]
struct ActiveLocalAgentRun {
    request_id: String,
    generation: u64,
    cancellation: CancellationToken,
    phase: ActiveRunPhase,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ActiveRunPhase {
    Running,
    PostProcessing,
    Cancelling,
    Terminal,
    TerminalDelivered,
}

pub struct ActiveLocalAgentRunGuard {
    state: LocalAgentState,
    window_label: String,
    request_id: String,
    generation: u64,
    cancellation: CancellationToken,
}

struct TerminalClaim {
    state: LocalAgentState,
    window_label: String,
    request_id: String,
    generation: u64,
    outcome_won: bool,
}

impl TerminalClaim {
    fn outcome_won(&self) -> bool {
        self.outcome_won
    }

    fn mark_delivered(&self) -> bool {
        let Ok(mut active) = self.state.active.lock() else {
            return false;
        };
        let Some(run) = active.get_mut(&self.window_label) else {
            return false;
        };
        if run.request_id != self.request_id
            || run.generation != self.generation
            || run.phase != ActiveRunPhase::Terminal
        {
            return false;
        }
        run.phase = ActiveRunPhase::TerminalDelivered;
        true
    }
}

impl Drop for TerminalClaim {
    fn drop(&mut self) {
        let previous = self
            .state
            .pending_terminal_deliveries
            .fetch_sub(1, Ordering::AcqRel);
        debug_assert!(previous > 0, "terminal delivery counter underflowed");
        if previous == 1 && self.state.is_idle() {
            self.state.idle.notify_waiters();
        }
    }
}

impl fmt::Debug for ActiveLocalAgentRunGuard {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ActiveLocalAgentRunGuard")
            .field("generation", &self.generation)
            .finish_non_exhaustive()
    }
}

impl ActiveLocalAgentRunGuard {
    pub fn cancellation_token(&self) -> CancellationToken {
        self.cancellation.clone()
    }

    #[cfg(test)]
    fn generation(&self) -> u64 {
        self.generation
    }
}

impl Drop for ActiveLocalAgentRunGuard {
    fn drop(&mut self) {
        // An aborted invoke can drop this guard while a blocking discovery or
        // process task still owns a token clone. Signal it before making the
        // per-window slot available to a replacement generation.
        self.cancellation.cancel();
        self.state
            .cleanup(&self.window_label, &self.request_id, self.generation);
    }
}

impl LocalAgentState {
    pub fn begin(
        &self,
        window_label: &str,
        request_id: &str,
    ) -> Result<ActiveLocalAgentRunGuard, LocalAgentError> {
        let mut used_request_ids = self
            .used_request_ids
            .lock()
            .map_err(|_| scheduler_error())?;
        if used_request_ids.contains(request_id) {
            return Err(LocalAgentError::run(
                "duplicate_request_id",
                "This local agent request ID was already used.",
            ));
        }
        let mut active = self.active.lock().map_err(|_| scheduler_error())?;
        if self.shutdown_started.load(Ordering::Acquire) {
            return Err(LocalAgentError::run(
                "local_agent_shutting_down",
                "Markdowner is shutting down and cannot start another local agent request.",
            ));
        }
        if active
            .get(window_label)
            .is_some_and(|run| run.phase != ActiveRunPhase::TerminalDelivered)
        {
            return Err(LocalAgentError::run(
                "local_agent_busy",
                "This window already has a local agent request in progress.",
            ));
        }
        let generation = self
            .next_generation
            .fetch_add(1, Ordering::Relaxed)
            .wrapping_add(1);
        let cancellation = CancellationToken::new();
        // Only accepted runs own cancellable identities. Keep their IDs for the
        // app lifetime so a delayed cancel can never alias a later generation.
        used_request_ids.insert(request_id.to_string());
        active.insert(
            window_label.to_string(),
            ActiveLocalAgentRun {
                request_id: request_id.to_string(),
                generation,
                cancellation: cancellation.clone(),
                phase: ActiveRunPhase::Running,
            },
        );
        Ok(ActiveLocalAgentRunGuard {
            state: self.clone(),
            window_label: window_label.to_string(),
            request_id: request_id.to_string(),
            generation,
            cancellation,
        })
    }

    pub fn cancel(&self, window_label: &str, request_id: &str) -> bool {
        let cancellation = {
            let Ok(mut active) = self.active.lock() else {
                return false;
            };
            let Some(run) = active.get_mut(window_label) else {
                return false;
            };
            if run.request_id != request_id
                || !matches!(
                    run.phase,
                    ActiveRunPhase::Running | ActiveRunPhase::PostProcessing
                )
            {
                return false;
            }
            run.phase = ActiveRunPhase::Cancelling;
            run.cancellation.clone()
        };
        cancellation.cancel();
        true
    }

    pub fn cancel_window(&self, window_label: &str) -> bool {
        let cancellation = {
            let Ok(mut active) = self.active.lock() else {
                return false;
            };
            let Some(run) = active.get_mut(window_label) else {
                return false;
            };
            if !matches!(
                run.phase,
                ActiveRunPhase::Running | ActiveRunPhase::PostProcessing
            ) {
                return false;
            }
            run.phase = ActiveRunPhase::Cancelling;
            run.cancellation.clone()
        };
        cancellation.cancel();
        true
    }

    pub fn cancel_all(&self) {
        self.cancel_registered_runs(false);
        process::terminate_all_process_groups();
    }

    pub fn begin_shutdown(&self) {
        self.begin_shutdown_with(|| {
            process::begin_process_shutdown();
            process::terminate_all_process_groups();
        });
    }

    fn begin_shutdown_with(&self, shutdown_processes: impl FnOnce()) {
        // Cancellation must linearize under the registry mutex before a killed
        // process can surface a failure or enter post-processing.
        self.cancel_registered_runs(true);
        shutdown_processes();
    }

    fn cancel_registered_runs(&self, begin_shutdown: bool) {
        let cancellations = {
            let Ok(mut active) = self.active.lock() else {
                if begin_shutdown {
                    self.shutdown_started.store(true, Ordering::Release);
                }
                return;
            };
            if begin_shutdown {
                self.shutdown_started.store(true, Ordering::Release);
            }
            active
                .values_mut()
                .filter_map(|run| {
                    if matches!(
                        run.phase,
                        ActiveRunPhase::Running | ActiveRunPhase::PostProcessing
                    ) {
                        run.phase = ActiveRunPhase::Cancelling;
                        Some(run.cancellation.clone())
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
        };
        for cancellation in cancellations {
            cancellation.cancel();
        }
    }

    fn begin_post_processing(&self, window_label: &str, request_id: &str, generation: u64) -> bool {
        let Ok(mut active) = self.active.lock() else {
            return false;
        };
        let Some(run) = active.get_mut(window_label) else {
            return false;
        };
        if run.request_id != request_id
            || run.generation != generation
            || run.phase != ActiveRunPhase::Running
        {
            return false;
        }
        run.phase = ActiveRunPhase::PostProcessing;
        true
    }

    fn send_nonterminal(
        &self,
        window_label: &str,
        request_id: &str,
        generation: u64,
        required_phase: ActiveRunPhase,
        channel: &Channel<LocalAgentStreamEvent>,
        event: LocalAgentStreamEvent,
    ) -> Result<(), LocalAgentError> {
        let mut active = self.active.lock().map_err(|_| scheduler_error())?;
        let run = active.get_mut(window_label).ok_or_else(cancelled_error)?;
        if run.request_id != request_id
            || run.generation != generation
            || run.phase != required_phase
        {
            return Err(cancelled_error());
        }
        // Keep the phase mutex through enqueueing so either this event is
        // ordered before cancellation, or cancellation wins and suppresses it.
        if channel.send(event).is_err() {
            run.cancellation.cancel();
            return Err(LocalAgentError::run(
                "local_agent_channel_closed",
                "The local agent event channel is unavailable.",
            ));
        }
        Ok(())
    }

    /// Claims terminal delivery under the same mutex used by cancellation.
    /// The returned guard records whether the original outcome won and keeps
    /// shutdown non-idle until the terminal event has been enqueued.
    fn enter_terminal(
        &self,
        window_label: &str,
        request_id: &str,
        generation: u64,
    ) -> Option<TerminalClaim> {
        let Ok(mut active) = self.active.lock() else {
            return None;
        };
        let run = active.get_mut(window_label)?;
        if run.request_id != request_id || run.generation != generation {
            return None;
        }
        let outcome_won = match run.phase {
            ActiveRunPhase::Running | ActiveRunPhase::PostProcessing => true,
            ActiveRunPhase::Cancelling => false,
            ActiveRunPhase::Terminal | ActiveRunPhase::TerminalDelivered => return None,
        };
        // Keep the slot blocked until the caller has enqueued the terminal
        // event. The delivered phase then permits an event-triggered follow-up
        // while the delivery counter keeps shutdown non-idle until this claim
        // and the run guard are both released.
        run.phase = ActiveRunPhase::Terminal;
        self.pending_terminal_deliveries
            .fetch_add(1, Ordering::AcqRel);
        Some(TerminalClaim {
            state: self.clone(),
            window_label: window_label.to_string(),
            request_id: request_id.to_string(),
            generation,
            outcome_won,
        })
    }

    pub async fn wait_for_idle(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            let notified = self.idle.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.is_idle() {
                return true;
            }
            if tokio::time::timeout_at(deadline, notified).await.is_err() {
                return self.is_idle();
            }
        }
    }

    pub async fn wait_for_shutdown_idle(&self, timeout: Duration) -> bool {
        let (runs_idle, process_groups_idle) = tokio::join!(
            self.wait_for_idle(timeout),
            process::wait_for_process_groups_idle(timeout),
        );
        runs_idle && process_groups_idle
    }

    fn is_idle(&self) -> bool {
        self.active
            .lock()
            .map(|active| {
                active.is_empty() && self.pending_terminal_deliveries.load(Ordering::Acquire) == 0
            })
            .unwrap_or(false)
    }

    #[cfg(test)]
    fn finish(&self, window_label: &str, request_id: &str, generation: u64) -> bool {
        let Ok(mut active) = self.active.lock() else {
            return false;
        };
        let matches = active.get(window_label).is_some_and(|run| {
            run.request_id == request_id
                && run.generation == generation
                && run.phase == ActiveRunPhase::Running
        });
        if matches {
            active.remove(window_label);
        }
        let became_idle = matches
            && active.is_empty()
            && self.pending_terminal_deliveries.load(Ordering::Acquire) == 0;
        drop(active);
        if became_idle {
            self.idle.notify_waiters();
        }
        matches
    }

    fn cleanup(&self, window_label: &str, request_id: &str, generation: u64) {
        let Ok(mut active) = self.active.lock() else {
            return;
        };
        let removed = if active
            .get(window_label)
            .is_some_and(|run| run.request_id == request_id && run.generation == generation)
        {
            active.remove(window_label);
            true
        } else {
            false
        };
        let became_idle = removed
            && active.is_empty()
            && self.pending_terminal_deliveries.load(Ordering::Acquire) == 0;
        drop(active);
        if became_idle {
            self.idle.notify_waiters();
        }
    }
}

pub fn validate_request(request: &LocalAgentRunRequest) -> Result<(), LocalAgentError> {
    validate_request_id(&request.request_id)?;
    validate_document_id(&request.document_id)?;
    if request.instruction.len() >= MAX_INSTRUCTION_BYTES
        || request.instruction.trim().is_empty()
        || request.instruction.contains('\0')
    {
        return Err(LocalAgentError::run(
            "invalid_instruction",
            "Enter a non-empty local agent instruction below 16 KiB.",
        ));
    }
    if request.source.len() > MAX_SOURCE_BYTES {
        return Err(LocalAgentError::run(
            "source_too_large",
            "The document is too large for a local agent request.",
        ));
    }
    if request.source.contains('\0') {
        return Err(LocalAgentError::run(
            "invalid_source",
            "The document contains an unsupported character.",
        ));
    }
    match request.target {
        LocalAgentTargetKind::Insert => {
            if request.selection.is_some() || request.cursor.is_none() {
                return Err(invalid_target());
            }
            validate_offset(&request.source, request.cursor.unwrap_or_default())?;
        }
        LocalAgentTargetKind::Selection => {
            if request.cursor.is_some() || request.selection.is_none() {
                return Err(invalid_target());
            }
            validate_range(&request.source, request.selection.unwrap_or_default())?;
        }
        LocalAgentTargetKind::Document => {
            if request.cursor.is_some() || request.selection.is_some() {
                return Err(invalid_target());
            }
        }
    }
    validate_document_complexity(request)
}

fn validate_request_id(value: &str) -> Result<(), LocalAgentError> {
    if value.is_empty()
        || value.len() > MAX_ID_BYTES
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err(LocalAgentError::run(
            "invalid_request_id",
            "The local agent request ID is invalid.",
        ));
    }
    Ok(())
}

fn validate_document_id(value: &str) -> Result<(), LocalAgentError> {
    if value.len() > MAX_ID_BYTES || value.trim().is_empty() || value.chars().any(char::is_control)
    {
        return Err(LocalAgentError::run(
            "invalid_document_id",
            "The local agent document ID is invalid.",
        ));
    }
    Ok(())
}

fn validate_offset(source: &str, offset: usize) -> Result<(), LocalAgentError> {
    if offset > source.len() {
        return Err(LocalAgentError::run(
            "invalid_range",
            "The local agent target range is invalid.",
        ));
    }
    if !source.is_char_boundary(offset) {
        return Err(LocalAgentError::run(
            "invalid_utf8_boundary",
            "The local agent target splits a UTF-8 character.",
        ));
    }
    Ok(())
}

fn validate_range(source: &str, range: ByteRange) -> Result<(), LocalAgentError> {
    if range.start >= range.end || range.end > source.len() {
        return Err(LocalAgentError::run(
            "invalid_range",
            "The local agent target range is invalid.",
        ));
    }
    if !source.is_char_boundary(range.start) || !source.is_char_boundary(range.end) {
        return Err(LocalAgentError::run(
            "invalid_utf8_boundary",
            "The local agent target splits a UTF-8 character.",
        ));
    }
    Ok(())
}

fn invalid_target() -> LocalAgentError {
    LocalAgentError::run(
        "invalid_target",
        "The local agent target does not match its range fields.",
    )
}

fn validate_document_complexity(request: &LocalAgentRunRequest) -> Result<(), LocalAgentError> {
    let selection = match request.target {
        LocalAgentTargetKind::Selection => request.selection,
        LocalAgentTargetKind::Insert | LocalAgentTargetKind::Document => None,
    };
    let envelope = AiDocumentEnvelope::new(&request.document_id, &request.source, selection)
        .map_err(|error| document_preparation_error(request.target, error))?;
    if envelope.protected.len() > MAX_PROTECTED_TOKENS {
        return Err(document_too_complex_error());
    }
    if request.target == LocalAgentTargetKind::Selection && !envelope.selection_has_editable_bytes()
    {
        return Err(LocalAgentError::run(
            "selection_not_editable",
            "The selection contains only protected Markdown and cannot be changed.",
        ));
    }
    if request.target == LocalAgentTargetKind::Insert {
        let cursor = request.cursor.unwrap_or_default();
        if envelope
            .protected
            .iter()
            .any(|token| token.range.start < cursor && cursor < token.range.end)
        {
            return Err(LocalAgentError::run(
                "invalid_range",
                "The local agent target range is invalid.",
            ));
        }
    }
    let prepared_bytes = prepared_request_size(request, &envelope)?;
    if prepared_bytes > MAX_PROCESS_STDIN_BYTES {
        return Err(request_too_large_error());
    }
    Ok(())
}

fn document_preparation_error(
    target: LocalAgentTargetKind,
    error: ValidationError,
) -> LocalAgentError {
    if error
        .issues
        .iter()
        .any(|issue| issue.code == ValidationIssueCode::DocumentTooComplex)
    {
        document_too_complex_error()
    } else if target == LocalAgentTargetKind::Selection
        && error.issues.iter().any(|issue| {
            matches!(
                issue.code,
                ValidationIssueCode::InvalidRange | ValidationIssueCode::InvalidUtf8Boundary
            )
        })
    {
        LocalAgentError::run("invalid_range", "The local agent target range is invalid.")
    } else {
        LocalAgentError::run(
            "invalid_source",
            "The document cannot be prepared for a local agent request.",
        )
    }
}

fn document_too_complex_error() -> LocalAgentError {
    LocalAgentError::run(
        "document_too_complex",
        "The document contains too many protected Markdown elements.",
    )
}

fn prepared_request_size(
    request: &LocalAgentRunRequest,
    envelope: &AiDocumentEnvelope,
) -> Result<usize, LocalAgentError> {
    let document_bytes = match request.target {
        LocalAgentTargetKind::Insert => serde_json::to_vec(&InsertDocumentContext {
            document_id: &request.document_id,
            source: &request.source,
            cursor: request.cursor,
        }),
        LocalAgentTargetKind::Selection | LocalAgentTargetKind::Document => {
            serde_json::to_vec(&envelope)
        }
    }
    .map_err(|_| {
        LocalAgentError::run(
            "invalid_source",
            "The document cannot be prepared for a local agent request.",
        )
    })?;
    request
        .instruction
        .len()
        .checked_add(document_bytes.len())
        .and_then(|bytes| bytes.checked_add(PREPARED_PROMPT_OVERHEAD_BYTES))
        .ok_or_else(request_too_large_error)
}

fn request_too_large_error() -> LocalAgentError {
    LocalAgentError::run(
        "request_too_large",
        "The prepared local agent request is too large.",
    )
}

fn validate_agent_payload(
    request: &LocalAgentRunRequest,
    payload: LocalAgentPayload,
) -> Result<LocalAgentRunResult, LocalAgentError> {
    if payload.schema_version != 1 {
        return Err(invalid_agent_result());
    }
    let markdown = match request.target {
        LocalAgentTargetKind::Insert => {
            let cursor = request.cursor.ok_or_else(invalid_agent_result)?;
            validate_markdown_insertion(&request.source, cursor, &payload.markdown)
                .map_err(|_| invalid_agent_result())?;
            payload.markdown
        }
        LocalAgentTargetKind::Selection => {
            let envelope =
                AiDocumentEnvelope::new(&request.document_id, &request.source, request.selection)
                    .map_err(|_| invalid_agent_result())?;
            let validated = validate_selection_response(
                &envelope,
                SelectionResponse {
                    schema_version: u32::from(payload.schema_version),
                    replacement_text: payload.markdown,
                    warnings: payload.warnings.clone(),
                },
            )
            .map_err(|_| invalid_agent_result())?;
            let operation = validated
                .operations
                .first()
                .ok_or_else(invalid_agent_result)?;
            if validated.operations.len() != 1
                || operation.source_range != request.selection.unwrap_or_default()
            {
                return Err(invalid_agent_result());
            }
            operation.proposed_markdown.clone()
        }
        LocalAgentTargetKind::Document => {
            let envelope = AiDocumentEnvelope::new(&request.document_id, &request.source, None)
                .map_err(|_| invalid_agent_result())?;
            validate_full_replacement(
                &envelope,
                &payload.markdown,
                payload.summary.clone(),
                payload.warnings.clone(),
            )
            .map_err(|_| invalid_agent_result())?
            .proposed_markdown
        }
    };
    if markdown.len() > MAX_SOURCE_BYTES {
        return Err(LocalAgentError::run(
            "local_agent_output_too_large",
            "The local agent result exceeded the safe limit.",
        ));
    }
    Ok(LocalAgentRunResult {
        schema_version: 1,
        request_id: request.request_id.clone(),
        document_id: request.document_id.clone(),
        agent: request.agent,
        target: request.target,
        markdown,
        summary: payload.summary,
        warnings: payload.warnings,
    })
}

#[tauri::command]
pub async fn local_agent_statuses(
    executable_paths: LocalAgentExecutablePaths,
) -> Result<Vec<LocalAgentStatus>, LocalAgentError> {
    let activity = process::ProcessActivityGuard::begin().ok_or_else(|| {
        LocalAgentError::run(
            "local_agent_shutting_down",
            "Markdowner is shutting down and cannot inspect local agents.",
        )
    })?;
    tokio::task::spawn_blocking(move || {
        let _activity = activity;
        discover_all_with_paths(&executable_paths)
    })
    .await
    .map_err(|_| scheduler_error())
}

#[tauri::command]
pub async fn local_agent_run(
    window: WebviewWindow,
    state: State<'_, LocalAgentState>,
    request: LocalAgentRunRequest,
    on_event: Channel<LocalAgentStreamEvent>,
) -> Result<LocalAgentRunResult, LocalAgentError> {
    validate_window_label(window.label())?;
    validate_request(&request)?;
    let guard = state.begin(window.label(), &request.request_id)?;
    let deadline = StdInstant::now() + LOCAL_AGENT_TIMEOUT;
    let cancellation = guard.cancellation_token();
    let starting = state.send_nonterminal(
        window.label(),
        &request.request_id,
        guard.generation,
        ActiveRunPhase::Running,
        &on_event,
        LocalAgentStreamEvent::Starting {
            request_id: request.request_id.clone(),
        },
    );
    let outcome = match ensure_before_deadline(deadline).and(starting) {
        Ok(()) => {
            run_registered_local_agent(
                &state,
                window.label(),
                guard.generation,
                &request,
                &on_event,
                &cancellation,
                deadline,
            )
            .await
        }
        Err(error) => Err(error),
    };
    let terminal_claim =
        state.enter_terminal(window.label(), &request.request_id, guard.generation);
    let outcome = if terminal_claim
        .as_ref()
        .is_some_and(TerminalClaim::outcome_won)
    {
        outcome
    } else {
        Err(cancelled_error())
    };
    match &outcome {
        Ok(_) => {
            let _ = on_event.send(LocalAgentStreamEvent::Completed {
                request_id: request.request_id.clone(),
            });
        }
        Err(error) => send_terminal_error(&on_event, &request.request_id, error),
    }
    if let Some(claim) = &terminal_claim {
        let _ = claim.mark_delivered();
    }
    drop(terminal_claim);
    outcome
}

async fn run_registered_local_agent(
    state: &LocalAgentState,
    window_label: &str,
    generation: u64,
    request: &LocalAgentRunRequest,
    on_event: &Channel<LocalAgentStreamEvent>,
    cancellation: &CancellationToken,
    deadline: StdInstant,
) -> Result<LocalAgentRunResult, LocalAgentError> {
    ensure_not_cancelled(cancellation)?;
    ensure_before_deadline(deadline)?;
    let agent = request.agent;
    let executable_path = request.executable_path.clone();
    let probe_cancellation = cancellation.clone();
    let resolved_task = tokio::task::spawn_blocking(move || {
        discovery::resolve_compatible_agent_cancellable(
            agent,
            executable_path.as_deref(),
            &probe_cancellation,
            deadline,
        )
    })
    .await;
    ensure_not_cancelled(cancellation)?;
    ensure_before_deadline(deadline)?;
    let resolved = resolved_task.map_err(|_| scheduler_error())?;
    let (resolved, executable_proof) = resolved.map_err(map_resolution_error)?;
    ensure_before_deadline(deadline)?;
    let temp_dir = create_owned_temp_dir();
    ensure_before_deadline(deadline)?;
    let mut temp_dir = temp_dir?;
    let invocation = build_invocation(&resolved, request, &mut temp_dir).map_err(|_| {
        LocalAgentError::run(
            "local_agent_setup_failed",
            "The local agent could not be prepared.",
        )
    });
    ensure_before_deadline(deadline)?;
    let invocation = invocation?;
    let prepared = OwnedProcessInvocation::prepare(
        invocation,
        temp_dir,
        executable_proof,
        request.agent,
        cancellation,
        deadline,
    );
    ensure_before_deadline(deadline)?;
    let prepared = prepared?;
    let running_event = state.send_nonterminal(
        window_label,
        &request.request_id,
        generation,
        ActiveRunPhase::Running,
        on_event,
        LocalAgentStreamEvent::Running {
            request_id: request.request_id.clone(),
        },
    );
    ensure_before_deadline(deadline)?;
    running_event?;
    let process_output = run_process(prepared, cancellation.clone(), deadline).await;
    let mut output = match process_output {
        Ok(output) => output,
        Err(error) => {
            ensure_not_cancelled(cancellation)?;
            ensure_before_deadline(deadline)?;
            return Err(error);
        }
    };
    let processing = (|| {
        ensure_not_cancelled(cancellation)?;
        ensure_before_deadline(deadline)?;
        if !state.begin_post_processing(window_label, &request.request_id, generation) {
            return Err(cancelled_error());
        }
        let validating_event = state.send_nonterminal(
            window_label,
            &request.request_id,
            generation,
            ActiveRunPhase::PostProcessing,
            on_event,
            LocalAgentStreamEvent::Validating {
                request_id: request.request_id.clone(),
            },
        );
        ensure_before_deadline(deadline)?;
        validating_event?;
        ensure_not_cancelled(cancellation)?;
        ensure_before_deadline(deadline)?;
        let payload =
            parse_adapter_result(request.agent, &output.stdout, output.result_file.as_deref())
                .map_err(|_| invalid_agent_result())?;
        ensure_not_cancelled(cancellation)?;
        ensure_before_deadline(deadline)?;
        let result = validate_agent_payload(request, payload);
        ensure_not_cancelled(cancellation)?;
        ensure_before_deadline(deadline)?;
        result
    })();
    let cleanup = output.close_temp_dir().await;
    finish_post_processing(processing, cleanup, deadline)
}

fn finish_post_processing<T>(
    processing: Result<T, LocalAgentError>,
    cleanup: Result<(), LocalAgentError>,
    deadline: StdInstant,
) -> Result<T, LocalAgentError> {
    cleanup?;
    ensure_before_deadline(deadline)?;
    processing
}

fn remaining_run_time(deadline: StdInstant) -> Result<Duration, LocalAgentError> {
    let remaining = deadline.saturating_duration_since(StdInstant::now());
    if remaining.is_zero() {
        Err(timeout_error())
    } else {
        Ok(remaining)
    }
}

fn ensure_before_deadline(deadline: StdInstant) -> Result<(), LocalAgentError> {
    remaining_run_time(deadline).map(|_| ())
}

fn timeout_error() -> LocalAgentError {
    LocalAgentError::run("local_agent_timeout", "The local agent request timed out.")
}

fn unavailable_error() -> LocalAgentError {
    LocalAgentError::run(
        "local_agent_unavailable",
        "The selected local agent is unavailable or incompatible.",
    )
}

fn map_resolution_error(error: LocalAgentError) -> LocalAgentError {
    if error.code_value() == "local_agent_cancelled" {
        error
    } else if error == LocalAgentError::ProbeTimedOut {
        timeout_error()
    } else {
        unavailable_error()
    }
}

#[tauri::command]
pub fn local_agent_cancel(
    window: WebviewWindow,
    state: State<'_, LocalAgentState>,
    request_id: String,
) -> bool {
    validate_window_label(window.label()).is_ok() && state.cancel(window.label(), &request_id)
}

fn validate_window_label(label: &str) -> Result<(), LocalAgentError> {
    if label.len() > MAX_ID_BYTES {
        return Err(LocalAgentError::run(
            "invalid_window",
            "The local agent window is invalid.",
        ));
    }
    let numbered_window = label
        .strip_prefix("markdownerWindow")
        .is_some_and(|suffix| {
            !suffix.is_empty() && suffix.bytes().all(|byte| byte.is_ascii_digit())
        });
    if label != "main" && !numbered_window {
        return Err(LocalAgentError::run(
            "invalid_window",
            "The local agent window is invalid.",
        ));
    }
    Ok(())
}

fn send_terminal_error(
    channel: &Channel<LocalAgentStreamEvent>,
    request_id: &str,
    error: &LocalAgentError,
) {
    let event = if error.code_value() == "local_agent_cancelled" {
        LocalAgentStreamEvent::Cancelled {
            request_id: request_id.to_string(),
        }
    } else {
        LocalAgentStreamEvent::Failed {
            request_id: request_id.to_string(),
            code: error.code_value().to_string(),
            message: error.reason().to_string(),
        }
    };
    let _ = channel.send(event);
}

fn ensure_not_cancelled(cancellation: &CancellationToken) -> Result<(), LocalAgentError> {
    if cancellation.is_cancelled() {
        Err(cancelled_error())
    } else {
        Ok(())
    }
}

fn cancelled_error() -> LocalAgentError {
    LocalAgentError::run(
        "local_agent_cancelled",
        "The local agent request was cancelled.",
    )
}

fn invalid_agent_result() -> LocalAgentError {
    LocalAgentError::run(
        "invalid_agent_result",
        "The local agent returned an invalid result.",
    )
}

fn scheduler_error() -> LocalAgentError {
    LocalAgentError::run(
        "local_agent_state_unavailable",
        "The local agent state is unavailable.",
    )
}

#[cfg(test)]
mod tests {
    use std::{
        cell::Cell,
        time::{Duration, Instant as StdInstant},
    };

    use serde_json::json;
    use tauri::ipc::Channel;
    use tokio_util::sync::CancellationToken;

    use super::adapters::LocalAgentPayload;
    use super::{
        LocalAgentError, LocalAgentKind, LocalAgentRunRequest, LocalAgentState, LocalAgentStatus,
        LocalAgentStatusSource, LocalAgentStreamEvent, LocalAgentTargetKind, MAX_ID_BYTES,
        MAX_INSTRUCTION_BYTES, MAX_PROCESS_STDIN_BYTES, MAX_SOURCE_BYTES, finish_post_processing,
        map_resolution_error, prepared_request_size, remaining_run_time, validate_agent_payload,
        validate_request, validate_window_label,
    };
    use markdowner_core::ai_document::{AiDocumentEnvelope, ByteRange, ProtectedKind};

    fn fixture_request(target: LocalAgentTargetKind) -> LocalAgentRunRequest {
        let source = "A 가나다 document.\n".to_string();
        let (selection, cursor) = match target {
            LocalAgentTargetKind::Insert => (None, Some(1)),
            LocalAgentTargetKind::Selection => (Some(ByteRange { start: 2, end: 11 }), None),
            LocalAgentTargetKind::Document => (None, None),
        };
        LocalAgentRunRequest {
            request_id: "request-1".to_string(),
            document_id: "document-1".to_string(),
            agent: LocalAgentKind::Codex,
            target,
            source,
            selection,
            cursor,
            instruction: "Rewrite clearly.".to_string(),
            executable_path: None,
        }
    }

    fn assert_error_code(request: &LocalAgentRunRequest, expected: &str) {
        let error = validate_request(request).unwrap_err();
        assert_eq!(error.code, expected);
        assert!(!error.message.contains(&request.source));
        assert!(!error.message.contains(&request.instruction));
    }

    #[test]
    fn request_validation_rejects_blank_and_oversized_identifiers_without_content_leaks() {
        for (field, expected) in [
            ("request", "invalid_request_id"),
            ("document", "invalid_document_id"),
        ] {
            for invalid in [" ".to_string(), "x".repeat(MAX_ID_BYTES + 1)] {
                let mut request = fixture_request(LocalAgentTargetKind::Document);
                if field == "request" {
                    request.request_id = invalid;
                } else {
                    request.document_id = invalid;
                }
                assert_error_code(&request, expected);
            }
        }
    }

    #[test]
    fn request_validation_enforces_instruction_and_source_byte_limits() {
        let mut request = fixture_request(LocalAgentTargetKind::Document);
        request.instruction = " \n".to_string();
        assert_error_code(&request, "invalid_instruction");

        request.instruction = "x".repeat(MAX_INSTRUCTION_BYTES);
        assert_error_code(&request, "invalid_instruction");

        request = fixture_request(LocalAgentTargetKind::Document);
        request.source = "x".repeat(MAX_SOURCE_BYTES + 1);
        assert_error_code(&request, "source_too_large");

        request = fixture_request(LocalAgentTargetKind::Document);
        request.source.push('\0');
        assert_error_code(&request, "invalid_source");
    }

    #[test]
    fn request_validation_enforces_the_conservative_prepared_stdin_boundary() {
        let mut request = fixture_request(LocalAgentTargetKind::Document);
        request.source = "\n".repeat(32_768);
        let base_envelope = AiDocumentEnvelope::new(&request.document_id, &request.source, None)
            .expect("fixture envelope");
        let initial_size = prepared_request_size(&request, &base_envelope).unwrap();
        let base_source = request.source.clone();
        let mut accepted_padding = 0;
        let mut rejected_padding = MAX_PROCESS_STDIN_BYTES - initial_size;
        request.source = format!("{base_source}{}", "a".repeat(rejected_padding));
        let rejected_envelope =
            AiDocumentEnvelope::new(&request.document_id, &request.source, None).unwrap();
        assert!(
            prepared_request_size(&request, &rejected_envelope).unwrap() > MAX_PROCESS_STDIN_BYTES
        );
        while rejected_padding - accepted_padding > 1 {
            let padding = accepted_padding + (rejected_padding - accepted_padding) / 2;
            request.source = format!("{base_source}{}", "a".repeat(padding));
            let envelope =
                AiDocumentEnvelope::new(&request.document_id, &request.source, None).unwrap();
            let size = prepared_request_size(&request, &envelope).unwrap();
            if size <= MAX_PROCESS_STDIN_BYTES {
                accepted_padding = padding;
            } else {
                rejected_padding = padding;
            }
        }
        request.source = format!("{base_source}{}", "a".repeat(accepted_padding));
        assert!(request.source.len() < MAX_SOURCE_BYTES);
        let boundary_envelope =
            AiDocumentEnvelope::new(&request.document_id, &request.source, None).unwrap();
        assert!(
            prepared_request_size(&request, &boundary_envelope).unwrap() <= MAX_PROCESS_STDIN_BYTES
        );
        assert!(validate_request(&request).is_ok());

        request.source.push('a');
        assert_error_code(&request, "request_too_large");
    }

    #[test]
    fn request_validation_rejects_target_range_mismatches_and_utf8_splits() {
        let mut insert = fixture_request(LocalAgentTargetKind::Insert);
        insert.cursor = None;
        assert_error_code(&insert, "invalid_target");
        insert.cursor = Some(insert.source.len() + 1);
        assert_error_code(&insert, "invalid_range");
        insert.cursor = Some(3);
        assert_error_code(&insert, "invalid_utf8_boundary");
        insert.cursor = Some(1);
        insert.selection = Some(ByteRange { start: 0, end: 1 });
        assert_error_code(&insert, "invalid_target");

        let mut selection = fixture_request(LocalAgentTargetKind::Selection);
        selection.selection = None;
        assert_error_code(&selection, "invalid_target");
        selection.selection = Some(ByteRange { start: 2, end: 2 });
        assert_error_code(&selection, "invalid_range");
        selection.selection = Some(ByteRange { start: 3, end: 11 });
        assert_error_code(&selection, "invalid_utf8_boundary");
        selection.selection = Some(ByteRange { start: 2, end: 11 });
        selection.cursor = Some(2);
        assert_error_code(&selection, "invalid_target");

        let mut document = fixture_request(LocalAgentTargetKind::Document);
        document.cursor = Some(0);
        assert_error_code(&document, "invalid_target");
        document.cursor = None;
        document.selection = Some(ByteRange { start: 0, end: 1 });
        assert_error_code(&document, "invalid_target");
    }

    #[test]
    fn request_validation_rejects_fully_protected_selection_without_rejecting_its_boundaries() {
        let mut request = fixture_request(LocalAgentTargetKind::Selection);
        request.source = "Before\n\n```rust\nprivate_code();\n```\nAfter\n".to_string();
        let start = request.source.find("private_code").unwrap();
        request.selection = Some(ByteRange {
            start,
            end: start + "private_code".len(),
        });

        assert_error_code(&request, "selection_not_editable");

        request.selection = Some(ByteRange {
            start,
            end: request.source.find("After").unwrap() + "After".len(),
        });
        assert!(validate_request(&request).is_ok());
    }

    #[test]
    fn all_valid_targets_preserve_document_complexity_errors() {
        for target in [
            LocalAgentTargetKind::Insert,
            LocalAgentTargetKind::Selection,
            LocalAgentTargetKind::Document,
        ] {
            let mut request = fixture_request(target);
            request.source = "x\n".repeat(32_769);
            if target == LocalAgentTargetKind::Selection {
                request.selection = Some(ByteRange { start: 0, end: 1 });
            }

            assert_error_code(&request, "document_too_complex");
        }
    }

    #[test]
    fn request_validation_rejects_insert_cursor_inside_global_protected_markdown() {
        let mut request = fixture_request(LocalAgentTargetKind::Insert);
        request.source = "Before\n\n```rust\nprivate_code();\n```\nAfter\n".to_string();
        let envelope =
            AiDocumentEnvelope::new(&request.document_id, &request.source, None).unwrap();
        let protected_range = envelope
            .protected
            .iter()
            .find(|token| token.kind == ProtectedKind::BlockCode)
            .unwrap()
            .range;
        request.cursor = Some(protected_range.start + 1);

        assert_error_code(&request, "invalid_range");

        request.cursor = Some(protected_range.start);
        assert!(validate_request(&request).is_ok());
        request.cursor = Some(protected_range.end);
        assert!(validate_request(&request).is_ok());
    }

    #[test]
    fn injected_window_labels_are_limited_to_app_owned_windows() {
        for valid in ["main", "markdownerWindow1", "markdownerWindow00042"] {
            assert!(
                validate_window_label(valid).is_ok(),
                "expected {valid:?} to be valid"
            );
        }
        for invalid in [
            "",
            "secondary",
            "main2",
            "markdownerWindow",
            "markdownerWindow-1",
            "markdownerWindow1x",
            "markdownerWindow1/private",
        ] {
            let error = validate_window_label(invalid).unwrap_err();
            assert_eq!(
                error.code, "invalid_window",
                "unexpected result for {invalid:?}"
            );
        }
        let oversized = format!("markdownerWindow{}", "1".repeat(MAX_ID_BYTES));
        assert_eq!(
            validate_window_label(&oversized).unwrap_err().code,
            "invalid_window"
        );
    }

    #[test]
    fn active_registry_is_per_exact_window_and_rejects_duplicate_request_ids() {
        let state = LocalAgentState::default();
        let first = state.begin("main", "first").unwrap();
        assert_eq!(
            state.begin("main", "second").unwrap_err().code,
            "local_agent_busy"
        );
        assert_eq!(
            state.begin("secondary", "first").unwrap_err().code,
            "duplicate_request_id"
        );
        let third = state.begin("secondary", "third").unwrap();
        assert!(!state.cancel("main", "stale"));
        assert!(!state.cancel("secondary", "first"));
        assert!(state.cancel("main", "first"));
        assert!(first.cancellation_token().is_cancelled());
        assert!(!state.cancel("main", "first"));
        drop(first);
        drop(third);
        assert!(state.begin("main", "after-drop").is_ok());
    }

    #[test]
    fn request_ids_cannot_be_reused_after_a_run_leaves_the_active_registry() {
        let state = LocalAgentState::default();
        let first = state.begin("main", "used-once").unwrap();
        drop(first);

        let error = state.begin("markdownerWindow1", "used-once").unwrap_err();
        assert_eq!(error.code, "duplicate_request_id");

        let later = state.begin("main", "later").unwrap();
        assert!(!state.cancel("main", "used-once"));
        assert!(!later.cancellation_token().is_cancelled());
    }

    #[test]
    fn registry_cleanup_compares_generation_before_removing_a_run() {
        let state = LocalAgentState::default();
        let first = state.begin("main", "first").unwrap();
        let first_generation = first.generation();
        assert!(state.finish("main", "first", first_generation));
        let second = state.begin("main", "second").unwrap();
        drop(first);
        assert!(state.cancel("main", "second"));
        assert!(second.cancellation_token().is_cancelled());
    }

    #[test]
    fn dropping_an_aborted_run_signals_work_before_releasing_its_slot() {
        let state = LocalAgentState::default();
        let aborted = state.begin("main", "aborted").unwrap();
        let cancellation = aborted.cancellation_token();
        assert!(!cancellation.is_cancelled());

        drop(aborted);

        assert!(cancellation.is_cancelled());
        let replacement = state.begin("main", "replacement").unwrap();
        assert!(!replacement.cancellation_token().is_cancelled());
    }

    #[test]
    fn cancellation_wins_before_and_during_post_processing() {
        let cancelled_state = LocalAgentState::default();
        let cancelled = cancelled_state.begin("main", "cancel-first").unwrap();
        assert!(cancelled_state.cancel("main", "cancel-first"));
        assert!(!cancelled_state.begin_post_processing(
            "main",
            "cancel-first",
            cancelled.generation(),
        ));
        assert!(
            !cancelled_state
                .enter_terminal("main", "cancel-first", cancelled.generation())
                .unwrap()
                .outcome_won()
        );

        let validating_state = LocalAgentState::default();
        let validating = validating_state.begin("main", "validate-first").unwrap();
        assert!(validating_state.begin_post_processing(
            "main",
            "validate-first",
            validating.generation(),
        ));
        assert!(validating_state.cancel("main", "validate-first"));
        assert!(validating.cancellation_token().is_cancelled());
        assert!(
            !validating_state
                .enter_terminal("main", "validate-first", validating.generation())
                .unwrap()
                .outcome_won()
        );
    }

    #[test]
    fn terminal_failure_claim_linearizes_against_cancellation() {
        let failed_state = LocalAgentState::default();
        let failed = failed_state.begin("main", "fail-first").unwrap();
        assert!(
            failed_state
                .enter_terminal("main", "fail-first", failed.generation())
                .unwrap()
                .outcome_won()
        );
        assert!(!failed_state.cancel("main", "fail-first"));

        let cancelled_state = LocalAgentState::default();
        let cancelled = cancelled_state.begin("main", "cancel-first").unwrap();
        assert!(cancelled_state.cancel("main", "cancel-first"));
        assert!(
            !cancelled_state
                .enter_terminal("main", "cancel-first", cancelled.generation())
                .unwrap()
                .outcome_won()
        );
    }

    #[test]
    fn accepted_cancel_wins_even_when_the_starting_channel_is_already_closed() {
        let state = LocalAgentState::default();
        let run = state.begin("main", "cancelled-start").unwrap();
        let cancellation = run.cancellation_token();
        assert!(state.cancel("main", "cancelled-start"));
        assert!(cancellation.is_cancelled());
        let closed_channel = Channel::new(|_| Err(tauri::Error::FailedToReceiveMessage));

        let channel_error = state
            .send_nonterminal(
                "main",
                "cancelled-start",
                run.generation(),
                super::ActiveRunPhase::Running,
                &closed_channel,
                LocalAgentStreamEvent::Starting {
                    request_id: "cancelled-start".to_string(),
                },
            )
            .unwrap_err();
        let terminal_claim = state
            .enter_terminal("main", "cancelled-start", run.generation())
            .unwrap();

        assert_eq!(channel_error.code, "local_agent_cancelled");
        assert!(!terminal_claim.outcome_won());
    }

    #[tokio::test]
    async fn shutdown_cancels_owned_post_processing_before_idle() {
        let state = LocalAgentState::default();
        let run = state.begin("main", "validating").unwrap();
        assert!(state.begin_post_processing("main", "validating", run.generation()));
        let channel = Channel::new(|_| Ok(()));
        state
            .send_nonterminal(
                "main",
                "validating",
                run.generation(),
                super::ActiveRunPhase::PostProcessing,
                &channel,
                LocalAgentStreamEvent::Validating {
                    request_id: "validating".to_string(),
                },
            )
            .unwrap();

        state.begin_shutdown_with(|| {});
        assert!(run.cancellation_token().is_cancelled());
        assert_eq!(
            state.active.lock().unwrap().get("main").unwrap().phase,
            super::ActiveRunPhase::Cancelling
        );
        assert!(!state.wait_for_idle(Duration::ZERO).await);
        let terminal_claim = state
            .enter_terminal("main", "validating", run.generation())
            .unwrap();
        assert!(!terminal_claim.outcome_won());
        let terminal_event = if terminal_claim.outcome_won() {
            LocalAgentStreamEvent::Completed {
                request_id: "validating".to_string(),
            }
        } else {
            LocalAgentStreamEvent::Cancelled {
                request_id: "validating".to_string(),
            }
        };
        assert_eq!(
            terminal_event,
            LocalAgentStreamEvent::Cancelled {
                request_id: "validating".to_string()
            }
        );
        assert!(terminal_claim.mark_delivered());
        drop(terminal_claim);
        assert!(!state.wait_for_idle(Duration::ZERO).await);
        drop(run);
        assert!(state.wait_for_idle(Duration::from_millis(100)).await);
    }

    #[test]
    fn terminal_delivery_allows_follow_up_without_bypassing_the_idle_barrier() {
        let state = LocalAgentState::default();
        let finished = state.begin("main", "finished").unwrap();

        let finished_claim = state
            .enter_terminal("main", "finished", finished.generation())
            .unwrap();
        assert!(finished_claim.outcome_won());
        assert_eq!(
            state.begin("main", "next").unwrap_err().code,
            "local_agent_busy"
        );
        let closed_channel = Channel::new(|_| Err(tauri::Error::FailedToReceiveMessage));
        assert!(
            closed_channel
                .send(LocalAgentStreamEvent::Completed {
                    request_id: "finished".to_string(),
                })
                .is_err()
        );
        assert!(finished_claim.mark_delivered());
        let next = state.begin("main", "next").unwrap();

        let next_claim = state
            .enter_terminal("main", "next", next.generation())
            .unwrap();
        drop(next_claim);
        drop(next);
        drop(finished);
        assert!(!state.is_idle());
        drop(finished_claim);
        assert!(state.is_idle());
    }

    #[test]
    fn expired_total_run_deadline_returns_the_stable_timeout_error() {
        let error = remaining_run_time(StdInstant::now()).unwrap_err();

        assert_eq!(error.code, "local_agent_timeout");
    }

    #[test]
    fn resolution_preserves_cancellation_and_maps_probe_deadlines_to_run_timeouts() {
        let timed_out = map_resolution_error(LocalAgentError::ProbeTimedOut);
        assert_eq!(timed_out.code, "local_agent_timeout");

        let cancelled = map_resolution_error(LocalAgentError::run(
            "local_agent_cancelled",
            "The local agent request was cancelled.",
        ));
        assert_eq!(cancelled.code, "local_agent_cancelled");

        let unavailable = map_resolution_error(LocalAgentError::NotInstalled);
        assert_eq!(unavailable.code, "local_agent_unavailable");
    }

    #[test]
    fn post_processing_cleanup_errors_override_every_validation_outcome() {
        for processing in [
            Ok(()),
            Err(LocalAgentError::run(
                "invalid_agent_result",
                "The local agent returned an invalid result.",
            )),
        ] {
            let result = finish_post_processing(
                processing,
                Err(LocalAgentError::run(
                    "local_agent_cleanup_failed",
                    "The local agent temporary files could not be removed.",
                )),
                StdInstant::now() + Duration::from_secs(1),
            );

            assert_eq!(result.unwrap_err().code, "local_agent_cleanup_failed");
        }
    }

    #[tokio::test]
    async fn wait_for_idle_is_bounded_and_observes_raii_cleanup() {
        let state = LocalAgentState::default();
        let guard = state.begin("main", "active").unwrap();
        assert!(!state.wait_for_idle(Duration::ZERO).await);
        assert!(!state.wait_for_idle(Duration::from_millis(10)).await);

        let waiting_state = state.clone();
        let waiter =
            tokio::spawn(async move { waiting_state.wait_for_idle(Duration::from_secs(1)).await });
        tokio::task::yield_now().await;
        drop(guard);

        assert!(waiter.await.unwrap());
        assert!(state.wait_for_idle(Duration::ZERO).await);
    }

    #[test]
    fn shutdown_registry_cancels_existing_runs_and_rejects_new_ones() {
        let state = LocalAgentState::default();
        let active = state.begin("main", "active").unwrap();
        let process_shutdown_observed = Cell::new(false);

        state.begin_shutdown_with(|| {
            process_shutdown_observed.set(true);
            assert!(active.cancellation_token().is_cancelled());
            assert!(
                !state
                    .enter_terminal("main", "active", active.generation())
                    .unwrap()
                    .outcome_won()
            );
        });

        assert!(process_shutdown_observed.get());
        assert!(active.cancellation_token().is_cancelled());
        let error = state.begin("markdownerWindow1", "new").unwrap_err();
        assert_eq!(error.code, "local_agent_shutting_down");
    }

    #[test]
    fn stream_events_are_content_free_and_match_the_frontend_contract() {
        let events = vec![
            LocalAgentStreamEvent::Starting {
                request_id: "request-1".to_string(),
            },
            LocalAgentStreamEvent::Running {
                request_id: "request-1".to_string(),
            },
            LocalAgentStreamEvent::Validating {
                request_id: "request-1".to_string(),
            },
            LocalAgentStreamEvent::Completed {
                request_id: "request-1".to_string(),
            },
            LocalAgentStreamEvent::Failed {
                request_id: "request-1".to_string(),
                code: "local_agent_failed".to_string(),
                message: "The local agent did not complete successfully.".to_string(),
            },
            LocalAgentStreamEvent::Cancelled {
                request_id: "request-1".to_string(),
            },
        ];
        let serialized = serde_json::to_string(&events).unwrap();
        assert!(!serialized.contains("captured source"));
        assert!(!serialized.contains("private prompt"));
        assert_eq!(
            serde_json::to_value(&events[0]).unwrap(),
            json!({"type": "starting", "requestId": "request-1"})
        );
        assert_eq!(
            serde_json::to_value(&events[2]).unwrap(),
            json!({"type": "validating", "requestId": "request-1"})
        );
    }

    #[test]
    fn cancellation_tokens_are_not_serialized_or_debugged_with_request_content() {
        let cancellation = CancellationToken::new();
        assert!(!cancellation.is_cancelled());
        cancellation.cancel();
        assert!(cancellation.is_cancelled());

        let mut request = fixture_request(LocalAgentTargetKind::Document);
        request.source = "captured source".to_string();
        request.instruction = "private prompt".to_string();
        request.executable_path = Some("/private/secret-user/bin/codex".to_string());
        let debug = format!("{request:?}");
        assert!(!debug.contains("captured source"));
        assert!(!debug.contains("private prompt"));
        assert!(!debug.contains("secret-user"));
        assert_eq!(
            serde_json::to_value(&request).unwrap()["executablePath"],
            "/private/secret-user/bin/codex"
        );

        let error = LocalAgentError::run(
            "local_agent_failed",
            "The local agent did not complete successfully.",
        );
        assert_eq!(
            serde_json::to_value(error).unwrap(),
            json!({
                "code": "local_agent_failed",
                "message": "The local agent did not complete successfully."
            })
        );
    }

    #[test]
    fn selection_and_document_results_restore_protected_markdown_fragments() {
        let source = "Read [old label](/docs?q=1) with $git-commit.\n";
        let mut selection = fixture_request(LocalAgentTargetKind::Selection);
        selection.source = source.to_string();
        selection.selection = Some(ByteRange {
            start: 0,
            end: source.len(),
        });
        let envelope =
            AiDocumentEnvelope::new(&selection.document_id, source, selection.selection).unwrap();
        let masked = envelope
            .segments
            .iter()
            .map(|segment| segment.text.as_str())
            .collect::<String>()
            .replace("old label", "new label");
        let payload = LocalAgentPayload {
            schema_version: 1,
            markdown: masked.clone(),
            summary: "Updated the label".to_string(),
            warnings: vec!["Review wording".to_string()],
        };

        let selected = validate_agent_payload(&selection, payload.clone()).unwrap();
        assert_eq!(
            selected.markdown,
            "Read [new label](/docs?q=1) with $git-commit.\n"
        );
        assert_eq!(selected.request_id, selection.request_id);
        assert_eq!(selected.document_id, selection.document_id);
        assert_eq!(selected.target, LocalAgentTargetKind::Selection);

        let mut document = selection.clone();
        document.target = LocalAgentTargetKind::Document;
        document.selection = None;
        let document_envelope =
            AiDocumentEnvelope::new(&document.document_id, source, None).unwrap();
        let document_masked = document_envelope
            .segments
            .iter()
            .map(|segment| segment.text.as_str())
            .collect::<String>()
            .replace("old label", "new label");
        let document_result = validate_agent_payload(
            &document,
            LocalAgentPayload {
                markdown: document_masked,
                ..payload
            },
        )
        .unwrap();
        assert_eq!(document_result.markdown, selected.markdown);

        let link = envelope
            .protected
            .iter()
            .find(|token| token.kind == ProtectedKind::LinkDestination)
            .unwrap();
        let invalid = LocalAgentPayload {
            schema_version: 1,
            markdown: masked.replace(&link.placeholder, &format!("evil{}", link.placeholder)),
            summary: "Unsafe".to_string(),
            warnings: Vec::new(),
        };
        let error = validate_agent_payload(&selection, invalid).unwrap_err();
        assert_eq!(error.code, "invalid_agent_result");
        assert!(!error.message.contains("/docs?q=1"));
        assert!(!error.message.contains("evil"));
    }

    #[test]
    fn insert_results_accept_new_structural_markdown_without_old_source_tokens() {
        let mut request = fixture_request(LocalAgentTargetKind::Insert);
        request.cursor = Some(request.source.len());
        let markdown = concat!(
            "## Added\n\n",
            "| Name | Value |\n",
            "| --- | --- |\n",
            "| docs | [new](/new-destination) |\n\n",
            "$brand-new\n",
        );
        let payload = LocalAgentPayload {
            schema_version: 1,
            markdown: markdown.to_string(),
            summary: "Inserted a new table".to_string(),
            warnings: Vec::new(),
        };

        let result = validate_agent_payload(&request, payload).unwrap();

        assert_eq!(result.markdown, markdown);
        assert_eq!(result.target, LocalAgentTargetKind::Insert);
        assert_eq!(result.schema_version, 1);
    }

    #[test]
    fn insert_results_reject_unbalanced_fences_and_malformed_tables() {
        let mut request = fixture_request(LocalAgentTargetKind::Insert);
        request.cursor = Some(request.source.len());
        for markdown in [
            "```rust\nfn unfinished() {}\n",
            "| Name | Value |\n| --- | --- |\n| only-one |\n",
        ] {
            let error = validate_agent_payload(
                &request,
                LocalAgentPayload {
                    schema_version: 1,
                    markdown: markdown.to_string(),
                    summary: "Unsafe structure".to_string(),
                    warnings: Vec::new(),
                },
            )
            .unwrap_err();
            assert_eq!(error.code, "invalid_agent_result");
            assert!(!error.message.contains(markdown));
        }
    }

    #[test]
    fn insert_results_validate_the_composed_source_but_return_only_the_fragment() {
        let mut request = fixture_request(LocalAgentTargetKind::Insert);
        request.source = "| A | B |\n| --- | --- |\n| x | y |\n".to_string();
        request.cursor = Some(request.source.find("x").unwrap() + 1);
        let fragment = " | extra";

        let error = validate_agent_payload(
            &request,
            LocalAgentPayload {
                schema_version: 1,
                markdown: fragment.to_string(),
                summary: "Unsafe insertion".to_string(),
                warnings: Vec::new(),
            },
        )
        .unwrap_err();

        assert_eq!(error.code, "invalid_agent_result");

        request.source = "Before\n\nAfter\n".to_string();
        request.cursor = Some(request.source.find("After").unwrap());
        let valid_fragment = "| Name | Value |\n| --- | --- |\n| docs | local |\n\n";
        let result = validate_agent_payload(
            &request,
            LocalAgentPayload {
                schema_version: 1,
                markdown: valid_fragment.to_string(),
                summary: "Inserted a table".to_string(),
                warnings: Vec::new(),
            },
        )
        .unwrap();

        assert_eq!(result.markdown, valid_fragment);
    }

    #[test]
    fn missing_tokens_and_broken_document_structure_map_to_content_free_errors() {
        let source = "Before\n\n```rust\nprivate source\n```\n";
        let mut request = fixture_request(LocalAgentTargetKind::Document);
        request.source = source.to_string();
        request.instruction = "private prompt".to_string();
        let envelope = AiDocumentEnvelope::new(&request.document_id, source, None).unwrap();
        let masked = envelope
            .segments
            .iter()
            .map(|segment| segment.text.as_str())
            .collect::<String>();
        let first = envelope.protected.first().unwrap();
        for markdown in [
            masked.replacen(&first.placeholder, "", 1),
            format!("{masked}```\n"),
        ] {
            let error = validate_agent_payload(
                &request,
                LocalAgentPayload {
                    schema_version: 1,
                    markdown,
                    summary: "Invalid result".to_string(),
                    warnings: Vec::new(),
                },
            )
            .unwrap_err();
            assert_eq!(error.code, "invalid_agent_result");
            assert!(!error.message.contains("private source"));
            assert!(!error.message.contains("private prompt"));
        }
    }

    #[test]
    fn fixed_registry_exposes_only_the_three_supported_executables() {
        assert_eq!(
            LocalAgentKind::ALL.map(LocalAgentKind::executable_basename),
            ["claude", "codex", "opencode"]
        );
        assert_eq!(
            LocalAgentKind::ALL.map(LocalAgentKind::mention),
            ["@claude", "@codex", "@opencode"]
        );
        assert_eq!(
            LocalAgentKind::ALL.map(LocalAgentKind::label),
            ["Claude Code", "Codex", "OpenCode"]
        );
    }

    #[test]
    fn status_serialization_is_camel_case_and_contains_only_a_redacted_path_label() {
        let status = LocalAgentStatus {
            kind: LocalAgentKind::Claude,
            mention: "@claude",
            label: "Claude Code",
            installed: true,
            compatible: false,
            path_label: Some("bin/claude".to_string()),
            version: Some("2.1.226".to_string()),
            reason: Some("Required Claude Code safety flags are unavailable.".to_string()),
            source: Some(LocalAgentStatusSource::Automatic),
        };

        assert_eq!(
            serde_json::to_value(status).unwrap(),
            json!({
                "kind": "claude",
                "mention": "@claude",
                "label": "Claude Code",
                "installed": true,
                "compatible": false,
                "pathLabel": "bin/claude",
                "version": "2.1.226",
                "reason": "Required Claude Code safety flags are unavailable.",
                "source": "automatic"
            })
        );
    }

    #[test]
    fn resolved_agent_debug_output_redacts_the_canonical_path() {
        let resolved = super::ResolvedAgent {
            kind: LocalAgentKind::Claude,
            path: "/private/secret-user/bin/claude".into(),
            path_label: "bin/claude".to_string(),
        };

        let debug = format!("{resolved:?}");

        assert!(debug.contains("bin/claude"));
        assert!(!debug.contains("private/secret-user"));
    }
}
