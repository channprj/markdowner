use std::{
    io,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, OptionalExtension, Row, Transaction, params, types::Type};
use serde::{Deserialize, Serialize};

use super::{AiError, openrouter::AiTask};

pub const HISTORY_PAGE_SIZE: u32 = 20;
pub const HISTORY_RETENTION: u32 = 500;

const MIGRATION_1: &str = r#"
CREATE TABLE IF NOT EXISTS ai_schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_runs (
    id TEXT PRIMARY KEY,
    task TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL,
    scope_json TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    result_json TEXT,
    error_json TEXT,
    usage_json TEXT,
    started_at INTEGER NOT NULL,
    finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS ai_runs_started_at_idx
ON ai_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS ai_runs_status_idx
ON ai_runs(status);

CREATE TABLE IF NOT EXISTS ai_interview_turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    question TEXT NOT NULL,
    rationale TEXT NOT NULL DEFAULT '',
    unresolved_area TEXT NOT NULL DEFAULT '',
    answer TEXT,
    skipped INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(run_id, position)
);

CREATE TABLE IF NOT EXISTS ai_translation_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL,
    file_index INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL,
    heading TEXT,
    status TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    result_json TEXT,
    error_json TEXT,
    usage_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(run_id, document_id, chunk_index)
);
"#;

const MIGRATION_2: &str = r#"
CREATE TABLE IF NOT EXISTS ai_interviews (
    run_id TEXT PRIMARY KEY REFERENCES ai_runs(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
"#;

const MIGRATION_3: &str = r#"
ALTER TABLE ai_translation_chunks ADD COLUMN source_start INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_translation_chunks ADD COLUMN source_end INTEGER NOT NULL DEFAULT 0;
"#;

const MIGRATION_4: &str = r#"
ALTER TABLE ai_interview_turns ADD COLUMN recommended_answer TEXT NOT NULL DEFAULT '';
"#;

const MIGRATION_5: &str = r#"
ALTER TABLE ai_runs ADD COLUMN instruction TEXT;
ALTER TABLE ai_runs ADD COLUMN target_language TEXT;
ALTER TABLE ai_runs ADD COLUMN max_output_tokens INTEGER;
ALTER TABLE ai_runs ADD COLUMN zdr_only INTEGER;
"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredRun {
    pub id: String,
    pub task: AiTask,
    pub model: String,
    pub status: RunStatus,
    pub scope_json: String,
    pub source_hash: String,
    pub prompt_version: String,
    pub instruction: Option<String>,
    pub target_language: Option<String>,
    pub max_output_tokens: Option<u32>,
    pub zdr_only: Option<bool>,
    pub result_json: Option<String>,
    pub error_json: Option<String>,
    pub usage_json: Option<String>,
    pub started_at: i64,
    pub finished_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredInterviewTurn {
    pub position: u32,
    pub question: String,
    pub rationale: String,
    pub recommended_answer: String,
    pub unresolved_area: String,
    pub answer: Option<String>,
    pub skipped: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredRunDetail {
    #[serde(flatten)]
    pub run: StoredRun,
    pub interview_turns: Vec<StoredInterviewTurn>,
}

impl std::ops::Deref for StoredRunDetail {
    type Target = StoredRun;

    fn deref(&self) -> &Self::Target {
        &self.run
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct StoredInterview {
    pub run: StoredRun,
    pub status: String,
    pub turns: Vec<StoredInterviewTurn>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredTranslationChunk {
    pub document_id: String,
    pub file_index: u32,
    pub chunk_index: u32,
    pub source_start: u32,
    pub source_end: u32,
    pub heading: Option<String>,
    pub source_hash: String,
    pub result_json: String,
    pub usage_json: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub items: Vec<StoredRun>,
    pub page: u32,
    pub page_size: u32,
    pub total: u32,
}

#[derive(Debug, Clone)]
pub struct HistoryStore {
    path: PathBuf,
}

#[derive(Debug, Clone)]
pub enum HistoryRepository {
    Available(HistoryStore),
    Unavailable,
}

impl HistoryRepository {
    pub fn open(path: &Path) -> Self {
        match HistoryStore::open(path) {
            Ok(store) => Self::Available(store),
            Err(_) => Self::Unavailable,
        }
    }

    #[cfg(test)]
    pub fn is_available(&self) -> bool {
        match self {
            Self::Available(store) => {
                let _ = &store.path;
                true
            }
            Self::Unavailable => false,
        }
    }

    pub fn store(&self) -> Result<&HistoryStore, AiError> {
        match self {
            Self::Available(store) => Ok(store),
            Self::Unavailable => Err(history_unavailable()),
        }
    }
}

impl HistoryStore {
    pub fn open(path: &Path) -> Result<Self, AiError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|_| history_unavailable())?;
        }
        let store = Self {
            path: path.to_path_buf(),
        };
        let mut connection = store.connection()?;
        migrate_and_recover(&mut connection)?;
        Ok(store)
    }

    pub fn insert_run(&self, run: &StoredRun) -> Result<(), AiError> {
        let connection = self.connection()?;
        connection
            .execute(
                r#"INSERT INTO ai_runs (
                    id, task, model, status, scope_json, source_hash,
                    prompt_version, instruction, target_language, max_output_tokens,
                    zdr_only, result_json, error_json, usage_json, started_at, finished_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                    ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16
                )"#,
                params![
                    run.id,
                    task_name(run.task),
                    run.model,
                    status_name(run.status),
                    run.scope_json,
                    run.source_hash,
                    run.prompt_version,
                    run.instruction,
                    run.target_language,
                    run.max_output_tokens,
                    run.zdr_only,
                    run.result_json,
                    run.error_json,
                    run.usage_json,
                    run.started_at,
                    run.finished_at,
                ],
            )
            .map_err(|_| history_unavailable())?;
        Ok(())
    }

    pub fn create_interview(&self, run: &StoredRun, status: &str) -> Result<(), AiError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(|_| history_unavailable())?;
        insert_run(&transaction, run)?;
        transaction
            .execute(
                "INSERT INTO ai_interviews (run_id, status, updated_at) VALUES (?1, ?2, ?3)",
                params![run.id, status, unix_timestamp()],
            )
            .map_err(|_| history_unavailable())?;
        transaction.commit().map_err(|_| history_unavailable())
    }

    pub fn append_interview_turn(
        &self,
        run_id: &str,
        turn: &StoredInterviewTurn,
        status: &str,
    ) -> Result<(), AiError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(|_| history_unavailable())?;
        insert_interview_turn(&transaction, run_id, turn)?;
        update_interview_status(&transaction, run_id, status)?;
        transaction.commit().map_err(|_| history_unavailable())
    }

    pub fn answer_and_append_interview_turn(
        &self,
        run_id: &str,
        position: u32,
        answer: Option<&str>,
        skipped: bool,
        next_turn: &StoredInterviewTurn,
        status: &str,
    ) -> Result<(), AiError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(|_| history_unavailable())?;
        update_interview_answer(&transaction, run_id, position, answer, skipped)?;
        insert_interview_turn(&transaction, run_id, next_turn)?;
        update_interview_status(&transaction, run_id, status)?;
        transaction.commit().map_err(|_| history_unavailable())
    }

    pub fn update_interview_answer(
        &self,
        run_id: &str,
        position: u32,
        answer: &str,
    ) -> Result<(), AiError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(|_| history_unavailable())?;
        update_interview_answer(&transaction, run_id, position, Some(answer), false)?;
        transaction.commit().map_err(|_| history_unavailable())
    }

    pub fn finish_interview(
        &self,
        run_id: &str,
        position: u32,
        answer: Option<&str>,
        skipped: bool,
        status: &str,
    ) -> Result<(), AiError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(|_| history_unavailable())?;
        update_interview_answer(&transaction, run_id, position, answer, skipped)?;
        update_interview_status(&transaction, run_id, status)?;
        transaction.commit().map_err(|_| history_unavailable())
    }

    pub fn set_interview_status(&self, run_id: &str, status: &str) -> Result<(), AiError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(|_| history_unavailable())?;
        update_interview_status(&transaction, run_id, status)?;
        transaction.commit().map_err(|_| history_unavailable())
    }

    pub fn interview(&self, run_id: &str) -> Result<Option<StoredInterview>, AiError> {
        let connection = self.connection()?;
        let run = connection
            .query_row(
                r#"SELECT id, task, model, status, scope_json, source_hash,
                          prompt_version, instruction, target_language,
                          max_output_tokens, zdr_only, result_json, error_json,
                          usage_json, started_at, finished_at
                   FROM ai_runs WHERE id = ?1"#,
                [run_id],
                stored_run_from_row,
            )
            .optional()
            .map_err(|_| history_unavailable())?;
        let Some(run) = run else { return Ok(None) };
        let status = connection
            .query_row(
                "SELECT status FROM ai_interviews WHERE run_id = ?1",
                [run_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|_| history_unavailable())?;
        let Some(status) = status else { return Ok(None) };
        Ok(Some(StoredInterview {
            turns: interview_turns(&connection, run_id)?,
            run,
            status,
        }))
    }

    pub fn finish_run(
        &self,
        id: &str,
        status: RunStatus,
        result_json: Option<&str>,
        error_json: Option<&str>,
    ) -> Result<(), AiError> {
        self.finish_run_with_usage(id, status, result_json, error_json, None)
    }

    pub fn finish_run_with_usage(
        &self,
        id: &str,
        status: RunStatus,
        result_json: Option<&str>,
        error_json: Option<&str>,
        usage_json: Option<&str>,
    ) -> Result<(), AiError> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|_| history_unavailable())?;
        let changed = transaction
            .execute(
                r#"UPDATE ai_runs
                   SET status = ?2, result_json = ?3, error_json = ?4,
                       usage_json = COALESCE(?5, usage_json), finished_at = ?6
                   WHERE id = ?1"#,
                params![
                    id,
                    status_name(status),
                    result_json,
                    error_json,
                    usage_json,
                    unix_timestamp(),
                ],
            )
            .map_err(|_| history_unavailable())?;
        if changed == 0 {
            return Err(AiError::new(
                "history_not_found",
                "The AI history entry no longer exists.",
            ));
        }
        prune_runs(&transaction)?;
        transaction.commit().map_err(|_| history_unavailable())
    }

    pub fn resume_run(&self, id: &str) -> Result<(), AiError> {
        let connection = self.connection()?;
        let changed = connection
            .execute(
                r#"UPDATE ai_runs
                   SET status = 'running', error_json = NULL, finished_at = NULL
                   WHERE id = ?1 AND status IN ('failed', 'cancelled', 'interrupted')"#,
                [id],
            )
            .map_err(|_| history_unavailable())?;
        if changed == 0 {
            return Err(AiError::new(
                "translation_resume_unavailable",
                "This translation is not available to resume.",
            ));
        }
        Ok(())
    }

    pub fn save_translation_chunk(
        &self,
        run_id: &str,
        chunk: &StoredTranslationChunk,
    ) -> Result<(), AiError> {
        let connection = self.connection()?;
        connection
            .execute(
                r#"INSERT INTO ai_translation_chunks (
                    run_id, document_id, file_index, chunk_index, heading,
                    status, source_hash, result_json, error_json, usage_json,
                    created_at, updated_at, source_start, source_end
                ) VALUES (?1, ?2, ?3, ?4, ?5, 'completed', ?6, ?7, NULL, ?8, ?9, ?9, ?10, ?11)
                ON CONFLICT(run_id, document_id, chunk_index) DO UPDATE SET
                    heading = excluded.heading,
                    status = excluded.status,
                    source_hash = excluded.source_hash,
                    result_json = excluded.result_json,
                    error_json = NULL,
                    usage_json = excluded.usage_json,
                    updated_at = excluded.updated_at,
                    source_start = excluded.source_start,
                    source_end = excluded.source_end"#,
                params![
                    run_id,
                    chunk.document_id,
                    chunk.file_index,
                    chunk.chunk_index,
                    chunk.heading,
                    chunk.source_hash,
                    chunk.result_json,
                    chunk.usage_json,
                    unix_timestamp(),
                    chunk.source_start,
                    chunk.source_end,
                ],
            )
            .map_err(|_| history_unavailable())?;
        Ok(())
    }

    pub fn completed_translation_chunks(
        &self,
        run_id: &str,
        document_id: &str,
    ) -> Result<Vec<StoredTranslationChunk>, AiError> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                r#"SELECT document_id, file_index, chunk_index, source_start,
                          source_end, heading, source_hash, result_json, usage_json
                   FROM ai_translation_chunks
                   WHERE run_id = ?1 AND document_id = ?2 AND status = 'completed'
                   ORDER BY source_start ASC, source_end ASC"#,
            )
            .map_err(|_| history_unavailable())?;
        let rows = statement
            .query_map(params![run_id, document_id], |row| {
                Ok(StoredTranslationChunk {
                    document_id: row.get(0)?,
                    file_index: row.get(1)?,
                    chunk_index: row.get(2)?,
                    source_start: row.get(3)?,
                    source_end: row.get(4)?,
                    heading: row.get(5)?,
                    source_hash: row.get(6)?,
                    result_json: row.get(7)?,
                    usage_json: row.get(8)?,
                })
            })
            .map_err(|_| history_unavailable())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|_| history_unavailable())
    }

    pub fn page(&self, page: u32, page_size: u32) -> Result<HistoryPage, AiError> {
        let connection = self.connection()?;
        let page_size = page_size.clamp(1, HISTORY_PAGE_SIZE);
        let total = connection
            .query_row("SELECT COUNT(*) FROM ai_runs", [], |row| {
                row.get::<_, i64>(0)
            })
            .map_err(|_| history_unavailable())?;
        let offset = i64::from(page).saturating_mul(i64::from(page_size));
        let mut statement = connection
            .prepare(
                r#"SELECT id, task, model, status, scope_json, source_hash,
                          prompt_version, instruction, target_language,
                          max_output_tokens, zdr_only, result_json, error_json,
                          usage_json, started_at, finished_at
                   FROM ai_runs
                   ORDER BY started_at DESC, rowid DESC
                   LIMIT ?1 OFFSET ?2"#,
            )
            .map_err(|_| history_unavailable())?;
        let rows = statement
            .query_map(params![i64::from(page_size), offset], stored_run_from_row)
            .map_err(|_| history_unavailable())?;
        let items = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| history_unavailable())?;
        Ok(HistoryPage {
            items,
            page,
            page_size,
            total: u32::try_from(total).unwrap_or(u32::MAX),
        })
    }

    pub fn detail(&self, id: &str) -> Result<Option<StoredRunDetail>, AiError> {
        let connection = self.connection()?;
        let run = connection
            .query_row(
                r#"SELECT id, task, model, status, scope_json, source_hash,
                          prompt_version, instruction, target_language,
                          max_output_tokens, zdr_only, result_json, error_json,
                          usage_json, started_at, finished_at
                   FROM ai_runs WHERE id = ?1"#,
                [id],
                stored_run_from_row,
            )
            .optional()
            .map_err(|_| history_unavailable())?;
        let Some(run) = run else { return Ok(None) };
        Ok(Some(StoredRunDetail {
            interview_turns: interview_turns(&connection, id)?,
            run,
        }))
    }

    pub fn delete(&self, id: &str) -> Result<bool, AiError> {
        let connection = self.connection()?;
        let deleted = connection
            .execute("DELETE FROM ai_runs WHERE id = ?1", [id])
            .map_err(|_| history_unavailable())?;
        Ok(deleted > 0)
    }

    pub fn clear(&self) -> Result<u32, AiError> {
        let connection = self.connection()?;
        let deleted = connection
            .execute("DELETE FROM ai_runs", [])
            .map_err(|_| history_unavailable())?;
        Ok(u32::try_from(deleted).unwrap_or(u32::MAX))
    }

    fn connection(&self) -> Result<Connection, AiError> {
        let connection = Connection::open(&self.path).map_err(|_| history_unavailable())?;
        connection
            .pragma_update(None, "foreign_keys", "ON")
            .map_err(|_| history_unavailable())?;
        Ok(connection)
    }
}

fn migrate_and_recover(connection: &mut Connection) -> Result<(), AiError> {
    let transaction = connection
        .transaction()
        .map_err(|_| history_unavailable())?;
    transaction
        .execute_batch(MIGRATION_1)
        .map_err(|_| history_unavailable())?;
    transaction
        .execute_batch(MIGRATION_2)
        .map_err(|_| history_unavailable())?;
    transaction
        .execute(
            "INSERT OR IGNORE INTO ai_schema_migrations (version, applied_at) VALUES (1, ?1)",
            [unix_timestamp()],
        )
        .map_err(|_| history_unavailable())?;
    transaction
        .execute(
            "INSERT OR IGNORE INTO ai_schema_migrations (version, applied_at) VALUES (2, ?1)",
            [unix_timestamp()],
        )
        .map_err(|_| history_unavailable())?;
    let migration_3_applied = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM ai_schema_migrations WHERE version = 3)",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|_| history_unavailable())?;
    if !migration_3_applied {
        transaction
            .execute_batch(MIGRATION_3)
            .map_err(|_| history_unavailable())?;
        transaction
            .execute(
                "INSERT INTO ai_schema_migrations (version, applied_at) VALUES (3, ?1)",
                [unix_timestamp()],
            )
            .map_err(|_| history_unavailable())?;
    }
    let migration_4_applied = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM ai_schema_migrations WHERE version = 4)",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|_| history_unavailable())?;
    if !migration_4_applied {
        transaction
            .execute_batch(MIGRATION_4)
            .map_err(|_| history_unavailable())?;
        transaction
            .execute(
                "INSERT INTO ai_schema_migrations (version, applied_at) VALUES (4, ?1)",
                [unix_timestamp()],
            )
            .map_err(|_| history_unavailable())?;
    }
    let migration_5_applied = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM ai_schema_migrations WHERE version = 5)",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|_| history_unavailable())?;
    if !migration_5_applied {
        transaction
            .execute_batch(MIGRATION_5)
            .map_err(|_| history_unavailable())?;
        transaction
            .execute(
                "INSERT INTO ai_schema_migrations (version, applied_at) VALUES (5, ?1)",
                [unix_timestamp()],
            )
            .map_err(|_| history_unavailable())?;
    }
    transaction
        .execute(
            r#"UPDATE ai_runs
               SET status = 'interrupted', finished_at = ?1
               WHERE status = 'running'"#,
            [unix_timestamp()],
        )
        .map_err(|_| history_unavailable())?;
    prune_runs(&transaction)?;
    transaction.commit().map_err(|_| history_unavailable())
}

fn insert_run(transaction: &Transaction<'_>, run: &StoredRun) -> Result<(), AiError> {
    transaction
        .execute(
            r#"INSERT INTO ai_runs (
                id, task, model, status, scope_json, source_hash,
                prompt_version, instruction, target_language, max_output_tokens,
                zdr_only, result_json, error_json, usage_json, started_at, finished_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16
            )"#,
            params![
                run.id,
                task_name(run.task),
                run.model,
                status_name(run.status),
                run.scope_json,
                run.source_hash,
                run.prompt_version,
                run.instruction,
                run.target_language,
                run.max_output_tokens,
                run.zdr_only,
                run.result_json,
                run.error_json,
                run.usage_json,
                run.started_at,
                run.finished_at,
            ],
        )
        .map_err(|_| history_unavailable())?;
    Ok(())
}

fn insert_interview_turn(
    transaction: &Transaction<'_>,
    run_id: &str,
    turn: &StoredInterviewTurn,
) -> Result<(), AiError> {
    transaction
        .execute(
            r#"INSERT INTO ai_interview_turns (
                run_id, position, question, rationale, recommended_answer,
                unresolved_area, answer, skipped, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)"#,
            params![
                run_id,
                turn.position,
                turn.question,
                turn.rationale,
                turn.recommended_answer,
                turn.unresolved_area,
                turn.answer,
                turn.skipped,
                unix_timestamp(),
            ],
        )
        .map_err(|_| history_unavailable())?;
    Ok(())
}

fn update_interview_answer(
    transaction: &Transaction<'_>,
    run_id: &str,
    position: u32,
    answer: Option<&str>,
    skipped: bool,
) -> Result<(), AiError> {
    let changed = transaction
        .execute(
            r#"UPDATE ai_interview_turns
               SET answer = ?3, skipped = ?4, updated_at = ?5
               WHERE run_id = ?1 AND position = ?2"#,
            params![run_id, position, answer, skipped, unix_timestamp()],
        )
        .map_err(|_| history_unavailable())?;
    if changed == 0 {
        return Err(AiError::new(
            "interview_turn_not_found",
            "The current PRD interview question is no longer available.",
        ));
    }
    Ok(())
}

fn update_interview_status(
    transaction: &Transaction<'_>,
    run_id: &str,
    status: &str,
) -> Result<(), AiError> {
    let changed = transaction
        .execute(
            "UPDATE ai_interviews SET status = ?2, updated_at = ?3 WHERE run_id = ?1",
            params![run_id, status, unix_timestamp()],
        )
        .map_err(|_| history_unavailable())?;
    if changed == 0 {
        return Err(AiError::new(
            "interview_not_found",
            "The PRD interview is no longer available.",
        ));
    }
    Ok(())
}

fn interview_turns(
    connection: &Connection,
    run_id: &str,
) -> Result<Vec<StoredInterviewTurn>, AiError> {
    let mut statement = connection
        .prepare(
            r#"SELECT position, question, rationale, recommended_answer,
                      unresolved_area, answer, skipped
               FROM ai_interview_turns WHERE run_id = ?1 ORDER BY position ASC"#,
        )
        .map_err(|_| history_unavailable())?;
    let rows = statement
        .query_map([run_id], |row| {
            Ok(StoredInterviewTurn {
                position: row.get(0)?,
                question: row.get(1)?,
                rationale: row.get(2)?,
                recommended_answer: row.get(3)?,
                unresolved_area: row.get(4)?,
                answer: row.get(5)?,
                skipped: row.get(6)?,
            })
        })
        .map_err(|_| history_unavailable())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| history_unavailable())
}

fn prune_runs(transaction: &Transaction<'_>) -> Result<(), AiError> {
    transaction
        .execute(
            r#"DELETE FROM ai_runs
               WHERE id IN (
                   SELECT id FROM ai_runs
                   WHERE status != 'running'
                   ORDER BY COALESCE(finished_at, started_at) ASC, rowid ASC
                   LIMIT MAX((SELECT COUNT(*) FROM ai_runs) - ?1, 0)
               )"#,
            [i64::from(HISTORY_RETENTION)],
        )
        .map_err(|_| history_unavailable())?;
    Ok(())
}

fn stored_run_from_row(row: &Row<'_>) -> rusqlite::Result<StoredRun> {
    let task_value = row.get::<_, String>(1)?;
    let status_value = row.get::<_, String>(3)?;
    Ok(StoredRun {
        id: row.get(0)?,
        task: parse_task(&task_value).ok_or_else(|| invalid_enum(1, "AI task"))?,
        model: row.get(2)?,
        status: parse_status(&status_value).ok_or_else(|| invalid_enum(3, "run status"))?,
        scope_json: row.get(4)?,
        source_hash: row.get(5)?,
        prompt_version: row.get(6)?,
        instruction: row.get(7)?,
        target_language: row.get(8)?,
        max_output_tokens: row.get(9)?,
        zdr_only: row.get(10)?,
        result_json: row.get(11)?,
        error_json: row.get(12)?,
        usage_json: row.get(13)?,
        started_at: row.get(14)?,
        finished_at: row.get(15)?,
    })
}

fn task_name(task: AiTask) -> &'static str {
    match task {
        AiTask::Prd => "prd",
        AiTask::Summary => "summary",
        AiTask::Translation => "translation",
        AiTask::Custom => "custom",
    }
}

fn parse_task(value: &str) -> Option<AiTask> {
    match value {
        "prd" => Some(AiTask::Prd),
        "summary" => Some(AiTask::Summary),
        "translation" => Some(AiTask::Translation),
        "custom" => Some(AiTask::Custom),
        _ => None,
    }
}

fn status_name(status: RunStatus) -> &'static str {
    match status {
        RunStatus::Running => "running",
        RunStatus::Completed => "completed",
        RunStatus::Failed => "failed",
        RunStatus::Cancelled => "cancelled",
        RunStatus::Interrupted => "interrupted",
    }
}

fn parse_status(value: &str) -> Option<RunStatus> {
    match value {
        "running" => Some(RunStatus::Running),
        "completed" => Some(RunStatus::Completed),
        "failed" => Some(RunStatus::Failed),
        "cancelled" => Some(RunStatus::Cancelled),
        "interrupted" => Some(RunStatus::Interrupted),
        _ => None,
    }
}

fn invalid_enum(index: usize, name: &str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        index,
        Type::Text,
        Box::new(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("invalid {name}"),
        )),
    )
}

fn unix_timestamp() -> i64 {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    i64::try_from(seconds).unwrap_or(i64::MAX)
}

fn history_unavailable() -> AiError {
    AiError::new(
        "history_unavailable",
        "Local AI history is currently unavailable.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::openrouter::AiTask;

    fn fixture_run(id: &str, started_at: i64) -> StoredRun {
        StoredRun {
            id: id.to_string(),
            task: AiTask::Translation,
            model: "z-ai/glm-5.2".to_string(),
            status: RunStatus::Running,
            scope_json: r#"{"kind":"document"}"#.to_string(),
            source_hash: format!("hash-{id}"),
            prompt_version: "2026-08-02.test".to_string(),
            instruction: None,
            target_language: None,
            max_output_tokens: None,
            zdr_only: None,
            result_json: None,
            error_json: None,
            usage_json: None,
            started_at,
            finished_at: None,
        }
    }

    #[test]
    fn history_round_trips_summary_task_identity() {
        let directory = tempfile::tempdir().unwrap();
        let store = HistoryStore::open(&directory.path().join("history.sqlite3")).unwrap();
        let mut run = fixture_run("summary-run", 10);
        run.task = AiTask::Summary;

        store.insert_run(&run).unwrap();

        assert_eq!(
            store.detail(&run.id).unwrap().unwrap().task,
            AiTask::Summary
        );
    }

    #[test]
    fn history_round_trips_user_prompt_and_request_settings_without_source() {
        let directory = tempfile::tempdir().unwrap();
        let store = HistoryStore::open(&directory.path().join("history.sqlite3")).unwrap();
        let mut run = fixture_run("custom-run", 10);
        run.task = AiTask::Custom;
        run.instruction = Some("Rewrite this as a release note.".to_string());
        run.target_language = Some("ko".to_string());
        run.max_output_tokens = Some(8_192);
        run.zdr_only = Some(false);

        store.insert_run(&run).unwrap();
        let detail = store.detail(&run.id).unwrap().unwrap();

        assert_eq!(detail.instruction, run.instruction);
        assert_eq!(detail.target_language, run.target_language);
        assert_eq!(detail.max_output_tokens, Some(8_192));
        assert_eq!(detail.zdr_only, Some(false));
        assert!(!serde_json::to_string(&detail).unwrap().contains("full source body"));
    }

    #[test]
    fn history_migrates_pages_prunes_and_recovers_interrupted_runs() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("history.sqlite3");
        let store = HistoryStore::open(&path).unwrap();

        for index in 0..505 {
            let id = format!("run-{index:03}");
            store.insert_run(&fixture_run(&id, index)).unwrap();
            store
                .finish_run(&id, RunStatus::Completed, None, None)
                .unwrap();
        }

        let first = store.page(0, 20).unwrap();
        assert_eq!(first.total, 500);
        assert_eq!(first.page, 0);
        assert_eq!(first.page_size, 20);
        assert_eq!(first.items.len(), 20);
        assert_eq!(first.items[0].id, "run-504");
        assert!(store.detail("run-000").unwrap().is_none());

        store.insert_run(&fixture_run("running", 999)).unwrap();
        drop(store);

        let reopened = HistoryStore::open(&path).unwrap();
        let recovered = reopened.detail("running").unwrap().unwrap();
        assert_eq!(recovered.status, RunStatus::Interrupted);
        assert!(recovered.finished_at.is_some());
        assert_eq!(reopened.page(0, 200).unwrap().items.len(), 20);
        assert_eq!(reopened.page(0, 20).unwrap().total, 500);
    }

    #[test]
    fn history_returns_details_and_persists_deletion() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("nested").join("history.sqlite3");
        let store = HistoryStore::open(&path).unwrap();
        let mut run = fixture_run("run-detail", 10);
        run.usage_json = Some(r#"{"promptTokens":10}"#.to_string());
        store.insert_run(&run).unwrap();
        store
            .finish_run(
                &run.id,
                RunStatus::Failed,
                Some(r#"{"summary":"partial"}"#),
                Some(r#"{"code":"network_error"}"#),
            )
            .unwrap();

        let detail = store.detail(&run.id).unwrap().unwrap();
        assert_eq!(detail.status, RunStatus::Failed);
        assert_eq!(
            detail.result_json.as_deref(),
            Some(r#"{"summary":"partial"}"#)
        );
        assert_eq!(detail.usage_json, run.usage_json);
        assert!(store.delete(&run.id).unwrap());
        assert!(!store.delete(&run.id).unwrap());

        drop(store);
        let reopened = HistoryStore::open(&path).unwrap();
        assert!(reopened.detail(&run.id).unwrap().is_none());
    }

    #[test]
    fn clear_removes_every_run_and_child_row() {
        let directory = tempfile::tempdir().unwrap();
        let store = HistoryStore::open(&directory.path().join("history.sqlite3")).unwrap();
        store.insert_run(&fixture_run("one", 1)).unwrap();
        store.insert_run(&fixture_run("two", 2)).unwrap();

        assert_eq!(store.clear().unwrap(), 2);
        assert_eq!(store.page(0, 20).unwrap().total, 0);
    }

    #[test]
    fn interview_recommendations_migrate_and_persist() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("history.sqlite3");
        let connection = Connection::open(&path).unwrap();
        connection.execute_batch(MIGRATION_1).unwrap();
        connection.execute_batch(MIGRATION_2).unwrap();
        connection.execute_batch(MIGRATION_3).unwrap();
        connection
            .execute_batch(
                r#"
                INSERT INTO ai_schema_migrations (version, applied_at)
                VALUES (1, 1), (2, 1), (3, 1);
                INSERT INTO ai_runs (
                    id, task, model, status, scope_json, source_hash,
                    prompt_version, started_at
                ) VALUES (
                    'legacy-interview', 'prd', 'z-ai/glm-5.2', 'running',
                    '{"kind":"document","target":{"documentId":"doc-1","label":"PRD.md"}}',
                    'hash', '2026-08-02.prd-interview.v2', 1
                );
                INSERT INTO ai_interviews (run_id, status, updated_at)
                VALUES ('legacy-interview', 'awaiting_answer', 1);
                INSERT INTO ai_interview_turns (
                    run_id, position, question, rationale, unresolved_area,
                    answer, skipped, created_at, updated_at
                ) VALUES (
                    'legacy-interview', 0, 'Who is this for?',
                    'The audience is unclear.', 'primary user', NULL, 0, 1, 1
                );
                "#,
            )
            .unwrap();
        drop(connection);

        let store = HistoryStore::open(&path).unwrap();
        let legacy = store.interview("legacy-interview").unwrap().unwrap();
        assert!(legacy.turns[0].recommended_answer.is_empty());

        store
            .append_interview_turn(
                "legacy-interview",
                &StoredInterviewTurn {
                    position: 1,
                    question: "What outcome defines success?".into(),
                    rationale: "The outcome is not measurable.".into(),
                    recommended_answer: "Use weekly successful reviews.".into(),
                    unresolved_area: "success metric".into(),
                    answer: None,
                    skipped: false,
                },
                "awaiting_answer",
            )
            .unwrap();
        drop(store);

        let reopened = HistoryStore::open(&path).unwrap();
        let migrated = reopened.interview("legacy-interview").unwrap().unwrap();
        assert_eq!(
            migrated.turns[1].recommended_answer,
            "Use weekly successful reviews."
        );
        let migration_4 = reopened
            .connection()
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM ai_schema_migrations WHERE version = 4",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap();
        assert_eq!(migration_4, 1);
    }

    #[test]
    fn translation_chunks_survive_failure_and_resume_without_raw_source() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("history.sqlite3");
        let store = HistoryStore::open(&path).unwrap();
        let run = fixture_run("resume-me", 1);
        store.insert_run(&run).unwrap();
        let chunk = StoredTranslationChunk {
            document_id: "doc-1".to_string(),
            file_index: 0,
            chunk_index: 17,
            source_start: 17,
            source_end: 42,
            heading: Some("Scope".to_string()),
            source_hash: "chunk-hash".to_string(),
            result_json: r#"{"proposedMarkdown":"번역","targetLanguage":"ko"}"#.to_string(),
            usage_json: Some(r#"{"totalTokens":12}"#.to_string()),
        };
        store.save_translation_chunk(&run.id, &chunk).unwrap();
        store
            .finish_run(&run.id, RunStatus::Failed, None, Some(r#"{"code":"offline"}"#))
            .unwrap();
        drop(store);

        let reopened = HistoryStore::open(&path).unwrap();
        let chunks = reopened
            .completed_translation_chunks(&run.id, "doc-1")
            .unwrap();
        assert_eq!(chunks, vec![chunk]);
        assert!(!chunks[0].result_json.contains("original source"));
        reopened.resume_run(&run.id).unwrap();
        assert_eq!(
            reopened.detail(&run.id).unwrap().unwrap().status,
            RunStatus::Running
        );
    }
}
