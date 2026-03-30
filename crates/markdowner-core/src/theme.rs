use serde::{Deserialize, Serialize};

use crate::{Block, Document};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodeBlockStyleKind {
    Plain,
    SyntaxHighlighted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodeTokenKind {
    Plain,
    Keyword,
    String,
    Comment,
    Number,
    Punctuation,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeToken {
    text: String,
    kind: CodeTokenKind,
}

impl CodeToken {
    fn new(text: impl Into<String>, kind: CodeTokenKind) -> Self {
        Self {
            text: text.into(),
            kind,
        }
    }

    pub fn text(&self) -> &str {
        &self.text
    }

    pub fn kind(&self) -> CodeTokenKind {
        self.kind
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StyledCodeBlock {
    language: Option<String>,
    style_kind: CodeBlockStyleKind,
    background: String,
    lines: Vec<Vec<CodeToken>>,
}

impl StyledCodeBlock {
    fn new(
        language: Option<String>,
        style_kind: CodeBlockStyleKind,
        background: impl Into<String>,
        lines: Vec<Vec<CodeToken>>,
    ) -> Self {
        Self {
            language,
            style_kind,
            background: background.into(),
            lines,
        }
    }

    pub fn language(&self) -> Option<&str> {
        self.language.as_deref()
    }

    pub fn style_kind(&self) -> CodeBlockStyleKind {
        self.style_kind
    }

    pub fn background(&self) -> &str {
        &self.background
    }

    pub fn lines(&self) -> &[Vec<CodeToken>] {
        &self.lines
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ThemeKind {
    BuiltInLight,
    BuiltInDark,
    CustomCss,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThemeSelection {
    kind: ThemeKind,
    #[serde(default)]
    stylesheet: Option<String>,
    #[serde(default)]
    stylesheet_path: Option<String>,
}

impl ThemeSelection {
    pub fn new(kind: ThemeKind, stylesheet: Option<String>) -> Self {
        Self {
            kind,
            stylesheet,
            stylesheet_path: None,
        }
    }

    pub fn imported(path: impl Into<String>, stylesheet: impl Into<String>) -> Self {
        Self {
            kind: ThemeKind::CustomCss,
            stylesheet: Some(stylesheet.into()),
            stylesheet_path: Some(path.into()),
        }
    }

    pub fn kind(&self) -> ThemeKind {
        self.kind
    }

    pub fn stylesheet(&self) -> Option<&str> {
        self.stylesheet.as_deref()
    }

    pub fn stylesheet_path(&self) -> Option<&str> {
        self.stylesheet_path.as_deref()
    }
}

impl Default for ThemeSelection {
    fn default() -> Self {
        Self::new(ThemeKind::BuiltInLight, None)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThemePalette {
    background: String,
    foreground: String,
    accent: String,
    code_background: String,
}

impl ThemePalette {
    fn new(
        background: impl Into<String>,
        foreground: impl Into<String>,
        accent: impl Into<String>,
        code_background: impl Into<String>,
    ) -> Self {
        Self {
            background: background.into(),
            foreground: foreground.into(),
            accent: accent.into(),
            code_background: code_background.into(),
        }
    }

    pub fn background(&self) -> &str {
        &self.background
    }

    pub fn foreground(&self) -> &str {
        &self.foreground
    }

    pub fn accent(&self) -> &str {
        &self.accent
    }

    pub fn code_background(&self) -> &str {
        &self.code_background
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppliedTheme {
    palette: ThemePalette,
    stylesheet: Option<String>,
}

impl AppliedTheme {
    pub fn palette(&self) -> &ThemePalette {
        &self.palette
    }

    pub fn stylesheet(&self) -> Option<&str> {
        self.stylesheet.as_deref()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StyledDocument {
    document: Document,
    theme: AppliedTheme,
    code_block_styles: Vec<Option<StyledCodeBlock>>,
}

impl StyledDocument {
    pub fn document(&self) -> &Document {
        &self.document
    }

    pub fn theme(&self) -> &AppliedTheme {
        &self.theme
    }

    pub fn code_block_style(&self, block_index: usize) -> Option<&StyledCodeBlock> {
        self.code_block_styles.get(block_index)?.as_ref()
    }
}

pub fn apply_theme(document: &Document, selection: &ThemeSelection) -> StyledDocument {
    let palette = match selection.kind() {
        ThemeKind::BuiltInLight => ThemePalette::new("#ffffff", "#161616", "#2f6fed", "#f4f6fa"),
        ThemeKind::BuiltInDark => ThemePalette::new("#14161a", "#f5f7fa", "#7fb0ff", "#21252b"),
        ThemeKind::CustomCss => ThemePalette::new("#ffffff", "#161616", "#4c7fff", "#eef2ff"),
    };

    StyledDocument {
        document: document.clone(),
        theme: AppliedTheme {
            palette: palette.clone(),
            stylesheet: selection.stylesheet.clone(),
        },
        code_block_styles: document
            .blocks()
            .iter()
            .map(|block| style_code_block(block, &palette))
            .collect(),
    }
}

pub(crate) fn validate_stylesheet(stylesheet: &str) -> Result<(), String> {
    let trimmed = stylesheet.trim();
    if trimmed.is_empty() {
        return Err("CSS theme is empty".to_string());
    }

    if !trimmed.contains('{') || !trimmed.contains('}') {
        return Err("CSS theme must contain at least one rule block".to_string());
    }

    let mut depth = 0usize;
    for character in trimmed.chars() {
        match character {
            '{' => depth += 1,
            '}' => {
                if depth == 0 {
                    return Err("CSS theme contains an unmatched closing brace".to_string());
                }
                depth -= 1;
            }
            _ => {}
        }
    }

    if depth != 0 {
        return Err("CSS theme contains an unmatched opening brace".to_string());
    }

    Ok(())
}

pub(crate) fn style_code_block(block: &Block, palette: &ThemePalette) -> Option<StyledCodeBlock> {
    let Block::CodeFence { language, code } = block else {
        return None;
    };

    Some(build_styled_code_block(language.as_deref(), code, palette))
}

fn build_styled_code_block(
    language: Option<&str>,
    code: &str,
    palette: &ThemePalette,
) -> StyledCodeBlock {
    let normalized_language = language
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase());
    let background = palette.code_background().to_string();
    let lines = match normalized_language.as_deref() {
        Some("rust") | Some("rs") => code.split('\n').map(tokenize_rust_line).collect(),
        Some("json") => code.split('\n').map(tokenize_json_line).collect(),
        _ => plain_code_lines(code),
    };
    let style_kind = if matches!(normalized_language.as_deref(), Some("rust" | "rs" | "json")) {
        CodeBlockStyleKind::SyntaxHighlighted
    } else {
        CodeBlockStyleKind::Plain
    };

    StyledCodeBlock::new(
        language.map(ToOwned::to_owned),
        style_kind,
        background,
        lines,
    )
}

fn plain_code_lines(code: &str) -> Vec<Vec<CodeToken>> {
    code.split('\n')
        .map(|line| vec![CodeToken::new(line, CodeTokenKind::Plain)])
        .collect()
}

fn tokenize_rust_line(line: &str) -> Vec<CodeToken> {
    tokenize_line(line, classify_rust_identifier, true)
}

fn tokenize_json_line(line: &str) -> Vec<CodeToken> {
    tokenize_line(line, classify_json_identifier, false)
}

fn tokenize_line(
    line: &str,
    classify_identifier: fn(&str) -> CodeTokenKind,
    supports_comments: bool,
) -> Vec<CodeToken> {
    let indices = line.char_indices().collect::<Vec<_>>();
    let mut tokens = Vec::new();
    let mut cursor = 0;

    while cursor < indices.len() {
        let (start, ch) = indices[cursor];

        if ch.is_whitespace() {
            let end = consume_while(line, &indices, cursor, |value| value.is_whitespace());
            tokens.push(CodeToken::new(&line[start..end], CodeTokenKind::Plain));
            cursor = next_cursor(&indices, end);
            continue;
        }

        if supports_comments
            && ch == '/'
            && indices
                .get(cursor + 1)
                .is_some_and(|(_, next)| *next == '/')
        {
            tokens.push(CodeToken::new(&line[start..], CodeTokenKind::Comment));
            break;
        }

        if ch == '"' {
            let end = consume_string(line, &indices, cursor);
            tokens.push(CodeToken::new(&line[start..end], CodeTokenKind::String));
            cursor = next_cursor(&indices, end);
            continue;
        }

        if ch.is_ascii_digit() {
            let end = consume_while(line, &indices, cursor, |value| {
                value.is_ascii_digit()
                    || value == '.'
                    || value == '_'
                    || value.is_ascii_hexdigit()
                    || matches!(value, 'x' | 'o' | 'b')
            });
            tokens.push(CodeToken::new(&line[start..end], CodeTokenKind::Number));
            cursor = next_cursor(&indices, end);
            continue;
        }

        if ch.is_alphanumeric() || ch == '_' {
            let end = consume_while(line, &indices, cursor, |value| {
                value.is_alphanumeric() || value == '_'
            });
            let text = &line[start..end];
            tokens.push(CodeToken::new(text, classify_identifier(text)));
            cursor = next_cursor(&indices, end);
            continue;
        }

        let end = next_byte_index(line, &indices, cursor);
        let kind = if is_punctuation(ch) {
            CodeTokenKind::Punctuation
        } else {
            CodeTokenKind::Plain
        };
        tokens.push(CodeToken::new(&line[start..end], kind));
        cursor += 1;
    }

    if tokens.is_empty() {
        tokens.push(CodeToken::new("", CodeTokenKind::Plain));
    }

    tokens
}

fn consume_while(
    line: &str,
    indices: &[(usize, char)],
    cursor: usize,
    predicate: impl Fn(char) -> bool,
) -> usize {
    let mut next = cursor;
    while next < indices.len() && predicate(indices[next].1) {
        next += 1;
    }
    indices.get(next).map_or(line.len(), |(index, _)| *index)
}

fn consume_string(line: &str, indices: &[(usize, char)], cursor: usize) -> usize {
    let mut next = cursor + 1;
    let mut escaped = false;

    while next < indices.len() {
        let ch = indices[next].1;
        if ch == '"' && !escaped {
            return next_byte_index(line, indices, next);
        }

        escaped = ch == '\\' && !escaped;
        if ch != '\\' {
            escaped = false;
        }
        next += 1;
    }

    line.len()
}

fn next_cursor(indices: &[(usize, char)], byte_index: usize) -> usize {
    indices
        .iter()
        .position(|(index, _)| *index >= byte_index)
        .unwrap_or(indices.len())
}

fn next_byte_index(line: &str, indices: &[(usize, char)], cursor: usize) -> usize {
    indices
        .get(cursor + 1)
        .map_or(line.len(), |(index, _)| *index)
}

fn is_punctuation(ch: char) -> bool {
    matches!(
        ch,
        '{' | '}'
            | '['
            | ']'
            | '('
            | ')'
            | ':'
            | ';'
            | ','
            | '.'
            | '!'
            | '?'
            | '<'
            | '>'
            | '='
            | '+'
            | '-'
            | '*'
            | '/'
            | '%'
            | '&'
            | '|'
    )
}

fn classify_rust_identifier(identifier: &str) -> CodeTokenKind {
    if matches!(
        identifier,
        "as" | "async"
            | "await"
            | "break"
            | "const"
            | "continue"
            | "crate"
            | "dyn"
            | "else"
            | "enum"
            | "extern"
            | "false"
            | "fn"
            | "for"
            | "if"
            | "impl"
            | "in"
            | "let"
            | "loop"
            | "match"
            | "mod"
            | "move"
            | "mut"
            | "pub"
            | "ref"
            | "return"
            | "self"
            | "Self"
            | "static"
            | "struct"
            | "super"
            | "trait"
            | "true"
            | "type"
            | "unsafe"
            | "use"
            | "where"
            | "while"
    ) {
        CodeTokenKind::Keyword
    } else {
        CodeTokenKind::Plain
    }
}

fn classify_json_identifier(identifier: &str) -> CodeTokenKind {
    if matches!(identifier, "true" | "false" | "null") {
        CodeTokenKind::Keyword
    } else {
        CodeTokenKind::Plain
    }
}
