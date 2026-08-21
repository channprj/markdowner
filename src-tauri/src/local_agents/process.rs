use std::{
    collections::{BTreeMap, BTreeSet},
    env,
    ffi::{CStr, CString, OsStr, OsString},
    fmt,
    fs::{self, File, OpenOptions},
    io::{ErrorKind, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant as StdInstant},
};

#[cfg(unix)]
use std::os::unix::{
    ffi::OsStrExt,
    fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    io::{AsRawFd, FromRawFd},
    process::CommandExt,
};

use sha2::{Digest, Sha256};
use tempfile::{Builder, TempDir};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::{Child, ChildStderr, ChildStdin, ChildStdout, Command},
    sync::mpsc,
    task::JoinHandle,
    time::Instant as TokioInstant,
};
use tokio_util::sync::CancellationToken;

use super::{
    LocalAgentError, LocalAgentKind, adapters::AdapterInvocation, discovery::ExecutableProof,
};

pub(super) const MAX_PROCESS_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
pub(super) const MAX_PROCESS_STDIN_BYTES: usize = 8 * 1024 * 1024;
pub(super) const STDERR_TAIL_BYTES: usize = 64 * 1024;
const OPENCODE_CHILD_FILE_SIZE_LIMIT: usize = 8 * 1024 * 1024;

const PROCESS_CLEANUP_TIMEOUT: Duration = Duration::from_secs(5);
const PROCESS_GROUP_POLL_INTERVAL: Duration = Duration::from_millis(5);
const PROCESS_GROUP_ABSENCE_CONFIRMATION: Duration = Duration::from_millis(25);
const RESULT_FILE_MONITOR_INTERVAL: Duration = Duration::from_millis(5);
const OPENCODE_CONFIG_DIRECTORY: &str = "opencode-config";
const OPENCODE_CACHE_DIRECTORY: &str = "opencode-cache";
const OPENCODE_DATA_DIRECTORY: &str = "opencode-data";
const OPENCODE_STATE_DIRECTORY: &str = "opencode-state";
const OPENCODE_DATA_AGENT_DIRECTORY: &str = "opencode";
const OPENCODE_STATE_AGENT_DIRECTORY: &str = "opencode";
const OPENCODE_AUTH_FILE: &str = "auth.json";
const OPENCODE_MODEL_STATE_FILE: &str = "model.json";
const CLAUDE_HOME_DIRECTORY: &str = "claude-home";
const CLAUDE_CONFIG_DIRECTORY: &str = "claude-config";
const CLAUDE_XDG_CONFIG_DIRECTORY: &str = "claude-xdg-config";
const CLAUDE_CACHE_DIRECTORY: &str = "claude-cache";
const CLAUDE_DATA_DIRECTORY: &str = "claude-data";
const CLAUDE_STATE_DIRECTORY: &str = "claude-state";
const CODEX_HOME_DIRECTORY: &str = "codex-home";
const CODEX_AUTH_FILE: &str = "auth.json";
const MAX_AGENT_PRIVATE_FILE_BYTES: usize = 1024 * 1024;
const MAX_TEMP_CLEANUP_ENTRIES: usize = 16 * 1024;
const MAX_TEMP_CLEANUP_DEPTH: usize = 32;
const ALLOWED_INHERITED_ENVIRONMENT: &[&str] = &["HOME", "PATH", "LANG", "LC_ALL"];
const FINAL_COMMON_ENVIRONMENT: &[&str] = &["HOME", "LANG", "LC_ALL"];
const CLAUDE_ENVIRONMENT: &[&str] = &[
    "USER",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_WORKSPACE_ID",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_CUSTOM_HEADERS",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "NODE_EXTRA_CA_CERTS",
    "CLAUDE_CODE_CERT_STORE",
    "CLAUDE_CODE_CLIENT_CERT",
    "CLAUDE_CODE_CLIENT_KEY",
    "CLAUDE_CODE_CLIENT_KEY_PASSPHRASE",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_MANTLE",
    "CLAUDE_CODE_SKIP_BEDROCK_AUTH",
    "CLAUDE_CODE_SKIP_MANTLE_AUTH",
    "AWS_REGION",
    "AWS_PROFILE",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_BEARER_TOKEN_BEDROCK",
    "AWS_WEB_IDENTITY_TOKEN_FILE",
    "AWS_ROLE_ARN",
    "ANTHROPIC_BEDROCK_BASE_URL",
    "ANTHROPIC_BEDROCK_MANTLE_BASE_URL",
    "ANTHROPIC_BEDROCK_REGION_PREFIX",
    "ANTHROPIC_BEDROCK_SERVICE_TIER",
    "ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_SKIP_VERTEX_AUTH",
    "CLOUD_ML_REGION",
    "ANTHROPIC_VERTEX_PROJECT_ID",
    "GCLOUD_PROJECT",
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "ANTHROPIC_VERTEX_BASE_URL",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_SKIP_FOUNDRY_AUTH",
    "ANTHROPIC_FOUNDRY_API_KEY",
    "ANTHROPIC_FOUNDRY_AUTH_TOKEN",
    "ANTHROPIC_FOUNDRY_RESOURCE",
    "ANTHROPIC_FOUNDRY_BASE_URL",
    "CLAUDE_CODE_USE_ANTHROPIC_AWS",
    "ANTHROPIC_AWS_WORKSPACE_ID",
    "ANTHROPIC_AWS_API_KEY",
    "ANTHROPIC_AWS_BASE_URL",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_FABLE_MODEL",
];
const CODEX_ENVIRONMENT: &[&str] = &[
    "CODEX_API_KEY",
    "CODEX_ACCESS_TOKEN",
    "CODEX_CA_CERTIFICATE",
    "SSL_CERT_FILE",
];
const OPENCODE_ENVIRONMENT: &[&str] = &[
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "NODE_EXTRA_CA_CERTS",
    "AWS_REGION",
    "AWS_PROFILE",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_BEARER_TOKEN_BEDROCK",
    "AWS_WEB_IDENTITY_TOKEN_FILE",
    "AWS_ROLE_ARN",
    "AZURE_RESOURCE_NAME",
    "AZURE_COGNITIVE_SERVICES_RESOURCE_NAME",
    "DIGITALOCEAN_ACCESS_TOKEN",
    "AICORE_SERVICE_KEY",
    "AICORE_DEPLOYMENT_ID",
    "AICORE_RESOURCE_GROUP",
    "SNOWFLAKE_ACCOUNT",
    "SNOWFLAKE_CORTEX_TOKEN",
    "SNOWFLAKE_CORTEX_PAT",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
    "OPENCODE_API_KEY",
];

#[cfg(unix)]
static LIVE_PROCESS_GROUPS: OnceLock<Arc<Mutex<ProcessGroupRegistry>>> = OnceLock::new();

#[cfg(unix)]
#[derive(Default)]
struct ProcessGroupRegistry {
    process_groups: BTreeSet<i32>,
    rejected_cleanups: usize,
    active_provider_operations: usize,
    active_cleanup_operations: usize,
    cleanup_failures: u64,
    shutting_down: bool,
}

#[cfg(unix)]
impl ProcessGroupRegistry {
    fn register(&mut self, process_group: i32) -> bool {
        if self.shutting_down || process_group <= 0 {
            return false;
        }
        self.process_groups.insert(process_group);
        true
    }

    fn unregister(&mut self, process_group: i32) {
        self.process_groups.remove(&process_group);
    }

    fn snapshot(&self) -> Vec<i32> {
        self.process_groups.iter().copied().collect()
    }

    fn begin_shutdown(&mut self) -> Vec<i32> {
        self.shutting_down = true;
        self.snapshot()
    }

    fn begin_rejected_cleanup(&mut self) {
        self.rejected_cleanups = self.rejected_cleanups.saturating_add(1);
    }

    fn finish_rejected_cleanup(&mut self) {
        self.rejected_cleanups = self.rejected_cleanups.saturating_sub(1);
    }

    fn begin_provider_operation(&mut self) -> bool {
        if self.shutting_down {
            false
        } else {
            self.active_provider_operations = self.active_provider_operations.saturating_add(1);
            true
        }
    }

    fn finish_provider_operation(&mut self) {
        self.active_provider_operations = self.active_provider_operations.saturating_sub(1);
    }

    fn reserve_cleanup_activity(&mut self) -> bool {
        if self.shutting_down {
            false
        } else {
            self.active_cleanup_operations = self.active_cleanup_operations.saturating_add(1);
            true
        }
    }

    fn finish_cleanup_activity(&mut self, succeeded: bool) {
        self.active_cleanup_operations = self.active_cleanup_operations.saturating_sub(1);
        if !succeeded {
            self.cleanup_failures = self.cleanup_failures.saturating_add(1);
        }
    }

    fn is_idle(&self) -> bool {
        self.process_groups.is_empty()
            && self.rejected_cleanups == 0
            && self.active_provider_operations == 0
            && self.active_cleanup_operations == 0
    }
}

pub(super) struct ProcessOutput {
    pub stdout: Vec<u8>,
    pub stderr_tail: Vec<u8>,
    pub result_file: Option<Vec<u8>>,
    temp_dir: Option<TempDir>,
    temp_identity: Option<FileIdentity>,
    temp_handle: Option<File>,
    temp_parent_handle: Option<File>,
    temp_name: Option<OsString>,
    cleanup_activity: Option<CleanupActivityGuard>,
    cleanup_cancellation: CancellationToken,
    cleanup_deadline: StdInstant,
    #[cfg(test)]
    cleanup_interlock: Option<TestCleanupInterlock>,
}

pub(super) struct OwnedTempCapability {
    temp_dir: Option<TempDir>,
    path: PathBuf,
    identity: FileIdentity,
    root: Option<File>,
    parent: Option<File>,
    root_name: OsString,
    adapter_files: Vec<OwnedFile>,
    early_directories: Vec<OwnedDirectory>,
    cleanup_activity: Option<CleanupActivityGuard>,
    cleanup_cancellation: CancellationToken,
    cleanup_deadline: StdInstant,
    #[cfg(test)]
    setup_interlock: Option<TestSetupInterlock>,
    #[cfg(test)]
    cleanup_interlock: Option<TestCleanupInterlock>,
}

struct OwnedTempParts {
    temp_dir: TempDir,
    identity: FileIdentity,
    root: File,
    parent: File,
    root_name: OsString,
    adapter_files: Vec<OwnedFile>,
    cleanup_activity: CleanupActivityGuard,
    cleanup_cancellation: CancellationToken,
    cleanup_deadline: StdInstant,
    #[cfg(test)]
    cleanup_interlock: Option<TestCleanupInterlock>,
}

impl fmt::Debug for OwnedTempCapability {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("OwnedTempCapability")
            .field("adapter_file_count", &self.adapter_files.len())
            .field("early_directory_count", &self.early_directories.len())
            .finish_non_exhaustive()
    }
}

impl OwnedTempCapability {
    pub(super) fn path(&self) -> &Path {
        &self.path
    }

    pub(super) fn verify_path_identity(&self) -> Result<(), LocalAgentError> {
        let root = self.root.as_ref().ok_or_else(temp_cleanup_error)?;
        let parent = self.parent.as_ref().ok_or_else(temp_cleanup_error)?;
        self.identity
            .verify_owned_directory_at(parent, &self.root_name, root)?;
        self.identity
            .verify_handle_and_path(root, &self.path, FileRole::OwnedDirectory)
    }

    pub(super) fn write_adapter_file(
        &mut self,
        name: &str,
        contents: &[u8],
        is_result: bool,
    ) -> Result<PathBuf, LocalAgentError> {
        self.verify_path_identity()
            .map_err(|_| LocalAgentError::AdapterSetupFailed)?;
        if Path::new(name).components().count() != 1 {
            return Err(LocalAgentError::AdapterSetupFailed);
        }
        #[cfg(test)]
        if let Some(interlock) = self.setup_interlock.take() {
            interlock.before_create.wait();
            interlock.replacement_ready.wait();
        }
        let root = self
            .root
            .as_ref()
            .ok_or(LocalAgentError::AdapterSetupFailed)?;
        let path = self.path.join(name);
        let mut handle = create_owned_file_at(root, OsStr::new(name))
            .map_err(|_| LocalAgentError::AdapterSetupFailed)?;
        handle
            .write_all(contents)
            .and_then(|()| handle.sync_all())
            .map_err(|_| LocalAgentError::AdapterSetupFailed)?;
        let identity = FileIdentity::from_handle_and_path(&handle, &path, FileRole::OwnedFile)
            .map_err(|_| LocalAgentError::AdapterSetupFailed)?;
        self.adapter_files.push(OwnedFile {
            path: path.clone(),
            handle,
            identity,
            is_result,
            mutable_private: false,
        });
        self.verify_path_identity()
            .map_err(|_| LocalAgentError::AdapterSetupFailed)?;
        self.adapter_files
            .last()
            .ok_or(LocalAgentError::AdapterSetupFailed)?
            .verify_identity()
            .map_err(|_| LocalAgentError::AdapterSetupFailed)?;
        Ok(path)
    }

    pub(super) fn create_probe_directory(
        &mut self,
        name: &str,
    ) -> Result<PathBuf, LocalAgentError> {
        let directory = self
            .create_directory(Path::new(name), None)
            .map_err(|_| LocalAgentError::ProbeSpawnFailed)?;
        let path = directory.path.clone();
        self.early_directories.push(directory);
        self.verify_path_identity()
            .map_err(|_| LocalAgentError::ProbeSpawnFailed)?;
        Ok(path)
    }

    fn create_directory(
        &self,
        relative: &Path,
        parent: Option<&OwnedDirectory>,
    ) -> Result<OwnedDirectory, LocalAgentError> {
        self.verify_path_identity()?;
        let name = relative
            .file_name()
            .filter(|_| {
                relative
                    .components()
                    .all(|component| matches!(component, std::path::Component::Normal(_)))
            })
            .ok_or_else(|| identity_error(FileRole::OwnedDirectory))?;
        let expected_parent = relative.parent().unwrap_or_else(|| Path::new(""));
        let parent_handle = match parent {
            Some(parent) => {
                if parent.path != self.path.join(expected_parent) {
                    return Err(identity_error(FileRole::OwnedDirectory));
                }
                parent.verify_identity()?;
                &parent.handle
            }
            None => {
                if !expected_parent.as_os_str().is_empty() {
                    return Err(identity_error(FileRole::OwnedDirectory));
                }
                self.root.as_ref().ok_or_else(temp_cleanup_error)?
            }
        };
        let path = self.path.join(relative);
        let directory = create_owned_directory_at(parent_handle, name, &path)?;
        self.verify_path_identity()?;
        directory.verify_identity()?;
        Ok(directory)
    }

    fn create_private_file(
        &self,
        relative: &Path,
        parent: &OwnedDirectory,
        contents: &[u8],
    ) -> Result<OwnedFile, LocalAgentError> {
        self.verify_path_identity()?;
        let name = relative
            .file_name()
            .filter(|_| {
                relative
                    .components()
                    .all(|component| matches!(component, std::path::Component::Normal(_)))
            })
            .ok_or_else(|| identity_error(FileRole::OwnedFile))?;
        let expected_parent = relative.parent().ok_or_else(invalid_environment_error)?;
        if parent.path != self.path.join(expected_parent) {
            return Err(invalid_environment_error());
        }
        parent.verify_identity()?;
        let path = self.path.join(relative);
        let mut handle = create_owned_file_at(&parent.handle, name)?;
        handle
            .write_all(contents)
            .and_then(|()| handle.sync_all())
            .map_err(|_| {
                LocalAgentError::run(
                    "local_agent_setup_failed",
                    "The local agent could not be prepared.",
                )
            })?;
        let identity = FileIdentity::from_handle_and_path(&handle, &path, FileRole::OwnedFile)?;
        self.verify_path_identity()?;
        let file = OwnedFile {
            path,
            handle,
            identity,
            is_result: false,
            mutable_private: true,
        };
        file.verify_identity()?;
        Ok(file)
    }

    fn verify_adapter_files(&self) -> Result<(), LocalAgentError> {
        self.verify_path_identity()?;
        for file in &self.adapter_files {
            file.verify_identity()?;
        }
        verify_root_entries_exact(
            self.root.as_ref().ok_or_else(temp_cleanup_error)?,
            self.adapter_files.iter().map(|file| file.path.as_path()),
            std::iter::empty::<&Path>(),
        )?;
        self.verify_path_identity()
    }

    fn set_cleanup_context(&mut self, cancellation: &CancellationToken, deadline: StdInstant) {
        self.cleanup_cancellation = cancellation.clone();
        self.cleanup_deadline = deadline.max(StdInstant::now() + PROCESS_CLEANUP_TIMEOUT);
    }

    pub(super) fn close_blocking(&mut self) -> Result<(), LocalAgentError> {
        let Some(job) = take_temp_cleanup_job(
            TempCleanupSlot {
                temp_dir: &mut self.temp_dir,
                identity: Some(&self.identity),
                root: &mut self.root,
                parent: &mut self.parent,
                root_name: Some(&self.root_name),
                activity: &mut self.cleanup_activity,
                clear_detached_contents: true,
            },
            #[cfg(test)]
            self.cleanup_interlock.clone(),
        )?
        else {
            return Ok(());
        };
        let shutdown_cleanup = job.activity.shutdown_started();
        let deadline = if shutdown_cleanup {
            StdInstant::now() + PROCESS_CLEANUP_TIMEOUT
        } else {
            self.cleanup_deadline
        };
        let watch_cancellation = !shutdown_cleanup && !self.cleanup_cancellation.is_cancelled();
        run_temp_cleanup_job(
            job,
            self.cleanup_cancellation.clone(),
            watch_cancellation,
            CancellationToken::new(),
            deadline,
        )
    }

    fn into_parts(mut self) -> OwnedTempParts {
        OwnedTempParts {
            temp_dir: self.temp_dir.take().expect("owned temp directory"),
            identity: self.identity.clone(),
            root: self.root.take().expect("owned temp root"),
            parent: self.parent.take().expect("owned temp parent"),
            root_name: self.root_name.clone(),
            adapter_files: std::mem::take(&mut self.adapter_files),
            cleanup_activity: self
                .cleanup_activity
                .take()
                .expect("reserved cleanup activity"),
            cleanup_cancellation: self.cleanup_cancellation.clone(),
            cleanup_deadline: self.cleanup_deadline,
            #[cfg(test)]
            cleanup_interlock: self.cleanup_interlock.take(),
        }
    }

    #[cfg(all(test, unix))]
    fn replace_cleanup_registry_for_test(&mut self, registry: Arc<Mutex<ProcessGroupRegistry>>) {
        self.cleanup_activity = CleanupActivityGuard::reserve_with_registry(registry);
    }
}

impl Drop for OwnedTempCapability {
    fn drop(&mut self) {
        schedule_temp_dir_cleanup(
            TempCleanupSlot {
                temp_dir: &mut self.temp_dir,
                identity: Some(&self.identity),
                root: &mut self.root,
                parent: &mut self.parent,
                root_name: Some(&self.root_name),
                activity: &mut self.cleanup_activity,
                clear_detached_contents: true,
            },
            self.cleanup_cancellation.clone(),
            self.cleanup_deadline,
            #[cfg(test)]
            self.cleanup_interlock.clone(),
        );
    }
}

impl fmt::Debug for ProcessOutput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ProcessOutput")
            .field("stdout_bytes", &self.stdout.len())
            .field("stderr_tail_bytes", &self.stderr_tail.len())
            .field(
                "result_file_bytes",
                &self.result_file.as_ref().map(Vec::len),
            )
            .finish()
    }
}

impl ProcessOutput {
    pub(super) async fn close_temp_dir(&mut self) -> Result<(), LocalAgentError> {
        close_temp_dir(
            TempCleanupSlot {
                temp_dir: &mut self.temp_dir,
                identity: self.temp_identity.as_ref(),
                root: &mut self.temp_handle,
                parent: &mut self.temp_parent_handle,
                root_name: self.temp_name.as_deref(),
                activity: &mut self.cleanup_activity,
                clear_detached_contents: false,
            },
            &self.cleanup_cancellation,
            self.cleanup_deadline,
            #[cfg(test)]
            self.cleanup_interlock.as_ref(),
        )
        .await
    }
}

impl Drop for ProcessOutput {
    fn drop(&mut self) {
        schedule_temp_dir_cleanup(
            TempCleanupSlot {
                temp_dir: &mut self.temp_dir,
                identity: self.temp_identity.as_ref(),
                root: &mut self.temp_handle,
                parent: &mut self.temp_parent_handle,
                root_name: self.temp_name.as_deref(),
                activity: &mut self.cleanup_activity,
                clear_detached_contents: false,
            },
            self.cleanup_cancellation.clone(),
            self.cleanup_deadline,
            #[cfg(test)]
            self.cleanup_interlock.clone(),
        );
    }
}

pub(super) fn create_owned_temp_dir() -> Result<OwnedTempCapability, LocalAgentError> {
    let cleanup_activity = CleanupActivityGuard::reserve().ok_or_else(cancelled_error)?;
    let base = env::temp_dir().canonicalize().map_err(|_| {
        LocalAgentError::run(
            "local_agent_setup_failed",
            "The local agent could not be prepared.",
        )
    })?;
    let parent = open_owned_directory(&base)?;
    let mut builder = Builder::new();
    builder.prefix("markdowner-local-agent-");
    #[cfg(unix)]
    builder.permissions(fs::Permissions::from_mode(0o700));
    let directory = builder.tempdir_in(base).map_err(|_| {
        LocalAgentError::run(
            "local_agent_setup_failed",
            "The local agent could not be prepared.",
        )
    })?;
    let path = directory.path().to_path_buf();
    verify_owned_directory(&path)?;
    let root = open_owned_directory_at(&parent, path.file_name().ok_or_else(temp_cleanup_error)?)?;
    let identity = FileIdentity::from_handle_and_path(&root, &path, FileRole::OwnedDirectory)?;
    let root_name = path.file_name().ok_or_else(temp_cleanup_error)?.to_owned();
    let capability = OwnedTempCapability {
        temp_dir: Some(directory),
        path,
        identity,
        root: Some(root),
        parent: Some(parent),
        root_name,
        adapter_files: Vec::new(),
        early_directories: Vec::new(),
        cleanup_activity: Some(cleanup_activity),
        cleanup_cancellation: CancellationToken::new(),
        cleanup_deadline: StdInstant::now() + PROCESS_CLEANUP_TIMEOUT,
        #[cfg(test)]
        setup_interlock: None,
        #[cfg(test)]
        cleanup_interlock: None,
    };
    capability.verify_path_identity()?;
    Ok(capability)
}

pub(super) struct OwnedProcessInvocation {
    invocation: AdapterInvocation,
    agent_kind: LocalAgentKind,
    temp_dir: Option<TempDir>,
    temp_identity: FileIdentity,
    temp_handle: Option<File>,
    temp_parent_handle: Option<File>,
    temp_name: OsString,
    executable_identity: FileIdentity,
    executable_proof: ExecutableProof,
    inherited_environment: BTreeMap<OsString, OsString>,
    _executable_handle: File,
    owned_files: Vec<OwnedFile>,
    owned_directories: Vec<OwnedDirectory>,
    retained_private_sources: Vec<RetainedSourceFile>,
    result_path: Option<PathBuf>,
    cleanup_activity: Option<CleanupActivityGuard>,
    cleanup_cancellation: CancellationToken,
    cleanup_deadline: StdInstant,
    #[cfg(test)]
    spawn_interlock: Option<TestSpawnInterlock>,
    #[cfg(test)]
    workspace_spawn_interlock: Option<TestWorkspaceSpawnInterlock>,
    #[cfg(test)]
    cleanup_interlock: Option<TestCleanupInterlock>,
}

#[cfg(test)]
#[derive(Clone)]
struct TestSpawnInterlock {
    before_spawn: std::sync::Arc<std::sync::Barrier>,
    replacement_ready: std::sync::Arc<std::sync::Barrier>,
    spawn_returned: std::sync::Arc<std::sync::Barrier>,
    original_restored: std::sync::Arc<std::sync::Barrier>,
}

#[cfg(test)]
#[derive(Clone)]
struct TestWorkspaceSpawnInterlock {
    before_spawn: std::sync::Arc<std::sync::Barrier>,
    replacement_ready: std::sync::Arc<std::sync::Barrier>,
    spawn_returned: std::sync::Arc<std::sync::Barrier>,
    child_ready: std::sync::Arc<std::sync::Barrier>,
}

#[cfg(test)]
#[derive(Clone)]
struct TestSetupInterlock {
    before_create: std::sync::Arc<std::sync::Barrier>,
    replacement_ready: std::sync::Arc<std::sync::Barrier>,
}

#[cfg(test)]
#[derive(Clone)]
struct TestCleanupInterlock {
    before_removal: std::sync::Arc<std::sync::Barrier>,
    replacement_ready: std::sync::Arc<std::sync::Barrier>,
}

impl fmt::Debug for OwnedProcessInvocation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("OwnedProcessInvocation")
            .field("argument_count", &self.invocation.args.len())
            .field("stdin_bytes", &self.invocation.stdin.len())
            .field("owned_file_count", &self.owned_files.len())
            .field("owned_directory_count", &self.owned_directories.len())
            .field(
                "retained_private_source_count",
                &self.retained_private_sources.len(),
            )
            .field("has_result_file", &self.result_path.is_some())
            .finish_non_exhaustive()
    }
}

impl OwnedProcessInvocation {
    pub(super) fn prepare(
        invocation: AdapterInvocation,
        temp_dir: OwnedTempCapability,
        executable_proof: ExecutableProof,
        agent_kind: LocalAgentKind,
        cancellation: &CancellationToken,
        deadline: StdInstant,
    ) -> Result<Self, LocalAgentError> {
        Self::prepare_with_inherited_environment(
            invocation,
            temp_dir,
            executable_proof,
            agent_kind,
            cancellation,
            deadline,
            env::vars_os().collect(),
        )
    }

    fn prepare_with_inherited_environment(
        mut invocation: AdapterInvocation,
        mut temp_dir: OwnedTempCapability,
        executable_proof: ExecutableProof,
        agent_kind: LocalAgentKind,
        cancellation: &CancellationToken,
        deadline: StdInstant,
        inherited_environment: BTreeMap<OsString, OsString>,
    ) -> Result<Self, LocalAgentError> {
        temp_dir.set_cleanup_context(cancellation, deadline);
        ensure_process_active(cancellation, deadline)?;
        if invocation.stdin.len() > MAX_PROCESS_STDIN_BYTES {
            return Err(LocalAgentError::run(
                "request_too_large",
                "The prepared local agent request is too large.",
            ));
        }
        temp_dir.verify_path_identity()?;
        let temp_path = temp_dir.path().to_path_buf();
        if invocation.cwd != temp_path {
            return Err(LocalAgentError::run(
                "invalid_temp_directory",
                "The local agent temporary directory is invalid.",
            ));
        }
        invocation.cwd = temp_path.clone();
        temp_dir.verify_adapter_files()?;

        if !invocation.executable.is_absolute()
            || invocation.executable.canonicalize().ok().as_ref() != Some(&invocation.executable)
        {
            return Err(LocalAgentError::run(
                "invalid_executable",
                "The local agent executable is invalid.",
            ));
        }
        verify_executable_proof(
            &executable_proof,
            &invocation.executable,
            cancellation,
            deadline,
        )?;
        let executable_handle = open_no_follow(&invocation.executable, false)?;
        let executable_identity = FileIdentity::from_handle_and_path(
            &executable_handle,
            &invocation.executable,
            FileRole::Executable,
        )?;

        let result_path = invocation.result_file.clone();
        if let Some(path) = result_path.as_deref()
            && path.parent() != Some(temp_path.as_path())
        {
            return Err(LocalAgentError::run(
                "invalid_result_file",
                "The local agent result file is invalid.",
            ));
        }

        let mut owned_files = Vec::new();
        let mut owned_directories = Vec::new();
        let mut retained_private_sources = Vec::new();
        if agent_kind == LocalAgentKind::Claude {
            for name in [
                CLAUDE_HOME_DIRECTORY,
                CLAUDE_CONFIG_DIRECTORY,
                CLAUDE_XDG_CONFIG_DIRECTORY,
                CLAUDE_CACHE_DIRECTORY,
                CLAUDE_DATA_DIRECTORY,
                CLAUDE_STATE_DIRECTORY,
            ] {
                owned_directories.push(temp_dir.create_directory(Path::new(name), None)?);
            }
        } else if agent_kind == LocalAgentKind::Opencode {
            for name in [
                OPENCODE_CONFIG_DIRECTORY,
                OPENCODE_CACHE_DIRECTORY,
                OPENCODE_DATA_DIRECTORY,
                OPENCODE_STATE_DIRECTORY,
            ] {
                owned_directories.push(temp_dir.create_directory(Path::new(name), None)?);
            }
            let data_directory = owned_directories
                .iter()
                .find(|directory| directory.path == temp_path.join(OPENCODE_DATA_DIRECTORY))
                .ok_or_else(invalid_environment_error)?;
            let agent_data_relative =
                Path::new(OPENCODE_DATA_DIRECTORY).join(OPENCODE_DATA_AGENT_DIRECTORY);
            let agent_data_directory =
                temp_dir.create_directory(&agent_data_relative, Some(data_directory))?;
            if let Some((source, auth_file)) = copy_private_json_file(
                opencode_auth_source(&inherited_environment)?,
                FileRole::OwnedFile,
                &temp_dir,
                &agent_data_relative.join(OPENCODE_AUTH_FILE),
                &agent_data_directory,
                cancellation,
                deadline,
            )? {
                retained_private_sources.push(source);
                owned_files.push(auth_file);
            }
            let state_directory = owned_directories
                .iter()
                .find(|directory| directory.path == temp_path.join(OPENCODE_STATE_DIRECTORY))
                .ok_or_else(invalid_environment_error)?;
            let agent_state_relative =
                Path::new(OPENCODE_STATE_DIRECTORY).join(OPENCODE_STATE_AGENT_DIRECTORY);
            let agent_state_directory =
                temp_dir.create_directory(&agent_state_relative, Some(state_directory))?;
            if let Some((source, model_state_file)) = copy_private_json_file(
                opencode_model_state_source(&inherited_environment)?,
                FileRole::SourceFile,
                &temp_dir,
                &agent_state_relative.join(OPENCODE_MODEL_STATE_FILE),
                &agent_state_directory,
                cancellation,
                deadline,
            )? {
                retained_private_sources.push(source);
                owned_files.push(model_state_file);
            }
            owned_directories.push(agent_data_directory);
            owned_directories.push(agent_state_directory);
        } else if agent_kind == LocalAgentKind::Codex {
            let codex_home = temp_dir.create_directory(Path::new(CODEX_HOME_DIRECTORY), None)?;
            if let Some((source, auth_file)) = copy_private_json_file(
                home_auth_source(&inherited_environment, &[".codex", CODEX_AUTH_FILE])?,
                FileRole::OwnedFile,
                &temp_dir,
                &Path::new(CODEX_HOME_DIRECTORY).join(CODEX_AUTH_FILE),
                &codex_home,
                cancellation,
                deadline,
            )? {
                retained_private_sources.push(source);
                owned_files.push(auth_file);
            }
            owned_directories.push(codex_home);
        }
        temp_dir.verify_path_identity()?;
        for file in &temp_dir.adapter_files {
            file.verify_identity()?;
        }
        for file in &owned_files {
            file.verify_identity()?;
        }
        for directory in &owned_directories {
            directory.verify_identity()?;
        }
        verify_root_entries_exact(
            temp_dir.root.as_ref().ok_or_else(temp_cleanup_error)?,
            temp_dir
                .adapter_files
                .iter()
                .map(|file| file.path.as_path()),
            owned_directories
                .iter()
                .map(|directory| directory.path.as_path())
                .filter(|path| path.parent() == Some(temp_path.as_path())),
        )?;
        temp_dir.verify_path_identity()?;
        if result_path.is_some()
            && !temp_dir
                .adapter_files
                .iter()
                .any(|file| file.is_result && result_path.as_deref() == Some(file.path.as_path()))
        {
            return Err(LocalAgentError::run(
                "invalid_result_file",
                "The local agent result file is invalid.",
            ));
        }

        let mut parts = temp_dir.into_parts();
        parts.adapter_files.append(&mut owned_files);

        Ok(Self {
            invocation,
            agent_kind,
            temp_dir: Some(parts.temp_dir),
            temp_identity: parts.identity,
            temp_handle: Some(parts.root),
            temp_parent_handle: Some(parts.parent),
            temp_name: parts.root_name,
            executable_identity,
            executable_proof,
            inherited_environment,
            _executable_handle: executable_handle,
            owned_files: parts.adapter_files,
            owned_directories,
            retained_private_sources,
            result_path,
            cleanup_activity: Some(parts.cleanup_activity),
            cleanup_cancellation: parts.cleanup_cancellation,
            cleanup_deadline: parts.cleanup_deadline,
            #[cfg(test)]
            spawn_interlock: None,
            #[cfg(test)]
            workspace_spawn_interlock: None,
            #[cfg(test)]
            cleanup_interlock: parts.cleanup_interlock,
        })
    }

    fn verify_before_spawn(
        &self,
        cancellation: &CancellationToken,
        deadline: StdInstant,
    ) -> Result<(), LocalAgentError> {
        ensure_process_active(cancellation, deadline)?;
        self.temp_identity
            .verify_path(&self.invocation.cwd, FileRole::OwnedDirectory)?;
        self.executable_identity
            .verify_path(&self.invocation.executable, FileRole::Executable)?;
        verify_executable_proof(
            &self.executable_proof,
            &self.invocation.executable,
            cancellation,
            deadline,
        )?;
        for file in &self.owned_files {
            file.verify_identity()?;
        }
        for directory in &self.owned_directories {
            directory.verify_identity()?;
        }
        for source in &self.retained_private_sources {
            source.verify_identity()?;
        }
        Ok(())
    }

    fn verify_before_stdin(
        &self,
        cancellation: &CancellationToken,
        deadline: StdInstant,
    ) -> Result<(), LocalAgentError> {
        self.verify_before_spawn(cancellation, deadline)?;
        self.temp_identity.verify_owned_directory_handle(
            self.temp_handle.as_ref().ok_or_else(temp_cleanup_error)?,
        )
    }

    #[cfg(all(test, unix))]
    fn replace_cleanup_registry_for_test(&mut self, registry: Arc<Mutex<ProcessGroupRegistry>>) {
        self.cleanup_activity = CleanupActivityGuard::reserve_with_registry(registry);
    }

    fn read_result_file(&mut self) -> Result<Option<Vec<u8>>, LocalAgentError> {
        let Some(file) = self.owned_files.iter_mut().find(|file| file.is_result) else {
            return Ok(None);
        };
        file.verify_identity()?;
        let size = file
            .handle
            .metadata()
            .map_err(|_| invalid_result_file())?
            .len();
        if size > MAX_PROCESS_OUTPUT_BYTES as u64 {
            return Err(LocalAgentError::run(
                "local_agent_output_too_large",
                "The local agent output exceeded the safe limit.",
            ));
        }
        file.handle
            .seek(SeekFrom::Start(0))
            .map_err(|_| invalid_result_file())?;
        let mut bytes = Vec::with_capacity((size as usize).min(MAX_PROCESS_OUTPUT_BYTES));
        Read::by_ref(&mut file.handle)
            .take((MAX_PROCESS_OUTPUT_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| invalid_result_file())?;
        if bytes.len() > MAX_PROCESS_OUTPUT_BYTES {
            return Err(LocalAgentError::run(
                "local_agent_output_too_large",
                "The local agent output exceeded the safe limit.",
            ));
        }
        if bytes.len() as u64 != size {
            return Err(invalid_result_file());
        }
        file.verify_identity()?;
        if file
            .handle
            .metadata()
            .map_err(|_| invalid_result_file())?
            .len()
            != size
        {
            return Err(invalid_result_file());
        }
        Ok(Some(bytes))
    }

    async fn close_temp_dir(&mut self) -> Result<(), LocalAgentError> {
        close_temp_dir(
            TempCleanupSlot {
                temp_dir: &mut self.temp_dir,
                identity: Some(&self.temp_identity),
                root: &mut self.temp_handle,
                parent: &mut self.temp_parent_handle,
                root_name: Some(&self.temp_name),
                activity: &mut self.cleanup_activity,
                clear_detached_contents: false,
            },
            &self.cleanup_cancellation,
            self.cleanup_deadline,
            #[cfg(test)]
            self.cleanup_interlock.as_ref(),
        )
        .await
    }
}

impl Drop for OwnedProcessInvocation {
    fn drop(&mut self) {
        schedule_temp_dir_cleanup(
            TempCleanupSlot {
                temp_dir: &mut self.temp_dir,
                identity: Some(&self.temp_identity),
                root: &mut self.temp_handle,
                parent: &mut self.temp_parent_handle,
                root_name: Some(&self.temp_name),
                activity: &mut self.cleanup_activity,
                clear_detached_contents: false,
            },
            self.cleanup_cancellation.clone(),
            self.cleanup_deadline,
            #[cfg(test)]
            self.cleanup_interlock.clone(),
        );
    }
}

struct TempCleanupJob {
    identity: FileIdentity,
    root: File,
    parent: File,
    root_name: OsString,
    activity: CleanupActivityGuard,
    clear_detached_contents: bool,
    #[cfg(test)]
    interlock: Option<TestCleanupInterlock>,
}

struct TempCleanupSlot<'a> {
    temp_dir: &'a mut Option<TempDir>,
    identity: Option<&'a FileIdentity>,
    root: &'a mut Option<File>,
    parent: &'a mut Option<File>,
    root_name: Option<&'a OsStr>,
    activity: &'a mut Option<CleanupActivityGuard>,
    clear_detached_contents: bool,
}

struct TempCleanupBudget {
    cancellation: CancellationToken,
    watch_cancellation: bool,
    supervisor_abort: CancellationToken,
    deadline: StdInstant,
    remaining_entries: usize,
}

impl TempCleanupBudget {
    fn check(&self) -> Result<(), LocalAgentError> {
        if self.watch_cancellation && self.cancellation.is_cancelled()
            || self.supervisor_abort.is_cancelled()
            || StdInstant::now() >= self.deadline
        {
            Err(temp_cleanup_error())
        } else {
            Ok(())
        }
    }

    fn consume_entry(&mut self) -> Result<(), LocalAgentError> {
        self.check()?;
        let Some(remaining) = self.remaining_entries.checked_sub(1) else {
            return Err(temp_cleanup_error());
        };
        self.remaining_entries = remaining;
        Ok(())
    }
}

async fn close_temp_dir(
    slot: TempCleanupSlot<'_>,
    cancellation: &CancellationToken,
    deadline: StdInstant,
    #[cfg(test)] cleanup_interlock: Option<&TestCleanupInterlock>,
) -> Result<(), LocalAgentError> {
    let Some(job) = take_temp_cleanup_job(
        slot,
        #[cfg(test)]
        cleanup_interlock.cloned(),
    )?
    else {
        return Ok(());
    };
    supervise_temp_cleanup(job, cancellation.clone(), deadline).await
}

fn take_temp_cleanup_job(
    slot: TempCleanupSlot<'_>,
    #[cfg(test)] cleanup_interlock: Option<TestCleanupInterlock>,
) -> Result<Option<TempCleanupJob>, LocalAgentError> {
    let Some(directory) = slot.temp_dir.take() else {
        return Ok(None);
    };
    let _retained_path = directory.keep();
    let mut activity = slot.activity.take().ok_or_else(temp_cleanup_error)?;
    activity.mark_started();
    Ok(Some(TempCleanupJob {
        identity: slot.identity.cloned().ok_or_else(temp_cleanup_error)?,
        root: slot.root.take().ok_or_else(temp_cleanup_error)?,
        parent: slot.parent.take().ok_or_else(temp_cleanup_error)?,
        root_name: slot.root_name.ok_or_else(temp_cleanup_error)?.to_owned(),
        activity,
        clear_detached_contents: slot.clear_detached_contents,
        #[cfg(test)]
        interlock: cleanup_interlock,
    }))
}

fn schedule_temp_dir_cleanup(
    slot: TempCleanupSlot<'_>,
    cancellation: CancellationToken,
    deadline: StdInstant,
    #[cfg(test)] cleanup_interlock: Option<TestCleanupInterlock>,
) {
    let Ok(Some(job)) = take_temp_cleanup_job(
        slot,
        #[cfg(test)]
        cleanup_interlock,
    ) else {
        return;
    };
    if let Ok(runtime) = tokio::runtime::Handle::try_current() {
        runtime.spawn(async move {
            let _ = supervise_temp_cleanup(job, cancellation, deadline).await;
        });
    } else {
        let shutdown_cleanup = job.activity.shutdown_started();
        let deadline = if shutdown_cleanup {
            StdInstant::now() + PROCESS_CLEANUP_TIMEOUT
        } else {
            deadline
        };
        let supervisor_abort = CancellationToken::new();
        let watch_cancellation = !shutdown_cleanup && !cancellation.is_cancelled();
        let _ = std::thread::Builder::new()
            .name("local-agent-temp-cleanup".to_string())
            .spawn(move || {
                let _ = run_temp_cleanup_job(
                    job,
                    cancellation,
                    watch_cancellation,
                    supervisor_abort,
                    deadline,
                );
            });
    }
}

async fn supervise_temp_cleanup(
    job: TempCleanupJob,
    cancellation: CancellationToken,
    mut deadline: StdInstant,
) -> Result<(), LocalAgentError> {
    let shutdown_cleanup = job.activity.shutdown_started();
    if shutdown_cleanup {
        deadline = StdInstant::now() + PROCESS_CLEANUP_TIMEOUT;
    }
    if StdInstant::now() >= deadline {
        return Err(temp_cleanup_error());
    }
    let watch_cancellation = !shutdown_cleanup && !cancellation.is_cancelled();
    let supervisor_abort = CancellationToken::new();
    let worker_abort = supervisor_abort.clone();
    let worker_cancellation = cancellation.clone();
    let mut worker = tokio::task::spawn_blocking(move || {
        run_temp_cleanup_job(
            job,
            worker_cancellation,
            watch_cancellation,
            worker_abort,
            deadline,
        )
    });
    tokio::select! {
        biased;
        result = &mut worker => result.map_err(|_| temp_cleanup_error())?,
        () = cancellation.cancelled(), if watch_cancellation => {
            supervisor_abort.cancel();
            Err(temp_cleanup_error())
        }
        () = tokio::time::sleep_until(TokioInstant::from_std(deadline)) => {
            supervisor_abort.cancel();
            Err(temp_cleanup_error())
        }
    }
}

fn run_temp_cleanup_job(
    mut job: TempCleanupJob,
    cancellation: CancellationToken,
    watch_cancellation: bool,
    supervisor_abort: CancellationToken,
    deadline: StdInstant,
) -> Result<(), LocalAgentError> {
    let mut budget = TempCleanupBudget {
        cancellation,
        watch_cancellation,
        supervisor_abort,
        deadline,
        remaining_entries: MAX_TEMP_CLEANUP_ENTRIES,
    };
    budget.check()?;
    if job.clear_detached_contents {
        job.identity.verify_owned_directory_handle(&job.root)?;
    } else {
        job.identity
            .verify_owned_directory_at(&job.parent, &job.root_name, &job.root)?;
    }
    #[cfg(test)]
    if let Some(interlock) = &job.interlock {
        interlock.before_removal.wait();
        interlock.replacement_ready.wait();
    }
    budget.check()?;
    if job.clear_detached_contents {
        job.identity.verify_owned_directory_handle(&job.root)?;
    } else {
        job.identity
            .verify_owned_directory_at(&job.parent, &job.root_name, &job.root)?;
    }

    #[cfg(unix)]
    {
        if unsafe { libc::fchmod(job.root.as_raw_fd(), 0o700) } != 0 {
            return Err(temp_cleanup_error());
        }
        remove_owned_directory_entries(job.root.as_raw_fd(), 0, &mut budget)?;
        budget.check()?;
        job.identity
            .verify_owned_directory_at(&job.parent, &job.root_name, &job.root)?;
        let root_name = CString::new(job.root_name.as_bytes()).map_err(|_| temp_cleanup_error())?;
        budget.check()?;
        if unsafe {
            libc::unlinkat(
                job.parent.as_raw_fd(),
                root_name.as_ptr(),
                libc::AT_REMOVEDIR,
            )
        } != 0
        {
            return Err(temp_cleanup_error());
        }
        job.activity.mark_succeeded();
        Ok(())
    }
    #[cfg(not(unix))]
    {
        let _ = job;
        Err(temp_cleanup_error())
    }
}

fn temp_cleanup_error() -> LocalAgentError {
    LocalAgentError::run(
        "local_agent_cleanup_failed",
        "The local agent temporary directory could not be removed.",
    )
}

#[cfg(unix)]
fn remove_owned_directory_entries(
    directory_fd: std::os::fd::RawFd,
    depth: usize,
    budget: &mut TempCleanupBudget,
) -> Result<(), LocalAgentError> {
    budget.check()?;
    if depth > MAX_TEMP_CLEANUP_DEPTH {
        return Err(temp_cleanup_error());
    }
    if unsafe { libc::lseek(directory_fd, 0, libc::SEEK_SET) } < 0 {
        return Err(temp_cleanup_error());
    }
    budget.check()?;
    let duplicate = unsafe { libc::fcntl(directory_fd, libc::F_DUPFD_CLOEXEC, 0) };
    if duplicate < 0 {
        return Err(temp_cleanup_error());
    }
    let stream = unsafe { libc::fdopendir(duplicate) };
    if stream.is_null() {
        unsafe {
            libc::close(duplicate);
        }
        return Err(temp_cleanup_error());
    }

    let result = (|| {
        loop {
            budget.check()?;
            let entry = unsafe { libc::readdir(stream) };
            if entry.is_null() {
                break;
            }
            let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) };
            if name.to_bytes() == b"." || name.to_bytes() == b".." {
                continue;
            }
            budget.consume_entry()?;

            let mut captured = std::mem::MaybeUninit::<libc::stat>::uninit();
            if unsafe {
                libc::fstatat(
                    directory_fd,
                    name.as_ptr(),
                    captured.as_mut_ptr(),
                    libc::AT_SYMLINK_NOFOLLOW,
                )
            } != 0
            {
                return Err(temp_cleanup_error());
            }
            let captured = unsafe { captured.assume_init() };
            if captured.st_uid != unsafe { libc::geteuid() } {
                return Err(temp_cleanup_error());
            }
            if captured.st_mode & libc::S_IFMT != libc::S_IFDIR {
                budget.check()?;
                if unsafe { libc::unlinkat(directory_fd, name.as_ptr(), 0) } != 0 {
                    return Err(temp_cleanup_error());
                }
                continue;
            }
            budget.check()?;
            if unsafe {
                libc::fchmodat(
                    directory_fd,
                    name.as_ptr(),
                    0o700,
                    libc::AT_SYMLINK_NOFOLLOW,
                )
            } != 0
            {
                return Err(temp_cleanup_error());
            }

            budget.check()?;
            let child_fd = unsafe {
                libc::openat(
                    directory_fd,
                    name.as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
            if child_fd < 0 {
                return Err(temp_cleanup_error());
            }
            let child = unsafe { File::from_raw_fd(child_fd) };
            let mut opened = std::mem::MaybeUninit::<libc::stat>::uninit();
            if unsafe { libc::fstat(child.as_raw_fd(), opened.as_mut_ptr()) } != 0 {
                return Err(temp_cleanup_error());
            }
            let opened = unsafe { opened.assume_init() };
            if opened.st_dev != captured.st_dev
                || opened.st_ino != captured.st_ino
                || opened.st_uid != captured.st_uid
                || opened.st_mode & libc::S_IFMT != libc::S_IFDIR
                || unsafe { libc::fchmod(child.as_raw_fd(), 0o700) } != 0
            {
                return Err(temp_cleanup_error());
            }
            remove_owned_directory_entries(child.as_raw_fd(), depth + 1, budget)?;
            budget.check()?;
            let mut current = std::mem::MaybeUninit::<libc::stat>::uninit();
            if unsafe {
                libc::fstatat(
                    directory_fd,
                    name.as_ptr(),
                    current.as_mut_ptr(),
                    libc::AT_SYMLINK_NOFOLLOW,
                )
            } != 0
            {
                return Err(temp_cleanup_error());
            }
            let current = unsafe { current.assume_init() };
            if current.st_dev != opened.st_dev
                || current.st_ino != opened.st_ino
                || current.st_uid != opened.st_uid
                || current.st_mode & libc::S_IFMT != libc::S_IFDIR
                || unsafe { libc::unlinkat(directory_fd, name.as_ptr(), libc::AT_REMOVEDIR) } != 0
            {
                return Err(temp_cleanup_error());
            }
        }
        Ok(())
    })();
    unsafe {
        libc::closedir(stream);
    }
    result
}

struct OwnedFile {
    path: PathBuf,
    handle: File,
    identity: FileIdentity,
    is_result: bool,
    mutable_private: bool,
}

struct OwnedDirectory {
    path: PathBuf,
    handle: File,
    identity: FileIdentity,
}

impl OwnedDirectory {
    fn verify_identity(&self) -> Result<(), LocalAgentError> {
        self.identity
            .verify_handle_and_path(&self.handle, &self.path, FileRole::OwnedDirectory)
    }
}

fn create_owned_directory_at(
    parent: &File,
    name: &OsStr,
    path: &Path,
) -> Result<OwnedDirectory, LocalAgentError> {
    #[cfg(unix)]
    {
        let name =
            CString::new(name.as_bytes()).map_err(|_| identity_error(FileRole::OwnedDirectory))?;
        if unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), 0o700) } != 0 {
            return Err(LocalAgentError::run(
                "local_agent_setup_failed",
                "The local agent could not be prepared.",
            ));
        }
    }
    #[cfg(not(unix))]
    {
        let _ = parent;
        let mut builder = fs::DirBuilder::new();
        builder.create(path).map_err(|_| {
            LocalAgentError::run(
                "local_agent_setup_failed",
                "The local agent could not be prepared.",
            )
        })?;
    }
    let handle = open_owned_directory_at(parent, name)?;
    let identity = FileIdentity::from_handle_and_path(&handle, path, FileRole::OwnedDirectory)?;
    Ok(OwnedDirectory {
        path: path.to_path_buf(),
        handle,
        identity,
    })
}

struct RetainedSourceFile {
    path: PathBuf,
    handle: File,
    identity: FileIdentity,
    role: FileRole,
    content_sha256: [u8; 32],
}

impl RetainedSourceFile {
    fn verify_identity(&self) -> Result<(), LocalAgentError> {
        self.identity
            .verify_handle_and_path(&self.handle, &self.path, self.role)
            .map_err(|_| invalid_environment_error())?;
        let mut handle = self
            .handle
            .try_clone()
            .map_err(|_| invalid_environment_error())?;
        handle
            .seek(SeekFrom::Start(0))
            .map_err(|_| invalid_environment_error())?;
        let mut bytes = Vec::new();
        Read::by_ref(&mut handle)
            .take((MAX_AGENT_PRIVATE_FILE_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| invalid_environment_error())?;
        let matches = bytes.len() <= MAX_AGENT_PRIVATE_FILE_BYTES
            && <[u8; 32]>::from(Sha256::digest(&bytes)) == self.content_sha256;
        bytes.fill(0);
        if matches {
            Ok(())
        } else {
            Err(invalid_environment_error())
        }
    }
}

fn copy_private_json_file(
    source: Option<PathBuf>,
    source_role: FileRole,
    workspace: &OwnedTempCapability,
    destination: &Path,
    destination_parent: &OwnedDirectory,
    cancellation: &CancellationToken,
    deadline: StdInstant,
) -> Result<Option<(RetainedSourceFile, OwnedFile)>, LocalAgentError> {
    let Some(source) = source else {
        return Ok(None);
    };
    workspace.verify_path_identity()?;
    let source_metadata = match fs::symlink_metadata(&source) {
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(invalid_environment_error()),
        Ok(metadata) => metadata,
    };
    if source_metadata.file_type().is_symlink() {
        return Err(invalid_environment_error());
    }
    let source_name = source.file_name().ok_or_else(invalid_environment_error)?;
    let source_parent = source.parent().ok_or_else(invalid_environment_error)?;
    let source_parent =
        canonical_safe_directory(source_parent, false).ok_or_else(invalid_environment_error)?;
    let source = source_parent.join(source_name);
    workspace.verify_path_identity()?;
    ensure_process_active(cancellation, deadline)?;
    workspace.verify_path_identity()?;
    let mut source_handle =
        open_no_follow(&source, false).map_err(|_| invalid_environment_error())?;
    let source_identity = FileIdentity::from_handle_and_path(&source_handle, &source, source_role)
        .map_err(|_| invalid_environment_error())?;
    let source_size = source_handle
        .metadata()
        .map_err(|_| invalid_environment_error())?
        .len();
    if source_size > MAX_AGENT_PRIVATE_FILE_BYTES as u64 {
        return Err(invalid_environment_error());
    }
    let mut bytes = Vec::with_capacity(source_size as usize);
    Read::by_ref(&mut source_handle)
        .take((MAX_AGENT_PRIVATE_FILE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| invalid_environment_error())?;
    if bytes.len() > MAX_AGENT_PRIVATE_FILE_BYTES
        || bytes.len() as u64 != source_size
        || source_handle
            .metadata()
            .map_err(|_| invalid_environment_error())?
            .len()
            != source_size
    {
        return Err(invalid_environment_error());
    }
    if bytes.contains(&0)
        || !serde_json::from_slice::<serde_json::Value>(&bytes).is_ok_and(|value| value.is_object())
    {
        bytes.fill(0);
        return Err(invalid_environment_error());
    }
    source_identity
        .verify_handle_and_path(&source_handle, &source, source_role)
        .map_err(|_| invalid_environment_error())?;
    workspace.verify_path_identity()?;
    ensure_process_active(cancellation, deadline)?;
    let source_sha256 = <[u8; 32]>::from(Sha256::digest(&bytes));
    let destination_result = workspace.create_private_file(destination, destination_parent, &bytes);
    bytes.fill(0);
    let destination = destination_result?;
    workspace.verify_path_identity()?;
    ensure_process_active(cancellation, deadline)?;
    Ok(Some((
        RetainedSourceFile {
            path: source,
            handle: source_handle,
            identity: source_identity,
            role: source_role,
            content_sha256: source_sha256,
        },
        destination,
    )))
}

fn home_auth_source(
    inherited: &BTreeMap<OsString, OsString>,
    components: &[&str],
) -> Result<Option<PathBuf>, LocalAgentError> {
    let Some(home) = inherited.get(OsStr::new("HOME")) else {
        return Ok(None);
    };
    let home = PathBuf::from(normalized_safe_home(home)?);
    Ok(Some(
        components
            .iter()
            .fold(home, |path, component| path.join(component)),
    ))
}

fn opencode_auth_source(
    inherited: &BTreeMap<OsString, OsString>,
) -> Result<Option<PathBuf>, LocalAgentError> {
    if let Some(data_home) = inherited.get(OsStr::new("XDG_DATA_HOME")) {
        let data_home = PathBuf::from(normalized_safe_home(data_home)?);
        return Ok(Some(
            data_home
                .join(OPENCODE_DATA_AGENT_DIRECTORY)
                .join(OPENCODE_AUTH_FILE),
        ));
    }
    home_auth_source(
        inherited,
        &[".local", "share", "opencode", OPENCODE_AUTH_FILE],
    )
}

fn opencode_model_state_source(
    inherited: &BTreeMap<OsString, OsString>,
) -> Result<Option<PathBuf>, LocalAgentError> {
    if let Some(state_home) = inherited.get(OsStr::new("XDG_STATE_HOME")) {
        let state_home = PathBuf::from(normalized_safe_home(state_home)?);
        return Ok(Some(
            state_home
                .join(OPENCODE_STATE_AGENT_DIRECTORY)
                .join(OPENCODE_MODEL_STATE_FILE),
        ));
    }
    home_auth_source(
        inherited,
        &[
            ".local",
            "state",
            OPENCODE_STATE_AGENT_DIRECTORY,
            OPENCODE_MODEL_STATE_FILE,
        ],
    )
}

impl OwnedFile {
    fn verify_identity(&self) -> Result<(), LocalAgentError> {
        self.identity
            .verify_handle_and_path(&self.handle, &self.path, FileRole::OwnedFile)
            .map_err(|_| {
                if self.is_result {
                    invalid_result_file()
                } else {
                    LocalAgentError::run(
                        "invalid_temp_file",
                        "A local agent temporary file is invalid.",
                    )
                }
            })
    }
}

#[derive(Debug, Clone, Copy)]
enum FileRole {
    Executable,
    OwnedDirectory,
    OwnedFile,
    SourceFile,
}

#[derive(Clone)]
struct FileIdentity {
    canonical_path: PathBuf,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
    #[cfg(unix)]
    owner: u32,
    #[cfg(unix)]
    mode: u32,
}

impl FileIdentity {
    fn from_path(path: &Path, role: FileRole) -> Result<Self, LocalAgentError> {
        let metadata = fs::symlink_metadata(path).map_err(|_| identity_error(role))?;
        Self::from_metadata(path, &metadata, role)
    }

    fn from_handle_and_path(
        handle: &File,
        path: &Path,
        role: FileRole,
    ) -> Result<Self, LocalAgentError> {
        let path_metadata = fs::symlink_metadata(path).map_err(|_| identity_error(role))?;
        let handle_metadata = handle.metadata().map_err(|_| identity_error(role))?;
        let identity = Self::from_metadata(path, &path_metadata, role)?;
        if !identity.matches_metadata(&handle_metadata, role) {
            return Err(identity_error(role));
        }
        Ok(identity)
    }

    fn from_metadata(
        path: &Path,
        metadata: &fs::Metadata,
        role: FileRole,
    ) -> Result<Self, LocalAgentError> {
        if metadata.file_type().is_symlink()
            || matches!(role, FileRole::OwnedDirectory) != metadata.is_dir()
            || !matches!(role, FileRole::OwnedDirectory) && !metadata.is_file()
        {
            return Err(identity_error(role));
        }
        let canonical_path = path.canonicalize().map_err(|_| identity_error(role))?;
        if canonical_path != path {
            return Err(identity_error(role));
        }
        #[cfg(unix)]
        {
            let mode = metadata.mode();
            match role {
                FileRole::Executable if mode & 0o111 == 0 => {
                    return Err(identity_error(role));
                }
                FileRole::OwnedDirectory
                    if mode & 0o777 != 0o700 || metadata.uid() != unsafe { libc::geteuid() } =>
                {
                    return Err(identity_error(role));
                }
                FileRole::OwnedFile
                    if mode & 0o077 != 0
                        || metadata.uid() != unsafe { libc::geteuid() }
                        || metadata.nlink() != 1 =>
                {
                    return Err(identity_error(role));
                }
                FileRole::SourceFile
                    if mode & 0o022 != 0
                        || metadata.uid() != unsafe { libc::geteuid() }
                        || metadata.nlink() != 1 =>
                {
                    return Err(identity_error(role));
                }
                _ => {}
            }
            Ok(Self {
                canonical_path,
                device: metadata.dev(),
                inode: metadata.ino(),
                owner: metadata.uid(),
                mode,
            })
        }
        #[cfg(not(unix))]
        {
            Ok(Self { canonical_path })
        }
    }

    fn verify_path(&self, path: &Path, role: FileRole) -> Result<(), LocalAgentError> {
        let metadata = fs::symlink_metadata(path).map_err(|_| identity_error(role))?;
        if path.canonicalize().ok().as_ref() != Some(&self.canonical_path)
            || !self.matches_metadata(&metadata, role)
        {
            return Err(identity_error(role));
        }
        Ok(())
    }

    fn verify_handle_and_path(
        &self,
        handle: &File,
        path: &Path,
        role: FileRole,
    ) -> Result<(), LocalAgentError> {
        self.verify_path(path, role)?;
        let metadata = handle.metadata().map_err(|_| identity_error(role))?;
        if !self.matches_metadata(&metadata, role) {
            return Err(identity_error(role));
        }
        Ok(())
    }

    #[cfg(not(unix))]
    fn verify_owned_directory_for_deletion(
        &self,
        handle: &File,
        path: &Path,
    ) -> Result<(), LocalAgentError> {
        let metadata =
            fs::symlink_metadata(path).map_err(|_| identity_error(FileRole::OwnedDirectory))?;
        let handle_metadata = handle
            .metadata()
            .map_err(|_| identity_error(FileRole::OwnedDirectory))?;
        if path.canonicalize().ok().as_ref() != Some(&self.canonical_path)
            || !metadata.is_dir()
            || metadata.file_type().is_symlink()
            || !handle_metadata.is_dir()
        {
            return Err(identity_error(FileRole::OwnedDirectory));
        }
        #[cfg(unix)]
        if self.device != metadata.dev()
            || self.inode != metadata.ino()
            || self.owner != metadata.uid()
            || self.device != handle_metadata.dev()
            || self.inode != handle_metadata.ino()
            || self.owner != handle_metadata.uid()
        {
            return Err(identity_error(FileRole::OwnedDirectory));
        }
        Ok(())
    }

    fn verify_owned_directory_at(
        &self,
        parent: &File,
        name: &OsStr,
        handle: &File,
    ) -> Result<(), LocalAgentError> {
        #[cfg(unix)]
        {
            if Path::new(name).components().count() != 1 {
                return Err(identity_error(FileRole::OwnedDirectory));
            }
            let name = CString::new(name.as_bytes())
                .map_err(|_| identity_error(FileRole::OwnedDirectory))?;
            let mut captured = std::mem::MaybeUninit::<libc::stat>::uninit();
            if unsafe {
                libc::fstatat(
                    parent.as_raw_fd(),
                    name.as_ptr(),
                    captured.as_mut_ptr(),
                    libc::AT_SYMLINK_NOFOLLOW,
                )
            } != 0
            {
                return Err(identity_error(FileRole::OwnedDirectory));
            }
            let captured = unsafe { captured.assume_init() };
            let metadata = handle
                .metadata()
                .map_err(|_| identity_error(FileRole::OwnedDirectory))?;
            if captured.st_mode & libc::S_IFMT != libc::S_IFDIR
                || self.device != captured.st_dev as u64
                || self.inode != captured.st_ino
                || self.owner != captured.st_uid
                || self.device != metadata.dev()
                || self.inode != metadata.ino()
                || self.owner != metadata.uid()
                || !metadata.is_dir()
            {
                return Err(identity_error(FileRole::OwnedDirectory));
            }
            Ok(())
        }
        #[cfg(not(unix))]
        {
            let _ = (parent, name);
            self.verify_owned_directory_for_deletion(handle, &self.canonical_path)
        }
    }

    fn verify_owned_directory_handle(&self, handle: &File) -> Result<(), LocalAgentError> {
        let metadata = handle
            .metadata()
            .map_err(|_| identity_error(FileRole::OwnedDirectory))?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(identity_error(FileRole::OwnedDirectory));
        }
        #[cfg(unix)]
        if self.device != metadata.dev()
            || self.inode != metadata.ino()
            || self.owner != metadata.uid()
        {
            return Err(identity_error(FileRole::OwnedDirectory));
        }
        Ok(())
    }

    fn matches_metadata(&self, metadata: &fs::Metadata, role: FileRole) -> bool {
        if metadata.file_type().is_symlink()
            || matches!(role, FileRole::OwnedDirectory) != metadata.is_dir()
            || !matches!(role, FileRole::OwnedDirectory) && !metadata.is_file()
        {
            return false;
        }
        #[cfg(unix)]
        {
            let mode = metadata.mode();
            self.device == metadata.dev()
                && self.inode == metadata.ino()
                && self.owner == metadata.uid()
                && self.mode == mode
                && (!matches!(role, FileRole::OwnedFile | FileRole::SourceFile)
                    || metadata.nlink() == 1)
        }
        #[cfg(not(unix))]
        {
            true
        }
    }
}

fn verify_owned_directory(path: &Path) -> Result<(), LocalAgentError> {
    FileIdentity::from_path(path, FileRole::OwnedDirectory).map(|_| ())
}

fn identity_error(role: FileRole) -> LocalAgentError {
    match role {
        FileRole::Executable => LocalAgentError::run(
            "invalid_executable",
            "The local agent executable is invalid.",
        ),
        FileRole::OwnedDirectory => LocalAgentError::run(
            "invalid_temp_directory",
            "The local agent temporary directory is invalid.",
        ),
        FileRole::OwnedFile => LocalAgentError::run(
            "invalid_temp_file",
            "A local agent temporary file is invalid.",
        ),
        FileRole::SourceFile => invalid_environment_error(),
    }
}

fn invalid_result_file() -> LocalAgentError {
    LocalAgentError::run(
        "invalid_result_file",
        "The local agent result file is invalid.",
    )
}

fn verify_executable_proof(
    proof: &ExecutableProof,
    path: &Path,
    cancellation: &CancellationToken,
    deadline: StdInstant,
) -> Result<(), LocalAgentError> {
    proof
        .verify_path_with_constraints(path, Some(cancellation), Some(deadline))
        .map_err(|_| {
            if cancellation.is_cancelled() {
                cancelled_error()
            } else if StdInstant::now() >= deadline {
                timeout_error()
            } else {
                identity_error(FileRole::Executable)
            }
        })
}

fn open_no_follow(path: &Path, write: bool) -> Result<File, LocalAgentError> {
    let mut options = OpenOptions::new();
    options.read(true).write(write);
    #[cfg(unix)]
    options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    options
        .open(path)
        .map_err(|_| LocalAgentError::run("invalid_temp_file", "A local agent file is invalid."))
}

fn open_owned_directory(path: &Path) -> Result<File, LocalAgentError> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC);
    options.open(path).map_err(|_| {
        LocalAgentError::run(
            "invalid_temp_directory",
            "The local agent temporary directory is invalid.",
        )
    })
}

fn open_owned_directory_at(parent: &File, name: &OsStr) -> Result<File, LocalAgentError> {
    #[cfg(unix)]
    {
        let name =
            CString::new(name.as_bytes()).map_err(|_| identity_error(FileRole::OwnedDirectory))?;
        let fd = unsafe {
            libc::openat(
                parent.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(identity_error(FileRole::OwnedDirectory));
        }
        Ok(unsafe { File::from_raw_fd(fd) })
    }
    #[cfg(not(unix))]
    {
        let _ = (parent, name);
        Err(identity_error(FileRole::OwnedDirectory))
    }
}

fn create_owned_file_at(parent: &File, name: &OsStr) -> Result<File, LocalAgentError> {
    #[cfg(unix)]
    {
        let name =
            CString::new(name.as_bytes()).map_err(|_| identity_error(FileRole::OwnedFile))?;
        let fd = unsafe {
            libc::openat(
                parent.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDWR | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o600,
            )
        };
        if fd < 0 {
            return Err(identity_error(FileRole::OwnedFile));
        }
        let file = unsafe { File::from_raw_fd(fd) };
        if unsafe { libc::fchmod(file.as_raw_fd(), 0o600) } != 0 {
            return Err(identity_error(FileRole::OwnedFile));
        }
        Ok(file)
    }
    #[cfg(not(unix))]
    {
        let _ = (parent, name);
        Err(identity_error(FileRole::OwnedFile))
    }
}

fn verify_root_entries_exact<'a>(
    root: &File,
    files: impl IntoIterator<Item = &'a Path>,
    directories: impl IntoIterator<Item = &'a Path>,
) -> Result<(), LocalAgentError> {
    let expected = files
        .into_iter()
        .chain(directories)
        .map(|path| {
            path.file_name()
                .map(OsStr::to_owned)
                .ok_or_else(|| identity_error(FileRole::OwnedDirectory))
        })
        .collect::<Result<BTreeSet<_>, _>>()?;
    #[cfg(unix)]
    {
        let duplicate = unsafe { libc::fcntl(root.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 0) };
        if duplicate < 0 {
            return Err(identity_error(FileRole::OwnedDirectory));
        }
        if unsafe { libc::lseek(duplicate, 0, libc::SEEK_SET) } < 0 {
            unsafe {
                libc::close(duplicate);
            }
            return Err(identity_error(FileRole::OwnedDirectory));
        }
        let stream = unsafe { libc::fdopendir(duplicate) };
        if stream.is_null() {
            unsafe {
                libc::close(duplicate);
            }
            return Err(identity_error(FileRole::OwnedDirectory));
        }
        let result = {
            let mut actual = BTreeSet::new();
            loop {
                let entry = unsafe { libc::readdir(stream) };
                if entry.is_null() {
                    break;
                }
                let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) };
                if name.to_bytes() == b"." || name.to_bytes() == b".." {
                    continue;
                }
                actual.insert(OsStr::from_bytes(name.to_bytes()).to_owned());
            }
            (actual == expected).then_some(()).ok_or_else(|| {
                LocalAgentError::run(
                    "invalid_temp_directory",
                    "The local agent temporary directory is invalid.",
                )
            })
        };
        unsafe {
            libc::closedir(stream);
        }
        result
    }
    #[cfg(not(unix))]
    {
        let _ = (root, expected);
        Err(identity_error(FileRole::OwnedDirectory))
    }
}

pub(super) fn controlled_environment(
    inherited: BTreeMap<OsString, OsString>,
    overrides: &[(OsString, OsString)],
    cwd: &Path,
) -> Result<BTreeMap<OsString, OsString>, LocalAgentError> {
    let mut environment = BTreeMap::new();
    for name in ALLOWED_INHERITED_ENVIRONMENT {
        let name = OsString::from(name);
        if let Some(value) = inherited.get(&name) {
            let value = match name.to_str() {
                Some("PATH") => normalized_safe_path(value)?,
                Some("HOME") => normalized_safe_home(value)?,
                _ => value.clone(),
            };
            environment.insert(name, value);
        }
    }
    environment.insert(OsString::from("TMPDIR"), cwd.as_os_str().to_owned());
    environment.insert(OsString::from("PWD"), cwd.as_os_str().to_owned());
    for (name, value) in overrides {
        if !valid_environment_name(name) {
            return Err(LocalAgentError::run(
                "invalid_environment",
                "The local agent environment is invalid.",
            ));
        }
        let value = match name.to_str() {
            Some("PATH") => normalized_safe_path(value)?,
            Some("HOME") => normalized_safe_home(value)?,
            _ => value.clone(),
        };
        environment.insert(name.clone(), value);
    }
    Ok(environment)
}

fn controlled_environment_for_agent(
    inherited: BTreeMap<OsString, OsString>,
    overrides: &[(OsString, OsString)],
    _cwd: &Path,
    agent_kind: LocalAgentKind,
    proof_environment_path: &OsStr,
) -> Result<BTreeMap<OsString, OsString>, LocalAgentError> {
    let claude_config_directory = if agent_kind == LocalAgentKind::Claude {
        validated_explicit_claude_config_directory(&inherited)?
    } else {
        None
    };
    let mut environment = BTreeMap::new();
    for name in FINAL_COMMON_ENVIRONMENT
        .iter()
        .chain(agent_environment_allowlist(agent_kind))
    {
        let name = OsString::from(name);
        if let Some(value) = inherited.get(&name) {
            if value.is_empty() && name != OsStr::new("HOME") {
                continue;
            }
            let value = if name == OsStr::new("HOME") {
                normalized_safe_home(value)?
            } else {
                value.clone()
            };
            environment.insert(name, value);
        }
    }
    environment.insert(
        OsString::from("PATH"),
        normalized_safe_path(proof_environment_path)?,
    );
    environment.insert(OsString::from("TMPDIR"), OsString::from("."));
    for (name, value) in overrides {
        if !valid_environment_name(name) || protected_final_environment_name(name) {
            return Err(invalid_environment_error());
        }
        environment.insert(name.clone(), value.clone());
    }
    if agent_kind == LocalAgentKind::Claude {
        for (skip_auth, use_provider, provider_base) in [
            (
                "CLAUDE_CODE_SKIP_BEDROCK_AUTH",
                "CLAUDE_CODE_USE_BEDROCK",
                "ANTHROPIC_BEDROCK_BASE_URL",
            ),
            (
                "CLAUDE_CODE_SKIP_MANTLE_AUTH",
                "CLAUDE_CODE_USE_MANTLE",
                "ANTHROPIC_BEDROCK_MANTLE_BASE_URL",
            ),
            (
                "CLAUDE_CODE_SKIP_VERTEX_AUTH",
                "CLAUDE_CODE_USE_VERTEX",
                "ANTHROPIC_VERTEX_BASE_URL",
            ),
            (
                "CLAUDE_CODE_SKIP_FOUNDRY_AUTH",
                "CLAUDE_CODE_USE_FOUNDRY",
                "ANTHROPIC_FOUNDRY_BASE_URL",
            ),
        ] {
            if !environment_switch_enabled(&environment, use_provider)
                || !environment_value_is_nonempty(&environment, provider_base)
            {
                environment.remove(OsStr::new(skip_auth));
            }
        }
        if ![
            "ANTHROPIC_BASE_URL",
            "ANTHROPIC_BEDROCK_BASE_URL",
            "ANTHROPIC_BEDROCK_MANTLE_BASE_URL",
            "ANTHROPIC_VERTEX_BASE_URL",
            "ANTHROPIC_FOUNDRY_BASE_URL",
            "ANTHROPIC_AWS_BASE_URL",
        ]
        .iter()
        .any(|name| {
            environment
                .get(OsStr::new(name))
                .is_some_and(|value| !value.is_empty())
        }) {
            environment.remove(OsStr::new("ANTHROPIC_CUSTOM_HEADERS"));
        }
        environment.insert(
            OsString::from("CLAUDE_CODE_SUBPROCESS_ENV_SCRUB"),
            OsString::from("1"),
        );
        environment.insert(
            OsString::from("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"),
            OsString::from("1"),
        );
        environment
            .entry(OsString::from("HOME"))
            .or_insert_with(|| OsString::from(CLAUDE_HOME_DIRECTORY));
        for (name, directory) in [
            ("XDG_CONFIG_HOME", CLAUDE_XDG_CONFIG_DIRECTORY),
            ("XDG_CACHE_HOME", CLAUDE_CACHE_DIRECTORY),
            ("XDG_DATA_HOME", CLAUDE_DATA_DIRECTORY),
            ("XDG_STATE_HOME", CLAUDE_STATE_DIRECTORY),
        ] {
            environment.insert(OsString::from(name), OsString::from(directory));
        }
        if let Some(config_directory) = claude_config_directory {
            environment.insert(OsString::from("CLAUDE_CONFIG_DIR"), config_directory);
        }
        for name in [
            "CLAUDE_CODE_SAFE_MODE",
            "CLAUDE_CODE_DISABLE_AUTO_MEMORY",
            "CLAUDE_CODE_DISABLE_CLAUDE_MDS",
            "CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS",
        ] {
            environment.insert(OsString::from(name), OsString::from("1"));
        }
    } else if agent_kind == LocalAgentKind::Codex {
        environment.insert(
            OsString::from("CODEX_HOME"),
            OsString::from(CODEX_HOME_DIRECTORY),
        );
    } else if agent_kind == LocalAgentKind::Opencode {
        for (name, directory) in [
            ("XDG_CONFIG_HOME", OPENCODE_CONFIG_DIRECTORY),
            ("XDG_CACHE_HOME", OPENCODE_CACHE_DIRECTORY),
            ("XDG_DATA_HOME", OPENCODE_DATA_DIRECTORY),
            ("XDG_STATE_HOME", OPENCODE_STATE_DIRECTORY),
        ] {
            environment.insert(OsString::from(name), OsString::from(directory));
        }
        environment.insert(
            OsString::from("OPENCODE_DISABLE_CLAUDE_CODE"),
            OsString::from("1"),
        );
        environment.insert(
            OsString::from("OPENCODE_DISABLE_DEFAULT_PLUGINS"),
            OsString::from("true"),
        );
    }
    Ok(environment)
}

fn validated_explicit_claude_config_directory(
    inherited: &BTreeMap<OsString, OsString>,
) -> Result<Option<OsString>, LocalAgentError> {
    let Some(config_directory) = inherited
        .get(OsStr::new("CLAUDE_CONFIG_DIR"))
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    normalized_safe_home(config_directory).map(Some)
}

fn environment_value_is_nonempty(environment: &BTreeMap<OsString, OsString>, name: &str) -> bool {
    environment
        .get(OsStr::new(name))
        .is_some_and(|value| !value.is_empty())
}

fn environment_switch_enabled(environment: &BTreeMap<OsString, OsString>, name: &str) -> bool {
    let Some(value) = environment
        .get(OsStr::new(name))
        .and_then(|value| value.to_str())
    else {
        return false;
    };
    let value = value.trim();
    !value.is_empty()
        && !["0", "false", "no", "off"]
            .iter()
            .any(|disabled| value.eq_ignore_ascii_case(disabled))
}

fn agent_environment_allowlist(agent_kind: LocalAgentKind) -> &'static [&'static str] {
    match agent_kind {
        LocalAgentKind::Claude => CLAUDE_ENVIRONMENT,
        LocalAgentKind::Codex => CODEX_ENVIRONMENT,
        LocalAgentKind::Opencode => OPENCODE_ENVIRONMENT,
    }
}

fn protected_final_environment_name(name: &OsStr) -> bool {
    matches!(
        name.to_str(),
        Some(
            "HOME"
                | "USER"
                | "PATH"
                | "TMPDIR"
                | "PWD"
                | "NODE_OPTIONS"
                | "BUN_OPTIONS"
                | "NODE_TLS_REJECT_UNAUTHORIZED"
                | "BASH_ENV"
                | "ENV"
                | "LD_PRELOAD"
                | "CODEX_HOME"
                | "SQLITE_HOME"
                | "CODEX_SQLITE_HOME"
                | "CLAUDE_CONFIG_DIR"
                | "OPENCODE_CONFIG"
                | "OPENCODE_CONFIG_DIR"
                | "XDG_CONFIG_HOME"
                | "XDG_CACHE_HOME"
                | "XDG_DATA_HOME"
                | "XDG_STATE_HOME"
                | "OPENCODE_DISABLE_CLAUDE_CODE"
                | "OPENCODE_DISABLE_DEFAULT_PLUGINS"
                | "EDITOR"
                | "VISUAL"
                | "PAGER"
                | "GIT_PAGER"
                | "BROWSER"
        )
    ) || name.to_str().is_some_and(|name| name.starts_with("DYLD_"))
}

fn normalized_safe_path(value: &OsStr) -> Result<OsString, LocalAgentError> {
    let mut seen = BTreeSet::new();
    let mut safe_directories = Vec::new();
    for directory in env::split_paths(value) {
        let Some(canonical) = canonical_safe_directory(&directory, false) else {
            continue;
        };
        if seen.insert(canonical.clone()) {
            safe_directories.push(canonical);
        }
    }
    if safe_directories.is_empty() {
        return Err(LocalAgentError::run(
            "invalid_environment",
            "The local agent environment is invalid.",
        ));
    }
    env::join_paths(safe_directories).map_err(|_| {
        LocalAgentError::run(
            "invalid_environment",
            "The local agent environment is invalid.",
        )
    })
}

fn normalized_safe_home(value: &OsStr) -> Result<OsString, LocalAgentError> {
    canonical_safe_directory(Path::new(value), true)
        .map(PathBuf::into_os_string)
        .ok_or_else(invalid_environment_error)
}

fn canonical_safe_directory(path: &Path, require_current_owner: bool) -> Option<PathBuf> {
    if !path.is_absolute() {
        return None;
    }
    let canonical = path.canonicalize().ok()?;
    for (index, ancestor) in canonical.ancestors().enumerate() {
        let metadata = fs::metadata(ancestor).ok()?;
        if !metadata.is_dir() {
            return None;
        }
        #[cfg(unix)]
        {
            let effective_user = unsafe { libc::geteuid() };
            let owner = metadata.uid();
            let mode = metadata.mode();
            let owner_is_trusted = owner == 0 || owner == effective_user;
            // Homebrew commonly keeps its user-owned prefix group-writable (775).
            // Trust that account-owned installation without weakening root-owned
            // ancestry or accepting a directory writable by every local user.
            // HOME remains stricter because it anchors copied credential files.
            let writable_by_untrusted_user = mode & 0o002 != 0
                || (mode & 0o020 != 0 && (require_current_owner || owner != effective_user));
            if (index == 0 && require_current_owner && metadata.uid() != effective_user)
                || !owner_is_trusted
                || writable_by_untrusted_user
            {
                return None;
            }
        }
    }
    Some(canonical)
}

fn invalid_environment_error() -> LocalAgentError {
    LocalAgentError::run(
        "invalid_environment",
        "The local agent environment is invalid.",
    )
}

fn valid_environment_name(name: &OsStr) -> bool {
    !name.is_empty() && !name.as_encoded_bytes().contains(&b'=')
}

#[derive(Debug, Clone, Copy)]
enum StreamFault {
    OutputTooLarge,
    Io,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StdinWriteOutcome {
    Complete,
    BrokenPipe,
}

pub(super) async fn run_process(
    mut owned: OwnedProcessInvocation,
    cancellation: CancellationToken,
    deadline: StdInstant,
) -> Result<ProcessOutput, LocalAgentError> {
    owned.cleanup_cancellation = cancellation.clone();
    owned.cleanup_deadline = deadline;
    let process_deadline = process_execution_deadline(deadline);
    let result = run_process_inner(&mut owned, cancellation, process_deadline).await;
    match result {
        Err(error) => match owned.close_temp_dir().await {
            Ok(()) => Err(error),
            Err(cleanup_error) => Err(cleanup_error),
        },
        Ok(mut output) => {
            output.temp_dir = owned.temp_dir.take();
            output.temp_identity = Some(owned.temp_identity.clone());
            output.temp_handle = owned.temp_handle.take();
            output.temp_parent_handle = owned.temp_parent_handle.take();
            output.temp_name = Some(owned.temp_name.clone());
            output.cleanup_activity = owned.cleanup_activity.take();
            output.cleanup_deadline = deadline;
            #[cfg(test)]
            {
                output.cleanup_interlock = owned.cleanup_interlock.take();
            }
            Ok(output)
        }
    }
}

fn process_execution_deadline(deadline: StdInstant) -> StdInstant {
    let remaining = deadline.saturating_duration_since(StdInstant::now());
    let maximum_cleanup_reserve = PROCESS_CLEANUP_TIMEOUT + Duration::from_millis(250);
    let cleanup_reserve = (remaining - remaining / 4).min(maximum_cleanup_reserve);
    deadline.checked_sub(cleanup_reserve).unwrap_or(deadline)
}

async fn run_process_inner(
    owned: &mut OwnedProcessInvocation,
    cancellation: CancellationToken,
    absolute_deadline: StdInstant,
) -> Result<ProcessOutput, LocalAgentError> {
    ensure_process_active(&cancellation, absolute_deadline)?;
    owned.verify_before_spawn(&cancellation, absolute_deadline)?;
    let mut inherited = std::mem::take(&mut owned.inherited_environment);
    inherited.insert(
        OsString::from("PATH"),
        owned.executable_proof.environment_path().to_owned(),
    );
    let environment = controlled_environment_for_agent(
        inherited,
        &owned.invocation.env,
        &owned.invocation.cwd,
        owned.agent_kind,
        owned.executable_proof.environment_path(),
    )?;
    ensure_process_active(&cancellation, absolute_deadline)?;
    #[cfg(test)]
    if let Some(interlock) = &owned.spawn_interlock {
        interlock.before_spawn.wait();
        interlock.replacement_ready.wait();
    }
    #[cfg(test)]
    if let Some(interlock) = &owned.workspace_spawn_interlock {
        interlock.before_spawn.wait();
        interlock.replacement_ready.wait();
    }
    #[cfg(unix)]
    let child_workspace = duplicate_owned_root_fd(
        owned.temp_handle.as_ref().ok_or_else(temp_cleanup_error)?,
        &owned.temp_identity,
    )?;
    #[cfg(unix)]
    let child_workspace_fd = child_workspace.as_raw_fd();
    #[cfg(unix)]
    let child_agent_kind = owned.agent_kind;
    let mut command = Command::new(&owned.invocation.executable);
    command
        .args(&owned.invocation.args)
        .env_clear()
        .envs(environment)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(not(unix))]
    command.current_dir(&owned.invocation.cwd);
    #[cfg(unix)]
    {
        command.as_std_mut().process_group(0);
        unsafe {
            command
                .as_std_mut()
                .pre_exec(move || configure_child_process(child_workspace_fd, child_agent_kind));
        }
    }

    let spawned = command.spawn();
    #[cfg(unix)]
    drop(child_workspace);
    let mut child = spawned.map_err(|_| {
        LocalAgentError::run(
            "local_agent_spawn_failed",
            "The local agent could not be started.",
        )
    })?;
    #[cfg(test)]
    if let Some(interlock) = &owned.spawn_interlock {
        interlock.spawn_returned.wait();
        interlock.original_restored.wait();
    }
    #[cfg(test)]
    if let Some(interlock) = &owned.workspace_spawn_interlock {
        interlock.spawn_returned.wait();
        interlock.child_ready.wait();
    }
    let process_group_id = child_process_group_id(&child)?;
    let mut process_group = match RegisteredProcessGroup::register(process_group_id) {
        Ok(process_group) => process_group,
        Err(mut rejected) => {
            kill_unregistered_group_and_reap(&mut child, &mut rejected).await?;
            drop(rejected);
            return Err(cancelled_error());
        }
    };
    if let Err(error) = owned.verify_before_stdin(&cancellation, absolute_deadline) {
        let cleanup = terminate_and_reap(&mut child, &mut process_group).await;
        cleanup?;
        return Err(error);
    }
    if let Err(error) = verify_executable_proof(
        &owned.executable_proof,
        &owned.invocation.executable,
        &cancellation,
        absolute_deadline,
    ) {
        let cleanup = terminate_and_reap(&mut child, &mut process_group).await;
        cleanup?;
        return Err(error);
    }
    owned.retained_private_sources.clear();
    let (stdin, stdout, stderr) =
        take_child_pipes_or_cleanup(&mut child, &mut process_group).await?;
    let stdin_bytes = std::mem::take(&mut owned.invocation.stdin);
    let (fault_sender, mut fault_receiver) = mpsc::unbounded_channel();
    let _fault_sender_guard = fault_sender.clone();
    let mut stdin_task = Some(tokio::spawn(write_stdin(
        stdin,
        stdin_bytes,
        fault_sender.clone(),
    )));
    let mut stdout_task = Some(tokio::spawn(read_capped(
        stdout,
        MAX_PROCESS_OUTPUT_BYTES,
        fault_sender.clone(),
    )));
    let mut stderr_task = Some(tokio::spawn(read_capped(
        stderr,
        STDERR_TAIL_BYTES,
        fault_sender,
    )));
    let deadline = TokioInstant::from_std(absolute_deadline);
    let mut result_monitor = Box::pin(monitor_result_file(
        owned.owned_files.iter().find(|file| file.is_result),
    ));

    let status = tokio::select! {
        biased;
        _ = cancellation.cancelled() => {
            let cleanup = terminate_and_reap(&mut child, &mut process_group).await;
            abort_stream_tasks(&mut stdin_task, &mut stdout_task, &mut stderr_task).await;
            cleanup?;
            return Err(cancelled_error());
        }
        _ = tokio::time::sleep_until(deadline) => {
            let cleanup = terminate_and_reap(&mut child, &mut process_group).await;
            abort_stream_tasks(&mut stdin_task, &mut stdout_task, &mut stderr_task).await;
            cleanup?;
            return Err(timeout_error());
        }
        result_error = &mut result_monitor => {
            let cleanup = terminate_and_reap(&mut child, &mut process_group).await;
            abort_stream_tasks(&mut stdin_task, &mut stdout_task, &mut stderr_task).await;
            cleanup?;
            return Err(result_error);
        }
        fault = fault_receiver.recv() => {
            let cleanup = terminate_and_reap(&mut child, &mut process_group).await;
            abort_stream_tasks(&mut stdin_task, &mut stdout_task, &mut stderr_task).await;
            cleanup?;
            return Err(stream_fault_error(fault.unwrap_or(StreamFault::Io)));
        }
        status = child.wait() => match status {
            Ok(status) => status,
            Err(_) => {
                let cleanup = terminate_and_reap(&mut child, &mut process_group).await;
                abort_stream_tasks(&mut stdin_task, &mut stdout_task, &mut stderr_task).await;
                cleanup?;
                return Err(io_error());
            }
        },
    };
    drop(result_monitor);

    if let Err(error) = terminate_process_group(&mut process_group).await {
        abort_stream_tasks(&mut stdin_task, &mut stdout_task, &mut stderr_task).await;
        return Err(error);
    }
    if cancellation.is_cancelled() {
        abort_stream_tasks(&mut stdin_task, &mut stdout_task, &mut stderr_task).await;
        return Err(cancelled_error());
    }
    if TokioInstant::now() >= deadline {
        abort_stream_tasks(&mut stdin_task, &mut stdout_task, &mut stderr_task).await;
        return Err(timeout_error());
    }
    if let Ok(fault) = fault_receiver.try_recv() {
        abort_stream_tasks(&mut stdin_task, &mut stdout_task, &mut stderr_task).await;
        return Err(stream_fault_error(fault));
    }

    let stdin_outcome = match await_stream_task(&mut stdin_task, deadline, &cancellation).await {
        Ok(outcome) => outcome,
        Err(error) => {
            abort_stream_tasks(&mut stdin_task, &mut stdout_task, &mut stderr_task).await;
            return Err(error);
        }
    };
    let stdout = match await_stream_task(&mut stdout_task, deadline, &cancellation).await {
        Ok(stdout) => stdout,
        Err(error) => {
            abort_stream_tasks(&mut stdin_task, &mut stdout_task, &mut stderr_task).await;
            return Err(error);
        }
    };
    let stderr_tail = match await_stream_task(&mut stderr_task, deadline, &cancellation).await {
        Ok(stderr) => stderr,
        Err(error) => {
            abort_stream_tasks(&mut stdin_task, &mut stdout_task, &mut stderr_task).await;
            return Err(error);
        }
    };

    if cancellation.is_cancelled() {
        return Err(cancelled_error());
    }
    if TokioInstant::now() >= deadline {
        return Err(timeout_error());
    }
    if !status.success() {
        return Err(LocalAgentError::run(
            "local_agent_failed",
            "The local agent did not complete successfully.",
        ));
    }
    if stdin_outcome == StdinWriteOutcome::BrokenPipe {
        return Err(io_error());
    }
    owned
        .temp_identity
        .verify_path(&owned.invocation.cwd, FileRole::OwnedDirectory)?;
    for file in owned
        .owned_files
        .iter()
        .filter(|file| !file.mutable_private)
    {
        file.verify_identity()?;
    }
    for directory in &owned.owned_directories {
        directory.verify_identity()?;
    }
    if cancellation.is_cancelled() {
        return Err(cancelled_error());
    }
    let result_file = owned.read_result_file()?;
    if cancellation.is_cancelled() {
        return Err(cancelled_error());
    }
    if TokioInstant::now() >= deadline {
        return Err(timeout_error());
    }
    Ok(ProcessOutput {
        stdout,
        stderr_tail,
        result_file,
        temp_dir: None,
        temp_identity: None,
        temp_handle: None,
        temp_parent_handle: None,
        temp_name: None,
        cleanup_activity: None,
        cleanup_cancellation: cancellation.clone(),
        cleanup_deadline: absolute_deadline,
        #[cfg(test)]
        cleanup_interlock: None,
    })
}

async fn write_stdin(
    mut stdin: tokio::process::ChildStdin,
    bytes: Vec<u8>,
    faults: mpsc::UnboundedSender<StreamFault>,
) -> Result<StdinWriteOutcome, LocalAgentError> {
    if let Err(error) = stdin.write_all(&bytes).await {
        if error.kind() == ErrorKind::BrokenPipe {
            return Ok(StdinWriteOutcome::BrokenPipe);
        }
        let _ = faults.send(StreamFault::Io);
        return Err(io_error());
    }
    if let Err(error) = stdin.shutdown().await {
        if error.kind() == ErrorKind::BrokenPipe {
            return Ok(StdinWriteOutcome::BrokenPipe);
        }
        let _ = faults.send(StreamFault::Io);
        return Err(io_error());
    }
    Ok(StdinWriteOutcome::Complete)
}

#[cfg(unix)]
fn duplicate_owned_root_fd(root: &File, identity: &FileIdentity) -> Result<File, LocalAgentError> {
    identity.verify_owned_directory_handle(root)?;
    let root_fd = root.as_raw_fd();
    if root_fd < 3 {
        return Err(identity_error(FileRole::OwnedDirectory));
    }
    let duplicate = unsafe { libc::fcntl(root_fd, libc::F_DUPFD, 3) };
    if duplicate < 3 {
        if duplicate >= 0 {
            unsafe {
                libc::close(duplicate);
            }
        }
        return Err(identity_error(FileRole::OwnedDirectory));
    }
    let duplicate = unsafe { File::from_raw_fd(duplicate) };
    identity.verify_owned_directory_handle(&duplicate)?;
    Ok(duplicate)
}

#[cfg(unix)]
fn configure_child_process(root_fd: i32, agent_kind: LocalAgentKind) -> std::io::Result<()> {
    configure_child_file_size_limit(agent_kind)?;
    if root_fd < 3 {
        return Err(std::io::Error::from_raw_os_error(libc::EBADF));
    }
    if unsafe { libc::fchdir(root_fd) } == 0 {
        if unsafe { libc::close(root_fd) } == 0 {
            Ok(())
        } else {
            Err(std::io::Error::last_os_error())
        }
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(unix)]
fn configure_child_file_size_limit(agent_kind: LocalAgentKind) -> std::io::Result<()> {
    let limit = match agent_kind {
        LocalAgentKind::Opencode => OPENCODE_CHILD_FILE_SIZE_LIMIT,
        LocalAgentKind::Claude | LocalAgentKind::Codex => MAX_PROCESS_OUTPUT_BYTES + 1,
    } as libc::rlim_t;
    let limits = libc::rlimit {
        rlim_cur: limit,
        rlim_max: limit,
    };
    if unsafe { libc::setrlimit(libc::RLIMIT_FSIZE, &limits) } == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

async fn monitor_result_file(file: Option<&OwnedFile>) -> LocalAgentError {
    let Some(file) = file else {
        return std::future::pending::<LocalAgentError>().await;
    };
    loop {
        if let Err(error) = file.verify_identity() {
            return error;
        }
        let size = match file.handle.metadata() {
            Ok(metadata) => metadata.len(),
            Err(_) => return invalid_result_file(),
        };
        if size > MAX_PROCESS_OUTPUT_BYTES as u64 {
            return stream_fault_error(StreamFault::OutputTooLarge);
        }
        tokio::time::sleep(RESULT_FILE_MONITOR_INTERVAL).await;
    }
}

async fn read_capped<R>(
    mut reader: R,
    limit: usize,
    faults: mpsc::UnboundedSender<StreamFault>,
) -> Result<Vec<u8>, LocalAgentError>
where
    R: AsyncRead + Unpin,
{
    let mut bytes = Vec::with_capacity(limit.min(8192));
    let mut chunk = [0_u8; 8192];
    loop {
        let read = match reader.read(&mut chunk).await {
            Ok(read) => read,
            Err(_) => {
                let _ = faults.send(StreamFault::Io);
                return Err(io_error());
            }
        };
        if read == 0 {
            return Ok(bytes);
        }
        if bytes.len().saturating_add(read) > limit {
            let _ = faults.send(StreamFault::OutputTooLarge);
            return Err(stream_fault_error(StreamFault::OutputTooLarge));
        }
        bytes.extend_from_slice(&chunk[..read]);
    }
}

async fn await_stream_task<T>(
    task: &mut Option<JoinHandle<Result<T, LocalAgentError>>>,
    deadline: TokioInstant,
    cancellation: &CancellationToken,
) -> Result<T, LocalAgentError> {
    let mut task = task.take().ok_or_else(io_error)?;
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => {
            task.abort();
            let _ = task.await;
            Err(cancelled_error())
        }
        _ = tokio::time::sleep_until(deadline) => {
            task.abort();
            let _ = task.await;
            Err(timeout_error())
        }
        result = &mut task => result.unwrap_or_else(|_| Err(io_error())),
    }
}

async fn abort_stream_tasks(
    stdin: &mut Option<JoinHandle<Result<StdinWriteOutcome, LocalAgentError>>>,
    stdout: &mut Option<JoinHandle<Result<Vec<u8>, LocalAgentError>>>,
    stderr: &mut Option<JoinHandle<Result<Vec<u8>, LocalAgentError>>>,
) {
    if let Some(stdin) = stdin.take() {
        stdin.abort();
        let _ = stdin.await;
    }
    if let Some(stdout) = stdout.take() {
        stdout.abort();
        let _ = stdout.await;
    }
    if let Some(stderr) = stderr.take() {
        stderr.abort();
        let _ = stderr.await;
    }
}

pub(super) struct RegisteredProcessGroup {
    id: i32,
    armed: bool,
}

pub(super) struct ProcessActivityGuard {
    #[cfg(unix)]
    registry: Arc<Mutex<ProcessGroupRegistry>>,
    active: bool,
}

struct CleanupActivityGuard {
    #[cfg(unix)]
    registry: Arc<Mutex<ProcessGroupRegistry>>,
    active: bool,
    cleanup_started: bool,
    succeeded: bool,
}

impl ProcessActivityGuard {
    pub(super) fn begin() -> Option<Self> {
        #[cfg(unix)]
        {
            Self::begin_with_registry(Arc::clone(live_process_groups()))
        }
        #[cfg(not(unix))]
        {
            Some(Self { active: true })
        }
    }

    #[cfg(unix)]
    fn begin_with_registry(registry: Arc<Mutex<ProcessGroupRegistry>>) -> Option<Self> {
        let admitted = registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .begin_provider_operation();
        admitted.then(|| Self {
            registry,
            active: true,
        })
    }
}

impl CleanupActivityGuard {
    fn reserve() -> Option<Self> {
        #[cfg(unix)]
        {
            Self::reserve_with_registry(Arc::clone(live_process_groups()))
        }
        #[cfg(not(unix))]
        {
            Some(Self {
                active: true,
                cleanup_started: false,
                succeeded: false,
            })
        }
    }

    #[cfg(unix)]
    fn reserve_with_registry(registry: Arc<Mutex<ProcessGroupRegistry>>) -> Option<Self> {
        let admitted = registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .reserve_cleanup_activity();
        admitted.then(|| Self {
            registry,
            active: true,
            cleanup_started: false,
            succeeded: false,
        })
    }

    fn mark_started(&mut self) {
        self.cleanup_started = true;
    }

    fn mark_succeeded(&mut self) {
        self.succeeded = true;
    }

    fn shutdown_started(&self) -> bool {
        #[cfg(unix)]
        {
            self.registry
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .shutting_down
        }
        #[cfg(not(unix))]
        {
            false
        }
    }
}

impl Drop for ProcessActivityGuard {
    fn drop(&mut self) {
        #[cfg(unix)]
        if self.active {
            self.registry
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .finish_provider_operation();
            self.active = false;
        }
    }
}

impl Drop for CleanupActivityGuard {
    fn drop(&mut self) {
        #[cfg(unix)]
        if self.active {
            self.registry
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .finish_cleanup_activity(!self.cleanup_started || self.succeeded);
            self.active = false;
        }
    }
}

impl RegisteredProcessGroup {
    #[cfg(test)]
    fn from_child(child: &Child) -> Result<Self, LocalAgentError> {
        let id = child_process_group_id(child)?;
        Self::register(id).map_err(|_| cancelled_error())
    }

    pub(super) fn register(id: i32) -> Result<Self, RejectedProcessGroup> {
        if id <= 0 {
            return Err(RejectedProcessGroup {
                id,
                tracked: false,
                confirmed: true,
            });
        }
        #[cfg(unix)]
        if !register_process_group(id) {
            let rejected = RejectedProcessGroup {
                id,
                tracked: true,
                confirmed: false,
            };
            rejected.terminate();
            return Err(rejected);
        }
        Ok(Self { id, armed: true })
    }

    pub(super) const fn id(&self) -> i32 {
        self.id
    }

    fn disarm_after_confirmed_disappearance(&mut self) {
        #[cfg(unix)]
        unregister_process_group(self.id);
        self.armed = false;
    }

    pub(super) fn terminate(&self) {
        #[cfg(unix)]
        unsafe {
            let _ = libc::kill(-self.id, libc::SIGKILL);
        }
    }

    pub(super) fn terminate_and_confirm(&mut self, timeout: Duration) -> bool {
        self.terminate();
        #[cfg(unix)]
        if !wait_for_group_exit_sync(self.id, timeout, true) {
            return false;
        }
        self.disarm_after_confirmed_disappearance();
        true
    }
}

#[derive(Debug)]
pub(super) struct RejectedProcessGroup {
    id: i32,
    tracked: bool,
    confirmed: bool,
}

impl RejectedProcessGroup {
    pub(super) fn terminate(&self) {
        #[cfg(unix)]
        if self.id > 0 {
            unsafe {
                let _ = libc::kill(-self.id, libc::SIGKILL);
            }
        }
    }

    pub(super) fn terminate_and_confirm(&mut self, timeout: Duration) -> bool {
        self.terminate();
        #[cfg(unix)]
        if !wait_for_group_exit_sync(self.id, timeout, true) {
            return false;
        }
        self.confirmed = true;
        true
    }
}

impl Drop for RejectedProcessGroup {
    fn drop(&mut self) {
        self.terminate();
        #[cfg(unix)]
        if self.tracked {
            if self.confirmed {
                finish_deferred_cleanup_tracking();
            } else {
                spawn_deferred_cleanup(DeferredCleanupTicket { id: self.id });
            }
            self.tracked = false;
        }
    }
}

fn child_process_group_id(child: &Child) -> Result<i32, LocalAgentError> {
    i32::try_from(child.id().ok_or_else(io_error)?)
        .ok()
        .filter(|id| *id > 0)
        .ok_or_else(io_error)
}

async fn kill_unregistered_group_and_reap(
    child: &mut Child,
    rejected: &mut RejectedProcessGroup,
) -> Result<(), LocalAgentError> {
    rejected.terminate();
    let _ = child.start_kill();
    let deadline = TokioInstant::now() + PROCESS_CLEANUP_TIMEOUT;
    let leader = tokio::time::timeout_at(deadline, child.wait()).await;
    let group = wait_for_group_exit_until(rejected.id, deadline, true).await;
    if matches!(leader, Ok(Ok(_))) && group.is_ok() {
        rejected.confirmed = true;
        Ok(())
    } else {
        Err(process_cleanup_error())
    }
}

async fn take_child_pipes_or_cleanup(
    child: &mut Child,
    process_group: &mut RegisteredProcessGroup,
) -> Result<(ChildStdin, ChildStdout, ChildStderr), LocalAgentError> {
    let pipes = (child.stdin.take(), child.stdout.take(), child.stderr.take());
    let (Some(stdin), Some(stdout), Some(stderr)) = pipes else {
        terminate_and_reap(child, process_group).await?;
        return Err(io_error());
    };
    Ok((stdin, stdout, stderr))
}

impl Drop for RegisteredProcessGroup {
    fn drop(&mut self) {
        if self.armed {
            self.terminate();
            #[cfg(unix)]
            {
                let cleanup = unregister_for_deferred_cleanup(self.id);
                spawn_deferred_cleanup(cleanup);
            }
            self.armed = false;
        }
    }
}

#[cfg(unix)]
fn live_process_groups() -> &'static Arc<Mutex<ProcessGroupRegistry>> {
    LIVE_PROCESS_GROUPS.get_or_init(|| Arc::new(Mutex::new(ProcessGroupRegistry::default())))
}

#[cfg(unix)]
fn register_process_group(process_group: i32) -> bool {
    let mut registry = live_process_groups()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if registry.register(process_group) {
        true
    } else {
        registry.begin_rejected_cleanup();
        false
    }
}

#[cfg(unix)]
fn unregister_process_group(process_group: i32) {
    live_process_groups()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .unregister(process_group);
}

#[cfg(unix)]
fn unregister_for_deferred_cleanup(process_group: i32) -> DeferredCleanupTicket {
    let mut registry = live_process_groups()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    registry.unregister(process_group);
    registry.begin_rejected_cleanup();
    DeferredCleanupTicket { id: process_group }
}

#[cfg(unix)]
struct DeferredCleanupTicket {
    id: i32,
}

#[cfg(unix)]
impl DeferredCleanupTicket {
    fn terminate(&self) {
        if self.id > 0 {
            unsafe {
                let _ = libc::kill(-self.id, libc::SIGKILL);
            }
        }
    }
}

#[cfg(unix)]
impl Drop for DeferredCleanupTicket {
    fn drop(&mut self) {
        self.terminate();
        finish_deferred_cleanup_tracking();
    }
}

#[cfg(unix)]
fn finish_deferred_cleanup_tracking() {
    live_process_groups()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .finish_rejected_cleanup();
}

#[cfg(unix)]
fn spawn_deferred_cleanup(cleanup: DeferredCleanupTicket) {
    let process_group = cleanup.id;
    let _ = std::thread::Builder::new()
        .name("local-agent-group-cleanup".to_string())
        .spawn(move || {
            let _cleanup_tracking = cleanup;
            let _ = wait_for_group_exit_sync(process_group, PROCESS_CLEANUP_TIMEOUT, true);
        });
}

#[cfg(unix)]
fn wait_for_group_exit_sync(
    process_group: i32,
    timeout: Duration,
    repeat_termination: bool,
) -> bool {
    let deadline = StdInstant::now() + timeout;
    let mut absent_since = None;
    loop {
        let now = StdInstant::now();
        if process_group_exists(process_group) {
            absent_since = None;
        } else {
            let first_absent = *absent_since.get_or_insert(now);
            if now.duration_since(first_absent) >= PROCESS_GROUP_ABSENCE_CONFIRMATION {
                return true;
            }
        }
        if now >= deadline {
            return false;
        }
        if repeat_termination {
            unsafe {
                let _ = libc::kill(-process_group, libc::SIGKILL);
            }
        }
        std::thread::sleep(PROCESS_GROUP_POLL_INTERVAL.min(deadline.duration_since(now)));
    }
}

#[cfg(all(unix, test))]
fn process_group_is_registered(process_group: i32) -> bool {
    live_process_groups()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .process_groups
        .contains(&process_group)
}

#[cfg(unix)]
fn process_group_exists(process_group: i32) -> bool {
    if process_group <= 0 {
        return false;
    }
    if unsafe { libc::kill(-process_group, 0) } == 0 {
        #[cfg(target_os = "macos")]
        if let Some(has_live_member) = macos_process_group_has_live_member(process_group) {
            return has_live_member;
        }
        return true;
    }
    std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
}

#[cfg(target_os = "macos")]
fn macos_process_group_has_live_member(process_group: i32) -> Option<bool> {
    const PROC_PGRP_ONLY: u32 = 2;
    let required_bytes = unsafe {
        libc::proc_listpids(
            PROC_PGRP_ONLY,
            u32::try_from(process_group).ok()?,
            std::ptr::null_mut(),
            0,
        )
    };
    if required_bytes < 0 {
        return None;
    }
    let pid_size = std::mem::size_of::<libc::pid_t>();
    let capacity = usize::try_from(required_bytes)
        .ok()?
        .checked_div(pid_size)?
        + 32;
    let mut process_ids = vec![0; capacity];
    let buffer_bytes = process_ids.len().checked_mul(pid_size)?;
    let written_bytes = unsafe {
        libc::proc_listpids(
            PROC_PGRP_ONLY,
            u32::try_from(process_group).ok()?,
            process_ids.as_mut_ptr().cast(),
            i32::try_from(buffer_bytes).ok()?,
        )
    };
    if written_bytes < 0 {
        return None;
    }
    let written_bytes = usize::try_from(written_bytes).ok()?;
    if written_bytes >= buffer_bytes || written_bytes % pid_size != 0 {
        return None;
    }
    process_ids.truncate(written_bytes.checked_div(pid_size)?);
    for process_id in process_ids.into_iter().filter(|process_id| *process_id > 0) {
        let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::uninit();
        let info_size = std::mem::size_of::<libc::proc_bsdinfo>();
        let read = unsafe {
            libc::proc_pidinfo(
                process_id,
                libc::PROC_PIDTBSDINFO,
                0,
                info.as_mut_ptr().cast(),
                i32::try_from(info_size).ok()?,
            )
        };
        if read != i32::try_from(info_size).ok()? {
            return None;
        }
        let info = unsafe { info.assume_init() };
        if info.pbi_pgid == u32::try_from(process_group).ok()? && info.pbi_status != libc::SZOMB {
            return Some(true);
        }
    }
    Some(false)
}

pub(super) fn terminate_all_process_groups() {
    #[cfg(unix)]
    {
        let registry = live_process_groups()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        terminate_process_groups(registry.snapshot());
    }
}

pub(super) fn begin_process_shutdown() {
    #[cfg(unix)]
    {
        let mut registry = live_process_groups()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let process_groups = registry.begin_shutdown();
        terminate_process_groups(process_groups);
    }
}

pub(super) async fn wait_for_process_groups_idle(timeout: Duration) -> bool {
    #[cfg(unix)]
    return wait_for_registry_idle(Arc::clone(live_process_groups()), timeout).await;
    #[cfg(not(unix))]
    {
        let _ = timeout;
        true
    }
}

#[cfg(unix)]
async fn wait_for_registry_idle(
    registry: Arc<Mutex<ProcessGroupRegistry>>,
    timeout: Duration,
) -> bool {
    let deadline = TokioInstant::now() + timeout;
    loop {
        if registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_idle()
        {
            return true;
        }

        let now = TokioInstant::now();
        if now >= deadline {
            return false;
        }
        tokio::time::sleep_until((now + Duration::from_millis(5)).min(deadline)).await;
    }
}

#[cfg(unix)]
fn terminate_process_groups(process_groups: Vec<i32>) {
    for process_group in process_groups {
        if process_group > 0 {
            unsafe {
                let _ = libc::kill(-process_group, libc::SIGKILL);
            }
        }
    }
}

async fn terminate_process_group(
    process_group: &mut RegisteredProcessGroup,
) -> Result<(), LocalAgentError> {
    process_group.terminate();
    wait_for_group_exit_until(
        process_group.id(),
        TokioInstant::now() + PROCESS_CLEANUP_TIMEOUT,
        true,
    )
    .await?;
    process_group.disarm_after_confirmed_disappearance();
    Ok(())
}

async fn terminate_and_reap(
    child: &mut Child,
    process_group: &mut RegisteredProcessGroup,
) -> Result<(), LocalAgentError> {
    process_group.terminate();
    let _ = child.start_kill();
    let deadline = TokioInstant::now() + PROCESS_CLEANUP_TIMEOUT;
    let leader = tokio::time::timeout_at(deadline, child.wait()).await;
    let group = wait_for_group_exit_until(process_group.id(), deadline, true).await;
    if group.is_ok() {
        process_group.disarm_after_confirmed_disappearance();
    }
    if !matches!(leader, Ok(Ok(_))) {
        return Err(process_cleanup_error());
    }
    group
}

#[cfg(test)]
async fn wait_for_group_exit(process_group: i32, timeout: Duration) -> Result<(), LocalAgentError> {
    wait_for_group_exit_until(process_group, TokioInstant::now() + timeout, false).await
}

async fn wait_for_group_exit_until(
    process_group: i32,
    deadline: TokioInstant,
    repeat_termination: bool,
) -> Result<(), LocalAgentError> {
    #[cfg(unix)]
    {
        let mut absent_since = None;
        loop {
            let now = TokioInstant::now();
            if process_group_exists(process_group) {
                absent_since = None;
            } else {
                let first_absent = *absent_since.get_or_insert(now);
                if now.duration_since(first_absent) >= PROCESS_GROUP_ABSENCE_CONFIRMATION {
                    return Ok(());
                }
            }
            if now >= deadline {
                return Err(process_cleanup_error());
            }
            if repeat_termination {
                unsafe {
                    let _ = libc::kill(-process_group, libc::SIGKILL);
                }
            }
            tokio::time::sleep_until((now + PROCESS_GROUP_POLL_INTERVAL).min(deadline)).await;
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (process_group, deadline, repeat_termination);
        Ok(())
    }
}

fn stream_fault_error(fault: StreamFault) -> LocalAgentError {
    match fault {
        StreamFault::OutputTooLarge => LocalAgentError::run(
            "local_agent_output_too_large",
            "The local agent output exceeded the safe limit.",
        ),
        StreamFault::Io => io_error(),
    }
}

fn cancelled_error() -> LocalAgentError {
    LocalAgentError::run(
        "local_agent_cancelled",
        "The local agent request was cancelled.",
    )
}

fn ensure_process_active(
    cancellation: &CancellationToken,
    deadline: StdInstant,
) -> Result<(), LocalAgentError> {
    if cancellation.is_cancelled() {
        Err(cancelled_error())
    } else if StdInstant::now() >= deadline {
        Err(timeout_error())
    } else {
        Ok(())
    }
}

fn timeout_error() -> LocalAgentError {
    LocalAgentError::run("local_agent_timeout", "The local agent request timed out.")
}

fn process_cleanup_error() -> LocalAgentError {
    LocalAgentError::run(
        "local_agent_cleanup_failed",
        "The local agent process could not be stopped safely.",
    )
}

fn io_error() -> LocalAgentError {
    LocalAgentError::run(
        "local_agent_io",
        "The local agent process could not be read safely.",
    )
}

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        env,
        ffi::{OsStr, OsString},
        fs,
        io::Write,
        path::{Path, PathBuf},
        sync::{Arc, Mutex},
        time::{Duration, Instant as StdInstant},
    };

    #[cfg(unix)]
    use std::os::unix::{
        fs::{OpenOptionsExt, PermissionsExt},
        process::CommandExt,
    };

    use tempfile::{TempDir, tempdir};
    #[cfg(unix)]
    use tokio::process::Command;
    use tokio_util::sync::CancellationToken;

    use super::{
        MAX_PROCESS_OUTPUT_BYTES, MAX_PROCESS_STDIN_BYTES, OwnedProcessInvocation,
        STDERR_TAIL_BYTES, controlled_environment, controlled_environment_for_agent,
        create_owned_temp_dir, run_process as run_process_until,
    };
    #[cfg(unix)]
    use super::{
        OPENCODE_CHILD_FILE_SIZE_LIMIT, ProcessActivityGuard, ProcessGroupRegistry,
        RegisteredProcessGroup, process_group_is_registered, terminate_and_reap,
        wait_for_group_exit, wait_for_registry_idle,
    };
    use crate::local_agents::{
        LocalAgentKind, LocalAgentRunRequest, LocalAgentTargetKind, ResolvedAgent,
        adapters::{AdapterInvocation, build_invocation},
        discovery::ExecutableProof,
        owned_opencode_environment,
    };
    use markdowner_core::ai_document::ByteRange;

    #[cfg(unix)]
    fn fake_executable(script: &str) -> (TempDir, PathBuf) {
        let directory = tempdir().unwrap();
        let executable = directory.path().join("fake-agent");
        fs::write(&executable, script).unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
        let executable = executable.canonicalize().unwrap();
        (directory, executable)
    }

    fn invocation(
        executable: PathBuf,
        cwd: &Path,
        env: Vec<(OsString, OsString)>,
        result_file: Option<PathBuf>,
    ) -> AdapterInvocation {
        AdapterInvocation {
            executable,
            args: Vec::new(),
            env,
            cwd: cwd.to_path_buf(),
            stdin: b"private prompt with captured source".to_vec(),
            result_file,
        }
    }

    #[cfg(unix)]
    fn local_agent_request(agent: LocalAgentKind, request_id: &str) -> LocalAgentRunRequest {
        let source = "# private captured source\n".to_string();
        LocalAgentRunRequest {
            request_id: request_id.to_string(),
            document_id: "document-1".to_string(),
            agent,
            target: LocalAgentTargetKind::Selection,
            selection: Some(ByteRange {
                start: 0,
                end: source.len(),
            }),
            cursor: None,
            source,
            instruction: "private instruction".to_string(),
            executable_path: None,
        }
    }

    #[cfg(unix)]
    fn write_private_file(path: &Path, contents: &[u8]) {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true).mode(0o600);
        options.open(path).unwrap().write_all(contents).unwrap();
    }

    fn prepare_owned(
        invocation: AdapterInvocation,
        temp_dir: super::OwnedTempCapability,
    ) -> Result<OwnedProcessInvocation, crate::local_agents::LocalAgentError> {
        let proof = ExecutableProof::capture(&invocation.executable).unwrap();
        OwnedProcessInvocation::prepare(
            invocation,
            temp_dir,
            proof,
            LocalAgentKind::Claude,
            &CancellationToken::new(),
            StdInstant::now() + Duration::from_secs(30),
        )
    }

    fn prepare_owned_for_kind_with_environment(
        invocation: AdapterInvocation,
        temp_dir: super::OwnedTempCapability,
        agent_kind: LocalAgentKind,
        inherited_environment: BTreeMap<OsString, OsString>,
    ) -> Result<OwnedProcessInvocation, crate::local_agents::LocalAgentError> {
        let proof = ExecutableProof::capture(&invocation.executable).unwrap();
        OwnedProcessInvocation::prepare_with_inherited_environment(
            invocation,
            temp_dir,
            proof,
            agent_kind,
            &CancellationToken::new(),
            StdInstant::now() + Duration::from_secs(30),
            inherited_environment,
        )
    }

    async fn run_process(
        owned: OwnedProcessInvocation,
        cancellation: CancellationToken,
        timeout: Duration,
    ) -> Result<super::ProcessOutput, crate::local_agents::LocalAgentError> {
        run_process_until(owned, cancellation, StdInstant::now() + timeout).await
    }

    #[cfg(unix)]
    fn prepared(script: &str) -> (TempDir, PathBuf, OwnedProcessInvocation) {
        let body = script.strip_prefix("#!/bin/sh\n").unwrap_or(script);
        let script = format!("#!/bin/sh\n/bin/cat >/dev/null\n{body}");
        let (executable_dir, executable) = fake_executable(&script);
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned(
            invocation(executable, &owned_path, Vec::new(), None),
            owned_temp,
        )
        .unwrap();
        (executable_dir, owned_path, prepared)
    }

    #[cfg(unix)]
    async fn regular_file_size_written_by(
        agent_kind: LocalAgentKind,
        requested_size: usize,
    ) -> usize {
        let script = format!(
            "#!/bin/sh\n/bin/cat >/dev/null\n/usr/bin/head -c {requested_size} /dev/zero > output.bin || true\n/usr/bin/wc -c < output.bin"
        );
        let (_executable_dir, executable) = fake_executable(&script);
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned_for_kind_with_environment(
            invocation(executable, &owned_path, Vec::new(), None),
            owned_temp,
            agent_kind,
            BTreeMap::new(),
        )
        .unwrap();
        let output = run_process(prepared, CancellationToken::new(), Duration::from_secs(2))
            .await
            .unwrap();

        std::str::from_utf8(&output.stdout)
            .unwrap()
            .trim()
            .parse::<usize>()
            .unwrap()
    }

    #[cfg(unix)]
    fn read_positive_pid(path: &Path) -> Option<i32> {
        fs::read_to_string(path)
            .ok()?
            .trim()
            .parse::<i32>()
            .ok()
            .filter(|pid| *pid > 0)
    }

    #[cfg(unix)]
    async fn wait_for_positive_pid(path: &Path) -> i32 {
        let deadline = StdInstant::now() + Duration::from_secs(1);
        loop {
            if let Some(pid) = read_positive_pid(path) {
                return pid;
            }
            assert!(
                StdInstant::now() < deadline,
                "fake process did not publish a positive PID"
            );
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
    }

    #[cfg(unix)]
    async fn wait_for_positive_pid_pair(first: &Path, second: &Path) -> (i32, i32) {
        let deadline = StdInstant::now() + Duration::from_secs(1);
        loop {
            if let (Some(first), Some(second)) =
                (read_positive_pid(first), read_positive_pid(second))
            {
                return (first, second);
            }
            assert!(
                StdInstant::now() < deadline,
                "fake processes did not publish positive PIDs"
            );
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
    }

    #[cfg(unix)]
    async fn wait_for_aborted_group_cleanup(leader_pid: i32, child_pid: i32) {
        let deadline = StdInstant::now() + super::PROCESS_CLEANUP_TIMEOUT;
        loop {
            if !process_exists(child_pid)
                && !process_exists(leader_pid)
                && !process_group_is_registered(leader_pid)
            {
                return;
            }
            assert!(
                StdInstant::now() < deadline,
                "aborted process group cleanup exceeded its bound"
            );
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }

    #[cfg(unix)]
    async fn wait_for_temp_path_removal(path: &Path) {
        let deadline = StdInstant::now() + super::PROCESS_CLEANUP_TIMEOUT;
        while path.exists() {
            assert!(
                StdInstant::now() < deadline,
                "owned temporary directory cleanup exceeded its bound"
            );
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
    }

    #[cfg(unix)]
    async fn wait_for_empty_directory(path: &Path) {
        let deadline = StdInstant::now() + super::PROCESS_CLEANUP_TIMEOUT;
        loop {
            if fs::read_dir(path)
                .map(|mut entries| entries.next().is_none())
                .unwrap_or(true)
            {
                return;
            }
            assert!(
                StdInstant::now() < deadline,
                "temporary directory was not emptied before cleanup deadline"
            );
            tokio::task::yield_now().await;
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn successful_process_keeps_its_owned_temp_dir_until_result_validation_finishes() {
        let (executable_dir, owned_path, prepared) = prepared("#!/bin/sh\nprintf 'valid result'");
        let sibling = executable_dir.path().join("keep-me");
        fs::write(&sibling, b"outside").unwrap();

        let mut output = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap();

        assert_eq!(output.stdout, b"valid result");
        assert!(output.result_file.is_none());
        assert!(output.stderr_tail.is_empty());
        assert!(owned_path.exists());
        output.close_temp_dir().await.unwrap();
        assert!(!owned_path.exists());
        assert_eq!(fs::read(sibling).unwrap(), b"outside");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn directory_identity_allows_owned_child_entries_to_change_link_count() {
        let (_executable_dir, owned_path, prepared) =
            prepared("#!/bin/sh\n/bin/mkdir nested\nprintf valid");

        let mut output = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap();

        assert_eq!(output.stdout, b"valid");
        assert!(owned_path.join("nested").is_dir());
        output.close_temp_dir().await.unwrap();
        assert!(!owned_path.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cleanup_repairs_nontraversable_nested_directories_without_following_symlinks() {
        let outside = tempdir().unwrap();
        let outside_sentinel = outside.path().join("sentinel");
        fs::write(&outside_sentinel, b"outside-content").unwrap();
        fs::set_permissions(outside.path(), fs::Permissions::from_mode(0o500)).unwrap();
        let (executable_dir, executable) = fake_executable(
            "#!/bin/sh\n/bin/cat >/dev/null\n/bin/mkdir nested\nprintf secret > nested/file\n/bin/chmod 000 nested\n/bin/ln -s \"$OUTSIDE_ROOT\" outside-link\nprintf valid",
        );
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned(
            invocation(
                executable,
                &owned_path,
                vec![(
                    OsString::from("OUTSIDE_ROOT"),
                    outside.path().as_os_str().to_owned(),
                )],
                None,
            ),
            owned_temp,
        )
        .unwrap();

        let mut output = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap();
        let close_result = output.close_temp_dir().await;
        let root_was_removed = !owned_path.exists();
        if !root_was_removed {
            fs::set_permissions(owned_path.join("nested"), fs::Permissions::from_mode(0o700))
                .unwrap();
            fs::remove_dir_all(&owned_path).unwrap();
        }

        assert_eq!(output.stdout, b"valid");
        assert!(close_result.is_ok());
        assert!(root_was_removed);
        assert_eq!(fs::read(&outside_sentinel).unwrap(), b"outside-content");
        assert_eq!(
            fs::metadata(outside.path()).unwrap().permissions().mode() & 0o777,
            0o500
        );
        fs::set_permissions(outside.path(), fs::Permissions::from_mode(0o700)).unwrap();
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn dropping_unparsed_output_repairs_nontraversable_nested_directories() {
        let (_executable_dir, owned_path, prepared) = prepared(
            "#!/bin/sh\n/bin/mkdir nested\nprintf secret > nested/file\n/bin/chmod 000 nested\nprintf invalid",
        );

        let output = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap();
        drop(output);
        wait_for_temp_path_removal(&owned_path).await;
        let root_was_removed = !owned_path.exists();
        if !root_was_removed {
            fs::set_permissions(owned_path.join("nested"), fs::Permissions::from_mode(0o700))
                .unwrap();
            fs::remove_dir_all(&owned_path).unwrap();
        }

        assert!(root_was_removed);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cleanup_never_removes_a_root_substituted_after_identity_validation() {
        let outside = tempdir().unwrap();
        let outside_sentinel = outside.path().join("outside-sentinel");
        fs::write(&outside_sentinel, b"outside").unwrap();
        let (_executable_dir, owned_path, prepared) = prepared("#!/bin/sh\nprintf valid");
        fs::write(owned_path.join("original-sentinel"), b"original").unwrap();
        let moved_original = owned_path.with_file_name(format!(
            "{}-moved",
            owned_path.file_name().unwrap().to_string_lossy()
        ));
        let replacement_sentinel = owned_path.join("replacement-sentinel");
        let interlock = super::TestCleanupInterlock {
            before_removal: std::sync::Arc::new(std::sync::Barrier::new(2)),
            replacement_ready: std::sync::Arc::new(std::sync::Barrier::new(2)),
        };

        let mut output = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap();
        output.cleanup_interlock = Some(interlock.clone());
        let swap_thread = std::thread::spawn({
            let owned_path = owned_path.clone();
            let moved_original = moved_original.clone();
            let replacement_sentinel = replacement_sentinel.clone();
            let outside = outside.path().to_path_buf();
            move || {
                interlock.before_removal.wait();
                fs::rename(&owned_path, &moved_original).unwrap();
                fs::create_dir(&owned_path).unwrap();
                fs::write(&replacement_sentinel, b"replacement").unwrap();
                std::os::unix::fs::symlink(outside, owned_path.join("outside-link")).unwrap();
                interlock.replacement_ready.wait();
            }
        });

        let error = output.close_temp_dir().await.unwrap_err();
        swap_thread.join().unwrap();

        assert_eq!(error.code, "invalid_temp_directory");
        assert_eq!(fs::read(&replacement_sentinel).unwrap(), b"replacement");
        assert_eq!(
            fs::read(moved_original.join("original-sentinel")).unwrap(),
            b"original"
        );
        assert_eq!(fs::read(&outside_sentinel).unwrap(), b"outside");
        drop(output);
        fs::remove_dir_all(&owned_path).unwrap();
        fs::remove_dir_all(&moved_original).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cancellation_during_fake_process_cleanup_is_bounded_and_retains_the_root() {
        let (_executable_dir, owned_path, prepared) =
            prepared("#!/bin/sh\nprintf private > retained-file\nprintf valid");
        let cancellation = CancellationToken::new();
        let mut output = run_process(prepared, cancellation.clone(), Duration::from_secs(30))
            .await
            .unwrap();
        let interlock = super::TestCleanupInterlock {
            before_removal: std::sync::Arc::new(std::sync::Barrier::new(2)),
            replacement_ready: std::sync::Arc::new(std::sync::Barrier::new(2)),
        };
        output.cleanup_interlock = Some(interlock.clone());
        let cancel_thread = std::thread::spawn({
            let cancellation = cancellation.clone();
            move || {
                interlock.before_removal.wait();
                cancellation.cancel();
                interlock.replacement_ready.wait();
            }
        });

        let error = output.close_temp_dir().await.unwrap_err();
        cancel_thread.join().unwrap();

        assert_eq!(error.code, "local_agent_cleanup_failed");
        assert!(!format!("{error:?}").contains("private"));
        assert_eq!(
            fs::read(owned_path.join("retained-file")).unwrap(),
            b"private"
        );
        fs::remove_dir_all(&owned_path).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn shutdown_latch_allows_only_preowned_cleanup_and_barrier_waits_for_it() {
        let registry = Arc::new(Mutex::new(ProcessGroupRegistry::default()));
        let (_executable_dir, owned_path, mut prepared) =
            prepared("#!/bin/sh\nprintf private > retained-file\nprintf valid");
        prepared.replace_cleanup_registry_for_test(Arc::clone(&registry));
        assert_eq!(registry.lock().unwrap().active_cleanup_operations, 1);
        let cancellation = CancellationToken::new();
        let mut output = run_process(prepared, cancellation.clone(), Duration::from_secs(30))
            .await
            .unwrap();
        assert_eq!(registry.lock().unwrap().active_cleanup_operations, 1);
        let interlock = super::TestCleanupInterlock {
            before_removal: Arc::new(std::sync::Barrier::new(2)),
            replacement_ready: Arc::new(std::sync::Barrier::new(2)),
        };
        output.cleanup_interlock = Some(interlock.clone());

        // Model an already-cancelling run whose app-exit latch is established
        // before the owned output transitions into cleanup.
        cancellation.cancel();
        registry.lock().unwrap().begin_shutdown();
        assert!(ProcessActivityGuard::begin_with_registry(Arc::clone(&registry)).is_none());
        assert!(
            super::CleanupActivityGuard::reserve_with_registry(Arc::clone(&registry)).is_none()
        );

        let cleanup = tokio::spawn(async move {
            let result = output.close_temp_dir().await;
            (output, result)
        });
        tokio::task::yield_now().await;
        interlock.before_removal.wait();
        assert_eq!(registry.lock().unwrap().active_cleanup_operations, 1);
        assert!(!wait_for_registry_idle(Arc::clone(&registry), Duration::ZERO).await);
        interlock.replacement_ready.wait();

        let (_output, result) = cleanup.await.unwrap();
        assert!(result.is_ok());
        assert!(!owned_path.exists());
        assert!(wait_for_registry_idle(Arc::clone(&registry), Duration::from_secs(1)).await);
        let registry = registry.lock().unwrap();
        assert_eq!(registry.active_cleanup_operations, 0);
        assert_eq!(registry.cleanup_failures, 0);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn shutdown_cleanup_failure_retains_private_root_and_releases_tracking() {
        let registry = Arc::new(Mutex::new(ProcessGroupRegistry::default()));
        let (_executable_dir, owned_path, mut prepared) =
            prepared("#!/bin/sh\nprintf private-content > retained-file\nprintf valid");
        prepared.replace_cleanup_registry_for_test(Arc::clone(&registry));
        let cancellation = CancellationToken::new();
        let mut output = run_process(prepared, cancellation.clone(), Duration::from_secs(30))
            .await
            .unwrap();
        let mut nested = owned_path.clone();
        for depth in 0..=super::MAX_TEMP_CLEANUP_DEPTH {
            nested.push(format!("level-{depth}"));
            fs::create_dir(&nested).unwrap();
        }
        fs::write(nested.join("private-sentinel"), b"private-content").unwrap();

        cancellation.cancel();
        registry.lock().unwrap().begin_shutdown();
        let error = output.close_temp_dir().await.unwrap_err();

        assert_eq!(error.code, "local_agent_cleanup_failed");
        assert_eq!(
            error.message,
            "The local agent temporary directory could not be removed."
        );
        let debug = format!("{error:?}");
        assert!(!debug.contains("private-content"));
        assert!(!debug.contains(&owned_path.to_string_lossy().to_string()));
        assert!(owned_path.exists());
        assert!(wait_for_registry_idle(Arc::clone(&registry), Duration::from_secs(1)).await);
        let registry_guard = registry.lock().unwrap();
        assert_eq!(registry_guard.active_cleanup_operations, 0);
        assert_eq!(registry_guard.cleanup_failures, 1);
        drop(registry_guard);
        fs::remove_dir_all(&owned_path).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn nearly_expired_cleanup_deadline_returns_before_the_blocking_worker() {
        let (_executable_dir, owned_path, prepared) =
            prepared("#!/bin/sh\nprintf private > retained-file\nprintf valid");
        let mut output = run_process(prepared, CancellationToken::new(), Duration::from_secs(30))
            .await
            .unwrap();
        let interlock = super::TestCleanupInterlock {
            before_removal: std::sync::Arc::new(std::sync::Barrier::new(2)),
            replacement_ready: std::sync::Arc::new(std::sync::Barrier::new(2)),
        };
        output.cleanup_interlock = Some(interlock.clone());
        output.cleanup_deadline = StdInstant::now() + Duration::from_millis(20);
        let release_thread = std::thread::spawn(move || {
            interlock.before_removal.wait();
            std::thread::sleep(Duration::from_millis(150));
            interlock.replacement_ready.wait();
        });
        let started = StdInstant::now();

        let error = output.close_temp_dir().await.unwrap_err();
        let elapsed_before_worker_release = started.elapsed();
        release_thread.join().unwrap();

        assert_eq!(error.code, "local_agent_cleanup_failed");
        assert!(elapsed_before_worker_release < Duration::from_millis(100));
        assert!(!format!("{error:?}").contains("private"));
        assert_eq!(
            fs::read(owned_path.join("retained-file")).unwrap(),
            b"private"
        );
        fs::remove_dir_all(&owned_path).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn fake_process_readable_tree_over_depth_cap_is_retained_with_cleanup_error() {
        let script = format!(
            "#!/bin/sh\npath=\"$PWD\"\ni=0\nwhile [ \"$i\" -le {} ]; do path=\"$path/level-$i\"; /bin/mkdir \"$path\" || exit 90; i=$((i + 1)); done\nprintf private > \"$path/sentinel\"\nprintf valid",
            super::MAX_TEMP_CLEANUP_DEPTH
        );
        let (_executable_dir, owned_path, prepared) = prepared(&script);
        let mut output = run_process(prepared, CancellationToken::new(), Duration::from_secs(30))
            .await
            .unwrap();

        let error = output.close_temp_dir().await.unwrap_err();

        assert_eq!(error.code, "local_agent_cleanup_failed");
        assert!(!format!("{error:?}").contains("private"));
        assert!(owned_path.exists());
        fs::remove_dir_all(&owned_path).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn fake_process_readable_tree_over_entry_cap_is_retained_with_cleanup_error() {
        let script = format!(
            "#!/bin/sh\ni=0\nwhile [ \"$i\" -le {} ]; do : > \"entry-$i\"; i=$((i + 1)); done\nprintf valid",
            super::MAX_TEMP_CLEANUP_ENTRIES
        );
        let (_executable_dir, owned_path, prepared) = prepared(&script);
        let mut output = run_process(prepared, CancellationToken::new(), Duration::from_secs(30))
            .await
            .unwrap();

        let error = output.close_temp_dir().await.unwrap_err();

        assert_eq!(error.code, "local_agent_cleanup_failed");
        assert!(!format!("{error:?}").contains("private"));
        assert!(owned_path.exists());
        fs::remove_dir_all(&owned_path).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn inaccessible_tree_beyond_repair_budget_fails_closed_and_is_retained() {
        let mut capability = create_owned_temp_dir().unwrap();
        let owned_path = capability.path().to_path_buf();
        let identity = capability.identity.clone();
        let mut nested = owned_path.clone();
        for depth in 0..=super::MAX_TEMP_CLEANUP_DEPTH {
            nested.push(format!("level-{depth}"));
            fs::create_dir(&nested).unwrap();
        }
        fs::write(nested.join("sentinel"), b"private").unwrap();
        fs::set_permissions(&nested, fs::Permissions::from_mode(0o000)).unwrap();
        let mut directory = capability.temp_dir.take();
        let mut handle = capability.root.take();
        let mut parent_handle = capability.parent.take();
        let root_name = capability.root_name.clone();
        let mut cleanup_activity = capability.cleanup_activity.take();

        let error = super::close_temp_dir(
            super::TempCleanupSlot {
                temp_dir: &mut directory,
                identity: Some(&identity),
                root: &mut handle,
                parent: &mut parent_handle,
                root_name: Some(&root_name),
                activity: &mut cleanup_activity,
                clear_detached_contents: false,
            },
            &CancellationToken::new(),
            StdInstant::now() + Duration::from_secs(1),
            None,
        )
        .await
        .unwrap_err();

        assert_eq!(error.code, "local_agent_cleanup_failed");
        assert!(owned_path.exists());
        fs::set_permissions(&nested, fs::Permissions::from_mode(0o700)).unwrap();
        fs::remove_dir_all(&owned_path).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn mutable_temp_directory_mode_never_prevents_exact_owned_cleanup() {
        let (_executable_dir, owned_path, prepared) =
            prepared("#!/bin/sh\n/bin/chmod 0755 \"$PWD\"\nprintf invalid");

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap_err();

        assert_eq!(error.code, "invalid_temp_directory");
        assert!(!owned_path.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stdout_overflow_is_bounded_and_cleans_the_owned_temp_dir() {
        let script = format!(
            "#!/bin/sh\n/usr/bin/head -c {} /dev/zero",
            MAX_PROCESS_OUTPUT_BYTES + 1
        );
        let (_executable_dir, owned_path, prepared) = prepared(&script);

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(2))
            .await
            .unwrap_err();

        assert_eq!(error.code, "local_agent_output_too_large");
        assert!(!owned_path.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn child_regular_files_cannot_grow_beyond_the_kernel_file_size_limit() {
        let capped_size =
            regular_file_size_written_by(LocalAgentKind::Claude, MAX_PROCESS_OUTPUT_BYTES + 4096)
                .await;

        assert!(capped_size <= MAX_PROCESS_OUTPUT_BYTES + 1);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn opencode_can_write_bootstrap_files_larger_than_the_output_cap() {
        let required_size = 4 * 1024 * 1024;
        let written_size =
            regular_file_size_written_by(LocalAgentKind::Opencode, required_size).await;

        assert_eq!(written_size, required_size);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn opencode_regular_files_remain_bounded_by_the_agent_limit() {
        let capped_size = regular_file_size_written_by(
            LocalAgentKind::Opencode,
            OPENCODE_CHILD_FILE_SIZE_LIMIT + 4096,
        )
        .await;

        assert!(capped_size <= OPENCODE_CHILD_FILE_SIZE_LIMIT);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn pre_cancelled_request_never_spawns_the_executable() {
        let marker_dir = tempdir().unwrap();
        let marker = marker_dir.path().join("spawned");
        let (executable_dir, executable) =
            fake_executable("#!/bin/sh\n/usr/bin/touch \"$SPAWN_MARKER\"\n/bin/cat >/dev/null");
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned(
            invocation(
                executable,
                &owned_path,
                vec![(
                    OsString::from("SPAWN_MARKER"),
                    marker.as_os_str().to_owned(),
                )],
                None,
            ),
            owned_temp,
        )
        .unwrap();
        let cancellation = CancellationToken::new();
        cancellation.cancel();

        let error = run_process(prepared, cancellation, Duration::from_secs(1))
            .await
            .unwrap_err();

        assert_eq!(error.code, "local_agent_cancelled");
        assert!(!marker.exists());
        assert!(!owned_path.exists());
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn expired_absolute_deadline_never_starts_a_fresh_process_budget() {
        let marker_dir = tempdir().unwrap();
        let marker = marker_dir.path().join("spawned");
        let (executable_dir, executable) =
            fake_executable("#!/bin/sh\n/usr/bin/touch \"$SPAWN_MARKER\"");
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned(
            invocation(
                executable,
                &owned_path,
                vec![(
                    OsString::from("SPAWN_MARKER"),
                    marker.as_os_str().to_owned(),
                )],
                None,
            ),
            owned_temp,
        )
        .unwrap();

        let error = run_process_until(
            prepared,
            CancellationToken::new(),
            StdInstant::now() - Duration::from_millis(1),
        )
        .await
        .unwrap_err();

        assert_eq!(error.code, "local_agent_cleanup_failed");
        assert!(!marker.exists());
        assert!(owned_path.exists());
        fs::remove_dir_all(&owned_path).unwrap();
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stderr_overflow_kills_the_group_without_returning_captured_content() {
        let pid_dir = tempdir().unwrap();
        let pid_file = pid_dir.path().join("agent.pid");
        let script = format!(
            "#!/bin/sh\n/bin/cat >/dev/null\nprintf '%s' \"$$\" > \"$FAKE_AGENT_PID_FILE\"\nprintf 'captured source private prompt' >&2\n/usr/bin/head -c {} /dev/zero >&2\n/bin/sleep 30",
            STDERR_TAIL_BYTES
        );
        let (executable_dir, executable) = fake_executable(&script);
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned(
            invocation(
                executable,
                &owned_path,
                vec![(
                    OsString::from("FAKE_AGENT_PID_FILE"),
                    pid_file.as_os_str().to_owned(),
                )],
                None,
            ),
            owned_temp,
        )
        .unwrap();

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap_err();
        let agent_pid = fs::read_to_string(pid_file)
            .unwrap()
            .parse::<i32>()
            .unwrap();

        assert_eq!(error.code, "local_agent_output_too_large");
        let debug = format!("{error:?}");
        assert!(!debug.contains("captured source"));
        assert!(!debug.contains("private prompt"));
        assert!(!process_exists(agent_pid));
        assert!(!owned_path.exists());
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stderr_at_the_limit_is_returned_only_to_the_internal_caller() {
        let script = format!(
            "#!/bin/sh\n/usr/bin/head -c {} /dev/zero >&2\nprintf ok",
            STDERR_TAIL_BYTES
        );
        let (_executable_dir, _owned_path, prepared) = prepared(&script);

        let output = run_process(prepared, CancellationToken::new(), Duration::from_secs(2))
            .await
            .unwrap();

        assert_eq!(output.stdout, b"ok");
        assert_eq!(output.stderr_tail.len(), STDERR_TAIL_BYTES);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn timeout_kills_the_group_reaps_the_leader_and_cleans_temp() {
        let (_executable_dir, owned_path, prepared) = prepared("#!/bin/sh\n/bin/sleep 30");

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap_err();

        assert_eq!(error.code, "local_agent_timeout");
        assert!(!owned_path.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn process_group_confirmation_timeout_is_a_sanitized_cleanup_error() {
        let current_process_group = unsafe { libc::getpgrp() };

        let error = wait_for_group_exit(current_process_group, Duration::from_millis(10))
            .await
            .unwrap_err();

        assert_eq!(error.code, "local_agent_cleanup_failed");
        assert!(!error.message.contains(&current_process_group.to_string()));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn process_group_disappearance_requires_a_stable_absence_window() {
        let nonexistent_process_group = i32::MAX;
        assert!(!super::process_group_exists(nonexistent_process_group));
        let started = StdInstant::now();

        wait_for_group_exit(nonexistent_process_group, Duration::from_millis(100))
            .await
            .unwrap();

        assert!(started.elapsed() >= Duration::from_millis(20));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn group_guard_stays_registered_until_disappearance_is_confirmed() {
        let mut command = Command::new("/bin/sleep");
        command.arg("30").kill_on_drop(true);
        command.as_std_mut().process_group(0);
        let mut child = command.spawn().unwrap();
        let mut guard = RegisteredProcessGroup::from_child(&child).unwrap();
        let process_group = guard.id();

        let error = wait_for_group_exit(process_group, Duration::from_millis(10))
            .await
            .unwrap_err();

        assert_eq!(error.code, "local_agent_cleanup_failed");
        assert!(process_group_is_registered(process_group));
        terminate_and_reap(&mut child, &mut guard).await.unwrap();
        assert!(!process_group_is_registered(process_group));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn dropping_an_unconfirmed_group_guard_kills_and_removes_its_registration() {
        let mut command = Command::new("/bin/sleep");
        command.arg("30").kill_on_drop(true);
        command.as_std_mut().process_group(0);
        let mut child = command.spawn().unwrap();
        let guard = RegisteredProcessGroup::from_child(&child).unwrap();
        let process_group = guard.id();

        let error = wait_for_group_exit(process_group, Duration::from_millis(10))
            .await
            .unwrap_err();
        assert_eq!(error.code, "local_agent_cleanup_failed");
        assert!(process_group_is_registered(process_group));

        drop(guard);
        tokio::time::timeout(Duration::from_secs(1), child.wait())
            .await
            .unwrap()
            .unwrap();

        assert!(!process_group_is_registered(process_group));
        assert!(!process_exists(process_group));
    }

    #[cfg(unix)]
    #[test]
    fn shutdown_latch_rejects_late_registration_without_global_state() {
        let mut registry = ProcessGroupRegistry::default();
        assert!(registry.register(41_001));
        assert!(registry.begin_provider_operation());
        assert!(registry.reserve_cleanup_activity());
        assert!(!registry.is_idle());

        let active_at_shutdown = registry.begin_shutdown();

        assert_eq!(active_at_shutdown, vec![41_001]);
        assert!(!registry.register(41_002));
        assert!(!registry.begin_provider_operation());
        assert!(!registry.reserve_cleanup_activity());
        assert_eq!(registry.snapshot(), vec![41_001]);
        registry.unregister(41_001);
        registry.finish_provider_operation();
        assert!(!registry.is_idle());
        registry.finish_cleanup_activity(false);
        assert_eq!(registry.cleanup_failures, 1);
        registry.begin_rejected_cleanup();
        assert!(!registry.is_idle());
        registry.finish_rejected_cleanup();
        assert!(registry.is_idle());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn rejected_registration_cleanup_kills_and_reaps_the_direct_child() {
        let mut command = Command::new("/bin/sh");
        command.arg("-c").arg("/bin/sleep 30").process_group(0);
        let mut child = command.spawn().unwrap();
        let process_group = i32::try_from(child.id().unwrap()).unwrap();
        let mut rejected = super::RejectedProcessGroup {
            id: process_group,
            tracked: false,
            confirmed: false,
        };

        super::kill_unregistered_group_and_reap(&mut child, &mut rejected)
            .await
            .unwrap();

        assert!(rejected.confirmed);
        assert!(!process_exists(process_group));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn missing_spawn_pipe_kills_reaps_and_unregisters_the_group() {
        let mut command = Command::new("/bin/sh");
        command
            .arg("-c")
            .arg("/bin/sleep 30")
            .process_group(0)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped());
        let mut child = command.spawn().unwrap();
        let process_group = i32::try_from(child.id().unwrap()).unwrap();
        let mut guard = RegisteredProcessGroup::register(process_group).unwrap();

        let error = match super::take_child_pipes_or_cleanup(&mut child, &mut guard).await {
            Ok(_) => panic!("a missing stdout pipe must fail closed"),
            Err(error) => error,
        };

        assert_eq!(error.code, "local_agent_io");
        assert!(!process_group_is_registered(process_group));
        assert!(!process_exists(process_group));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cancellation_kills_pipe_holding_descendants_and_never_returns_partial_output() {
        let pid_dir = tempdir().unwrap();
        let pid_file = pid_dir.path().join("child.pid");
        let (executable_dir, executable) = fake_executable(
            "#!/bin/sh\n/bin/cat >/dev/null\n/bin/sleep 30 &\nprintf '%s' \"$!\" > \"$FAKE_CHILD_PID_FILE\"\nprintf 'partial output'\n/bin/sleep 30",
        );
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned(
            invocation(
                executable,
                &owned_path,
                vec![(
                    OsString::from("FAKE_CHILD_PID_FILE"),
                    pid_file.as_os_str().to_owned(),
                )],
                None,
            ),
            owned_temp,
        )
        .unwrap();
        let cancellation = CancellationToken::new();
        let task_cancellation = cancellation.clone();
        let task = tokio::spawn(async move {
            run_process(prepared, task_cancellation, Duration::from_secs(5)).await
        });
        let child_pid = wait_for_positive_pid(&pid_file).await;

        cancellation.cancel();
        let error = task.await.unwrap().unwrap_err();

        assert_eq!(error.code, "local_agent_cancelled");
        assert!(!owned_path.exists());
        assert!(!process_exists(child_pid));
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn successful_leader_still_kills_pipe_holding_descendants_before_returning() {
        let pid_dir = tempdir().unwrap();
        let pid_file = pid_dir.path().join("child.pid");
        let (executable_dir, executable) = fake_executable(
            "#!/bin/sh\n/bin/cat >/dev/null\n/bin/sleep 30 &\nprintf '%s' \"$!\" > \"$FAKE_CHILD_PID_FILE\"\nprintf complete",
        );
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned(
            invocation(
                executable,
                &owned_path,
                vec![(
                    OsString::from("FAKE_CHILD_PID_FILE"),
                    pid_file.as_os_str().to_owned(),
                )],
                None,
            ),
            owned_temp,
        )
        .unwrap();

        let mut output = run_process(prepared, CancellationToken::new(), Duration::from_secs(3))
            .await
            .unwrap();
        let child_pid = fs::read_to_string(&pid_file)
            .unwrap()
            .parse::<i32>()
            .unwrap();

        assert_eq!(output.stdout, b"complete");
        assert!(!process_exists(child_pid));
        assert!(owned_path.exists());
        output.close_temp_dir().await.unwrap();
        assert!(!owned_path.exists());
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn nonzero_exit_never_accepts_partial_output_or_exposes_stderr() {
        let (_executable_dir, owned_path, prepared) = prepared(
            "#!/bin/sh\nprintf 'partial output'\nprintf 'captured source private prompt' >&2\nexit 7",
        );

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap_err();

        assert_eq!(error.code, "local_agent_failed");
        assert!(!error.message.contains("captured source"));
        assert!(!error.message.contains("private prompt"));
        assert!(!owned_path.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn broken_pipe_while_writing_stdin_defers_to_the_child_exit_status() {
        let (executable_dir, executable) = fake_executable("#!/bin/sh\nexit 7");
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let mut adapter_invocation = invocation(executable, &owned_path, Vec::new(), None);
        adapter_invocation.stdin = vec![b'x'; MAX_PROCESS_STDIN_BYTES];
        let prepared = prepare_owned(adapter_invocation, owned_temp).unwrap();

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap_err();

        assert_eq!(error.code, "local_agent_failed");
        assert!(!owned_path.exists());
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn successful_child_after_broken_stdin_never_accepts_partial_output() {
        let (executable_dir, executable) =
            fake_executable("#!/bin/sh\nprintf hardcoded-without-reading-stdin\nexit 0");
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let mut adapter_invocation = invocation(executable, &owned_path, Vec::new(), None);
        adapter_invocation.stdin = vec![b'x'; MAX_PROCESS_STDIN_BYTES];
        let prepared = prepare_owned(adapter_invocation, owned_temp).unwrap();

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap_err();

        assert_eq!(error.code, "local_agent_io");
        assert!(!owned_path.exists());
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn result_path_substitution_is_rejected_without_reading_or_deleting_the_target() {
        let outside = tempdir().unwrap();
        let outside_file = outside.path().join("outside.json");
        let pid_file = outside.path().join("agent.pid");
        fs::write(&outside_file, b"private outside bytes").unwrap();
        let (executable_dir, executable) = fake_executable(
            "#!/bin/sh\n/bin/cat >/dev/null\nprintf '%s' \"$$\" > \"$FAKE_AGENT_PID_FILE\"\n/bin/rm -f \"$RESULT_FILE\"\n/bin/ln -s \"$OUTSIDE_FILE\" \"$RESULT_FILE\"\n/bin/sleep 30",
        );
        let mut owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let result_file = owned_temp
            .write_adapter_file("result.json", &[], true)
            .unwrap();
        let prepared = prepare_owned(
            invocation(
                executable,
                &owned_path,
                vec![
                    (
                        OsString::from("RESULT_FILE"),
                        result_file.as_os_str().to_owned(),
                    ),
                    (
                        OsString::from("OUTSIDE_FILE"),
                        outside_file.as_os_str().to_owned(),
                    ),
                    (
                        OsString::from("FAKE_AGENT_PID_FILE"),
                        pid_file.as_os_str().to_owned(),
                    ),
                ],
                Some(result_file),
            ),
            owned_temp,
        )
        .unwrap();

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap_err();
        let agent_pid = fs::read_to_string(pid_file)
            .unwrap()
            .parse::<i32>()
            .unwrap();

        assert_eq!(error.code, "invalid_result_file");
        assert_eq!(fs::read(&outside_file).unwrap(), b"private outside bytes");
        assert!(!process_exists(agent_pid));
        assert!(!owned_path.exists());
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn temp_directory_identity_substitution_is_rejected_without_deleting_either_inode() {
        let outside = tempdir().unwrap();
        let moved_directory = outside.path().join("moved-owned-directory");
        let (executable_dir, executable) = fake_executable(
            "#!/bin/sh\n/bin/cat >/dev/null\n/bin/mv \"$PWD\" \"$MOVED_DIRECTORY\"\n/bin/mkdir \"$PWD\"\n/bin/chmod 700 \"$PWD\"\nprintf replacement > \"$PWD/replacement\"",
        );
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned(
            invocation(
                executable,
                &owned_path,
                vec![(
                    OsString::from("MOVED_DIRECTORY"),
                    moved_directory.as_os_str().to_owned(),
                )],
                None,
            ),
            owned_temp,
        )
        .unwrap();

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap_err();

        assert_eq!(error.code, "invalid_temp_directory");
        assert_eq!(
            fs::read(owned_path.join("replacement")).unwrap(),
            b"replacement"
        );
        assert!(moved_directory.exists());
        assert!(executable_dir.path().exists());
        fs::remove_dir_all(&owned_path).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn temp_root_symlink_substitution_never_chmods_or_deletes_the_target() {
        let outside = tempdir().unwrap();
        let outside_sentinel = outside.path().join("sentinel");
        fs::write(&outside_sentinel, b"outside-content").unwrap();
        fs::set_permissions(outside.path(), fs::Permissions::from_mode(0o755)).unwrap();
        let moved_root = outside.path().join("moved-owned-root");
        let (executable_dir, executable) = fake_executable(
            "#!/bin/sh\n/bin/cat >/dev/null\n/bin/mv \"$PWD\" \"$MOVED_ROOT\"\n/bin/ln -s \"$OUTSIDE_ROOT\" \"$PWD\"",
        );
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned(
            invocation(
                executable,
                &owned_path,
                vec![
                    (
                        OsString::from("MOVED_ROOT"),
                        moved_root.as_os_str().to_owned(),
                    ),
                    (
                        OsString::from("OUTSIDE_ROOT"),
                        outside.path().as_os_str().to_owned(),
                    ),
                ],
                None,
            ),
            owned_temp,
        )
        .unwrap();

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap_err();

        assert_eq!(error.code, "invalid_temp_directory");
        assert_eq!(fs::read(&outside_sentinel).unwrap(), b"outside-content");
        assert_eq!(
            fs::metadata(outside.path()).unwrap().permissions().mode() & 0o777,
            0o755
        );
        assert!(owned_path.is_symlink());
        assert!(moved_root.is_dir());
        assert!(executable_dir.path().exists());
        fs::remove_file(&owned_path).unwrap();
        fs::remove_dir_all(&moved_root).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn oversized_result_file_is_rejected_before_it_is_read() {
        let pid_dir = tempdir().unwrap();
        let pid_file = pid_dir.path().join("agent.pid");
        let script = format!(
            "#!/bin/sh\n/bin/cat >/dev/null\nprintf '%s' \"$$\" > \"$FAKE_AGENT_PID_FILE\"\n/usr/bin/head -c {} /dev/zero > \"$RESULT_FILE\"\n/bin/sleep 30",
            MAX_PROCESS_OUTPUT_BYTES + 1
        );
        let (executable_dir, executable) = fake_executable(&script);
        let mut owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let result_file = owned_temp
            .write_adapter_file("result.json", &[], true)
            .unwrap();
        let prepared = prepare_owned(
            invocation(
                executable,
                &owned_path,
                vec![
                    (
                        OsString::from("RESULT_FILE"),
                        result_file.as_os_str().to_owned(),
                    ),
                    (
                        OsString::from("FAKE_AGENT_PID_FILE"),
                        pid_file.as_os_str().to_owned(),
                    ),
                ],
                Some(result_file),
            ),
            owned_temp,
        )
        .unwrap();

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap_err();
        let agent_pid = fs::read_to_string(pid_file)
            .unwrap()
            .parse::<i32>()
            .unwrap();

        assert_eq!(error.code, "local_agent_output_too_large");
        assert!(!process_exists(agent_pid));
        assert!(!owned_path.exists());
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn hard_linking_the_reserved_result_file_is_rejected() {
        let (executable_dir, executable) = fake_executable(
            "#!/bin/sh\n/bin/cat >/dev/null\nprintf result > \"$RESULT_FILE\"\n/bin/ln \"$RESULT_FILE\" \"$RESULT_LINK\"",
        );
        let mut owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let result_file = owned_temp
            .write_adapter_file("result.json", &[], true)
            .unwrap();
        let result_link = owned_path.join("result-link.json");
        let prepared = prepare_owned(
            invocation(
                executable,
                &owned_path,
                vec![
                    (
                        OsString::from("RESULT_FILE"),
                        result_file.as_os_str().to_owned(),
                    ),
                    (
                        OsString::from("RESULT_LINK"),
                        result_link.as_os_str().to_owned(),
                    ),
                ],
                Some(result_file),
            ),
            owned_temp,
        )
        .unwrap();

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap_err();

        assert_eq!(error.code, "invalid_result_file");
        assert!(!owned_path.exists());
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn aborting_the_run_future_kills_the_entire_process_group() {
        let pid_dir = tempdir().unwrap();
        let leader_pid_file = pid_dir.path().join("leader.pid");
        let child_pid_file = pid_dir.path().join("child.pid");
        let (executable_dir, executable) = fake_executable(
            "#!/bin/sh\n/bin/cat >/dev/null\nprintf '%s' \"$$\" > \"$FAKE_LEADER_PID_FILE\"\n/bin/sleep 30 &\nprintf '%s' \"$!\" > \"$FAKE_CHILD_PID_FILE\"\n/bin/sleep 30",
        );
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned(
            invocation(
                executable,
                &owned_path,
                vec![
                    (
                        OsString::from("FAKE_LEADER_PID_FILE"),
                        leader_pid_file.as_os_str().to_owned(),
                    ),
                    (
                        OsString::from("FAKE_CHILD_PID_FILE"),
                        child_pid_file.as_os_str().to_owned(),
                    ),
                ],
                None,
            ),
            owned_temp,
        )
        .unwrap();
        let task = tokio::spawn(async move {
            run_process(prepared, CancellationToken::new(), Duration::from_secs(30)).await
        });
        let (leader_pid, child_pid) =
            wait_for_positive_pid_pair(&leader_pid_file, &child_pid_file).await;

        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        wait_for_aborted_group_cleanup(leader_pid, child_pid).await;

        assert!(!process_exists(child_pid));
        assert!(!process_exists(leader_pid));
        assert!(!process_group_is_registered(leader_pid));
        wait_for_temp_path_removal(&owned_path).await;
        assert!(!owned_path.exists());
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn executable_identity_substitution_is_rejected_before_spawn() {
        let (executable_dir, executable) = fake_executable("#!/bin/sh\nprintf original");
        let replacement = executable_dir.path().join("replacement");
        fs::write(&replacement, b"#!/bin/sh\nprintf replaced").unwrap();
        fs::set_permissions(&replacement, fs::Permissions::from_mode(0o700)).unwrap();
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned(
            invocation(executable.clone(), &owned_path, Vec::new(), None),
            owned_temp,
        )
        .unwrap();
        fs::remove_file(&executable).unwrap();
        std::os::unix::fs::symlink(&replacement, &executable).unwrap();

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap_err();

        assert_eq!(error.code, "invalid_executable");
        assert!(!owned_path.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn preparation_rejects_a_proof_captured_from_another_executable() {
        let (_proof_directory, proof_executable) = fake_executable("#!/bin/sh\nprintf proof");
        let proof = ExecutableProof::capture(&proof_executable).unwrap();
        let (_invocation_directory, invocation_executable) =
            fake_executable("#!/bin/sh\nprintf invocation");
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();

        let error = OwnedProcessInvocation::prepare(
            invocation(invocation_executable, &owned_path, Vec::new(), None),
            owned_temp,
            proof,
            LocalAgentKind::Claude,
            &CancellationToken::new(),
            StdInstant::now() + Duration::from_secs(30),
        )
        .unwrap_err();

        assert_eq!(error.code, "invalid_executable");
        wait_for_temp_path_removal(&owned_path).await;
        assert!(!owned_path.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn executable_content_is_rechecked_against_discovery_proof_before_spawn() {
        let marker_dir = tempdir().unwrap();
        let marker = marker_dir.path().join("spawned");
        let (executable_dir, executable) =
            fake_executable("#!/bin/sh\n/usr/bin/touch \"$SPAWN_MARKER\"");
        let proof = ExecutableProof::capture(&executable).unwrap();
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = OwnedProcessInvocation::prepare(
            invocation(
                executable.clone(),
                &owned_path,
                vec![(
                    OsString::from("SPAWN_MARKER"),
                    marker.as_os_str().to_owned(),
                )],
                None,
            ),
            owned_temp,
            proof,
            LocalAgentKind::Claude,
            &CancellationToken::new(),
            StdInstant::now() + Duration::from_secs(30),
        )
        .unwrap();
        fs::write(
            &executable,
            b"#!/bin/sh\n# changed in place\n/usr/bin/touch \"$SPAWN_MARKER\"",
        )
        .unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap_err();

        assert_eq!(error.code, "invalid_executable");
        assert!(!marker.exists());
        assert!(!owned_path.exists());
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn temp_root_swapped_before_preparation_never_uses_attacker_settings_or_starts() {
        let marker_dir = tempdir().unwrap();
        let started = marker_dir.path().join("provider-started");
        let disclosed_stdin = marker_dir.path().join("disclosed-stdin");
        let outside_sentinel = marker_dir.path().join("outside-sentinel");
        fs::write(&outside_sentinel, b"outside-safe").unwrap();
        let (executable_dir, executable) = fake_executable(
            "#!/bin/sh\n/usr/bin/touch \"$PROVIDER_STARTED\"\n/bin/cat > \"$DISCLOSED_STDIN\"",
        );
        let resolved = ResolvedAgent {
            kind: LocalAgentKind::Claude,
            path: executable.clone(),
            path_label: "fake/claude".to_string(),
        };
        let source = "# private captured source\n".to_string();
        let request = LocalAgentRunRequest {
            request_id: "root-swap-before-prepare".to_string(),
            document_id: "document-1".to_string(),
            agent: LocalAgentKind::Claude,
            target: LocalAgentTargetKind::Selection,
            selection: Some(ByteRange {
                start: 0,
                end: source.len(),
            }),
            cursor: None,
            source,
            instruction: "private instruction".to_string(),
            executable_path: None,
        };
        let registry = Arc::new(Mutex::new(ProcessGroupRegistry::default()));
        let mut owned_temp = create_owned_temp_dir().unwrap();
        owned_temp.replace_cleanup_registry_for_test(Arc::clone(&registry));
        let owned_path = owned_temp.path().to_path_buf();
        let detached_path = owned_path.with_extension("detached-original");
        let mut invocation = build_invocation(&resolved, &request, &mut owned_temp).unwrap();
        invocation.env.extend([
            (
                OsString::from("PROVIDER_STARTED"),
                started.as_os_str().to_owned(),
            ),
            (
                OsString::from("DISCLOSED_STDIN"),
                disclosed_stdin.as_os_str().to_owned(),
            ),
        ]);
        fs::rename(&owned_path, &detached_path).unwrap();
        fs::create_dir(&owned_path).unwrap();
        fs::set_permissions(&owned_path, fs::Permissions::from_mode(0o700)).unwrap();
        let attacker_settings = owned_path.join("claude-settings.json");
        let mut settings_options = fs::OpenOptions::new();
        settings_options.write(true).create_new(true).mode(0o600);
        settings_options
            .open(&attacker_settings)
            .unwrap()
            .write_all(br#"{"hooks":{"SessionStart":[{"command":"attacker"}]}}"#)
            .unwrap();

        let prepared = prepare_owned(invocation, owned_temp);
        let rejected_before_spawn = prepared.is_err();
        if let Ok(prepared) = prepared
            && let Ok(mut output) =
                run_process(prepared, CancellationToken::new(), Duration::from_secs(1)).await
        {
            let _ = output.close_temp_dir().await;
        }
        wait_for_empty_directory(&detached_path).await;
        let original_content_free = fs::read_dir(&detached_path)
            .map(|mut entries| entries.next().is_none())
            .unwrap_or(true);
        let replacement_survived = owned_path.exists();
        let attacker_settings_survived = attacker_settings.exists();
        let outside_survived = fs::read(&outside_sentinel).unwrap() == b"outside-safe";
        let provider_never_started = !started.exists() && !disclosed_stdin.exists();

        assert!(rejected_before_spawn);
        assert!(provider_never_started);
        assert!(replacement_survived);
        assert!(attacker_settings_survived);
        assert!(outside_survived);
        assert!(original_content_free);
        assert!(wait_for_registry_idle(Arc::clone(&registry), Duration::from_secs(1)).await);
        let registry = registry.lock().unwrap();
        assert_eq!(registry.active_cleanup_operations, 0);
        assert_eq!(registry.cleanup_failures, 1);
        drop(registry);
        if owned_path.exists() {
            fs::remove_dir_all(&owned_path).unwrap();
        }
        if detached_path.exists() {
            fs::remove_dir_all(&detached_path).unwrap();
        }
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn temp_root_swapped_before_invocation_build_never_uses_replacement_or_leaks_cleanup_activity()
     {
        let marker_dir = tempdir().unwrap();
        let provider_started = marker_dir.path().join("provider-started");
        let disclosed_stdin = marker_dir.path().join("disclosed-stdin");
        let outside_sentinel = marker_dir.path().join("outside-sentinel");
        fs::write(&outside_sentinel, b"outside-safe").unwrap();
        let (executable_dir, executable) = fake_executable(
            "#!/bin/sh\n/usr/bin/touch \"$PROVIDER_STARTED\"\n/bin/cat > \"$DISCLOSED_STDIN\"",
        );
        let resolved = ResolvedAgent {
            kind: LocalAgentKind::Claude,
            path: executable,
            path_label: "fake/claude".to_string(),
        };
        let registry = Arc::new(Mutex::new(ProcessGroupRegistry::default()));
        let mut capability = create_owned_temp_dir().unwrap();
        capability.replace_cleanup_registry_for_test(Arc::clone(&registry));
        let owned_path = capability.path().to_path_buf();
        let detached_path = owned_path.with_extension("detached-original");
        fs::rename(&owned_path, &detached_path).unwrap();
        fs::create_dir(&owned_path).unwrap();
        fs::set_permissions(&owned_path, fs::Permissions::from_mode(0o700)).unwrap();
        let attacker_settings = owned_path.join("claude-settings.json");
        let attacker_contents = br#"{"hooks":{"SessionStart":[{"command":"attacker"}]}}"#;
        write_private_file(&attacker_settings, attacker_contents);

        let result = build_invocation(
            &resolved,
            &local_agent_request(LocalAgentKind::Claude, "root-swap-before-build"),
            &mut capability,
        );
        drop(capability);
        wait_for_empty_directory(&detached_path).await;

        assert_eq!(result.unwrap_err().code, "invalid_adapter_request");
        assert_eq!(fs::read(&attacker_settings).unwrap(), attacker_contents);
        assert_eq!(fs::read(&outside_sentinel).unwrap(), b"outside-safe");
        assert!(!provider_started.exists());
        assert!(!disclosed_stdin.exists());
        assert!(wait_for_registry_idle(Arc::clone(&registry), Duration::from_secs(1)).await);
        let registry = registry.lock().unwrap();
        assert_eq!(registry.active_cleanup_operations, 0);
        assert_eq!(registry.cleanup_failures, 1);
        drop(registry);
        fs::remove_dir_all(&owned_path).unwrap();
        fs::remove_dir_all(&detached_path).unwrap();
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn temp_root_swapped_while_writing_adapter_files_never_selects_replacement_files() {
        let marker_dir = tempdir().unwrap();
        let provider_started = marker_dir.path().join("provider-started");
        let disclosed_stdin = marker_dir.path().join("disclosed-stdin");
        let outside_sentinel = marker_dir.path().join("outside-sentinel");
        fs::write(&outside_sentinel, b"outside-safe").unwrap();
        let (executable_dir, executable) = fake_executable(
            "#!/bin/sh\n/usr/bin/touch \"$PROVIDER_STARTED\"\n/bin/cat > \"$DISCLOSED_STDIN\"",
        );

        for (agent, first_file) in [
            (LocalAgentKind::Claude, "claude-settings.json"),
            (LocalAgentKind::Codex, "local-agent-output-schema.json"),
        ] {
            let registry = Arc::new(Mutex::new(ProcessGroupRegistry::default()));
            let mut capability = create_owned_temp_dir().unwrap();
            capability.replace_cleanup_registry_for_test(Arc::clone(&registry));
            let owned_path = capability.path().to_path_buf();
            let detached_path = owned_path.with_extension(format!("{first_file}.detached"));
            let interlock = super::TestSetupInterlock {
                before_create: Arc::new(std::sync::Barrier::new(2)),
                replacement_ready: Arc::new(std::sync::Barrier::new(2)),
            };
            capability.setup_interlock = Some(interlock.clone());
            let attacker_contents = format!("attacker-{first_file}").into_bytes();
            let attacker_contents_for_thread = attacker_contents.clone();
            let worker = std::thread::spawn({
                let owned_path = owned_path.clone();
                let detached_path = detached_path.clone();
                let first_file = first_file.to_string();
                move || {
                    interlock.before_create.wait();
                    fs::rename(&owned_path, &detached_path).unwrap();
                    fs::create_dir(&owned_path).unwrap();
                    fs::set_permissions(&owned_path, fs::Permissions::from_mode(0o700)).unwrap();
                    write_private_file(&owned_path.join(first_file), &attacker_contents_for_thread);
                    interlock.replacement_ready.wait();
                }
            });
            let resolved = ResolvedAgent {
                kind: agent,
                path: executable.clone(),
                path_label: format!("fake/{}", agent.executable_basename()),
            };
            let result = build_invocation(
                &resolved,
                &local_agent_request(agent, &format!("root-swap-while-writing-{first_file}")),
                &mut capability,
            );
            worker.join().unwrap();
            drop(capability);
            wait_for_empty_directory(&detached_path).await;

            assert_eq!(result.unwrap_err().code, "adapter_setup_failed");
            assert_eq!(
                fs::read(owned_path.join(first_file)).unwrap(),
                attacker_contents
            );
            assert_eq!(fs::read(&outside_sentinel).unwrap(), b"outside-safe");
            assert!(!provider_started.exists());
            assert!(!disclosed_stdin.exists());
            assert!(wait_for_registry_idle(Arc::clone(&registry), Duration::from_secs(1)).await);
            let registry = registry.lock().unwrap();
            assert_eq!(registry.active_cleanup_operations, 0);
            assert_eq!(registry.cleanup_failures, 1);
            drop(registry);
            fs::remove_dir_all(&owned_path).unwrap();
            fs::remove_dir_all(&detached_path).unwrap();
        }
        assert!(executable_dir.path().exists());
    }

    #[test]
    fn inherited_environment_is_allowlisted_and_adapter_overrides_win() {
        let home = tempdir().unwrap();
        let inherited = BTreeMap::from([
            (OsString::from("HOME"), home.path().as_os_str().to_owned()),
            (
                OsString::from("PATH"),
                OsString::from("/safe/bin:/usr/bin:/bin"),
            ),
            (OsString::from("LANG"), OsString::from("en_US.UTF-8")),
            (OsString::from("USER"), OsString::from("test")),
            (OsString::from("LOGNAME"), OsString::from("test")),
            (OsString::from("SHELL"), OsString::from("/bin/zsh")),
            (
                OsString::from("NODE_OPTIONS"),
                OsString::from("--require evil"),
            ),
            (
                OsString::from("CLAUDE_CONFIG_DIR"),
                OsString::from("/tmp/evil"),
            ),
            (
                OsString::from("PRIVATE_SOURCE"),
                OsString::from("captured source"),
            ),
        ]);
        let overrides = vec![
            (OsString::from("LANG"), OsString::from("ko_KR.UTF-8")),
            (
                OsString::from("OPENCODE_DISABLE_AUTOUPDATE"),
                OsString::from("true"),
            ),
        ];
        let cwd = Path::new("/private/owned-agent-dir");

        let environment = controlled_environment(inherited, &overrides, cwd).unwrap();

        assert_eq!(
            environment.get(&OsString::from("HOME")),
            Some(&home.path().canonicalize().unwrap().into_os_string())
        );
        assert_eq!(
            environment.get(&OsString::from("LANG")),
            Some(&OsString::from("ko_KR.UTF-8"))
        );
        assert_eq!(
            environment.get(&OsString::from("TMPDIR")),
            Some(&cwd.as_os_str().to_owned())
        );
        assert_eq!(
            environment.get(&OsString::from("PWD")),
            Some(&cwd.as_os_str().to_owned())
        );
        assert_eq!(
            environment.get(&OsString::from("OPENCODE_DISABLE_AUTOUPDATE")),
            Some(&OsString::from("true"))
        );
        assert!(!environment.contains_key(&OsString::from("NODE_OPTIONS")));
        assert!(!environment.contains_key(&OsString::from("CLAUDE_CONFIG_DIR")));
        assert!(!environment.contains_key(&OsString::from("PRIVATE_SOURCE")));
        assert!(!environment.contains_key(&OsString::from("USER")));
        assert!(!environment.contains_key(&OsString::from("LOGNAME")));
        assert!(!environment.contains_key(&OsString::from("SHELL")));
    }

    #[test]
    fn final_environment_uses_proof_path_and_per_agent_provider_allowlists() {
        let home = tempdir().unwrap();
        let inherited = BTreeMap::from([
            (OsString::from("HOME"), home.path().as_os_str().to_owned()),
            (
                OsString::from("PATH"),
                OsString::from("relative-attacker-bin"),
            ),
            (
                OsString::from("ANTHROPIC_API_KEY"),
                OsString::from("anthropic-secret"),
            ),
            (
                OsString::from("CODEX_API_KEY"),
                OsString::from("codex-secret"),
            ),
            (
                OsString::from("OPENAI_API_KEY"),
                OsString::from("openai-secret"),
            ),
            (
                OsString::from("HTTPS_PROXY"),
                OsString::from("http://proxy.invalid"),
            ),
            (
                OsString::from("NODE_OPTIONS"),
                OsString::from("--require attacker"),
            ),
            (
                OsString::from("CODEX_HOME"),
                OsString::from("/tmp/attacker"),
            ),
            (
                OsString::from("OPENCODE_CONFIG"),
                OsString::from("/tmp/attacker.json"),
            ),
        ]);
        let proof_path = OsStr::new("/usr/bin:/bin");
        let cwd = Path::new("/private/owned-agent-dir");

        let claude = controlled_environment_for_agent(
            inherited.clone(),
            &[],
            cwd,
            LocalAgentKind::Claude,
            proof_path,
        )
        .unwrap();
        let codex = controlled_environment_for_agent(
            inherited.clone(),
            &[],
            cwd,
            LocalAgentKind::Codex,
            proof_path,
        )
        .unwrap();
        let opencode = controlled_environment_for_agent(
            inherited,
            &owned_opencode_environment(),
            cwd,
            LocalAgentKind::Opencode,
            proof_path,
        )
        .unwrap();

        let expected_path = super::normalized_safe_path(proof_path).unwrap();
        for environment in [&claude, &codex, &opencode] {
            assert_eq!(environment.get(OsStr::new("PATH")), Some(&expected_path));
            assert!(!environment.contains_key(OsStr::new("NODE_OPTIONS")));
            assert!(!environment.contains_key(OsStr::new("OPENCODE_CONFIG")));
        }
        assert!(claude.contains_key(OsStr::new("ANTHROPIC_API_KEY")));
        assert!(claude.contains_key(OsStr::new("HTTPS_PROXY")));
        assert_eq!(
            claude.get(OsStr::new("CLAUDE_CODE_SUBPROCESS_ENV_SCRUB")),
            Some(&OsString::from("1"))
        );
        assert!(!claude.contains_key(OsStr::new("CODEX_API_KEY")));
        assert!(!claude.contains_key(OsStr::new("OPENAI_API_KEY")));

        assert!(codex.contains_key(OsStr::new("CODEX_API_KEY")));
        assert_eq!(
            codex.get(OsStr::new("CODEX_HOME")),
            Some(&OsString::from("codex-home"))
        );
        assert!(!codex.contains_key(OsStr::new("ANTHROPIC_API_KEY")));
        assert!(!codex.contains_key(OsStr::new("OPENAI_API_KEY")));
        assert!(!codex.contains_key(OsStr::new("HTTPS_PROXY")));

        assert!(opencode.contains_key(OsStr::new("ANTHROPIC_API_KEY")));
        assert!(opencode.contains_key(OsStr::new("OPENAI_API_KEY")));
        assert!(opencode.contains_key(OsStr::new("HTTPS_PROXY")));
        assert!(!opencode.contains_key(OsStr::new("CODEX_API_KEY")));
        assert_eq!(
            opencode.get(OsStr::new("XDG_DATA_HOME")),
            Some(&OsString::from("opencode-data"))
        );
        for name in [
            "OPENCODE_DISABLE_PROJECT_CONFIG",
            "OPENCODE_DISABLE_EXTERNAL_SKILLS",
            "OPENCODE_DISABLE_LSP_DOWNLOAD",
            "OPENCODE_DISABLE_MODELS_FETCH",
            "OPENCODE_DISABLE_SHARE",
        ] {
            assert_eq!(
                opencode.get(OsStr::new(name)),
                Some(&OsString::from("true")),
                "missing fixed OpenCode control {name}"
            );
        }
        for environment in [&claude, &codex, &opencode] {
            assert_eq!(
                environment.get(OsStr::new("TMPDIR")),
                Some(&OsString::from("."))
            );
            assert!(!environment.contains_key(OsStr::new("PWD")));
        }
    }

    #[test]
    fn claude_keeps_validated_home_without_overriding_keychain_config_lookup() {
        let home = tempdir().unwrap();
        let source_config = home.path().join(".claude");
        fs::create_dir(&source_config).unwrap();
        let environment = controlled_environment_for_agent(
            BTreeMap::from([
                (OsString::from("HOME"), home.path().as_os_str().to_owned()),
                (OsString::from("USER"), OsString::from("test-user")),
                (
                    OsString::from("PATH"),
                    OsString::from("/untrusted/path-that-must-not-win"),
                ),
            ]),
            &[],
            Path::new("/private/owned-agent-dir"),
            LocalAgentKind::Claude,
            OsStr::new("/usr/bin:/bin"),
        )
        .unwrap();

        assert!(!environment.contains_key(OsStr::new("CLAUDE_CONFIG_DIR")));
        assert_eq!(
            environment.get(OsStr::new("HOME")),
            Some(&home.path().canonicalize().unwrap().into_os_string())
        );
        assert_eq!(
            environment.get(OsStr::new("USER")),
            Some(&OsString::from("test-user"))
        );
        assert_eq!(
            environment.get(OsStr::new("XDG_CONFIG_HOME")),
            Some(&OsString::from("claude-xdg-config"))
        );
        assert_eq!(
            environment.get(OsStr::new("PATH")),
            Some(&OsString::from("/usr/bin:/bin"))
        );
        assert_eq!(
            environment.get(OsStr::new("CLAUDE_CODE_SAFE_MODE")),
            Some(&OsString::from("1"))
        );

        let explicit_environment = controlled_environment_for_agent(
            BTreeMap::from([
                (OsString::from("HOME"), home.path().as_os_str().to_owned()),
                (
                    OsString::from("CLAUDE_CONFIG_DIR"),
                    source_config.as_os_str().to_owned(),
                ),
            ]),
            &[],
            Path::new("/private/owned-agent-dir"),
            LocalAgentKind::Claude,
            OsStr::new("/usr/bin:/bin"),
        )
        .unwrap();
        assert_eq!(
            explicit_environment.get(OsStr::new("CLAUDE_CONFIG_DIR")),
            Some(&source_config.canonicalize().unwrap().into_os_string())
        );
    }

    #[test]
    fn final_environment_rejects_protected_overrides_without_leaking_values() {
        let secret = "private-loader-secret";
        let error = controlled_environment_for_agent(
            BTreeMap::new(),
            &[(OsString::from("NODE_OPTIONS"), OsString::from(secret))],
            Path::new("/private/owned-agent-dir"),
            LocalAgentKind::Claude,
            OsStr::new("/usr/bin:/bin"),
        )
        .unwrap_err();

        assert_eq!(error.code, "invalid_environment");
        assert!(!format!("{error:?}").contains(secret));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn claude_run_preserves_validated_home_with_private_xdg_roots() {
        let user_home = tempdir().unwrap();
        let claude_config = user_home.path().join(".claude");
        fs::create_dir(&claude_config).unwrap();
        let snapshot_dir = tempdir().unwrap();
        let snapshot = snapshot_dir.path().join("environment");
        let (executable_dir, executable) = fake_executable(
            "#!/bin/sh\n\
             [ \"$USER\" = test-user ] || exit 10\n\
             [ -z \"${CLAUDE_CONFIG_DIR+x}\" ] || exit 11\n\
             [ \"$XDG_CONFIG_HOME\" = claude-xdg-config ] || exit 12\n\
             [ \"$XDG_CACHE_HOME\" = claude-cache ] || exit 13\n\
             [ \"$XDG_DATA_HOME\" = claude-data ] || exit 14\n\
             [ \"$XDG_STATE_HOME\" = claude-state ] || exit 15\n\
             [ \"$CLAUDE_CODE_SAFE_MODE\" = 1 ] || exit 16\n\
             [ \"$CLAUDE_CODE_DISABLE_AUTO_MEMORY\" = 1 ] || exit 17\n\
             [ \"$CLAUDE_CODE_DISABLE_CLAUDE_MDS\" = 1 ] || exit 18\n\
             [ \"$CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS\" = 1 ] || exit 19\n\
             /usr/bin/printf '%s\\n' \"$HOME\" > \"$SNAPSHOT\"\n\
             /bin/cat >/dev/null\n\
             printf valid",
        );
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned_for_kind_with_environment(
            invocation(
                executable,
                &owned_path,
                vec![
                    (OsString::from("SNAPSHOT"), snapshot.as_os_str().to_owned()),
                    (OsString::from("CLAUDE_CODE_SAFE_MODE"), OsString::from("1")),
                    (
                        OsString::from("CLAUDE_CODE_DISABLE_AUTO_MEMORY"),
                        OsString::from("1"),
                    ),
                    (
                        OsString::from("CLAUDE_CODE_DISABLE_CLAUDE_MDS"),
                        OsString::from("1"),
                    ),
                    (
                        OsString::from("CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS"),
                        OsString::from("1"),
                    ),
                ],
                None,
            ),
            owned_temp,
            LocalAgentKind::Claude,
            BTreeMap::from([
                (
                    OsString::from("HOME"),
                    user_home.path().as_os_str().to_owned(),
                ),
                (OsString::from("USER"), OsString::from("test-user")),
            ]),
        )
        .unwrap();

        let mut output = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap();

        assert_eq!(output.stdout, b"valid");
        let captured = fs::read_to_string(&snapshot).unwrap();
        assert_eq!(
            captured,
            format!("{}\n", user_home.path().canonicalize().unwrap().display())
        );
        output.close_temp_dir().await.unwrap();
        assert!(!owned_path.exists());
        assert!(executable_dir.path().exists());
    }

    #[test]
    fn claude_custom_headers_require_an_explicit_provider_base_url() {
        let inherited = BTreeMap::from([(
            OsString::from("ANTHROPIC_CUSTOM_HEADERS"),
            OsString::from("authorization: private-header"),
        )]);
        let without_base = controlled_environment_for_agent(
            inherited.clone(),
            &[],
            Path::new("/private/owned-agent-dir"),
            LocalAgentKind::Claude,
            OsStr::new("/usr/bin:/bin"),
        )
        .unwrap();
        let mut with_empty_base_inherited = inherited.clone();
        with_empty_base_inherited.insert(OsString::from("ANTHROPIC_BASE_URL"), OsString::new());
        let with_empty_base = controlled_environment_for_agent(
            with_empty_base_inherited,
            &[],
            Path::new("/private/owned-agent-dir"),
            LocalAgentKind::Claude,
            OsStr::new("/usr/bin:/bin"),
        )
        .unwrap();
        let mut with_base_inherited = inherited;
        with_base_inherited.insert(
            OsString::from("ANTHROPIC_BASE_URL"),
            OsString::from("https://provider.invalid"),
        );
        let with_base = controlled_environment_for_agent(
            with_base_inherited,
            &[],
            Path::new("/private/owned-agent-dir"),
            LocalAgentKind::Claude,
            OsStr::new("/usr/bin:/bin"),
        )
        .unwrap();

        assert!(!without_base.contains_key(OsStr::new("ANTHROPIC_CUSTOM_HEADERS")));
        assert!(!with_empty_base.contains_key(OsStr::new("ANTHROPIC_CUSTOM_HEADERS")));
        assert!(with_base.contains_key(OsStr::new("ANTHROPIC_CUSTOM_HEADERS")));
    }

    #[test]
    fn claude_preserves_reviewed_routing_vars_and_gates_skip_auth_flags() {
        let mut inherited = BTreeMap::from([
            (
                OsString::from("ANTHROPIC_WORKSPACE_ID"),
                OsString::from("workspace"),
            ),
            (
                OsString::from("ANTHROPIC_BEDROCK_REGION_PREFIX"),
                OsString::from("us"),
            ),
            (
                OsString::from("ANTHROPIC_BEDROCK_SERVICE_TIER"),
                OsString::from("priority"),
            ),
            (
                OsString::from("ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION"),
                OsString::from("us-east-1"),
            ),
            (
                OsString::from("ANTHROPIC_MODEL"),
                OsString::from("primary-model"),
            ),
            (
                OsString::from("ANTHROPIC_DEFAULT_OPUS_MODEL"),
                OsString::from("opus-model"),
            ),
            (
                OsString::from("ANTHROPIC_DEFAULT_SONNET_MODEL"),
                OsString::from("sonnet-model"),
            ),
            (
                OsString::from("ANTHROPIC_DEFAULT_HAIKU_MODEL"),
                OsString::from("haiku-model"),
            ),
            (
                OsString::from("ANTHROPIC_DEFAULT_FABLE_MODEL"),
                OsString::from("fable-model"),
            ),
        ]);
        for (skip, use_name, base_name) in [
            (
                "CLAUDE_CODE_SKIP_BEDROCK_AUTH",
                "CLAUDE_CODE_USE_BEDROCK",
                "ANTHROPIC_BEDROCK_BASE_URL",
            ),
            (
                "CLAUDE_CODE_SKIP_MANTLE_AUTH",
                "CLAUDE_CODE_USE_MANTLE",
                "ANTHROPIC_BEDROCK_MANTLE_BASE_URL",
            ),
            (
                "CLAUDE_CODE_SKIP_VERTEX_AUTH",
                "CLAUDE_CODE_USE_VERTEX",
                "ANTHROPIC_VERTEX_BASE_URL",
            ),
            (
                "CLAUDE_CODE_SKIP_FOUNDRY_AUTH",
                "CLAUDE_CODE_USE_FOUNDRY",
                "ANTHROPIC_FOUNDRY_BASE_URL",
            ),
        ] {
            inherited.insert(OsString::from(skip), OsString::from("1"));
            inherited.insert(OsString::from(use_name), OsString::from("1"));
            inherited.insert(
                OsString::from(base_name),
                OsString::from("https://provider.invalid"),
            );
        }
        let environment = controlled_environment_for_agent(
            inherited,
            &[],
            Path::new("/private/owned-agent-dir"),
            LocalAgentKind::Claude,
            OsStr::new("/usr/bin:/bin"),
        )
        .unwrap();

        for name in [
            "ANTHROPIC_WORKSPACE_ID",
            "ANTHROPIC_BEDROCK_REGION_PREFIX",
            "ANTHROPIC_BEDROCK_SERVICE_TIER",
            "ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION",
            "ANTHROPIC_MODEL",
            "ANTHROPIC_DEFAULT_OPUS_MODEL",
            "ANTHROPIC_DEFAULT_SONNET_MODEL",
            "ANTHROPIC_DEFAULT_HAIKU_MODEL",
            "ANTHROPIC_DEFAULT_FABLE_MODEL",
            "CLAUDE_CODE_SKIP_BEDROCK_AUTH",
            "CLAUDE_CODE_SKIP_MANTLE_AUTH",
            "CLAUDE_CODE_SKIP_VERTEX_AUTH",
            "CLAUDE_CODE_SKIP_FOUNDRY_AUTH",
        ] {
            assert!(environment.contains_key(OsStr::new(name)), "missing {name}");
        }

        let ungated = controlled_environment_for_agent(
            BTreeMap::from([
                (
                    OsString::from("CLAUDE_CODE_SKIP_BEDROCK_AUTH"),
                    OsString::from("1"),
                ),
                (
                    OsString::from("CLAUDE_CODE_USE_BEDROCK"),
                    OsString::from("1"),
                ),
                (
                    OsString::from("ANTHROPIC_BEDROCK_BASE_URL"),
                    OsString::new(),
                ),
                (
                    OsString::from("CLAUDE_CODE_SKIP_VERTEX_AUTH"),
                    OsString::from("1"),
                ),
                (
                    OsString::from("ANTHROPIC_VERTEX_BASE_URL"),
                    OsString::from("https://provider.invalid"),
                ),
            ]),
            &[],
            Path::new("/private/owned-agent-dir"),
            LocalAgentKind::Claude,
            OsStr::new("/usr/bin:/bin"),
        )
        .unwrap();

        assert!(!ungated.contains_key(OsStr::new("CLAUDE_CODE_SKIP_BEDROCK_AUTH")));
        assert!(!ungated.contains_key(OsStr::new("CLAUDE_CODE_SKIP_VERTEX_AUTH")));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn opencode_uses_bounded_owned_auth_and_model_state_copies() {
        let home = tempdir().unwrap();
        let source_directory = home.path().join(".local/share/opencode");
        fs::create_dir_all(&source_directory).unwrap();
        let source_auth = source_directory.join("auth.json");
        let secret = br#"{"token":"private-opencode-auth"}"#;
        let mut source_options = fs::OpenOptions::new();
        source_options.write(true).create_new(true).mode(0o600);
        std::io::Write::write_all(&mut source_options.open(&source_auth).unwrap(), secret).unwrap();
        let source_state_directory = home.path().join(".local/state/opencode");
        fs::create_dir_all(&source_state_directory).unwrap();
        let source_model_state = source_state_directory.join("model.json");
        let model_state = br#"{"recent":[{"providerID":"configured-provider","modelID":"configured-model"}],"favorite":[],"variant":{}}"#;
        let mut state_options = fs::OpenOptions::new();
        state_options.write(true).create_new(true).mode(0o600);
        std::io::Write::write_all(
            &mut state_options.open(&source_model_state).unwrap(),
            model_state,
        )
        .unwrap();
        let (executable_dir, executable) = fake_executable(
            "#!/bin/sh\n\
             /bin/cat >/dev/null\n\
             [ \"$XDG_CONFIG_HOME\" = opencode-config ] || exit 11\n\
             [ \"$XDG_CACHE_HOME\" = opencode-cache ] || exit 12\n\
             [ \"$XDG_DATA_HOME\" = opencode-data ] || exit 13\n\
             [ \"$XDG_STATE_HOME\" = opencode-state ] || exit 14\n\
             [ \"$OPENCODE_DISABLE_CLAUDE_CODE\" = 1 ] || exit 15\n\
             [ \"$OPENCODE_DISABLE_DEFAULT_PLUGINS\" = true ] || exit 16\n\
             [ -f \"$XDG_DATA_HOME/opencode/auth.json\" ] || exit 17\n\
             [ -f \"$XDG_STATE_HOME/opencode/model.json\" ] || exit 18\n\
             /bin/rm \"$XDG_DATA_HOME/opencode/auth.json\"\n\
             printf '{\"rotated\":true}' > \"$XDG_DATA_HOME/opencode/auth.json\"\n\
             /bin/chmod 600 \"$XDG_DATA_HOME/opencode/auth.json\"\n\
             printf isolated",
        );
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned_for_kind_with_environment(
            invocation(executable, &owned_path, Vec::new(), None),
            owned_temp,
            LocalAgentKind::Opencode,
            BTreeMap::from([
                (OsString::from("HOME"), home.path().as_os_str().to_owned()),
                (
                    OsString::from("XDG_CONFIG_HOME"),
                    OsString::from("/tmp/attacker"),
                ),
            ]),
        )
        .unwrap();
        for directory in [
            "opencode-config",
            "opencode-cache",
            "opencode-data",
            "opencode-state",
            "opencode-data/opencode",
            "opencode-state/opencode",
        ] {
            assert_eq!(
                fs::metadata(owned_path.join(directory))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
        let copied_auth = owned_path.join("opencode-data/opencode/auth.json");
        assert_eq!(fs::read(&copied_auth).unwrap(), secret);
        assert_eq!(
            fs::metadata(&copied_auth).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(!format!("{prepared:?}").contains("private-opencode-auth"));
        let copied_model_state = owned_path.join("opencode-state/opencode/model.json");
        assert_eq!(fs::read(&copied_model_state).unwrap(), model_state);
        assert_eq!(
            fs::metadata(&copied_model_state)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );

        let mut output = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap();

        assert_eq!(output.stdout, b"isolated");
        assert_eq!(fs::read(&source_auth).unwrap(), secret);
        assert_eq!(fs::read(&source_model_state).unwrap(), model_state);
        output.close_temp_dir().await.unwrap();
        assert!(!owned_path.exists());
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn workspace_path_swap_at_spawn_keeps_every_agent_on_the_retained_root_and_withholds_stdin()
     {
        let marker_dir = tempdir().unwrap();

        for agent in [
            LocalAgentKind::Claude,
            LocalAgentKind::Codex,
            LocalAgentKind::Opencode,
        ] {
            let snapshot = marker_dir
                .path()
                .join(format!("{}-snapshot", agent.executable_basename()));
            let disclosed_stdin = marker_dir
                .path()
                .join(format!("{}-stdin", agent.executable_basename()));
            let child_ready = marker_dir
                .path()
                .join(format!("{}-ready", agent.executable_basename()));
            let script = match agent {
                LocalAgentKind::Claude => {
                    "#!/bin/sh\n\
                     settings=\n\
                     while [ \"$#\" -gt 0 ]; do\n\
                       case \"$1\" in\n\
                         --settings) settings=$2; shift 2 ;;\n\
                         *) shift ;;\n\
                       esac\n\
                     done\n\
                     {\n\
                       printf 'cwd='; /bin/pwd\n\
                       printf '\\nroot='; /bin/cat workspace-marker\n\
                       printf '\\nsettings_arg=%s\\nsettings=' \"$settings\"; /bin/cat \"$settings\"\n\
                       printf '\\nhome='; /bin/cat \"$HOME/workspace-marker\"\n\
                       printf '\\nconfig='; /bin/cat \"$CLAUDE_CONFIG_DIR/workspace-marker\"\n\
                       printf '\\nxdg_config='; /bin/cat \"$XDG_CONFIG_HOME/workspace-marker\"\n\
                       printf '\\ncache='; /bin/cat \"$XDG_CACHE_HOME/workspace-marker\"\n\
                       printf '\\ndata='; /bin/cat \"$XDG_DATA_HOME/workspace-marker\"\n\
                       printf '\\nstate='; /bin/cat \"$XDG_STATE_HOME/workspace-marker\"\n\
                     } > \"$SNAPSHOT\"\n\
                     /usr/bin/touch \"$CHILD_READY\"\n\
                     input=$(/bin/cat)\n\
                     if [ -n \"$input\" ]; then printf '%s' \"$input\" > \"$DISCLOSED_STDIN\"; fi\n\
                     printf valid"
                }
                LocalAgentKind::Codex => {
                    "#!/bin/sh\n\
                     schema= result=\n\
                     while [ \"$#\" -gt 0 ]; do\n\
                       case \"$1\" in\n\
                         --output-schema) schema=$2; shift 2 ;;\n\
                         --output-last-message) result=$2; shift 2 ;;\n\
                         *) shift ;;\n\
                       esac\n\
                     done\n\
                     {\n\
                       printf 'cwd='; /bin/pwd\n\
                       printf '\\nroot='; /bin/cat workspace-marker\n\
                       printf '\\nschema_arg=%s\\nschema=' \"$schema\"; /bin/cat \"$schema\"\n\
                       printf '\\nresult_arg=%s\\ncodex=' \"$result\"; /bin/cat \"$CODEX_HOME/workspace-marker\"\n\
                     } > \"$SNAPSHOT\"\n\
                     printf child-result > \"$result\"\n\
                     /usr/bin/touch \"$CHILD_READY\"\n\
                     input=$(/bin/cat)\n\
                     if [ -n \"$input\" ]; then printf '%s' \"$input\" > \"$DISCLOSED_STDIN\"; fi\n\
                     printf valid"
                }
                LocalAgentKind::Opencode => {
                    "#!/bin/sh\n\
                     directory=\n\
                     while [ \"$#\" -gt 0 ]; do\n\
                       case \"$1\" in\n\
                         --dir) directory=$2; shift 2 ;;\n\
                         *) shift ;;\n\
                       esac\n\
                     done\n\
                     {\n\
                       printf 'cwd='; /bin/pwd\n\
                       printf '\\nroot='; /bin/cat workspace-marker\n\
                       printf '\\ndir_arg=%s\\nconfig=' \"$directory\"; /bin/cat \"$XDG_CONFIG_HOME/workspace-marker\"\n\
                       printf '\\ncache='; /bin/cat \"$XDG_CACHE_HOME/workspace-marker\"\n\
                       printf '\\ndata='; /bin/cat \"$XDG_DATA_HOME/workspace-marker\"\n\
                       printf '\\nstate='; /bin/cat \"$XDG_STATE_HOME/workspace-marker\"\n\
                       printf '\\nauth_parent='; /bin/cat \"$XDG_DATA_HOME/opencode/workspace-marker\"\n\
                     } > \"$SNAPSHOT\"\n\
                     /usr/bin/touch \"$CHILD_READY\"\n\
                     input=$(/bin/cat)\n\
                     if [ -n \"$input\" ]; then printf '%s' \"$input\" > \"$DISCLOSED_STDIN\"; fi\n\
                     printf valid"
                }
            };
            let (executable_dir, executable) = fake_executable(script);
            let resolved = ResolvedAgent {
                kind: agent,
                path: executable,
                path_label: format!("fake/{}", agent.executable_basename()),
            };
            let registry = Arc::new(Mutex::new(ProcessGroupRegistry::default()));
            let mut capability = create_owned_temp_dir().unwrap();
            capability.replace_cleanup_registry_for_test(Arc::clone(&registry));
            let owned_path = capability.path().to_path_buf();
            let detached_path =
                owned_path.with_extension(format!("{}-detached", agent.executable_basename()));
            let mut invocation = build_invocation(
                &resolved,
                &local_agent_request(agent, "workspace-path-swap-at-spawn"),
                &mut capability,
            )
            .unwrap();
            invocation.env.extend([
                (OsString::from("SNAPSHOT"), snapshot.as_os_str().to_owned()),
                (
                    OsString::from("CHILD_READY"),
                    child_ready.as_os_str().to_owned(),
                ),
                (
                    OsString::from("DISCLOSED_STDIN"),
                    disclosed_stdin.as_os_str().to_owned(),
                ),
            ]);
            let original_directories: &[&str] = match agent {
                LocalAgentKind::Claude => &[
                    "claude-home",
                    "claude-config",
                    "claude-xdg-config",
                    "claude-cache",
                    "claude-data",
                    "claude-state",
                ],
                LocalAgentKind::Codex => &["codex-home"],
                LocalAgentKind::Opencode => &[
                    "opencode-config",
                    "opencode-cache",
                    "opencode-data",
                    "opencode-state",
                    "opencode-data/opencode",
                ],
            };
            let mut prepared = prepare_owned_for_kind_with_environment(
                invocation,
                capability,
                agent,
                BTreeMap::new(),
            )
            .unwrap();
            prepared.replace_cleanup_registry_for_test(Arc::clone(&registry));
            fs::write(owned_path.join("workspace-marker"), b"original").unwrap();
            for directory in original_directories {
                fs::write(
                    owned_path.join(directory).join("workspace-marker"),
                    b"original",
                )
                .unwrap();
            }
            let interlock = super::TestWorkspaceSpawnInterlock {
                before_spawn: Arc::new(std::sync::Barrier::new(2)),
                replacement_ready: Arc::new(std::sync::Barrier::new(2)),
                spawn_returned: Arc::new(std::sync::Barrier::new(2)),
                child_ready: Arc::new(std::sync::Barrier::new(2)),
            };
            prepared.workspace_spawn_interlock = Some(interlock.clone());
            let swap_thread = std::thread::spawn({
                let owned_path = owned_path.clone();
                let detached_path = detached_path.clone();
                let child_ready = child_ready.clone();
                let original_directories = original_directories.to_vec();
                move || {
                    interlock.before_spawn.wait();
                    fs::rename(&owned_path, &detached_path).unwrap();
                    fs::create_dir(&owned_path).unwrap();
                    fs::set_permissions(&owned_path, fs::Permissions::from_mode(0o700)).unwrap();
                    fs::write(owned_path.join("workspace-marker"), b"alternate").unwrap();
                    for directory in original_directories {
                        let path = owned_path.join(directory);
                        fs::create_dir_all(&path).unwrap();
                        fs::write(path.join("workspace-marker"), b"alternate").unwrap();
                    }
                    match agent {
                        LocalAgentKind::Claude => write_private_file(
                            &owned_path.join("claude-settings.json"),
                            b"alternate-settings",
                        ),
                        LocalAgentKind::Codex => {
                            write_private_file(
                                &owned_path.join("local-agent-output-schema.json"),
                                b"alternate-schema",
                            );
                            write_private_file(
                                &owned_path.join("local-agent-result.json"),
                                b"alternate-result",
                            );
                        }
                        LocalAgentKind::Opencode => {}
                    }
                    interlock.replacement_ready.wait();
                    interlock.spawn_returned.wait();
                    let deadline = StdInstant::now() + Duration::from_secs(1);
                    while !child_ready.exists() {
                        assert!(
                            StdInstant::now() < deadline,
                            "fake child did not prove its workspace before stdin release"
                        );
                        std::thread::sleep(Duration::from_millis(1));
                    }
                    interlock.child_ready.wait();
                }
            });

            let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(2))
                .await
                .unwrap_err();
            swap_thread.join().unwrap();

            let snapshot_contents = fs::read_to_string(&snapshot).unwrap();
            assert!(
                snapshot_contents.contains(&format!("cwd={}", detached_path.display())),
                "{snapshot_contents}"
            );
            assert!(
                snapshot_contents.contains("root=original"),
                "{snapshot_contents}"
            );
            assert!(!snapshot_contents.contains("alternate"));
            match agent {
                LocalAgentKind::Claude => {
                    assert!(snapshot_contents.contains("settings_arg=claude-settings.json"));
                    assert!(snapshot_contents.contains("home=original"));
                    assert!(snapshot_contents.contains("config=original"));
                    assert!(snapshot_contents.contains("xdg_config=original"));
                    assert!(snapshot_contents.contains("cache=original"));
                    assert!(snapshot_contents.contains("data=original"));
                    assert!(snapshot_contents.contains("state=original"));
                    assert_eq!(
                        fs::read(owned_path.join("claude-settings.json")).unwrap(),
                        b"alternate-settings"
                    );
                }
                LocalAgentKind::Codex => {
                    assert!(
                        snapshot_contents.contains("schema_arg=local-agent-output-schema.json")
                    );
                    assert!(snapshot_contents.contains("result_arg=local-agent-result.json"));
                    assert!(snapshot_contents.contains("codex=original"));
                    assert_eq!(
                        fs::read(detached_path.join("local-agent-result.json")).unwrap(),
                        b"child-result"
                    );
                    assert_eq!(
                        fs::read(owned_path.join("local-agent-output-schema.json")).unwrap(),
                        b"alternate-schema"
                    );
                    assert_eq!(
                        fs::read(owned_path.join("local-agent-result.json")).unwrap(),
                        b"alternate-result"
                    );
                }
                LocalAgentKind::Opencode => {
                    assert!(snapshot_contents.contains("dir_arg=."));
                    assert!(snapshot_contents.contains("config=original"));
                    assert!(snapshot_contents.contains("cache=original"));
                    assert!(snapshot_contents.contains("data=original"));
                    assert!(snapshot_contents.contains("state=original"));
                    assert!(snapshot_contents.contains("auth_parent=original"));
                    assert_eq!(
                        fs::read(owned_path.join("opencode-data/opencode/workspace-marker"))
                            .unwrap(),
                        b"alternate"
                    );
                }
            }
            assert_eq!(error.code, "invalid_temp_directory");
            assert!(!disclosed_stdin.exists());
            assert_eq!(
                fs::read(owned_path.join("workspace-marker")).unwrap(),
                b"alternate"
            );
            assert!(detached_path.is_dir());
            assert_eq!(
                fs::read(detached_path.join("workspace-marker")).unwrap(),
                b"original"
            );
            assert!(wait_for_registry_idle(Arc::clone(&registry), Duration::from_secs(1)).await);
            let registry = registry.lock().unwrap();
            assert_eq!(registry.active_cleanup_operations, 0);
            assert_eq!(registry.cleanup_failures, 1);
            drop(registry);
            fs::remove_dir_all(&owned_path).unwrap();
            fs::remove_dir_all(&detached_path).unwrap();
            assert!(executable_dir.path().exists());
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn executable_path_swap_is_killed_before_private_stdin_is_released() {
        let marker_dir = tempdir().unwrap();
        let replacement_started = marker_dir.path().join("replacement-started");
        let disclosed_stdin = marker_dir.path().join("disclosed-stdin");
        let (executable_dir, executable) =
            fake_executable("#!/bin/sh\n/bin/cat >/dev/null\nprintf original");
        let replacement = executable_dir.path().join("replacement");
        fs::write(
            &replacement,
            b"#!/bin/sh\n/usr/bin/touch \"$REPLACEMENT_STARTED\"\nsecret=$(/bin/cat)\nif [ -n \"$secret\" ]; then /usr/bin/printf %s \"$secret\" > \"$DISCLOSED_STDIN\"; fi\nprintf replacement",
        )
        .unwrap();
        fs::set_permissions(&replacement, fs::Permissions::from_mode(0o700)).unwrap();
        let original_backup = executable_dir.path().join("original-backup");

        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let mut prepared = prepare_owned(
            invocation(
                executable.clone(),
                &owned_path,
                vec![
                    (
                        OsString::from("REPLACEMENT_STARTED"),
                        replacement_started.as_os_str().to_owned(),
                    ),
                    (
                        OsString::from("DISCLOSED_STDIN"),
                        disclosed_stdin.as_os_str().to_owned(),
                    ),
                ],
                None,
            ),
            owned_temp,
        )
        .unwrap();
        let interlock = super::TestSpawnInterlock {
            before_spawn: std::sync::Arc::new(std::sync::Barrier::new(2)),
            replacement_ready: std::sync::Arc::new(std::sync::Barrier::new(2)),
            spawn_returned: std::sync::Arc::new(std::sync::Barrier::new(2)),
            original_restored: std::sync::Arc::new(std::sync::Barrier::new(2)),
        };
        prepared.spawn_interlock = Some(interlock.clone());
        let replacement_observed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let swap_thread = std::thread::spawn({
            let executable = executable.clone();
            let replacement = replacement.clone();
            let original_backup = original_backup.clone();
            let replacement_started = replacement_started.clone();
            let replacement_observed = replacement_observed.clone();
            move || {
                interlock.before_spawn.wait();
                fs::rename(&executable, &original_backup).unwrap();
                fs::rename(&replacement, &executable).unwrap();
                interlock.replacement_ready.wait();
                interlock.spawn_returned.wait();
                let observation_deadline = StdInstant::now() + Duration::from_secs(1);
                while StdInstant::now() < observation_deadline {
                    if replacement_started.exists() {
                        replacement_observed.store(true, std::sync::atomic::Ordering::SeqCst);
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(1));
                }
                fs::rename(&executable, &replacement).unwrap();
                fs::rename(&original_backup, &executable).unwrap();
                interlock.original_restored.wait();
            }
        });

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(2))
            .await
            .unwrap_err();
        swap_thread.join().unwrap();

        assert_eq!(error.code, "invalid_executable");
        assert!(replacement_started.exists());
        assert!(replacement_observed.load(std::sync::atomic::Ordering::SeqCst));
        assert!(!disclosed_stdin.exists());
        assert!(!owned_path.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn opencode_rejects_symlinked_auth_without_reading_or_modifying_its_target() {
        let home = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let source_directory = home.path().join(".local/share/opencode");
        fs::create_dir_all(&source_directory).unwrap();
        let outside_auth = outside.path().join("auth.json");
        fs::write(&outside_auth, b"outside-private-auth").unwrap();
        std::os::unix::fs::symlink(&outside_auth, source_directory.join("auth.json")).unwrap();
        let (_executable_dir, executable) = fake_executable("#!/bin/sh\nexit 0");
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();

        let error = prepare_owned_for_kind_with_environment(
            invocation(executable, &owned_path, Vec::new(), None),
            owned_temp,
            LocalAgentKind::Opencode,
            BTreeMap::from([(OsString::from("HOME"), home.path().as_os_str().to_owned())]),
        )
        .unwrap_err();

        assert_eq!(error.code, "invalid_environment");
        assert_eq!(fs::read(outside_auth).unwrap(), b"outside-private-auth");
        wait_for_temp_path_removal(&owned_path).await;
        assert!(!owned_path.exists());
        assert!(!format!("{error:?}").contains("outside-private-auth"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn opencode_copies_auth_from_validated_custom_xdg_data_home_without_forwarding_it() {
        let home = tempdir().unwrap();
        let custom_data = tempdir().unwrap();
        let custom_auth_directory = custom_data.path().join("opencode");
        fs::create_dir(&custom_auth_directory).unwrap();
        let custom_auth = custom_auth_directory.join("auth.json");
        let secret = br#"{"token":"custom-xdg-auth"}"#;
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true).mode(0o600);
        std::io::Write::write_all(&mut options.open(&custom_auth).unwrap(), secret).unwrap();
        let (_executable_dir, executable) = fake_executable("#!/bin/sh\nexit 0");
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();

        let prepared = prepare_owned_for_kind_with_environment(
            invocation(executable, &owned_path, Vec::new(), None),
            owned_temp,
            LocalAgentKind::Opencode,
            BTreeMap::from([
                (OsString::from("HOME"), home.path().as_os_str().to_owned()),
                (
                    OsString::from("XDG_DATA_HOME"),
                    custom_data.path().as_os_str().to_owned(),
                ),
            ]),
        )
        .unwrap();

        assert_eq!(
            fs::read(owned_path.join("opencode-data/opencode/auth.json")).unwrap(),
            secret
        );
        assert!(!format!("{prepared:?}").contains("custom-xdg-auth"));
        drop(prepared);
        wait_for_temp_path_removal(&owned_path).await;
        assert!(!owned_path.exists());
        assert_eq!(fs::read(custom_auth).unwrap(), secret);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn opencode_rejects_oversized_auth_without_retaining_private_copies() {
        let home = tempdir().unwrap();
        let source_directory = home.path().join(".local/share/opencode");
        fs::create_dir_all(&source_directory).unwrap();
        let source_auth = source_directory.join("auth.json");
        let mut source_options = fs::OpenOptions::new();
        source_options.write(true).create_new(true).mode(0o600);
        std::io::Write::write_all(
            &mut source_options.open(&source_auth).unwrap(),
            &vec![b'x'; super::MAX_AGENT_PRIVATE_FILE_BYTES + 1],
        )
        .unwrap();
        let (_executable_dir, executable) = fake_executable("#!/bin/sh\nexit 0");
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();

        let error = prepare_owned_for_kind_with_environment(
            invocation(executable, &owned_path, Vec::new(), None),
            owned_temp,
            LocalAgentKind::Opencode,
            BTreeMap::from([(OsString::from("HOME"), home.path().as_os_str().to_owned())]),
        )
        .unwrap_err();

        assert_eq!(error.code, "invalid_environment");
        wait_for_temp_path_removal(&owned_path).await;
        assert!(!owned_path.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn codex_copies_auth_from_a_validated_symlinked_config_directory() {
        let home = tempdir().unwrap();
        let config_root = tempdir().unwrap();
        let source_directory = config_root.path().join("codex-config");
        fs::create_dir(&source_directory).unwrap();
        fs::set_permissions(&source_directory, fs::Permissions::from_mode(0o700)).unwrap();
        let source_auth = source_directory.join("auth.json");
        let secret = br#"{"tokens":{"access_token":"symlinked-codex-auth"}}"#;
        let mut source_options = fs::OpenOptions::new();
        source_options.write(true).create_new(true).mode(0o600);
        std::io::Write::write_all(&mut source_options.open(&source_auth).unwrap(), secret).unwrap();
        std::os::unix::fs::symlink(&source_directory, home.path().join(".codex")).unwrap();
        let (_executable_dir, executable) = fake_executable("#!/bin/sh\nexit 0");
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();

        let prepared = prepare_owned_for_kind_with_environment(
            invocation(executable, &owned_path, Vec::new(), None),
            owned_temp,
            LocalAgentKind::Codex,
            BTreeMap::from([(OsString::from("HOME"), home.path().as_os_str().to_owned())]),
        )
        .unwrap();

        assert_eq!(
            fs::read(owned_path.join("codex-home/auth.json")).unwrap(),
            secret
        );
        assert!(!format!("{prepared:?}").contains("symlinked-codex-auth"));
        drop(prepared);
        wait_for_temp_path_removal(&owned_path).await;
        assert!(!owned_path.exists());
        assert_eq!(fs::read(source_auth).unwrap(), secret);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn codex_uses_a_private_home_with_only_an_owned_auth_copy() {
        let home = tempdir().unwrap();
        let source_directory = home.path().join(".codex");
        fs::create_dir(&source_directory).unwrap();
        fs::set_permissions(&source_directory, fs::Permissions::from_mode(0o700)).unwrap();
        let source_auth = source_directory.join("auth.json");
        let source_agents = source_directory.join("AGENTS.md");
        let secret = br#"{"tokens":{"access_token":"private-codex-auth"}}"#;
        let mut source_options = fs::OpenOptions::new();
        source_options.write(true).create_new(true).mode(0o600);
        std::io::Write::write_all(&mut source_options.open(&source_auth).unwrap(), secret).unwrap();
        fs::write(&source_agents, b"global rules must not be copied").unwrap();
        let (executable_dir, executable) = fake_executable(
            "#!/bin/sh\n\
             /bin/cat >/dev/null\n\
             [ \"$CODEX_HOME\" = codex-home ] || exit 21\n\
             [ -f \"$CODEX_HOME/auth.json\" ] || exit 22\n\
             [ ! -e \"$CODEX_HOME/AGENTS.md\" ] || exit 23\n\
             printf isolated",
        );
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned_for_kind_with_environment(
            invocation(executable, &owned_path, Vec::new(), None),
            owned_temp,
            LocalAgentKind::Codex,
            BTreeMap::from([(OsString::from("HOME"), home.path().as_os_str().to_owned())]),
        )
        .unwrap();
        let copied_auth = owned_path.join("codex-home/auth.json");
        assert_eq!(
            fs::metadata(owned_path.join("codex-home"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        assert_eq!(fs::read(&copied_auth).unwrap(), secret);
        assert_eq!(
            fs::metadata(&copied_auth).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(!owned_path.join("codex-home/AGENTS.md").exists());
        assert!(!format!("{prepared:?}").contains("private-codex-auth"));

        let mut output = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap();

        assert_eq!(output.stdout, b"isolated");
        assert_eq!(
            fs::read(&source_agents).unwrap(),
            b"global rules must not be copied"
        );
        output.close_temp_dir().await.unwrap();
        assert!(!owned_path.exists());
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn codex_rejects_symlinked_auth_without_reading_its_target() {
        let home = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let source_directory = home.path().join(".codex");
        fs::create_dir(&source_directory).unwrap();
        let outside_auth = outside.path().join("auth.json");
        fs::write(&outside_auth, br#"{"token":"outside-private-auth"}"#).unwrap();
        std::os::unix::fs::symlink(&outside_auth, source_directory.join("auth.json")).unwrap();
        let (_executable_dir, executable) = fake_executable("#!/bin/sh\nexit 0");
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();

        let error = prepare_owned_for_kind_with_environment(
            invocation(executable, &owned_path, Vec::new(), None),
            owned_temp,
            LocalAgentKind::Codex,
            BTreeMap::from([(OsString::from("HOME"), home.path().as_os_str().to_owned())]),
        )
        .unwrap_err();

        assert_eq!(error.code, "invalid_environment");
        assert_eq!(
            fs::read(outside_auth).unwrap(),
            br#"{"token":"outside-private-auth"}"#
        );
        wait_for_temp_path_removal(&owned_path).await;
        assert!(!owned_path.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn malformed_or_oversized_codex_auth_fails_closed_without_private_copies() {
        for bytes in [
            b"[] trailing".to_vec(),
            vec![b'x'; super::MAX_AGENT_PRIVATE_FILE_BYTES + 1],
        ] {
            let home = tempdir().unwrap();
            let source_directory = home.path().join(".codex");
            fs::create_dir(&source_directory).unwrap();
            let mut source_options = fs::OpenOptions::new();
            source_options.write(true).create_new(true).mode(0o600);
            std::io::Write::write_all(
                &mut source_options
                    .open(source_directory.join("auth.json"))
                    .unwrap(),
                &bytes,
            )
            .unwrap();
            let (_executable_dir, executable) = fake_executable("#!/bin/sh\nexit 0");
            let owned_temp = create_owned_temp_dir().unwrap();
            let owned_path = owned_temp.path().to_path_buf();

            let error = prepare_owned_for_kind_with_environment(
                invocation(executable, &owned_path, Vec::new(), None),
                owned_temp,
                LocalAgentKind::Codex,
                BTreeMap::from([(OsString::from("HOME"), home.path().as_os_str().to_owned())]),
            )
            .unwrap_err();

            assert_eq!(error.code, "invalid_environment");
            wait_for_temp_path_removal(&owned_path).await;
            assert!(!owned_path.exists());
            assert!(!format!("{error:?}").contains("trailing"));
        }
    }

    #[cfg(unix)]
    #[test]
    fn inherited_path_is_canonical_deduplicated_and_limited_to_safe_directories() {
        let root = tempdir().unwrap();
        let safe = root.path().join("safe-bin");
        let unsafe_writable = root.path().join("writable-bin");
        let not_a_directory = root.path().join("plain-file");
        let safe_alias = root.path().join("safe-alias");
        fs::create_dir(&safe).unwrap();
        fs::create_dir(&unsafe_writable).unwrap();
        fs::write(&not_a_directory, b"not a directory").unwrap();
        fs::set_permissions(&safe, fs::Permissions::from_mode(0o755)).unwrap();
        fs::set_permissions(&unsafe_writable, fs::Permissions::from_mode(0o777)).unwrap();
        std::os::unix::fs::symlink(&safe, &safe_alias).unwrap();
        let inherited_path = env::join_paths([
            PathBuf::new(),
            PathBuf::from("relative-bin"),
            safe_alias,
            safe.clone(),
            unsafe_writable,
            not_a_directory,
            root.path().join("missing"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
        ])
        .unwrap();
        let inherited = BTreeMap::from([(OsString::from("PATH"), inherited_path)]);

        let environment =
            controlled_environment(inherited, &[], Path::new("/private/owned-agent-dir")).unwrap();
        let normalized =
            env::split_paths(environment.get(&OsString::from("PATH")).unwrap()).collect::<Vec<_>>();
        let mut expected = vec![safe.canonicalize().unwrap()];
        for system_directory in [PathBuf::from("/usr/bin"), PathBuf::from("/bin")] {
            let canonical = system_directory.canonicalize().unwrap();
            if !expected.contains(&canonical) {
                expected.push(canonical);
            }
        }

        assert_eq!(normalized, expected);
    }

    #[cfg(unix)]
    #[test]
    fn inherited_path_accepts_a_user_owned_group_writable_directory() {
        let root = tempdir().unwrap();
        let homebrew_bin = root.path().join("homebrew-bin");
        fs::create_dir(&homebrew_bin).unwrap();
        fs::set_permissions(&homebrew_bin, fs::Permissions::from_mode(0o775)).unwrap();
        let inherited =
            BTreeMap::from([(OsString::from("PATH"), homebrew_bin.as_os_str().to_owned())]);

        let environment =
            controlled_environment(inherited, &[], Path::new("/private/owned-agent-dir")).unwrap();

        assert_eq!(
            env::split_paths(environment.get(OsStr::new("PATH")).unwrap()).collect::<Vec<_>>(),
            vec![homebrew_bin.canonicalize().unwrap()]
        );
    }

    #[cfg(unix)]
    #[test]
    fn inherited_path_without_any_safe_directory_fails_closed() {
        let root = tempdir().unwrap();
        let unsafe_writable = root.path().join("writable-bin");
        fs::create_dir(&unsafe_writable).unwrap();
        fs::set_permissions(&unsafe_writable, fs::Permissions::from_mode(0o777)).unwrap();
        let inherited = BTreeMap::from([(
            OsString::from("PATH"),
            env::join_paths([PathBuf::new(), PathBuf::from("relative"), unsafe_writable]).unwrap(),
        )]);

        let error = controlled_environment(inherited, &[], Path::new("/private/owned-agent-dir"))
            .unwrap_err();

        assert_eq!(error.code, "invalid_environment");
    }

    #[cfg(unix)]
    #[test]
    fn inherited_path_rejects_a_safe_leaf_below_a_writable_ancestor() {
        let root = tempdir().unwrap();
        let writable_parent = root.path().join("writable-parent");
        let safe_leaf = writable_parent.join("safe-leaf");
        fs::create_dir(&writable_parent).unwrap();
        fs::create_dir(&safe_leaf).unwrap();
        fs::set_permissions(&writable_parent, fs::Permissions::from_mode(0o777)).unwrap();
        fs::set_permissions(&safe_leaf, fs::Permissions::from_mode(0o755)).unwrap();
        let inherited =
            BTreeMap::from([(OsString::from("PATH"), safe_leaf.as_os_str().to_owned())]);

        let error = controlled_environment(inherited, &[], Path::new("/private/owned-agent-dir"))
            .unwrap_err();

        assert_eq!(error.code, "invalid_environment");
    }

    #[cfg(unix)]
    #[test]
    fn inherited_home_rejects_a_user_owned_leaf_below_a_writable_ancestor() {
        let root = tempdir().unwrap();
        let writable_parent = root.path().join("writable-parent");
        let home = writable_parent.join("home");
        fs::create_dir(&writable_parent).unwrap();
        fs::create_dir(&home).unwrap();
        fs::set_permissions(&writable_parent, fs::Permissions::from_mode(0o777)).unwrap();
        fs::set_permissions(&home, fs::Permissions::from_mode(0o700)).unwrap();
        let inherited = BTreeMap::from([
            (OsString::from("HOME"), home.as_os_str().to_owned()),
            (OsString::from("PATH"), OsString::from("/usr/bin:/bin")),
        ]);

        let error = controlled_environment(inherited, &[], Path::new("/private/owned-agent-dir"))
            .unwrap_err();

        assert_eq!(error.code, "invalid_environment");
    }

    #[cfg(unix)]
    #[test]
    fn inherited_home_rejects_a_group_writable_user_owned_home() {
        let root = tempdir().unwrap();
        let home = root.path().join("home");
        fs::create_dir(&home).unwrap();
        fs::set_permissions(&home, fs::Permissions::from_mode(0o770)).unwrap();
        let inherited = BTreeMap::from([
            (OsString::from("HOME"), home.as_os_str().to_owned()),
            (OsString::from("PATH"), OsString::from("/usr/bin:/bin")),
        ]);

        let error = controlled_environment(inherited, &[], Path::new("/private/owned-agent-dir"))
            .unwrap_err();

        assert_eq!(error.code, "invalid_environment");
    }

    #[cfg(unix)]
    #[test]
    fn preparation_requires_user_only_owned_paths_and_bounded_stdin() {
        let (_executable_dir, executable) = fake_executable("#!/bin/sh\nexit 0");
        let owned_temp = create_owned_temp_dir().unwrap();
        assert_eq!(
            fs::metadata(owned_temp.path())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        let mut oversized = invocation(executable, owned_temp.path(), Vec::new(), None);
        oversized.stdin = vec![b'x'; MAX_PROCESS_STDIN_BYTES + 1];
        let error = prepare_owned(oversized, owned_temp).unwrap_err();
        assert_eq!(error.code, "request_too_large");
    }

    #[cfg(unix)]
    fn process_exists(pid: i32) -> bool {
        if unsafe { libc::kill(pid, 0) } != 0 {
            return false;
        }
        #[cfg(target_os = "macos")]
        {
            let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::uninit();
            let info_size = std::mem::size_of::<libc::proc_bsdinfo>();
            let read = unsafe {
                libc::proc_pidinfo(
                    pid,
                    libc::PROC_PIDTBSDINFO,
                    0,
                    info.as_mut_ptr().cast(),
                    i32::try_from(info_size).unwrap(),
                )
            };
            read == i32::try_from(info_size).unwrap()
                && unsafe { info.assume_init() }.pbi_status != libc::SZOMB
        }
        #[cfg(not(target_os = "macos"))]
        {
            true
        }
    }
}
