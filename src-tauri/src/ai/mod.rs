use std::{
    collections::{HashMap, HashSet, VecDeque},
    fmt, fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use markdowner_core::ai_document::{
    AiDocumentEnvelope, ByteRange, PrdResponse, ProtectionPolicy, SelectionResponse,
    SummaryResponse, TranslationResponse, ValidatedDocument, ValidationError,
    validate_batched_translation, validate_prd_response, validate_selection_response,
    validate_summary_response, validate_translation,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State, ipc::Channel};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio_util::sync::CancellationToken;

use self::{
    activity::{
        ActiveAiRun, ActiveStatus, ActivityProgress, ActivityRegistry, AiDocumentRef, AiRunScope,
    },
    chunking::{
        TranslationChunk, plan_structured_document_chunks, plan_translation_chunks,
        subdivide_translation_chunk,
    },
    history::{
        HistoryPage, HistoryRepository, RunStatus, StoredRun, StoredRunDetail,
        StoredTranslationChunk,
    },
    interview::{InterviewSession, InterviewStatus, PRD_INTERVIEW_PROMPT_VERSION},
    keychain::{AiKeyStatus, KeychainService},
    openrouter::{
        AiCompletionRequest, AiKeyMetadata, AiModel, AiModelPricing, AiTask, AiUsage,
        OpenRouterClient, PrdInterviewCompletionRequest, SseComplete, prompt_version_for_task,
        redact_sensitive,
    },
};

pub mod activity;
pub mod chunking;
#[cfg(test)]
mod evaluation;
pub mod history;
pub mod interview;
pub mod keychain;
pub mod openrouter;

const AI_ACTIVITY_CHANGED_EVENT: &str = "markdowner://ai-activity-changed";
const AI_HISTORY_CHANGED_EVENT: &str = "markdowner://ai-history-changed";
const RECOVERY_CHUNK_INPUT_TOKENS: u32 = 4_000;
const PROACTIVE_CHUNK_INPUT_TOKENS: u32 = 12_000;
const MAX_OUTPUT_LIMIT_RECOVERY_ATTEMPTS: usize = 3;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation_id: Option<String>,
}

impl AiError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retry_after_seconds: None,
            generation_id: None,
        }
    }
}

impl fmt::Display for AiError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for AiError {}

#[derive(Clone)]
pub struct RequestScheduler {
    inner: Arc<RequestSchedulerInner>,
}

struct RequestSchedulerInner {
    app_slots: Arc<Semaphore>,
    active: Mutex<HashMap<String, ActiveRequest>>,
}

struct ActiveRequest {
    request_id: String,
    cancellation: CancellationToken,
}

impl RequestScheduler {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RequestSchedulerInner {
                app_slots: Arc::new(Semaphore::new(2)),
                active: Mutex::new(HashMap::new()),
            }),
        }
    }

    pub async fn acquire(
        &self,
        document_id: &str,
        request_id: &str,
    ) -> Result<RequestPermit, AiError> {
        self.acquire_scoped(&[document_id.to_string()], request_id)
            .await
    }

    #[cfg(test)]
    pub fn try_acquire(
        &self,
        document_id: &str,
        request_id: &str,
    ) -> Result<RequestPermit, AiError> {
        self.try_acquire_scoped(&[document_id.to_string()], request_id)
    }

    pub async fn acquire_scoped(
        &self,
        document_ids: &[String],
        request_id: &str,
    ) -> Result<RequestPermit, AiError> {
        self.try_acquire_scoped(document_ids, request_id)
    }

    pub fn try_acquire_scoped(
        &self,
        document_ids: &[String],
        request_id: &str,
    ) -> Result<RequestPermit, AiError> {
        let mut seen = HashSet::new();
        let document_ids = document_ids
            .iter()
            .filter(|document_id| seen.insert(document_id.as_str()))
            .cloned()
            .collect::<Vec<_>>();
        if document_ids.is_empty()
            || document_ids
                .iter()
                .any(|document_id| document_id.trim().is_empty())
        {
            return Err(AiError::new(
                "invalid_scope",
                "At least one document is required for an AI request.",
            ));
        }
        let mut active = self.inner.active.lock().map_err(|_| {
            AiError::new(
                "scheduler_error",
                "The AI request scheduler is unavailable.",
            )
        })?;
        if document_ids
            .iter()
            .any(|document_id| active.contains_key(document_id))
        {
            return Err(AiError::new(
                "document_busy",
                "This document already has an AI request in progress.",
            ));
        }
        let app_permit = self
            .inner
            .app_slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| {
                AiError::new(
                    "app_busy",
                    "Markdowner already has two AI requests in progress.",
                )
            })?;
        let cancellation = CancellationToken::new();
        for document_id in &document_ids {
            active.insert(
                document_id.clone(),
                ActiveRequest {
                    request_id: request_id.to_string(),
                    cancellation: cancellation.clone(),
                },
            );
        }
        Ok(RequestPermit {
            scheduler: self.clone(),
            document_ids,
            request_id: request_id.to_string(),
            cancellation,
            _app_permit: app_permit,
        })
    }

    pub fn cancel(&self, request_id: &str) -> bool {
        let Ok(active) = self.inner.active.lock() else {
            return false;
        };
        let Some(request) = active
            .values()
            .find(|request| request.request_id == request_id)
        else {
            return false;
        };
        request.cancellation.cancel();
        true
    }
}

impl Default for RequestScheduler {
    fn default() -> Self {
        Self::new()
    }
}

pub struct RequestPermit {
    scheduler: RequestScheduler,
    document_ids: Vec<String>,
    request_id: String,
    cancellation: CancellationToken,
    _app_permit: OwnedSemaphorePermit,
}

impl fmt::Debug for RequestPermit {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RequestPermit")
            .field("document_ids", &self.document_ids)
            .field("request_id", &self.request_id)
            .finish_non_exhaustive()
    }
}

impl RequestPermit {
    pub fn cancellation_token(&self) -> CancellationToken {
        self.cancellation.clone()
    }
}

impl Drop for RequestPermit {
    fn drop(&mut self) {
        let Ok(mut active) = self.scheduler.inner.active.lock() else {
            return;
        };
        for document_id in &self.document_ids {
            if active
                .get(document_id)
                .is_some_and(|request| request.request_id == self.request_id)
            {
                active.remove(document_id);
            }
        }
    }
}

const MODEL_CACHE_MAX_AGE_SECONDS: u64 = 24 * 60 * 60;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogCacheFile {
    saved_at: u64,
    models: Vec<AiModel>,
}

pub struct CatalogCache {
    path: PathBuf,
}

impl CatalogCache {
    pub fn new(app_data_dir: &Path) -> Self {
        Self {
            path: app_data_dir.join("ai").join("openrouter-models.json"),
        }
    }

    #[cfg(test)]
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn load(&self) -> Result<Vec<AiModel>, AiError> {
        let bytes = match fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(_) => {
                return Err(AiError::new(
                    "cache_error",
                    "Could not read the cached OpenRouter model catalog.",
                ));
            }
        };
        let cache: CatalogCacheFile = serde_json::from_slice(&bytes).map_err(|_| {
            AiError::new(
                "cache_error",
                "The cached OpenRouter model catalog is invalid.",
            )
        })?;
        let now = unix_timestamp();
        if now.saturating_sub(cache.saved_at) > MODEL_CACHE_MAX_AGE_SECONDS {
            return Ok(Vec::new());
        }
        Ok(cache.models)
    }

    pub fn save(&self, models: &[AiModel]) -> Result<(), AiError> {
        let parent = self.path.parent().ok_or_else(|| {
            AiError::new("cache_error", "The OpenRouter model cache path is invalid.")
        })?;
        fs::create_dir_all(parent).map_err(|_| {
            AiError::new(
                "cache_error",
                "Could not create the OpenRouter model cache.",
            )
        })?;
        let payload = serde_json::to_vec(&CatalogCacheFile {
            saved_at: unix_timestamp(),
            models: models.to_vec(),
        })
        .map_err(|_| {
            AiError::new(
                "cache_error",
                "Could not encode the OpenRouter model cache.",
            )
        })?;
        let temporary = self.path.with_extension("json.tmp");
        fs::write(&temporary, payload).map_err(|_| {
            AiError::new("cache_error", "Could not write the OpenRouter model cache.")
        })?;
        fs::rename(&temporary, &self.path).map_err(|_| {
            AiError::new(
                "cache_error",
                "Could not finish the OpenRouter model cache update.",
            )
        })
    }
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub struct AiState {
    keychain: KeychainService,
    client: OpenRouterClient,
    scheduler: RequestScheduler,
    cache: CatalogCache,
    history: HistoryRepository,
    activity: ActivityRegistry,
    results: Mutex<HashMap<String, ValidatedDocument>>,
}

impl AiState {
    pub fn new(app_data_dir: PathBuf) -> Result<Self, AiError> {
        let history = HistoryRepository::open(&app_data_dir.join("ai").join("history.sqlite3"));
        Ok(Self {
            keychain: KeychainService::system(),
            client: OpenRouterClient::new()?,
            scheduler: RequestScheduler::new(),
            cache: CatalogCache::new(&app_data_dir),
            history,
            activity: ActivityRegistry::default(),
            results: Mutex::new(HashMap::new()),
        })
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRunRequest {
    pub request_id: String,
    pub document_id: String,
    pub source: String,
    pub selection: Option<ByteRange>,
    pub task: AiTask,
    pub model: String,
    pub target_language: Option<String>,
    pub instruction: Option<String>,
    pub zdr_only: bool,
    pub max_output_tokens: u32,
    #[serde(default = "default_record_history")]
    pub record_history: bool,
    #[serde(default)]
    pub scope: Option<AiRunScope>,
    #[serde(default)]
    pub interview_id: Option<String>,
    #[serde(default)]
    pub resume: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranslationCheckpointResult {
    proposed_markdown: String,
    detected_source_language: Option<String>,
    target_language: String,
    warnings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiInterviewStartRequest {
    pub request_id: String,
    pub document_id: String,
    pub source: String,
    pub model: String,
    pub instruction: Option<String>,
    pub zdr_only: bool,
    pub max_output_tokens: u32,
    pub scope: Option<AiRunScope>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiInterviewContinueRequest {
    pub request_id: String,
    pub source: String,
    pub answer: Option<String>,
    pub instruction: Option<String>,
    pub zdr_only: bool,
    pub max_output_tokens: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiInterviewUpdateAnswerRequest {
    pub request_id: String,
    pub position: u32,
    pub answer: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiInterviewFinishRequest {
    pub request_id: String,
    pub answer: Option<String>,
}

fn default_record_history() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum AiStreamEvent {
    Started {
        request_id: String,
        generation_id: Option<String>,
    },
    Progress {
        request_id: String,
        received_characters: usize,
    },
    Completed {
        request_id: String,
        generation_id: Option<String>,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiValidationIssue {
    pub code: String,
    pub message: String,
    pub segment_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRunResult {
    pub request_id: String,
    pub document_id: String,
    pub task: AiTask,
    pub model: String,
    pub generation_id: Option<String>,
    pub result: Option<ValidatedDocument>,
    pub validation_issues: Vec<AiValidationIssue>,
    pub raw_diagnostic: Option<String>,
    pub usage: Option<AiUsage>,
    pub retry_after_seconds: Option<u64>,
}

struct CompletionOutcome {
    result: Option<ValidatedDocument>,
    validation_issues: Vec<AiValidationIssue>,
    raw_diagnostic: Option<String>,
    generation_id: Option<String>,
    usage: Option<AiUsage>,
    content: String,
}

#[tauri::command]
pub fn ai_key_status(state: State<'_, AiState>) -> Result<AiKeyStatus, AiError> {
    state.keychain.status()
}

#[tauri::command]
pub fn ai_save_key(state: State<'_, AiState>, api_key: String) -> Result<AiKeyStatus, AiError> {
    state.keychain.save(&api_key)
}

#[tauri::command]
pub async fn ai_verify_key(state: State<'_, AiState>) -> Result<AiKeyMetadata, AiError> {
    let secret = state.keychain.read_secret()?;
    let status = state.keychain.status()?;
    state.client.verify_key(&secret, status.masked_label).await
}

#[tauri::command]
pub fn ai_delete_key(state: State<'_, AiState>) -> Result<AiKeyStatus, AiError> {
    state.keychain.delete()
}

#[tauri::command]
pub async fn ai_list_models(state: State<'_, AiState>) -> Result<Vec<AiModel>, AiError> {
    let secret = state.keychain.read_secret()?;
    match state.client.list_models(&secret).await {
        Ok(models) => {
            let _ = state.cache.save(&models);
            Ok(models)
        }
        Err(error)
            if matches!(
                error.code.as_str(),
                "network_error" | "request_timeout" | "provider_error" | "provider_unavailable"
            ) =>
        {
            let cached = state.cache.load()?;
            if cached.is_empty() {
                Err(error)
            } else {
                Ok(cached)
            }
        }
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub async fn ai_model_pricing(
    state: State<'_, AiState>,
    model_id: String,
    zdr_only: bool,
) -> Result<AiModelPricing, AiError> {
    let secret = state.keychain.read_secret()?;
    state
        .client
        .model_pricing(&secret, &model_id, zdr_only)
        .await
}

#[tauri::command]
pub fn ai_cancel(app: AppHandle, state: State<'_, AiState>, request_id: String) -> bool {
    if !state.activity.mark_cancelling(&request_id).unwrap_or(false) {
        return false;
    }
    let cancelled = if state.scheduler.cancel(&request_id) {
        true
    } else {
        let _ = state.activity.finish(&request_id);
        false
    };
    emit_activity_changed(&app);
    cancelled
}

#[tauri::command]
pub fn ai_list_active(state: State<'_, AiState>) -> Result<Vec<ActiveAiRun>, AiError> {
    state.activity.list()
}

#[tauri::command]
pub fn ai_history_page(
    state: State<'_, AiState>,
    page: u32,
    page_size: u32,
) -> Result<HistoryPage, AiError> {
    state.history.store()?.page(page, page_size)
}

#[tauri::command]
pub fn ai_history_detail(
    state: State<'_, AiState>,
    request_id: String,
) -> Result<Option<StoredRunDetail>, AiError> {
    state.history.store()?.detail(&request_id)
}

#[tauri::command]
pub async fn ai_interview_start(
    app: AppHandle,
    state: State<'_, AiState>,
    request: AiInterviewStartRequest,
) -> Result<InterviewSession, AiError> {
    validate_interview_start(&request)?;
    let scope = request.scope.clone().unwrap_or_else(|| AiRunScope::Document {
        target: AiDocumentRef {
            document_id: request.document_id.clone(),
            path: None,
            label: request.document_id.clone(),
        },
    });
    let envelope = AiDocumentEnvelope::new(&request.document_id, &request.source, None)
        .map_err(|error| AiError::new("invalid_document", error.to_string()))?;
    let permit = state
        .scheduler
        .acquire(&request.document_id, &request.request_id)
        .await?;
    let mut session = InterviewSession {
        request_id: request.request_id.clone(),
        document_id: request.document_id.clone(),
        model: request.model.clone(),
        scope: scope.clone(),
        source_hash: envelope.revision_hash.clone(),
        status: InterviewStatus::AwaitingModel,
        turns: Vec::new(),
    };
    let run = StoredRun {
        id: request.request_id.clone(),
        task: AiTask::Prd,
        model: request.model.clone(),
        status: RunStatus::Running,
        scope_json: serde_json::to_string(&scope)
            .map_err(|_| AiError::new("invalid_scope", "Could not save the PRD interview scope."))?,
        source_hash: envelope.revision_hash.clone(),
        prompt_version: PRD_INTERVIEW_PROMPT_VERSION.to_string(),
        instruction: request.instruction.clone(),
        target_language: None,
        max_output_tokens: Some(request.max_output_tokens),
        zdr_only: Some(request.zdr_only),
        result_json: None,
        error_json: None,
        usage_json: None,
        started_at: i64::try_from(unix_timestamp()).unwrap_or(i64::MAX),
        finished_at: None,
    };
    state
        .history
        .store()?
        .create_interview(&run, InterviewStatus::AwaitingModel.as_str())?;
    emit_history_changed(&app);
    start_interview_activity(&state, &app, &session)?;
    let completion = generate_interview_turn(
        &state,
        &session,
        &envelope,
        request.instruction.as_deref(),
        request.zdr_only,
        request.max_output_tokens,
        &permit.cancellation_token(),
    )
    .await;
    let _ = state.activity.finish(&request.request_id);
    emit_activity_changed(&app);
    let model_turn = completion?;
    session.apply_model_turn(model_turn)?;
    let turn = session.to_stored_turn(0)?;
    state.history.store()?.append_interview_turn(
        &request.request_id,
        &turn,
        InterviewStatus::AwaitingAnswer.as_str(),
    )?;
    emit_history_changed(&app);
    Ok(session)
}

#[tauri::command]
pub async fn ai_interview_answer(
    app: AppHandle,
    state: State<'_, AiState>,
    request: AiInterviewContinueRequest,
) -> Result<InterviewSession, AiError> {
    continue_interview(app, state, request, false).await
}

#[tauri::command]
pub async fn ai_interview_skip(
    app: AppHandle,
    state: State<'_, AiState>,
    request: AiInterviewContinueRequest,
) -> Result<InterviewSession, AiError> {
    continue_interview(app, state, request, true).await
}

#[tauri::command]
pub fn ai_interview_update_answer(
    app: AppHandle,
    state: State<'_, AiState>,
    request: AiInterviewUpdateAnswerRequest,
) -> Result<InterviewSession, AiError> {
    if request.answer.trim().is_empty() {
        return Err(AiError::new("answer_required", "Enter an answer before saving."));
    }
    let store = state.history.store()?;
    store.update_interview_answer(
        &request.request_id,
        request.position,
        request.answer.trim(),
    )?;
    emit_history_changed(&app);
    load_interview(store, &request.request_id)
}

#[tauri::command]
pub fn ai_interview_finish(
    app: AppHandle,
    state: State<'_, AiState>,
    request: AiInterviewFinishRequest,
) -> Result<InterviewSession, AiError> {
    let store = state.history.store()?;
    let mut session = load_interview(store, &request.request_id)?;
    if session.status != InterviewStatus::AwaitingAnswer {
        return Err(AiError::new(
            "invalid_interview_transition",
            "Resume the PRD interview before finishing it.",
        ));
    }
    let current = session.current_turn().ok_or_else(|| {
        AiError::new("interview_turn_not_found", "The current PRD question is missing.")
    })?;
    let position = current.position;
    let answer = request.answer.as_deref().map(str::trim).filter(|value| !value.is_empty());
    store.finish_interview(
        &request.request_id,
        position,
        answer,
        answer.is_none(),
        InterviewStatus::ReadyToGenerate.as_str(),
    )?;
    session.answer(answer.unwrap_or_default(), true)?;
    emit_history_changed(&app);
    Ok(session)
}

#[tauri::command]
pub fn ai_interview_resume(
    state: State<'_, AiState>,
    request_id: String,
) -> Result<Option<InterviewSession>, AiError> {
    let Some(stored) = state.history.store()?.interview(&request_id)? else {
        return Ok(None);
    };
    InterviewSession::from_stored(stored).map(Some)
}

async fn continue_interview(
    app: AppHandle,
    state: State<'_, AiState>,
    request: AiInterviewContinueRequest,
    skip: bool,
) -> Result<InterviewSession, AiError> {
    if request.max_output_tokens == 0 || request.max_output_tokens > 100_000 {
        return Err(AiError::new(
            "invalid_output_limit",
            "Maximum output tokens must be between 1 and 100,000.",
        ));
    }
    let store = state.history.store()?;
    let mut session = load_interview(store, &request.request_id)?;
    if session.status != InterviewStatus::AwaitingAnswer {
        return Err(AiError::new(
            "invalid_interview_transition",
            "Resume the PRD interview before answering it.",
        ));
    }
    let envelope = AiDocumentEnvelope::new(&session.document_id, &request.source, None)
        .map_err(|error| AiError::new("invalid_document", error.to_string()))?;
    if envelope.revision_hash != session.source_hash {
        return Err(AiError::new(
            "stale_document",
            "The document changed after this interview started. Start a new interview for the current draft.",
        ));
    }
    let current_position = session
        .current_turn()
        .map(|turn| turn.position)
        .ok_or_else(|| AiError::new("interview_turn_not_found", "The current PRD question is missing."))?;
    let persisted_answer = if skip {
        session.skip()?;
        None
    } else {
        let answer = request.answer.as_deref().map(str::trim).unwrap_or_default();
        session.answer(answer, false)?;
        Some(answer.to_string())
    };
    let permit = state
        .scheduler
        .acquire(&session.document_id, &request.request_id)
        .await?;
    start_interview_activity(&state, &app, &session)?;
    let completion = generate_interview_turn(
        &state,
        &session,
        &envelope,
        request.instruction.as_deref(),
        request.zdr_only,
        request.max_output_tokens,
        &permit.cancellation_token(),
    )
    .await;
    let _ = state.activity.finish(&request.request_id);
    emit_activity_changed(&app);
    let model_turn = completion?;
    session.apply_model_turn(model_turn)?;
    let next_position = session
        .turns
        .last()
        .map(|turn| turn.position)
        .ok_or_else(|| AiError::new("interview_turn_not_found", "The next PRD question is missing."))?;
    let next_turn = session.to_stored_turn(next_position)?;
    store.answer_and_append_interview_turn(
        &request.request_id,
        current_position,
        persisted_answer.as_deref(),
        skip,
        &next_turn,
        InterviewStatus::AwaitingAnswer.as_str(),
    )?;
    emit_history_changed(&app);
    Ok(session)
}

fn validate_interview_start(request: &AiInterviewStartRequest) -> Result<(), AiError> {
    if request.request_id.trim().is_empty() || request.document_id.trim().is_empty() {
        return Err(AiError::new(
            "invalid_request",
            "The PRD interview and document IDs are required.",
        ));
    }
    if request.source.trim().is_empty() {
        return Err(AiError::new(
            "empty_document",
            "Add PRD text before starting an interview.",
        ));
    }
    if request.model.trim().is_empty()
        || request.model.len() > 200
        || request.model.chars().any(char::is_whitespace)
    {
        return Err(AiError::new("invalid_model", "Select a valid OpenRouter model."));
    }
    if request.max_output_tokens == 0 || request.max_output_tokens > 100_000 {
        return Err(AiError::new(
            "invalid_output_limit",
            "Maximum output tokens must be between 1 and 100,000.",
        ));
    }
    Ok(())
}

fn load_interview(
    store: &history::HistoryStore,
    request_id: &str,
) -> Result<InterviewSession, AiError> {
    let stored = store.interview(request_id)?.ok_or_else(|| {
        AiError::new("interview_not_found", "The PRD interview is no longer available.")
    })?;
    InterviewSession::from_stored(stored)
}

fn start_interview_activity(
    state: &AiState,
    app: &AppHandle,
    session: &InterviewSession,
) -> Result<(), AiError> {
    state.activity.start(ActiveAiRun {
        request_id: session.request_id.clone(),
        task: AiTask::Prd,
        model: session.model.clone(),
        scope: session.scope.clone(),
        status: ActiveStatus::Running,
        progress: ActivityProgress {
            stage: "interviewing".to_string(),
            label: Some("Preparing the next question".to_string()),
            ..ActivityProgress::default()
        },
        started_at: i64::try_from(unix_timestamp()).unwrap_or(i64::MAX),
        cancelable: true,
    })?;
    emit_activity_changed(app);
    Ok(())
}

async fn generate_interview_turn(
    state: &AiState,
    session: &InterviewSession,
    envelope: &AiDocumentEnvelope,
    instruction: Option<&str>,
    zdr_only: bool,
    max_output_tokens: u32,
    cancellation: &CancellationToken,
) -> Result<interview::ModelTurn, AiError> {
    let document = serde_json::to_value(envelope).map_err(|_| {
        AiError::new(
            "invalid_document",
            "Could not prepare the document for the PRD interview.",
        )
    })?;
    let request = PrdInterviewCompletionRequest {
        model: session.model.clone(),
        document,
        interview_history: session.history_data(),
        instruction: instruction.map(str::to_string),
        zdr_only,
        max_output_tokens,
    };
    let secret = state.keychain.read_secret()?;
    let (turn, _) = state
        .client
        .stream_interview_turn(&secret, &request, cancellation, |_| {})
        .await?;
    Ok(turn)
}

#[tauri::command]
pub fn ai_history_delete(
    app: AppHandle,
    state: State<'_, AiState>,
    request_id: String,
) -> Result<bool, AiError> {
    let deleted = state.history.store()?.delete(&request_id)?;
    if deleted {
        emit_history_changed(&app);
    }
    Ok(deleted)
}

#[tauri::command]
pub fn ai_history_clear(app: AppHandle, state: State<'_, AiState>) -> Result<u32, AiError> {
    let cleared = state.history.store()?.clear()?;
    if cleared > 0 {
        emit_history_changed(&app);
    }
    Ok(cleared)
}

#[tauri::command]
pub fn ai_render_selected_operations(
    state: State<'_, AiState>,
    request_id: String,
    operation_ids: Vec<String>,
) -> Result<String, AiError> {
    let results = state
        .results
        .lock()
        .map_err(|_| AiError::new("result_unavailable", "The AI result is unavailable."))?;
    let result = results.get(&request_id).ok_or_else(|| {
        AiError::new(
            "result_unavailable",
            "This transient AI result is no longer available.",
        )
    })?;
    result.render_selected(&operation_ids).map_err(|error| {
        AiError::new(
            "invalid_operation_selection",
            format!("Could not render the selected AI changes: {error}"),
        )
    })
}

#[tauri::command]
pub fn ai_discard_result(state: State<'_, AiState>, request_id: String) {
    if let Ok(mut results) = state.results.lock() {
        results.remove(&request_id);
    }
}

fn prepare_run_envelope(request: &AiRunRequest) -> Result<AiDocumentEnvelope, AiError> {
    let envelope = AiDocumentEnvelope::with_policy(
        &request.document_id,
        &request.source,
        request.selection,
        protection_policy_for_task(request.task),
    )
    .map_err(|error| AiError::new("invalid_document", error.to_string()))?;
    if request.selection.is_some() && !envelope.selection_has_editable_bytes() {
        return Err(AiError::new(
            "selection_not_editable",
            "The selection contains only protected Markdown and cannot be changed.",
        ));
    }
    Ok(envelope)
}

#[tauri::command]
pub async fn ai_run(
    app: AppHandle,
    state: State<'_, AiState>,
    mut request: AiRunRequest,
    on_event: Channel<AiStreamEvent>,
) -> Result<AiRunResult, AiError> {
    validate_run_request(&request)?;
    let envelope = prepare_run_envelope(&request)?;
    if request.resume {
        prepare_translation_resume(&state, &request, &envelope)?;
    }
    if let Some(interview_id) = request.interview_id.as_deref() {
        let interview_context = prepare_interview_generation(&state, &request, &envelope, interview_id)?;
        request.instruction = Some(match request.instruction.take() {
            Some(instruction) => format!("{instruction}\n\n{interview_context}"),
            None => interview_context,
        });
    }
    let should_record = request.record_history || request.interview_id.is_some();
    let permit = state
        .scheduler
        .acquire(&request.document_id, &request.request_id)
        .await?;
    if request.resume {
        state.history.store()?.resume_run(&request.request_id)?;
    }
    let cancellation = permit.cancellation_token();
    let document = serde_json::to_value(&envelope).map_err(|_| {
        AiError::new(
            "invalid_document",
            "Could not prepare the document for the AI request.",
        )
    })?;
    state.activity.start(ActiveAiRun {
        request_id: request.request_id.clone(),
        task: request.task,
        model: request.model.clone(),
        scope: request_scope(&request),
        status: ActiveStatus::Running,
        progress: ActivityProgress {
            stage: "preparing".to_string(),
            ..ActivityProgress::default()
        },
        started_at: i64::try_from(unix_timestamp()).unwrap_or(i64::MAX),
        cancelable: true,
    })?;
    emit_activity_changed(&app);
    if should_record {
        if request.interview_id.is_none() && !request.resume {
            record_history_start(&state, &request, &envelope);
        }
        emit_history_changed(&app);
    }
    let completion_request = AiCompletionRequest {
        task: request.task,
        model: request.model.clone(),
        document,
        selection: request.selection.is_some(),
        target_language: request.target_language.clone(),
        instruction: request.instruction.clone(),
        zdr_only: request.zdr_only,
        max_output_tokens: request.max_output_tokens,
    };
    let _ = on_event.send(AiStreamEvent::Started {
        request_id: request.request_id.clone(),
        generation_id: None,
    });
    let secret = match state.keychain.read_secret() {
        Ok(secret) => secret,
        Err(error) => {
            if should_record {
                record_history_error(&state, &request.request_id, RunStatus::Failed, &error);
                restore_interview_for_retry(&state, request.interview_id.as_deref());
            }
            let _ = state.activity.finish(&request.request_id);
            emit_activity_changed(&app);
            if should_record {
                emit_history_changed(&app);
            }
            return Err(error);
        }
    };
    let mut last_progress = 0;
    if request.task == AiTask::Translation {
        return run_chunked_translation(
            &app,
            &state,
            request,
            envelope,
            on_event,
            cancellation,
            secret,
        )
        .await;
    }
    let proactive_chunks = should_prechunk_request(
        request.task,
        request.selection.is_some(),
        request.source.len(),
    );
    let initial_outcome = if proactive_chunks {
        None
    } else {
        let activity = state.activity.clone();
        let activity_request_id = request.request_id.clone();
        let activity_app = app.clone();
        let completion = state
            .client
            .stream_completion(
                &secret,
                &completion_request,
                &cancellation,
                |received_characters| {
                    if received_characters >= last_progress + 64 {
                        last_progress = received_characters;
                        let _ = activity.progress(
                            &activity_request_id,
                            ActivityProgress::streaming(received_characters),
                        );
                        emit_activity_changed(&activity_app);
                        let _ = on_event.send(AiStreamEvent::Progress {
                            request_id: request.request_id.clone(),
                            received_characters,
                        });
                    }
                },
            )
            .await;
        let completion = match completion {
            Ok(completion) => completion,
            Err(error) if error.code == "cancelled" => {
                let _ = on_event.send(AiStreamEvent::Cancelled {
                    request_id: request.request_id.clone(),
                });
                if should_record {
                    record_history_error(
                        &state,
                        &request.request_id,
                        RunStatus::Cancelled,
                        &error,
                    );
                    restore_interview_for_retry(&state, request.interview_id.as_deref());
                }
                let _ = state.activity.finish(&request.request_id);
                emit_activity_changed(&app);
                if should_record {
                    emit_history_changed(&app);
                }
                return Err(error);
            }
            Err(error) => {
                let _ = on_event.send(AiStreamEvent::Failed {
                    request_id: request.request_id.clone(),
                    code: error.code.clone(),
                    message: error.message.clone(),
                });
                if should_record {
                    record_history_error(&state, &request.request_id, RunStatus::Failed, &error);
                    restore_interview_for_retry(&state, request.interview_id.as_deref());
                }
                let _ = state.activity.finish(&request.request_id);
                emit_activity_changed(&app);
                if should_record {
                    emit_history_changed(&app);
                }
                return Err(error);
            }
        };
        Some(completion_outcome(&envelope, &request, completion))
    };
    let needs_recovery = proactive_chunks
        || initial_outcome
            .as_ref()
            .is_some_and(|outcome| response_is_truncated(&outcome.validation_issues));
    let outcome = if needs_recovery {
        let _ = state.activity.progress(
            &request.request_id,
            ActivityProgress {
                stage: "recovering".to_string(),
                label: Some(if proactive_chunks {
                    "Processing large document in chunks".to_string()
                } else {
                    "Retrying with smaller document chunks".to_string()
                }),
                ..ActivityProgress::default()
            },
        );
        emit_activity_changed(&app);
        recover_truncated_completion(
            &state,
            &request,
            &envelope,
            &secret,
            &cancellation,
            initial_outcome.unwrap_or_else(empty_completion_outcome),
        )
        .await
    } else {
        Ok(initial_outcome.unwrap_or_else(empty_completion_outcome))
    };
    drop(secret);
    let outcome = match outcome {
        Ok(outcome) => outcome,
        Err(error) if error.code == "cancelled" => {
            let _ = on_event.send(AiStreamEvent::Cancelled {
                request_id: request.request_id.clone(),
            });
            if should_record {
                record_history_error(&state, &request.request_id, RunStatus::Cancelled, &error);
                restore_interview_for_retry(&state, request.interview_id.as_deref());
            }
            let _ = state.activity.finish(&request.request_id);
            emit_activity_changed(&app);
            if should_record {
                emit_history_changed(&app);
            }
            return Err(error);
        }
        Err(error) => {
            let _ = on_event.send(AiStreamEvent::Failed {
                request_id: request.request_id.clone(),
                code: error.code.clone(),
                message: error.message.clone(),
            });
            if should_record {
                record_history_error(&state, &request.request_id, RunStatus::Failed, &error);
                restore_interview_for_retry(&state, request.interview_id.as_deref());
            }
            let _ = state.activity.finish(&request.request_id);
            emit_activity_changed(&app);
            if should_record {
                emit_history_changed(&app);
            }
            return Err(error);
        }
    };
    if let Some(validated) = &outcome.result {
        state
            .results
            .lock()
            .map_err(|_| AiError::new("result_unavailable", "Could not retain the AI result."))?
            .insert(request.request_id.clone(), validated.clone());
    }
    let _ = on_event.send(AiStreamEvent::Completed {
        request_id: request.request_id.clone(),
        generation_id: outcome.generation_id.clone(),
    });
    let history_result = outcome
        .result
        .as_ref()
        .and_then(|validated| serde_json::to_string(validated).ok());
    let history_usage = outcome
        .usage
        .as_ref()
        .and_then(|usage| serde_json::to_string(usage).ok());
    let (history_status, history_error) =
        history_record_for_validation(outcome.result.is_some(), &outcome.validation_issues);
    if should_record && let Ok(store) = state.history.store() {
        let _ = store.finish_run_with_usage(
            &request.request_id,
            history_status,
            history_result.as_deref(),
            history_error.as_deref(),
            history_usage.as_deref(),
        );
        if let Some(interview_id) = request.interview_id.as_deref() {
            if history_status == RunStatus::Completed {
                let _ =
                    store.set_interview_status(interview_id, InterviewStatus::Completed.as_str());
            } else {
                let _ = store.set_interview_status(
                    interview_id,
                    InterviewStatus::ReadyToGenerate.as_str(),
                );
            }
        }
    }
    let _ = state.activity.finish(&request.request_id);
    emit_activity_changed(&app);
    if should_record {
        emit_history_changed(&app);
    }
    Ok(AiRunResult {
        request_id: request.request_id,
        document_id: request.document_id,
        task: request.task,
        model: request.model,
        generation_id: outcome.generation_id,
        result: outcome.result,
        validation_issues: outcome.validation_issues,
        raw_diagnostic: outcome.raw_diagnostic,
        usage: outcome.usage,
        retry_after_seconds: None,
    })
}

fn completion_outcome(
    envelope: &AiDocumentEnvelope,
    request: &AiRunRequest,
    completion: SseComplete,
) -> CompletionOutcome {
    let (result, validation_issues) = validate_provider_result(
        envelope,
        request.task,
        &completion.content,
        request.target_language.as_deref(),
        completion.finish_reason.as_deref(),
    );
    CompletionOutcome {
        raw_diagnostic: result
            .is_none()
            .then(|| redact_sensitive(&completion.content, None)),
        result,
        validation_issues,
        generation_id: completion.generation_id,
        usage: completion.usage,
        content: completion.content,
    }
}

fn empty_completion_outcome() -> CompletionOutcome {
    CompletionOutcome {
        result: None,
        validation_issues: Vec::new(),
        raw_diagnostic: None,
        generation_id: None,
        usage: None,
        content: String::new(),
    }
}

fn outcome_has_provider_attempt(outcome: &CompletionOutcome) -> bool {
    !outcome.content.is_empty()
        || outcome.generation_id.is_some()
        || outcome.usage.is_some()
        || outcome.result.is_some()
        || !outcome.validation_issues.is_empty()
        || outcome.raw_diagnostic.is_some()
}

fn response_is_truncated(issues: &[AiValidationIssue]) -> bool {
    issues
        .iter()
        .any(|issue| issue.code == "response_truncated")
}

async fn recover_truncated_completion(
    state: &AiState,
    request: &AiRunRequest,
    envelope: &AiDocumentEnvelope,
    secret: &str,
    cancellation: &CancellationToken,
    initial: CompletionOutcome,
) -> Result<CompletionOutcome, AiError> {
    match request.task {
        AiTask::Summary => {
            recover_chunked_summary(state, request, envelope, secret, cancellation, initial).await
        }
        AiTask::Prd => {
            recover_chunked_operations(state, request, envelope, secret, cancellation, initial)
                .await
        }
        AiTask::Custom if envelope.selection.is_none() => {
            recover_chunked_operations(state, request, envelope, secret, cancellation, initial)
                .await
        }
        AiTask::Custom => {
            retry_with_higher_output_limit(state, request, envelope, secret, cancellation, initial)
                .await
        }
        AiTask::Translation => Ok(initial),
    }
}

async fn recover_chunked_summary(
    state: &AiState,
    request: &AiRunRequest,
    envelope: &AiDocumentEnvelope,
    secret: &str,
    cancellation: &CancellationToken,
    initial: CompletionOutcome,
) -> Result<CompletionOutcome, AiError> {
    let planned =
        plan_translation_chunks(&request.source, recovery_chunk_limit(request.source.len()))?;
    if planned.len() < 2 {
        return if outcome_has_provider_attempt(&initial) {
            retry_with_higher_output_limit(
                state,
                request,
                envelope,
                secret,
                cancellation,
                initial,
            )
            .await
        } else {
            stream_with_output_limit_recovery(state, request, envelope, secret, cancellation).await
        };
    }

    let mut usage = initial.usage;
    let mut generation_id = initial.generation_id;
    let mut responses = Vec::with_capacity(planned.len());
    for chunk in planned {
        let chunk_envelope = AiDocumentEnvelope::with_policy(
            format!("{}#summary-{}", request.document_id, chunk.index),
            chunk.source,
            None,
            protection_policy_for_task(AiTask::Summary),
        )
        .map_err(|error| AiError::new("invalid_document", error.to_string()))?;
        let outcome = stream_with_output_limit_recovery(
            state,
            request,
            &chunk_envelope,
            secret,
            cancellation,
        )
        .await?;
        usage = merge_usage(usage, outcome.usage.clone());
        generation_id = outcome.generation_id.clone().or(generation_id);
        if outcome.result.is_none() {
            return Ok(CompletionOutcome {
                usage,
                generation_id,
                ..outcome
            });
        }
        responses.push(
            serde_json::from_str::<SummaryResponse>(&outcome.content).map_err(|_| {
                AiError::new(
                    "summary_recovery_failed",
                    "A validated summary chunk could not be combined.",
                )
            })?,
        );
    }
    let response = merge_chunked_summary_responses(responses)?;
    match validate_summary_response(envelope, response, request.target_language.as_deref()) {
        Ok(result) => Ok(CompletionOutcome {
            result: Some(result),
            validation_issues: Vec::new(),
            raw_diagnostic: None,
            generation_id,
            usage,
            content: String::new(),
        }),
        Err(error) => Ok(CompletionOutcome {
            result: None,
            validation_issues: validation_issues(error),
            raw_diagnostic: None,
            generation_id,
            usage,
            content: String::new(),
        }),
    }
}

async fn recover_chunked_operations(
    state: &AiState,
    request: &AiRunRequest,
    envelope: &AiDocumentEnvelope,
    secret: &str,
    cancellation: &CancellationToken,
    initial: CompletionOutcome,
) -> Result<CompletionOutcome, AiError> {
    let planned =
        plan_structured_document_chunks(envelope, recovery_chunk_limit(request.source.len()))?;
    if planned.len() < 2 {
        return if outcome_has_provider_attempt(&initial) {
            retry_with_higher_output_limit(
                state,
                request,
                envelope,
                secret,
                cancellation,
                initial,
            )
            .await
        } else {
            stream_with_output_limit_recovery(state, request, envelope, secret, cancellation).await
        };
    }

    let mut usage = initial.usage;
    let mut generation_id = initial.generation_id;
    let mut responses = Vec::with_capacity(planned.len());
    for chunk in planned {
        let outcome = stream_with_output_limit_recovery(
            state,
            request,
            &chunk.envelope,
            secret,
            cancellation,
        )
        .await?;
        usage = merge_usage(usage, outcome.usage.clone());
        generation_id = outcome.generation_id.clone().or(generation_id);
        if outcome.result.is_none() {
            return Ok(CompletionOutcome {
                usage,
                generation_id,
                ..outcome
            });
        }
        responses.push(
            serde_json::from_str::<PrdResponse>(&outcome.content).map_err(|_| {
                AiError::new(
                    "document_recovery_failed",
                    "A validated document chunk could not be combined.",
                )
            })?,
        );
    }
    let response = merge_chunked_prd_responses(responses);
    match validate_prd_response(envelope, response) {
        Ok(result) => Ok(CompletionOutcome {
            result: Some(result),
            validation_issues: Vec::new(),
            raw_diagnostic: None,
            generation_id,
            usage,
            content: String::new(),
        }),
        Err(error) => Ok(CompletionOutcome {
            result: None,
            validation_issues: validation_issues(error),
            raw_diagnostic: None,
            generation_id,
            usage,
            content: String::new(),
        }),
    }
}

async fn stream_with_output_limit_recovery(
    state: &AiState,
    request: &AiRunRequest,
    envelope: &AiDocumentEnvelope,
    secret: &str,
    cancellation: &CancellationToken,
) -> Result<CompletionOutcome, AiError> {
    let completion = stream_recovery_completion(
        state,
        request,
        envelope,
        secret,
        cancellation,
        request.max_output_tokens,
    )
    .await?;
    let initial = completion_outcome(envelope, request, completion);
    if response_is_truncated(&initial.validation_issues) {
        retry_with_higher_output_limit(state, request, envelope, secret, cancellation, initial)
            .await
    } else {
        Ok(initial)
    }
}

async fn retry_with_higher_output_limit(
    state: &AiState,
    request: &AiRunRequest,
    envelope: &AiDocumentEnvelope,
    secret: &str,
    cancellation: &CancellationToken,
    mut outcome: CompletionOutcome,
) -> Result<CompletionOutcome, AiError> {
    let mut output_limit = request.max_output_tokens;
    for _ in 0..MAX_OUTPUT_LIMIT_RECOVERY_ATTEMPTS {
        if !response_is_truncated(&outcome.validation_issues) {
            break;
        }
        let Some(next_limit) = next_output_limit(output_limit) else {
            break;
        };
        let previous_usage = outcome.usage.take();
        let previous_generation_id = outcome.generation_id.take();
        let completion =
            stream_recovery_completion(state, request, envelope, secret, cancellation, next_limit)
                .await?;
        outcome = completion_outcome(envelope, request, completion);
        outcome.usage = merge_usage(previous_usage, outcome.usage);
        outcome.generation_id = outcome.generation_id.or(previous_generation_id);
        output_limit = next_limit;
    }
    Ok(outcome)
}

async fn stream_recovery_completion(
    state: &AiState,
    request: &AiRunRequest,
    envelope: &AiDocumentEnvelope,
    secret: &str,
    cancellation: &CancellationToken,
    max_output_tokens: u32,
) -> Result<SseComplete, AiError> {
    let document = serde_json::to_value(envelope).map_err(|_| {
        AiError::new(
            "invalid_document",
            "Could not prepare a recovery chunk for OpenRouter.",
        )
    })?;
    state
        .client
        .stream_completion(
            secret,
            &AiCompletionRequest {
                task: request.task,
                model: request.model.clone(),
                document,
                selection: envelope.selection.is_some(),
                target_language: request.target_language.clone(),
                instruction: request.instruction.clone(),
                zdr_only: request.zdr_only,
                max_output_tokens,
            },
            cancellation,
            |_| {},
        )
        .await
}

fn recovery_chunk_limit(source_bytes: usize) -> u32 {
    let estimated = u32::try_from(source_bytes.saturating_add(3) / 4).unwrap_or(u32::MAX);
    (estimated / 2).clamp(1, RECOVERY_CHUNK_INPUT_TOKENS)
}

fn should_prechunk_request(task: AiTask, selection: bool, source_bytes: usize) -> bool {
    !selection
        && matches!(task, AiTask::Prd | AiTask::Summary | AiTask::Custom)
        && u32::try_from(source_bytes.saturating_add(3) / 4).unwrap_or(u32::MAX)
            > PROACTIVE_CHUNK_INPUT_TOKENS
}

async fn run_chunked_translation(
    app: &AppHandle,
    state: &AiState,
    request: AiRunRequest,
    envelope: AiDocumentEnvelope,
    on_event: Channel<AiStreamEvent>,
    cancellation: CancellationToken,
    secret: String,
) -> Result<AiRunResult, AiError> {
    let should_record = request.record_history || request.interview_id.is_some() || request.resume;
    let mut queue = VecDeque::from(plan_translation_chunks(&request.source, 12_000)?);
    let mut total_chunks = u32::try_from(queue.len()).unwrap_or(u32::MAX);
    let mut completed_chunks = 0_u32;
    let mut translated = Vec::new();
    let mut usage: Option<AiUsage> = None;
    let mut generation_id = None;
    let mut detected_source_language = None;
    let mut warnings = Vec::new();
    let target_language = request.target_language.clone().unwrap_or_default();
    let completed_checkpoints = if request.resume {
        match state
            .history
            .store()
            .and_then(|store| {
                store.completed_translation_chunks(&request.request_id, &request.document_id)
            }) {
            Ok(checkpoints) => checkpoints,
            Err(error) => {
                finish_translation_error(app, state, &request, should_record, &error, &on_event);
                return Err(error);
            }
        }
    } else {
        Vec::new()
    };

    while let Some(chunk) = queue.pop_front() {
        let label = chunk
            .heading
            .clone()
            .unwrap_or_else(|| format!("Chunk {}", completed_chunks + 1));
        let _ = state.activity.progress(
            &request.request_id,
            ActivityProgress::translation(0, 1, completed_chunks, total_chunks, label),
        );
        emit_activity_changed(app);
        let chunk_document_id = format!("{}#chunk-{}", request.document_id, chunk.index);
        let chunk_envelope = AiDocumentEnvelope::with_policy(
            &chunk_document_id,
            &chunk.source,
            None,
            protection_policy_for_task(AiTask::Translation),
        )
        .map_err(|error| AiError::new("invalid_document", error.to_string()))?;
        if let Some(checkpoint) = completed_checkpoints.iter().find(|checkpoint| {
            usize::try_from(checkpoint.source_start).ok() == Some(chunk.source_range.start)
                && usize::try_from(checkpoint.source_end).ok() == Some(chunk.source_range.end)
        }) {
            if checkpoint.source_hash != chunk_envelope.revision_hash {
                let error = AiError::new(
                    "stale_translation_source",
                    "The source changed after this translation checkpoint was saved. Start a new translation.",
                );
                finish_translation_error(app, state, &request, should_record, &error, &on_event);
                return Err(error);
            }
            let checkpoint_result: TranslationCheckpointResult =
                match serde_json::from_str(&checkpoint.result_json) {
                    Ok(result) => result,
                    Err(_) => {
                        let error = AiError::new(
                            "translation_resume_unavailable",
                            "A saved translation checkpoint could not be restored.",
                        );
                        finish_translation_error(
                            app,
                            state,
                            &request,
                            should_record,
                            &error,
                            &on_event,
                        );
                        return Err(error);
                    }
                };
            if checkpoint_result.target_language != target_language {
                let error = AiError::new(
                    "translation_resume_settings_changed",
                    "The target language changed after this translation started. Start a new translation.",
                );
                finish_translation_error(app, state, &request, should_record, &error, &on_event);
                return Err(error);
            }
            detected_source_language = detected_source_language
                .or(checkpoint_result.detected_source_language);
            warnings.extend(checkpoint_result.warnings);
            translated.push((chunk.source_range.start, checkpoint_result.proposed_markdown));
            usage = merge_usage(
                usage,
                checkpoint
                    .usage_json
                    .as_deref()
                    .and_then(|value| serde_json::from_str(value).ok()),
            );
            completed_chunks = completed_chunks.saturating_add(1);
            continue;
        }
        if completed_checkpoints.iter().any(|checkpoint| {
            usize::try_from(checkpoint.source_start)
                .is_ok_and(|start| start >= chunk.source_range.start)
                && usize::try_from(checkpoint.source_end)
                    .is_ok_and(|end| end <= chunk.source_range.end)
        }) {
            let split = match subdivide_translation_chunk(&chunk) {
                Ok(split) => split,
                Err(error) => {
                    finish_translation_error(
                        app,
                        state,
                        &request,
                        should_record,
                        &error,
                        &on_event,
                    );
                    return Err(error);
                }
            };
            total_chunks = total_chunks
                .saturating_sub(1)
                .saturating_add(u32::try_from(split.len()).unwrap_or(u32::MAX));
            for child in split.into_iter().rev() {
                queue.push_front(child);
            }
            continue;
        }
        let document = serde_json::to_value(&chunk_envelope).map_err(|_| {
            AiError::new(
                "invalid_document",
                "Could not prepare a translation chunk for OpenRouter.",
            )
        })?;
        let completion_request = AiCompletionRequest {
            task: AiTask::Translation,
            model: request.model.clone(),
            document,
            selection: false,
            target_language: request.target_language.clone(),
            instruction: request.instruction.clone(),
            zdr_only: request.zdr_only,
            max_output_tokens: request.max_output_tokens,
        };
        let activity = state.activity.clone();
        let request_id = request.request_id.clone();
        let activity_app = app.clone();
        let completed_for_progress = completed_chunks;
        let completion = state
            .client
            .stream_completion(
                &secret,
                &completion_request,
                &cancellation,
                move |received_characters| {
                    let _ = activity.progress(
                        &request_id,
                        ActivityProgress {
                            stage: "translating".to_string(),
                            file_completed: Some(0),
                            file_total: Some(1),
                            chunk_completed: Some(completed_for_progress),
                            chunk_total: Some(total_chunks),
                            label: Some("Receiving translation".to_string()),
                            received_characters,
                        },
                    );
                    emit_activity_changed(&activity_app);
                },
            )
            .await;
        let completion = match completion {
            Ok(completion) => completion,
            Err(error) => {
                finish_translation_error(app, state, &request, should_record, &error, &on_event);
                return Err(error);
            }
        };

        let (chunk_result, chunk_issues) = validate_provider_result(
            &chunk_envelope,
            AiTask::Translation,
            &completion.content,
            request.target_language.as_deref(),
            completion.finish_reason.as_deref(),
        );
        match translation_retry_subdivision(&chunk, &chunk_issues) {
            Ok(Some(split)) => {
                total_chunks = total_chunks
                    .saturating_sub(1)
                    .saturating_add(u32::try_from(split.len()).unwrap_or(u32::MAX));
                for child in split.into_iter().rev() {
                    queue.push_front(child);
                }
                continue;
            }
            Ok(None) => {}
            Err(error) => {
                finish_translation_error(
                    app,
                    state,
                    &request,
                    should_record,
                    &error,
                    &on_event,
                );
                return Err(error);
            }
        }
        let Some(chunk_result) = chunk_result else {
            let result = finish_invalid_translation(
                app,
                state,
                request,
                should_record,
                completion,
                chunk_issues,
                &on_event,
            );
            return Ok(result);
        };
        detected_source_language = detected_source_language
            .or_else(|| chunk_result.detected_source_language.clone());
        warnings.extend(chunk_result.warnings.clone());
        let checkpoint_result = TranslationCheckpointResult {
            proposed_markdown: chunk_result.proposed_markdown.clone(),
            detected_source_language: chunk_result.detected_source_language.clone(),
            target_language: target_language.clone(),
            warnings: chunk_result.warnings.clone(),
        };
        if should_record && let Ok(store) = state.history.store() {
            let stored = StoredTranslationChunk {
                document_id: request.document_id.clone(),
                file_index: 0,
                chunk_index: u32::try_from(chunk.source_range.start).unwrap_or(u32::MAX),
                source_start: u32::try_from(chunk.source_range.start).unwrap_or(u32::MAX),
                source_end: u32::try_from(chunk.source_range.end).unwrap_or(u32::MAX),
                heading: chunk.heading.clone(),
                source_hash: chunk_envelope.revision_hash.clone(),
                result_json: serde_json::to_string(&checkpoint_result)
                    .unwrap_or_else(|_| "{}".to_string()),
                usage_json: completion
                    .usage
                    .as_ref()
                    .and_then(|value| serde_json::to_string(value).ok()),
            };
            let _ = store.save_translation_chunk(&request.request_id, &stored);
        }
        translated.push((chunk.source_range.start, chunk_result.proposed_markdown));
        generation_id = completion.generation_id.or(generation_id);
        usage = merge_usage(usage, completion.usage);
        completed_chunks = completed_chunks.saturating_add(1);
    }

    translated.sort_by_key(|(start, _)| *start);
    let proposed_markdown = translated
        .into_iter()
        .map(|(_, markdown)| markdown)
        .collect::<String>();
    let result = validate_batched_translation(
        &envelope,
        proposed_markdown,
        detected_source_language,
        target_language,
        warnings,
    )
    .map_err(|error| AiError::new("translation_validation_failed", error.to_string()))?;
    state
        .results
        .lock()
        .map_err(|_| AiError::new("result_unavailable", "Could not retain the AI result."))?
        .insert(request.request_id.clone(), result.clone());
    let _ = on_event.send(AiStreamEvent::Completed {
        request_id: request.request_id.clone(),
        generation_id: generation_id.clone(),
    });
    if should_record && let Ok(store) = state.history.store() {
        let history_result = serde_json::to_string(&result).ok();
        let history_usage = usage.as_ref().and_then(|value| serde_json::to_string(value).ok());
        let _ = store.finish_run_with_usage(
            &request.request_id,
            RunStatus::Completed,
            history_result.as_deref(),
            None,
            history_usage.as_deref(),
        );
    }
    let _ = state.activity.finish(&request.request_id);
    emit_activity_changed(app);
    if should_record {
        emit_history_changed(app);
    }
    Ok(AiRunResult {
        request_id: request.request_id,
        document_id: request.document_id,
        task: request.task,
        model: request.model,
        generation_id,
        result: Some(result),
        validation_issues: Vec::new(),
        raw_diagnostic: None,
        usage,
        retry_after_seconds: None,
    })
}

fn finish_invalid_translation(
    app: &AppHandle,
    state: &AiState,
    request: AiRunRequest,
    should_record: bool,
    completion: openrouter::SseComplete,
    validation_issues: Vec<AiValidationIssue>,
    on_event: &Channel<AiStreamEvent>,
) -> AiRunResult {
    let _ = on_event.send(AiStreamEvent::Completed {
        request_id: request.request_id.clone(),
        generation_id: completion.generation_id.clone(),
    });
    if should_record && let Ok(store) = state.history.store() {
        let history_usage = completion
            .usage
            .as_ref()
            .and_then(|value| serde_json::to_string(value).ok());
        let (history_status, history_error) =
            history_record_for_validation(false, &validation_issues);
        let _ = store.finish_run_with_usage(
            &request.request_id,
            history_status,
            None,
            history_error.as_deref(),
            history_usage.as_deref(),
        );
    }
    let _ = state.activity.finish(&request.request_id);
    emit_activity_changed(app);
    if should_record {
        emit_history_changed(app);
    }
    AiRunResult {
        request_id: request.request_id,
        document_id: request.document_id,
        task: request.task,
        model: request.model,
        generation_id: completion.generation_id,
        result: None,
        validation_issues,
        raw_diagnostic: Some(redact_sensitive(&completion.content, None)),
        usage: completion.usage,
        retry_after_seconds: None,
    }
}

fn finish_translation_error(
    app: &AppHandle,
    state: &AiState,
    request: &AiRunRequest,
    should_record: bool,
    error: &AiError,
    on_event: &Channel<AiStreamEvent>,
) {
    let event = if error.code == "cancelled" {
        AiStreamEvent::Cancelled {
            request_id: request.request_id.clone(),
        }
    } else {
        AiStreamEvent::Failed {
            request_id: request.request_id.clone(),
            code: error.code.clone(),
            message: error.message.clone(),
        }
    };
    let _ = on_event.send(event);
    if should_record {
        record_history_error(
            state,
            &request.request_id,
            if error.code == "cancelled" {
                RunStatus::Cancelled
            } else {
                RunStatus::Failed
            },
            error,
        );
    }
    let _ = state.activity.finish(&request.request_id);
    emit_activity_changed(app);
    if should_record {
        emit_history_changed(app);
    }
}

fn merge_usage(current: Option<AiUsage>, next: Option<AiUsage>) -> Option<AiUsage> {
    match (current, next) {
        (None, next) => next,
        (current, None) => current,
        (Some(current), Some(next)) => Some(AiUsage {
            prompt_tokens: current.prompt_tokens.saturating_add(next.prompt_tokens),
            completion_tokens: current.completion_tokens.saturating_add(next.completion_tokens),
            total_tokens: current.total_tokens.saturating_add(next.total_tokens),
            cost_usd: match (current.cost_usd, next.cost_usd) {
                (Some(left), Some(right)) => Some(left + right),
                _ => None,
            },
            cost_calculated: current.cost_calculated && next.cost_calculated,
        }),
    }
}

fn emit_activity_changed(app: &AppHandle) {
    let _ = app.emit(AI_ACTIVITY_CHANGED_EVENT, ());
}

fn emit_history_changed(app: &AppHandle) {
    let _ = app.emit(AI_HISTORY_CHANGED_EVENT, ());
}

fn record_history_start(state: &AiState, request: &AiRunRequest, envelope: &AiDocumentEnvelope) {
    let scope_json = serde_json::to_string(&request_scope(request)).unwrap_or_else(|_| {
        serde_json::json!({
            "kind": "document",
            "documentId": request.document_id,
        })
        .to_string()
    });
    let started_at = i64::try_from(unix_timestamp()).unwrap_or(i64::MAX);
    let run = StoredRun {
        id: request.request_id.clone(),
        task: request.task,
        model: request.model.clone(),
        status: RunStatus::Running,
        scope_json,
        source_hash: envelope.revision_hash.clone(),
        prompt_version: prompt_version_for_task(request.task).to_string(),
        instruction: request.instruction.clone(),
        target_language: request.target_language.clone(),
        max_output_tokens: Some(request.max_output_tokens),
        zdr_only: Some(request.zdr_only),
        result_json: None,
        error_json: None,
        usage_json: None,
        started_at,
        finished_at: None,
    };
    if let Ok(store) = state.history.store() {
        let _ = store.insert_run(&run);
    }
}

fn request_scope(request: &AiRunRequest) -> AiRunScope {
    request.scope.clone().unwrap_or_else(|| AiRunScope::Document {
        target: AiDocumentRef {
            document_id: request.document_id.clone(),
            path: None,
            label: request.document_id.clone(),
        },
    })
}

fn prepare_translation_resume(
    state: &AiState,
    request: &AiRunRequest,
    envelope: &AiDocumentEnvelope,
) -> Result<(), AiError> {
    if request.task != AiTask::Translation || !request.record_history {
        return Err(AiError::new(
            "translation_resume_unavailable",
            "Translation resume requires local AI history.",
        ));
    }
    let store = state.history.store()?;
    let stored = store.detail(&request.request_id)?.ok_or_else(|| {
        AiError::new(
            "translation_resume_unavailable",
            "The saved translation is no longer available.",
        )
    })?;
    if stored.task != AiTask::Translation
        || stored.model != request.model
        || stored.source_hash != envelope.revision_hash
    {
        return Err(AiError::new(
            "stale_translation_source",
            "The source or model changed after this translation started. Start a new translation.",
        ));
    }
    Ok(())
}

fn protection_policy_for_task(task: AiTask) -> ProtectionPolicy {
    ProtectionPolicy {
        translate_frontmatter_values: task == AiTask::Translation,
        ..ProtectionPolicy::default()
    }
}

fn record_history_error(state: &AiState, request_id: &str, status: RunStatus, error: &AiError) {
    let error_json = serde_json::to_string(error).ok();
    if let Ok(store) = state.history.store() {
        let _ = store.finish_run(request_id, status, None, error_json.as_deref());
    }
}

fn history_record_for_validation(
    has_result: bool,
    issues: &[AiValidationIssue],
) -> (RunStatus, Option<String>) {
    if has_result {
        return (RunStatus::Completed, None);
    }
    let error = serde_json::json!({
        "code": "local_validation_failed",
        "message": "Markdowner rejected the provider response during local validation.",
        "issues": issues,
    });
    (RunStatus::Failed, Some(error.to_string()))
}

fn prepare_interview_generation(
    state: &AiState,
    request: &AiRunRequest,
    envelope: &AiDocumentEnvelope,
    interview_id: &str,
) -> Result<String, AiError> {
    if request.task != AiTask::Prd || interview_id != request.request_id {
        return Err(AiError::new(
            "invalid_interview_generation",
            "A finished PRD interview must generate through its original request.",
        ));
    }
    let store = state.history.store()?;
    let session = load_interview(store, interview_id)?;
    if session.status != InterviewStatus::ReadyToGenerate {
        return Err(AiError::new(
            "interview_not_finished",
            "Confirm that the PRD interview is sufficient before generating.",
        ));
    }
    if session.document_id != request.document_id || session.source_hash != envelope.revision_hash {
        return Err(AiError::new(
            "stale_document",
            "The document changed after this interview started. Start a new interview for the current draft.",
        ));
    }
    if session.model != request.model {
        return Err(AiError::new(
            "interview_model_changed",
            "Use the same model selected when the PRD interview started.",
        ));
    }
    store.set_interview_status(interview_id, InterviewStatus::Generating.as_str())?;
    let history = serde_json::to_string(&session.history_data()).map_err(|_| {
        AiError::new(
            "invalid_interview_history",
            "Could not prepare the PRD interview answers for generation.",
        )
    })?;
    Ok(format!(
        "Use the following user-confirmed PRD interview as data when improving the document. Do not invent missing answers.\n<interview_history>\n{history}\n</interview_history>"
    ))
}

fn restore_interview_for_retry(state: &AiState, interview_id: Option<&str>) {
    let Some(interview_id) = interview_id else { return };
    if let Ok(store) = state.history.store() {
        let _ = store.set_interview_status(interview_id, InterviewStatus::ReadyToGenerate.as_str());
    }
}

fn validate_run_request(request: &AiRunRequest) -> Result<(), AiError> {
    if request.request_id.trim().is_empty() || request.document_id.trim().is_empty() {
        return Err(AiError::new(
            "invalid_request",
            "The AI request and document IDs are required.",
        ));
    }
    if request.source.is_empty() {
        return Err(AiError::new(
            "empty_document",
            "Add document text before running an AI task.",
        ));
    }
    if request.model.trim().is_empty()
        || request.model.len() > 200
        || request.model.chars().any(char::is_whitespace)
    {
        return Err(AiError::new(
            "invalid_model",
            "Select a valid OpenRouter model.",
        ));
    }
    if request.max_output_tokens == 0 || request.max_output_tokens > 100_000 {
        return Err(AiError::new(
            "invalid_output_limit",
            "Maximum output tokens must be between 1 and 100,000.",
        ));
    }
    if request.task == AiTask::Translation
        && request
            .target_language
            .as_deref()
            .is_none_or(|language| language.trim().is_empty())
    {
        return Err(AiError::new(
            "target_language_required",
            "Choose a translation target language.",
        ));
    }
    if request.task == AiTask::Summary {
        if request.selection.is_some() {
            return Err(AiError::new(
                "invalid_summary_scope",
                "Summary supports only the current whole document.",
            ));
        }
        if let Some(language) = request.target_language.as_deref()
            && !is_valid_language_identifier(language)
        {
            return Err(AiError::new(
                "invalid_summary_language",
                "Choose a valid Summary language.",
            ));
        }
    }
    if request.task == AiTask::Custom
        && request
            .instruction
            .as_deref()
            .is_none_or(|instruction| instruction.trim().is_empty())
    {
        return Err(AiError::new(
            "instruction_required",
            "Enter an instruction for the custom AI task.",
        ));
    }
    Ok(())
}

fn validate_provider_result(
    envelope: &AiDocumentEnvelope,
    task: AiTask,
    content: &str,
    requested_language: Option<&str>,
    finish_reason: Option<&str>,
) -> (Option<ValidatedDocument>, Vec<AiValidationIssue>) {
    if finish_reason == Some("length") {
        return (
            None,
            vec![AiValidationIssue {
                code: "response_truncated".to_string(),
                message: "The provider stopped because the output token limit was reached.".to_string(),
                segment_id: None,
            }],
        );
    }
    let validated = match task {
        AiTask::Summary => serde_json::from_str::<SummaryResponse>(content)
            .map_err(schema_error)
            .and_then(|response| {
                validate_summary_response(envelope, response, requested_language)
                    .map_err(validation_issues)
            }),
        AiTask::Translation => serde_json::from_str::<TranslationResponse>(content)
            .map_err(schema_error)
            .and_then(|response| {
                validate_translation(envelope, response).map_err(validation_issues)
            }),
        AiTask::Prd => serde_json::from_str::<PrdResponse>(content)
            .map_err(schema_error)
            .and_then(|response| {
                validate_prd_response(envelope, response).map_err(validation_issues)
            }),
        AiTask::Custom if envelope.selection.is_some() => {
            serde_json::from_str::<SelectionResponse>(content)
                .map_err(schema_error)
                .and_then(|response| {
                    validate_selection_response(envelope, response).map_err(validation_issues)
                })
        }
        AiTask::Custom => serde_json::from_str::<PrdResponse>(content)
            .map_err(schema_error)
            .and_then(|response| {
                validate_prd_response(envelope, response).map_err(validation_issues)
            }),
    };
    match validated {
        Ok(validated) => (Some(validated), Vec::new()),
        Err(issues) => (None, issues),
    }
}

fn merge_chunked_prd_responses(responses: Vec<PrdResponse>) -> PrdResponse {
    let mut summaries = Vec::new();
    let mut findings = Vec::new();
    let mut operations = Vec::new();
    let mut assumptions = Vec::new();
    for (chunk_index, response) in responses.into_iter().enumerate() {
        let prefix = format!("chunk-{}", chunk_index + 1);
        let finding_ids = response
            .findings
            .iter()
            .enumerate()
            .map(|(finding_index, finding)| {
                let suffix = if finding.id.trim().is_empty() {
                    format!("finding-{}", finding_index + 1)
                } else {
                    finding.id.clone()
                };
                (finding.id.clone(), format!("{prefix}:{suffix}"))
            })
            .collect::<HashMap<_, _>>();
        summaries.extend(
            (!response.summary.trim().is_empty()).then_some(response.summary.trim().to_string()),
        );
        findings.extend(response.findings.into_iter().map(|mut finding| {
            finding.id = finding_ids
                .get(&finding.id)
                .cloned()
                .unwrap_or_else(|| format!("{prefix}:finding"));
            finding
        }));
        operations.extend(response.operations.into_iter().enumerate().map(
            |(operation_index, mut operation)| {
                let suffix = if operation.id.trim().is_empty() {
                    format!("operation-{}", operation_index + 1)
                } else {
                    operation.id.clone()
                };
                operation.id = format!("{prefix}:{suffix}");
                operation.finding_ids = operation
                    .finding_ids
                    .into_iter()
                    .map(|finding_id| {
                        finding_ids
                            .get(&finding_id)
                            .cloned()
                            .unwrap_or_else(|| format!("{prefix}:{finding_id}"))
                    })
                    .collect();
                operation
            },
        ));
        assumptions.extend(response.assumptions);
    }
    PrdResponse {
        schema_version: 1,
        summary: summaries.join("\n\n"),
        findings,
        operations,
        assumptions,
    }
}

fn merge_chunked_summary_responses(
    responses: Vec<SummaryResponse>,
) -> Result<SummaryResponse, AiError> {
    let mut responses = responses.into_iter();
    let Some(first) = responses.next() else {
        return Err(AiError::new(
            "summary_recovery_failed",
            "The document could not be divided into summary chunks.",
        ));
    };
    let mut summaries = vec![first.summary_markdown.trim().to_string()];
    let mut warnings = first.warnings;
    let detected_source_language = first.detected_source_language;
    let summary_language = first.summary_language;
    for response in responses {
        if !response
            .summary_language
            .eq_ignore_ascii_case(&summary_language)
        {
            return Err(AiError::new(
                "summary_recovery_failed",
                "Summary chunks used inconsistent output languages.",
            ));
        }
        summaries.push(response.summary_markdown.trim().to_string());
        warnings.extend(response.warnings);
    }
    Ok(SummaryResponse {
        schema_version: 1,
        detected_source_language,
        summary_language,
        summary_markdown: summaries
            .into_iter()
            .filter(|summary| !summary.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n"),
        warnings,
    })
}

fn next_output_limit(current: u32) -> Option<u32> {
    (current < 100_000).then(|| current.saturating_mul(2).min(100_000))
}

fn is_valid_language_identifier(language: &str) -> bool {
    let trimmed = language.trim();
    !trimmed.is_empty()
        && trimmed.len() <= 64
        && trimmed
            .split('-')
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_alphanumeric()))
}

fn schema_error(error: serde_json::Error) -> Vec<AiValidationIssue> {
    let truncated = classify_schema_error(&error) == SchemaFailure::ResponseTruncated;
    vec![AiValidationIssue {
        code: if truncated { "response_truncated" } else { "invalid_schema" }.to_string(),
        message: format!("The provider response did not match the required schema: {error}"),
        segment_id: None,
    }]
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SchemaFailure {
    ResponseTruncated,
    InvalidSchema,
}

fn classify_schema_error(error: &serde_json::Error) -> SchemaFailure {
    if error.is_eof() || error.to_string().contains("EOF while parsing a string") {
        SchemaFailure::ResponseTruncated
    } else {
        SchemaFailure::InvalidSchema
    }
}

fn translation_retry_subdivision(
    chunk: &TranslationChunk,
    issues: &[AiValidationIssue],
) -> Result<Option<Vec<TranslationChunk>>, AiError> {
    if !issues
        .iter()
        .any(|issue| issue.code == "response_truncated")
    {
        return Ok(None);
    }
    subdivide_translation_chunk(chunk).map(Some)
}

fn validation_issues(error: ValidationError) -> Vec<AiValidationIssue> {
    error
        .issues
        .into_iter()
        .map(|issue| AiValidationIssue {
            code: serde_json::to_value(issue.code)
                .ok()
                .and_then(|value| value.as_str().map(str::to_string))
                .unwrap_or_else(|| "validation_error".to_string()),
            message: issue.message,
            segment_id: issue.segment_id,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::chunking::TranslationChunk;
    use super::{
        AiRunRequest, AiState, CatalogCache, RequestScheduler, SchemaFailure,
        classify_schema_error, empty_completion_outcome, merge_chunked_prd_responses,
        merge_chunked_summary_responses, history_record_for_validation, next_output_limit,
        outcome_has_provider_attempt, should_prechunk_request,
        openrouter::{AiModel, AiModelPricing, AiTask, SUMMARY_PROMPT_VERSION},
        prepare_run_envelope, prepare_translation_resume, record_history_start,
        translation_retry_subdivision, validate_provider_result, validate_run_request,
    };
    use markdowner_core::ai_document::{
        AiDocumentEnvelope, ByteRange, OperationKind, PrdFinding, PrdOperation, PrdResponse,
        SummaryResponse, validate_prd_response,
    };

    fn summary_run_request() -> AiRunRequest {
        AiRunRequest {
            request_id: "summary-run".to_string(),
            document_id: "doc-1".to_string(),
            source: "# Source\n\nOriginal facts.".to_string(),
            selection: None,
            task: AiTask::Summary,
            model: "z-ai/glm-5.2".to_string(),
            target_language: None,
            instruction: None,
            zdr_only: true,
            max_output_tokens: 4_096,
            record_history: true,
            scope: None,
            interview_id: None,
            resume: false,
        }
    }

    #[test]
    fn summary_request_accepts_source_or_valid_target_language() {
        let source_language = summary_run_request();
        assert!(validate_run_request(&source_language).is_ok());

        let explicit_language = AiRunRequest {
            target_language: Some("ko-KR".to_string()),
            ..summary_run_request()
        };
        assert!(validate_run_request(&explicit_language).is_ok());
    }

    #[test]
    fn summary_request_rejects_selection_and_invalid_language() {
        let selected = AiRunRequest {
            selection: Some(ByteRange { start: 0, end: 1 }),
            ..summary_run_request()
        };
        assert_eq!(
            validate_run_request(&selected).unwrap_err().code,
            "invalid_summary_scope"
        );

        let invalid_language = AiRunRequest {
            target_language: Some("ko_KR".to_string()),
            ..summary_run_request()
        };
        assert_eq!(
            validate_run_request(&invalid_language).unwrap_err().code,
            "invalid_summary_language"
        );
    }

    #[test]
    fn selected_ai_request_rejects_fully_protected_markdown_before_execution() {
        let source = "Read [docs](/private/path) safely.\n";
        let request = AiRunRequest {
            source: source.to_string(),
            selection: Some(ByteRange { start: 13, end: 25 }),
            task: AiTask::Custom,
            instruction: Some("Rewrite this selection.".to_string()),
            ..summary_run_request()
        };

        let error = prepare_run_envelope(&request).unwrap_err();

        assert_eq!(error.code, "selection_not_editable");
        assert_eq!(
            error.message,
            "The selection contains only protected Markdown and cannot be changed."
        );
    }

    #[test]
    fn summary_provider_result_validates_with_requested_language() {
        let envelope =
            AiDocumentEnvelope::new("doc-1", "# Source\n\nOriginal facts.", None).unwrap();
        let response = serde_json::json!({
            "schema_version": 1,
            "detected_source_language": "en",
            "summary_language": "ko",
            "summary_markdown": "# 요약\n\n원본의 사실입니다.",
            "warnings": []
        })
        .to_string();

        let (result, issues) = validate_provider_result(
            &envelope,
            AiTask::Summary,
            &response,
            Some("ko-KR"),
            None,
        );

        assert!(issues.is_empty());
        assert_eq!(
            result.map(|document| document.proposed_markdown),
            Some("# 요약\n\n원본의 사실입니다.".to_string())
        );
    }

    #[test]
    fn summary_history_start_records_the_summary_prompt_version() {
        let directory = tempfile::tempdir().unwrap();
        let state = AiState::new(directory.path().to_path_buf()).unwrap();
        let request = summary_run_request();
        let envelope =
            AiDocumentEnvelope::new(&request.document_id, &request.source, None).unwrap();

        record_history_start(&state, &request, &envelope);

        assert_eq!(
            state
                .history
                .store()
                .unwrap()
                .detail(&request.request_id)
                .unwrap()
                .unwrap()
                .prompt_version,
            SUMMARY_PROMPT_VERSION
        );
    }

    #[tokio::test]
    async fn limits_two_app_requests_and_one_per_document() {
        let scheduler = RequestScheduler::new();
        let first = scheduler.acquire("doc-a", "r1").await.unwrap();
        let _second = scheduler.acquire("doc-b", "r2").await.unwrap();

        assert_eq!(
            scheduler.try_acquire("doc-c", "r3").unwrap_err().code,
            "app_busy"
        );
        assert_eq!(
            scheduler.try_acquire("doc-a", "r4").unwrap_err().code,
            "document_busy"
        );

        drop(first);
        assert!(scheduler.try_acquire("doc-c", "r3").is_ok());
    }

    #[tokio::test]
    async fn cancelling_a_registered_request_signals_its_token() {
        let scheduler = RequestScheduler::new();
        let permit = scheduler.acquire("doc-a", "request-1").await.unwrap();
        let cancelled = permit.cancellation_token();

        assert!(scheduler.cancel("request-1"));
        assert!(cancelled.is_cancelled());
        assert!(!scheduler.cancel("missing"));
    }

    #[tokio::test]
    async fn batch_reserves_one_app_slot_and_every_document() {
        let scheduler = RequestScheduler::new();
        let documents = vec!["doc-a".to_string(), "doc-b".to_string()];
        let permit = scheduler
            .acquire_scoped(&documents, "batch-1")
            .await
            .unwrap();

        assert_eq!(
            scheduler
                .try_acquire_scoped(&["doc-b".to_string()], "single")
                .unwrap_err()
                .code,
            "document_busy"
        );
        let _other = scheduler
            .try_acquire_scoped(&["doc-c".to_string()], "single-2")
            .unwrap();

        drop(permit);
        assert!(scheduler.try_acquire_scoped(&documents, "batch-2").is_ok());
    }

    #[test]
    fn corrupt_history_is_isolated_from_ai_state_startup() {
        let directory = tempfile::tempdir().unwrap();
        let ai_directory = directory.path().join("ai");
        std::fs::create_dir_all(&ai_directory).unwrap();
        std::fs::write(
            ai_directory.join("history.sqlite3"),
            b"not a sqlite database",
        )
        .unwrap();

        let state = AiState::new(directory.path().to_path_buf()).unwrap();

        assert!(!state.history.is_available());
    }

    #[test]
    fn translation_resume_rejects_a_changed_source_before_network_use() {
        let directory = tempfile::tempdir().unwrap();
        let state = AiState::new(directory.path().to_path_buf()).unwrap();
        let request = AiRunRequest {
            request_id: "resume-run".to_string(),
            document_id: "doc-1".to_string(),
            source: "# Original".to_string(),
            selection: None,
            task: AiTask::Translation,
            model: "z-ai/glm-5.2".to_string(),
            target_language: Some("ko".to_string()),
            instruction: None,
            zdr_only: true,
            max_output_tokens: 4096,
            record_history: true,
            scope: None,
            interview_id: None,
            resume: true,
        };
        let original = AiDocumentEnvelope::with_policy(
            &request.document_id,
            &request.source,
            None,
            super::protection_policy_for_task(AiTask::Translation),
        )
        .unwrap();
        record_history_start(&state, &request, &original);

        assert!(prepare_translation_resume(&state, &request, &original).is_ok());
        let changed = AiDocumentEnvelope::with_policy(
            &request.document_id,
            "# Changed",
            None,
            super::protection_policy_for_task(AiTask::Translation),
        )
        .unwrap();
        assert_eq!(
            prepare_translation_resume(&state, &request, &changed)
                .unwrap_err()
                .code,
            "stale_translation_source"
        );
    }

    #[test]
    fn catalog_cache_round_trips_without_credentials() {
        let directory = tempfile::tempdir().unwrap();
        let cache = CatalogCache::new(directory.path());
        let models = vec![AiModel {
            id: "z-ai/glm-5.2".to_string(),
            name: "GLM 5.2".to_string(),
            description: None,
            context_length: 1_048_576,
            max_completion_tokens: Some(131_072),
            input_modalities: vec!["text".to_string()],
            output_modalities: vec!["text".to_string()],
            supported_parameters: vec!["structured_outputs".to_string()],
            pricing: AiModelPricing {
                prompt: Some(0.000_001),
                completion: Some(0.000_002),
                updated_at: "now".to_string(),
                eligible_endpoint_count: None,
            },
        }];

        cache.save(&models).unwrap();
        let serialized = std::fs::read_to_string(cache.path()).unwrap();

        assert_eq!(cache.load().unwrap(), models);
        assert!(!serialized.contains("sk-or-"));
        assert!(!serialized.contains("authorization"));
    }

    #[test]
    fn invalid_provider_schema_fails_closed_without_a_result() {
        let envelope = AiDocumentEnvelope::new("doc-1", "# PRD\n\nVague.", None).unwrap();

        let (result, issues) =
            validate_provider_result(&envelope, AiTask::Prd, "not valid json", None, None);

        assert!(result.is_none());
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "invalid_schema");
    }

    #[test]
    fn validation_failure_history_record_is_failed_and_preserves_issue_details() {
        let issues = vec![super::AiValidationIssue {
            code: "invalid_schema".to_string(),
            message: "Missing required document segments.".to_string(),
            segment_id: Some("segment-2".to_string()),
        }];

        let (status, error_json) = history_record_for_validation(false, &issues);

        assert_eq!(status, super::history::RunStatus::Failed);
        let error: serde_json::Value = serde_json::from_str(&error_json.unwrap()).unwrap();
        assert_eq!(error["code"], "local_validation_failed");
        assert_eq!(error["issues"][0]["code"], "invalid_schema");
        assert_eq!(error["issues"][0]["segmentId"], "segment-2");
        assert!(!error.to_string().contains("provider response body"));

        assert_eq!(
            history_record_for_validation(true, &issues),
            (super::history::RunStatus::Completed, None)
        );
    }

    #[test]
    fn json_string_eof_is_classified_as_truncation() {
        let error = serde_json::from_str::<markdowner_core::ai_document::PrdResponse>(
            r#"{"schema_version":1,"summary":"unfinished"#,
        )
        .unwrap_err();

        assert!(error.to_string().contains("EOF while parsing a string"));
        assert_eq!(
            classify_schema_error(&error),
            SchemaFailure::ResponseTruncated
        );
    }

    #[test]
    fn translation_eof_retries_with_structure_preserving_subdivision() {
        let source = "One sentence. Two sentence. Three sentence. Four sentence. ".repeat(20);
        let chunk = TranslationChunk {
            index: 0,
            source_range: 0..source.len(),
            source: source.clone(),
            heading: Some("Details".to_string()),
            estimated_input_tokens: 300,
            subdivision_depth: 0,
        };
        let envelope = AiDocumentEnvelope::with_policy(
            "doc-1#chunk-0",
            &chunk.source,
            None,
            super::protection_policy_for_task(AiTask::Translation),
        )
        .unwrap();
        let truncated = r#"{"schema_version":1,"detected_source_language":"en","target_language":"ko","segments":[{"id":"s1","translated_text":"unfinished"#;

        let (result, issues) =
            validate_provider_result(&envelope, AiTask::Translation, truncated, None, None);

        assert!(result.is_none());
        assert_eq!(issues[0].code, "response_truncated");
        let split = translation_retry_subdivision(&chunk, &issues)
            .unwrap()
            .expect("EOF should request a retry");
        assert!(split.len() >= 2);
        assert!(split.iter().all(|child| child.subdivision_depth == 1));
        assert_eq!(
            split
                .iter()
                .map(|child| child.source.as_str())
                .collect::<String>(),
            source
        );

        let translated = split
            .iter()
            .map(|child| {
                let child_envelope = AiDocumentEnvelope::with_policy(
                    "doc-1#retry",
                    &child.source,
                    None,
                    super::protection_policy_for_task(AiTask::Translation),
                )
                .unwrap();
                let response = serde_json::json!({
                    "schema_version": 1,
                    "detected_source_language": "en",
                    "target_language": "ko",
                    "segments": child_envelope.segments.iter().map(|segment| serde_json::json!({
                        "id": segment.id,
                        "translated_text": segment.text,
                    })).collect::<Vec<_>>(),
                })
                .to_string();
                let (result, issues) = validate_provider_result(
                    &child_envelope,
                    AiTask::Translation,
                    &response,
                    None,
                    None,
                );
                assert!(issues.is_empty());
                result.unwrap().proposed_markdown
            })
            .collect::<String>();
        assert_eq!(translated, source);
    }

    #[test]
    fn translation_length_finish_reason_uses_the_same_retry_path() {
        let source = "One sentence. Two sentence. Three sentence. Four sentence. ".repeat(8);
        let chunk = TranslationChunk {
            index: 0,
            source_range: 0..source.len(),
            source,
            heading: None,
            estimated_input_tokens: 120,
            subdivision_depth: 0,
        };
        let envelope = AiDocumentEnvelope::with_policy(
            "doc-1#chunk-0",
            &chunk.source,
            None,
            super::protection_policy_for_task(AiTask::Translation),
        )
        .unwrap();

        let (_, issues) =
            validate_provider_result(&envelope, AiTask::Translation, "{}", None, Some("length"));

        assert_eq!(issues[0].code, "response_truncated");
        assert!(
            translation_retry_subdivision(&chunk, &issues)
                .unwrap()
                .is_some()
        );
    }

    #[test]
    fn merged_structured_chunk_responses_keep_global_targets_and_unique_ids() {
        let source = "First requirement.\nSecond requirement.\nThird requirement.\n";
        let envelope = AiDocumentEnvelope::new("doc-1", source, None).unwrap();
        let chunks = super::chunking::plan_structured_document_chunks(&envelope, 5).unwrap();
        assert!(chunks.len() > 1);
        let responses = chunks
            .iter()
            .enumerate()
            .map(|(index, chunk)| {
                let segment = chunk.envelope.segments.first().unwrap();
                let target = segment.id.clone();
                let protected_suffix = segment
                    .text
                    .find('⟪')
                    .map(|offset| &segment.text[offset..])
                    .unwrap_or_default();
                PrdResponse {
                    schema_version: 1,
                    summary: format!("Chunk {} reviewed.", index + 1),
                    findings: vec![PrdFinding {
                        id: "finding".to_string(),
                        severity: "medium".to_string(),
                        category: "clarity".to_string(),
                        evidence_segment_id: Some(target.clone()),
                        rationale: "Make the requirement explicit.".to_string(),
                    }],
                    operations: vec![PrdOperation {
                        id: "replace".to_string(),
                        kind: OperationKind::Replace,
                        target_segment_id: target,
                        markdown: format!("Clarified requirement {}.{protected_suffix}", index + 1),
                        finding_ids: vec!["finding".to_string()],
                    }],
                    assumptions: vec![format!("Assumption {}", index + 1)],
                }
            })
            .collect();

        let merged = merge_chunked_prd_responses(responses);
        let validated = validate_prd_response(&envelope, merged).unwrap();

        assert_eq!(validated.operations.len(), chunks.len());
        assert_eq!(
            validated
                .operations
                .iter()
                .map(|operation| operation.id.as_str())
                .collect::<std::collections::HashSet<_>>()
                .len(),
            chunks.len()
        );
        assert!(
            validated
                .proposed_markdown
                .contains("Clarified requirement 1.")
        );
        assert!(
            validated
                .proposed_markdown
                .contains(&format!("Clarified requirement {}.", chunks.len()))
        );
    }

    #[test]
    fn truncation_retry_limit_grows_without_exceeding_the_request_ceiling() {
        assert_eq!(next_output_limit(4_096), Some(8_192));
        assert_eq!(next_output_limit(70_000), Some(100_000));
        assert_eq!(next_output_limit(100_000), None);
    }

    #[test]
    fn large_whole_document_requests_start_with_chunks_but_selections_do_not() {
        let large_source_bytes = 48_001;
        assert!(should_prechunk_request(AiTask::Prd, false, large_source_bytes));
        assert!(should_prechunk_request(AiTask::Summary, false, large_source_bytes));
        assert!(should_prechunk_request(AiTask::Custom, false, large_source_bytes));
        assert!(!should_prechunk_request(AiTask::Custom, true, large_source_bytes));
        assert!(!should_prechunk_request(AiTask::Translation, false, large_source_bytes));
        assert!(!should_prechunk_request(AiTask::Prd, false, 48_000));
    }

    #[test]
    fn proactive_chunk_fallback_knows_that_no_provider_attempt_has_run() {
        assert!(!outcome_has_provider_attempt(&empty_completion_outcome()));
    }

    #[test]
    fn merged_chunk_summaries_keep_order_language_and_warnings() {
        let merged = merge_chunked_summary_responses(vec![
            SummaryResponse {
                schema_version: 1,
                detected_source_language: "en".to_string(),
                summary_language: "ko".to_string(),
                summary_markdown: "# 첫 부분\n\n첫 요약".to_string(),
                warnings: vec!["First warning".to_string()],
            },
            SummaryResponse {
                schema_version: 1,
                detected_source_language: "en".to_string(),
                summary_language: "ko".to_string(),
                summary_markdown: "# 둘째 부분\n\n둘째 요약".to_string(),
                warnings: vec!["Second warning".to_string()],
            },
        ])
        .unwrap();

        assert_eq!(merged.detected_source_language, "en");
        assert_eq!(merged.summary_language, "ko");
        assert_eq!(
            merged.summary_markdown,
            "# 첫 부분\n\n첫 요약\n\n# 둘째 부분\n\n둘째 요약"
        );
        assert_eq!(merged.warnings, ["First warning", "Second warning"]);
    }

    #[test]
    fn mock_prd_and_translation_results_validate_without_network() {
        let envelope = AiDocumentEnvelope::new("doc-1", "Vague requirement.", None).unwrap();
        let prd = serde_json::json!({
            "schema_version": 1,
            "summary": "Clarify the requirement.",
            "findings": [],
            "operations": [],
            "assumptions": []
        })
        .to_string();
        let (prd_result, prd_issues) =
            validate_provider_result(&envelope, AiTask::Prd, &prd, None, None);
        assert!(prd_result.is_some());
        assert!(prd_issues.is_empty());

        let translation = serde_json::json!({
            "schema_version": 1,
            "detected_source_language": "en",
            "target_language": "ko",
            "segments": envelope
                .segments
                .iter()
                .map(|segment| serde_json::json!({
                    "id": segment.id,
                    "translated_text": segment.text
                }))
                .collect::<Vec<_>>(),
            "warnings": []
        })
        .to_string();
        let (translation_result, translation_issues) =
            validate_provider_result(&envelope, AiTask::Translation, &translation, None, None);
        assert!(translation_result.is_some());
        assert!(translation_issues.is_empty());
    }

    #[test]
    fn mock_selection_result_validates_without_network() {
        let source = "Make this clear.";
        let envelope = AiDocumentEnvelope::new(
            "doc-1",
            source,
            Some(ByteRange {
                start: 0,
                end: source.len(),
            }),
        )
        .unwrap();
        let response = serde_json::json!({
            "schema_version": 1,
            "replacement_text": "Make this measurable.",
            "warnings": []
        })
        .to_string();

        let (result, issues) =
            validate_provider_result(&envelope, AiTask::Custom, &response, None, None);

        assert_eq!(
            result.map(|result| result.proposed_markdown),
            Some("Make this measurable.".to_string())
        );
        assert!(issues.is_empty());
    }

    #[test]
    fn unsafe_selection_replacement_fails_closed_without_a_result() {
        let source = "Keep `cargo test` exactly.";
        let start = source.find('K').unwrap();
        let envelope = AiDocumentEnvelope::new(
            "doc-1",
            source,
            Some(ByteRange {
                start,
                end: source.len(),
            }),
        )
        .unwrap();
        let response = serde_json::json!({
            "schema_version": 1,
            "replacement_text": "Remove the command."
        })
        .to_string();

        let (result, issues) =
            validate_provider_result(&envelope, AiTask::Custom, &response, None, None);

        assert!(result.is_none());
        assert!(!issues.is_empty());
        assert!(
            issues
                .iter()
                .any(|issue| issue.code == "protected_token_missing")
        );
    }
}
