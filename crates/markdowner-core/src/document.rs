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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TableAlignment {
    None,
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TableRow {
    cells: Vec<Vec<Inline>>,
}

impl TableRow {
    pub fn new(cells: Vec<Vec<Inline>>) -> Self {
        Self { cells }
    }

    pub fn cells(&self) -> &[Vec<Inline>] {
        &self.cells
    }

    pub(crate) fn cells_mut(&mut self) -> &mut [Vec<Inline>] {
        &mut self.cells
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
    Image {
        alt: String,
        source: String,
        title: Option<String>,
    },
    Table {
        headers: TableRow,
        alignments: Vec<TableAlignment>,
        rows: Vec<TableRow>,
    },
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
