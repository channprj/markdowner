//! Selection structure stays local. The provider edits named prose fragments,
//! never the opaque tokens representing links, code, or Markdown delimiters.
use std::collections::{BTreeMap, HashMap};

use markdowner_core::ai_document::{
    AiDocumentEnvelope, SelectionResponse, ValidatedDocument, selection_markdown_view,
    validate_selection_markdown_response,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::{AiValidationIssue, schema_error, validation_issues};

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SelectionEditsResponse {
    #[serde(alias = "schemaVersion")]
    pub schema_version: u32,
    pub replacements: BTreeMap<String, String>,
    pub warnings: Vec<String>,
}

enum Part<'a> {
    Fixed(&'a str),
    Text { id: String, text: &'a str },
}

struct EditPlan<'a> {
    parts: Vec<Part<'a>>,
}

impl<'a> EditPlan<'a> {
    fn new(
        segments: impl IntoIterator<Item = (&'a str, &'a str)>,
        protected: impl IntoIterator<Item = (&'a str, &'a str)>,
    ) -> Self {
        let mut placeholders_by_segment: HashMap<&str, Vec<&str>> = HashMap::new();
        for (segment_id, placeholder) in protected {
            if !placeholder.is_empty() {
                placeholders_by_segment
                    .entry(segment_id)
                    .or_default()
                    .push(placeholder);
            }
        }
        let mut plan = Self { parts: Vec::new() };
        for (segment_id, text) in segments {
            let mut ranges = placeholders_by_segment
                .get(segment_id)
                .into_iter()
                .flatten()
                .flat_map(|placeholder| {
                    text.match_indices(*placeholder)
                        .map(|(start, matched)| start..start + matched.len())
                })
                .collect::<Vec<_>>();
            ranges.sort_unstable_by_key(|range| range.start);
            let mut cursor = 0;
            let mut slot = 0;
            for range in ranges {
                plan.push_text(segment_id, &mut slot, &text[cursor..range.start]);
                plan.parts.push(Part::Fixed(&text[range.clone()]));
                cursor = range.end;
            }
            plan.push_text(segment_id, &mut slot, &text[cursor..]);
        }
        plan
    }

    fn push_text(&mut self, segment_id: &str, slot: &mut usize, text: &'a str) {
        // Whitespace surrounding a link or emphasis marker is also structural.
        // Keep it locally so translating adjacent fragments cannot join words.
        if text.trim().is_empty() {
            self.parts.push(Part::Fixed(text));
            return;
        }
        let start = text.len() - text.trim_start().len();
        let end = text.trim_end().len();
        self.parts.push(Part::Fixed(&text[..start]));
        self.parts.push(Part::Text {
            id: format!("{segment_id}:text:{slot}"),
            text: &text[start..end],
        });
        self.parts.push(Part::Fixed(&text[end..]));
        *slot += 1;
    }

    fn from_document(document: &'a Value) -> Self {
        Self::new(
            document["segments"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|segment| Some((segment["id"].as_str()?, segment["text"].as_str()?))),
            document["protected"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|token| {
                    Some((token["segmentId"].as_str()?, token["placeholder"].as_str()?))
                }),
        )
    }

    fn texts(&self) -> impl Iterator<Item = (&str, &str)> {
        self.parts.iter().filter_map(|part| match part {
            Part::Text { id, text } => Some((id.as_str(), *text)),
            Part::Fixed(_) => None,
        })
    }
}

pub(super) fn provider_document(document: &Value) -> Value {
    json!({"segments": EditPlan::from_document(document).texts()
        .map(|(id, text)| json!({"id":id,"text":text})).collect::<Vec<_>>()})
}

pub(super) fn response_schema(document: &Value) -> Value {
    let plan = EditPlan::from_document(document);
    let properties = plan
        .texts()
        .map(|(id, _)| (id.to_string(), json!({"type":"string"})))
        .collect::<serde_json::Map<_, _>>();
    let required = plan.texts().map(|(id, _)| id).collect::<Vec<_>>();
    json!({
        "type":"object", "additionalProperties":false,
        "required":["schema_version","replacements","warnings"],
        "properties": {
            "schema_version":{"type":"integer","const":1},
            "replacements":{"type":"object","additionalProperties":false,
                "required":required,"properties":properties},
            "warnings":{"type":"array","items":{"type":"string"}}
        }
    })
}

/// A structural selection edit: the provider rewrites the selection's
/// Markdown, so formatting requests become real Markdown syntax.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SelectionMarkdownResponse {
    #[serde(alias = "schemaVersion")]
    pub schema_version: u32,
    #[serde(alias = "replacementMarkdown")]
    pub replacement_markdown: String,
    pub warnings: Vec<String>,
}

pub(super) fn markdown_provider_document(document: &Value) -> Value {
    let markdown = serde_json::from_value::<AiDocumentEnvelope>(document.clone())
        .map(|envelope| selection_markdown_view(&envelope))
        .unwrap_or_default();
    json!({"selection_markdown": markdown})
}

pub(super) fn markdown_response_schema() -> Value {
    json!({
        "type":"object", "additionalProperties":false,
        "required":["schema_version","replacement_markdown","warnings"],
        "properties": {
            "schema_version":{"type":"integer","const":1},
            "replacement_markdown":{"type":"string"},
            "warnings":{"type":"array","items":{"type":"string"}}
        }
    })
}

/// Structural (Markdown) results and text-fragment results share one
/// validation entry point; the response shape identifies the mode.
pub(super) fn validate_response(
    envelope: &AiDocumentEnvelope,
    content: &str,
) -> Result<ValidatedDocument, Vec<AiValidationIssue>> {
    if let Ok(response) = serde_json::from_str::<SelectionMarkdownResponse>(content) {
        if response.schema_version != 1 {
            return Err(vec![AiValidationIssue {
                code: "invalid_schema".to_string(),
                message: format!(
                    "Unsupported schema version {}; expected 1.",
                    response.schema_version
                ),
                segment_id: None,
            }]);
        }
        return validate_selection_markdown_response(
            envelope,
            &response.replacement_markdown,
            response.warnings,
        )
        .map_err(validation_issues);
    }
    restore_response(envelope, content).and_then(|response| {
        markdowner_core::ai_document::validate_selection_response(envelope, response)
            .map_err(validation_issues)
    })
}

pub(super) fn restore_response(
    envelope: &AiDocumentEnvelope,
    content: &str,
) -> Result<SelectionResponse, Vec<AiValidationIssue>> {
    let mut response: SelectionEditsResponse =
        serde_json::from_str(content).map_err(schema_error)?;
    let plan = EditPlan::new(
        envelope
            .segments
            .iter()
            .map(|segment| (segment.id.as_str(), segment.text.as_str())),
        envelope
            .protected
            .iter()
            .map(|token| (token.segment_id.as_str(), token.placeholder.as_str())),
    );
    let mut replacement_text = String::new();
    let mut issues = Vec::new();
    for part in plan.parts {
        match part {
            Part::Fixed(text) => replacement_text.push_str(text),
            Part::Text { id, .. } => {
                if let Some(text) = response.replacements.remove(&id) {
                    replacement_text.push_str(&text);
                } else {
                    issues.push(AiValidationIssue {
                        code: "selection_text_missing".to_string(),
                        message: "The provider omitted part of the selected text. No changes were applied.".to_string(),
                        segment_id: Some(id),
                    });
                }
            }
        }
    }
    if !response.replacements.is_empty() {
        issues.push(AiValidationIssue {
            code: "unknown_selection_text".to_string(),
            message: "The provider returned text outside the requested selection parts."
                .to_string(),
            segment_id: None,
        });
    }
    if !issues.is_empty() {
        return Err(issues);
    }
    Ok(SelectionResponse {
        schema_version: response.schema_version,
        replacement_text,
        warnings: response.warnings,
    })
}

#[cfg(test)]
mod tests {
    use markdowner_core::ai_document::{ByteRange, validate_selection_response};

    use super::*;

    fn envelope() -> AiDocumentEnvelope {
        let source = "Before.\n  **Hello** [world](https://example.test/private) `code`\r\nAfter.";
        AiDocumentEnvelope::new(
            "doc",
            source,
            Some(ByteRange {
                start: source.find("  **").unwrap(),
                end: source.find("After.").unwrap(),
            }),
        )
        .unwrap()
    }

    fn response(envelope: &AiDocumentEnvelope) -> Value {
        let document = provider_document(&serde_json::to_value(envelope).unwrap());
        json!({"schema_version":1, "warnings":[], "replacements":document["segments"].as_array().unwrap()
            .iter().map(|segment| (segment["id"].as_str().unwrap().to_string(), segment["text"].clone()))
            .collect::<serde_json::Map<_, _>>()})
    }

    #[test]
    fn translated_text_preserves_spacing_crlf_links_code_and_unselected_bytes() {
        let envelope = envelope();
        let mut response = response(&envelope);
        for text in response["replacements"]
            .as_object_mut()
            .unwrap()
            .values_mut()
        {
            *text = json!(
                text.as_str()
                    .unwrap()
                    .replace("Hello", "안녕")
                    .replace("world", "세계")
            );
        }
        let restored = restore_response(&envelope, &response.to_string()).unwrap();
        let validated = validate_selection_response(&envelope, restored).unwrap();
        assert_eq!(
            validated.proposed_markdown,
            "Before.\n  **안녕** [세계](https://example.test/private) `code`\r\nAfter."
        );
        let schema = response_schema(&serde_json::to_value(&envelope).unwrap());
        let required = schema["properties"]["replacements"]["required"]
            .as_array()
            .unwrap();
        assert_eq!(required.len(), 2);
        assert!(
            required
                .iter()
                .all(|id| response["replacements"].get(id.as_str().unwrap()).is_some())
        );
    }

    #[test]
    fn omitted_or_unknown_text_ids_are_rejected_instead_of_silently_kept_or_dropped() {
        let envelope = envelope();
        let mut missing = response(&envelope);
        let replacements = missing["replacements"].as_object_mut().unwrap();
        let first = replacements.keys().next().unwrap().clone();
        replacements.remove(&first);
        let issues = restore_response(&envelope, &missing.to_string()).unwrap_err();
        assert_eq!(issues[0].code, "selection_text_missing");

        let mut unknown = response(&envelope);
        unknown["replacements"]["unrequested"] = json!("Unexpected text");
        let issues = restore_response(&envelope, &unknown.to_string()).unwrap_err();
        assert_eq!(issues[0].code, "unknown_selection_text");
    }

    #[test]
    fn injected_markup_or_protected_tokens_still_fail_final_document_validation() {
        let envelope = envelope();
        for injection in [
            "<script>alert(1)</script>",
            envelope.protected[0].placeholder.as_str(),
        ] {
            let mut response = response(&envelope);
            let text = response["replacements"]
                .as_object_mut()
                .unwrap()
                .values_mut()
                .next()
                .unwrap();
            *text = json!(injection);
            let restored = restore_response(&envelope, &response.to_string()).unwrap();
            assert!(validate_selection_response(&envelope, restored).is_err());
        }
    }

    #[test]
    fn partial_link_destination_is_restored_without_exposing_it_to_the_provider() {
        let source = "[Hello](https://private.example.test) outside";
        let envelope =
            AiDocumentEnvelope::new("doc", source, Some(ByteRange { start: 1, end: 22 })).unwrap();
        let document = provider_document(&serde_json::to_value(&envelope).unwrap());
        assert_eq!(document["segments"].as_array().unwrap().len(), 1);
        assert_eq!(document["segments"][0]["text"], "Hello");
        let mut response = response(&envelope);
        *response["replacements"]
            .as_object_mut()
            .unwrap()
            .values_mut()
            .next()
            .unwrap() = json!("안녕");
        let restored = restore_response(&envelope, &response.to_string()).unwrap();
        let validated = validate_selection_response(&envelope, restored).unwrap();
        assert_eq!(
            validated.proposed_markdown,
            "[안녕](https://private.example.test) outside"
        );
    }

    #[test]
    fn markdown_responses_validate_structural_edits_and_text_responses_still_work() {
        let source = "Intro\n\nApples, pears, and `plums`.\n\nOutro\n";
        let start = source.find("Apples").unwrap();
        let end = start + "Apples, pears, and `plums`.".len();
        let envelope = AiDocumentEnvelope::new("doc", source, Some(ByteRange { start, end })).unwrap();
        let document = serde_json::to_value(&envelope).unwrap();
        let view = markdown_provider_document(&document)["selection_markdown"]
            .as_str()
            .unwrap()
            .to_string();
        let code = envelope.protected.iter().find(|token| token.original == "`plums`").unwrap();
        assert!(view.contains(&code.placeholder));

        let content = json!({
            "schema_version": 1,
            "replacement_markdown": format!("- Apples\n- pears\n- {}", code.placeholder),
            "warnings": []
        })
        .to_string();
        let validated = validate_response(&envelope, &content).unwrap();
        assert_eq!(
            validated.proposed_markdown,
            "Intro\n\n- Apples\n- pears\n- `plums`\n\nOutro\n"
        );

        let missing = json!({"schema_version":1,"replacement_markdown":"- Apples\n- pears","warnings":[]});
        assert!(validate_response(&envelope, &missing.to_string()).is_err());

        let text_mode = json!({
            "schema_version": 1,
            "replacements": provider_document(&document)["segments"].as_array().unwrap().iter()
                .map(|segment| (segment["id"].as_str().unwrap().to_string(), segment["text"].clone()))
                .collect::<serde_json::Map<_, _>>(),
            "warnings": []
        });
        assert_eq!(
            validate_response(&envelope, &text_mode.to_string()).unwrap().proposed_markdown,
            source
        );
    }

    #[test]
    fn markdown_list_conversion_keeps_a_number_only_paragraph_in_the_list() {
        let source = "테스트\n\n이것은\n\n리스트\n\n만들기 위한\n\n문장들 입니다\n\n123123\n";
        let end = source.find("123123").unwrap() + "123123".len();
        let envelope =
            AiDocumentEnvelope::new("doc", source, Some(ByteRange { start: 0, end })).unwrap();
        let document = serde_json::to_value(&envelope).unwrap();
        assert_eq!(
            markdown_provider_document(&document)["selection_markdown"],
            json!(&source[..end])
        );

        let list = "- 테스트\n- 이것은\n- 리스트\n- 만들기 위한\n- 문장들 입니다\n- 123123";
        let content = json!({"schema_version":1,"replacement_markdown":list,"warnings":[]});
        assert_eq!(
            validate_response(&envelope, &content.to_string()).unwrap().proposed_markdown,
            format!("{list}\n")
        );

        let changed = json!({
            "schema_version": 1,
            "replacement_markdown": list.replace("123123", "123"),
            "warnings": []
        });
        let issues = validate_response(&envelope, &changed.to_string()).unwrap_err();
        assert_eq!(issues[0].code, "protected_token_changed");
    }
}
