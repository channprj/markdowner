use std::{
    collections::{BTreeMap, HashSet},
    env,
    ffi::{OsStr, OsString},
    fs::{self, File, OpenOptions},
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio_util::sync::CancellationToken;

#[cfg(unix)]
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};

use super::{
    LocalAgentError, LocalAgentKind, LocalAgentStatus, LocalAgentStatusSource,
    OPEN_CODE_OWNED_AGENT, ResolvedAgent, owned_opencode_environment,
    process::{
        OwnedTempCapability, RegisteredProcessGroup, RejectedProcessGroup, controlled_environment,
        create_owned_temp_dir,
    },
};

pub(super) const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const STATUS_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(30);
const PROBE_STDOUT_LIMIT: usize = 256 * 1024;
const PROBE_STDERR_LIMIT: usize = 64 * 1024;
const PROBE_CLEANUP_TIMEOUT: Duration = Duration::from_secs(2);
const LOGIN_SHELL_PATH_LIMIT: usize = 64 * 1024;
const LOGIN_SHELL_PATH_BEGIN: &str = "__MARKDOWNER_PATH_BEGIN_7F3A9C2E__";
const LOGIN_SHELL_PATH_END: &str = "__MARKDOWNER_PATH_END_7F3A9C2E__";
const LOGIN_SHELL_PATH_COMMAND: &str = "printf '\\n%s\\n%s\\n%s\\n' '__MARKDOWNER_PATH_BEGIN_7F3A9C2E__' \"$PATH\" '__MARKDOWNER_PATH_END_7F3A9C2E__'";
const MAX_EXECUTABLE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_SHEBANG_BYTES: usize = 512;

pub(super) const CAPABILITY_PROBE_TIMEOUT_REASON: &str = "Capability probe timed out.";
const CLAUDE_FLAGS_REASON: &str = "Required Claude Code safety flags are unavailable.";
const CODEX_FLAGS_REASON: &str = "Required Codex safety flags are unavailable.";
const CODEX_FEATURES_REASON: &str = "Codex feature restrictions could not be verified.";
const OPEN_CODE_FLAGS_REASON: &str = "Required OpenCode safety flags are unavailable.";
const OPEN_CODE_PERMISSIONS_REASON: &str = "OpenCode permissions are not fully denied.";

pub(super) const CODEX_DENIED_FEATURES: &[&str] = &[
    "apps",
    "auth_elicitation",
    "browser_use",
    "browser_use_external",
    "browser_use_full_cdp_access",
    "chronicle",
    "code_mode",
    "code_mode_host",
    "computer_use",
    "enable_mcp_apps",
    "goals",
    "guardian_approval",
    "hooks",
    "image_generation",
    "in_app_browser",
    "in_app_chat",
    "in_app_dictation",
    "in_app_updates",
    "memories",
    "multi_agent",
    "multi_agent_v2",
    "plugin_sharing",
    "plugins",
    "recommended_plugins",
    "remote_plugin",
    "shell_snapshot",
    "shell_tool",
    "skill_mcp_dependency_install",
    "skill_search",
    "standalone_web_search",
    "tool_call_mcp_elicitation",
    "tool_suggest",
    "unified_exec",
    "view_image",
    "workspace_dependencies",
];

pub(super) const PASSIVE_CODEX_FEATURES: &[&str] = &[
    "collaboration_modes",
    "enable_request_compression",
    "fast_mode",
    "item_ids",
    "mentions_v2",
    "personality",
    "remote_compaction_v2",
    "resize_all_images",
    "sqlite",
    "steer",
    "terminal_resize_reflow",
    "tool_search_always_defer_mcp_tools",
    "tui_app_server",
    "unbounded_connection_retries",
];

const CLAUDE_REQUIRED_FLAGS: &[&str] = &[
    "--safe-mode",
    "--setting-sources",
    "--settings",
    "--disable-slash-commands",
    "--print",
    "--tools",
    "--allowedTools",
    "--permission-mode",
    "--strict-mcp-config",
    "--mcp-config",
    "--no-session-persistence",
    "--output-format",
    "--json-schema",
];

const CODEX_REQUIRED_FLAGS: &[&str] = &[
    "--strict-config",
    "--ignore-user-config",
    "--ignore-rules",
    "--sandbox",
    "--ephemeral",
    "--skip-git-repo-check",
    "--output-schema",
    "--output-last-message",
    "--disable",
    "-c",
];

const OPEN_CODE_REQUIRED_PERMISSIONS: &[&str] = &[
    "*",
    "read",
    "edit",
    "glob",
    "grep",
    "list",
    "bash",
    "task",
    "skill",
    "lsp",
    "question",
    "webfetch",
    "websearch",
    "external_directory",
    "todowrite",
    "doom_loop",
];

#[derive(Clone, PartialEq, Eq)]
pub(super) struct ProbeOutput {
    pub success: bool,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

pub(super) trait ProbeRunner {
    fn run(
        &self,
        executable: &Path,
        args: &[OsString],
        env: &[(OsString, OsString)],
    ) -> Result<ProbeOutput, LocalAgentError>;
}

pub(super) struct ExecutableProof {
    executable: ExecutableFileProof,
    interpreters: Vec<InterpreterProof>,
    environment_path: OsString,
}

impl ExecutableProof {
    #[cfg(test)]
    pub(super) fn capture(path: &Path) -> Result<Self, LocalAgentError> {
        let environment_path = sanitized_path_value(env::var_os("PATH").as_deref())?;
        Self::capture_with_constraints(path, environment_path, None, None)
    }

    fn capture_with_constraints(
        path: &Path,
        environment_path: OsString,
        cancellation: Option<&CancellationToken>,
        deadline: Option<Instant>,
    ) -> Result<Self, LocalAgentError> {
        ensure_probe_active(cancellation, deadline)?;
        let environment_path = normalized_environment_path(&environment_path)?;
        let executable = ExecutableFileProof::capture(path, cancellation, deadline)?;
        let interpreters =
            capture_interpreter_proofs(&executable, &environment_path, cancellation, deadline)?;
        executable.verify(path, cancellation, deadline)?;
        ensure_probe_active(cancellation, deadline)?;
        Ok(Self {
            executable,
            interpreters,
            environment_path,
        })
    }

    pub(super) fn verify_path(&self, path: &Path) -> Result<(), LocalAgentError> {
        self.verify_path_with_constraints(path, None, None)
    }

    pub(super) fn verify_path_with_constraints(
        &self,
        path: &Path,
        cancellation: Option<&CancellationToken>,
        deadline: Option<Instant>,
    ) -> Result<(), LocalAgentError> {
        ensure_probe_active(cancellation, deadline)?;
        self.executable.verify(path, cancellation, deadline)?;
        for interpreter in &self.interpreters {
            interpreter.verify(&self.environment_path, cancellation, deadline)?;
        }
        self.executable.verify(path, cancellation, deadline)?;
        ensure_probe_active(cancellation, deadline)
    }

    pub(super) fn environment_path(&self) -> &OsStr {
        &self.environment_path
    }
}

struct ExecutableFileProof {
    metadata: ExecutableMetadataIdentity,
    content_sha256: [u8; 32],
    content_prefix: Vec<u8>,
    original_handle: File,
}

impl ExecutableFileProof {
    fn capture(
        path: &Path,
        cancellation: Option<&CancellationToken>,
        deadline: Option<Instant>,
    ) -> Result<Self, LocalAgentError> {
        ensure_probe_active(cancellation, deadline)?;
        verify_safe_executable_ancestry(path)?;
        ensure_probe_active(cancellation, deadline)?;
        let mut original_handle = open_executable_no_follow(path)?;
        let metadata = ExecutableMetadataIdentity::capture(path, &original_handle)?;
        let (content_sha256, content_prefix) = executable_sha256_exact(
            &mut original_handle,
            metadata.length,
            MAX_SHEBANG_BYTES + 1,
            cancellation,
            deadline,
        )?;
        metadata.verify_handle_and_path(&original_handle, path)?;
        Ok(Self {
            metadata,
            content_sha256,
            content_prefix,
            original_handle,
        })
    }

    fn verify(
        &self,
        path: &Path,
        cancellation: Option<&CancellationToken>,
        deadline: Option<Instant>,
    ) -> Result<(), LocalAgentError> {
        ensure_probe_active(cancellation, deadline)?;
        verify_safe_executable_ancestry(path)?;
        self.metadata
            .verify_handle_and_path(&self.original_handle, path)?;
        let mut current_handle = open_executable_no_follow(path)?;
        self.metadata
            .verify_handle_and_path(&current_handle, path)?;
        let current_digest = executable_sha256_exact(
            &mut current_handle,
            self.metadata.length,
            0,
            cancellation,
            deadline,
        )?
        .0;
        if current_digest != self.content_sha256 {
            return Err(LocalAgentError::ProbeFailed);
        }
        self.metadata
            .verify_handle_and_path(&self.original_handle, path)?;
        self.metadata
            .verify_handle_and_path(&current_handle, path)?;
        verify_safe_executable_ancestry(path)?;
        ensure_probe_active(cancellation, deadline)
    }
}

struct InterpreterProof {
    requested_path: PathBuf,
    canonical_path: PathBuf,
    path_lookup: Option<&'static str>,
    executable: ExecutableFileProof,
}

impl InterpreterProof {
    fn capture(
        requested_path: PathBuf,
        path_lookup: Option<&'static str>,
        cancellation: Option<&CancellationToken>,
        deadline: Option<Instant>,
    ) -> Result<Self, LocalAgentError> {
        if !requested_path.is_absolute() {
            return Err(LocalAgentError::ProbeFailed);
        }
        let canonical_path = requested_path
            .canonicalize()
            .map_err(|_| LocalAgentError::ProbeFailed)?;
        if !canonical_path.is_absolute() || !is_executable_file(&canonical_path) {
            return Err(LocalAgentError::ProbeFailed);
        }
        let executable = ExecutableFileProof::capture(&canonical_path, cancellation, deadline)?;
        Ok(Self {
            requested_path,
            canonical_path,
            path_lookup,
            executable,
        })
    }

    fn verify(
        &self,
        environment_path: &OsStr,
        cancellation: Option<&CancellationToken>,
        deadline: Option<Instant>,
    ) -> Result<(), LocalAgentError> {
        if let Some(command) = self.path_lookup
            && resolve_interpreter_from_path(command, environment_path, cancellation, deadline)?
                != self.requested_path
        {
            return Err(LocalAgentError::ProbeFailed);
        }
        if self.requested_path.canonicalize().ok().as_ref() != Some(&self.canonical_path) {
            return Err(LocalAgentError::ProbeFailed);
        }
        self.executable
            .verify(&self.canonical_path, cancellation, deadline)
    }
}

const MAX_INTERPRETER_DEPTH: usize = 4;

struct ParsedShebang {
    interpreter: PathBuf,
    arguments: Vec<String>,
}

fn capture_interpreter_proofs(
    executable: &ExecutableFileProof,
    environment_path: &OsStr,
    cancellation: Option<&CancellationToken>,
    deadline: Option<Instant>,
) -> Result<Vec<InterpreterProof>, LocalAgentError> {
    let mut visited = HashSet::from([executable.metadata.canonical_path.clone()]);
    capture_interpreter_chain(
        executable,
        environment_path,
        cancellation,
        deadline,
        0,
        &mut visited,
    )
}

fn capture_interpreter_chain(
    executable: &ExecutableFileProof,
    environment_path: &OsStr,
    cancellation: Option<&CancellationToken>,
    deadline: Option<Instant>,
    depth: usize,
    visited: &mut HashSet<PathBuf>,
) -> Result<Vec<InterpreterProof>, LocalAgentError> {
    ensure_probe_active(cancellation, deadline)?;
    let Some(shebang) = parse_shebang_interpreter(&executable.content_prefix)? else {
        return Ok(Vec::new());
    };
    if depth >= MAX_INTERPRETER_DEPTH {
        return Err(LocalAgentError::ProbeFailed);
    }

    let interpreter =
        InterpreterProof::capture(shebang.interpreter.clone(), None, cancellation, deadline)?;
    if !visited.insert(interpreter.canonical_path.clone()) {
        return Err(LocalAgentError::ProbeFailed);
    }
    let system_environment_path = Path::new("/usr/bin/env")
        .canonicalize()
        .map_err(|_| LocalAgentError::ProbeFailed)?;
    if interpreter.canonical_path != system_environment_path {
        if parse_shebang_interpreter(&interpreter.executable.content_prefix)?.is_some() {
            return Err(LocalAgentError::ProbeFailed);
        }
        return Ok(vec![interpreter]);
    }

    if shebang.interpreter != Path::new("/usr/bin/env") {
        return Err(LocalAgentError::ProbeFailed);
    }
    let command = match shebang.arguments.as_slice() {
        [command] if command == "node" => "node",
        [command] if command == "bun" => "bun",
        _ => return Err(LocalAgentError::ProbeFailed),
    };
    if parse_shebang_interpreter(&interpreter.executable.content_prefix)?.is_some() {
        return Err(LocalAgentError::ProbeFailed);
    }

    let target_path =
        resolve_interpreter_from_path(command, environment_path, cancellation, deadline)?;
    let target = InterpreterProof::capture(target_path, Some(command), cancellation, deadline)?;
    if !visited.insert(target.canonical_path.clone()) {
        return Err(LocalAgentError::ProbeFailed);
    }
    let mut nested = capture_interpreter_chain(
        &target.executable,
        environment_path,
        cancellation,
        deadline,
        depth + 1,
        visited,
    )?;
    let mut proofs = vec![interpreter, target];
    proofs.append(&mut nested);
    Ok(proofs)
}

fn parse_shebang_interpreter(
    content_prefix: &[u8],
) -> Result<Option<ParsedShebang>, LocalAgentError> {
    if !content_prefix.starts_with(b"#!") {
        return Ok(None);
    }
    let shebang_window = &content_prefix[..content_prefix.len().min(MAX_SHEBANG_BYTES)];
    let line_end = shebang_window[2..]
        .iter()
        .position(|byte| matches!(*byte, b'#' | b'\n'))
        .map(|offset| offset + 2)
        .ok_or(LocalAgentError::ProbeFailed)?;
    let shebang = &shebang_window[2..line_end];
    if shebang.iter().any(|byte| {
        matches!(*byte, b'\0' | b'\r' | 0x7f) || (*byte < b' ' && !matches!(*byte, b' ' | b'\t'))
    }) {
        return Err(LocalAgentError::ProbeFailed);
    }
    let fields: Vec<&[u8]> = shebang
        .split(|byte| matches!(*byte, b' ' | b'\t'))
        .filter(|field| !field.is_empty())
        .collect();
    let Some(interpreter) = fields.first() else {
        return Err(LocalAgentError::ProbeFailed);
    };
    let interpreter =
        PathBuf::from(std::str::from_utf8(interpreter).map_err(|_| LocalAgentError::ProbeFailed)?);
    if !interpreter.is_absolute() {
        return Err(LocalAgentError::ProbeFailed);
    }
    let arguments = fields[1..]
        .iter()
        .map(|argument| {
            std::str::from_utf8(argument)
                .map(str::to_owned)
                .map_err(|_| LocalAgentError::ProbeFailed)
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Some(ParsedShebang {
        interpreter,
        arguments,
    }))
}

fn resolve_interpreter_from_path(
    command: &'static str,
    environment_path: &OsStr,
    cancellation: Option<&CancellationToken>,
    deadline: Option<Instant>,
) -> Result<PathBuf, LocalAgentError> {
    if !matches!(command, "node" | "bun") {
        return Err(LocalAgentError::ProbeFailed);
    }
    for directory in env::split_paths(environment_path) {
        ensure_probe_active(cancellation, deadline)?;
        if !directory.is_absolute() {
            return Err(LocalAgentError::ProbeFailed);
        }
        let candidate = directory.join(command);
        if is_executable_file(&candidate) {
            return Ok(candidate);
        }
    }
    Err(LocalAgentError::ProbeFailed)
}

struct ExecutableMetadataIdentity {
    canonical_path: PathBuf,
    length: u64,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
    #[cfg(unix)]
    owner: u32,
    #[cfg(unix)]
    mode: u32,
    #[cfg(unix)]
    links: u64,
    #[cfg(unix)]
    modified_seconds: i64,
    #[cfg(unix)]
    modified_nanoseconds: i64,
    #[cfg(unix)]
    changed_seconds: i64,
    #[cfg(unix)]
    changed_nanoseconds: i64,
}

#[cfg(unix)]
fn executable_leaf_is_trusted(owner: u32, mode: u32, effective_uid: u32) -> bool {
    (owner == 0 || owner == effective_uid) && mode & 0o111 != 0 && mode & 0o022 == 0
}

impl ExecutableMetadataIdentity {
    fn capture(path: &Path, handle: &File) -> Result<Self, LocalAgentError> {
        let path_metadata = fs::symlink_metadata(path).map_err(|_| LocalAgentError::ProbeFailed)?;
        if !path.is_absolute()
            || path_metadata.file_type().is_symlink()
            || !path_metadata.is_file()
            || path_metadata.len() > MAX_EXECUTABLE_BYTES
            || path.canonicalize().ok().as_deref() != Some(path)
        {
            return Err(LocalAgentError::ProbeFailed);
        }
        #[cfg(unix)]
        if !executable_leaf_is_trusted(path_metadata.uid(), path_metadata.mode(), unsafe {
            libc::geteuid()
        }) {
            return Err(LocalAgentError::ProbeFailed);
        }
        let identity = Self {
            canonical_path: path.to_path_buf(),
            length: path_metadata.len(),
            #[cfg(unix)]
            device: path_metadata.dev(),
            #[cfg(unix)]
            inode: path_metadata.ino(),
            #[cfg(unix)]
            owner: path_metadata.uid(),
            #[cfg(unix)]
            mode: path_metadata.mode(),
            #[cfg(unix)]
            links: path_metadata.nlink(),
            #[cfg(unix)]
            modified_seconds: path_metadata.mtime(),
            #[cfg(unix)]
            modified_nanoseconds: path_metadata.mtime_nsec(),
            #[cfg(unix)]
            changed_seconds: path_metadata.ctime(),
            #[cfg(unix)]
            changed_nanoseconds: path_metadata.ctime_nsec(),
        };
        identity.verify_handle_and_path(handle, path)?;
        Ok(identity)
    }

    fn verify_handle_and_path(&self, handle: &File, path: &Path) -> Result<(), LocalAgentError> {
        let path_metadata = fs::symlink_metadata(path).map_err(|_| LocalAgentError::ProbeFailed)?;
        let handle_metadata = handle
            .metadata()
            .map_err(|_| LocalAgentError::ProbeFailed)?;
        if path != self.canonical_path
            || path.canonicalize().ok().as_ref() != Some(&self.canonical_path)
            || !self.matches_metadata(&path_metadata)
            || !self.matches_metadata(&handle_metadata)
        {
            return Err(LocalAgentError::ProbeFailed);
        }
        Ok(())
    }

    fn matches_metadata(&self, metadata: &fs::Metadata) -> bool {
        if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() != self.length
        {
            return false;
        }
        #[cfg(unix)]
        {
            self.device == metadata.dev()
                && self.inode == metadata.ino()
                && self.owner == metadata.uid()
                && self.mode == metadata.mode()
                && self.links == metadata.nlink()
                && self.modified_seconds == metadata.mtime()
                && self.modified_nanoseconds == metadata.mtime_nsec()
                && self.changed_seconds == metadata.ctime()
                && self.changed_nanoseconds == metadata.ctime_nsec()
        }
        #[cfg(not(unix))]
        {
            true
        }
    }
}

fn open_executable_no_follow(path: &Path) -> Result<File, LocalAgentError> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    options.open(path).map_err(|_| LocalAgentError::ProbeFailed)
}

fn verify_safe_executable_ancestry(path: &Path) -> Result<(), LocalAgentError> {
    let parent = path.parent().ok_or(LocalAgentError::ProbeFailed)?;
    let normalized = normalized_environment_path(parent.as_os_str())?;
    let mut directories = env::split_paths(&normalized);
    if directories.next().as_deref() != Some(parent) || directories.next().is_some() {
        return Err(LocalAgentError::ProbeFailed);
    }
    Ok(())
}

#[cfg(test)]
fn executable_sha256<R: Read>(
    reader: &mut R,
    cancellation: Option<&CancellationToken>,
    deadline: Option<Instant>,
) -> Result<[u8; 32], LocalAgentError> {
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        ensure_probe_active(cancellation, deadline)?;
        let read = reader
            .read(&mut buffer)
            .map_err(|_| LocalAgentError::ProbeFailed)?;
        ensure_probe_active(cancellation, deadline)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().into())
}

fn executable_sha256_exact<R: Read>(
    reader: &mut R,
    expected_length: u64,
    prefix_limit: usize,
    cancellation: Option<&CancellationToken>,
    deadline: Option<Instant>,
) -> Result<([u8; 32], Vec<u8>), LocalAgentError> {
    let mut hasher = Sha256::new();
    let mut prefix = Vec::with_capacity(prefix_limit);
    let mut buffer = [0_u8; 64 * 1024];
    let mut remaining = expected_length;
    while remaining > 0 {
        ensure_probe_active(cancellation, deadline)?;
        let chunk_length = usize::try_from(remaining.min(buffer.len() as u64))
            .map_err(|_| LocalAgentError::ProbeFailed)?;
        let read = reader
            .read(&mut buffer[..chunk_length])
            .map_err(|_| LocalAgentError::ProbeFailed)?;
        ensure_probe_active(cancellation, deadline)?;
        if read == 0 {
            return Err(LocalAgentError::ProbeFailed);
        }
        remaining -= read as u64;
        let prefix_remaining = prefix_limit.saturating_sub(prefix.len());
        prefix.extend_from_slice(&buffer[..read.min(prefix_remaining)]);
        hasher.update(&buffer[..read]);
    }
    ensure_probe_active(cancellation, deadline)?;
    if reader
        .read(&mut buffer[..1])
        .map_err(|_| LocalAgentError::ProbeFailed)?
        != 0
    {
        return Err(LocalAgentError::ProbeFailed);
    }
    ensure_probe_active(cancellation, deadline)?;
    Ok((hasher.finalize().into(), prefix))
}

struct PinnedProbeRunner<'a, R> {
    inner: &'a R,
    proof: &'a ExecutableProof,
    cancellation: Option<&'a CancellationToken>,
    deadline: Option<Instant>,
}

impl<R: ProbeRunner> ProbeRunner for PinnedProbeRunner<'_, R> {
    fn run(
        &self,
        executable: &Path,
        args: &[OsString],
        environment: &[(OsString, OsString)],
    ) -> Result<ProbeOutput, LocalAgentError> {
        self.proof
            .verify_path_with_constraints(executable, self.cancellation, self.deadline)?;
        let mut environment = environment.to_vec();
        environment.retain(|(name, _)| name != OsStr::new("PATH"));
        environment.push((OsString::from("PATH"), self.proof.environment_path.clone()));
        let result = self.inner.run(executable, args, &environment);
        self.proof
            .verify_path_with_constraints(executable, self.cancellation, self.deadline)?;
        result
    }
}

struct BoundedProbeRunner;

struct DeadlineProbeRunner {
    deadline: Instant,
}

struct CancellableProbeRunner<'a> {
    cancellation: &'a CancellationToken,
    deadline: Instant,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReaderError {
    Io,
    TooLarge,
}

impl ProbeRunner for BoundedProbeRunner {
    fn run(
        &self,
        executable: &Path,
        args: &[OsString],
        environment: &[(OsString, OsString)],
    ) -> Result<ProbeOutput, LocalAgentError> {
        run_bounded_probe(executable, args, environment, None, None)
    }
}

impl ProbeRunner for DeadlineProbeRunner {
    fn run(
        &self,
        executable: &Path,
        args: &[OsString],
        environment: &[(OsString, OsString)],
    ) -> Result<ProbeOutput, LocalAgentError> {
        run_bounded_probe(executable, args, environment, None, Some(self.deadline))
    }
}

impl ProbeRunner for CancellableProbeRunner<'_> {
    fn run(
        &self,
        executable: &Path,
        args: &[OsString],
        environment: &[(OsString, OsString)],
    ) -> Result<ProbeOutput, LocalAgentError> {
        run_bounded_probe(
            executable,
            args,
            environment,
            Some(self.cancellation),
            Some(self.deadline),
        )
    }
}

fn run_bounded_probe(
    executable: &Path,
    args: &[OsString],
    environment: &[(OsString, OsString)],
    cancellation: Option<&CancellationToken>,
    command_deadline: Option<Instant>,
) -> Result<ProbeOutput, LocalAgentError> {
    ensure_probe_active(cancellation, command_deadline)?;
    let mut probe_directory =
        create_owned_temp_dir().map_err(|_| LocalAgentError::ProbeSpawnFailed)?;
    let cwd = probe_directory.path().to_path_buf();
    let environment = controlled_environment(env::vars_os().collect(), environment, &cwd)
        .map_err(|_| LocalAgentError::ProbeSpawnFailed)?;
    ensure_probe_active(cancellation, command_deadline)?;
    probe_directory
        .verify_path_identity()
        .map_err(|_| LocalAgentError::ProbeSpawnFailed)?;
    let mut command = Command::new(executable);
    command
        .args(args)
        .current_dir(cwd)
        .env_clear()
        .envs(environment)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_probe_process_group(&mut command);

    let mut child = command
        .spawn()
        .map_err(|_| LocalAgentError::ProbeSpawnFailed)?;
    if probe_directory.verify_path_identity().is_err() {
        let _ = child.kill();
        let _ = child.wait();
        return Err(LocalAgentError::ProbeSpawnFailed);
    }
    let mut process_group = match ProbeProcessGroup::register_child(&child) {
        ProbeProcessGroupRegistration::Registered(process_group) => process_group,
        ProbeProcessGroupRegistration::Rejected(mut rejected) => {
            rejected.terminate();
            let _ = child.kill();
            let _ = child.wait();
            drop(child);
            drop(probe_directory);
            let _ = rejected.terminate_and_confirm(PROBE_CLEANUP_TIMEOUT);
            drop(rejected);
            return Err(LocalAgentError::ProbeFailed);
        }
        ProbeProcessGroupRegistration::Invalid => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(LocalAgentError::ProbeFailed);
        }
    };
    if let Err(error) = ensure_probe_active(cancellation, command_deadline) {
        terminate_probe(&mut process_group, &mut child);
        return Err(error);
    }
    let Some(stdout) = child.stdout.take() else {
        terminate_probe(&mut process_group, &mut child);
        return Err(LocalAgentError::ProbeSpawnFailed);
    };
    let Some(stderr) = child.stderr.take() else {
        terminate_probe(&mut process_group, &mut child);
        return Err(LocalAgentError::ProbeSpawnFailed);
    };
    let stdout_receiver = spawn_capped_reader(stdout, PROBE_STDOUT_LIMIT);
    let stderr_receiver = spawn_capped_reader(stderr, PROBE_STDERR_LIMIT);
    let probe_deadline = Instant::now() + PROBE_TIMEOUT;
    let deadline = command_deadline.map_or(probe_deadline, |deadline| deadline.min(probe_deadline));

    let status = loop {
        if let Err(error) = ensure_probe_active(cancellation, Some(deadline)) {
            terminate_probe(&mut process_group, &mut child);
            return Err(error);
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => {
                thread::sleep(Duration::from_millis(10));
            }
            Ok(None) => {
                terminate_probe(&mut process_group, &mut child);
                return Err(LocalAgentError::ProbeTimedOut);
            }
            Err(_) => {
                terminate_probe(&mut process_group, &mut child);
                return Err(LocalAgentError::ProbeFailed);
            }
        }
    };

    let stdout = match receive_probe_output(stdout_receiver, deadline, cancellation) {
        Ok(stdout) => stdout,
        Err(error) => {
            terminate_probe(&mut process_group, &mut child);
            return Err(error);
        }
    };
    let stderr = match receive_probe_output(stderr_receiver, deadline, cancellation) {
        Ok(stderr) => stderr,
        Err(error) => {
            terminate_probe(&mut process_group, &mut child);
            return Err(error);
        }
    };
    if let Err(error) = ensure_probe_active(cancellation, Some(deadline)) {
        terminate_probe(&mut process_group, &mut child);
        return Err(error);
    }
    if !process_group.terminate_and_confirm(PROBE_CLEANUP_TIMEOUT) {
        return Err(LocalAgentError::ProbeFailed);
    }
    let output = ProbeOutput {
        success: status.success(),
        stdout,
        stderr,
    };
    probe_directory
        .close_blocking()
        .map_err(|_| LocalAgentError::ProbeSpawnFailed)?;
    Ok(output)
}

#[cfg(unix)]
fn configure_probe_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;

    command.process_group(0);
}

#[cfg(not(unix))]
fn configure_probe_process_group(_command: &mut Command) {}

struct ProbeProcessGroup(RegisteredProcessGroup);

enum ProbeProcessGroupRegistration {
    Registered(ProbeProcessGroup),
    Rejected(RejectedProcessGroup),
    Invalid,
}

impl ProbeProcessGroup {
    fn register_child(child: &std::process::Child) -> ProbeProcessGroupRegistration {
        let Some(process_group) = i32::try_from(child.id()).ok().filter(|pid| *pid > 0) else {
            return ProbeProcessGroupRegistration::Invalid;
        };
        match RegisteredProcessGroup::register(process_group) {
            Ok(registered) => {
                ProbeProcessGroupRegistration::Registered(ProbeProcessGroup(registered))
            }
            Err(rejected) => ProbeProcessGroupRegistration::Rejected(rejected),
        }
    }

    fn terminate(&self) {
        self.0.terminate();
    }

    fn terminate_and_confirm(&mut self, timeout: Duration) -> bool {
        self.0.terminate_and_confirm(timeout)
    }
}

fn terminate_probe(process_group: &mut ProbeProcessGroup, child: &mut std::process::Child) -> bool {
    process_group.terminate();
    let _ = child.kill();
    let _ = child.wait();
    process_group.terminate_and_confirm(PROBE_CLEANUP_TIMEOUT)
}

fn spawn_capped_reader<R>(
    mut reader: R,
    limit: usize,
) -> mpsc::Receiver<Result<Vec<u8>, ReaderError>>
where
    R: Read + Send + 'static,
{
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let mut bytes = Vec::with_capacity(limit.min(8192));
        let result = match reader
            .by_ref()
            .take((limit + 1) as u64)
            .read_to_end(&mut bytes)
        {
            Ok(_) if bytes.len() <= limit => Ok(bytes),
            Ok(_) => Err(ReaderError::TooLarge),
            Err(_) => Err(ReaderError::Io),
        };
        let _ = sender.send(result);
    });
    receiver
}

fn receive_probe_output(
    receiver: mpsc::Receiver<Result<Vec<u8>, ReaderError>>,
    deadline: Instant,
    cancellation: Option<&CancellationToken>,
) -> Result<Vec<u8>, LocalAgentError> {
    loop {
        ensure_probe_active(cancellation, Some(deadline))?;
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(LocalAgentError::ProbeTimedOut);
        }
        let wait = if cancellation.is_some() {
            remaining.min(Duration::from_millis(10))
        } else {
            remaining
        };
        match receiver.recv_timeout(wait) {
            Ok(Ok(bytes)) => return Ok(bytes),
            Ok(Err(ReaderError::TooLarge)) => {
                return Err(LocalAgentError::ProbeOutputTooLarge);
            }
            Ok(Err(ReaderError::Io)) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(LocalAgentError::ProbeFailed);
            }
            Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() >= deadline => {
                return Err(LocalAgentError::ProbeTimedOut);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }
}

fn ensure_probe_active(
    cancellation: Option<&CancellationToken>,
    deadline: Option<Instant>,
) -> Result<(), LocalAgentError> {
    if cancellation.is_some_and(CancellationToken::is_cancelled) {
        Err(LocalAgentError::run(
            "local_agent_cancelled",
            "The local agent request was cancelled.",
        ))
    } else if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
        Err(LocalAgentError::ProbeTimedOut)
    } else {
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct CapabilityEvaluation {
    compatible: bool,
    reason: Option<&'static str>,
}

impl CapabilityEvaluation {
    const fn compatible() -> Self {
        Self {
            compatible: true,
            reason: None,
        }
    }

    const fn incompatible(reason: &'static str) -> Self {
        Self {
            compatible: false,
            reason: Some(reason),
        }
    }

    fn into_result(self) -> Result<(), LocalAgentError> {
        if self.compatible {
            Ok(())
        } else {
            Err(LocalAgentError::Incompatible(self.reason.unwrap_or(
                "Capability restrictions could not be verified.",
            )))
        }
    }
}

pub fn discover_all() -> Vec<LocalAgentStatus> {
    let deadline = Instant::now() + STATUS_DISCOVERY_TIMEOUT;
    discover_all_with_runner_and_paths(
        &DeadlineProbeRunner { deadline },
        &markdowner_core::settings::LocalAgentExecutablePaths::default(),
        Some(deadline),
    )
}

pub(super) fn discover_all_with_paths(
    executable_paths: &markdowner_core::settings::LocalAgentExecutablePaths,
) -> Vec<LocalAgentStatus> {
    let deadline = Instant::now() + STATUS_DISCOVERY_TIMEOUT;
    discover_all_with_runner_and_paths(
        &DeadlineProbeRunner { deadline },
        executable_paths,
        Some(deadline),
    )
}

pub fn resolve_compatible_agent(kind: LocalAgentKind) -> Result<ResolvedAgent, LocalAgentError> {
    resolve_compatible_agent_with_runner(kind, &BoundedProbeRunner)
}

pub(super) fn resolve_compatible_agent_cancellable(
    kind: LocalAgentKind,
    manual_path: Option<&str>,
    cancellation: &CancellationToken,
    deadline: Instant,
) -> Result<(ResolvedAgent, ExecutableProof), LocalAgentError> {
    ensure_probe_active(Some(cancellation), Some(deadline))?;
    let runner = CancellableProbeRunner {
        cancellation,
        deadline,
    };
    let result = resolve_compatible_agent_with_runner_and_proof(
        kind,
        manual_path,
        &runner,
        Some(cancellation),
        Some(deadline),
    );
    ensure_probe_active(Some(cancellation), Some(deadline))?;
    result
}

fn discover_all_with_runner_and_paths(
    runner: &(impl ProbeRunner + Sync),
    executable_paths: &markdowner_core::settings::LocalAgentExecutablePaths,
    deadline: Option<Instant>,
) -> Vec<LocalAgentStatus> {
    let paths = current_search_path_directories_with_runner(runner);
    let environment_path = env::join_paths(&paths).unwrap_or_default();
    let home = env::var_os("HOME").map(PathBuf::from);
    thread::scope(|scope| {
        let probes = LocalAgentKind::ALL.map(|kind| {
            let manual_path = match kind {
                LocalAgentKind::Claude => &executable_paths.claude,
                LocalAgentKind::Codex => &executable_paths.codex,
                LocalAgentKind::Opencode => &executable_paths.opencode,
            };
            let paths = &paths;
            let environment_path = &environment_path;
            let home = home.as_deref();
            scope.spawn(move || {
                if manual_path.trim().is_empty() {
                    discover_automatic_kind_with_runner_and_deadline(
                        kind,
                        paths,
                        environment_path,
                        runner,
                        deadline,
                    )
                } else {
                    match resolve_candidate_from_paths(kind, Some(manual_path), home, paths) {
                        Ok((resolved, source)) => {
                            probe_resolved_agent_with_environment_path_and_deadline(
                                resolved,
                                environment_path,
                                runner,
                                source,
                                deadline,
                            )
                        }
                        Err(error) => {
                            unavailable_status(kind, error, Some(LocalAgentStatusSource::Manual))
                        }
                    }
                }
            })
        });
        LocalAgentKind::ALL
            .into_iter()
            .zip(probes)
            .map(|(kind, probe)| {
                probe.join().unwrap_or_else(|_| {
                    unavailable_status(kind, LocalAgentError::ProbeFailed, None)
                })
            })
            .collect()
    })
}

fn resolve_compatible_agent_with_runner(
    kind: LocalAgentKind,
    runner: &impl ProbeRunner,
) -> Result<ResolvedAgent, LocalAgentError> {
    let (resolved, _proof) =
        resolve_compatible_agent_with_runner_and_proof(kind, None, runner, None, None)?;
    Ok(resolved)
}

fn resolve_compatible_agent_with_runner_and_proof(
    kind: LocalAgentKind,
    manual_path: Option<&str>,
    runner: &impl ProbeRunner,
    cancellation: Option<&CancellationToken>,
    deadline: Option<Instant>,
) -> Result<(ResolvedAgent, ExecutableProof), LocalAgentError> {
    ensure_probe_active(cancellation, deadline)?;
    let paths = current_search_path_directories_with_runner(runner);
    let environment_path = env::join_paths(&paths).map_err(|_| LocalAgentError::ProbeFailed)?;
    let home = env::var_os("HOME").map(PathBuf::from);
    resolve_compatible_from_paths_with_runner_and_proof(
        kind,
        manual_path,
        runner,
        CompatibleResolutionContext {
            home: home.as_deref(),
            paths: &paths,
            environment_path,
            cancellation,
            deadline,
        },
    )
}

struct CompatibleResolutionContext<'a> {
    home: Option<&'a Path>,
    paths: &'a [PathBuf],
    environment_path: OsString,
    cancellation: Option<&'a CancellationToken>,
    deadline: Option<Instant>,
}

fn resolve_compatible_from_paths_with_runner_and_proof(
    kind: LocalAgentKind,
    manual_path: Option<&str>,
    runner: &impl ProbeRunner,
    context: CompatibleResolutionContext<'_>,
) -> Result<(ResolvedAgent, ExecutableProof), LocalAgentError> {
    let CompatibleResolutionContext {
        home,
        paths,
        environment_path,
        cancellation,
        deadline,
    } = context;
    let manual_configured = manual_path.is_some_and(|path| !path.trim().is_empty());
    if manual_configured {
        let (resolved, _) = resolve_candidate_from_paths(kind, manual_path, home, paths)?;
        return prove_compatible_resolved_agent(
            resolved,
            environment_path,
            runner,
            cancellation,
            deadline,
        );
    }

    let candidates = resolve_all_from_paths(kind, paths);
    let mut first_failure = None;
    for resolved in candidates {
        ensure_probe_active(cancellation, deadline)?;
        match prove_compatible_resolved_agent(
            resolved,
            environment_path.clone(),
            runner,
            cancellation,
            deadline,
        ) {
            Ok(compatible) => return Ok(compatible),
            Err(error) => {
                ensure_probe_active(cancellation, deadline)?;
                if first_failure.is_none() {
                    first_failure = Some(error);
                }
            }
        }
    }
    Err(first_failure.unwrap_or(LocalAgentError::NotInstalled))
}

fn prove_compatible_resolved_agent(
    resolved: ResolvedAgent,
    environment_path: OsString,
    runner: &impl ProbeRunner,
    cancellation: Option<&CancellationToken>,
    deadline: Option<Instant>,
) -> Result<(ResolvedAgent, ExecutableProof), LocalAgentError> {
    let proof = ExecutableProof::capture_with_constraints(
        &resolved.path,
        environment_path,
        cancellation,
        deadline,
    )?;
    probe_agent_with_proof(&resolved, &proof, runner, cancellation, deadline)?;
    proof.verify_path_with_constraints(&resolved.path, cancellation, deadline)?;
    Ok((resolved, proof))
}

fn current_search_path_directories_with_runner(runner: &impl ProbeRunner) -> Vec<PathBuf> {
    let gui_path = env::var_os("PATH");
    let home = env::var_os("HOME").map(PathBuf::from);
    let shell = env::var_os("SHELL").unwrap_or_else(|| OsString::from("/bin/sh"));
    let login_path = login_shell_path_value_with_runner(Path::new(&shell), runner).ok();
    let paths =
        automatic_search_directories(gui_path.as_deref(), login_path.as_deref(), home.as_deref());
    normalized_search_path_directories(paths).unwrap_or_default()
}

pub(super) fn login_shell_path_value() -> Option<OsString> {
    let shell = env::var_os("SHELL").unwrap_or_else(|| OsString::from("/bin/sh"));
    login_shell_path_value_with_runner(Path::new(&shell), &BoundedProbeRunner).ok()
}

fn login_shell_path_value_with_runner(
    shell: &Path,
    runner: &impl ProbeRunner,
) -> Result<OsString, LocalAgentError> {
    if !shell.is_absolute() {
        return Err(LocalAgentError::ProbeSpawnFailed);
    }
    let output = runner.run(
        shell,
        &[
            OsString::from("-l"),
            OsString::from("-c"),
            OsString::from(LOGIN_SHELL_PATH_COMMAND),
        ],
        &[],
    )?;
    if !output.success {
        return Err(LocalAgentError::ProbeFailed);
    }
    if output.stdout.len() > LOGIN_SHELL_PATH_LIMIT || output.stderr.len() > PROBE_STDERR_LIMIT {
        return Err(LocalAgentError::ProbeOutputTooLarge);
    }
    parse_login_shell_path_output(&output.stdout)
}

fn parse_login_shell_path_output(output: &[u8]) -> Result<OsString, LocalAgentError> {
    let lines = output.split(|byte| *byte == b'\n').collect::<Vec<_>>();
    let begin = LOGIN_SHELL_PATH_BEGIN.as_bytes();
    let end = LOGIN_SHELL_PATH_END.as_bytes();
    let mut open_frame = None;
    let mut final_frame = None;
    for (index, line) in lines.iter().enumerate() {
        if *line == begin {
            open_frame = Some(index);
        } else if *line == end
            && let Some(begin_index) = open_frame
            && begin_index < index
        {
            final_frame = Some((begin_index, index));
            open_frame = None;
        }
    }
    let (begin_index, end_index) = final_frame.ok_or(LocalAgentError::MalformedProbeOutput)?;
    if end_index != begin_index + 2 {
        return Err(LocalAgentError::MalformedProbeOutput);
    }
    let path = lines[begin_index + 1];
    if path.is_empty() || path.iter().any(|byte| matches!(byte, b'\0' | b'\r')) {
        return Err(LocalAgentError::MalformedProbeOutput);
    }
    let path = std::str::from_utf8(path).map_err(|_| LocalAgentError::MalformedProbeOutput)?;
    Ok(OsString::from(path))
}

#[cfg(test)]
fn search_path_directories_with_runner(
    gui_path: Option<&OsStr>,
    shell: &Path,
    runner: &impl ProbeRunner,
) -> Vec<PathBuf> {
    let login_path = login_shell_path_value_with_runner(shell, runner).ok();
    search_path_directories(gui_path, login_path.as_deref())
}

fn search_path_directories(gui_path: Option<&OsStr>, login_path: Option<&OsStr>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    gui_path
        .into_iter()
        .chain(login_path)
        .flat_map(env::split_paths)
        .filter(|path| path.is_absolute())
        .filter(|path| {
            let identity = path.canonicalize().unwrap_or_else(|_| path.clone());
            seen.insert(identity)
        })
        .collect()
}

fn automatic_search_directories(
    gui_path: Option<&OsStr>,
    login_path: Option<&OsStr>,
    home: Option<&Path>,
) -> Vec<PathBuf> {
    let mut paths = search_path_directories(gui_path, login_path);
    paths.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
    ]);
    if let Some(home) = home.filter(|path| path.is_absolute()) {
        paths.extend([
            home.join(".local/bin"),
            home.join(".opencode/bin"),
            home.join(".bun/bin"),
            home.join(".cargo/bin"),
            home.join(".volta/bin"),
            home.join(".npm-global/bin"),
            home.join(".local/share/pnpm"),
            home.join("Library/pnpm"),
        ]);
    }
    let mut seen = HashSet::new();
    paths
        .into_iter()
        .filter(|path| path.is_absolute())
        .filter(|path| {
            let identity = path.canonicalize().unwrap_or_else(|_| path.clone());
            seen.insert(identity)
        })
        .collect()
}

#[cfg(test)]
fn sanitized_path_value(path: Option<&OsStr>) -> Result<OsString, LocalAgentError> {
    let path = env::join_paths(search_path_directories(path, None))
        .map_err(|_| LocalAgentError::ProbeFailed)?;
    normalized_environment_path(&path)
}

fn normalized_search_path_directories(
    paths: Vec<PathBuf>,
) -> Result<Vec<PathBuf>, LocalAgentError> {
    let path = env::join_paths(paths).map_err(|_| LocalAgentError::ProbeFailed)?;
    Ok(env::split_paths(&normalized_environment_path(&path)?).collect())
}

fn normalized_environment_path(path: &OsStr) -> Result<OsString, LocalAgentError> {
    let environment = controlled_environment(
        BTreeMap::new(),
        &[(OsString::from("PATH"), path.to_owned())],
        Path::new("/"),
    )?;
    environment
        .get(OsStr::new("PATH"))
        .cloned()
        .ok_or(LocalAgentError::ProbeFailed)
}

fn resolve_all_from_paths(kind: LocalAgentKind, paths: &[PathBuf]) -> Vec<ResolvedAgent> {
    let basename = kind.executable_basename();
    let mut seen = HashSet::new();
    paths
        .iter()
        .filter_map(|directory| {
            let candidate = directory.join(basename);
            if !is_executable_file(&candidate) {
                return None;
            }
            let canonical_path = candidate.canonicalize().ok()?;
            if !canonical_path.is_absolute()
                || !is_executable_file(&canonical_path)
                || !seen.insert(canonical_path.clone())
            {
                return None;
            }
            Some(ResolvedAgent {
                kind,
                path_label: redacted_path_label(basename),
                path: canonical_path,
            })
        })
        .collect()
}

fn resolve_from_paths(kind: LocalAgentKind, paths: &[PathBuf]) -> Option<ResolvedAgent> {
    resolve_all_from_paths(kind, paths).into_iter().next()
}

fn resolve_candidate_from_paths(
    kind: LocalAgentKind,
    manual_path: Option<&str>,
    home: Option<&Path>,
    automatic_paths: &[PathBuf],
) -> Result<(ResolvedAgent, LocalAgentStatusSource), LocalAgentError> {
    let manual_path = manual_path.map(str::trim).unwrap_or_default();
    if manual_path.is_empty() {
        return resolve_from_paths(kind, automatic_paths)
            .map(|resolved| (resolved, LocalAgentStatusSource::Automatic))
            .ok_or(LocalAgentError::NotInstalled);
    }

    let requested = if let Some(relative_to_home) = manual_path.strip_prefix("~/") {
        let home = home.ok_or_else(|| {
            LocalAgentError::run(
                "invalid_agent_path",
                "The home directory is unavailable for the configured executable path.",
            )
        })?;
        home.join(relative_to_home)
    } else {
        if manual_path.starts_with('~') {
            return Err(LocalAgentError::run(
                "invalid_agent_path",
                "The configured executable path must be absolute or start with ~/.",
            ));
        }
        PathBuf::from(manual_path)
    };
    if !requested.is_absolute() {
        return Err(LocalAgentError::run(
            "invalid_agent_path",
            "The configured executable path must be absolute or start with ~/.",
        ));
    }
    let canonical_path = requested.canonicalize().map_err(|_| {
        LocalAgentError::run(
            "invalid_agent_path",
            "The configured executable was not found.",
        )
    })?;
    if !canonical_path.is_absolute() || !is_executable_file(&canonical_path) {
        return Err(LocalAgentError::run(
            "invalid_agent_path",
            "The configured path is not a regular executable file.",
        ));
    }
    Ok((
        ResolvedAgent {
            kind,
            path_label: canonical_path.to_string_lossy().into_owned(),
            path: canonical_path,
        },
        LocalAgentStatusSource::Manual,
    ))
}

#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    path.metadata()
        .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn is_executable_file(path: &Path) -> bool {
    path.metadata().is_ok_and(|metadata| metadata.is_file())
}

fn redacted_path_label(basename: &str) -> String {
    format!("bin/{basename}")
}

fn unavailable_status(
    kind: LocalAgentKind,
    error: LocalAgentError,
    source: Option<LocalAgentStatusSource>,
) -> LocalAgentStatus {
    LocalAgentStatus {
        kind,
        mention: kind.mention(),
        label: kind.label(),
        installed: false,
        compatible: false,
        path_label: None,
        version: None,
        reason: Some(error.reason().to_string()),
        source,
    }
}

#[cfg(test)]
fn discover_automatic_kind_with_runner(
    kind: LocalAgentKind,
    paths: &[PathBuf],
    environment_path: &OsStr,
    runner: &impl ProbeRunner,
) -> LocalAgentStatus {
    discover_automatic_kind_with_runner_and_deadline(kind, paths, environment_path, runner, None)
}

fn discover_automatic_kind_with_runner_and_deadline(
    kind: LocalAgentKind,
    paths: &[PathBuf],
    environment_path: &OsStr,
    runner: &impl ProbeRunner,
    deadline: Option<Instant>,
) -> LocalAgentStatus {
    let mut first_failure = None;
    for resolved in resolve_all_from_paths(kind, paths) {
        let status = probe_resolved_agent_with_environment_path_and_deadline(
            resolved,
            environment_path,
            runner,
            LocalAgentStatusSource::Automatic,
            deadline,
        );
        if status.compatible {
            return status;
        }
        if first_failure.is_none() {
            first_failure = Some(status);
        }
    }
    first_failure.unwrap_or_else(|| unavailable_status(kind, LocalAgentError::NotInstalled, None))
}

#[cfg(test)]
fn probe_resolved_agent(resolved: ResolvedAgent, runner: &impl ProbeRunner) -> LocalAgentStatus {
    let environment_path = sanitized_path_value(env::var_os("PATH").as_deref()).unwrap_or_default();
    probe_resolved_agent_with_environment_path(
        resolved,
        &environment_path,
        runner,
        LocalAgentStatusSource::Automatic,
    )
}

#[cfg(test)]
fn probe_resolved_agent_with_environment_path(
    resolved: ResolvedAgent,
    environment_path: &OsStr,
    runner: &impl ProbeRunner,
    source: LocalAgentStatusSource,
) -> LocalAgentStatus {
    probe_resolved_agent_with_environment_path_and_deadline(
        resolved,
        environment_path,
        runner,
        source,
        None,
    )
}

fn probe_resolved_agent_with_environment_path_and_deadline(
    resolved: ResolvedAgent,
    environment_path: &OsStr,
    runner: &impl ProbeRunner,
    source: LocalAgentStatusSource,
    deadline: Option<Instant>,
) -> LocalAgentStatus {
    let kind = resolved.kind;
    let mut status = LocalAgentStatus {
        kind,
        mention: kind.mention(),
        label: kind.label(),
        installed: true,
        compatible: false,
        path_label: Some(resolved.path_label.clone()),
        version: None,
        reason: None,
        source: Some(source),
    };

    let proof = match ExecutableProof::capture_with_constraints(
        &resolved.path,
        environment_path.to_owned(),
        None,
        deadline,
    ) {
        Ok(proof) => proof,
        Err(error) => {
            status.reason = Some(error.reason().to_string());
            return status;
        }
    };
    let runner = PinnedProbeRunner {
        inner: runner,
        proof: &proof,
        cancellation: None,
        deadline,
    };

    let version = match probe_version(&resolved, &runner) {
        Ok(version) => version,
        Err(error) => {
            let error = proof.verify_path(&resolved.path).err().unwrap_or(error);
            status.reason = Some(error.reason().to_string());
            return status;
        }
    };
    status.version = Some(version);

    let capability = probe_capabilities(&resolved, &runner);
    match proof.verify_path(&resolved.path).and(capability) {
        Ok(()) => status.compatible = true,
        Err(error) => status.reason = Some(error.reason().to_string()),
    }
    status
}

#[cfg(test)]
fn probe_agent(
    resolved: &ResolvedAgent,
    runner: &impl ProbeRunner,
) -> Result<String, LocalAgentError> {
    let proof = ExecutableProof::capture(&resolved.path)?;
    probe_agent_with_proof(resolved, &proof, runner, None, None)
}

fn probe_agent_with_proof(
    resolved: &ResolvedAgent,
    proof: &ExecutableProof,
    runner: &impl ProbeRunner,
    cancellation: Option<&CancellationToken>,
    deadline: Option<Instant>,
) -> Result<String, LocalAgentError> {
    let runner = PinnedProbeRunner {
        inner: runner,
        proof,
        cancellation,
        deadline,
    };
    let result = (|| {
        let version = probe_version(resolved, &runner)?;
        probe_capabilities(resolved, &runner)?;
        Ok(version)
    })();
    proof.verify_path_with_constraints(&resolved.path, cancellation, deadline)?;
    result
}

struct ClaudeProbeEnvironment {
    _directory: OwnedTempCapability,
    values: Vec<(OsString, OsString)>,
}

impl ClaudeProbeEnvironment {
    fn create() -> Result<Self, LocalAgentError> {
        let mut directory =
            create_owned_temp_dir().map_err(|_| LocalAgentError::ProbeSpawnFailed)?;
        let mut values = Vec::new();
        for (name, directory_name) in [
            ("HOME", "home"),
            ("CLAUDE_CONFIG_DIR", "config"),
            ("XDG_CONFIG_HOME", "xdg-config"),
            ("XDG_CACHE_HOME", "cache"),
            ("XDG_DATA_HOME", "data"),
            ("XDG_STATE_HOME", "state"),
        ] {
            let path = directory.create_probe_directory(directory_name)?;
            values.push((OsString::from(name), path.into_os_string()));
        }
        for name in [
            "CLAUDE_CODE_SAFE_MODE",
            "CLAUDE_CODE_DISABLE_AUTO_MEMORY",
            "CLAUDE_CODE_DISABLE_CLAUDE_MDS",
            "CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS",
        ] {
            values.push((OsString::from(name), OsString::from("1")));
        }
        Ok(Self {
            _directory: directory,
            values,
        })
    }
}

struct OpenCodeProbeEnvironment {
    _directory: OwnedTempCapability,
    values: Vec<(OsString, OsString)>,
}

impl OpenCodeProbeEnvironment {
    fn create() -> Result<Self, LocalAgentError> {
        let mut directory =
            create_owned_temp_dir().map_err(|_| LocalAgentError::ProbeSpawnFailed)?;
        let mut values: BTreeMap<OsString, OsString> =
            owned_opencode_environment().into_iter().collect();
        for (name, directory_name) in [
            ("XDG_CONFIG_HOME", "config"),
            ("XDG_CACHE_HOME", "cache"),
            ("XDG_DATA_HOME", "data"),
            ("XDG_STATE_HOME", "state"),
        ] {
            let path = directory.create_probe_directory(directory_name)?;
            values.insert(OsString::from(name), path.into_os_string());
        }
        values.insert(
            OsString::from("OPENCODE_DISABLE_CLAUDE_CODE"),
            OsString::from("1"),
        );
        values.insert(
            OsString::from("OPENCODE_DISABLE_DEFAULT_PLUGINS"),
            OsString::from("true"),
        );
        Ok(Self {
            _directory: directory,
            values: values.into_iter().collect(),
        })
    }
}

fn run_open_code_probe(
    executable: &Path,
    args: &[OsString],
    runner: &impl ProbeRunner,
) -> Result<ProbeOutput, LocalAgentError> {
    let environment = OpenCodeProbeEnvironment::create()?;
    runner.run(executable, args, &environment.values)
}

fn run_claude_probe(
    executable: &Path,
    args: &[OsString],
    runner: &impl ProbeRunner,
) -> Result<ProbeOutput, LocalAgentError> {
    let environment = ClaudeProbeEnvironment::create()?;
    runner.run(executable, args, &environment.values)
}

fn probe_version(
    resolved: &ResolvedAgent,
    runner: &impl ProbeRunner,
) -> Result<String, LocalAgentError> {
    let args = [OsString::from("--version")];
    let version_output = match resolved.kind {
        LocalAgentKind::Claude => run_claude_probe(&resolved.path, &args, runner)?,
        LocalAgentKind::Opencode => run_open_code_probe(&resolved.path, &args, runner)?,
        LocalAgentKind::Codex => runner.run(&resolved.path, &args, &[])?,
    };
    parse_version(&successful_probe_text(&version_output)?)
}

fn probe_capabilities(
    resolved: &ResolvedAgent,
    runner: &impl ProbeRunner,
) -> Result<(), LocalAgentError> {
    match resolved.kind {
        LocalAgentKind::Claude => probe_claude(&resolved.path, runner)?,
        LocalAgentKind::Codex => probe_codex(&resolved.path, runner)?,
        LocalAgentKind::Opencode => probe_opencode(&resolved.path, runner)?,
    }
    Ok(())
}

fn probe_claude(executable: &Path, runner: &impl ProbeRunner) -> Result<(), LocalAgentError> {
    let output = run_claude_probe(executable, &[OsString::from("--help")], runner)?;
    evaluate_claude_help(&successful_probe_text(&output)?).into_result()
}

fn probe_codex(executable: &Path, runner: &impl ProbeRunner) -> Result<(), LocalAgentError> {
    let help = runner.run(
        executable,
        &[OsString::from("exec"), OsString::from("--help")],
        &[],
    )?;
    evaluate_codex_help(&successful_probe_text(&help)?).into_result()?;

    let features = runner.run(executable, &codex_feature_probe_args(), &[])?;
    evaluate_codex_features(&successful_probe_text(&features)?).into_result()
}

fn probe_opencode(executable: &Path, runner: &impl ProbeRunner) -> Result<(), LocalAgentError> {
    let run_help = run_open_code_probe(
        executable,
        &[OsString::from("run"), OsString::from("--help")],
        runner,
    )?;
    let debug_help = run_open_code_probe(
        executable,
        &[
            OsString::from("debug"),
            OsString::from("config"),
            OsString::from("--help"),
        ],
        runner,
    )?;
    evaluate_opencode_help(
        &successful_probe_text(&run_help)?,
        &successful_probe_text(&debug_help)?,
    )
    .into_result()?;

    let config = run_open_code_probe(
        executable,
        &[
            OsString::from("debug"),
            OsString::from("config"),
            OsString::from("--pure"),
        ],
        runner,
    )?;
    if !config.success {
        return Err(LocalAgentError::ProbeFailed);
    }
    let text =
        std::str::from_utf8(&config.stdout).map_err(|_| LocalAgentError::MalformedProbeOutput)?;
    let value: Value =
        serde_json::from_str(text).map_err(|_| LocalAgentError::MalformedProbeOutput)?;
    if opencode_permissions_are_denied(&value) {
        Ok(())
    } else {
        Err(LocalAgentError::Incompatible(OPEN_CODE_PERMISSIONS_REASON))
    }
}

fn successful_probe_text(output: &ProbeOutput) -> Result<String, LocalAgentError> {
    if !output.success {
        return Err(LocalAgentError::ProbeFailed);
    }
    let bytes = if output.stdout.is_empty() {
        &output.stderr
    } else {
        &output.stdout
    };
    std::str::from_utf8(bytes)
        .map(str::to_owned)
        .map_err(|_| LocalAgentError::MalformedProbeOutput)
}

fn parse_version(output: &str) -> Result<String, LocalAgentError> {
    output
        .split_ascii_whitespace()
        .map(|token| token.trim_matches(['(', ')', ',', ';']))
        .find(|token| {
            token.len() <= 64
                && token.as_bytes().first().is_some_and(u8::is_ascii_digit)
                && token.contains('.')
                && token.chars().all(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '+' | '_')
                })
        })
        .map(str::to_string)
        .ok_or(LocalAgentError::MalformedProbeOutput)
}

fn evaluate_claude_help(help: &str) -> CapabilityEvaluation {
    evaluate_required_flags(help, CLAUDE_REQUIRED_FLAGS, CLAUDE_FLAGS_REASON)
}

fn evaluate_codex_help(help: &str) -> CapabilityEvaluation {
    evaluate_required_flags(help, CODEX_REQUIRED_FLAGS, CODEX_FLAGS_REASON)
}

fn evaluate_opencode_help(run_help: &str, debug_help: &str) -> CapabilityEvaluation {
    if ["--pure", "--format", "--dir"]
        .into_iter()
        .all(|flag| help_has_flag(run_help, flag))
        && help_has_word(run_help, "json")
        && help_has_flag(debug_help, "--pure")
    {
        CapabilityEvaluation::compatible()
    } else {
        CapabilityEvaluation::incompatible(OPEN_CODE_FLAGS_REASON)
    }
}

fn evaluate_required_flags(
    help: &str,
    required: &[&str],
    reason: &'static str,
) -> CapabilityEvaluation {
    if required.iter().all(|flag| help_has_flag(help, flag)) {
        CapabilityEvaluation::compatible()
    } else {
        CapabilityEvaluation::incompatible(reason)
    }
}

fn help_has_flag(help: &str, flag: &str) -> bool {
    help.split_ascii_whitespace().any(|token| {
        let token = token.trim_matches(['[', ']', '(', ')', '{', '}', ',', ';']);
        token == flag
            || token
                .strip_prefix(flag)
                .is_some_and(|suffix| suffix.starts_with('='))
    })
}

fn help_has_word(help: &str, word: &str) -> bool {
    help.split(|character: char| {
        !(character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
    })
    .any(|token| token.eq_ignore_ascii_case(word))
}

fn codex_feature_probe_args() -> Vec<OsString> {
    let mut args = Vec::with_capacity(2 + CODEX_DENIED_FEATURES.len() * 2 + 2);
    args.extend([OsString::from("features"), OsString::from("list")]);
    for feature in CODEX_DENIED_FEATURES {
        args.extend([OsString::from("--disable"), OsString::from(feature)]);
    }
    args.extend([OsString::from("-c"), OsString::from("mcp_servers={}")]);
    args
}

fn evaluate_codex_features(output: &str) -> CapabilityEvaluation {
    let mut features = BTreeMap::new();
    for line in output.lines().filter(|line| !line.trim().is_empty()) {
        let columns: Vec<&str> = line.split_ascii_whitespace().collect();
        if columns.len() < 3
            || !is_feature_field(columns[0])
            || !columns[1..columns.len() - 1]
                .iter()
                .all(|stage| is_feature_field(stage))
        {
            return CapabilityEvaluation::incompatible(CODEX_FEATURES_REASON);
        }
        let enabled = match columns[columns.len() - 1] {
            "true" => true,
            "false" => false,
            _ => return CapabilityEvaluation::incompatible(CODEX_FEATURES_REASON),
        };
        if features.insert(columns[0], enabled).is_some() {
            return CapabilityEvaluation::incompatible(CODEX_FEATURES_REASON);
        }
    }

    if features.is_empty()
        || CODEX_DENIED_FEATURES
            .iter()
            .any(|feature| features.get(feature) != Some(&false))
        || features
            .iter()
            .any(|(feature, enabled)| *enabled && !PASSIVE_CODEX_FEATURES.contains(feature))
    {
        CapabilityEvaluation::incompatible(CODEX_FEATURES_REASON)
    } else {
        CapabilityEvaluation::compatible()
    }
}

fn is_feature_field(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
}

fn opencode_permissions_are_denied(config: &Value) -> bool {
    const FORBIDDEN_CONFIG_SURFACES: &[&str] = &[
        "mcp",
        "instruction",
        "instructions",
        "prompt",
        "prompts",
        "rule",
        "rules",
        "plugin",
        "plugins",
        "hook",
        "hooks",
        "command",
        "commands",
    ];
    if config.get("share").and_then(Value::as_str) != Some("disabled")
        || config.get("default_agent").and_then(Value::as_str) != Some(OPEN_CODE_OWNED_AGENT)
        || !legacy_mode_is_empty(config.get("mode"))
        || !permission_map_is_denied(config.get("permission"), true)
        || !tools_map_is_exactly_owned(config.get("tools"))
        || FORBIDDEN_CONFIG_SURFACES
            .iter()
            .any(|field| !config_value_is_empty(config.get(*field)))
    {
        return false;
    }

    let Some(agents) = config.get("agent").and_then(Value::as_object) else {
        return false;
    };
    if agents.len() != 1 {
        return false;
    }
    let Some(owned_agent) = agents.get(OPEN_CODE_OWNED_AGENT).and_then(Value::as_object) else {
        return false;
    };
    (owned_agent.len() == 3 || owned_agent.len() == 4)
        && owned_agent
            .keys()
            .all(|key| matches!(key.as_str(), "mode" | "permission" | "tools" | "options"))
        && config_value_is_empty(owned_agent.get("options"))
        && owned_agent.get("mode").and_then(Value::as_str) == Some("primary")
        && permission_map_is_denied(owned_agent.get("permission"), true)
        && tools_map_is_exactly_owned(owned_agent.get("tools"))
}

fn config_value_is_empty(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) | Some(Value::Bool(false)) => true,
        Some(Value::String(value)) => value.is_empty(),
        Some(Value::Array(value)) => value.is_empty(),
        Some(Value::Object(value)) => value.is_empty(),
        Some(Value::Bool(true) | Value::Number(_)) => false,
    }
}

fn tools_map_is_exactly_owned(tools: Option<&Value>) -> bool {
    let Some(tools) = tools.and_then(Value::as_object) else {
        return false;
    };
    tools.len() == 2
        && tools.get("*") == Some(&Value::Bool(false))
        && tools.get("edit") == Some(&Value::Bool(false))
}

fn legacy_mode_is_empty(mode: Option<&Value>) -> bool {
    match mode {
        None | Some(Value::Null) => true,
        Some(Value::Object(mode)) => mode.is_empty(),
        _ => false,
    }
}

fn permission_map_is_denied(permission: Option<&Value>, require_all_known: bool) -> bool {
    let Some(permission) = permission else {
        return false;
    };
    let Some(permission) = permission.as_object() else {
        return permission.as_str() == Some("deny") && !require_all_known;
    };
    if permission.is_empty()
        || !permission.values().all(permission_rule_is_denied)
        || (require_all_known
            && OPEN_CODE_REQUIRED_PERMISSIONS
                .iter()
                .any(|name| !permission.get(*name).is_some_and(permission_rule_is_denied)))
    {
        return false;
    }
    true
}

fn permission_rule_is_denied(rule: &Value) -> bool {
    match rule {
        Value::String(action) => action == "deny",
        Value::Object(patterns) => {
            !patterns.is_empty() && patterns.values().all(permission_rule_is_denied)
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        ffi::{OsStr, OsString},
        fs,
        io::{self, Read},
        path::{Path, PathBuf},
        sync::{
            Mutex,
            atomic::{AtomicUsize, Ordering},
        },
        thread,
        time::{Duration, Instant},
    };

    use serde_json::{Value, json};
    use tempfile::tempdir;
    use tokio_util::sync::CancellationToken;

    use super::{
        BoundedProbeRunner, CAPABILITY_PROBE_TIMEOUT_REASON, CLAUDE_FLAGS_REASON,
        CLAUDE_REQUIRED_FLAGS, CODEX_FEATURES_REASON, CancellableProbeRunner,
        CompatibleResolutionContext, ExecutableProof, LOGIN_SHELL_PATH_BEGIN,
        LOGIN_SHELL_PATH_COMMAND, LOGIN_SHELL_PATH_END, LOGIN_SHELL_PATH_LIMIT,
        MAX_EXECUTABLE_BYTES, OPEN_CODE_PERMISSIONS_REASON, PROBE_TIMEOUT, ProbeOutput,
        ProbeRunner, STATUS_DISCOVERY_TIMEOUT, automatic_search_directories,
        codex_feature_probe_args, discover_all_with_runner_and_paths,
        discover_automatic_kind_with_runner, evaluate_claude_help, evaluate_codex_features,
        evaluate_codex_help, evaluate_opencode_help, executable_sha256, executable_sha256_exact,
        login_shell_path_value_with_runner, opencode_permissions_are_denied,
        parse_login_shell_path_output, parse_shebang_interpreter, probe_agent,
        probe_agent_with_proof, probe_resolved_agent, probe_resolved_agent_with_environment_path,
        probe_resolved_agent_with_environment_path_and_deadline, resolve_all_from_paths,
        resolve_candidate_from_paths, resolve_compatible_from_paths_with_runner_and_proof,
        resolve_from_paths, search_path_directories, search_path_directories_with_runner,
    };
    use crate::local_agents::{
        LocalAgentError, LocalAgentKind, LocalAgentStatusSource, ResolvedAgent,
        owned_opencode_environment,
    };
    use markdowner_core::settings::LocalAgentExecutablePaths;

    const SAFE_CODEX_FEATURES: &str = "\
apps stable false
auth_elicitation experimental false
browser_use experimental false
browser_use_external experimental false
browser_use_full_cdp_access experimental false
chronicle experimental false
code_mode experimental false
code_mode_host experimental false
computer_use experimental false
enable_mcp_apps experimental false
goals experimental false
guardian_approval experimental false
hooks experimental false
image_generation experimental false
in_app_browser experimental false
in_app_chat stable false
in_app_dictation stable false
in_app_updates stable false
memories experimental false
multi_agent experimental false
multi_agent_v2 experimental false
plugin_sharing experimental false
plugins experimental false
recommended_plugins experimental false
remote_plugin experimental false
shell_snapshot stable false
shell_tool stable false
skill_mcp_dependency_install experimental false
skill_search experimental false
standalone_web_search experimental false
tool_call_mcp_elicitation experimental false
tool_suggest experimental false
unified_exec stable false
view_image stable false
workspace_dependencies experimental false
collaboration_modes stable true
enable_request_compression stable true
fast_mode stable true
item_ids stable true
mentions_v2 stable true
personality stable true
remote_compaction_v2 stable true
resize_all_images stable true
sqlite stable true
steer stable true
terminal_resize_reflow stable true
tool_search_always_defer_mcp_tools stable true
tui_app_server stable true
";

    const CODEX_EXEC_HELP: &str = "\
Usage: codex exec [OPTIONS] [PROMPT]
  --strict-config
  --ignore-user-config
  --ignore-rules
  --sandbox <SANDBOX>
  --ephemeral
  --skip-git-repo-check
  --output-schema <FILE>
  --output-last-message <FILE>
  --disable <FEATURE>
  -c <KEY=VALUE>
";

    const CLAUDE_HELP: &str = "\
Usage: claude [options]
  --safe-mode
  --setting-sources <sources>
  --settings <file-or-json>
  --disable-slash-commands
  --print
  --tools <tools>
  --allowedTools <tools>
  --permission-mode <mode>
  --strict-mcp-config
  --mcp-config <config>
  --no-session-persistence
  --output-format <format>
  --json-schema <schema>
";

    const OPEN_CODE_RUN_HELP: &str = "\
Usage: opencode run [message..]
  --pure
  --format <format>  output format: default or json
  --dir <path>
";

    const OPEN_CODE_DEBUG_CONFIG_HELP: &str = "\
Usage: opencode debug config
  --pure
";

    #[cfg(unix)]
    fn create_executable(path: &Path) {
        create_executable_script(path, "#!/bin/sh\nexit 0\n");
    }

    #[cfg(unix)]
    fn create_executable_script(path: &Path, script: &str) {
        create_executable_bytes(path, script.as_bytes());
    }

    #[cfg(unix)]
    fn create_executable_bytes(path: &Path, bytes: &[u8]) {
        use std::os::unix::fs::PermissionsExt;

        fs::write(path, bytes).unwrap();
        let mut permissions = fs::metadata(path).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(path, permissions).unwrap();
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

    #[cfg(unix)]
    fn kill_test_process(pid: i32) {
        const SIGKILL: i32 = 9;

        unsafe extern "C" {
            fn kill(pid: i32, signal: i32) -> i32;
        }

        unsafe {
            let _ = kill(pid, SIGKILL);
        }
    }

    #[cfg(unix)]
    fn process_disappears(pid: i32, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if !process_exists(pid) {
                return true;
            }
            thread::sleep(Duration::from_millis(10));
        }
        !process_exists(pid)
    }

    fn denied_open_code_permission_map() -> Value {
        json!({
            "*": "deny",
            "read": "deny",
            "edit": "deny",
            "glob": "deny",
            "grep": "deny",
            "list": "deny",
            "bash": "deny",
            "task": "deny",
            "skill": "deny",
            "lsp": "deny",
            "question": "deny",
            "webfetch": "deny",
            "websearch": "deny",
            "external_directory": "deny",
            "todowrite": "deny",
            "doom_loop": "deny"
        })
    }

    fn fully_denied_open_code_config() -> Value {
        let permission = denied_open_code_permission_map();
        json!({
            "share": "disabled",
            "default_agent": "markdowner",
            "mode": {},
            "tools": {"*": false, "edit": false},
            "permission": permission.clone(),
            "agent": {
                "markdowner": {
                    "mode": "primary",
                    "tools": {"*": false, "edit": false},
                    "permission": permission
                }
            }
        })
    }

    #[test]
    #[cfg(unix)]
    fn resolution_prefers_the_first_path_and_returns_a_canonical_redacted_result() {
        let temp = tempdir().unwrap();
        let first_bin = temp.path().join("first/bin");
        let second_bin = temp.path().join("second/bin");
        fs::create_dir_all(&first_bin).unwrap();
        fs::create_dir_all(&second_bin).unwrap();
        let first_claude = first_bin.join("claude");
        let second_claude = second_bin.join("claude");
        create_executable(&first_claude);
        create_executable(&second_claude);

        let resolved =
            resolve_from_paths(LocalAgentKind::Claude, &[first_bin, second_bin]).unwrap();

        assert_eq!(resolved.path, first_claude.canonicalize().unwrap());
        assert!(resolved.path.is_absolute());
        assert_eq!(resolved.path_label, "bin/claude");
        assert!(
            !resolved
                .path_label
                .contains(temp.path().to_string_lossy().as_ref())
        );
    }

    #[test]
    #[cfg(unix)]
    fn redacted_label_never_uses_a_potentially_sensitive_parent_name() {
        let temp = tempdir().unwrap();
        let sensitive_parent = temp.path().join("private-user-name");
        fs::create_dir_all(&sensitive_parent).unwrap();
        create_executable(&sensitive_parent.join("claude"));

        let resolved = resolve_from_paths(LocalAgentKind::Claude, &[sensitive_parent]).unwrap();

        assert_eq!(resolved.path_label, "bin/claude");
        assert!(!resolved.path_label.contains("private-user-name"));
    }

    #[test]
    #[cfg(unix)]
    fn resolution_rejects_missing_non_executable_and_renamed_candidates() {
        let temp = tempdir().unwrap();
        let bin = temp.path().join("bin");
        fs::create_dir_all(&bin).unwrap();
        fs::write(bin.join("claude"), "not executable").unwrap();
        create_executable(&bin.join("claude-custom"));

        assert!(resolve_from_paths(LocalAgentKind::Claude, &[bin]).is_none());
    }

    #[test]
    #[cfg(unix)]
    fn resolution_uses_only_the_compiled_basename_for_the_requested_kind() {
        let temp = tempdir().unwrap();
        let bin = temp.path().join("bin");
        fs::create_dir_all(&bin).unwrap();
        create_executable(&bin.join("claude"));
        let codex = bin.join("codex");
        create_executable(&codex);

        let resolved = resolve_from_paths(LocalAgentKind::Codex, &[bin]).unwrap();

        assert_eq!(resolved.path, codex.canonicalize().unwrap());
        assert_eq!(resolved.path.file_name(), Some(OsStr::new("codex")));
    }

    #[test]
    #[cfg(unix)]
    fn manual_resolution_expands_home_and_canonicalizes_a_symlink() {
        use std::os::unix::fs::symlink;

        let home = tempdir().unwrap();
        let real = home.path().join("tools/claude-real");
        fs::create_dir_all(real.parent().unwrap()).unwrap();
        create_executable(&real);
        let link = home.path().join("claude");
        symlink(&real, &link).unwrap();

        let (resolved, source) = resolve_candidate_from_paths(
            LocalAgentKind::Claude,
            Some("~/claude"),
            Some(home.path()),
            &[],
        )
        .unwrap();

        assert_eq!(resolved.path, real.canonicalize().unwrap());
        assert_eq!(
            resolved.path_label,
            real.canonicalize().unwrap().to_string_lossy()
        );
        assert_eq!(source, LocalAgentStatusSource::Manual);
    }

    #[test]
    #[cfg(unix)]
    fn invalid_manual_path_never_falls_back_to_an_automatic_candidate() {
        let temp = tempdir().unwrap();
        let automatic_bin = temp.path().join("bin");
        fs::create_dir_all(&automatic_bin).unwrap();
        create_executable(&automatic_bin.join("claude"));

        let relative = resolve_candidate_from_paths(
            LocalAgentKind::Claude,
            Some("relative/claude"),
            Some(temp.path()),
            std::slice::from_ref(&automatic_bin),
        )
        .unwrap_err();
        assert_eq!(relative.code_value(), "invalid_agent_path");
        assert_eq!(
            relative.reason(),
            "The configured executable path must be absolute or start with ~/."
        );

        let missing = resolve_candidate_from_paths(
            LocalAgentKind::Claude,
            Some("~/missing-claude"),
            Some(temp.path()),
            &[automatic_bin],
        )
        .unwrap_err();
        assert_eq!(missing.code_value(), "invalid_agent_path");
        assert_eq!(missing.reason(), "The configured executable was not found.");
    }

    #[test]
    fn gui_and_login_shell_paths_are_ordered_and_canonical_duplicates_are_removed() {
        let temp = tempdir().unwrap();
        let first = temp.path().join("first");
        let second = temp.path().join("second");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        let gui = std::env::join_paths([&first, &second]).unwrap();
        let login = std::env::join_paths([&second, &first]).unwrap();

        assert_eq!(
            search_path_directories(Some(&gui), Some(&login)),
            vec![first, second]
        );
    }

    #[test]
    fn path_search_rejects_empty_and_relative_entries() {
        let temp = tempdir().unwrap();
        let absolute = temp.path().join("bin");
        fs::create_dir_all(&absolute).unwrap();
        let gui = std::env::join_paths([
            PathBuf::new(),
            PathBuf::from("relative/bin"),
            absolute.clone(),
        ])
        .unwrap();

        assert_eq!(search_path_directories(Some(&gui), None), vec![absolute]);
    }

    #[test]
    fn claude_help_requires_each_safety_flag_by_its_exact_name() {
        assert!(evaluate_claude_help(CLAUDE_HELP).compatible);

        for flag in CLAUDE_REQUIRED_FLAGS {
            let renamed = CLAUDE_HELP.replace(flag, &format!("{flag}-unsupported"));
            let evaluation = evaluate_claude_help(&renamed);

            assert!(!evaluation.compatible, "missing required flag {flag}");
            assert_eq!(evaluation.reason, Some(CLAUDE_FLAGS_REASON));
        }
    }

    #[test]
    fn codex_help_requires_every_execution_restriction() {
        assert!(evaluate_codex_help(CODEX_EXEC_HELP).compatible);

        let missing_strict_config = CODEX_EXEC_HELP.replace("--strict-config", "--strict");
        assert!(!evaluate_codex_help(&missing_strict_config).compatible);
        for flag in ["--ignore-user-config", "--ignore-rules"] {
            let missing = CODEX_EXEC_HELP.replace(flag, "--unsupported");
            assert!(
                !evaluate_codex_help(&missing).compatible,
                "missing required Codex flag {flag} was accepted"
            );
        }
    }

    #[test]
    fn codex_feature_probe_uses_the_full_denylist_without_strict_config() {
        let actual: Vec<String> = codex_feature_probe_args()
            .into_iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect();
        let expected_denied = [
            "apps",
            "auth_elicitation",
            "browser_use",
            "browser_use_external",
            "browser_use_full_cdp_access",
            "chronicle",
            "code_mode",
            "code_mode_host",
            "computer_use",
            "enable_mcp_apps",
            "goals",
            "guardian_approval",
            "hooks",
            "image_generation",
            "in_app_browser",
            "in_app_chat",
            "in_app_dictation",
            "in_app_updates",
            "memories",
            "multi_agent",
            "multi_agent_v2",
            "plugin_sharing",
            "plugins",
            "recommended_plugins",
            "remote_plugin",
            "shell_snapshot",
            "shell_tool",
            "skill_mcp_dependency_install",
            "skill_search",
            "standalone_web_search",
            "tool_call_mcp_elicitation",
            "tool_suggest",
            "unified_exec",
            "view_image",
            "workspace_dependencies",
        ];

        assert_eq!(&actual[..2], ["features", "list"]);
        assert!(!actual.iter().any(|value| value == "--strict-config"));
        let denied: Vec<&str> = actual[2..actual.len() - 2]
            .chunks_exact(2)
            .map(|pair| {
                assert_eq!(pair[0], "--disable");
                pair[1].as_str()
            })
            .collect();
        assert_eq!(denied, expected_denied);
        assert_eq!(&actual[actual.len() - 2..], ["-c", "mcp_servers={}"]);
    }

    #[test]
    fn codex_features_require_all_denied_features_to_be_present_and_false() {
        assert!(evaluate_codex_features(SAFE_CODEX_FEATURES).compatible);

        let installed_stage_shape = SAFE_CODEX_FEATURES.replace(
            "code_mode experimental false",
            "code_mode under development false",
        );
        assert!(evaluate_codex_features(&installed_stage_shape).compatible);

        let enabled_shell =
            SAFE_CODEX_FEATURES.replace("shell_tool stable false", "shell_tool stable true");
        let evaluation = evaluate_codex_features(&enabled_shell);

        assert!(!evaluation.compatible);
        assert_eq!(evaluation.reason, Some(CODEX_FEATURES_REASON));
    }

    #[test]
    fn codex_features_allow_enabled_connection_retry_policy() {
        let installed_output =
            format!("{SAFE_CODEX_FEATURES}unbounded_connection_retries stable true\n");

        assert!(evaluate_codex_features(&installed_output).compatible);
    }

    #[test]
    fn codex_features_reject_unknown_enabled_or_malformed_rows() {
        let unknown = format!("{SAFE_CODEX_FEATURES}future_tool stable true\n");
        assert!(!evaluate_codex_features(&unknown).compatible);
        assert!(!evaluate_codex_features("future_tool stable maybe\n").compatible);
        assert!(!evaluate_codex_features("shell_tool false\n").compatible);
        assert!(!evaluate_codex_features("\n").compatible);
    }

    #[test]
    fn open_code_help_requires_pure_json_run_and_pure_resolved_config() {
        assert!(evaluate_opencode_help(OPEN_CODE_RUN_HELP, OPEN_CODE_DEBUG_CONFIG_HELP).compatible);

        let renamed_dir = OPEN_CODE_RUN_HELP.replace("--dir", "--directory");
        assert!(!evaluate_opencode_help(&renamed_dir, OPEN_CODE_DEBUG_CONFIG_HELP).compatible);
        let no_json = OPEN_CODE_RUN_HELP.replace("default or json", "default or text");
        assert!(!evaluate_opencode_help(&no_json, OPEN_CODE_DEBUG_CONFIG_HELP).compatible);
    }

    #[test]
    fn open_code_effective_permissions_require_wildcard_and_every_named_deny() {
        assert!(opencode_permissions_are_denied(
            &fully_denied_open_code_config()
        ));
        assert!(!opencode_permissions_are_denied(&json!({
            "permission": {"*": "deny", "bash": "allow"}
        })));

        let mut future_override = fully_denied_open_code_config();
        future_override["permission"]["future_capability"] = json!("allow");
        assert!(!opencode_permissions_are_denied(&future_override));

        let mut missing_required = fully_denied_open_code_config();
        missing_required["permission"]
            .as_object_mut()
            .unwrap()
            .remove("websearch");
        assert!(!opencode_permissions_are_denied(&missing_required));
    }

    #[test]
    fn open_code_rejects_agent_permission_overrides_at_every_depth() {
        let mut direct = fully_denied_open_code_config();
        direct["agent"]["build"] = json!({"permission": {"bash": "allow"}});
        assert!(!opencode_permissions_are_denied(&direct));

        let mut nested = fully_denied_open_code_config();
        nested["agent"]["build"] = json!({
            "permission": {"bash": {"*": "allow"}}
        });
        assert!(!opencode_permissions_are_denied(&nested));

        let mut mixed_pattern = fully_denied_open_code_config();
        mixed_pattern["agent"]["build"] = json!({
            "permission": {"bash": {"*": "deny", "git *": "allow"}}
        });
        assert!(!opencode_permissions_are_denied(&mixed_pattern));
    }

    #[test]
    fn open_code_rejects_enabled_global_or_agent_legacy_tools() {
        let mut global = fully_denied_open_code_config();
        global["tools"]["edit"] = json!(true);
        assert!(!opencode_permissions_are_denied(&global));

        let mut agent = fully_denied_open_code_config();
        agent["agent"]["markdowner"]["tools"]["edit"] = json!(true);
        assert!(!opencode_permissions_are_denied(&agent));

        let mut nested = fully_denied_open_code_config();
        nested["agent"]["build"] = json!({"tools": {"group": {"edit": true}}});
        assert!(!opencode_permissions_are_denied(&nested));
    }

    #[test]
    fn open_code_rejects_builtin_custom_or_legacy_default_agent_overrides() {
        let mut builtin = fully_denied_open_code_config();
        builtin["default_agent"] = json!("build");
        assert!(!opencode_permissions_are_denied(&builtin));

        let mut custom = fully_denied_open_code_config();
        custom["default_agent"] = json!("custom");
        custom["agent"]["custom"] = json!({
            "mode": "primary",
            "permission": {"*": "deny"},
            "tools": {"*": false}
        });
        assert!(!opencode_permissions_are_denied(&custom));

        let mut legacy_mode = fully_denied_open_code_config();
        legacy_mode["mode"] = json!({
            "build": {"permission": {"bash": "allow"}}
        });
        assert!(!opencode_permissions_are_denied(&legacy_mode));
    }

    #[test]
    fn open_code_accepts_only_fully_denied_pattern_and_agent_overrides() {
        let mut config = fully_denied_open_code_config();
        config["permission"]["bash"] = json!({"*": "deny", "git *": "deny"});
        config["agent"]["markdowner"]["permission"]["bash"] = json!({"*": "deny", "git *": "deny"});
        config["agent"]["markdowner"]["options"] = json!({});

        assert!(opencode_permissions_are_denied(&config));
    }

    #[test]
    fn open_code_rejects_external_config_execution_surfaces_and_custom_agents() {
        for (field, value) in [
            ("mcp", json!({"external": {"type": "local"}})),
            ("instructions", json!(["unsafe.md"])),
            ("prompt", json!("override")),
            ("rules", json!(["rules.md"])),
            ("plugin", json!(["unsafe-plugin"])),
            ("plugins", json!(["unsafe-plugin"])),
            ("hooks", json!({"event": ["command"]})),
            ("command", json!({"unsafe": {"template": "do it"}})),
            ("commands", json!({"unsafe": {"template": "do it"}})),
        ] {
            let mut config = fully_denied_open_code_config();
            config[field] = value;
            assert!(
                !opencode_permissions_are_denied(&config),
                "active OpenCode config surface {field} was accepted"
            );
        }

        let mut custom_agent = fully_denied_open_code_config();
        custom_agent["agent"]["review"] = json!({
            "mode": "subagent",
            "permission": {"*": "deny"},
            "tools": {"*": false}
        });
        assert!(!opencode_permissions_are_denied(&custom_agent));

        let mut agent_prompt = fully_denied_open_code_config();
        agent_prompt["agent"]["markdowner"]["prompt"] = json!("override");
        assert!(!opencode_permissions_are_denied(&agent_prompt));

        let mut agent_options = fully_denied_open_code_config();
        agent_options["agent"]["markdowner"]["options"] = json!({"unsafe": true});
        assert!(!opencode_permissions_are_denied(&agent_options));

        let mut extra_tool_override = fully_denied_open_code_config();
        extra_tool_override["tools"]["future"] = json!(false);
        assert!(!opencode_permissions_are_denied(&extra_tool_override));
    }

    #[test]
    #[cfg(unix)]
    fn bounded_runner_kills_pipe_holding_descendants_after_parent_exit() {
        let temp = tempdir().unwrap();
        let script = temp.path().join("probe");
        let pid_file = temp.path().join("descendant.pid");
        create_executable_script(
            &script,
            "#!/bin/sh\n(/bin/sleep 30) &\ndescendant=$!\nprintf '%s' \"$descendant\" > \"$1\"\nexit 0\n",
        );

        let started = Instant::now();
        let error = match BoundedProbeRunner.run(&script, &[pid_file.as_os_str().to_owned()], &[]) {
            Err(error) => error,
            Ok(_) => panic!("pipe-holding probe unexpectedly succeeded"),
        };
        let pid: i32 = fs::read_to_string(&pid_file).unwrap().parse().unwrap();
        let disappeared = process_disappears(pid, Duration::from_millis(500));
        if !disappeared {
            kill_test_process(pid);
        }

        assert_eq!(error, LocalAgentError::ProbeTimedOut);
        assert!(!process_exists(pid), "probe returned before group exit");
        assert!(started.elapsed() < Duration::from_secs(7));
        assert!(disappeared, "pipe-holding descendant survived timeout");
        assert!(
            !error
                .reason()
                .contains(temp.path().to_string_lossy().as_ref())
        );
    }

    #[test]
    #[cfg(unix)]
    fn successful_probe_confirms_closed_pipe_descendants_are_gone_before_returning() {
        let temp = tempdir().unwrap();
        let script = temp.path().join("probe");
        let pid_file = temp.path().join("descendant.pid");
        create_executable_script(
            &script,
            "#!/bin/sh\n(/bin/sleep 30 </dev/null >/dev/null 2>&1) &\ndescendant=$!\nprintf '%s' \"$descendant\" > \"$1\"\nprintf ok\n",
        );

        let output = BoundedProbeRunner
            .run(&script, &[pid_file.as_os_str().to_owned()], &[])
            .unwrap();
        let pid: i32 = fs::read_to_string(&pid_file).unwrap().parse().unwrap();

        assert!(output.success);
        assert_eq!(output.stdout, b"ok");
        assert!(!process_exists(pid), "probe returned before group exit");
    }

    #[test]
    #[cfg(unix)]
    fn bounded_runner_kills_descendants_when_probe_output_exceeds_the_cap() {
        let temp = tempdir().unwrap();
        let script = temp.path().join("probe");
        let pid_file = temp.path().join("descendant.pid");
        create_executable_script(
            &script,
            "#!/bin/sh\n(/bin/sleep 30) &\ndescendant=$!\nprintf '%s' \"$descendant\" > \"$1\"\n/usr/bin/yes x | /usr/bin/head -c 300000\nexit 0\n",
        );

        let error = match BoundedProbeRunner.run(&script, &[pid_file.as_os_str().to_owned()], &[]) {
            Err(error) => error,
            Ok(_) => panic!("oversized probe unexpectedly succeeded"),
        };
        let pid: i32 = fs::read_to_string(&pid_file).unwrap().parse().unwrap();
        let disappeared = process_disappears(pid, Duration::from_millis(500));
        if !disappeared {
            kill_test_process(pid);
        }

        assert_eq!(error, LocalAgentError::ProbeOutputTooLarge);
        assert!(!process_exists(pid), "probe returned before group exit");
        assert!(
            disappeared,
            "probe descendant survived output-limit failure"
        );
    }

    #[test]
    #[cfg(unix)]
    fn pre_cancelled_probe_does_not_spawn_the_fake_executable() {
        let temp = tempdir().unwrap();
        let script = temp.path().join("probe");
        let marker = temp.path().join("spawned");
        create_executable_script(&script, "#!/bin/sh\n/usr/bin/touch \"$1\"\n");
        let cancellation = CancellationToken::new();
        cancellation.cancel();
        let runner = CancellableProbeRunner {
            cancellation: &cancellation,
            deadline: Instant::now() + PROBE_TIMEOUT,
        };

        let error = match runner.run(&script, &[marker.as_os_str().to_owned()], &[]) {
            Err(error) => error,
            Ok(_) => panic!("pre-cancelled probe unexpectedly spawned"),
        };

        assert_eq!(
            error,
            LocalAgentError::run(
                "local_agent_cancelled",
                "The local agent request was cancelled."
            )
        );
        assert!(!marker.exists());
    }

    #[test]
    #[cfg(unix)]
    fn cancellation_kills_a_pipe_holding_probe_group_without_waiting_for_timeout() {
        let temp = tempdir().unwrap();
        let script = temp.path().join("probe");
        let pid_file = temp.path().join("descendant.pid");
        create_executable_script(
            &script,
            "#!/bin/sh\n(/bin/sleep 30) &\ndescendant=$!\nprintf '%s' \"$descendant\" > \"$1\"\nexit 0\n",
        );
        let cancellation = CancellationToken::new();
        let runner_cancellation = cancellation.clone();
        let runner_script = script.clone();
        let runner_pid_file = pid_file.clone();
        let started = Instant::now();
        let probe = thread::spawn(move || {
            CancellableProbeRunner {
                cancellation: &runner_cancellation,
                deadline: Instant::now() + PROBE_TIMEOUT,
            }
            .run(
                &runner_script,
                &[runner_pid_file.as_os_str().to_owned()],
                &[],
            )
        });
        let marker_deadline = Instant::now() + Duration::from_secs(1);
        while !pid_file.exists() && Instant::now() < marker_deadline {
            thread::sleep(Duration::from_millis(5));
        }
        assert!(
            pid_file.exists(),
            "fake probe did not publish its descendant PID"
        );

        cancellation.cancel();
        let error = match probe.join().unwrap() {
            Err(error) => error,
            Ok(_) => panic!("cancelled probe unexpectedly succeeded"),
        };
        let pid: i32 = fs::read_to_string(&pid_file).unwrap().parse().unwrap();
        let disappeared = process_disappears(pid, Duration::from_millis(500));
        if !disappeared {
            kill_test_process(pid);
        }

        assert_eq!(
            error,
            LocalAgentError::run(
                "local_agent_cancelled",
                "The local agent request was cancelled."
            )
        );
        assert!(!process_exists(pid), "probe returned before group exit");
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(disappeared, "cancelled probe descendant survived");
    }

    #[test]
    #[cfg(unix)]
    fn command_deadline_caps_a_probe_below_the_default_probe_timeout() {
        let temp = tempdir().unwrap();
        let script = temp.path().join("probe");
        create_executable_script(&script, "#!/bin/sh\n/bin/sleep 30\n");
        let cancellation = CancellationToken::new();
        let runner = CancellableProbeRunner {
            cancellation: &cancellation,
            deadline: Instant::now() + Duration::from_millis(50),
        };
        let started = Instant::now();

        let error = match runner.run(&script, &[], &[]) {
            Err(error) => error,
            Ok(_) => panic!("deadline-bounded probe unexpectedly succeeded"),
        };

        assert_eq!(error, LocalAgentError::ProbeTimedOut);
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    #[cfg(unix)]
    fn executable_proof_rejects_files_above_the_identity_hash_limit() {
        let temp = tempdir().unwrap();
        let executable = temp.path().join("claude");
        create_executable(&executable);
        fs::OpenOptions::new()
            .write(true)
            .open(&executable)
            .unwrap()
            .set_len(MAX_EXECUTABLE_BYTES + 1)
            .unwrap();
        let executable = executable.canonicalize().unwrap();

        let error = match ExecutableProof::capture(&executable) {
            Err(error) => error,
            Ok(_) => panic!("oversized executable unexpectedly received a proof"),
        };

        assert_eq!(error, LocalAgentError::ProbeFailed);
    }

    #[test]
    #[cfg(unix)]
    fn executable_proof_rejects_group_or_world_writable_leaf_files() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempdir().unwrap();
        for (name, mode) in [("group-writable", 0o775), ("world-writable", 0o777)] {
            let executable = temp.path().join(name);
            create_executable_bytes(&executable, b"native-fake");
            fs::set_permissions(&executable, fs::Permissions::from_mode(mode)).unwrap();
            let executable = executable.canonicalize().unwrap();

            let error = match ExecutableProof::capture(&executable) {
                Err(error) => error,
                Ok(_) => panic!("mode {mode:o} executable unexpectedly received a proof"),
            };

            assert_eq!(error, LocalAgentError::ProbeFailed);
        }
    }

    #[test]
    #[cfg(unix)]
    fn executable_proof_accepts_private_and_read_only_shared_leaf_modes() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempdir().unwrap();
        for (name, mode) in [("private", 0o700), ("shared-read-only", 0o755)] {
            let executable = temp.path().join(name);
            create_executable_bytes(&executable, b"native-fake");
            fs::set_permissions(&executable, fs::Permissions::from_mode(mode)).unwrap();
            let executable = executable.canonicalize().unwrap();

            ExecutableProof::capture(&executable)
                .unwrap_or_else(|_| panic!("mode {mode:o} executable was rejected"));
        }
    }

    #[test]
    #[cfg(unix)]
    fn executable_proof_accepts_a_read_only_leaf_below_a_user_owned_group_writable_directory() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempdir().unwrap();
        let homebrew_bin = temp.path().join("homebrew-bin");
        fs::create_dir(&homebrew_bin).unwrap();
        fs::set_permissions(&homebrew_bin, fs::Permissions::from_mode(0o775)).unwrap();
        let executable = homebrew_bin.join("claude");
        create_executable_bytes(&executable, b"native-fake");
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();

        ExecutableProof::capture(&executable.canonicalize().unwrap())
            .expect("a read-only executable in a user-owned Homebrew-style directory is trusted");
    }

    #[test]
    #[cfg(unix)]
    fn executable_leaf_policy_rejects_owners_other_than_root_or_the_effective_user() {
        let effective_uid = unsafe { libc::geteuid() };
        let unrelated_owner = [1, 2, u32::MAX]
            .into_iter()
            .find(|owner| *owner != 0 && *owner != effective_uid)
            .unwrap();

        assert!(super::executable_leaf_is_trusted(0, 0o755, effective_uid));
        assert!(super::executable_leaf_is_trusted(
            effective_uid,
            0o700,
            effective_uid
        ));
        assert!(!super::executable_leaf_is_trusted(
            unrelated_owner,
            0o755,
            effective_uid
        ));
    }

    struct CancellingHashReader {
        cancellation: CancellationToken,
        returned_chunk: bool,
    }

    impl Read for CancellingHashReader {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            if self.returned_chunk {
                return Ok(0);
            }
            let read = buffer.len().min(64);
            buffer[..read].fill(b'x');
            self.returned_chunk = true;
            self.cancellation.cancel();
            Ok(read)
        }
    }

    #[test]
    fn executable_hashing_observes_cancellation_between_chunks() {
        let cancellation = CancellationToken::new();
        let mut reader = CancellingHashReader {
            cancellation: cancellation.clone(),
            returned_chunk: false,
        };

        let error = executable_sha256(
            &mut reader,
            Some(&cancellation),
            Some(Instant::now() + Duration::from_secs(1)),
        )
        .unwrap_err();

        assert_eq!(
            error,
            LocalAgentError::run(
                "local_agent_cancelled",
                "The local agent request was cancelled."
            )
        );
    }

    #[test]
    fn executable_hashing_rejects_growth_beyond_the_captured_length() {
        let mut bytes = &b"abcd"[..];

        let error = executable_sha256_exact(&mut bytes, 3, 0, None, None).unwrap_err();

        assert_eq!(error, LocalAgentError::ProbeFailed);
    }

    #[test]
    #[cfg(unix)]
    fn bounded_runner_drops_unsafe_ambient_environment_and_applies_fixed_overrides() {
        let allowed = [
            "HOME", "PATH", "LANG", "LC_ALL", "TMPDIR", "PWD", "SHLVL", "_",
        ];
        let unsafe_name = std::env::vars()
            .map(|(name, _)| name)
            .find(|name| !allowed.contains(&name.as_str()))
            .expect("the test process should have an ambient variable outside the allowlist");
        let temp = tempdir().unwrap();
        let script = temp.path().join("probe");
        create_executable_script(&script, "#!/bin/sh\n/usr/bin/env\n");

        let output = BoundedProbeRunner
            .run(
                &script,
                &[],
                &[(
                    OsString::from("MARKDOWNER_PROBE_TEST_FIXED"),
                    OsString::from("fixed"),
                )],
            )
            .unwrap();
        let environment = String::from_utf8(output.stdout).unwrap();

        assert!(
            environment
                .lines()
                .any(|line| line == "MARKDOWNER_PROBE_TEST_FIXED=fixed")
        );
        assert!(
            !environment
                .lines()
                .any(|line| line.starts_with(&format!("{unsafe_name}="))),
            "unsafe ambient variable {unsafe_name} reached the probe"
        );
        let pwd = environment
            .lines()
            .find_map(|line| line.strip_prefix("PWD="))
            .unwrap();
        let tmpdir = environment
            .lines()
            .find_map(|line| line.strip_prefix("TMPDIR="))
            .unwrap();
        assert_eq!(pwd, tmpdir);
        assert_ne!(Path::new(pwd), std::env::current_dir().unwrap());
        assert!(Path::new(pwd).starts_with(std::env::temp_dir().canonicalize().unwrap()));
        assert!(!Path::new(pwd).exists());
    }

    struct CompatibleOpenCodeRunner {
        environments: Mutex<Vec<Vec<(OsString, OsString)>>>,
    }

    impl ProbeRunner for CompatibleOpenCodeRunner {
        fn run(
            &self,
            _executable: &Path,
            _args: &[OsString],
            environment: &[(OsString, OsString)],
        ) -> Result<ProbeOutput, LocalAgentError> {
            let environment_map: BTreeMap<OsString, OsString> =
                environment.iter().cloned().collect();
            let xdg_paths: Vec<&Path> = [
                "XDG_CONFIG_HOME",
                "XDG_CACHE_HOME",
                "XDG_DATA_HOME",
                "XDG_STATE_HOME",
            ]
            .into_iter()
            .map(|name| Path::new(environment_map.get(OsStr::new(name)).unwrap()))
            .collect();
            let root = xdg_paths[0].parent().unwrap();
            for path in &xdg_paths {
                assert_eq!(path.parent(), Some(root));
                assert!(path.is_dir());
                assert!(fs::read_dir(path).unwrap().next().is_none());
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;

                    assert_eq!(
                        fs::metadata(path).unwrap().permissions().mode() & 0o777,
                        0o700
                    );
                }
            }
            assert_eq!(
                environment_map.get(OsStr::new("OPENCODE_DISABLE_CLAUDE_CODE")),
                Some(&OsString::from("1"))
            );
            assert_eq!(
                environment_map.get(OsStr::new("OPENCODE_DISABLE_DEFAULT_PLUGINS")),
                Some(&OsString::from("true"))
            );
            let mut environments = self.environments.lock().unwrap();
            let stdout = match environments.len() {
                0 => b"opencode 1.2.3\n".to_vec(),
                1 => OPEN_CODE_RUN_HELP.as_bytes().to_vec(),
                2 => OPEN_CODE_DEBUG_CONFIG_HELP.as_bytes().to_vec(),
                3 => fully_denied_open_code_config().to_string().into_bytes(),
                _ => panic!("unexpected extra OpenCode probe"),
            };
            environments.push(environment.to_vec());
            Ok(ProbeOutput {
                success: true,
                stdout,
                stderr: Vec::new(),
            })
        }
    }

    #[test]
    #[cfg(unix)]
    fn every_open_code_probe_applies_the_owned_fixed_environment() {
        let temp = tempdir().unwrap();
        let executable = temp.path().join("opencode");
        create_executable(&executable);
        let resolved = ResolvedAgent {
            kind: LocalAgentKind::Opencode,
            path: executable.canonicalize().unwrap(),
            path_label: "bin/opencode".to_string(),
        };
        let runner = CompatibleOpenCodeRunner {
            environments: Mutex::new(Vec::new()),
        };

        probe_agent(&resolved, &runner).unwrap();

        let expected: BTreeMap<OsString, OsString> =
            owned_opencode_environment().into_iter().collect();
        let environments = runner.environments.lock().unwrap();
        assert_eq!(environments.len(), 4);
        for environment in environments.iter() {
            let environment: BTreeMap<OsString, OsString> = environment.iter().cloned().collect();
            for (name, value) in &expected {
                assert_eq!(environment.get(name), Some(value));
            }
            assert!(environment.contains_key(OsStr::new("PATH")));
            assert_eq!(
                environment.get(OsStr::new("OPENCODE_DISABLE_CLAUDE_CODE")),
                Some(&OsString::from("1"))
            );
            assert_eq!(
                environment.get(OsStr::new("OPENCODE_DISABLE_DEFAULT_PLUGINS")),
                Some(&OsString::from("true"))
            );
            for name in [
                "XDG_CONFIG_HOME",
                "XDG_CACHE_HOME",
                "XDG_DATA_HOME",
                "XDG_STATE_HOME",
            ] {
                let path = Path::new(environment.get(OsStr::new(name)).unwrap());
                assert!(!path.exists(), "OpenCode probe isolation leaked {name}");
            }
            assert_eq!(environment.len(), expected.len() + 7);
        }
        let config_homes: std::collections::HashSet<&OsString> = environments
            .iter()
            .map(|environment| {
                environment
                    .iter()
                    .find(|(name, _)| name.as_os_str() == OsStr::new("XDG_CONFIG_HOME"))
                    .map(|(_, value)| value)
                    .unwrap()
            })
            .collect();
        assert_eq!(config_homes.len(), 4);
    }

    struct CompatibleClaudeRunner {
        environments: Mutex<Vec<Vec<(OsString, OsString)>>>,
    }

    impl ProbeRunner for CompatibleClaudeRunner {
        fn run(
            &self,
            _executable: &Path,
            _args: &[OsString],
            environment: &[(OsString, OsString)],
        ) -> Result<ProbeOutput, LocalAgentError> {
            let environment_map: BTreeMap<OsString, OsString> =
                environment.iter().cloned().collect();
            let root_names = [
                "HOME",
                "CLAUDE_CONFIG_DIR",
                "XDG_CONFIG_HOME",
                "XDG_CACHE_HOME",
                "XDG_DATA_HOME",
                "XDG_STATE_HOME",
            ];
            let paths =
                root_names.map(|name| Path::new(environment_map.get(OsStr::new(name)).unwrap()));
            let root = paths[0].parent().unwrap();
            for path in paths {
                use std::os::unix::fs::PermissionsExt;

                assert_eq!(path.parent(), Some(root));
                assert!(path.is_dir());
                assert!(fs::read_dir(path).unwrap().next().is_none());
                assert_eq!(
                    fs::metadata(path).unwrap().permissions().mode() & 0o777,
                    0o700
                );
            }
            for name in [
                "CLAUDE_CODE_SAFE_MODE",
                "CLAUDE_CODE_DISABLE_AUTO_MEMORY",
                "CLAUDE_CODE_DISABLE_CLAUDE_MDS",
                "CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS",
            ] {
                assert_eq!(
                    environment_map.get(OsStr::new(name)),
                    Some(&OsString::from("1"))
                );
            }
            let mut environments = self.environments.lock().unwrap();
            let stdout = match environments.len() {
                0 => b"claude 2.1.226\n".to_vec(),
                1 => CLAUDE_HELP.as_bytes().to_vec(),
                _ => panic!("unexpected extra Claude probe"),
            };
            environments.push(environment.to_vec());
            Ok(ProbeOutput {
                success: true,
                stdout,
                stderr: Vec::new(),
            })
        }
    }

    #[test]
    #[cfg(unix)]
    fn every_claude_probe_uses_private_config_roots_and_fixed_controls() {
        let temp = tempdir().unwrap();
        let executable = temp.path().join("claude");
        create_executable(&executable);
        let resolved = ResolvedAgent {
            kind: LocalAgentKind::Claude,
            path: executable.canonicalize().unwrap(),
            path_label: "bin/claude".to_string(),
        };
        let runner = CompatibleClaudeRunner {
            environments: Mutex::new(Vec::new()),
        };

        probe_agent(&resolved, &runner).unwrap();

        let environments = runner.environments.lock().unwrap();
        assert_eq!(environments.len(), 2);
        let homes = environments
            .iter()
            .map(|environment| {
                environment
                    .iter()
                    .find(|(name, _)| name == OsStr::new("HOME"))
                    .map(|(_, value)| value)
                    .unwrap()
            })
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(homes.len(), 2);
        for home in homes {
            assert!(!Path::new(home).exists());
        }
    }

    struct PathSubstitutingClaudeRunner {
        calls: Mutex<usize>,
    }

    impl ProbeRunner for PathSubstitutingClaudeRunner {
        fn run(
            &self,
            executable: &Path,
            _args: &[OsString],
            _environment: &[(OsString, OsString)],
        ) -> Result<ProbeOutput, LocalAgentError> {
            let mut calls = self.calls.lock().unwrap();
            let output = if *calls == 0 {
                let displaced = executable.with_extension("displaced");
                fs::rename(executable, displaced).unwrap();
                create_executable_script(executable, "#!/bin/sh\nexit 9\n");
                b"claude 2.1.226\n".to_vec()
            } else {
                CLAUDE_HELP.as_bytes().to_vec()
            };
            *calls += 1;
            Ok(ProbeOutput {
                success: true,
                stdout: output,
                stderr: Vec::new(),
            })
        }
    }

    #[test]
    #[cfg(unix)]
    fn capability_probe_rejects_pathname_substitution_after_version_probe() {
        let temp = tempdir().unwrap();
        let executable = temp.path().join("claude");
        create_executable_script(&executable, "#!/bin/sh\nexit 0\n");
        let resolved = ResolvedAgent {
            kind: LocalAgentKind::Claude,
            path: executable.canonicalize().unwrap(),
            path_label: "bin/claude".to_string(),
        };
        let runner = PathSubstitutingClaudeRunner {
            calls: Mutex::new(0),
        };

        let error = probe_agent(&resolved, &runner).unwrap_err();

        assert_eq!(error, LocalAgentError::ProbeFailed);
        assert_eq!(*runner.calls.lock().unwrap(), 1);
    }

    struct SameInodeMutatingClaudeRunner {
        calls: Mutex<usize>,
    }

    impl ProbeRunner for SameInodeMutatingClaudeRunner {
        fn run(
            &self,
            executable: &Path,
            _args: &[OsString],
            _environment: &[(OsString, OsString)],
        ) -> Result<ProbeOutput, LocalAgentError> {
            let mut calls = self.calls.lock().unwrap();
            let output = if *calls == 0 {
                fs::write(executable, "#!/bin/sh\nexit 9\n").unwrap();
                b"claude 2.1.226\n".to_vec()
            } else {
                CLAUDE_HELP.as_bytes().to_vec()
            };
            *calls += 1;
            Ok(ProbeOutput {
                success: true,
                stdout: output,
                stderr: Vec::new(),
            })
        }
    }

    #[test]
    #[cfg(unix)]
    fn capability_probe_rejects_same_inode_content_mutation_after_version_probe() {
        use std::os::unix::fs::MetadataExt;

        let temp = tempdir().unwrap();
        let executable = temp.path().join("claude");
        create_executable_script(&executable, "#!/bin/sh\nexit 0\n");
        let inode = fs::metadata(&executable).unwrap().ino();
        let resolved = ResolvedAgent {
            kind: LocalAgentKind::Claude,
            path: executable.canonicalize().unwrap(),
            path_label: "bin/claude".to_string(),
        };
        let runner = SameInodeMutatingClaudeRunner {
            calls: Mutex::new(0),
        };

        let error = probe_agent(&resolved, &runner).unwrap_err();

        assert_eq!(fs::metadata(executable).unwrap().ino(), inode);
        assert_eq!(error, LocalAgentError::ProbeFailed);
        assert_eq!(*runner.calls.lock().unwrap(), 1);
    }

    struct InterpreterMutatingClaudeRunner {
        calls: Mutex<usize>,
        interpreter: PathBuf,
    }

    impl ProbeRunner for InterpreterMutatingClaudeRunner {
        fn run(
            &self,
            _executable: &Path,
            _args: &[OsString],
            _environment: &[(OsString, OsString)],
        ) -> Result<ProbeOutput, LocalAgentError> {
            let mut calls = self.calls.lock().unwrap();
            let output = if *calls == 0 {
                fs::write(&self.interpreter, "#!/bin/sh\nexit 9\n").unwrap();
                b"claude 2.1.226\n".to_vec()
            } else {
                CLAUDE_HELP.as_bytes().to_vec()
            };
            *calls += 1;
            Ok(ProbeOutput {
                success: true,
                stdout: output,
                stderr: Vec::new(),
            })
        }
    }

    #[test]
    #[cfg(unix)]
    fn capability_probe_rejects_env_interpreter_content_mutation() {
        let temp = tempdir().unwrap();
        let bin = temp.path().join("bin");
        fs::create_dir(&bin).unwrap();
        let interpreter = bin.join("node");
        create_executable_script(&interpreter, "#!/bin/sh\nexit 0\n");
        let executable = bin.join("claude");
        create_executable_script(&executable, "#!/usr/bin/env node\n");
        let executable = executable.canonicalize().unwrap();
        let proof = ExecutableProof::capture_with_constraints(
            &executable,
            std::env::join_paths([&bin]).unwrap(),
            None,
            None,
        )
        .unwrap();
        let resolved = ResolvedAgent {
            kind: LocalAgentKind::Claude,
            path: executable,
            path_label: "bin/claude".to_string(),
        };
        let runner = InterpreterMutatingClaudeRunner {
            calls: Mutex::new(0),
            interpreter,
        };

        let error = probe_agent_with_proof(&resolved, &proof, &runner, None, None).unwrap_err();

        assert_eq!(error, LocalAgentError::ProbeFailed);
        assert_eq!(*runner.calls.lock().unwrap(), 1);
    }

    #[test]
    #[cfg(unix)]
    fn executable_proof_rejects_an_earlier_env_interpreter_path_substitution() {
        let temp = tempdir().unwrap();
        let first = temp.path().join("first");
        let second = temp.path().join("second");
        fs::create_dir(&first).unwrap();
        fs::create_dir(&second).unwrap();
        create_executable_script(&second.join("node"), "#!/bin/sh\nexit 0\n");
        let executable = temp.path().join("claude");
        create_executable_script(&executable, "#!/usr/bin/env node\n");
        let executable = executable.canonicalize().unwrap();
        let proof = ExecutableProof::capture_with_constraints(
            &executable,
            std::env::join_paths([&first, &second]).unwrap(),
            None,
            None,
        )
        .unwrap();

        create_executable_script(&first.join("node"), "#!/bin/sh\nexit 9\n");

        assert_eq!(
            proof.verify_path(&executable),
            Err(LocalAgentError::ProbeFailed)
        );
    }

    #[test]
    #[cfg(unix)]
    fn executable_proof_rejects_arbitrary_env_shebang_targets() {
        let temp = tempdir().unwrap();
        for (name, shebang) in [
            ("exact", "#!/usr/bin/env python\n"),
            ("alias", "#!/usr/bin/../bin/env python\n"),
        ] {
            let executable = temp.path().join(name);
            create_executable_script(&executable, shebang);
            let executable = executable.canonicalize().unwrap();

            let error = match ExecutableProof::capture_with_constraints(
                &executable,
                std::env::join_paths([temp.path()]).unwrap(),
                None,
                None,
            ) {
                Err(error) => error,
                Ok(_) => panic!("arbitrary env target unexpectedly received a proof"),
            };

            assert_eq!(error, LocalAgentError::ProbeFailed);
        }
    }

    #[test]
    fn shebang_parsing_matches_macos_end_and_whitespace_rules() {
        let parsed = parse_shebang_interpreter(b"#!/safe/runtime#ignored\n")
            .unwrap()
            .unwrap();
        assert_eq!(parsed.interpreter, Path::new("/safe/runtime"));
        assert!(parsed.arguments.is_empty());

        assert!(
            parse_shebang_interpreter(b"#!/usr/bin/env node\r\n").is_err(),
            "carriage return must not be treated as macOS shebang whitespace"
        );
        assert!(
            parse_shebang_interpreter(b"#!/usr/bin/env\x0bnode\n").is_err(),
            "vertical tab must not be treated as macOS shebang whitespace"
        );
    }

    #[test]
    #[cfg(unix)]
    fn executable_proof_recursively_pins_a_scripted_env_target_interpreter() {
        let temp = tempdir().unwrap();
        let bin = temp.path().join("bin");
        fs::create_dir(&bin).unwrap();
        let nested_interpreter = temp.path().join("runtime");
        create_executable_bytes(&nested_interpreter, b"native-runtime-v1");
        let node = bin.join("node");
        create_executable_script(
            &node,
            &format!("#!{}\n", nested_interpreter.to_string_lossy()),
        );
        let executable = temp.path().join("claude");
        create_executable_script(&executable, "#!/usr/bin/env node\n");
        let executable = executable.canonicalize().unwrap();
        let proof = ExecutableProof::capture_with_constraints(
            &executable,
            std::env::join_paths([&bin]).unwrap(),
            None,
            None,
        )
        .unwrap();

        fs::write(&nested_interpreter, b"native-runtime-v2").unwrap();

        assert_eq!(
            proof.verify_path(&executable),
            Err(LocalAgentError::ProbeFailed)
        );
    }

    #[test]
    #[cfg(unix)]
    fn executable_proof_rejects_a_group_writable_env_target_interpreter() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempdir().unwrap();
        let bin = temp.path().join("bin");
        fs::create_dir(&bin).unwrap();
        let node = bin.join("node");
        create_executable_bytes(&node, b"native-runtime");
        fs::set_permissions(&node, fs::Permissions::from_mode(0o775)).unwrap();
        let executable = temp.path().join("claude");
        create_executable_script(&executable, "#!/usr/bin/env node\n");
        let executable = executable.canonicalize().unwrap();

        let error = match ExecutableProof::capture_with_constraints(
            &executable,
            std::env::join_paths([&bin]).unwrap(),
            None,
            None,
        ) {
            Err(error) => error,
            Ok(_) => panic!("group-writable interpreter unexpectedly received a proof"),
        };

        assert_eq!(error, LocalAgentError::ProbeFailed);
    }

    struct TimeoutRunner;

    impl ProbeRunner for TimeoutRunner {
        fn run(
            &self,
            _executable: &Path,
            _args: &[OsString],
            _env: &[(OsString, OsString)],
        ) -> Result<ProbeOutput, LocalAgentError> {
            Err(LocalAgentError::ProbeTimedOut)
        }
    }

    struct OversizedShellRunner;

    impl ProbeRunner for OversizedShellRunner {
        fn run(
            &self,
            _executable: &Path,
            _args: &[OsString],
            _env: &[(OsString, OsString)],
        ) -> Result<ProbeOutput, LocalAgentError> {
            Ok(ProbeOutput {
                success: true,
                stdout: vec![b'x'; LOGIN_SHELL_PATH_LIMIT + 1],
                stderr: Vec::new(),
            })
        }
    }

    type ProbeCall = (PathBuf, Vec<OsString>, Vec<(OsString, OsString)>);

    struct ShellOutputRunner {
        success: bool,
        stdout: Vec<u8>,
        calls: Mutex<Vec<ProbeCall>>,
    }

    fn framed_login_path(path: &[u8]) -> Vec<u8> {
        [
            LOGIN_SHELL_PATH_BEGIN.as_bytes(),
            b"\n",
            path,
            b"\n",
            LOGIN_SHELL_PATH_END.as_bytes(),
            b"\n",
        ]
        .concat()
    }

    impl ProbeRunner for ShellOutputRunner {
        fn run(
            &self,
            executable: &Path,
            args: &[OsString],
            environment: &[(OsString, OsString)],
        ) -> Result<ProbeOutput, LocalAgentError> {
            self.calls.lock().unwrap().push((
                executable.to_path_buf(),
                args.to_vec(),
                environment.to_vec(),
            ));
            Ok(ProbeOutput {
                success: self.success,
                stdout: self.stdout.clone(),
                stderr: Vec::new(),
            })
        }
    }

    #[test]
    fn login_shell_path_uses_fixed_arguments_after_gui_path_and_deduplicates() {
        let temp = tempdir().unwrap();
        let gui_bin = temp.path().join("gui-bin");
        let login_bin = temp.path().join("login-bin");
        fs::create_dir_all(&gui_bin).unwrap();
        fs::create_dir_all(&login_bin).unwrap();
        let gui_path = std::env::join_paths([&gui_bin]).unwrap();
        let login_path = std::env::join_paths([&login_bin, &gui_bin]).unwrap();
        let shell = Path::new("/private/fake-login-shell");
        let runner = ShellOutputRunner {
            success: true,
            stdout: [
                b"Welcome back\n".as_slice(),
                framed_login_path(login_path.to_string_lossy().as_bytes()).as_slice(),
                b"session ready\n".as_slice(),
            ]
            .concat(),
            calls: Mutex::new(Vec::new()),
        };

        let paths = search_path_directories_with_runner(Some(&gui_path), shell, &runner);

        assert_eq!(paths, vec![gui_bin, login_bin]);
        assert_eq!(
            *runner.calls.lock().unwrap(),
            vec![(
                shell.to_path_buf(),
                vec![
                    OsString::from("-l"),
                    OsString::from("-c"),
                    OsString::from(LOGIN_SHELL_PATH_COMMAND)
                ],
                Vec::new()
            )]
        );
    }

    #[test]
    fn login_shell_path_uses_the_final_complete_frame_and_ignores_noise() {
        let output = [
            b"banner with MARKDOWNER_PATH_BEGIN text\n".as_slice(),
            framed_login_path(b"/decoy/bin").as_slice(),
            b"MARKDOWNER_PATH_END before another frame\n".as_slice(),
            framed_login_path(b"/final/bin:/usr/bin").as_slice(),
            b"post-session output\n".as_slice(),
        ]
        .concat();

        assert_eq!(
            parse_login_shell_path_output(&output).unwrap(),
            OsString::from("/final/bin:/usr/bin")
        );
    }

    #[test]
    fn login_shell_path_rejects_missing_reversed_empty_and_malformed_frames() {
        let cases = [
            b"no markers".to_vec(),
            format!(
                "{}\n/path\n{}\n",
                LOGIN_SHELL_PATH_END, LOGIN_SHELL_PATH_BEGIN
            )
            .into_bytes(),
            framed_login_path(b""),
            framed_login_path(b"/ok\r:/bad"),
            framed_login_path(b"/ok\0:/bad"),
            framed_login_path(b"/ok\n/second-line"),
            framed_login_path(b"/ok:\xff"),
        ];

        for output in cases {
            assert_eq!(
                parse_login_shell_path_output(&output),
                Err(LocalAgentError::MalformedProbeOutput)
            );
        }

        let invalid_noise = [
            b"\xff banner\n".as_slice(),
            framed_login_path(b"/valid/bin").as_slice(),
            b"\xfe trailer\n".as_slice(),
        ]
        .concat();
        assert_eq!(
            parse_login_shell_path_output(&invalid_noise).unwrap(),
            OsString::from("/valid/bin")
        );
    }

    #[test]
    fn automatic_search_directories_append_fixed_and_absolute_home_paths_in_order() {
        let temp = tempdir().unwrap();
        let gui = temp.path().join("gui");
        let login = temp.path().join("login");
        fs::create_dir_all(&gui).unwrap();
        fs::create_dir_all(&login).unwrap();
        let gui_path = std::env::join_paths([&gui, &gui]).unwrap();
        let login_path = std::env::join_paths([&login, &gui]).unwrap();

        assert_eq!(
            automatic_search_directories(Some(&gui_path), Some(&login_path), Some(temp.path()),),
            vec![
                gui,
                login,
                PathBuf::from("/opt/homebrew/bin"),
                PathBuf::from("/usr/local/bin"),
                PathBuf::from("/usr/bin"),
                PathBuf::from("/bin"),
                temp.path().join(".local/bin"),
                temp.path().join(".opencode/bin"),
                temp.path().join(".bun/bin"),
                temp.path().join(".cargo/bin"),
                temp.path().join(".volta/bin"),
                temp.path().join(".npm-global/bin"),
                temp.path().join(".local/share/pnpm"),
                temp.path().join("Library/pnpm"),
            ]
        );

        let fixed_only = automatic_search_directories(None, None, Some(Path::new("relative")));
        assert_eq!(
            fixed_only,
            vec![
                PathBuf::from("/opt/homebrew/bin"),
                PathBuf::from("/usr/local/bin"),
                PathBuf::from("/usr/bin"),
                PathBuf::from("/bin"),
            ]
        );
    }

    #[test]
    #[cfg(unix)]
    fn automatic_search_finds_an_agent_only_in_a_standard_home_directory() {
        let home = tempdir().unwrap();
        let bin = home.path().join(".local/bin");
        fs::create_dir_all(&bin).unwrap();
        let executable = bin.join("claude");
        create_executable(&executable);

        let paths = automatic_search_directories(None, None, Some(home.path()));
        let candidates = resolve_all_from_paths(LocalAgentKind::Claude, &paths);

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].path, executable.canonicalize().unwrap());
    }

    #[test]
    fn login_shell_timeout_is_sanitized_and_falls_back_to_gui_path() {
        let temp = tempdir().unwrap();
        let gui_bin = temp.path().join("gui-bin");
        fs::create_dir_all(&gui_bin).unwrap();
        let gui_path = std::env::join_paths([&gui_bin]).unwrap();
        let shell = Path::new("/private/secret-user/login-shell");

        let error = login_shell_path_value_with_runner(shell, &TimeoutRunner).unwrap_err();
        let paths = search_path_directories_with_runner(Some(&gui_path), shell, &TimeoutRunner);

        assert_eq!(error, LocalAgentError::ProbeTimedOut);
        assert!(!error.reason().contains("secret-user"));
        assert_eq!(paths, vec![gui_bin]);
    }

    #[test]
    fn oversized_login_shell_path_is_rejected_without_losing_gui_path() {
        let temp = tempdir().unwrap();
        let gui_bin = temp.path().join("gui-bin");
        fs::create_dir_all(&gui_bin).unwrap();
        let gui_path = std::env::join_paths([&gui_bin]).unwrap();
        let shell = Path::new("/private/secret-user/login-shell");

        let error = login_shell_path_value_with_runner(shell, &OversizedShellRunner).unwrap_err();
        let paths =
            search_path_directories_with_runner(Some(&gui_path), shell, &OversizedShellRunner);

        assert_eq!(error, LocalAgentError::ProbeOutputTooLarge);
        assert!(!error.reason().contains("secret-user"));
        assert_eq!(paths, vec![gui_bin]);
    }

    #[test]
    fn nonzero_login_shell_exit_is_sanitized_and_falls_back_to_gui_path() {
        let temp = tempdir().unwrap();
        let gui_bin = temp.path().join("gui-bin");
        fs::create_dir_all(&gui_bin).unwrap();
        let gui_path = std::env::join_paths([&gui_bin]).unwrap();
        let shell = Path::new("/private/secret-user/login-shell");
        let runner = ShellOutputRunner {
            success: false,
            stdout: temp.path().to_string_lossy().as_bytes().to_vec(),
            calls: Mutex::new(Vec::new()),
        };

        let error = login_shell_path_value_with_runner(shell, &runner).unwrap_err();
        let paths = search_path_directories_with_runner(Some(&gui_path), shell, &runner);

        assert_eq!(error, LocalAgentError::ProbeFailed);
        assert!(
            !error
                .reason()
                .contains(temp.path().to_string_lossy().as_ref())
        );
        assert_eq!(paths, vec![gui_bin]);
    }

    struct IncompatibleClaudeRunner {
        calls: Mutex<usize>,
    }

    impl ProbeRunner for IncompatibleClaudeRunner {
        fn run(
            &self,
            _executable: &Path,
            _args: &[OsString],
            _env: &[(OsString, OsString)],
        ) -> Result<ProbeOutput, LocalAgentError> {
            let mut calls = self.calls.lock().unwrap();
            let output = if *calls == 0 {
                ProbeOutput {
                    success: true,
                    stdout: b"claude 2.1.226\n".to_vec(),
                    stderr: Vec::new(),
                }
            } else {
                ProbeOutput {
                    success: true,
                    stdout: CLAUDE_HELP
                        .replace("--json-schema", "--json-schema-v2")
                        .into_bytes(),
                    stderr: Vec::new(),
                }
            };
            *calls += 1;
            Ok(output)
        }
    }

    struct OrderedClaudeRunner {
        compatible_parent: Option<PathBuf>,
        calls: Mutex<BTreeMap<PathBuf, usize>>,
    }

    impl ProbeRunner for OrderedClaudeRunner {
        fn run(
            &self,
            executable: &Path,
            _args: &[OsString],
            _env: &[(OsString, OsString)],
        ) -> Result<ProbeOutput, LocalAgentError> {
            let parent = executable.parent().unwrap().to_path_buf();
            let mut calls = self.calls.lock().unwrap();
            let call = calls.entry(parent.clone()).or_default();
            let output = if *call == 0 {
                let version = if parent.ends_with("first") {
                    "claude 1.0.0\n"
                } else {
                    "claude 2.0.0\n"
                };
                version.as_bytes().to_vec()
            } else if self.compatible_parent.as_ref() == Some(&parent) {
                CLAUDE_HELP.as_bytes().to_vec()
            } else {
                CLAUDE_HELP
                    .replace("--json-schema", "--json-schema-v2")
                    .into_bytes()
            };
            *call += 1;
            Ok(ProbeOutput {
                success: true,
                stdout: output,
                stderr: Vec::new(),
            })
        }
    }

    #[test]
    #[cfg(unix)]
    fn automatic_discovery_skips_incompatible_candidates_and_keeps_first_failure() {
        let temp = tempdir().unwrap();
        let first = temp.path().join("first");
        let second = temp.path().join("second");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        create_executable(&first.join("claude"));
        create_executable(&second.join("claude"));
        let environment_path = std::env::join_paths([&first, &second]).unwrap();
        let runner = OrderedClaudeRunner {
            compatible_parent: Some(second.canonicalize().unwrap()),
            calls: Mutex::new(BTreeMap::new()),
        };

        let status = discover_automatic_kind_with_runner(
            LocalAgentKind::Claude,
            &[first.clone(), second.clone()],
            &environment_path,
            &runner,
        );
        assert!(status.compatible);
        assert_eq!(status.version.as_deref(), Some("2.0.0"));
        assert_eq!(status.source, Some(LocalAgentStatusSource::Automatic));

        let all_incompatible = OrderedClaudeRunner {
            compatible_parent: None,
            calls: Mutex::new(BTreeMap::new()),
        };
        let status = discover_automatic_kind_with_runner(
            LocalAgentKind::Claude,
            &[first, second],
            &environment_path,
            &all_incompatible,
        );
        assert!(!status.compatible);
        assert_eq!(status.version.as_deref(), Some("1.0.0"));
        assert_eq!(status.reason.as_deref(), Some(CLAUDE_FLAGS_REASON));
    }

    #[test]
    #[cfg(unix)]
    fn automatic_discovery_skips_an_unsafe_executable_before_a_compatible_one() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempdir().unwrap();
        let first = temp.path().join("first");
        let second = temp.path().join("second");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        let unsafe_executable = first.join("claude");
        create_executable(&unsafe_executable);
        fs::set_permissions(&unsafe_executable, fs::Permissions::from_mode(0o777)).unwrap();
        create_executable(&second.join("claude"));
        let environment_path = std::env::join_paths([&first, &second]).unwrap();
        let runner = OrderedClaudeRunner {
            compatible_parent: Some(second.canonicalize().unwrap()),
            calls: Mutex::new(BTreeMap::new()),
        };

        let status = discover_automatic_kind_with_runner(
            LocalAgentKind::Claude,
            &[first.clone(), second.clone()],
            &environment_path,
            &runner,
        );

        assert!(status.compatible);
        assert_eq!(status.version.as_deref(), Some("2.0.0"));
        assert!(
            !runner
                .calls
                .lock()
                .unwrap()
                .contains_key(&first.canonicalize().unwrap())
        );
    }

    #[test]
    #[cfg(unix)]
    fn compatible_resolution_falls_back_automatically_but_never_after_manual_failure() {
        let temp = tempdir().unwrap();
        let first = temp.path().join("first");
        let second = temp.path().join("second");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        let manual = first.join("claude");
        let automatic = second.join("claude");
        create_executable(&manual);
        create_executable(&automatic);
        let paths = [first.clone(), second.clone()];
        let environment_path = std::env::join_paths(&paths).unwrap();

        let automatic_runner = OrderedClaudeRunner {
            compatible_parent: Some(second.canonicalize().unwrap()),
            calls: Mutex::new(BTreeMap::new()),
        };
        let (resolved, _) = resolve_compatible_from_paths_with_runner_and_proof(
            LocalAgentKind::Claude,
            None,
            &automatic_runner,
            CompatibleResolutionContext {
                home: None,
                paths: &paths,
                environment_path: environment_path.clone(),
                cancellation: None,
                deadline: None,
            },
        )
        .unwrap();
        assert_eq!(resolved.path, automatic.canonicalize().unwrap());

        let manual_runner = OrderedClaudeRunner {
            compatible_parent: Some(second.canonicalize().unwrap()),
            calls: Mutex::new(BTreeMap::new()),
        };
        let error = match resolve_compatible_from_paths_with_runner_and_proof(
            LocalAgentKind::Claude,
            Some(manual.to_str().unwrap()),
            &manual_runner,
            CompatibleResolutionContext {
                home: None,
                paths: &paths,
                environment_path,
                cancellation: None,
                deadline: None,
            },
        ) {
            Err(error) => error,
            Ok(_) => panic!("an incompatible manual path unexpectedly fell back"),
        };
        assert_eq!(error, LocalAgentError::Incompatible(CLAUDE_FLAGS_REASON));
        assert!(
            !manual_runner
                .calls
                .lock()
                .unwrap()
                .contains_key(&second.canonicalize().unwrap())
        );
    }

    #[test]
    #[cfg(unix)]
    fn installed_incompatible_status_keeps_only_the_sanitized_version() {
        let temp = tempdir().unwrap();
        let executable = temp.path().join("claude");
        create_executable(&executable);
        let resolved = ResolvedAgent {
            kind: LocalAgentKind::Claude,
            path: executable.canonicalize().unwrap(),
            path_label: "bin/claude".to_string(),
        };
        let runner = IncompatibleClaudeRunner {
            calls: Mutex::new(0),
        };

        let status = probe_resolved_agent(resolved, &runner);

        assert!(status.installed);
        assert!(!status.compatible);
        assert_eq!(status.version.as_deref(), Some("2.1.226"));
        assert_eq!(status.reason.as_deref(), Some(CLAUDE_FLAGS_REASON));
        assert_eq!(status.source, Some(LocalAgentStatusSource::Automatic));
        assert!(
            !serde_json::to_string(&status)
                .unwrap()
                .contains(temp.path().to_string_lossy().as_ref())
        );
    }

    #[test]
    #[cfg(unix)]
    fn manual_status_rejects_unsafe_and_incompatible_executables_without_fallback() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempdir().unwrap();
        let unsafe_executable = temp.path().join("unsafe-claude");
        create_executable(&unsafe_executable);
        let mut permissions = fs::metadata(&unsafe_executable).unwrap().permissions();
        permissions.set_mode(0o777);
        fs::set_permissions(&unsafe_executable, permissions).unwrap();
        let (resolved, source) = resolve_candidate_from_paths(
            LocalAgentKind::Claude,
            Some(unsafe_executable.to_str().unwrap()),
            None,
            &[],
        )
        .unwrap();
        let unsafe_runner = IncompatibleClaudeRunner {
            calls: Mutex::new(0),
        };
        let unsafe_status = probe_resolved_agent_with_environment_path(
            resolved,
            OsStr::new("/usr/bin:/bin"),
            &unsafe_runner,
            source,
        );
        assert!(unsafe_status.installed);
        assert!(!unsafe_status.compatible);
        assert_eq!(unsafe_status.source, Some(LocalAgentStatusSource::Manual));
        assert_eq!(
            unsafe_status.reason.as_deref(),
            Some("Capability probe failed.")
        );
        assert_eq!(*unsafe_runner.calls.lock().unwrap(), 0);

        let incompatible_executable = temp.path().join("incompatible-claude");
        create_executable(&incompatible_executable);
        let (resolved, source) = resolve_candidate_from_paths(
            LocalAgentKind::Claude,
            Some(incompatible_executable.to_str().unwrap()),
            None,
            &[],
        )
        .unwrap();
        let incompatible_runner = IncompatibleClaudeRunner {
            calls: Mutex::new(0),
        };
        let incompatible_status = probe_resolved_agent_with_environment_path(
            resolved,
            OsStr::new("/usr/bin:/bin"),
            &incompatible_runner,
            source,
        );
        assert!(incompatible_status.installed);
        assert!(!incompatible_status.compatible);
        assert_eq!(
            incompatible_status.source,
            Some(LocalAgentStatusSource::Manual)
        );
        assert_eq!(incompatible_status.version.as_deref(), Some("2.1.226"));
        assert_eq!(
            incompatible_status.reason.as_deref(),
            Some(CLAUDE_FLAGS_REASON)
        );
    }

    #[test]
    fn open_code_probe_environment_contains_valid_fixed_denials_only() {
        let environment: BTreeMap<OsString, OsString> =
            owned_opencode_environment().into_iter().collect();
        let config: Value = serde_json::from_str(
            environment
                .get(OsStr::new("OPENCODE_CONFIG_CONTENT"))
                .unwrap()
                .to_str()
                .unwrap(),
        )
        .unwrap();

        assert_eq!(config["share"], "disabled");
        assert!(config.get("enabled_providers").is_none());
        assert!(config.get("model").is_none());
        assert!(opencode_permissions_are_denied(&config));
        assert_eq!(
            environment.get(OsStr::new("OPENCODE_DISABLE_AUTOUPDATE")),
            Some(&OsString::from("true"))
        );
        for name in [
            "OPENCODE_DISABLE_PROJECT_CONFIG",
            "OPENCODE_DISABLE_EXTERNAL_SKILLS",
            "OPENCODE_DISABLE_LSP_DOWNLOAD",
            "OPENCODE_DISABLE_MODELS_FETCH",
            "OPENCODE_DISABLE_SHARE",
        ] {
            assert_eq!(
                environment.get(OsStr::new(name)),
                Some(&OsString::from("true")),
                "missing fixed OpenCode probe control {name}"
            );
        }
        assert_eq!(environment.len(), 7);
    }

    #[test]
    #[cfg(unix)]
    fn capability_timeout_is_five_seconds_and_returns_a_stable_sanitized_reason() {
        assert_eq!(PROBE_TIMEOUT, Duration::from_secs(5));
        let temp = tempdir().unwrap();
        let executable = temp.path().join("claude");
        create_executable(&executable);
        let resolved = ResolvedAgent {
            kind: LocalAgentKind::Claude,
            path: executable.canonicalize().unwrap(),
            path_label: "bin/claude".to_string(),
        };

        let status = probe_resolved_agent(resolved, &TimeoutRunner);

        assert!(!status.compatible);
        assert_eq!(
            status.reason.as_deref(),
            Some(CAPABILITY_PROBE_TIMEOUT_REASON)
        );
        assert!(
            !status
                .reason
                .unwrap()
                .contains(temp.path().to_string_lossy().as_ref())
        );
    }

    #[test]
    #[cfg(unix)]
    fn status_discovery_has_a_total_deadline_before_spawning_more_probes() {
        assert_eq!(STATUS_DISCOVERY_TIMEOUT, Duration::from_secs(30));
        let temp = tempdir().unwrap();
        let executable = temp.path().join("claude");
        create_executable(&executable);
        let resolved = ResolvedAgent {
            kind: LocalAgentKind::Claude,
            path: executable.canonicalize().unwrap(),
            path_label: "bin/claude".to_string(),
        };
        let runner = IncompatibleClaudeRunner {
            calls: Mutex::new(0),
        };

        let status = probe_resolved_agent_with_environment_path_and_deadline(
            resolved,
            OsStr::new("/usr/bin:/bin"),
            &runner,
            LocalAgentStatusSource::Automatic,
            Some(Instant::now()),
        );

        assert!(!status.compatible);
        assert_eq!(
            status.reason.as_deref(),
            Some(CAPABILITY_PROBE_TIMEOUT_REASON)
        );
        assert_eq!(*runner.calls.lock().unwrap(), 0);
    }

    struct ConcurrentStatusRunner {
        active: AtomicUsize,
        max_active: AtomicUsize,
        calls: Mutex<BTreeMap<String, usize>>,
    }

    impl ProbeRunner for ConcurrentStatusRunner {
        fn run(
            &self,
            executable: &Path,
            args: &[OsString],
            _environment: &[(OsString, OsString)],
        ) -> Result<ProbeOutput, LocalAgentError> {
            let basename = executable
                .file_name()
                .and_then(OsStr::to_str)
                .unwrap_or_default();
            if !matches!(basename, "claude" | "codex" | "opencode") {
                return Ok(ProbeOutput {
                    success: true,
                    stdout: framed_login_path(b"/usr/bin:/bin"),
                    stderr: Vec::new(),
                });
            }

            let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
            self.max_active.fetch_max(active, Ordering::SeqCst);
            thread::sleep(Duration::from_millis(40));

            let mut calls = self.calls.lock().unwrap();
            let call = calls.entry(basename.to_string()).or_default();
            let stdout = match (basename, *call, args.first().and_then(|arg| arg.to_str())) {
                ("claude", 0, Some("--version")) => b"claude 2.1.239\n".to_vec(),
                ("claude", 1, Some("--help")) => CLAUDE_HELP.as_bytes().to_vec(),
                ("codex", 0, Some("--version")) => b"codex-cli 0.149.0\n".to_vec(),
                ("codex", 1, Some("exec")) => CODEX_EXEC_HELP.as_bytes().to_vec(),
                ("codex", 2, Some("features")) => SAFE_CODEX_FEATURES.as_bytes().to_vec(),
                ("opencode", 0, Some("--version")) => b"opencode 1.18.21\n".to_vec(),
                ("opencode", 1, Some("run")) => OPEN_CODE_RUN_HELP.as_bytes().to_vec(),
                ("opencode", 2, Some("debug")) => OPEN_CODE_DEBUG_CONFIG_HELP.as_bytes().to_vec(),
                ("opencode", 3, Some("debug")) => {
                    fully_denied_open_code_config().to_string().into_bytes()
                }
                unexpected => panic!("unexpected status probe: {unexpected:?}"),
            };
            *call += 1;
            drop(calls);
            self.active.fetch_sub(1, Ordering::SeqCst);
            Ok(ProbeOutput {
                success: true,
                stdout,
                stderr: Vec::new(),
            })
        }
    }

    #[test]
    #[cfg(unix)]
    fn status_discovery_probes_installed_agents_concurrently() {
        let temp = tempdir().unwrap();
        for basename in ["claude", "codex", "opencode"] {
            create_executable(&temp.path().join(basename));
        }
        let executable_paths = LocalAgentExecutablePaths {
            claude: temp.path().join("claude").to_string_lossy().into_owned(),
            codex: temp.path().join("codex").to_string_lossy().into_owned(),
            opencode: temp.path().join("opencode").to_string_lossy().into_owned(),
        };
        let runner = ConcurrentStatusRunner {
            active: AtomicUsize::new(0),
            max_active: AtomicUsize::new(0),
            calls: Mutex::new(BTreeMap::new()),
        };

        let statuses = discover_all_with_runner_and_paths(&runner, &executable_paths, None);

        assert!(statuses.iter().all(|status| status.compatible));
        assert!(
            runner.max_active.load(Ordering::SeqCst) >= 2,
            "installed agent probes ran sequentially"
        );
    }

    #[test]
    #[ignore = "live smoke test for locally installed agent CLIs"]
    fn live_installed_agents_are_discovered_together() {
        let statuses = super::discover_all();
        eprintln!("installed local agent statuses: {statuses:#?}");

        for status in statuses {
            assert!(
                status.compatible,
                "{} was not detected as compatible: {:?}",
                status.label, status.reason
            );
        }
    }

    #[test]
    fn open_code_permission_failure_reason_is_stable() {
        let evaluation = if opencode_permissions_are_denied(&json!({
            "permission": {"*": "deny", "bash": "allow"}
        })) {
            unreachable!()
        } else {
            super::CapabilityEvaluation::incompatible(OPEN_CODE_PERMISSIONS_REASON)
        };

        assert_eq!(evaluation.reason, Some(OPEN_CODE_PERMISSIONS_REASON));
    }

    #[allow(dead_code)]
    fn _assert_probe_output_shape(output: ProbeOutput) {
        let ProbeOutput {
            success,
            stdout,
            stderr,
        } = output;
        let _: (bool, Vec<u8>, Vec<u8>) = (success, stdout, stderr);
    }

    #[allow(dead_code)]
    fn _assert_error_is_safe_to_group(error: LocalAgentError) {
        let mut grouped = BTreeMap::new();
        grouped.insert(error.reason(), 1_u8);
    }
}
