use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSearchOptions {
    #[serde(default)]
    case_sensitive: bool,
    #[serde(default)]
    whole_word: bool,
    #[serde(default)]
    regex: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSearchMatch {
    line: u32,
    column: u32,
    preview: String,
    match_start: u32,
    match_end: u32,
    absolute_offset: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSearchFile {
    path: String,
    matches: Vec<WorkspaceSearchMatch>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSearchResult {
    files: Vec<WorkspaceSearchFile>,
}

const WORKSPACE_SEARCH_PREVIEW_RADIUS: usize = 80;
const WORKSPACE_SEARCH_MAX_MATCHES_PER_FILE: usize = 200;
const WORKSPACE_SEARCH_MAX_TOTAL_MATCHES: usize = 2000;

fn is_word_char(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn preview_window(
    line_text: &str,
    match_start_in_line: usize,
    match_end_in_line: usize,
) -> (String, usize, usize) {
    let char_indices: Vec<(usize, char)> = line_text.char_indices().collect();
    let start_char_idx = char_indices
        .iter()
        .position(|(byte_idx, _)| *byte_idx >= match_start_in_line)
        .unwrap_or(char_indices.len());
    let end_char_idx = char_indices
        .iter()
        .position(|(byte_idx, _)| *byte_idx >= match_end_in_line)
        .unwrap_or(char_indices.len());
    let preview_char_start = start_char_idx.saturating_sub(WORKSPACE_SEARCH_PREVIEW_RADIUS);
    let preview_char_end = (end_char_idx + WORKSPACE_SEARCH_PREVIEW_RADIUS).min(char_indices.len());
    let preview_byte_start = char_indices
        .get(preview_char_start)
        .map(|(byte_idx, _)| *byte_idx)
        .unwrap_or(0);
    let preview_byte_end = if preview_char_end == char_indices.len() {
        line_text.len()
    } else {
        char_indices[preview_char_end].0
    };
    let preview = line_text[preview_byte_start..preview_byte_end].to_string();
    let highlight_start = line_text[preview_byte_start..match_start_in_line]
        .encode_utf16()
        .count();
    let highlight_end = line_text[preview_byte_start..match_end_in_line.min(preview_byte_end)]
        .encode_utf16()
        .count();
    (preview, highlight_start, highlight_end)
}

fn search_file_contents(
    source: &str,
    pattern: &regex::Regex,
    whole_word: bool,
    remaining_budget: usize,
) -> Vec<WorkspaceSearchMatch> {
    let mut matches: Vec<WorkspaceSearchMatch> = Vec::new();
    let limit = remaining_budget.min(WORKSPACE_SEARCH_MAX_MATCHES_PER_FILE);
    if limit == 0 {
        return matches;
    }

    let bytes = source.as_bytes();
    let mut previous_start = 0;
    let (mut absolute_offset, mut line, mut column) = (0u32, 1u32, 1u32);
    for capture in pattern.find_iter(source) {
        let start = capture.start();
        let end = capture.end();
        if start == end {
            continue;
        }

        if whole_word {
            let before_ok = start == 0 || !is_word_char(bytes[start - 1]);
            let after_ok = end >= bytes.len() || !is_word_char(bytes[end]);
            if !(before_ok && after_ok) {
                continue;
            }
        }

        let line_start = source[..start].rfind('\n').map(|p| p + 1).unwrap_or(0);
        let line_end = source[end..]
            .find('\n')
            .map(|offset| end + offset)
            .unwrap_or(source.len());
        let line_text = &source[line_start..line_end];
        let match_start_in_line = start - line_start;
        let match_end_in_line = end - line_start;
        let (preview, highlight_start, highlight_end) =
            preview_window(line_text, match_start_in_line, match_end_in_line);
        // Regex boundaries are UTF-8 bytes; JavaScript and both editors use
        // UTF-16 code units. Walk each prefix only once across ordered matches.
        for character in source[previous_start..start].chars() {
            absolute_offset += character.len_utf16() as u32;
            if character == '\n' {
                line += 1;
                column = 1;
            } else {
                column += character.len_utf16() as u32;
            }
        }
        previous_start = start;
        matches.push(WorkspaceSearchMatch {
            line,
            column,
            preview,
            match_start: highlight_start as u32,
            match_end: highlight_end as u32,
            absolute_offset,
        });

        if matches.len() >= limit {
            break;
        }
    }

    matches
}

fn compile_search_pattern(
    query: &str,
    options: &WorkspaceSearchOptions,
) -> Result<regex::Regex, String> {
    let escaped = if options.regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    let mut builder = regex::RegexBuilder::new(&escaped);
    builder.case_insensitive(!options.case_sensitive);
    builder.multi_line(true);
    builder
        .build()
        .map_err(|error| format!("Invalid pattern: {}", error))
}

#[tauri::command]
pub(crate) fn search_workspace(
    query: String,
    options: WorkspaceSearchOptions,
    paths: Vec<String>,
) -> Result<WorkspaceSearchResult, String> {
    if query.is_empty() {
        return Ok(WorkspaceSearchResult { files: Vec::new() });
    }

    let pattern = compile_search_pattern(&query, &options)?;
    let mut files: Vec<WorkspaceSearchFile> = Vec::new();
    let mut total = 0usize;

    for raw_path in paths {
        if total >= WORKSPACE_SEARCH_MAX_TOTAL_MATCHES {
            break;
        }
        let path = Path::new(&raw_path);
        let Ok(source) = std::fs::read_to_string(path) else {
            continue;
        };
        let remaining = WORKSPACE_SEARCH_MAX_TOTAL_MATCHES - total;
        let matches = search_file_contents(&source, &pattern, options.whole_word, remaining);
        if matches.is_empty() {
            continue;
        }
        total += matches.len();
        files.push(WorkspaceSearchFile {
            path: raw_path,
            matches,
        });
    }

    Ok(WorkspaceSearchResult { files })
}

#[cfg(test)]
mod tests {
    use super::{
        WorkspaceSearchOptions, compile_search_pattern, preview_window, search_file_contents,
    };

    #[test]
    fn search_file_contents_respects_whole_word_boundaries() {
        let options = WorkspaceSearchOptions {
            case_sensitive: true,
            whole_word: true,
            regex: false,
        };
        let pattern = compile_search_pattern("cat", &options).unwrap();

        let matches = search_file_contents("cat scatter cat_ cat", &pattern, true, 10);

        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].column, 1);
        assert_eq!(matches[1].column, 18);
    }

    #[test]
    fn preview_window_reports_highlight_offsets_relative_to_the_preview() {
        let (preview, start, end) = preview_window("prefix needle suffix", 7, 13);

        assert_eq!(preview, "prefix needle suffix");
        assert_eq!((start, end), (7, 13));
    }

    #[test]
    fn search_coordinates_use_utf16_for_korean_emoji_and_multiline_matches() {
        for (source, query, line, column, offset) in [
            ("한글 target 뒤", "target", 1, 4, 3),
            ("😀 target end", "target", 1, 4, 3),
            ("앞😀\r\n한 target", "target", 2, 3, 7),
            ("앞😀\n한글\n뒤", "😀\n한글", 1, 2, 1),
        ] {
            let pattern = regex::Regex::new(&regex::escape(query)).unwrap();
            let found = search_file_contents(source, &pattern, false, 10);
            let found = &found[0];
            assert_eq!(
                (found.line, found.column, found.absolute_offset),
                (line, column, offset)
            );
            let preview: Vec<u16> = found.preview.encode_utf16().collect();
            assert_eq!(
                String::from_utf16(&preview[found.match_start as usize..found.match_end as usize])
                    .unwrap(),
                query
            );
            let document: Vec<u16> = source.encode_utf16().collect();
            assert_eq!(
                String::from_utf16(
                    &document[found.absolute_offset as usize
                        ..found.absolute_offset as usize + query.encode_utf16().count()]
                )
                .unwrap(),
                query
            );
        }
    }

    #[test]
    fn truncated_preview_offsets_remain_relative_to_the_utf16_preview() {
        let source = format!("{}target{}", "😀".repeat(100), "한".repeat(100));
        let found = search_file_contents(&source, &regex::Regex::new("target").unwrap(), false, 1);
        assert_eq!(found[0].absolute_offset, 200);
        assert_eq!(found[0].match_start, 160);
        assert_eq!(found[0].match_end, 166);
        assert_eq!(
            found[0].preview,
            format!("{}target{}", "😀".repeat(80), "한".repeat(80))
        );
    }

    #[test]
    fn multiple_matches_keep_absolute_offsets_across_lines() {
        let found =
            search_file_contents("😀x\n한x\nx", &regex::Regex::new("x").unwrap(), false, 10);
        assert_eq!(
            found
                .iter()
                .map(|m| (m.line, m.column, m.absolute_offset))
                .collect::<Vec<_>>(),
            [(1, 3, 2), (2, 2, 5), (3, 1, 7)]
        );
    }
}
