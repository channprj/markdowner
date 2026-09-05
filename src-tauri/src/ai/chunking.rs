use std::{
    collections::{HashMap, HashSet},
    ops::Range,
};

use markdowner_core::ai_document::{
    AiDocumentEnvelope, ByteRange, EditableSegment, MarkdownBlockKind, MarkdownBlockRange,
    ProtectedToken, markdown_block_ranges,
};
use serde::{Deserialize, Serialize};

use super::AiError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationChunk {
    pub index: u32,
    pub source_range: Range<usize>,
    pub source: String,
    pub heading: Option<String>,
    pub estimated_input_tokens: u32,
    pub subdivision_depth: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StructuredDocumentChunk {
    pub envelope: AiDocumentEnvelope,
}

/// Refine local validation targets before any provider requests. Both the final
/// validator and every chunk use these same IDs; protected tokens stay atomic.
pub fn split_oversized_segments(envelope: &mut AiDocumentEnvelope, max_bytes: usize) {
    let max_bytes = max_bytes.max(128);
    let mut tokens_by_segment: HashMap<&str, Vec<&ProtectedToken>> = HashMap::new();
    for token in &envelope.protected {
        tokens_by_segment
            .entry(&token.segment_id)
            .or_default()
            .push(token);
    }
    let mut refined = Vec::new();
    for segment in &envelope.segments {
        if segment.text.len() <= max_bytes {
            refined.push(segment.clone());
            continue;
        }
        let mut tokens = tokens_by_segment
            .remove(segment.id.as_str())
            .unwrap_or_default();
        tokens.sort_by_key(|token| token.range.start);
        let mut tokens = tokens.into_iter().peekable();
        let mut masked_offset = 0;
        let mut source_offset = segment.range.start;
        let mut part_start = source_offset;
        let mut text = String::new();
        let mut part = 0;
        while masked_offset < segment.text.len() {
            let remaining = &segment.text[masked_offset..];
            let (masked_len, source_len) = if let Some(token) = tokens.peek()
                && remaining.starts_with(&token.placeholder)
            {
                let lengths = (token.placeholder.len(), token.range.end - token.range.start);
                tokens.next();
                lengths
            } else {
                let length = remaining
                    .chars()
                    .next()
                    .expect("nonempty segment remainder")
                    .len_utf8();
                (length, length)
            };
            let preceding = source_offset
                .checked_sub(1)
                .and_then(|index| envelope.source.as_bytes().get(index))
                .copied();
            let preferred_boundary = (text.len() >= max_bytes / 2 && preceding == Some(b'\n'))
                || (text.len() >= max_bytes * 4 / 5
                    && matches!(preceding, Some(b' ' | b'\t' | b'.' | b'!' | b'?')));
            if !text.is_empty() && (text.len() + masked_len > max_bytes || preferred_boundary) {
                refined.push(EditableSegment {
                    id: format!("{}-part-{part}", segment.id),
                    range: ByteRange {
                        start: part_start,
                        end: source_offset,
                    },
                    text: std::mem::take(&mut text),
                });
                part += 1;
                part_start = source_offset;
            }
            text.push_str(&remaining[..masked_len]);
            masked_offset += masked_len;
            source_offset += source_len;
        }
        if !text.is_empty() {
            refined.push(EditableSegment {
                id: format!("{}-part-{part}", segment.id),
                range: ByteRange {
                    start: part_start,
                    end: source_offset,
                },
                text,
            });
        }
    }
    for token in &mut envelope.protected {
        let index = refined.partition_point(|segment| segment.range.end <= token.range.start);
        if let Some(segment) = refined.get(index) {
            token.segment_id = segment.id.clone();
        }
    }
    envelope.segments = refined;
}

pub fn plan_structured_document_chunks(
    envelope: &AiDocumentEnvelope,
    max_estimated_tokens: u32,
) -> Result<Vec<StructuredDocumentChunk>, AiError> {
    if max_estimated_tokens == 0 {
        return Err(AiError::new(
            "invalid_chunk_limit",
            "Structured document chunk size must be greater than zero.",
        ));
    }
    if envelope.segments.is_empty() {
        return Ok(Vec::new());
    }

    let mut chunks = Vec::new();
    let mut start = 0;
    while start < envelope.segments.len() {
        let mut end = start + 1;
        let mut estimated = estimated_segment_tokens(&envelope.segments[start..end]);
        while end < envelope.segments.len() {
            let next = estimated_segment_tokens(&envelope.segments[end..end + 1]);
            if estimated.saturating_add(next) > max_estimated_tokens {
                break;
            }
            estimated = estimated.saturating_add(next);
            end += 1;
        }
        chunks.push(build_structured_chunk(
            envelope,
            &envelope.segments[start..end],
        )?);
        start = end;
    }
    Ok(chunks)
}

fn build_structured_chunk(
    envelope: &AiDocumentEnvelope,
    segments: &[EditableSegment],
) -> Result<StructuredDocumentChunk, AiError> {
    let source_start = segments
        .first()
        .map(|segment| segment.range.start)
        .ok_or_else(|| {
            AiError::new("invalid_document", "A structured document chunk was empty.")
        })?;
    let source_end = segments
        .last()
        .map(|segment| segment.range.end)
        .ok_or_else(|| {
            AiError::new("invalid_document", "A structured document chunk was empty.")
        })?;
    let source = envelope
        .source
        .get(source_start..source_end)
        .ok_or_else(|| {
            AiError::new(
                "invalid_document",
                "A structured document chunk had invalid source boundaries.",
            )
        })?
        .to_string();
    let segment_ids = segments
        .iter()
        .map(|segment| segment.id.as_str())
        .collect::<HashSet<_>>();
    let segments = segments
        .iter()
        .cloned()
        .map(|mut segment| {
            segment.range = rebase_range(segment.range, source_start);
            segment
        })
        .collect::<Vec<_>>();
    let protected = envelope
        .protected
        .iter()
        .filter(|token| segment_ids.contains(token.segment_id.as_str()))
        .cloned()
        .map(|mut token| {
            token.range = rebase_range(token.range, source_start);
            token
        })
        .collect::<Vec<ProtectedToken>>();
    Ok(StructuredDocumentChunk {
        envelope: AiDocumentEnvelope {
            document_id: envelope.document_id.clone(),
            source,
            selection: envelope.selection.map(|_| ByteRange {
                start: 0,
                end: source_end - source_start,
            }),
            revision_hash: envelope.revision_hash.clone(),
            segments,
            protected,
            policy: envelope.policy,
        },
    })
}

fn rebase_range(range: ByteRange, source_start: usize) -> ByteRange {
    ByteRange {
        start: range.start.saturating_sub(source_start),
        end: range.end.saturating_sub(source_start),
    }
}

fn estimated_segment_tokens(segments: &[EditableSegment]) -> u32 {
    let bytes = segments
        .iter()
        .map(|segment| {
            serde_json::to_string(&serde_json::json!({"id": segment.id, "text": segment.text}))
                .map_or(usize::MAX, |json| json.len())
        })
        .sum::<usize>();
    estimated_tokens(bytes)
}

// Summaries do not edit Markdown, so giant tables and fenced blocks can also
// be read in bounded pieces. Every source byte, including delimiters, is kept.
pub fn plan_summary_sources(source: &str, max_bytes: usize) -> Vec<String> {
    let mut pieces = Vec::new();
    let mut start = 0;
    let max_bytes = max_bytes.max(4);
    while start < source.len() {
        let desired = start.saturating_add(max_bytes).min(source.len());
        let end = if desired == source.len() {
            desired
        } else {
            safe_text_boundary(source, start, desired, source.len())
        };
        pieces.push(source[start..end].to_string());
        start = end;
    }
    pieces
}

pub fn plan_translation_chunks(
    source: &str,
    max_estimated_tokens: u32,
) -> Result<Vec<TranslationChunk>, AiError> {
    if max_estimated_tokens == 0 {
        return Err(AiError::new(
            "invalid_chunk_limit",
            "Translation chunk size must be greater than zero.",
        ));
    }
    if source.is_empty() {
        return Ok(Vec::new());
    }
    let max_bytes = usize::try_from(max_estimated_tokens)
        .unwrap_or(usize::MAX)
        .saturating_mul(4);
    let mut atomic = Vec::new();
    for block in markdown_block_ranges(source) {
        if estimated_tokens(block.range.end - block.range.start) <= max_estimated_tokens
            || !can_split(block.kind)
        {
            atomic.push(block);
        } else {
            atomic.extend(split_text_block(source, &block, max_bytes));
        }
    }

    let mut chunks = Vec::new();
    let mut start = atomic.first().map(|block| block.range.start).unwrap_or(0);
    let mut end = start;
    let mut heading: Option<String> = None;
    for block in atomic {
        let next_tokens = estimated_tokens(block.range.end.saturating_sub(start));
        if end > start && next_tokens > max_estimated_tokens {
            push_chunk(&mut chunks, source, start, end, heading.clone(), 0);
            start = block.range.start;
        }
        if let Some(next_heading) = block.heading {
            heading = Some(next_heading);
        }
        end = block.range.end;
    }
    if end > start {
        push_chunk(&mut chunks, source, start, end, heading, 0);
    }
    if chunks.iter().any(|chunk| !balanced_fences(&chunk.source)) {
        return Err(AiError::new(
            "unbalanced_markdown_fence",
            "A translation chunk would separate a fenced code block.",
        ));
    }
    Ok(chunks)
}

pub fn subdivide_translation_chunk(
    chunk: &TranslationChunk,
) -> Result<Vec<TranslationChunk>, AiError> {
    if chunk.subdivision_depth >= 3 {
        return Err(AiError::new(
            "translation_chunk_exhausted",
            "The response remained truncated after three safe subdivisions.",
        ));
    }
    let target_tokens = (chunk.estimated_input_tokens / 2).max(1);
    let mut planned = plan_translation_chunks(&chunk.source, target_tokens)?;
    if planned.len() < 2 {
        return Err(AiError::new(
            "translation_chunk_unsplittable",
            "This Markdown block cannot be split without changing its structure.",
        ));
    }
    for (index, planned_chunk) in planned.iter_mut().enumerate() {
        planned_chunk.index = u32::try_from(index).unwrap_or(u32::MAX);
        planned_chunk.source_range = (chunk.source_range.start + planned_chunk.source_range.start)
            ..(chunk.source_range.start + planned_chunk.source_range.end);
        planned_chunk.subdivision_depth = chunk.subdivision_depth + 1;
        if planned_chunk.heading.is_none() {
            planned_chunk.heading = chunk.heading.clone();
        }
    }
    Ok(planned)
}

pub fn balanced_fences(source: &str) -> bool {
    let mut active: Option<&str> = None;
    for line in source.lines() {
        let trimmed = line.trim_start();
        let marker = if trimmed.starts_with("```") {
            Some("```")
        } else if trimmed.starts_with("~~~") {
            Some("~~~")
        } else {
            None
        };
        if let Some(marker) = marker {
            active = match active {
                Some(current) if current == marker => None,
                None => Some(marker),
                Some(current) => Some(current),
            };
        }
    }
    active.is_none()
}

fn can_split(kind: MarkdownBlockKind) -> bool {
    matches!(
        kind,
        MarkdownBlockKind::Paragraph | MarkdownBlockKind::Blank
    )
}

fn split_text_block(
    source: &str,
    block: &MarkdownBlockRange,
    max_bytes: usize,
) -> Vec<MarkdownBlockRange> {
    let mut ranges = Vec::new();
    let mut cursor = block.range.start;
    while block.range.end.saturating_sub(cursor) > max_bytes {
        let desired_end = cursor.saturating_add(max_bytes).min(block.range.end);
        let split = safe_text_boundary(source, cursor, desired_end, block.range.end);
        if split <= cursor || split >= block.range.end {
            break;
        }
        ranges.push(MarkdownBlockRange {
            range: markdowner_core::ai_document::ByteRange {
                start: cursor,
                end: split,
            },
            kind: block.kind,
            heading: block.heading.clone(),
        });
        cursor = split;
    }
    ranges.push(MarkdownBlockRange {
        range: markdowner_core::ai_document::ByteRange {
            start: cursor,
            end: block.range.end,
        },
        kind: block.kind,
        heading: block.heading.clone(),
    });
    ranges
}

fn safe_text_boundary(source: &str, start: usize, desired_end: usize, end: usize) -> usize {
    let mut desired_end = desired_end;
    while desired_end > start && !source.is_char_boundary(desired_end) {
        desired_end -= 1;
    }
    let candidate = &source[start..desired_end];
    let mut best = None;
    for (offset, character) in candidate.char_indices() {
        if character == '\n' || matches!(character, '.' | '!' | '?' | '。' | '！' | '？') {
            best = Some(start + offset + character.len_utf8());
        }
    }
    if let Some(best) = best.filter(|best| *best > start) {
        return best;
    }
    if desired_end > start {
        return desired_end;
    }
    source[start..end]
        .char_indices()
        .nth(1)
        .map(|(offset, _)| start + offset)
        .unwrap_or(end)
}

fn push_chunk(
    chunks: &mut Vec<TranslationChunk>,
    source: &str,
    start: usize,
    end: usize,
    heading: Option<String>,
    subdivision_depth: u8,
) {
    chunks.push(TranslationChunk {
        index: u32::try_from(chunks.len()).unwrap_or(u32::MAX),
        source_range: start..end,
        source: source[start..end].to_string(),
        heading,
        estimated_input_tokens: estimated_tokens(end.saturating_sub(start)),
        subdivision_depth,
    });
}

fn estimated_tokens(bytes: usize) -> u32 {
    u32::try_from(bytes.saturating_add(3) / 4).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use markdowner_core::ai_document::AiDocumentEnvelope;

    #[test]
    fn oversized_segments_split_without_losing_utf8_or_protected_placeholders() {
        let source = format!(
            "# Heading\n\n{} `keep_this()` {}\n",
            "긴문장 ".repeat(1_000),
            "끝문장 ".repeat(1_000)
        );
        let mut envelope = AiDocumentEnvelope::new("doc", &source, None).unwrap();
        split_oversized_segments(&mut envelope, 512);
        assert!(
            envelope
                .segments
                .iter()
                .all(|segment| segment.text.len() <= 512)
        );
        assert_eq!(envelope.reconstruct_original().unwrap(), source);
        let chunks = plan_structured_document_chunks(&envelope, 256).unwrap();
        assert!(chunks.len() > 5);
        assert_eq!(
            chunks
                .iter()
                .map(|chunk| chunk.envelope.source.as_str())
                .collect::<String>(),
            source
        );
        assert!(
            chunks.iter().all(
                |chunk| chunk.envelope.reconstruct_original().unwrap() == chunk.envelope.source
            )
        );
    }

    #[test]
    fn selection_chunks_include_only_selected_bytes_and_keep_original_placeholders() {
        let selected = "Change this `code` safely.\n".repeat(40);
        let source = format!("untouched prefix\n{selected}untouched suffix");
        let range = ByteRange {
            start: 17,
            end: 17 + selected.len(),
        };
        let mut envelope = AiDocumentEnvelope::new("doc", source, Some(range)).unwrap();
        split_oversized_segments(&mut envelope, 512);
        let chunks = plan_structured_document_chunks(&envelope, 128).unwrap();
        assert!(chunks.len() > 1);
        assert_eq!(
            chunks
                .iter()
                .map(|chunk| chunk.envelope.source.as_str())
                .collect::<String>(),
            selected
        );
        assert!(chunks.iter().all(|chunk| chunk.envelope.selection
            == Some(ByteRange {
                start: 0,
                end: chunk.envelope.source.len()
            })));
    }

    #[test]
    fn chunk_plan_preserves_headings_tables_and_fences() {
        let source = include_str!("../../../tests/fixtures/ai/long-translation.md");
        let chunks = plan_translation_chunks(source, 80).unwrap();
        let reconstructed = chunks
            .iter()
            .map(|chunk| chunk.source.as_str())
            .collect::<String>();

        assert!(chunks.len() > 2);
        assert!(chunks.iter().all(|chunk| balanced_fences(&chunk.source)));
        assert_eq!(reconstructed, source);
        assert!(
            chunks
                .iter()
                .any(|chunk| chunk.heading.as_deref() == Some("Scope"))
        );
    }

    #[test]
    fn subdivision_is_bounded_and_preserves_global_ranges() {
        let source = "One sentence. Two sentence. Three sentence. Four sentence. ".repeat(20);
        let chunk = TranslationChunk {
            index: 4,
            source_range: 100..100 + source.len(),
            source,
            heading: Some("Details".into()),
            estimated_input_tokens: 300,
            subdivision_depth: 2,
        };

        let split = subdivide_translation_chunk(&chunk).unwrap();

        assert!(split.len() >= 2);
        assert_eq!(split.first().unwrap().source_range.start, 100);
        assert_eq!(
            split.last().unwrap().source_range.end,
            chunk.source_range.end
        );
        assert!(split.iter().all(|item| item.subdivision_depth == 3));
    }

    #[test]
    fn structured_chunks_preserve_source_segment_ids_and_protected_tokens() {
        let source =
            "# Scope\n\nKeep `cargo test` unchanged.\n\n## Delivery\n\nShip the result safely.\n";
        let envelope = AiDocumentEnvelope::new("doc-1", source, None).unwrap();

        let chunks = plan_structured_document_chunks(&envelope, 8).unwrap();

        assert!(chunks.len() > 1);
        assert_eq!(
            chunks
                .iter()
                .map(|chunk| chunk.envelope.source.as_str())
                .collect::<String>(),
            source
        );
        assert_eq!(
            chunks
                .iter()
                .flat_map(|chunk| chunk.envelope.segments.iter())
                .map(|segment| segment.id.as_str())
                .collect::<Vec<_>>(),
            envelope
                .segments
                .iter()
                .map(|segment| segment.id.as_str())
                .collect::<Vec<_>>()
        );
        assert!(chunks.iter().all(|chunk| {
            chunk.envelope.revision_hash == envelope.revision_hash
                && chunk.envelope.reconstruct_original().as_deref()
                    == Ok(chunk.envelope.source.as_str())
        }));
        assert_eq!(
            chunks
                .iter()
                .flat_map(|chunk| chunk.envelope.protected.iter())
                .map(|token| token.original.as_str())
                .collect::<Vec<_>>(),
            envelope
                .protected
                .iter()
                .map(|token| token.original.as_str())
                .collect::<Vec<_>>()
        );
    }
}
