#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Document {
    blocks: Vec<Block>,
}

impl Document {
    pub fn new(blocks: Vec<Block>) -> Self {
        Self { blocks }
    }

    pub fn blocks(&self) -> &[Block] {
        &self.blocks
    }
}

impl Default for Document {
    fn default() -> Self {
        Self::new(Vec::new())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Inline {
    Text(String),
    Bold(Vec<Inline>),
    Italic(Vec<Inline>),
    Link {
        text: Vec<Inline>,
        destination: String,
    },
    Code(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Block {
    Heading {
        level: u8,
        text: Vec<Inline>,
    },
    Paragraph(Vec<Inline>),
    Quote(Vec<Inline>),
    BulletItem(Vec<Inline>),
    ChecklistItem {
        checked: bool,
        text: Vec<Inline>,
    },
    CodeFence {
        language: Option<String>,
        code: String,
    },
}
