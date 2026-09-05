use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::{
    AiError,
    activity::AiRunScope,
    history::{StoredInterview, StoredInterviewTurn},
};

pub const PRD_INTERVIEW_PROMPT_VERSION: &str = "2026-09-06.prd-interview.v4";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InterviewStatus {
    AwaitingModel,
    AwaitingAnswer,
    ReadyToGenerate,
    Generating,
    Completed,
}

impl InterviewStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AwaitingModel => "awaiting_model",
            Self::AwaitingAnswer => "awaiting_answer",
            Self::ReadyToGenerate => "ready_to_generate",
            Self::Generating => "generating",
            Self::Completed => "completed",
        }
    }

    pub fn parse(value: &str) -> Result<Self, AiError> {
        match value {
            "awaiting_model" => Ok(Self::AwaitingModel),
            "awaiting_answer" => Ok(Self::AwaitingAnswer),
            "ready_to_generate" => Ok(Self::ReadyToGenerate),
            "generating" => Ok(Self::Generating),
            "completed" => Ok(Self::Completed),
            _ => Err(AiError::new(
                "invalid_interview_state",
                "The saved PRD interview state is invalid.",
            )),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterviewTurn {
    pub id: String,
    pub position: u32,
    pub question: String,
    pub rationale: String,
    pub recommended_answer: String,
    pub unresolved_area: String,
    pub answer: Option<String>,
    pub skipped: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelTurn {
    pub question: String,
    #[serde(default)]
    pub rationale: String,
    #[serde(default, alias = "recommendation", alias = "recommended_answer")]
    pub recommended_answer: String,
    #[serde(default, alias = "unresolved_area")]
    pub unresolved_area: String,
    #[serde(default, alias = "remaining_areas")]
    pub remaining_areas: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterviewSession {
    pub request_id: String,
    pub document_id: String,
    pub model: String,
    pub scope: AiRunScope,
    pub source_hash: String,
    pub status: InterviewStatus,
    pub turns: Vec<InterviewTurn>,
}

impl InterviewSession {
    pub fn current_turn(&self) -> Option<&InterviewTurn> {
        self.turns.last().filter(|turn| turn.answer.is_none() && !turn.skipped)
    }

    pub fn apply_model_turn(&mut self, model_turn: ModelTurn) -> Result<(), AiError> {
        if self.status != InterviewStatus::AwaitingModel {
            return Err(invalid_transition());
        }
        let question = model_turn.question.trim();
        if question.is_empty() {
            return Err(AiError::new(
                "invalid_interview_question",
                "The model returned an empty PRD interview question.",
            ));
        }
        let position = u32::try_from(self.turns.len()).unwrap_or(u32::MAX);
        self.turns.push(InterviewTurn {
            id: turn_id(&self.request_id, position),
            position,
            question: question.to_string(),
            rationale: model_turn.rationale.trim().to_string(),
            recommended_answer: model_turn.recommended_answer.trim().to_string(),
            unresolved_area: model_turn.unresolved_area.trim().to_string(),
            answer: None,
            skipped: false,
        });
        // The model cannot end an interview. Even an empty remaining_areas list
        // always leaves the session waiting for explicit user intent.
        self.status = InterviewStatus::AwaitingAnswer;
        Ok(())
    }

    pub fn answer(&mut self, answer: &str, explicit_finish: bool) -> Result<(), AiError> {
        if self.status != InterviewStatus::AwaitingAnswer {
            return Err(invalid_transition());
        }
        let answer = answer.trim();
        if answer.is_empty() && !explicit_finish {
            return Err(AiError::new(
                "answer_required",
                "Enter an answer or skip this question.",
            ));
        }
        let current = self.turns.last_mut().ok_or_else(invalid_transition)?;
        current.answer = (!answer.is_empty()).then(|| answer.to_string());
        current.skipped = answer.is_empty();
        self.status = if explicit_finish {
            InterviewStatus::ReadyToGenerate
        } else {
            InterviewStatus::AwaitingModel
        };
        Ok(())
    }

    pub fn skip(&mut self) -> Result<(), AiError> {
        self.answer("", false).or_else(|error| {
            if error.code == "answer_required" {
                let current = self.turns.last_mut().ok_or_else(invalid_transition)?;
                current.answer = None;
                current.skipped = true;
                self.status = InterviewStatus::AwaitingModel;
                Ok(())
            } else {
                Err(error)
            }
        })
    }

    pub fn history_data(&self) -> Value {
        Value::Array(
            self.turns
                .iter()
                .map(|turn| {
                    json!({
                        "position": turn.position,
                        "question": turn.question,
                        "rationale": turn.rationale,
                        "recommendedAnswer": turn.recommended_answer,
                        "unresolvedArea": turn.unresolved_area,
                        "answer": turn.answer,
                        "skipped": turn.skipped,
                    })
                })
                .collect(),
        )
    }

    pub fn to_stored_turn(&self, position: u32) -> Result<StoredInterviewTurn, AiError> {
        let turn = self
            .turns
            .get(position as usize)
            .ok_or_else(invalid_transition)?;
        Ok(StoredInterviewTurn {
            position: turn.position,
            question: turn.question.clone(),
            rationale: turn.rationale.clone(),
            recommended_answer: turn.recommended_answer.clone(),
            unresolved_area: turn.unresolved_area.clone(),
            answer: turn.answer.clone(),
            skipped: turn.skipped,
        })
    }

    pub fn from_stored(stored: StoredInterview) -> Result<Self, AiError> {
        let scope = serde_json::from_str(&stored.run.scope_json).map_err(|_| {
            AiError::new(
                "invalid_interview_scope",
                "The saved PRD interview scope is invalid.",
            )
        })?;
        Ok(Self {
            request_id: stored.run.id.clone(),
            document_id: scope_document_id(&scope).unwrap_or_else(|| stored.run.id.clone()),
            model: stored.run.model,
            scope,
            source_hash: stored.run.source_hash,
            status: InterviewStatus::parse(&stored.status)?,
            turns: stored
                .turns
                .into_iter()
                .map(|turn| InterviewTurn {
                    id: turn_id(&stored.run.id, turn.position),
                    position: turn.position,
                    question: turn.question,
                    rationale: turn.rationale,
                    recommended_answer: turn.recommended_answer,
                    unresolved_area: turn.unresolved_area,
                    answer: turn.answer,
                    skipped: turn.skipped,
                })
                .collect(),
        })
    }
}

fn scope_document_id(scope: &AiRunScope) -> Option<String> {
    match scope {
        AiRunScope::Document { target } => Some(target.document_id.clone()),
        AiRunScope::Workspace { target, .. } => {
            target.as_ref().map(|target| target.document_id.clone())
        }
    }
}

fn turn_id(run_id: &str, position: u32) -> String {
    format!("{run_id}:{position}")
}

fn invalid_transition() -> AiError {
    AiError::new(
        "invalid_interview_transition",
        "The PRD interview changed state. Resume it and try again.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::activity::{AiDocumentRef, AiRunScope};

    fn fixture_session() -> InterviewSession {
        InterviewSession {
            request_id: "interview-1".into(),
            document_id: "doc-1".into(),
            model: "z-ai/glm-5.2".into(),
            scope: AiRunScope::Document {
                target: AiDocumentRef {
                    document_id: "doc-1".into(),
                    path: None,
                    label: "PRD.md".into(),
                },
            },
            source_hash: "hash".into(),
            status: InterviewStatus::AwaitingModel,
            turns: Vec::new(),
        }
    }

    fn fixture_model_turn() -> ModelTurn {
        ModelTurn {
            question: "What is the success threshold?".into(),
            rationale: "The draft has no measurable outcome.".into(),
            recommended_answer: "Adopt a measurable activation target.".into(),
            unresolved_area: "success metric".into(),
            remaining_areas: Vec::new(),
        }
    }

    #[test]
    fn interview_never_finishes_without_explicit_user_intent() {
        let mut session = fixture_session();
        session.apply_model_turn(fixture_model_turn()).unwrap();
        assert_eq!(session.status, InterviewStatus::AwaitingAnswer);
        assert_eq!(
            session.current_turn().unwrap().recommended_answer,
            "Adopt a measurable activation target."
        );

        session.answer("Enough for now", true).unwrap();
        assert_eq!(session.status, InterviewStatus::ReadyToGenerate);
        assert_eq!(
            session.history_data()[0]["recommendedAnswer"],
            "Adopt a measurable activation target."
        );
        assert_eq!(session.history_data()[0]["answer"], "Enough for now");
    }

    #[test]
    fn ordinary_answers_and_skips_always_request_one_more_question() {
        let mut answered = fixture_session();
        answered.apply_model_turn(fixture_model_turn()).unwrap();
        answered.answer("Ten weekly active teams", false).unwrap();
        assert_eq!(answered.status, InterviewStatus::AwaitingModel);

        let mut skipped = fixture_session();
        skipped.apply_model_turn(fixture_model_turn()).unwrap();
        skipped.skip().unwrap();
        assert_eq!(skipped.status, InterviewStatus::AwaitingModel);
        assert!(skipped.turns[0].skipped);
    }
}
