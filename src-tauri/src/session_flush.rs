use std::{collections::HashSet, sync::Mutex, time::Duration};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tokio::sync::oneshot;

const PREPARE_EVENT: &str = "markdowner://prepare-session-exit";
const RELEASE_EVENT: &str = "markdowner://release-session-exit";
pub(crate) const ERROR_EVENT: &str = "markdowner://session-exit-error";

struct PendingFlush {
    id: u64,
    remaining: HashSet<String>,
    result: Option<oneshot::Sender<Result<(), String>>>,
    failed: bool,
}

#[derive(Default)]
struct FlushState {
    next_id: u64,
    pending: Option<PendingFlush>,
}

#[derive(Default)]
pub(crate) struct SessionFlush(Mutex<FlushState>);

impl SessionFlush {
    fn begin(
        &self,
        labels: impl IntoIterator<Item = String>,
    ) -> Result<(u64, oneshot::Receiver<Result<(), String>>), String> {
        let mut state = self.0.lock().map_err(|_| "Could not lock session flush")?;
        if state.pending.is_some() {
            return Err("Another close or update is already in progress".into());
        }
        state.next_id += 1;
        let id = state.next_id;
        let (send, receive) = oneshot::channel();
        let mut pending = PendingFlush {
            id,
            remaining: labels.into_iter().collect(),
            result: Some(send),
            failed: false,
        };
        if pending.remaining.is_empty() {
            let _ = pending.result.take().unwrap().send(Ok(()));
        }
        state.pending = Some(pending);
        Ok((id, receive))
    }

    fn acknowledge(&self, id: u64, label: &str, error: Option<String>) -> Result<(), String> {
        let mut state = self.0.lock().map_err(|_| "Could not lock session flush")?;
        let pending = state.pending.as_mut().ok_or("Session flush has ended")?;
        if pending.id != id || !pending.remaining.remove(label) {
            return Err("Stale or duplicate session flush acknowledgement".into());
        }
        if let Some(error) = error {
            pending.failed = true;
            if let Some(result) = pending.result.take() {
                let _ = result.send(Err(format!("Could not save window {label}: {error}")));
            }
        } else if pending.remaining.is_empty()
            && let Some(result) = pending.result.take()
        {
            let _ = result.send(Ok(()));
        }
        Ok(())
    }

    pub(crate) fn is_pending(&self) -> bool {
        self.0
            .lock()
            .map(|state| state.pending.is_some())
            .unwrap_or(true)
    }

    fn is_ready(&self) -> bool {
        self.0.lock().is_ok_and(|state| {
            state
                .pending
                .as_ref()
                .is_some_and(|pending| pending.remaining.is_empty() && !pending.failed)
        })
    }

    fn release(&self) {
        if let Ok(mut state) = self.0.lock() {
            state.pending = None;
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PrepareRequest {
    request_id: u64,
}

async fn wait_for_flush(
    receiver: oneshot::Receiver<Result<(), String>>,
    timeout: Duration,
) -> Result<(), String> {
    tokio::time::timeout(timeout, receiver)
        .await
        .map_err(|_| "A window did not finish saving recovery data. Please retry.".to_string())?
        .map_err(|_| "Session flush was interrupted".to_string())?
}

pub(crate) async fn prepare_all(app: &AppHandle) -> Result<(), String> {
    let coordinator = app.state::<SessionFlush>();
    // An updater has already prepared every window before launching its installer.
    if coordinator.is_ready() {
        return Ok(());
    }
    let windows = app.webview_windows();
    let (request_id, receiver) = coordinator.begin(windows.keys().cloned())?;
    for window in windows.values() {
        if let Err(error) = window.emit(PREPARE_EVENT, PrepareRequest { request_id }) {
            release_all(app);
            return Err(error.to_string());
        }
    }
    let result = wait_for_flush(receiver, Duration::from_secs(15)).await;
    if result.is_err() {
        release_all(app);
    }
    result
}

pub(crate) fn release_all(app: &AppHandle) {
    app.state::<SessionFlush>().release();
    let _ = app.emit(RELEASE_EVENT, ());
}

#[tauri::command]
pub(crate) fn complete_session_flush(
    window: WebviewWindow,
    state: State<'_, SessionFlush>,
    request_id: u64,
    error: Option<String>,
) -> Result<(), String> {
    // The caller's identity comes from Tauri, not a label supplied by JavaScript.
    state.acknowledge(request_id, window.label(), error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn waits_for_every_window_and_rejects_duplicate_or_stale_acknowledgements() {
        let coordinator = SessionFlush::default();
        let (id, mut receiver) = coordinator.begin(["main".into(), "second".into()]).unwrap();
        coordinator.acknowledge(id, "main", None).unwrap();
        assert!(receiver.try_recv().is_err());
        assert!(!coordinator.is_ready());
        assert!(coordinator.acknowledge(id, "main", None).is_err());
        assert!(coordinator.acknowledge(id + 1, "second", None).is_err());
        assert!(coordinator.acknowledge(id, "unknown", None).is_err());
        assert!(coordinator.begin(["third".into()]).is_err());
        coordinator.acknowledge(id, "second", None).unwrap();
        assert!(
            wait_for_flush(receiver, Duration::from_secs(1))
                .await
                .is_ok()
        );
        assert!(coordinator.is_ready());
        coordinator.release();
        let (next_id, _) = coordinator.begin(["main".into()]).unwrap();
        assert!(next_id > id);
    }

    #[tokio::test]
    async fn any_window_failure_blocks_exit_and_can_be_retried() {
        let coordinator = SessionFlush::default();
        let (id, receiver) = coordinator.begin(["main".into(), "second".into()]).unwrap();
        coordinator
            .acknowledge(id, "second", Some("disk full".into()))
            .unwrap();
        assert!(
            wait_for_flush(receiver, Duration::from_secs(1))
                .await
                .unwrap_err()
                .contains("disk full")
        );
        coordinator.acknowledge(id, "main", None).unwrap();
        assert!(!coordinator.is_ready());
        coordinator.release();
        let (_, receiver) = coordinator.begin([]).unwrap();
        assert!(
            wait_for_flush(receiver, Duration::from_secs(1))
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn an_unresponsive_window_has_a_bounded_wait() {
        let coordinator = SessionFlush::default();
        let (_, receiver) = coordinator.begin(["unresponsive".into()]).unwrap();
        assert!(
            wait_for_flush(receiver, Duration::from_millis(10))
                .await
                .is_err()
        );
        assert!(!coordinator.is_ready());
        coordinator.release();
        assert!(!coordinator.is_pending());
    }
}
