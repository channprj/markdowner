use crate::{Block, Document, Inline, TableAlignment, TableRow};

pub(crate) fn split_markdown_blocks(source: &str) -> Vec<String> {
    let normalized = source.replace("\r\n", "\n");
    let mut blocks = Vec::new();
    let mut paragraph_lines = Vec::new();
    let mut code_fence_opening: Option<String> = None;
    let mut code_lines = Vec::new();

    let flush_paragraph = |paragraph_lines: &mut Vec<String>, blocks: &mut Vec<String>| {
        if paragraph_lines.is_empty() {
            return;
        }

        blocks.push(paragraph_lines.join("\n"));
        paragraph_lines.clear();
    };

    for line in normalized.lines() {
        if let Some(opening) = code_fence_opening.as_ref() {
            if line.starts_with("```") {
                let mut block = opening.clone();
                if !code_lines.is_empty() {
                    block.push('\n');
                    block.push_str(&code_lines.join("\n"));
                }
                block.push('\n');
                block.push_str(line);
                blocks.push(block);
                code_fence_opening = None;
                code_lines.clear();
            } else {
                code_lines.push(line.to_string());
            }
            continue;
        }

        if line.trim().is_empty() {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            continue;
        }

        if line.starts_with("```") {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            code_fence_opening = Some(line.to_string());
            continue;
        }

        if line.starts_with("#")
            || line.starts_with("> ")
            || line.starts_with("- [x] ")
            || line.starts_with("- [ ] ")
            || line.starts_with("- ")
        {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            blocks.push(line.to_string());
            continue;
        }

        paragraph_lines.push(line.to_string());
    }

    if let Some(opening) = code_fence_opening {
        let mut block = opening;
        if !code_lines.is_empty() {
            block.push('\n');
            block.push_str(&code_lines.join("\n"));
        }
        blocks.push(block);
    } else {
        flush_paragraph(&mut paragraph_lines, &mut blocks);
    }

    blocks
}

pub fn parse_markdown(source: &str) -> Document {
    let normalized = source.replace("\r\n", "\n");
    let lines: Vec<&str> = normalized.lines().collect();
    let mut blocks = Vec::new();
    let mut paragraph_lines = Vec::new();
    let mut index = 0;

    let flush_paragraph = |paragraph_lines: &mut Vec<String>, blocks: &mut Vec<Block>| {
        if paragraph_lines.is_empty() {
            return;
        }

        blocks.push(Block::Paragraph(parse_inlines(&paragraph_lines.join("\n"))));
        paragraph_lines.clear();
    };

    while index < lines.len() {
        let line = lines[index];

        if line.trim().is_empty() {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            index += 1;
            continue;
        }

        if let Some(rest) = line.strip_prefix("```") {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            let language = match rest.trim() {
                "" => None,
                value => Some(value.to_string()),
            };
            index += 1;
            let mut code_lines = Vec::new();
            while index < lines.len() && !lines[index].starts_with("```") {
                code_lines.push(lines[index].to_string());
                index += 1;
            }
            if index < lines.len() {
                index += 1;
            }
            blocks.push(Block::CodeFence {
                language,
                code: code_lines.join("\n"),
            });
            continue;
        }

        if let Some(block) = parse_image_block(line) {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            blocks.push(block);
            index += 1;
            continue;
        }

        if let Some((block, consumed)) = parse_table_block(&lines, index) {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            blocks.push(block);
            index += consumed;
            continue;
        }

        if let Some((level, text)) = parse_heading(line) {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            blocks.push(Block::Heading {
                level,
                text: parse_inlines(text),
            });
            index += 1;
            continue;
        }

        if let Some(text) = line.strip_prefix("> ") {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            blocks.push(Block::Quote(parse_inlines(text)));
            index += 1;
            continue;
        }

        if let Some(text) = line.strip_prefix("- [x] ") {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            blocks.push(Block::ChecklistItem {
                checked: true,
                text: parse_inlines(text),
            });
            index += 1;
            continue;
        }

        if let Some(text) = line.strip_prefix("- [ ] ") {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            blocks.push(Block::ChecklistItem {
                checked: false,
                text: parse_inlines(text),
            });
            index += 1;
            continue;
        }

        if let Some(text) = line.strip_prefix("- ") {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            blocks.push(Block::BulletItem(parse_inlines(text)));
            index += 1;
            continue;
        }

        paragraph_lines.push(line.to_string());
        index += 1;
    }

    flush_paragraph(&mut paragraph_lines, &mut blocks);
    Document::new(blocks)
}

pub fn serialize_markdown(document: &Document) -> String {
    document
        .blocks()
        .iter()
        .map(serialize_block)
        .collect::<Vec<_>>()
        .join("\n\n")
}

pub(crate) fn serialize_block(block: &Block) -> String {
    match block {
        Block::Heading { level, text } => {
            format!(
                "{} {}",
                "#".repeat((*level).into()),
                serialize_inlines(text)
            )
        }
        Block::Paragraph(text) => serialize_inlines(text),
        Block::Image { alt, source, title } => match title {
            Some(title) => format!(
                "![{}]({} \"{}\")",
                escape_image_alt(alt),
                source,
                escape_image_title(title)
            ),
            None => format!("![{}]({source})", escape_image_alt(alt)),
        },
        Block::Table {
            headers,
            alignments,
            rows,
        } => {
            let mut lines = vec![
                serialize_table_row(headers.cells()),
                serialize_table_alignment_row(headers.cells().len(), alignments),
            ];
            lines.extend(rows.iter().map(|row| serialize_table_row(row.cells())));
            lines.join("\n")
        }
        Block::Quote(text) => format!("> {}", serialize_inlines(text)),
        Block::BulletItem(text) => format!("- {}", serialize_inlines(text)),
        Block::ChecklistItem { checked, text } => {
            format!(
                "- [{}] {}",
                if *checked { "x" } else { " " },
                serialize_inlines(text)
            )
        }
        Block::CodeFence { language, code } => match language {
            Some(language) => format!("```{language}\n{code}\n```"),
            None => format!("```\n{code}\n```"),
        },
    }
}

fn parse_heading(line: &str) -> Option<(u8, &str)> {
    let level = line.bytes().take_while(|byte| *byte == b'#').count();
    if !(1..=6).contains(&level) {
        return None;
    }

    if line.as_bytes().get(level).is_none_or(|byte| *byte != b' ') {
        return None;
    }

    Some((level as u8, line.get(level + 1..)?))
}

fn parse_image_block(line: &str) -> Option<Block> {
    let trimmed = line.trim();
    if trimmed != line {
        return None;
    }

    let rest = trimmed.strip_prefix("![")?;
    let alt_end = rest.find("](")?;
    let alt = &rest[..alt_end];
    let destination = rest.get(alt_end + 2..)?.strip_suffix(')')?;
    let (source, title) = parse_image_destination(destination)?;

    Some(Block::Image {
        alt: alt.to_string(),
        source,
        title,
    })
}

fn parse_image_destination(destination: &str) -> Option<(String, Option<String>)> {
    let trimmed = destination.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some(without_quote) = trimmed.strip_suffix('"')
        && let Some(split_index) = without_quote.rfind(" \"")
    {
        let source = without_quote[..split_index].trim();
        let title = &without_quote[split_index + 2..];
        if !source.is_empty() {
            return Some((source.to_string(), Some(title.to_string())));
        }
    }

    Some((trimmed.to_string(), None))
}

fn parse_table_block(lines: &[&str], start: usize) -> Option<(Block, usize)> {
    let header_line = lines.get(start)?;
    let separator_line = lines.get(start + 1)?;
    let header_cells = split_table_row(header_line)?;
    let alignments = parse_table_separator(separator_line, header_cells.len())?;

    let mut rows = Vec::new();
    let mut consumed = 2;
    let mut index = start + 2;
    while let Some(line) = lines.get(index) {
        if line.trim().is_empty() || !is_pipe_table_line_candidate(line) {
            break;
        }

        let cells = split_table_row(line)?;
        if cells.len() != header_cells.len() {
            return None;
        }

        rows.push(TableRow::new(
            cells.iter().map(|cell| parse_inlines(cell)).collect(),
        ));
        consumed += 1;
        index += 1;
    }

    Some((
        Block::Table {
            headers: TableRow::new(
                header_cells
                    .iter()
                    .map(|cell| parse_inlines(cell))
                    .collect(),
            ),
            alignments,
            rows,
        },
        consumed,
    ))
}

fn split_table_row(line: &str) -> Option<Vec<String>> {
    if !is_pipe_table_line_candidate(line) || line.trim().contains("\\|") {
        return None;
    }

    let trimmed = line.trim();
    let inner = trimmed.get(1..trimmed.len().checked_sub(1)?)?;
    Some(
        inner
            .split('|')
            .map(|cell| cell.trim().to_string())
            .collect(),
    )
}

fn parse_table_separator(line: &str, expected_columns: usize) -> Option<Vec<TableAlignment>> {
    let cells = split_table_row(line)?;
    if cells.len() != expected_columns {
        return None;
    }

    cells
        .into_iter()
        .map(|cell| {
            let trimmed = cell.trim();
            let starts_with_colon = trimmed.starts_with(':');
            let ends_with_colon = trimmed.ends_with(':');
            let hyphens = trimmed.trim_matches(':');
            if hyphens.len() < 3 || hyphens.chars().any(|character| character != '-') {
                return None;
            }

            Some(match (starts_with_colon, ends_with_colon) {
                (true, true) => TableAlignment::Center,
                (true, false) => TableAlignment::Left,
                (false, true) => TableAlignment::Right,
                (false, false) => TableAlignment::None,
            })
        })
        .collect()
}

fn is_pipe_table_line_candidate(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.starts_with('|') && trimmed.ends_with('|') && trimmed.len() >= 2
}

fn serialize_table_row(cells: &[Vec<Inline>]) -> String {
    format!(
        "| {} |",
        cells
            .iter()
            .map(|cell| serialize_inlines(cell))
            .collect::<Vec<_>>()
            .join(" | ")
    )
}

fn serialize_table_alignment_row(columns: usize, alignments: &[TableAlignment]) -> String {
    format!(
        "| {} |",
        (0..columns)
            .map(|index| {
                match alignments
                    .get(index)
                    .copied()
                    .unwrap_or(TableAlignment::None)
                {
                    TableAlignment::None => "---".to_string(),
                    TableAlignment::Left => ":---".to_string(),
                    TableAlignment::Center => ":---:".to_string(),
                    TableAlignment::Right => "---:".to_string(),
                }
            })
            .collect::<Vec<_>>()
            .join(" | ")
    )
}

fn parse_inlines(source: &str) -> Vec<Inline> {
    parse_inline_sequence(source, None).inlines
}

fn serialize_inlines(inlines: &[Inline]) -> String {
    inlines
        .iter()
        .map(|inline| match inline {
            Inline::Text(text) => escape_text(text),
            Inline::Bold(text) => format!("**{}**", serialize_inlines(text)),
            Inline::Italic(text) => format!("*{}*", serialize_inlines(text)),
            Inline::Link { text, destination } => {
                format!("[{}]({destination})", serialize_inlines(text))
            }
            Inline::Code(code) => format!("`{code}`"),
        })
        .collect::<Vec<_>>()
        .join("")
}

fn escape_text(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());

    for character in text.chars() {
        match character {
            '\\' | '*' | '_' | '`' | '[' | ']' => {
                escaped.push('\\');
                escaped.push(character);
            }
            _ => escaped.push(character),
        }
    }

    escaped
}

fn escape_image_alt(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('[', "\\[")
        .replace(']', "\\]")
}

fn escape_image_title(text: &str) -> String {
    text.replace('\\', "\\\\").replace('"', "\\\"")
}

#[derive(Debug)]
struct InlineParseResult {
    inlines: Vec<Inline>,
    consumed: usize,
    terminated: bool,
}

fn parse_inline_sequence(source: &str, terminator: Option<&str>) -> InlineParseResult {
    let mut inlines = Vec::new();
    let mut text = String::new();
    let mut index = 0;

    while index < source.len() {
        if let Some(terminator) = terminator
            && source[index..].starts_with(terminator)
        {
            push_text(&mut inlines, &mut text);
            return InlineParseResult {
                inlines,
                consumed: index + terminator.len(),
                terminated: true,
            };
        }

        if source[index..].starts_with('\\') {
            let escape_start = index + 1;
            if escape_start < source.len() {
                let escaped = source[escape_start..]
                    .chars()
                    .next()
                    .expect("validated by bounds check");
                text.push(escaped);
                index = escape_start + escaped.len_utf8();
            } else {
                text.push('\\');
                index += 1;
            }
            continue;
        }

        if let Some((code, next_index)) = parse_code_inline(source, index) {
            push_text(&mut inlines, &mut text);
            inlines.push(Inline::Code(code));
            index = next_index;
            continue;
        }

        if let Some((label, destination, next_index)) = parse_link_inline(source, index) {
            push_text(&mut inlines, &mut text);
            inlines.push(Inline::Link {
                text: parse_inlines(&label),
                destination,
            });
            index = next_index;
            continue;
        }

        if let Some((inline, next_index)) = parse_emphasis_inline(source, index, "**", Inline::Bold)
        {
            push_text(&mut inlines, &mut text);
            inlines.push(inline);
            index = next_index;
            continue;
        }

        if let Some((inline, next_index)) = parse_emphasis_inline(source, index, "__", Inline::Bold)
        {
            push_text(&mut inlines, &mut text);
            inlines.push(inline);
            index = next_index;
            continue;
        }

        if let Some((inline, next_index)) =
            parse_emphasis_inline(source, index, "*", Inline::Italic)
        {
            push_text(&mut inlines, &mut text);
            inlines.push(inline);
            index = next_index;
            continue;
        }

        if let Some((inline, next_index)) =
            parse_emphasis_inline(source, index, "_", Inline::Italic)
        {
            push_text(&mut inlines, &mut text);
            inlines.push(inline);
            index = next_index;
            continue;
        }

        let character = source[index..]
            .chars()
            .next()
            .expect("index always points to a valid char boundary");
        text.push(character);
        index += character.len_utf8();
    }

    push_text(&mut inlines, &mut text);
    InlineParseResult {
        inlines,
        consumed: index,
        terminated: terminator.is_none(),
    }
}

fn parse_code_inline(source: &str, index: usize) -> Option<(String, usize)> {
    if !source[index..].starts_with('`') {
        return None;
    }

    let rest = source.get(index + 1..)?;
    let end = rest.find('`')?;
    let end_index = index + 1 + end;
    Some((source[index + 1..end_index].to_string(), end_index + 1))
}

fn parse_link_inline(source: &str, index: usize) -> Option<(String, String, usize)> {
    if !source[index..].starts_with('[') {
        return None;
    }

    let rest = source.get(index + 1..)?;
    let label_end = rest.find("](")?;
    let label_end_index = index + 1 + label_end;
    let destination_start = label_end_index + 2;
    let destination = source.get(destination_start..)?;
    let destination_end = destination.find(')')?;
    let destination_end_index = destination_start + destination_end;

    Some((
        source[index + 1..label_end_index].to_string(),
        source[destination_start..destination_end_index].to_string(),
        destination_end_index + 1,
    ))
}

fn parse_emphasis_inline(
    source: &str,
    index: usize,
    delimiter: &str,
    constructor: fn(Vec<Inline>) -> Inline,
) -> Option<(Inline, usize)> {
    if !source[index..].starts_with(delimiter) {
        return None;
    }

    let inner = source.get(index + delimiter.len()..)?;
    let parsed = parse_inline_sequence(inner, Some(delimiter));
    if !parsed.terminated {
        return None;
    }

    Some((
        constructor(parsed.inlines),
        index + delimiter.len() + parsed.consumed,
    ))
}

fn push_text(inlines: &mut Vec<Inline>, text: &mut String) {
    if text.is_empty() {
        return;
    }

    if let Some(Inline::Text(existing)) = inlines.last_mut() {
        existing.push_str(text);
    } else {
        inlines.push(Inline::Text(std::mem::take(text)));
        return;
    }

    text.clear();
}
