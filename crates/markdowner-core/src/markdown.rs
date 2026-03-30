use crate::{Block, Document, Inline};

pub fn parse_markdown(source: &str) -> Document {
    let normalized = source.replace("\r\n", "\n");
    let mut blocks = Vec::new();
    let mut paragraph_lines = Vec::new();
    let mut code_language: Option<Option<String>> = None;
    let mut code_lines = Vec::new();

    let flush_paragraph = |paragraph_lines: &mut Vec<String>, blocks: &mut Vec<Block>| {
        if paragraph_lines.is_empty() {
            return;
        }

        blocks.push(Block::Paragraph(parse_inlines(&paragraph_lines.join("\n"))));
        paragraph_lines.clear();
    };

    for line in normalized.lines() {
        if let Some(language) = code_language.as_ref() {
            if line.starts_with("```") {
                blocks.push(Block::CodeFence {
                    language: language.clone(),
                    code: code_lines.join("\n"),
                });
                code_language = None;
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

        if let Some(rest) = line.strip_prefix("```") {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            let language = match rest.trim() {
                "" => None,
                value => Some(value.to_string()),
            };
            code_language = Some(language);
            continue;
        }

        if let Some((level, text)) = parse_heading(line) {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            blocks.push(Block::Heading {
                level,
                text: parse_inlines(text),
            });
            continue;
        }

        if let Some(text) = line.strip_prefix("> ") {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            blocks.push(Block::Quote(parse_inlines(text)));
            continue;
        }

        if let Some(text) = line.strip_prefix("- [x] ") {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            blocks.push(Block::ChecklistItem {
                checked: true,
                text: parse_inlines(text),
            });
            continue;
        }

        if let Some(text) = line.strip_prefix("- [ ] ") {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            blocks.push(Block::ChecklistItem {
                checked: false,
                text: parse_inlines(text),
            });
            continue;
        }

        if let Some(text) = line.strip_prefix("- ") {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            blocks.push(Block::BulletItem(parse_inlines(text)));
            continue;
        }

        paragraph_lines.push(line.to_string());
    }

    if let Some(language) = code_language {
        blocks.push(Block::CodeFence {
            language,
            code: code_lines.join("\n"),
        });
    } else {
        flush_paragraph(&mut paragraph_lines, &mut blocks);
    }

    Document::new(blocks)
}

pub fn serialize_markdown(document: &Document) -> String {
    document
        .blocks()
        .iter()
        .map(|block| match block {
            Block::Heading { level, text } => {
                format!(
                    "{} {}",
                    "#".repeat((*level).into()),
                    serialize_inlines(text)
                )
            }
            Block::Paragraph(text) => serialize_inlines(text),
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
        })
        .collect::<Vec<_>>()
        .join("\n\n")
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
