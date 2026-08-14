use std::{
    collections::{HashMap, HashSet},
    fmt,
    sync::OnceLock,
};

use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const AI_SCHEMA_VERSION: u32 = 1;
const MAX_AI_PROTECTED_TOKENS: usize = 32 * 1024;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ByteRange {
    pub start: usize,
    pub end: usize,
}

impl ByteRange {
    fn validate(self, source: &str) -> Result<Self, ValidationError> {
        if self.start >= self.end || self.end > source.len() {
            return Err(ValidationError::single(
                ValidationIssueCode::InvalidRange,
                "Selection must be a non-empty byte range inside the source.",
            ));
        }
        if !source.is_char_boundary(self.start) || !source.is_char_boundary(self.end) {
            return Err(ValidationError::single(
                ValidationIssueCode::InvalidUtf8Boundary,
                "Selection starts or ends inside a UTF-8 code point.",
            ));
        }
        Ok(self)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProtectedKind {
    Blank,
    BlockCode,
    InlineCode,
    LinkDestination,
    FrontmatterKey,
    MarkdownMarker,
    TableDelimiter,
    HtmlTag,
    SkillToken,
    Literal,
    Identifier,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectedToken {
    pub id: String,
    pub segment_id: String,
    pub placeholder: String,
    pub range: ByteRange,
    pub original: String,
    pub kind: ProtectedKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditableSegment {
    pub id: String,
    pub range: ByteRange,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectionPolicy {
    #[serde(default)]
    pub allow_literal_changes: bool,
    #[serde(default)]
    pub translate_frontmatter_values: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiDocumentEnvelope {
    pub document_id: String,
    pub source: String,
    pub selection: Option<ByteRange>,
    pub revision_hash: String,
    pub segments: Vec<EditableSegment>,
    pub protected: Vec<ProtectedToken>,
    pub policy: ProtectionPolicy,
}

impl AiDocumentEnvelope {
    pub fn new(
        document_id: impl Into<String>,
        source: impl Into<String>,
        selection: Option<ByteRange>,
    ) -> Result<Self, ValidationError> {
        Self::with_policy(document_id, source, selection, ProtectionPolicy::default())
    }

    pub fn with_policy(
        document_id: impl Into<String>,
        source: impl Into<String>,
        selection: Option<ByteRange>,
        policy: ProtectionPolicy,
    ) -> Result<Self, ValidationError> {
        let document_id = document_id.into();
        let source = source.into();
        if document_id.trim().is_empty() {
            return Err(ValidationError::single(
                ValidationIssueCode::InvalidDocumentId,
                "Document ID cannot be empty.",
            ));
        }
        let selection = selection.map(|range| range.validate(&source)).transpose()?;
        let revision_hash = revision_hash(&document_id, &source, selection);
        let scope = selection.unwrap_or(ByteRange {
            start: 0,
            end: source.len(),
        });
        let (segments, protected) = if selection.is_some() {
            let full_scope = ByteRange {
                start: 0,
                end: source.len(),
            };
            let (_, full_protected) = segment_source(&source, full_scope, &revision_hash, policy)?;
            segment_selection_from_full_protection(
                &source,
                scope,
                &revision_hash,
                policy,
                &full_protected,
            )?
        } else {
            segment_source(&source, scope, &revision_hash, policy)?
        };
        Ok(Self {
            document_id,
            source,
            selection,
            revision_hash,
            segments,
            protected,
            policy,
        })
    }

    pub fn scope(&self) -> ByteRange {
        self.selection.unwrap_or(ByteRange {
            start: 0,
            end: self.source.len(),
        })
    }

    pub fn selection_has_editable_bytes(&self) -> bool {
        let Some(selection) = self.selection else {
            return false;
        };
        let protected_bytes = self
            .protected
            .iter()
            .map(|token| token.range.end.saturating_sub(token.range.start))
            .sum::<usize>();
        selection.end.saturating_sub(selection.start) > protected_bytes
    }

    pub fn reconstruct_original(&self) -> Result<String, ValidationError> {
        let transformed = self
            .segments
            .iter()
            .map(|segment| (segment.id.as_str(), segment.text.as_str()))
            .collect::<HashMap<_, _>>();
        reconstruct_segments(self, &transformed)
    }
}

fn boundary_splits_range(boundary: usize, range: ByteRange) -> bool {
    range.start < boundary && boundary < range.end
}

pub fn revision_hash(document_id: &str, source: &str, selection: Option<ByteRange>) -> String {
    let mut hash = Sha256::new();
    hash.update(document_id.as_bytes());
    hash.update([0]);
    hash.update(source.as_bytes());
    hash.update([0]);
    if let Some(range) = selection {
        hash.update(range.start.to_le_bytes());
        hash.update(range.end.to_le_bytes());
    }
    format!("{:x}", hash.finalize())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationSegment {
    pub id: String,
    #[serde(alias = "translated_text")]
    pub translated_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationResponse {
    #[serde(alias = "schema_version")]
    pub schema_version: u32,
    #[serde(alias = "detected_source_language")]
    pub detected_source_language: String,
    #[serde(alias = "target_language")]
    pub target_language: String,
    pub segments: Vec<TranslationSegment>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryResponse {
    #[serde(alias = "schema_version")]
    pub schema_version: u32,
    #[serde(alias = "detected_source_language")]
    pub detected_source_language: String,
    #[serde(alias = "summary_language")]
    pub summary_language: String,
    #[serde(alias = "summary_markdown")]
    pub summary_markdown: String,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrdFinding {
    pub id: String,
    pub severity: String,
    pub category: String,
    #[serde(alias = "evidence_segment_id")]
    pub evidence_segment_id: Option<String>,
    pub rationale: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationKind {
    Replace,
    InsertBefore,
    InsertAfter,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrdOperation {
    pub id: String,
    pub kind: OperationKind,
    #[serde(alias = "target_segment_id")]
    pub target_segment_id: String,
    pub markdown: String,
    #[serde(default, alias = "finding_ids")]
    pub finding_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrdResponse {
    #[serde(alias = "schema_version")]
    pub schema_version: u32,
    pub summary: String,
    #[serde(default)]
    pub findings: Vec<PrdFinding>,
    #[serde(default)]
    pub operations: Vec<PrdOperation>,
    #[serde(default)]
    pub assumptions: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionResponse {
    #[serde(alias = "schema_version")]
    pub schema_version: u32,
    #[serde(alias = "replacement_text")]
    pub replacement_text: String,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub operation_id: String,
    pub source_range: ByteRange,
    pub original_markdown: String,
    pub proposed_markdown: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatedOperation {
    pub id: String,
    pub kind: OperationKind,
    pub target_segment_id: String,
    pub source_range: ByteRange,
    pub original_markdown: String,
    pub proposed_markdown: String,
    pub finding_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub passed: bool,
    pub issues: Vec<ValidationIssue>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatedDocument {
    pub source_revision_hash: String,
    pub proposed_markdown: String,
    pub validation: ValidationReport,
    pub operations: Vec<ValidatedOperation>,
    pub hunks: Vec<DiffHunk>,
    pub summary: Option<String>,
    pub findings: Vec<PrdFinding>,
    pub assumptions: Vec<String>,
    pub detected_source_language: Option<String>,
    pub target_language: Option<String>,
    pub warnings: Vec<String>,
    #[serde(skip)]
    source: String,
    #[serde(skip)]
    scope: ByteRange,
    #[serde(skip)]
    segments: Vec<EditableSegment>,
}

impl ValidatedDocument {
    pub fn render_selected(&self, operation_ids: &[String]) -> Result<String, ValidationError> {
        let selected = operation_ids
            .iter()
            .map(String::as_str)
            .collect::<HashSet<_>>();
        let known = self
            .operations
            .iter()
            .map(|operation| operation.id.as_str())
            .collect::<HashSet<_>>();
        let unknown = selected.difference(&known).copied().collect::<Vec<_>>();
        if !unknown.is_empty() {
            return Err(ValidationError::single(
                ValidationIssueCode::UnknownOperation,
                format!("Unknown operation IDs: {}", unknown.join(", ")),
            ));
        }

        let mut rendered = String::with_capacity(self.source.len());
        rendered.push_str(&self.source[..self.scope.start]);
        for segment in &self.segments {
            for operation in self.operations.iter().filter(|operation| {
                operation.target_segment_id == segment.id
                    && operation.kind == OperationKind::InsertBefore
                    && selected.contains(operation.id.as_str())
            }) {
                rendered.push_str(&operation.proposed_markdown);
            }

            let replacements = self
                .operations
                .iter()
                .filter(|operation| {
                    operation.target_segment_id == segment.id
                        && operation.kind == OperationKind::Replace
                        && selected.contains(operation.id.as_str())
                })
                .collect::<Vec<_>>();
            if replacements.len() > 1 {
                return Err(ValidationError::single(
                    ValidationIssueCode::OverlappingOperation,
                    format!("Segment {} has multiple selected replacements.", segment.id),
                ));
            }
            if let Some(replacement) = replacements.first() {
                rendered.push_str(&replacement.proposed_markdown);
            } else {
                rendered.push_str(&self.source[segment.range.start..segment.range.end]);
            }

            for operation in self.operations.iter().filter(|operation| {
                operation.target_segment_id == segment.id
                    && operation.kind == OperationKind::InsertAfter
                    && selected.contains(operation.id.as_str())
            }) {
                rendered.push_str(&operation.proposed_markdown);
            }
        }
        rendered.push_str(&self.source[self.scope.end..]);
        validate_markdown_structure(&self.source, &rendered)?;
        Ok(rendered)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ValidationIssueCode {
    InvalidDocumentId,
    InvalidRange,
    InvalidUtf8Boundary,
    InvalidSchemaVersion,
    UnknownSegment,
    DuplicateSegment,
    MissingSegment,
    UnknownOperation,
    DuplicateOperation,
    OverlappingOperation,
    UnknownFinding,
    ProtectedTokenMissing,
    ProtectedTokenChanged,
    ProtectedTokenReordered,
    UnknownProtectedToken,
    MarkdownStructureChanged,
    DocumentTooComplex,
    SelectionRequired,
    EmptySummary,
    InvalidSummary,
    InvalidLanguage,
    LanguageMismatch,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub code: ValidationIssueCode,
    pub message: String,
    pub segment_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationError {
    pub issues: Vec<ValidationIssue>,
}

impl ValidationError {
    fn single(code: ValidationIssueCode, message: impl Into<String>) -> Self {
        Self {
            issues: vec![ValidationIssue {
                code,
                message: message.into(),
                segment_id: None,
            }],
        }
    }

    fn for_segment(
        code: ValidationIssueCode,
        message: impl Into<String>,
        segment_id: impl Into<String>,
    ) -> Self {
        Self {
            issues: vec![ValidationIssue {
                code,
                message: message.into(),
                segment_id: Some(segment_id.into()),
            }],
        }
    }

    fn extend(&mut self, other: Self) {
        self.issues.extend(other.issues);
    }
}

impl fmt::Display for ValidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{}",
            self.issues
                .iter()
                .map(|issue| issue.message.as_str())
                .collect::<Vec<_>>()
                .join("; ")
        )
    }
}

impl std::error::Error for ValidationError {}

pub fn validate_translation(
    envelope: &AiDocumentEnvelope,
    response: TranslationResponse,
) -> Result<ValidatedDocument, ValidationError> {
    validate_schema_version(response.schema_version)?;
    let transformed = validate_segment_collection(
        envelope,
        response
            .segments
            .iter()
            .map(|segment| (segment.id.as_str(), segment.translated_text.as_str())),
    )?;
    let proposed_markdown = reconstruct_segments(envelope, &transformed)?;
    validate_markdown_structure(&envelope.source, &proposed_markdown)?;

    let mut operations = Vec::new();
    for segment in &envelope.segments {
        let proposed = restore_segment(
            envelope,
            segment,
            transformed
                .get(segment.id.as_str())
                .copied()
                .unwrap_or_default(),
        )?;
        let original = envelope.source[segment.range.start..segment.range.end].to_string();
        if proposed != original {
            operations.push(ValidatedOperation {
                id: format!("translate:{}", segment.id),
                kind: OperationKind::Replace,
                target_segment_id: segment.id.clone(),
                source_range: segment.range,
                original_markdown: original,
                proposed_markdown: proposed,
                finding_ids: Vec::new(),
            });
        }
    }
    let hunks = hunks_for_operations(&operations);

    Ok(ValidatedDocument {
        source_revision_hash: envelope.revision_hash.clone(),
        proposed_markdown,
        validation: ValidationReport {
            passed: true,
            issues: Vec::new(),
        },
        operations,
        hunks,
        summary: None,
        findings: Vec::new(),
        assumptions: Vec::new(),
        detected_source_language: Some(response.detected_source_language),
        target_language: Some(response.target_language),
        warnings: response.warnings,
        source: envelope.source.clone(),
        scope: envelope.scope(),
        segments: envelope.segments.clone(),
    })
}

pub fn validate_summary_response(
    envelope: &AiDocumentEnvelope,
    response: SummaryResponse,
    requested_language: Option<&str>,
) -> Result<ValidatedDocument, ValidationError> {
    validate_schema_version(response.schema_version)?;
    if response.summary_markdown.trim().is_empty() {
        return Err(ValidationError::single(
            ValidationIssueCode::EmptySummary,
            "Summary Markdown cannot be empty.",
        ));
    }
    if response.summary_markdown.contains('\0') {
        return Err(ValidationError::single(
            ValidationIssueCode::InvalidSummary,
            "Summary Markdown contains an invalid NUL character.",
        ));
    }

    let detected_source_language =
        normalize_language_identifier(&response.detected_source_language)?;
    let summary_language = normalize_language_identifier(&response.summary_language)?;
    let expected_language = requested_language
        .map(normalize_language_identifier)
        .transpose()?
        .unwrap_or_else(|| detected_source_language.clone());
    if primary_language(&summary_language) != primary_language(&expected_language) {
        return Err(ValidationError::single(
            ValidationIssueCode::LanguageMismatch,
            format!(
                "Summary language {summary_language} does not match requested language {expected_language}."
            ),
        ));
    }

    Ok(ValidatedDocument {
        source_revision_hash: envelope.revision_hash.clone(),
        proposed_markdown: response.summary_markdown,
        validation: ValidationReport {
            passed: true,
            issues: Vec::new(),
        },
        operations: Vec::new(),
        hunks: Vec::new(),
        summary: None,
        findings: Vec::new(),
        assumptions: Vec::new(),
        detected_source_language: Some(detected_source_language),
        target_language: Some(summary_language),
        warnings: response.warnings,
        source: envelope.source.clone(),
        scope: envelope.scope(),
        segments: envelope.segments.clone(),
    })
}

fn normalize_language_identifier(language: &str) -> Result<String, ValidationError> {
    let normalized = language.trim().to_ascii_lowercase();
    if normalized.is_empty()
        || normalized.len() > 64
        || normalized
            .split('-')
            .any(|part| part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_alphanumeric()))
    {
        return Err(ValidationError::single(
            ValidationIssueCode::InvalidLanguage,
            "Language identifiers must use non-empty ASCII alphanumeric subtags separated by hyphens.",
        ));
    }
    Ok(normalized)
}

fn primary_language(language: &str) -> &str {
    language.split('-').next().unwrap_or(language)
}

pub fn validate_batched_translation(
    envelope: &AiDocumentEnvelope,
    proposed_markdown: String,
    detected_source_language: Option<String>,
    target_language: String,
    warnings: Vec<String>,
) -> Result<ValidatedDocument, ValidationError> {
    validate_markdown_structure(&envelope.source, &proposed_markdown)?;
    Ok(ValidatedDocument {
        source_revision_hash: envelope.revision_hash.clone(),
        proposed_markdown,
        validation: ValidationReport {
            passed: true,
            issues: Vec::new(),
        },
        operations: Vec::new(),
        hunks: Vec::new(),
        summary: None,
        findings: Vec::new(),
        assumptions: Vec::new(),
        detected_source_language,
        target_language: Some(target_language),
        warnings,
        source: envelope.source.clone(),
        scope: envelope.scope(),
        segments: envelope.segments.clone(),
    })
}

pub fn validate_prd_response(
    envelope: &AiDocumentEnvelope,
    response: PrdResponse,
) -> Result<ValidatedDocument, ValidationError> {
    validate_schema_version(response.schema_version)?;
    let segment_map = envelope
        .segments
        .iter()
        .map(|segment| (segment.id.as_str(), segment))
        .collect::<HashMap<_, _>>();
    let finding_ids = response
        .findings
        .iter()
        .map(|finding| finding.id.as_str())
        .collect::<HashSet<_>>();
    let mut issues = ValidationError { issues: Vec::new() };
    let mut seen_operations = HashSet::new();
    let mut replaced_segments = HashSet::new();
    let mut operations = Vec::new();

    for finding in &response.findings {
        if let Some(segment_id) = &finding.evidence_segment_id
            && !segment_map.contains_key(segment_id.as_str())
        {
            issues.extend(ValidationError::for_segment(
                ValidationIssueCode::UnknownSegment,
                format!(
                    "Finding {} references unknown segment {segment_id}.",
                    finding.id
                ),
                segment_id,
            ));
        }
    }

    for operation in &response.operations {
        if operation.id.trim().is_empty() || !seen_operations.insert(operation.id.as_str()) {
            issues.extend(ValidationError::single(
                ValidationIssueCode::DuplicateOperation,
                format!("Duplicate or empty operation ID: {}", operation.id),
            ));
            continue;
        }
        let Some(target) = segment_map.get(operation.target_segment_id.as_str()) else {
            issues.extend(ValidationError::for_segment(
                ValidationIssueCode::UnknownSegment,
                format!(
                    "Operation {} references unknown segment {}.",
                    operation.id, operation.target_segment_id
                ),
                &operation.target_segment_id,
            ));
            continue;
        };
        let unknown_findings = operation
            .finding_ids
            .iter()
            .filter(|id| !finding_ids.contains(id.as_str()))
            .cloned()
            .collect::<Vec<_>>();
        if !unknown_findings.is_empty() {
            issues.extend(ValidationError::single(
                ValidationIssueCode::UnknownFinding,
                format!(
                    "Operation {} references unknown findings: {}.",
                    operation.id,
                    unknown_findings.join(", ")
                ),
            ));
            continue;
        }
        if operation.kind == OperationKind::Replace
            && !replaced_segments.insert(operation.target_segment_id.as_str())
        {
            issues.extend(ValidationError::for_segment(
                ValidationIssueCode::OverlappingOperation,
                format!(
                    "Multiple replacements target segment {}.",
                    operation.target_segment_id
                ),
                &operation.target_segment_id,
            ));
            continue;
        }

        let original = envelope.source[target.range.start..target.range.end].to_string();
        let proposed = match operation.kind {
            OperationKind::Replace => restore_segment(envelope, target, &operation.markdown)?,
            OperationKind::InsertBefore | OperationKind::InsertAfter => {
                reject_unknown_placeholders(envelope, &operation.markdown)?;
                operation.markdown.clone()
            }
        };
        operations.push(ValidatedOperation {
            id: operation.id.clone(),
            kind: operation.kind,
            target_segment_id: operation.target_segment_id.clone(),
            source_range: target.range,
            original_markdown: original,
            proposed_markdown: proposed,
            finding_ids: operation.finding_ids.clone(),
        });
    }

    if !issues.issues.is_empty() {
        return Err(issues);
    }
    let hunks = hunks_for_operations(&operations);
    let mut validated = ValidatedDocument {
        source_revision_hash: envelope.revision_hash.clone(),
        proposed_markdown: String::new(),
        validation: ValidationReport {
            passed: true,
            issues: Vec::new(),
        },
        operations,
        hunks,
        summary: Some(response.summary),
        findings: response.findings,
        assumptions: response.assumptions,
        detected_source_language: None,
        target_language: None,
        warnings: Vec::new(),
        source: envelope.source.clone(),
        scope: envelope.scope(),
        segments: envelope.segments.clone(),
    };
    let all_ids = validated
        .operations
        .iter()
        .map(|operation| operation.id.clone())
        .collect::<Vec<_>>();
    validated.proposed_markdown = validated.render_selected(&all_ids)?;
    Ok(validated)
}

pub fn validate_selection_response(
    envelope: &AiDocumentEnvelope,
    response: SelectionResponse,
) -> Result<ValidatedDocument, ValidationError> {
    validate_schema_version(response.schema_version)?;
    let Some(scope) = envelope.selection else {
        return Err(ValidationError::single(
            ValidationIssueCode::SelectionRequired,
            "A non-empty selection is required for direct replacement.",
        ));
    };
    validate_all_protected_tokens(envelope, &response.replacement_text)?;
    let (replacement, bindings) = restore_text_with_bindings(envelope, &response.replacement_text)?;
    let proposed_markdown = format!(
        "{}{}{}",
        &envelope.source[..scope.start],
        replacement,
        &envelope.source[scope.end..]
    );
    validate_restored_protected_context(envelope, &proposed_markdown, &bindings, scope.start)?;
    validate_fixed_markdown_identifiers(&envelope.source, &proposed_markdown)?;
    validate_markdown_structure(&envelope.source, &proposed_markdown)?;
    let original = envelope.source[scope.start..scope.end].to_string();
    let operation = ValidatedOperation {
        id: "selection:replace".to_string(),
        kind: OperationKind::Replace,
        target_segment_id: "selection".to_string(),
        source_range: scope,
        original_markdown: original.clone(),
        proposed_markdown: replacement,
        finding_ids: Vec::new(),
    };

    Ok(ValidatedDocument {
        source_revision_hash: envelope.revision_hash.clone(),
        proposed_markdown,
        validation: ValidationReport {
            passed: true,
            issues: Vec::new(),
        },
        hunks: vec![DiffHunk {
            operation_id: operation.id.clone(),
            source_range: scope,
            original_markdown: original.clone(),
            proposed_markdown: operation.proposed_markdown.clone(),
        }],
        operations: vec![operation],
        summary: None,
        findings: Vec::new(),
        assumptions: Vec::new(),
        detected_source_language: None,
        target_language: None,
        warnings: response.warnings,
        source: envelope.source.clone(),
        scope,
        segments: vec![EditableSegment {
            id: "selection".to_string(),
            range: scope,
            text: original,
        }],
    })
}

pub fn validate_full_replacement(
    envelope: &AiDocumentEnvelope,
    replacement_text: &str,
    summary: String,
    warnings: Vec<String>,
) -> Result<ValidatedDocument, ValidationError> {
    if envelope.selection.is_some() {
        return Err(ValidationError::single(
            ValidationIssueCode::InvalidRange,
            "Full replacement requires a whole-document envelope.",
        ));
    }
    if summary.trim().is_empty() {
        return Err(ValidationError::single(
            ValidationIssueCode::EmptySummary,
            "A non-empty result summary is required.",
        ));
    }

    validate_all_protected_tokens(envelope, replacement_text)?;
    let (proposed_markdown, bindings) = restore_text_with_bindings(envelope, replacement_text)?;
    validate_restored_protected_context(envelope, &proposed_markdown, &bindings, 0)?;
    validate_fixed_markdown_identifiers(&envelope.source, &proposed_markdown)?;
    validate_markdown_structure(&envelope.source, &proposed_markdown)?;

    let scope = ByteRange {
        start: 0,
        end: envelope.source.len(),
    };
    let operation = ValidatedOperation {
        id: "document:replace".to_string(),
        kind: OperationKind::Replace,
        target_segment_id: "document".to_string(),
        source_range: scope,
        original_markdown: envelope.source.clone(),
        proposed_markdown: proposed_markdown.clone(),
        finding_ids: Vec::new(),
    };

    Ok(ValidatedDocument {
        source_revision_hash: envelope.revision_hash.clone(),
        proposed_markdown,
        validation: ValidationReport {
            passed: true,
            issues: Vec::new(),
        },
        hunks: vec![DiffHunk {
            operation_id: operation.id.clone(),
            source_range: scope,
            original_markdown: operation.original_markdown.clone(),
            proposed_markdown: operation.proposed_markdown.clone(),
        }],
        operations: vec![operation],
        summary: Some(summary),
        findings: Vec::new(),
        assumptions: Vec::new(),
        detected_source_language: None,
        target_language: None,
        warnings,
        source: envelope.source.clone(),
        scope,
        segments: vec![EditableSegment {
            id: "document".to_string(),
            range: scope,
            text: envelope.source.clone(),
        }],
    })
}

fn validate_schema_version(version: u32) -> Result<(), ValidationError> {
    if version == AI_SCHEMA_VERSION {
        Ok(())
    } else {
        Err(ValidationError::single(
            ValidationIssueCode::InvalidSchemaVersion,
            format!("Unsupported schema version {version}; expected {AI_SCHEMA_VERSION}."),
        ))
    }
}

fn validate_segment_collection<'a>(
    envelope: &'a AiDocumentEnvelope,
    segments: impl IntoIterator<Item = (&'a str, &'a str)>,
) -> Result<HashMap<&'a str, &'a str>, ValidationError> {
    let known = envelope
        .segments
        .iter()
        .map(|segment| segment.id.as_str())
        .collect::<HashSet<_>>();
    let mut transformed = HashMap::new();
    let mut issues = ValidationError { issues: Vec::new() };

    for (id, text) in segments {
        if !known.contains(id) {
            issues.extend(ValidationError::for_segment(
                ValidationIssueCode::UnknownSegment,
                format!("Unknown segment ID {id}."),
                id,
            ));
            continue;
        }
        if transformed.insert(id, text).is_some() {
            issues.extend(ValidationError::for_segment(
                ValidationIssueCode::DuplicateSegment,
                format!("Duplicate segment ID {id}."),
                id,
            ));
        }
    }
    for id in known {
        if !transformed.contains_key(id) {
            issues.extend(ValidationError::for_segment(
                ValidationIssueCode::MissingSegment,
                format!("Missing segment ID {id}."),
                id,
            ));
        }
    }
    if issues.issues.is_empty() {
        Ok(transformed)
    } else {
        Err(issues)
    }
}

fn reconstruct_segments(
    envelope: &AiDocumentEnvelope,
    transformed: &HashMap<&str, &str>,
) -> Result<String, ValidationError> {
    let scope = envelope.scope();
    let mut reconstructed = String::with_capacity(envelope.source.len());
    reconstructed.push_str(&envelope.source[..scope.start]);
    for segment in &envelope.segments {
        let text = transformed
            .get(segment.id.as_str())
            .copied()
            .ok_or_else(|| {
                ValidationError::for_segment(
                    ValidationIssueCode::MissingSegment,
                    format!("Missing segment {}.", segment.id),
                    &segment.id,
                )
            })?;
        reconstructed.push_str(&restore_segment(envelope, segment, text)?);
    }
    reconstructed.push_str(&envelope.source[scope.end..]);
    Ok(reconstructed)
}

fn restore_segment(
    envelope: &AiDocumentEnvelope,
    segment: &EditableSegment,
    text: &str,
) -> Result<String, ValidationError> {
    let expected = envelope
        .protected
        .iter()
        .filter(|token| token.segment_id == segment.id)
        .collect::<Vec<_>>();
    validate_protected_sequence(envelope, text, &expected, Some(&segment.id))?;
    restore_text(envelope, text)
}

fn validate_all_protected_tokens(
    envelope: &AiDocumentEnvelope,
    text: &str,
) -> Result<(), ValidationError> {
    let expected = envelope.protected.iter().collect::<Vec<_>>();
    validate_protected_sequence(envelope, text, &expected, None)
}

fn validate_protected_sequence(
    envelope: &AiDocumentEnvelope,
    text: &str,
    expected: &[&ProtectedToken],
    segment_id: Option<&str>,
) -> Result<(), ValidationError> {
    let mut issues = ValidationError { issues: Vec::new() };
    let expected_indices = expected
        .iter()
        .enumerate()
        .map(|(index, token)| (token.placeholder.as_str(), index))
        .collect::<HashMap<_, _>>();
    let known = envelope
        .protected
        .iter()
        .map(|token| token.placeholder.as_str())
        .collect::<HashSet<_>>();
    let mut counts = vec![0_usize; expected.len()];
    let mut observed_indices = Vec::with_capacity(expected.len());
    for (_, candidate) in scan_placeholders(text)? {
        if let Some(index) = expected_indices.get(candidate).copied() {
            counts[index] = counts[index].saturating_add(1);
            observed_indices.push(index);
        } else if !known.contains(candidate) {
            issues.extend(ValidationError::single(
                ValidationIssueCode::UnknownProtectedToken,
                "The result contains an unknown protected token.",
            ));
        }
    }
    for (index, token) in expected.iter().enumerate() {
        let count = counts[index];
        if count == 0 {
            issues.issues.push(ValidationIssue {
                code: ValidationIssueCode::ProtectedTokenMissing,
                message: format!("Protected token {} is missing.", token.id),
                segment_id: segment_id.map(ToOwned::to_owned),
            });
        } else if count != 1 {
            issues.issues.push(ValidationIssue {
                code: ValidationIssueCode::ProtectedTokenChanged,
                message: format!(
                    "Protected token {} occurs {count} times; expected exactly once.",
                    token.id
                ),
                segment_id: segment_id.map(ToOwned::to_owned),
            });
        }
    }
    if observed_indices
        .windows(2)
        .any(|window| window[0] >= window[1])
    {
        issues.issues.push(ValidationIssue {
            code: ValidationIssueCode::ProtectedTokenReordered,
            message: "Protected tokens changed order.".to_string(),
            segment_id: segment_id.map(ToOwned::to_owned),
        });
    }
    if issues.issues.is_empty() {
        Ok(())
    } else {
        Err(issues)
    }
}

fn reject_unknown_placeholders(
    envelope: &AiDocumentEnvelope,
    text: &str,
) -> Result<(), ValidationError> {
    let known = envelope
        .protected
        .iter()
        .map(|token| token.placeholder.as_str())
        .collect::<HashSet<_>>();
    for (_, candidate) in scan_placeholders(text)? {
        if !known.contains(candidate) {
            return Err(ValidationError::single(
                ValidationIssueCode::UnknownProtectedToken,
                "The result contains an unknown protected token.",
            ));
        }
    }
    Ok(())
}

fn scan_placeholders(text: &str) -> Result<Vec<(usize, &str)>, ValidationError> {
    let mut placeholders = Vec::new();
    let mut cursor = 0;
    while let Some(relative_start) = text[cursor..].find("⟪MDNER_") {
        let start = cursor + relative_start;
        let relative_end = text[start..].find('⟫').ok_or_else(|| {
            ValidationError::single(
                ValidationIssueCode::UnknownProtectedToken,
                "The result contains an unknown protected token.",
            )
        })?;
        let end = start + relative_end + '⟫'.len_utf8();
        placeholders.push((start, &text[start..end]));
        cursor = end;
    }
    Ok(placeholders)
}

fn restore_text(envelope: &AiDocumentEnvelope, text: &str) -> Result<String, ValidationError> {
    restore_text_with_bindings(envelope, text).map(|(restored, _)| restored)
}

#[derive(Debug, Clone, Copy)]
struct RestoredProtectedBinding {
    token_index: usize,
    range: ByteRange,
}

fn restore_text_with_bindings(
    envelope: &AiDocumentEnvelope,
    text: &str,
) -> Result<(String, Vec<RestoredProtectedBinding>), ValidationError> {
    let originals = envelope
        .protected
        .iter()
        .enumerate()
        .map(|(index, token)| (token.placeholder.as_str(), (index, token.original.as_str())))
        .collect::<HashMap<_, _>>();
    let placeholders = scan_placeholders(text)?;
    let mut restored = String::with_capacity(text.len());
    let mut bindings = Vec::with_capacity(placeholders.len());
    let mut cursor = 0;
    for (start, placeholder) in placeholders {
        let (token_index, original) = originals.get(placeholder).copied().ok_or_else(|| {
            ValidationError::single(
                ValidationIssueCode::UnknownProtectedToken,
                "The result contains an unknown protected token.",
            )
        })?;
        restored.push_str(&text[cursor..start]);
        let restored_start = restored.len();
        restored.push_str(original);
        bindings.push(RestoredProtectedBinding {
            token_index,
            range: ByteRange {
                start: restored_start,
                end: restored_start + original.len(),
            },
        });
        cursor = start + placeholder.len();
    }
    restored.push_str(&text[cursor..]);
    Ok((restored, bindings))
}

fn validate_restored_protected_context(
    envelope: &AiDocumentEnvelope,
    proposed: &str,
    bindings: &[RestoredProtectedBinding],
    base: usize,
) -> Result<(), ValidationError> {
    let selected_expected = bindings
        .iter()
        .map(|binding| {
            let token = &envelope.protected[binding.token_index];
            let expected = ByteRange {
                start: base
                    .checked_add(binding.range.start)
                    .ok_or_else(fixed_identifier_error)?,
                end: base
                    .checked_add(binding.range.end)
                    .ok_or_else(fixed_identifier_error)?,
            };
            Ok((
                (token.range.start, token.range.end),
                (expected, binding.token_index),
            ))
        })
        .collect::<Result<HashMap<_, _>, ValidationError>>()?;
    let full_context = envelope
        .selection
        .map(|_| {
            AiDocumentEnvelope::with_policy(
                "restored-original-context",
                &envelope.source,
                None,
                envelope.policy,
            )
        })
        .transpose()?;
    let context = full_context.as_ref().unwrap_or(envelope);
    let length_delta = proposed.len() as i128 - envelope.source.len() as i128;
    let mut expected_by_token = Vec::with_capacity(context.protected.len());
    for token in &context.protected {
        let expected = if let Some(scope) = envelope.selection {
            if token.range.end <= scope.start {
                Some(token.range)
            } else if token.range.start >= scope.end {
                shift_byte_range(token.range, length_delta)
            } else {
                let clipped = ByteRange {
                    start: token.range.start.max(scope.start),
                    end: token.range.end.min(scope.end),
                };
                let (restored, fragment_index) = selected_expected
                    .get(&(clipped.start, clipped.end))
                    .copied()
                    .ok_or_else(fixed_identifier_error)?;
                let fragment = &envelope.protected[fragment_index];
                if fragment.kind != token.kind
                    || fragment.original != envelope.source[clipped.start..clipped.end]
                {
                    return Err(fixed_identifier_error());
                }
                let start = if token.range.start < scope.start {
                    token.range.start
                } else {
                    restored.start
                };
                let end = if token.range.end > scope.end {
                    usize::try_from(token.range.end as i128 + length_delta).ok()
                } else {
                    Some(restored.end)
                };
                end.map(|end| ByteRange { start, end })
            }
        } else {
            selected_expected
                .get(&(token.range.start, token.range.end))
                .map(|(range, _)| *range)
        };
        expected_by_token.push(expected);
    }

    let observed = AiDocumentEnvelope::with_policy(
        "restored-protected-context",
        proposed,
        None,
        envelope.policy,
    )?;
    let observed_by_range = observed
        .protected
        .iter()
        .map(|token| ((token.range.start, token.range.end), token))
        .collect::<HashMap<_, _>>();
    let original_table_delimiters = table_delimiters_with_headers(&context.source);
    let proposed_table_delimiters = table_delimiters_with_headers(proposed);
    let original_newline_by_end = context
        .protected
        .iter()
        .enumerate()
        .filter(|(_, token)| token.original.ends_with('\n'))
        .map(|(index, token)| (token.range.end, index))
        .collect::<HashMap<_, _>>();

    for (token_index, token) in context.protected.iter().enumerate() {
        let expected = expected_by_token[token_index].ok_or_else(fixed_identifier_error)?;
        let Some(candidate) = observed_by_range.get(&(expected.start, expected.end)) else {
            return Err(fixed_identifier_error());
        };
        if candidate.kind != token.kind || candidate.original != token.original {
            return Err(fixed_identifier_error());
        }

        if let Some(original_role) = inline_delimiter_flanking(&context.source, token.range)
            && inline_delimiter_flanking(proposed, expected) != Some(original_role)
        {
            return Err(fixed_identifier_error());
        }
        if block_prefix_has_content(&context.source, token.range)
            && !block_prefix_has_content(proposed, expected)
        {
            return Err(fixed_identifier_error());
        }

        if token.kind == ProtectedKind::TableDelimiter
            && original_table_delimiters.contains(&(token.range.start, token.range.end))
        {
            if !proposed_table_delimiters.contains(&(expected.start, expected.end)) {
                return Err(fixed_identifier_error());
            }
            let original_header_newline = original_newline_by_end.get(&token.range.start).copied();
            match original_header_newline {
                Some(index)
                    if expected_by_token[index]
                        .is_some_and(|header_newline| header_newline.end == expected.start) => {}
                _ => return Err(fixed_identifier_error()),
            }
        }
    }
    validate_mapped_block_prefix_chains(&context.protected, &expected_by_token)?;
    validate_mapped_table_contexts(
        &context.source,
        proposed,
        &context.protected,
        &expected_by_token,
        envelope.selection,
    )?;
    Ok(())
}

fn shift_byte_range(range: ByteRange, delta: i128) -> Option<ByteRange> {
    Some(ByteRange {
        start: usize::try_from(range.start as i128 + delta).ok()?,
        end: usize::try_from(range.end as i128 + delta).ok()?,
    })
}

fn inline_delimiter_flanking(source: &str, range: ByteRange) -> Option<(bool, bool)> {
    let marker = source.get(range.start..range.end)?;
    let marker_byte = marker.as_bytes().first().copied()?;
    if !matches!(marker_byte, b'*' | b'_' | b'~') || !marker.bytes().all(|byte| byte == marker_byte)
    {
        return None;
    }
    let previous = source[..range.start].chars().next_back();
    let next = source[range.end..].chars().next();
    let previous_whitespace = previous.is_none_or(char::is_whitespace);
    let next_whitespace = next.is_none_or(char::is_whitespace);
    let previous_punctuation = previous.is_some_and(is_markdown_punctuation);
    let next_punctuation = next.is_some_and(is_markdown_punctuation);
    let left_flanking =
        !next_whitespace && (!next_punctuation || previous_whitespace || previous_punctuation);
    let right_flanking =
        !previous_whitespace && (!previous_punctuation || next_whitespace || next_punctuation);
    if marker_byte == b'_' {
        Some((
            left_flanking && (!right_flanking || previous_punctuation),
            right_flanking && (!left_flanking || next_punctuation),
        ))
    } else {
        Some((left_flanking, right_flanking))
    }
}

fn is_markdown_punctuation(character: char) -> bool {
    character.is_ascii_punctuation()
        || matches!(
            character,
            '\u{2010}'..='\u{2027}'
                | '\u{2030}'..='\u{205E}'
                | '\u{2E00}'..='\u{2E7F}'
                | '\u{3001}'..='\u{303F}'
                | '\u{FE10}'..='\u{FE6B}'
                | '\u{FF01}'..='\u{FF0F}'
                | '\u{FF1A}'..='\u{FF20}'
                | '\u{FF3B}'..='\u{FF40}'
                | '\u{FF5B}'..='\u{FF65}'
        )
}

fn block_prefix_has_content(source: &str, marker_range: ByteRange) -> bool {
    let Some(marker) = source.get(marker_range.start..marker_range.end) else {
        return false;
    };
    if markdown_prefix_end(marker) != Some(marker.len()) {
        return false;
    }
    let line_end = source[marker_range.end..]
        .find('\n')
        .map(|relative| marker_range.end + relative)
        .unwrap_or(source.len());
    !source[marker_range.end..line_end].trim().is_empty()
}

fn validate_mapped_block_prefix_chains(
    original_tokens: &[ProtectedToken],
    expected_by_token: &[Option<ByteRange>],
) -> Result<(), ValidationError> {
    for (index, pair) in original_tokens.windows(2).enumerate() {
        let [first, second] = pair else {
            continue;
        };
        let first_is_prefix = first.kind == ProtectedKind::MarkdownMarker
            && markdown_prefix_end(&first.original) == Some(first.original.len());
        let second_is_prefix = second.kind == ProtectedKind::MarkdownMarker
            && markdown_prefix_end(&second.original) == Some(second.original.len());
        if first.range.end != second.range.start || !first_is_prefix || !second_is_prefix {
            continue;
        }
        let first_expected = expected_by_token
            .get(index)
            .copied()
            .flatten()
            .ok_or_else(fixed_identifier_error)?;
        let second_expected = expected_by_token
            .get(index + 1)
            .copied()
            .flatten()
            .ok_or_else(fixed_identifier_error)?;
        if first_expected.end != second_expected.start {
            return Err(fixed_identifier_error());
        }
    }
    Ok(())
}

fn table_delimiters_with_headers(source: &str) -> HashSet<(usize, usize)> {
    let lines = line_ranges(source, 0);
    lines
        .iter()
        .enumerate()
        .filter(|(index, _)| *index > 0 && is_table_start(source, &lines, index - 1))
        .map(|(_, line)| (line.start, line.end))
        .collect()
}

fn validate_mapped_table_contexts(
    original: &str,
    proposed: &str,
    original_tokens: &[ProtectedToken],
    expected_by_token: &[Option<ByteRange>],
    selection: Option<ByteRange>,
) -> Result<(), ValidationError> {
    let original_tables = table_contexts_by_delimiter(original);
    if original_tables.is_empty() {
        return Ok(());
    }
    let proposed_tables = table_contexts_by_delimiter(proposed);
    let length_delta = proposed.len() as i128 - original.len() as i128;
    let token_by_range = original_tokens
        .iter()
        .enumerate()
        .map(|(index, token)| ((token.range.start, token.range.end), index))
        .collect::<HashMap<_, _>>();

    for (delimiter_range, original_lines) in original_tables {
        let original_delimiter = ByteRange {
            start: delimiter_range.0,
            end: delimiter_range.1,
        };
        let expected_delimiter = token_by_range
            .get(&delimiter_range)
            .and_then(|index| expected_by_token[*index])
            .or_else(|| {
                let scope = selection?;
                if original_delimiter.end <= scope.start {
                    Some(original_delimiter)
                } else if original_delimiter.start >= scope.end {
                    shift_byte_range(original_delimiter, length_delta)
                } else {
                    None
                }
            })
            .ok_or_else(fixed_identifier_error)?;
        let Some(proposed_lines) =
            proposed_tables.get(&(expected_delimiter.start, expected_delimiter.end))
        else {
            return Err(fixed_identifier_error());
        };
        if proposed_lines.len() < original_lines.len() {
            return Err(fixed_identifier_error());
        }

        for (original_line, proposed_line) in original_lines[2..].iter().zip(&proposed_lines[2..]) {
            let token_position = original_tokens
                .partition_point(|candidate| candidate.range.end <= original_line.start);
            let expected_anchor = original_tokens
                .get(token_position)
                .filter(|candidate| candidate.range.start < original_line.end)
                .and_then(|_| expected_by_token[token_position])
                .map(|range| range.start)
                .or_else(|| {
                    let scope = selection?;
                    let pipe = original[original_line.start..original_line.end]
                        .find('|')
                        .map(|relative| original_line.start + relative)?;
                    if pipe < scope.start {
                        Some(pipe)
                    } else if pipe >= scope.end {
                        usize::try_from(pipe as i128 + length_delta).ok()
                    } else {
                        None
                    }
                })
                .ok_or_else(fixed_identifier_error)?;
            if !(proposed_line.start <= expected_anchor && expected_anchor < proposed_line.end) {
                return Err(fixed_identifier_error());
            }
        }
    }
    Ok(())
}

fn table_contexts_by_delimiter(source: &str) -> HashMap<(usize, usize), Vec<ByteRange>> {
    let lines = line_ranges(source, 0);
    let structural = structural_line_views(source);
    let mut contexts = HashMap::new();
    let mut index = 1;
    while index < lines.len() {
        let header = structural[index - 1];
        let delimiter = structural[index];
        if header.ignored
            || delimiter.ignored
            || header.quote_depth != delimiter.quote_depth
            || !header.content.contains('|')
            || strict_table_delimiter_columns(delimiter.content).is_none()
        {
            index += 1;
            continue;
        }
        let mut table_lines = vec![lines[index - 1], lines[index]];
        let quote_depth = header.quote_depth;
        index += 1;
        while index < lines.len() {
            let row = structural[index];
            if row.ignored
                || row.quote_depth != quote_depth
                || row.content.trim().is_empty()
                || !row.content.contains('|')
            {
                break;
            }
            table_lines.push(lines[index]);
            index += 1;
        }
        let delimiter_range = table_lines[1];
        contexts.insert((delimiter_range.start, delimiter_range.end), table_lines);
    }
    contexts
}

fn hunks_for_operations(operations: &[ValidatedOperation]) -> Vec<DiffHunk> {
    operations
        .iter()
        .map(|operation| DiffHunk {
            operation_id: operation.id.clone(),
            source_range: operation.source_range,
            original_markdown: operation.original_markdown.clone(),
            proposed_markdown: operation.proposed_markdown.clone(),
        })
        .collect()
}

fn validate_markdown_structure(original: &str, proposed: &str) -> Result<(), ValidationError> {
    if markdown_fence_lines(original) != markdown_fence_lines(proposed) {
        return Err(ValidationError::single(
            ValidationIssueCode::MarkdownStructureChanged,
            "Markdown fence structure changed.",
        ));
    }
    let original_html = raw_html_ranges(original)
        .into_iter()
        .map(|range| &original[range.start..range.end])
        .collect::<Vec<_>>();
    let proposed_html = raw_html_ranges(proposed)
        .into_iter()
        .map(|range| &proposed[range.start..range.end])
        .collect::<Vec<_>>();
    if original_html != proposed_html {
        return Err(ValidationError::single(
            ValidationIssueCode::MarkdownStructureChanged,
            "Raw HTML tag structure changed.",
        ));
    }
    if let Err(error) = validate_table_structure(proposed)
        && (validate_table_structure(original).is_ok()
            || table_structure_signature(original) != table_structure_signature(proposed))
    {
        return Err(error);
    }
    Ok(())
}

pub fn validate_markdown_fragment(markdown: &str) -> Result<(), ValidationError> {
    validate_document_complexity(markdown)?;
    validate_balanced_fences(markdown)?;
    validate_table_structure(markdown)
}

pub fn validate_markdown_insertion(
    source: &str,
    cursor: usize,
    fragment: &str,
) -> Result<(), ValidationError> {
    if cursor > source.len() {
        return Err(ValidationError::single(
            ValidationIssueCode::InvalidRange,
            "Insertion cursor must be inside the source.",
        ));
    }
    if !source.is_char_boundary(cursor) {
        return Err(ValidationError::single(
            ValidationIssueCode::InvalidUtf8Boundary,
            "Insertion cursor must land on a UTF-8 boundary.",
        ));
    }

    let mut proposed = String::with_capacity(source.len().saturating_add(fragment.len()));
    proposed.push_str(&source[..cursor]);
    proposed.push_str(fragment);
    proposed.push_str(&source[cursor..]);
    validate_document_complexity(&proposed)?;
    if let Err(proposed_error) = validate_markdown_fragment(&proposed) {
        let unchanged_legacy_invalidity = validate_markdown_fragment(source).is_err()
            && markdown_fence_lines(source) == markdown_fence_lines(&proposed)
            && table_structure_signature(source) == table_structure_signature(&proposed);
        if !unchanged_legacy_invalidity {
            return Err(proposed_error);
        }
    }
    validate_existing_protected_ranges(source, cursor, fragment.len(), &proposed)?;
    validate_existing_markdown_identifiers(source, &proposed)
}

fn validate_document_complexity(source: &str) -> Result<(), ValidationError> {
    let line_breaks = source
        .bytes()
        .filter(|byte| *byte == b'\n')
        .take(MAX_AI_PROTECTED_TOKENS + 1)
        .count();
    if line_breaks > MAX_AI_PROTECTED_TOKENS {
        return Err(document_too_complex_error());
    }
    Ok(())
}

fn document_too_complex_error() -> ValidationError {
    ValidationError::single(
        ValidationIssueCode::DocumentTooComplex,
        "Markdown structural complexity exceeds the validation limit.",
    )
}

fn validate_balanced_fences(source: &str) -> Result<(), ValidationError> {
    let mut open_fence = None;
    for line in structural_line_views(source) {
        match open_fence {
            Some(opening)
                if is_closing_fence_in_container(line.content, line.quote_depth, opening) =>
            {
                open_fence = None;
            }
            None => open_fence = opening_fence_spec_in_container(line.content, line.quote_depth),
            _ => {}
        }
    }
    if open_fence.is_some() {
        return Err(ValidationError::single(
            ValidationIssueCode::MarkdownStructureChanged,
            "Markdown fence structure is invalid.",
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FenceSpec {
    marker: u8,
    run_len: usize,
    quote_depth: usize,
}

#[derive(Debug, Clone, Copy)]
struct ContainerLine<'a> {
    content: &'a str,
    quote_depth: usize,
}

fn blockquote_container(line: &str) -> ContainerLine<'_> {
    let bytes = line.as_bytes();
    let mut cursor = bytes
        .iter()
        .take(3)
        .take_while(|byte| **byte == b' ')
        .count();
    if bytes.get(cursor) != Some(&b'>') {
        return ContainerLine {
            content: line,
            quote_depth: 0,
        };
    }

    let mut quote_depth = 0;
    while bytes.get(cursor) == Some(&b'>') {
        quote_depth += 1;
        cursor += 1;
        if matches!(bytes.get(cursor), Some(b' ' | b'\t')) {
            cursor += 1;
        }
    }
    ContainerLine {
        content: &line[cursor..],
        quote_depth,
    }
}

fn fence_spec(line: &str) -> Option<FenceSpec> {
    let container = blockquote_container(line);
    let indent = container
        .content
        .as_bytes()
        .iter()
        .take_while(|byte| **byte == b' ')
        .count();
    if indent > 3 || container.content.as_bytes().get(indent) == Some(&b'\t') {
        return None;
    }
    let content = &container.content[indent..];
    let marker = content.as_bytes().first().copied()?;
    if !matches!(marker, b'`' | b'~') {
        return None;
    }
    let run_len = content
        .as_bytes()
        .iter()
        .take_while(|candidate| **candidate == marker)
        .count();
    let suffix = content[run_len..]
        .strip_suffix("\r\n")
        .or_else(|| content[run_len..].strip_suffix('\n'))
        .or_else(|| content[run_len..].strip_suffix('\r'))
        .unwrap_or(&content[run_len..]);
    if marker == b'`' && suffix.contains('`') {
        return None;
    }
    (run_len >= 3).then_some(FenceSpec {
        marker,
        run_len,
        quote_depth: container.quote_depth,
    })
}

fn fence_spec_in_container(line: &str, quote_depth: usize) -> Option<FenceSpec> {
    let mut spec = fence_spec(line)?;
    spec.quote_depth = quote_depth;
    Some(spec)
}

fn opening_fence_spec_in_container(line: &str, quote_depth: usize) -> Option<FenceSpec> {
    let mut content = line;
    while let Some(prefix) = list_item_content_indent(authored_line_content(content)) {
        content = &content[prefix..];
    }
    fence_spec_in_container(content, quote_depth)
}

fn is_closing_fence_in_container(line: &str, quote_depth: usize, opening: FenceSpec) -> bool {
    let Some(candidate) = fence_spec_in_container(line, quote_depth) else {
        return false;
    };
    if candidate.marker != opening.marker
        || candidate.run_len < opening.run_len
        || candidate.quote_depth != opening.quote_depth
    {
        return false;
    }
    let content = blockquote_container(line).content.trim_start_matches(' ');
    let suffix = &content[candidate.run_len..];
    let suffix = suffix
        .strip_suffix("\r\n")
        .or_else(|| suffix.strip_suffix('\n'))
        .or_else(|| suffix.strip_suffix('\r'))
        .unwrap_or(suffix);
    suffix.bytes().all(|byte| matches!(byte, b' ' | b'\t'))
}

fn validate_fixed_markdown_identifiers(
    original: &str,
    proposed: &str,
) -> Result<(), ValidationError> {
    if fixed_markdown_identifiers(original) != fixed_markdown_identifiers(proposed) {
        return Err(fixed_identifier_error());
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FixedMarkdownIdentifiers {
    inline_destinations: Vec<String>,
    reference_destinations: Vec<String>,
    skills: Vec<String>,
}

fn fixed_markdown_identifiers(source: &str) -> FixedMarkdownIdentifiers {
    FixedMarkdownIdentifiers {
        inline_destinations: {
            inline_link_ranges(source)
                .into_iter()
                .map(|link| source[link.destination.start..link.destination.end].to_string())
                .collect::<Vec<_>>()
        },
        reference_destinations: {
            reference_link_ranges(source)
                .into_iter()
                .map(|link| source[link.destination.start..link.destination.end].to_string())
                .collect::<Vec<_>>()
        },
        skills: {
            skill_token_ranges(source)
                .into_iter()
                .map(|range| source[range.start..range.end].to_string())
                .collect::<Vec<_>>()
        },
    }
}

fn validate_existing_markdown_identifiers(
    original: &str,
    proposed: &str,
) -> Result<(), ValidationError> {
    let original = fixed_markdown_identifiers(original);
    let proposed = fixed_markdown_identifiers(proposed);
    if !is_ordered_subsequence(&original.inline_destinations, &proposed.inline_destinations)
        || !is_ordered_subsequence(
            &original.reference_destinations,
            &proposed.reference_destinations,
        )
        || !is_ordered_subsequence(&original.skills, &proposed.skills)
    {
        return Err(fixed_identifier_error());
    }
    Ok(())
}

fn validate_existing_protected_ranges(
    source: &str,
    cursor: usize,
    inserted_len: usize,
    proposed: &str,
) -> Result<(), ValidationError> {
    let original = AiDocumentEnvelope::new("insertion-original", source, None)?;
    let observed = AiDocumentEnvelope::new("insertion-proposed", proposed, None)?;
    let observed_by_range = observed
        .protected
        .iter()
        .map(|token| ((token.range.start, token.range.end), token))
        .collect::<HashMap<_, _>>();
    let mut expected_by_token = vec![None; original.protected.len()];

    for (index, token) in original.protected.iter().enumerate() {
        if boundary_splits_range(cursor, token.range) {
            return Err(fixed_identifier_error());
        }
        let expected_range = if token.range.start >= cursor {
            ByteRange {
                start: token
                    .range
                    .start
                    .checked_add(inserted_len)
                    .ok_or_else(fixed_identifier_error)?,
                end: token
                    .range
                    .end
                    .checked_add(inserted_len)
                    .ok_or_else(fixed_identifier_error)?,
            }
        } else {
            token.range
        };
        expected_by_token[index] = Some(expected_range);
        let Some(candidate) = observed_by_range.get(&(expected_range.start, expected_range.end))
        else {
            return Err(fixed_identifier_error());
        };
        if candidate.kind != token.kind || candidate.original != token.original {
            return Err(fixed_identifier_error());
        }
        if let Some(original_role) = inline_delimiter_flanking(source, token.range)
            && inline_delimiter_flanking(proposed, expected_range) != Some(original_role)
        {
            return Err(fixed_identifier_error());
        }
        if block_prefix_has_content(source, token.range)
            && !block_prefix_has_content(proposed, expected_range)
        {
            return Err(fixed_identifier_error());
        }
    }
    validate_mapped_block_prefix_chains(&original.protected, &expected_by_token)?;
    validate_mapped_table_contexts(
        source,
        proposed,
        &original.protected,
        &expected_by_token,
        None,
    )?;
    Ok(())
}

fn is_ordered_subsequence(expected: &[String], observed: &[String]) -> bool {
    let mut expected_index = 0;
    for candidate in observed {
        if expected.get(expected_index) == Some(candidate) {
            expected_index += 1;
        }
    }
    expected_index == expected.len()
}

fn fixed_identifier_error() -> ValidationError {
    ValidationError::single(
        ValidationIssueCode::MarkdownStructureChanged,
        "Protected Markdown identifiers changed.",
    )
}

fn validate_table_structure(source: &str) -> Result<(), ValidationError> {
    let lines = structural_line_views(source);
    let mut index = 1;
    while index < lines.len() {
        let header = lines[index - 1];
        let delimiter = lines[index];
        if header.ignored
            || delimiter.ignored
            || header.quote_depth != delimiter.quote_depth
            || !header.content.contains('|')
            || !potential_table_delimiter(delimiter.content)
        {
            index += 1;
            continue;
        }
        let header_columns =
            table_column_count(header.content).ok_or_else(table_structure_error)?;
        let delimiter_columns =
            strict_table_delimiter_columns(delimiter.content).ok_or_else(table_structure_error)?;
        if header_columns == 0 || delimiter_columns != header_columns {
            return Err(table_structure_error());
        }
        index += 1;
        while index < lines.len() && !lines[index].content.trim().is_empty() {
            let row = lines[index];
            if row.ignored || row.quote_depth != header.quote_depth || !row.content.contains('|') {
                break;
            }
            if table_column_count(row.content) != Some(header_columns) {
                return Err(table_structure_error());
            }
            index += 1;
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy)]
struct StructuralLine<'a> {
    content: &'a str,
    quote_depth: usize,
    ignored: bool,
}

#[derive(Debug, Clone, Copy)]
struct NormalizedLine<'a> {
    content: &'a str,
    prefix_len: usize,
    quote_depth: usize,
}

fn normalized_line_views(source: &str) -> Vec<NormalizedLine<'_>> {
    let mut active_lists = Vec::new();
    source
        .split_inclusive('\n')
        .map(|line| {
            let container = blockquote_container(line);
            let mut content = container.content;
            let container_prefix = line.len() - content.len();
            let mut list_prefix = 0;
            if content.trim().is_empty() {
                // Blank lines do not end a list item's continuation context.
            } else {
                let continuation_indent = content
                    .as_bytes()
                    .iter()
                    .take_while(|byte| **byte == b' ')
                    .count();
                while active_lists.last().is_some_and(|(quote_depth, indent)| {
                    *quote_depth != container.quote_depth || *indent > continuation_indent
                }) {
                    active_lists.pop();
                }
                if let Some((_, indent)) = active_lists.last().copied() {
                    content = &content[indent..];
                    list_prefix = indent;
                }
            }
            if !content.trim().is_empty()
                && let Some(indent) = list_item_content_indent(content)
            {
                let nested_indent = list_prefix + indent;
                while active_lists
                    .last()
                    .is_some_and(|(quote_depth, active_indent)| {
                        *quote_depth == container.quote_depth && *active_indent >= nested_indent
                    })
                {
                    active_lists.pop();
                }
                active_lists.push((container.quote_depth, nested_indent));
            }
            NormalizedLine {
                content,
                prefix_len: container_prefix + list_prefix,
                quote_depth: container.quote_depth,
            }
        })
        .collect()
}

fn structural_line_views(source: &str) -> Vec<StructuralLine<'_>> {
    let mut open_fence = None;
    normalized_line_views(source)
        .into_iter()
        .map(|line| {
            let content = line.content;
            if let Some(opening) = open_fence {
                if is_closing_fence_in_container(content, line.quote_depth, opening) {
                    open_fence = None;
                }
                return StructuralLine {
                    content,
                    quote_depth: line.quote_depth,
                    ignored: true,
                };
            }
            if let Some(opening) = opening_fence_spec_in_container(content, line.quote_depth) {
                open_fence = Some(opening);
                return StructuralLine {
                    content,
                    quote_depth: line.quote_depth,
                    ignored: true,
                };
            }
            StructuralLine {
                content,
                quote_depth: line.quote_depth,
                ignored: is_indented_code(content),
            }
        })
        .collect()
}

fn list_item_content_indent(line: &str) -> Option<usize> {
    let bytes = line.as_bytes();
    let leading = bytes.iter().take_while(|byte| **byte == b' ').count();
    if leading > 3 {
        return None;
    }
    let marker_end = match bytes.get(leading)? {
        b'-' | b'+' | b'*' => leading + 1,
        byte if byte.is_ascii_digit() => {
            let mut cursor = leading + 1;
            while bytes.get(cursor).is_some_and(u8::is_ascii_digit) {
                cursor += 1;
            }
            if !matches!(bytes.get(cursor), Some(b'.' | b')')) {
                return None;
            }
            cursor + 1
        }
        _ => return None,
    };
    let following_spaces = bytes[marker_end..]
        .iter()
        .take(4)
        .take_while(|byte| matches!(byte, b' ' | b'\t'))
        .count();
    (following_spaces > 0).then_some(marker_end + following_spaces)
}

fn potential_table_delimiter(line: &str) -> bool {
    table_delimiter_cells(line).is_some_and(|cells| {
        cells.iter().all(|cell| {
            let cell = cell.trim();
            !cell.is_empty() && cell.contains('-') && cell.chars().all(|ch| matches!(ch, ':' | '-'))
        })
    })
}

fn strict_table_delimiter_columns(line: &str) -> Option<usize> {
    let cells = table_delimiter_cells(line)?;
    for cell in &cells {
        let cell = cell.trim();
        let without_left = cell.strip_prefix(':').unwrap_or(cell);
        let dashes = without_left.strip_suffix(':').unwrap_or(without_left);
        if dashes.len() < 3 || !dashes.bytes().all(|byte| byte == b'-') {
            return None;
        }
    }
    Some(cells.len())
}

fn table_delimiter_cells(line: &str) -> Option<Vec<&str>> {
    let trimmed = line.trim();
    if !trimmed.contains('|') {
        return None;
    }
    let without_leading = trimmed.strip_prefix('|').unwrap_or(trimmed);
    let inner = without_leading.strip_suffix('|').unwrap_or(without_leading);
    let cells = inner.split('|').collect::<Vec<_>>();
    (!cells.is_empty()).then_some(cells)
}

fn table_column_count(line: &str) -> Option<usize> {
    let trimmed = line.trim();
    if !trimmed.contains('|') {
        return None;
    }
    let bytes = trimmed.as_bytes();
    let mut separators = 0_usize;
    let mut escaped = false;
    for byte in bytes {
        if escaped {
            escaped = false;
        } else if *byte == b'\\' {
            escaped = true;
        } else if *byte == b'|' {
            separators = separators.saturating_add(1);
        }
    }
    let leading = usize::from(trimmed.starts_with('|'));
    let trailing =
        usize::from(trimmed.ends_with('|') && !is_ascii_marker_escaped(bytes, trimmed.len() - 1));
    separators
        .checked_add(1)?
        .checked_sub(leading)?
        .checked_sub(trailing)
}

fn table_structure_error() -> ValidationError {
    ValidationError::single(
        ValidationIssueCode::MarkdownStructureChanged,
        "Markdown table structure is invalid.",
    )
}

fn table_structure_signature(source: &str) -> Vec<(usize, bool, Option<usize>)> {
    structural_line_views(source)
        .into_iter()
        .filter(|line| !line.ignored && line.content.contains('|'))
        .map(|line| {
            (
                table_column_count(line.content).unwrap_or_default(),
                potential_table_delimiter(line.content),
                strict_table_delimiter_columns(line.content),
            )
        })
        .collect()
}

fn markdown_fence_lines(source: &str) -> Vec<&str> {
    normalized_line_views(source)
        .into_iter()
        .filter(|line| opening_fence_spec_in_container(line.content, line.quote_depth).is_some())
        .map(|line| line.content)
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarkdownBlockKind {
    FrontMatter,
    Heading,
    FencedCode,
    Table,
    List,
    Paragraph,
    Blank,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MarkdownBlockRange {
    pub range: ByteRange,
    pub kind: MarkdownBlockKind,
    pub heading: Option<String>,
}

/// Returns a complete, ordered partition of the Markdown source suitable for
/// structure-aware batching. Ranges always land on UTF-8 and authored line
/// boundaries; fenced code, leading front matter, tables, and list runs stay
/// indivisible.
pub fn markdown_block_ranges(source: &str) -> Vec<MarkdownBlockRange> {
    if source.is_empty() {
        return Vec::new();
    }
    let lines = line_ranges(source, 0);
    let normalized = normalized_line_views(source);
    let mut blocks = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        let start_index = index;
        let line = authored_line_content(normalized[index].content);
        let (kind, heading) = if index == 0 && line == "---" {
            index += 1;
            while index < lines.len() {
                let candidate = authored_line_content(normalized[index].content);
                index += 1;
                if candidate == "---" || candidate == "..." {
                    break;
                }
            }
            (MarkdownBlockKind::FrontMatter, None)
        } else if let Some(opening) =
            opening_fence_spec_in_container(line, normalized[index].quote_depth)
        {
            index += 1;
            while index < lines.len() {
                let candidate = authored_line_content(normalized[index].content);
                let quote_depth = normalized[index].quote_depth;
                index += 1;
                if is_closing_fence_in_container(candidate, quote_depth, opening) {
                    break;
                }
            }
            (MarkdownBlockKind::FencedCode, None)
        } else if heading_text(line).is_some() {
            index += 1;
            (
                MarkdownBlockKind::Heading,
                heading_text(line).map(str::to_string),
            )
        } else if is_table_start_in_normalized_lines(&normalized, index) {
            index += 2;
            while index < lines.len() && normalized[index].content.contains('|') {
                index += 1;
            }
            (MarkdownBlockKind::Table, None)
        } else if is_list_line(line) {
            index += 1;
            while index < lines.len() {
                let candidate = authored_line_content(normalized[index].content);
                if candidate.trim().is_empty()
                    || is_list_line(candidate)
                    || candidate.starts_with("  ")
                {
                    index += 1;
                } else {
                    break;
                }
            }
            (MarkdownBlockKind::List, None)
        } else if line.trim().is_empty() {
            index += 1;
            while index < lines.len() && normalized[index].content.trim().is_empty() {
                index += 1;
            }
            (MarkdownBlockKind::Blank, None)
        } else {
            index += 1;
            while index < lines.len() {
                let candidate = authored_line_content(normalized[index].content);
                if candidate.trim().is_empty()
                    || heading_text(candidate).is_some()
                    || opening_fence_spec_in_container(candidate, normalized[index].quote_depth)
                        .is_some()
                    || is_list_line(candidate)
                    || is_table_start_in_normalized_lines(&normalized, index)
                {
                    break;
                }
                index += 1;
            }
            (MarkdownBlockKind::Paragraph, None)
        };
        let range = ByteRange {
            start: lines[start_index].start,
            end: lines[index.saturating_sub(1)].end,
        };
        blocks.push(MarkdownBlockRange {
            range,
            kind,
            heading,
        });
    }
    blocks
}

fn line_content(source: &str, range: ByteRange) -> &str {
    authored_line_content(&source[range.start..range.end])
}

fn authored_line_content(line: &str) -> &str {
    line.strip_suffix('\n')
        .unwrap_or(line)
        .strip_suffix('\r')
        .unwrap_or_else(|| line.strip_suffix('\n').unwrap_or(line))
}

fn is_table_start_in_normalized_lines(lines: &[NormalizedLine<'_>], index: usize) -> bool {
    if index + 1 >= lines.len() {
        return false;
    }
    lines[index].quote_depth == lines[index + 1].quote_depth
        && lines[index].content.contains('|')
        && potential_table_delimiter(lines[index + 1].content)
}

fn heading_text(line: &str) -> Option<&str> {
    let trimmed = line.trim_start();
    let marker_end = trimmed.bytes().take_while(|byte| *byte == b'#').count();
    (marker_end > 0 && marker_end <= 6 && trimmed.as_bytes().get(marker_end) == Some(&b' '))
        .then(|| trimmed[marker_end + 1..].trim())
}

fn is_list_line(line: &str) -> bool {
    let trimmed = line.trim_start();
    trimmed.starts_with("- ")
        || trimmed.starts_with("* ")
        || trimmed.starts_with("+ ")
        || trimmed
            .split_once(['.', ')'])
            .is_some_and(|(number, rest)| {
                !number.is_empty()
                    && number.bytes().all(|byte| byte.is_ascii_digit())
                    && rest.starts_with(' ')
            })
}

fn is_table_start(source: &str, lines: &[ByteRange], index: usize) -> bool {
    if index + 1 >= lines.len() {
        return false;
    }
    let header = blockquote_container(line_content(source, lines[index]));
    let delimiter = blockquote_container(line_content(source, lines[index + 1]));
    header.quote_depth == delimiter.quote_depth
        && header.content.contains('|')
        && potential_table_delimiter(delimiter.content)
}

#[derive(Debug, Clone)]
struct LocalProtectedRange {
    start: usize,
    end: usize,
    kind: ProtectedKind,
}

fn segment_source(
    source: &str,
    scope: ByteRange,
    revision: &str,
    policy: ProtectionPolicy,
) -> Result<(Vec<EditableSegment>, Vec<ProtectedToken>), ValidationError> {
    if scope.start == scope.end {
        return Ok((Vec::new(), Vec::new()));
    }
    let scoped = &source[scope.start..scope.end];
    validate_document_complexity(scoped)?;
    let line_ranges = line_ranges(scoped, scope.start);
    let normalized_lines = normalized_line_views(scoped);
    let mut segments = Vec::new();
    let mut protected = Vec::new();
    let mut line_index = 0;
    let reference_links = reference_link_ranges(source);
    let reference_definitions = reference_links
        .iter()
        .map(|link| link.normalized_label.clone())
        .collect::<HashSet<_>>();
    let mut spanning_ranges = block_aware_inline_code_ranges(source)
        .into_iter()
        .map(|(start, end)| LocalProtectedRange {
            start,
            end,
            kind: ProtectedKind::InlineCode,
        })
        .collect::<Vec<_>>();
    spanning_ranges.extend(
        raw_html_ranges(source)
            .into_iter()
            .filter(|range| source[range.start..range.end].contains('\n'))
            .map(|range| LocalProtectedRange {
                start: range.start,
                end: range.end,
                kind: ProtectedKind::HtmlTag,
            }),
    );
    spanning_ranges.extend(
        inline_link_ranges(source)
            .into_iter()
            .filter(|link| source[link.prefix.start..link.close.end].contains('\n'))
            .map(|link| LocalProtectedRange {
                start: link.prefix.start,
                end: link.close.end,
                kind: ProtectedKind::LinkDestination,
            }),
    );
    spanning_ranges.extend(
        reference_links
            .iter()
            .filter(|link| source[link.definition.start..link.definition.end].contains('\n'))
            .map(|link| LocalProtectedRange {
                start: link.definition.start,
                end: link.definition.end,
                kind: ProtectedKind::LinkDestination,
            }),
    );
    spanning_ranges.extend(
        reference_links
            .iter()
            .filter(|link| source[link.definition.start..link.definition.end].contains('\n'))
            .flat_map(|link| [link.title_open, link.title_close])
            .flatten()
            .map(|range| LocalProtectedRange {
                start: range.start,
                end: range.end,
                kind: ProtectedKind::MarkdownMarker,
            }),
    );
    spanning_ranges.extend(
        reference_usage_identifier_ranges(source, &reference_definitions)
            .into_iter()
            .filter(|range| source[range.start..range.end].contains('\n'))
            .map(|range| LocalProtectedRange {
                start: range.start,
                end: range.end,
                kind: ProtectedKind::Identifier,
            }),
    );
    spanning_ranges.sort_by_key(|range| (range.start, range.end));
    let mut span_index = 0;
    let mut in_frontmatter = scope.start == 0
        && scoped
            .lines()
            .next()
            .is_some_and(|line| line.trim() == "---");

    while line_index < line_ranges.len() {
        let line_range = line_ranges[line_index];
        let line = &source[line_range.start..line_range.end];
        let normalized = normalized_lines[line_index];
        while spanning_ranges
            .get(span_index)
            .is_some_and(|span| span.end <= line_range.start)
        {
            span_index += 1;
        }

        if let Some(opening) =
            opening_fence_spec_in_container(normalized.content, normalized.quote_depth)
        {
            let block_start = line_range.start;
            let mut block_end = line_range.end;
            line_index += 1;
            while line_index < line_ranges.len() {
                let candidate = line_ranges[line_index];
                block_end = candidate.end;
                let candidate_line = normalized_lines[line_index];
                line_index += 1;
                if is_closing_fence_in_container(
                    candidate_line.content,
                    candidate_line.quote_depth,
                    opening,
                ) {
                    break;
                }
            }
            add_segment(
                source,
                ByteRange {
                    start: block_start,
                    end: block_end,
                },
                vec![LocalProtectedRange {
                    start: 0,
                    end: block_end - block_start,
                    kind: ProtectedKind::BlockCode,
                }],
                revision,
                &mut segments,
                &mut protected,
            )?;
            continue;
        }

        if is_indented_code(normalized.content) {
            let block_start = line_range.start;
            let mut block_end = line_range.end;
            line_index += 1;
            while line_index < line_ranges.len() {
                let candidate = line_ranges[line_index];
                let candidate_line = normalized_lines[line_index];
                if !is_indented_code(candidate_line.content)
                    && !candidate_line.content.trim().is_empty()
                {
                    break;
                }
                block_end = candidate.end;
                line_index += 1;
            }
            add_segment(
                source,
                ByteRange {
                    start: block_start,
                    end: block_end,
                },
                vec![LocalProtectedRange {
                    start: 0,
                    end: block_end - block_start,
                    kind: ProtectedKind::BlockCode,
                }],
                revision,
                &mut segments,
                &mut protected,
            )?;
            continue;
        }

        if !in_frontmatter
            && let Some(multiline_span) = spanning_ranges[span_index..]
                .iter()
                .take_while(|span| span.start < line_range.end)
                .find(|span| line_range.start <= span.start && line_range.end < span.end)
        {
            let block_start = line_range.start;
            let mut required_end = multiline_span.end;
            let mut group_span_end = span_index;
            let block_end_index = loop {
                let end_index = line_ranges[line_index..]
                    .iter()
                    .position(|range| required_end <= range.end)
                    .map(|relative| line_index + relative)
                    .unwrap_or(line_ranges.len() - 1);
                let line_group_end = line_ranges[end_index].end;
                let mut extended_end = required_end;
                while let Some(span) = spanning_ranges.get(group_span_end)
                    && span.start < line_group_end
                {
                    if block_start <= span.start {
                        extended_end = extended_end.max(span.end);
                    }
                    group_span_end += 1;
                }
                if extended_end <= required_end {
                    break end_index;
                }
                required_end = extended_end;
            };
            let block_end = line_ranges[block_end_index].end;
            let mut ranges = Vec::new();
            for (relative_index, current_line) in
                line_ranges[line_index..=block_end_index].iter().enumerate()
            {
                let current = &source[current_line.start..current_line.end];
                let normalized = normalized_lines[line_index + relative_index];
                ranges.extend(
                    protected_ranges_for_normalized_line(
                        current,
                        normalized,
                        false,
                        false,
                        policy,
                        false,
                        &reference_definitions,
                    )
                    .into_iter()
                    .map(|range| LocalProtectedRange {
                        start: current_line.start - block_start + range.start,
                        end: current_line.start - block_start + range.end,
                        kind: range.kind,
                    }),
                );
            }
            ranges.extend(
                spanning_ranges[span_index..group_span_end]
                    .iter()
                    .filter(|span| block_start <= span.start && span.end <= block_end)
                    .map(|span| LocalProtectedRange {
                        start: span.start - block_start,
                        end: span.end - block_start,
                        kind: span.kind,
                    }),
            );
            add_segment(
                source,
                ByteRange {
                    start: block_start,
                    end: block_end,
                },
                ranges,
                revision,
                &mut segments,
                &mut protected,
            )?;
            span_index = group_span_end;
            line_index = block_end_index + 1;
            continue;
        }

        let frontmatter_marker =
            in_frontmatter && matches!(normalized.content.trim(), "---" | "...");
        let ranges = protected_ranges_for_normalized_line(
            line,
            normalized,
            in_frontmatter,
            frontmatter_marker,
            policy,
            true,
            &reference_definitions,
        );
        add_segment(
            source,
            line_range,
            ranges,
            revision,
            &mut segments,
            &mut protected,
        )?;
        if in_frontmatter && frontmatter_marker && line_range.start > scope.start {
            in_frontmatter = false;
        }
        line_index += 1;
    }
    Ok((segments, protected))
}

fn segment_selection_from_full_protection(
    source: &str,
    scope: ByteRange,
    revision: &str,
    _policy: ProtectionPolicy,
    full_protected: &[ProtectedToken],
) -> Result<(Vec<EditableSegment>, Vec<ProtectedToken>), ValidationError> {
    validate_document_complexity(&source[scope.start..scope.end])?;
    let ranges = full_protected
        .iter()
        .filter_map(|token| {
            let start = token.range.start.max(scope.start);
            let end = token.range.end.min(scope.end);
            (start < end).then(|| LocalProtectedRange {
                start: start - scope.start,
                end: end - scope.start,
                kind: token.kind,
            })
        })
        .collect::<Vec<_>>();
    let mut segments = Vec::with_capacity(1);
    let mut protected = Vec::new();
    add_segment(
        source,
        scope,
        ranges,
        revision,
        &mut segments,
        &mut protected,
    )?;

    Ok((segments, protected))
}

fn line_ranges(scoped: &str, base: usize) -> Vec<ByteRange> {
    let mut ranges = Vec::new();
    let mut cursor = 0;
    for piece in scoped.split_inclusive('\n') {
        let end = cursor + piece.len();
        ranges.push(ByteRange {
            start: base + cursor,
            end: base + end,
        });
        cursor = end;
    }
    ranges
}

fn add_segment(
    source: &str,
    range: ByteRange,
    ranges: Vec<LocalProtectedRange>,
    revision: &str,
    segments: &mut Vec<EditableSegment>,
    protected: &mut Vec<ProtectedToken>,
) -> Result<(), ValidationError> {
    if !source.is_char_boundary(range.start) || !source.is_char_boundary(range.end) {
        return Err(ValidationError::single(
            ValidationIssueCode::InvalidUtf8Boundary,
            "Segment boundary is not a UTF-8 boundary.",
        ));
    }
    let segment_id = format!("seg-{:04}", segments.len() + 1);
    let line = &source[range.start..range.end];
    let ranges = merge_local_ranges(ranges, line.len());
    if protected.len().saturating_add(ranges.len()) > MAX_AI_PROTECTED_TOKENS {
        return Err(document_too_complex_error());
    }
    let mut masked = String::with_capacity(line.len());
    let mut cursor = 0;
    for local in ranges {
        if !line.is_char_boundary(local.start) || !line.is_char_boundary(local.end) {
            return Err(ValidationError::for_segment(
                ValidationIssueCode::InvalidUtf8Boundary,
                "Protected token boundary is not a UTF-8 boundary.",
                &segment_id,
            ));
        }
        masked.push_str(&line[cursor..local.start]);
        let token_id = format!("p-{:05}", protected.len() + 1);
        let placeholder = format!(
            "⟪MDNER_{}_P{:05}⟫",
            &revision[..12.min(revision.len())],
            protected.len() + 1
        );
        masked.push_str(&placeholder);
        protected.push(ProtectedToken {
            id: token_id,
            segment_id: segment_id.clone(),
            placeholder,
            range: ByteRange {
                start: range.start + local.start,
                end: range.start + local.end,
            },
            original: line[local.start..local.end].to_string(),
            kind: local.kind,
        });
        cursor = local.end;
    }
    masked.push_str(&line[cursor..]);
    segments.push(EditableSegment {
        id: segment_id,
        range,
        text: masked,
    });
    Ok(())
}

fn protected_ranges_for_normalized_line(
    raw_line: &str,
    normalized: NormalizedLine<'_>,
    in_frontmatter: bool,
    frontmatter_marker: bool,
    policy: ProtectionPolicy,
    scan_inline_code: bool,
    reference_definitions: &HashSet<String>,
) -> Vec<LocalProtectedRange> {
    if is_table_delimiter(normalized.content) {
        return vec![LocalProtectedRange {
            start: 0,
            end: raw_line.len(),
            kind: ProtectedKind::TableDelimiter,
        }];
    }
    let mut ranges = protected_ranges_for_line(
        normalized.content,
        in_frontmatter,
        frontmatter_marker,
        policy,
        scan_inline_code,
        reference_definitions,
    )
    .into_iter()
    .map(|range| LocalProtectedRange {
        start: normalized.prefix_len + range.start,
        end: normalized.prefix_len + range.end,
        kind: range.kind,
    })
    .collect::<Vec<_>>();
    if normalized.prefix_len > 0 {
        ranges.push(LocalProtectedRange {
            start: 0,
            end: normalized.prefix_len,
            kind: ProtectedKind::MarkdownMarker,
        });
    }
    ranges
}

fn protected_ranges_for_line(
    line: &str,
    in_frontmatter: bool,
    frontmatter_marker: bool,
    policy: ProtectionPolicy,
    scan_inline_code: bool,
    reference_definitions: &HashSet<String>,
) -> Vec<LocalProtectedRange> {
    if line.trim().is_empty() {
        return vec![LocalProtectedRange {
            start: 0,
            end: line.len(),
            kind: ProtectedKind::Blank,
        }];
    }
    if frontmatter_marker || is_table_delimiter(line) {
        return vec![LocalProtectedRange {
            start: 0,
            end: line.len(),
            kind: if frontmatter_marker {
                ProtectedKind::MarkdownMarker
            } else {
                ProtectedKind::TableDelimiter
            },
        }];
    }
    if is_thematic_or_setext_marker(line) {
        return protect_entire_line(line, ProtectedKind::MarkdownMarker);
    }

    let mut ranges = Vec::new();
    if in_frontmatter {
        let Some(colon) = line.find(':') else {
            return protect_entire_line(line, ProtectedKind::Literal);
        };
        let key = line[..colon].trim();
        if !policy.translate_frontmatter_values || !matches!(key, "title" | "description") {
            return protect_entire_line(line, ProtectedKind::Literal);
        }

        ranges.push(LocalProtectedRange {
            start: 0,
            end: colon + 1,
            kind: ProtectedKind::FrontmatterKey,
        });
        let value_start = colon + 1;
        let leading_space_count = line[value_start..]
            .bytes()
            .take_while(|byte| matches!(byte, b' ' | b'\t'))
            .count();
        if leading_space_count > 0 {
            ranges.push(LocalProtectedRange {
                start: value_start,
                end: value_start + leading_space_count,
                kind: ProtectedKind::MarkdownMarker,
            });
        }
        let line_content_end = line.strip_suffix("\r\n").map_or_else(
            || line.strip_suffix('\n').map_or(line.len(), str::len),
            str::len,
        );
        let value_content_start = value_start + leading_space_count;
        if line_content_end > value_content_start + 1 {
            let first = line.as_bytes()[value_content_start];
            let last = line.as_bytes()[line_content_end - 1];
            if first == last && matches!(first, b'\'' | b'"') {
                ranges.push(LocalProtectedRange {
                    start: value_content_start,
                    end: value_content_start + 1,
                    kind: ProtectedKind::MarkdownMarker,
                });
                ranges.push(LocalProtectedRange {
                    start: line_content_end - 1,
                    end: line_content_end,
                    kind: ProtectedKind::MarkdownMarker,
                });
            }
        }
    }
    let mut marker_cursor = 0;
    while let Some(marker_end) = markdown_prefix_end(&line[marker_cursor..]) {
        let marker_end = marker_cursor + marker_end;
        let marker = &line[marker_cursor..marker_end];
        ranges.push(LocalProtectedRange {
            start: marker_cursor,
            end: marker_end,
            kind: ProtectedKind::MarkdownMarker,
        });
        marker_cursor = marker_end;
        if marker.trim_start().starts_with('#') {
            break;
        }
    }
    if marker_cursor > 0
        && let Some(task_marker) = task_marker_regex().find(&line[marker_cursor..])
    {
        ranges.push(LocalProtectedRange {
            start: marker_cursor + task_marker.start(),
            end: marker_cursor + task_marker.end(),
            kind: ProtectedKind::MarkdownMarker,
        });
    }
    if scan_inline_code {
        for (start, end) in inline_code_ranges(line) {
            ranges.push(LocalProtectedRange {
                start,
                end,
                kind: ProtectedKind::InlineCode,
            });
        }
    }
    for link in inline_link_ranges(line) {
        let mut link_ranges = vec![
            (link.prefix, ProtectedKind::MarkdownMarker),
            (link.middle, ProtectedKind::MarkdownMarker),
            (link.destination, ProtectedKind::LinkDestination),
            (link.close, ProtectedKind::MarkdownMarker),
        ];
        link_ranges.extend(
            [link.title_open, link.title_close]
                .into_iter()
                .flatten()
                .map(|range| (range, ProtectedKind::MarkdownMarker)),
        );
        for (range, kind) in link_ranges {
            if range.start < range.end {
                ranges.push(LocalProtectedRange {
                    start: range.start,
                    end: range.end,
                    kind,
                });
            }
        }
    }
    for matched in inline_delimiter_regex().find_iter(line) {
        ranges.push(LocalProtectedRange {
            start: matched.start(),
            end: matched.end(),
            kind: ProtectedKind::MarkdownMarker,
        });
    }
    for matched in markdown_escape_regex().find_iter(line) {
        ranges.push(LocalProtectedRange {
            start: matched.start(),
            end: matched.end(),
            kind: ProtectedKind::MarkdownMarker,
        });
    }
    for link in reference_link_ranges(line) {
        ranges.push(LocalProtectedRange {
            start: link.definition.start,
            end: link.definition.end,
            kind: ProtectedKind::LinkDestination,
        });
        for marker in [link.title_open, link.title_close].into_iter().flatten() {
            ranges.push(LocalProtectedRange {
                start: marker.start,
                end: marker.end,
                kind: ProtectedKind::MarkdownMarker,
            });
        }
    }
    for identifier in reference_usage_identifier_ranges(line, reference_definitions) {
        ranges.push(LocalProtectedRange {
            start: identifier.start,
            end: identifier.end,
            kind: ProtectedKind::Identifier,
        });
    }
    for matched in raw_html_ranges(line) {
        ranges.push(LocalProtectedRange {
            start: matched.start,
            end: matched.end,
            kind: ProtectedKind::HtmlTag,
        });
    }
    for token in skill_token_ranges(line) {
        ranges.push(LocalProtectedRange {
            start: token.start,
            end: token.end,
            kind: ProtectedKind::SkillToken,
        });
    }
    for matched in model_identifier_regex().find_iter(line) {
        ranges.push(LocalProtectedRange {
            start: matched.start(),
            end: matched.end(),
            kind: ProtectedKind::Identifier,
        });
    }
    if !policy.allow_literal_changes {
        for matched in literal_regex().find_iter(line) {
            ranges.push(LocalProtectedRange {
                start: matched.start(),
                end: matched.end(),
                kind: ProtectedKind::Literal,
            });
        }
    }
    for (index, byte) in line.bytes().enumerate() {
        if byte == b'|' {
            ranges.push(LocalProtectedRange {
                start: index,
                end: index + 1,
                kind: ProtectedKind::TableDelimiter,
            });
        }
    }
    if line.ends_with("\r\n") {
        ranges.push(LocalProtectedRange {
            start: line.len() - 2,
            end: line.len(),
            kind: ProtectedKind::MarkdownMarker,
        });
    } else if line.ends_with('\n') {
        ranges.push(LocalProtectedRange {
            start: line.len() - 1,
            end: line.len(),
            kind: ProtectedKind::MarkdownMarker,
        });
    }
    ranges
}

fn protect_entire_line(line: &str, kind: ProtectedKind) -> Vec<LocalProtectedRange> {
    vec![LocalProtectedRange {
        start: 0,
        end: line.len(),
        kind,
    }]
}

fn merge_local_ranges(
    mut ranges: Vec<LocalProtectedRange>,
    line_len: usize,
) -> Vec<LocalProtectedRange> {
    ranges.retain(|range| range.start < range.end && range.end <= line_len);
    ranges.sort_by_key(|range| (range.start, std::cmp::Reverse(range.end)));
    let mut merged: Vec<LocalProtectedRange> = Vec::new();
    for range in ranges {
        if let Some(last) = merged.last_mut()
            && range.start < last.end
        {
            last.end = last.end.max(range.end);
            continue;
        }
        merged.push(range);
    }
    merged
}

fn is_indented_code(line: &str) -> bool {
    line.starts_with("    ") || line.starts_with('\t')
}

fn is_table_delimiter(line: &str) -> bool {
    potential_table_delimiter(blockquote_container(line).content)
}

fn is_thematic_or_setext_marker(line: &str) -> bool {
    let content = authored_line_content(line).trim();
    if !content.is_empty()
        && (content.bytes().all(|byte| byte == b'=') || content.bytes().all(|byte| byte == b'-'))
    {
        return true;
    }
    for &marker in b"-*_" {
        let marker_count = content.bytes().filter(|byte| *byte == marker).count();
        if marker_count >= 3
            && content
                .bytes()
                .all(|byte| byte == marker || matches!(byte, b' ' | b'\t'))
        {
            return true;
        }
    }
    false
}

fn markdown_prefix_end(line: &str) -> Option<usize> {
    markdown_prefix_regex()
        .find(line)
        .map(|matched| matched.end())
}

fn markdown_prefix_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"^(?: {0,3}(?:#{1,6}[ \t]+|>[ \t]?|[-+*][ \t]+|\d+[.)][ \t]+))")
            .expect("valid markdown prefix regex")
    })
}

fn task_marker_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"^\[(?: |x|X)\][ \t]+").expect("valid task marker regex"))
}

fn inline_code_ranges(line: &str) -> Vec<(usize, usize)> {
    let bytes = line.as_bytes();
    let mut runs = Vec::new();
    let mut cursor = 0;
    while cursor < bytes.len() {
        let Some(relative_start) = bytes[cursor..].iter().position(|byte| *byte == b'`') else {
            break;
        };
        let start = cursor + relative_start;
        let mut end = start;
        while end < bytes.len() && bytes[end] == b'`' {
            end += 1;
        }
        runs.push((start, end));
        cursor = end;
    }

    let mut next_same = vec![None; runs.len()];
    let mut nearest_by_length = HashMap::new();
    for (index, (start, end)) in runs.iter().copied().enumerate().rev() {
        let length = end - start;
        next_same[index] = nearest_by_length.insert(length, index);
    }

    let mut ranges = Vec::new();
    let mut run_index = 0;
    while run_index < runs.len() {
        if is_ascii_marker_escaped(bytes, runs[run_index].0) {
            run_index += 1;
            continue;
        }
        if let Some(close_index) = next_same[run_index] {
            ranges.push((runs[run_index].0, runs[close_index].1));
            run_index = close_index + 1;
        } else {
            run_index += 1;
        }
    }
    ranges
}

fn block_aware_inline_code_ranges(source: &str) -> Vec<(usize, usize)> {
    markdown_block_ranges(source)
        .into_iter()
        .filter(|block| {
            matches!(
                block.kind,
                MarkdownBlockKind::Heading
                    | MarkdownBlockKind::Table
                    | MarkdownBlockKind::List
                    | MarkdownBlockKind::Paragraph
            )
        })
        .flat_map(|block| {
            inline_code_ranges(&source[block.range.start..block.range.end])
                .into_iter()
                .map(move |(start, end)| (block.range.start + start, block.range.start + end))
        })
        .collect()
}

#[derive(Debug, Clone, Copy)]
struct InlineLinkRanges {
    prefix: ByteRange,
    middle: ByteRange,
    destination: ByteRange,
    title_open: Option<ByteRange>,
    title_close: Option<ByteRange>,
    close: ByteRange,
}

fn inline_link_ranges(source: &str) -> Vec<InlineLinkRanges> {
    let bytes = source.as_bytes();
    let mut links = Vec::new();
    let mut label_stack = Vec::new();
    let mut cursor = 0;
    let mut line_start = 0;
    let mut speculative_scan = 0_usize;
    let scan_budget = source.len().saturating_mul(2).max(1);

    while cursor < bytes.len() {
        if bytes[cursor] == b'\n' {
            if bytes.get(cursor + 1) == Some(&b'\n')
                || (bytes.get(cursor + 1) == Some(&b'\r') && bytes.get(cursor + 2) == Some(&b'\n'))
            {
                label_stack.clear();
            }
            cursor += 1;
            line_start = cursor;
            continue;
        }
        if is_ascii_marker_escaped(bytes, cursor) {
            cursor += 1;
            continue;
        }
        if bytes[cursor] == b'[' {
            label_stack.push(cursor);
            cursor += 1;
            continue;
        }
        if bytes[cursor] != b']' {
            cursor += 1;
            continue;
        }
        let Some(label_open) = label_stack.pop() else {
            cursor += 1;
            continue;
        };
        if bytes.get(cursor + 1) != Some(&b'(') {
            cursor += 1;
            continue;
        }

        let prefix_start = if label_open > 0
            && bytes[label_open - 1] == b'!'
            && !is_ascii_marker_escaped(bytes, label_open - 1)
        {
            label_open - 1
        } else {
            label_open
        };
        let middle = ByteRange {
            start: cursor,
            end: cursor + 2,
        };
        let line_end = source[middle.end..]
            .find('\n')
            .map(|relative| middle.end + relative)
            .unwrap_or(bytes.len());
        let Some(link) = parse_inline_link_candidate(source, prefix_start, label_open, middle)
        else {
            speculative_scan = speculative_scan.saturating_add(line_end - middle.end);
            if speculative_scan > scan_budget {
                links.push(InlineLinkRanges {
                    prefix: ByteRange {
                        start: line_start,
                        end: line_start,
                    },
                    middle: ByteRange {
                        start: line_start,
                        end: line_start,
                    },
                    destination: ByteRange {
                        start: line_start,
                        end: line_end,
                    },
                    title_open: None,
                    title_close: None,
                    close: ByteRange {
                        start: line_end,
                        end: line_end,
                    },
                });
                cursor = line_end;
                label_stack.clear();
            } else {
                cursor = middle.end;
            }
            continue;
        };
        speculative_scan = speculative_scan.saturating_add(link.close.end - middle.end);
        cursor = link.close.end;
        links.push(link);
        label_stack.clear();
    }

    links
}

fn parse_inline_link_candidate(
    source: &str,
    prefix_start: usize,
    label_open: usize,
    middle: ByteRange,
) -> Option<InlineLinkRanges> {
    let bytes = source.as_bytes();
    let destination_start = middle.end;
    let destination_end = if bytes.get(destination_start) == Some(&b'<') {
        let mut cursor = destination_start + 1;
        loop {
            let byte = *bytes.get(cursor)?;
            if matches!(byte, b'\n' | b'\r') {
                return None;
            }
            if !is_ascii_marker_escaped(bytes, cursor) {
                if byte == b'<' {
                    return None;
                }
                if byte == b'>' {
                    break cursor + 1;
                }
            }
            cursor += 1;
        }
    } else {
        let mut cursor = destination_start;
        let mut nested_parentheses = 0_usize;
        loop {
            let byte = *bytes.get(cursor)?;
            match byte {
                b'\n' | b'\r' if nested_parentheses == 0 => break cursor,
                b'\n' | b'\r' => return None,
                b'\\' => cursor = cursor.checked_add(2)?,
                b'(' => {
                    nested_parentheses += 1;
                    cursor += 1;
                }
                b')' if nested_parentheses == 0 => break cursor,
                b')' => {
                    nested_parentheses -= 1;
                    cursor += 1;
                }
                b' ' | b'\t' if nested_parentheses == 0 => break cursor,
                _ => cursor += 1,
            }
        }
    };
    let (title_open, title_close, close) = parse_inline_link_tail(source, destination_end)?;
    Some(InlineLinkRanges {
        prefix: ByteRange {
            start: prefix_start,
            end: label_open + 1,
        },
        middle,
        destination: ByteRange {
            start: destination_start,
            end: destination_end,
        },
        title_open,
        title_close,
        close,
    })
}

fn parse_inline_link_tail(
    source: &str,
    destination_end: usize,
) -> Option<(Option<ByteRange>, Option<ByteRange>, ByteRange)> {
    let bytes = source.as_bytes();
    if bytes.get(destination_end) == Some(&b')') {
        return Some((
            None,
            None,
            ByteRange {
                start: destination_end,
                end: destination_end + 1,
            },
        ));
    }

    let whitespace_start = destination_end;
    let mut cursor = destination_end;
    while matches!(bytes.get(cursor), Some(b' ' | b'\t')) {
        cursor += 1;
    }
    if bytes.get(cursor) == Some(&b'\r') && bytes.get(cursor + 1) == Some(&b'\n') {
        cursor += 2;
        while matches!(bytes.get(cursor), Some(b' ' | b'\t')) {
            cursor += 1;
        }
    } else if bytes.get(cursor) == Some(&b'\n') {
        cursor += 1;
        while matches!(bytes.get(cursor), Some(b' ' | b'\t')) {
            cursor += 1;
        }
    }
    if cursor == whitespace_start {
        return None;
    }
    if bytes.get(cursor) == Some(&b')') {
        return Some((
            Some(ByteRange {
                start: whitespace_start,
                end: cursor,
            }),
            None,
            ByteRange {
                start: cursor,
                end: cursor + 1,
            },
        ));
    }

    let opener = *bytes.get(cursor)?;
    let title_closer = match opener {
        b'\'' | b'"' => opener,
        b'(' => b')',
        _ => return None,
    };
    let title_open = ByteRange {
        start: whitespace_start,
        end: cursor + 1,
    };
    cursor += 1;
    let mut saw_line_ending = false;
    let mut only_whitespace_since_line_ending = false;
    let title_close_start = loop {
        let byte = *bytes.get(cursor)?;
        if byte == b'\r' && bytes.get(cursor + 1) == Some(&b'\n') {
            if saw_line_ending && only_whitespace_since_line_ending {
                return None;
            }
            saw_line_ending = true;
            only_whitespace_since_line_ending = true;
            cursor += 2;
            continue;
        }
        if byte == b'\n' {
            if saw_line_ending && only_whitespace_since_line_ending {
                return None;
            }
            saw_line_ending = true;
            only_whitespace_since_line_ending = true;
            cursor += 1;
            continue;
        }
        if byte == b'\r' {
            return None;
        }
        if byte == b'\\' {
            only_whitespace_since_line_ending = false;
            cursor = cursor.checked_add(2)?;
            continue;
        }
        if byte == title_closer {
            break cursor;
        }
        if !matches!(byte, b' ' | b'\t') {
            only_whitespace_since_line_ending = false;
        }
        cursor += 1;
    };
    cursor += 1;
    while matches!(bytes.get(cursor), Some(b' ' | b'\t')) {
        cursor += 1;
    }
    if bytes.get(cursor) != Some(&b')') {
        return None;
    }
    Some((
        Some(title_open),
        Some(ByteRange {
            start: title_close_start,
            end: cursor,
        }),
        ByteRange {
            start: cursor,
            end: cursor + 1,
        },
    ))
}

fn is_ascii_marker_escaped(bytes: &[u8], index: usize) -> bool {
    let preceding_backslashes = bytes[..index]
        .iter()
        .rev()
        .take_while(|byte| **byte == b'\\')
        .count();
    preceding_backslashes % 2 == 1
}

fn inline_delimiter_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"[*_~]+").expect("valid inline delimiter regex"))
}

fn markdown_escape_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"\\[\\`*{}\[\]()#+\-.!_>]").expect("valid escape regex"))
}

#[derive(Debug, Clone)]
struct ReferenceLinkRanges {
    definition: ByteRange,
    destination: ByteRange,
    title_open: Option<ByteRange>,
    title_close: Option<ByteRange>,
    normalized_label: String,
}

#[derive(Debug, Clone, Copy)]
struct ReferenceLineView<'a> {
    content: &'a str,
    base: usize,
    quote_depth: usize,
    list_indent: usize,
}

fn reference_link_ranges(source: &str) -> Vec<ReferenceLinkRanges> {
    let line_ranges = line_ranges(source, 0);
    let normalized = normalized_line_views(source);
    let lines = line_ranges
        .iter()
        .zip(normalized)
        .map(|(range, normalized)| {
            let raw_line = &source[range.start..range.end];
            let quote_prefix = raw_line.len() - blockquote_container(raw_line).content.len();
            ReferenceLineView {
                content: authored_line_content(normalized.content),
                base: range.start + normalized.prefix_len,
                quote_depth: normalized.quote_depth,
                list_indent: normalized.prefix_len.saturating_sub(quote_prefix),
            }
        })
        .collect::<Vec<_>>();
    let mut ranges = Vec::new();
    for (index, line) in lines.iter().copied().enumerate() {
        let list_prefix = list_item_content_indent(line.content).unwrap_or(0);
        let candidate = &line.content[list_prefix..];
        let candidate_base = line.base + list_prefix;
        if let Some(parsed) = reference_link_ranges_for_line(candidate, candidate_base) {
            ranges.push(parsed);
            continue;
        }
        if let Some(parsed) = reference_link_ranges_across_lines(&lines, index, list_prefix) {
            ranges.push(parsed);
        }
    }
    ranges
}

fn reference_link_ranges_across_lines(
    lines: &[ReferenceLineView<'_>],
    start_index: usize,
    list_prefix: usize,
) -> Option<ReferenceLinkRanges> {
    const MAX_REFERENCE_LABEL_BYTES: usize = 999;

    let first = *lines.get(start_index)?;
    let expected_quote_depth = first.quote_depth;
    let expected_list_indent = first.list_indent + list_prefix;
    let first_content = &first.content[list_prefix..];
    let indent = first_content
        .as_bytes()
        .iter()
        .take(4)
        .take_while(|byte| **byte == b' ')
        .count();
    if indent > 3 || first_content.as_bytes().get(indent) != Some(&b'[') {
        return None;
    }

    let definition_start = first.base + list_prefix + indent;
    let mut label = String::new();
    let mut line_index = start_index;
    let mut content = first_content;
    let mut content_base = first.base + list_prefix;
    let mut cursor = indent + 1;
    let (label_close, colon_line_index) = loop {
        let bytes = content.as_bytes();
        let scan_start = cursor;
        while cursor < bytes.len() {
            if bytes[cursor] == b']' && !is_ascii_marker_escaped(bytes, cursor) {
                label.push_str(&content[scan_start..cursor]);
                if label.len() > MAX_REFERENCE_LABEL_BYTES || bytes.get(cursor + 1) != Some(&b':') {
                    return None;
                }
                break;
            }
            cursor += 1;
        }
        if cursor < bytes.len() {
            break (cursor, line_index);
        }
        label.push_str(&content[scan_start..]);
        if label.len() >= MAX_REFERENCE_LABEL_BYTES {
            return None;
        }
        label.push('\n');
        line_index += 1;
        let next = *lines.get(line_index)?;
        if next.quote_depth != expected_quote_depth
            || next.list_indent != expected_list_indent
            || next.content.trim().is_empty()
        {
            return None;
        }
        content = next.content;
        content_base = next.base;
        cursor = 0;
    };
    if colon_line_index != line_index || label.starts_with('^') {
        return None;
    }
    let normalized_label = normalize_reference_label(&label);
    if normalized_label.is_empty() {
        return None;
    }

    let mut destination_line_index = line_index;
    let mut destination_content = content;
    let mut destination_base = content_base;
    let mut destination_start = label_close + 2;
    while matches!(
        destination_content.as_bytes().get(destination_start),
        Some(b' ' | b'\t')
    ) {
        destination_start += 1;
    }
    if destination_start == destination_content.len() {
        destination_line_index += 1;
        let next = *lines.get(destination_line_index)?;
        if next.quote_depth != expected_quote_depth
            || next.list_indent != expected_list_indent
            || next.content.trim().is_empty()
        {
            return None;
        }
        destination_content = next.content;
        destination_base = next.base;
        destination_start = 0;
        while matches!(
            destination_content.as_bytes().get(destination_start),
            Some(b' ' | b'\t')
        ) {
            destination_start += 1;
        }
    }
    let destination_end = reference_destination_end(destination_content, destination_start)?;
    let mut trailing = destination_end;
    while matches!(
        destination_content.as_bytes().get(trailing),
        Some(b' ' | b'\t')
    ) {
        trailing += 1;
    }
    if trailing < destination_content.len()
        && !matches!(
            destination_content.as_bytes().get(trailing),
            Some(b'\'' | b'"' | b'(')
        )
    {
        return None;
    }

    let destination = ByteRange {
        start: destination_base + destination_start,
        end: destination_base + destination_end,
    };
    let (title_open, title_close, title_crosses_lines) = if trailing == destination_content.len() {
        (None, None, false)
    } else {
        let opener = destination_content.as_bytes()[trailing];
        let closer = match opener {
            b'\'' | b'"' => opener,
            b'(' => b')',
            _ => return None,
        };
        let title_open = ByteRange {
            start: destination.end,
            end: destination_base + trailing + 1,
        };
        let mut title_line_index = destination_line_index;
        let mut title_content = destination_content;
        let mut title_base = destination_base;
        let mut title_cursor = trailing + 1;
        let (title_close, title_crosses_lines) = 'title: loop {
            let title_bytes = title_content.as_bytes();
            while title_cursor < title_bytes.len() {
                if title_bytes[title_cursor] == b'\\' {
                    title_cursor = title_cursor.checked_add(2)?;
                    continue;
                }
                if title_bytes[title_cursor] == closer {
                    let close_start = title_cursor;
                    title_cursor += 1;
                    while matches!(title_bytes.get(title_cursor), Some(b' ' | b'\t')) {
                        title_cursor += 1;
                    }
                    if title_cursor != title_bytes.len() {
                        return None;
                    }
                    break 'title (
                        ByteRange {
                            start: title_base + close_start,
                            end: title_base + title_cursor,
                        },
                        title_line_index != destination_line_index,
                    );
                }
                title_cursor += 1;
            }
            title_line_index += 1;
            let next = *lines.get(title_line_index)?;
            if next.quote_depth != expected_quote_depth
                || next.list_indent != expected_list_indent
                || next.content.trim().is_empty()
            {
                return None;
            }
            title_content = next.content;
            title_base = next.base;
            title_cursor = 0;
        };
        (Some(title_open), Some(title_close), title_crosses_lines)
    };
    let definition_end = if title_crosses_lines && destination_line_index == start_index {
        title_close.map_or(destination.end, |range| range.end)
    } else {
        destination.end
    };
    Some(ReferenceLinkRanges {
        definition: ByteRange {
            start: definition_start,
            end: definition_end,
        },
        destination,
        title_open,
        title_close,
        normalized_label,
    })
}

fn normalize_reference_label(label: &str) -> String {
    label
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .flat_map(char::to_lowercase)
        .collect()
}

fn reference_destination_end(line: &str, start: usize) -> Option<usize> {
    let bytes = line.as_bytes();
    let mut cursor = start;
    if bytes.get(cursor) == Some(&b'<') {
        cursor += 1;
        loop {
            let byte = *bytes.get(cursor)?;
            if byte == b'<' && !is_ascii_marker_escaped(bytes, cursor) {
                return None;
            }
            if byte == b'>' && !is_ascii_marker_escaped(bytes, cursor) {
                return Some(cursor + 1);
            }
            cursor += 1;
        }
    }

    let mut depth = 0_usize;
    while let Some(byte) = bytes.get(cursor).copied() {
        match byte {
            b'\\' => cursor = cursor.checked_add(2)?,
            b'(' => {
                depth += 1;
                cursor += 1;
            }
            b')' if depth > 0 => {
                depth -= 1;
                cursor += 1;
            }
            b' ' | b'\t' => break,
            _ => cursor += 1,
        }
    }
    (cursor > start && depth == 0).then_some(cursor)
}

fn reference_link_ranges_for_line(line: &str, base: usize) -> Option<ReferenceLinkRanges> {
    let bytes = line.as_bytes();
    let indent = bytes
        .iter()
        .take(4)
        .take_while(|byte| **byte == b' ')
        .count();
    if indent > 3 || bytes.get(indent) != Some(&b'[') {
        return None;
    }
    let mut cursor = indent + 1;
    let label_close = loop {
        let byte = *bytes.get(cursor)?;
        if byte == b']' && !is_ascii_marker_escaped(bytes, cursor) {
            break cursor;
        }
        cursor += 1;
    };
    if label_close == indent + 1 || bytes.get(label_close + 1) != Some(&b':') {
        return None;
    }
    if bytes.get(indent + 1) == Some(&b'^') {
        return None;
    }
    cursor = label_close + 2;
    while matches!(bytes.get(cursor), Some(b' ' | b'\t')) {
        cursor += 1;
    }
    let destination_start = cursor;
    let destination_end = reference_destination_end(line, cursor)?;
    if destination_start == destination_end {
        return None;
    }

    let whitespace_start = destination_end;
    cursor = destination_end;
    while matches!(bytes.get(cursor), Some(b' ' | b'\t')) {
        cursor += 1;
    }
    let (title_open, title_close) = if cursor == bytes.len() {
        let trailing = (whitespace_start < cursor).then_some(ByteRange {
            start: base + whitespace_start,
            end: base + cursor,
        });
        (trailing, None)
    } else {
        if cursor == whitespace_start {
            return None;
        }
        let opener = bytes[cursor];
        let closer = match opener {
            b'\'' | b'"' => opener,
            b'(' => b')',
            _ => return None,
        };
        let open = ByteRange {
            start: base + whitespace_start,
            end: base + cursor + 1,
        };
        cursor += 1;
        let close_start = loop {
            let byte = *bytes.get(cursor)?;
            if byte == b'\\' {
                cursor = cursor.checked_add(2)?;
                continue;
            }
            if byte == closer {
                break cursor;
            }
            cursor += 1;
        };
        cursor += 1;
        while matches!(bytes.get(cursor), Some(b' ' | b'\t')) {
            cursor += 1;
        }
        if cursor != bytes.len() {
            return None;
        }
        (
            Some(open),
            Some(ByteRange {
                start: base + close_start,
                end: base + cursor,
            }),
        )
    };

    Some(ReferenceLinkRanges {
        definition: ByteRange {
            start: base,
            end: base + destination_end,
        },
        destination: ByteRange {
            start: base + destination_start,
            end: base + destination_end,
        },
        title_open,
        title_close,
        normalized_label: normalize_reference_label(&line[indent + 1..label_close]),
    })
}

fn reference_label_close(bytes: &[u8], open: usize) -> Option<usize> {
    let mut cursor = open + 1;
    while cursor < bytes.len() {
        if bytes[cursor] == b'\n'
            && (bytes.get(cursor + 1) == Some(&b'\n')
                || (bytes.get(cursor + 1) == Some(&b'\r') && bytes.get(cursor + 2) == Some(&b'\n')))
        {
            return None;
        }
        if bytes[cursor] == b']' && !is_ascii_marker_escaped(bytes, cursor) {
            return Some(cursor);
        }
        cursor += 1;
    }
    None
}

fn reference_usage_identifier_ranges(
    source: &str,
    reference_definitions: &HashSet<String>,
) -> Vec<ByteRange> {
    let bytes = source.as_bytes();
    let mut ranges = Vec::new();
    let mut cursor = 0;
    while cursor < bytes.len() {
        let Some(relative_open) = bytes[cursor..].iter().position(|byte| *byte == b'[') else {
            break;
        };
        let open = cursor + relative_open;
        if is_ascii_marker_escaped(bytes, open) {
            cursor = open + 1;
            continue;
        }
        let Some(close) = reference_label_close(bytes, open) else {
            break;
        };
        let content = &source[open + 1..close];
        if matches!(content, " " | "x" | "X")
            && bytes.get(close + 1).is_some_and(u8::is_ascii_whitespace)
        {
            cursor = close + 1;
            continue;
        }
        if content.starts_with('^') {
            let end = close + 1 + usize::from(bytes.get(close + 1) == Some(&b':'));
            ranges.push(ByteRange { start: open, end });
            cursor = end;
            continue;
        }
        if content.starts_with(['$', '/']) {
            cursor = close + 1;
            continue;
        }
        match bytes.get(close + 1) {
            Some(b'(') => {
                cursor = close + 1;
            }
            Some(b'[') => {
                let second_open = close + 1;
                if let Some(second_close) = reference_label_close(bytes, second_open) {
                    if second_close == second_open + 1 {
                        if reference_definitions.contains(&normalize_reference_label(content)) {
                            ranges.push(ByteRange {
                                start: open,
                                end: close + 1,
                            });
                            ranges.push(ByteRange {
                                start: second_open,
                                end: second_close + 1,
                            });
                        }
                    } else {
                        let identifier = &source[second_open + 1..second_close];
                        if reference_definitions.contains(&normalize_reference_label(identifier)) {
                            ranges.push(ByteRange {
                                start: second_open,
                                end: second_close + 1,
                            });
                        }
                    }
                    cursor = second_close + 1;
                } else {
                    cursor = close + 1;
                }
            }
            Some(b':') => {
                cursor = close + 2;
            }
            _ => {
                if reference_definitions.contains(&normalize_reference_label(content)) {
                    ranges.push(ByteRange {
                        start: open,
                        end: close + 1,
                    });
                }
                cursor = close + 1;
            }
        }
    }
    ranges
}

fn raw_html_ranges(source: &str) -> Vec<ByteRange> {
    let bytes = source.as_bytes();
    let mut ranges = Vec::new();
    let mut cursor = 0;
    while cursor < bytes.len() {
        let Some(relative_start) = bytes[cursor..].iter().position(|byte| *byte == b'<') else {
            break;
        };
        let start = cursor + relative_start;
        if is_ascii_marker_escaped(bytes, start) {
            cursor = start + 1;
            continue;
        }
        if source[start..].starts_with("<!--") {
            if let Some(relative_end) = source[start + 4..].find("-->") {
                let end = start + 4 + relative_end + 3;
                ranges.push(ByteRange { start, end });
                cursor = end;
            } else {
                ranges.push(ByteRange {
                    start,
                    end: source.len(),
                });
                break;
            }
            continue;
        }
        if source[start..].starts_with("<?") {
            if let Some(relative_end) = source[start + 2..].find("?>") {
                let end = start + 2 + relative_end + 2;
                ranges.push(ByteRange { start, end });
                cursor = end;
            } else {
                ranges.push(ByteRange {
                    start,
                    end: source.len(),
                });
                break;
            }
            continue;
        }
        if source[start..].starts_with("<![CDATA[") {
            if let Some(relative_end) = source[start + 9..].find("]]>") {
                let end = start + 9 + relative_end + 3;
                ranges.push(ByteRange { start, end });
                cursor = end;
            } else {
                ranges.push(ByteRange {
                    start,
                    end: source.len(),
                });
                break;
            }
            continue;
        }
        if source[start..].starts_with("<!")
            && bytes.get(start + 2).is_some_and(u8::is_ascii_alphabetic)
        {
            if let Some(relative_end) = source[start + 3..].find('>') {
                let end = start + 3 + relative_end + 1;
                ranges.push(ByteRange { start, end });
                cursor = end;
            } else {
                ranges.push(ByteRange {
                    start,
                    end: source.len(),
                });
                break;
            }
            continue;
        }

        let mut name_start = start + 1;
        if bytes.get(name_start) == Some(&b'/') {
            name_start += 1;
        }
        if !bytes.get(name_start).is_some_and(u8::is_ascii_alphabetic) {
            cursor = start + 1;
            continue;
        }

        let mut quote = None;
        let mut tag_cursor = name_start + 1;
        let mut end = None;
        while tag_cursor < bytes.len() {
            let byte = bytes[tag_cursor];
            match quote {
                Some(delimiter) if byte == delimiter => quote = None,
                Some(_) => {}
                None if matches!(byte, b'\'' | b'"') => quote = Some(byte),
                None if byte == b'>' => {
                    end = Some(tag_cursor + 1);
                    break;
                }
                _ => {}
            }
            tag_cursor += 1;
        }
        if let Some(end) = end {
            ranges.push(ByteRange { start, end });
            cursor = end;
        } else {
            ranges.push(ByteRange {
                start,
                end: source.len(),
            });
            break;
        }
    }
    ranges
}

fn skill_token_ranges(source: &str) -> Vec<ByteRange> {
    let bytes = source.as_bytes();
    let mut ranges = Vec::new();
    let mut cursor = 0;

    while cursor < source.len() {
        let Some((relative_start, _)) = source[cursor..]
            .char_indices()
            .find(|(_, ch)| matches!(ch, '/' | '$'))
        else {
            break;
        };
        let start = cursor + relative_start;
        if source[..start]
            .chars()
            .next_back()
            .is_some_and(|ch| !is_skill_before_boundary(ch))
        {
            cursor = start + 1;
            continue;
        }

        let mut end = start + 1;
        if !bytes.get(end).is_some_and(u8::is_ascii_alphanumeric) {
            cursor = start + 1;
            continue;
        }
        end += 1;
        while bytes
            .get(end)
            .is_some_and(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        {
            end += 1;
        }
        if bytes.get(end) == Some(&b':')
            && bytes.get(end + 1).is_some_and(u8::is_ascii_alphanumeric)
        {
            end += 2;
            while bytes
                .get(end)
                .is_some_and(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
            {
                end += 1;
            }
        }

        if source[end..]
            .chars()
            .next()
            .is_none_or(is_skill_after_boundary)
        {
            ranges.push(ByteRange { start, end });
            cursor = end;
        } else {
            cursor = start + 1;
        }
    }
    ranges
}

fn is_skill_before_boundary(ch: char) -> bool {
    ch.is_whitespace() || matches!(ch, '(' | '[' | '{' | '\'' | '"' | '«' | '‘' | '“')
}

fn is_skill_after_boundary(ch: char) -> bool {
    ch.is_whitespace()
        || matches!(
            ch,
            '.' | ',' | ';' | ':' | '!' | '?' | ')' | ']' | '}' | '\'' | '"' | '»' | '’' | '”'
        )
}

fn model_identifier_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"\b[A-Za-z0-9][A-Za-z0-9._-]+/[A-Za-z0-9][A-Za-z0-9._-]+\b")
            .expect("valid model identifier regex")
    })
}

fn literal_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"\b\d+(?:[.,]\d+)*(?:[ \t]?(?:%|ms|s|kg|KB|MB|GB|TB|USD|KRW|원|명|건))?\b")
            .expect("valid literal regex")
    })
}
