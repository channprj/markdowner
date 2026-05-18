use serde::{Deserialize, Serialize};

use crate::EditorMode;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub auto_save: bool,
    pub editor_font_size: u32,
    pub editor_font_family: String,
    pub editor_line_wrap: bool,
    pub editor_wrap_column: u32,
    pub outline_font_size: u32,
    pub outline_row_spacing: u32,
    pub default_mode: EditorMode,
    pub focus_mode_enabled: bool,
    pub typewriter_mode_enabled: bool,
    pub asset_folder: String,
    pub theme_follow_system: bool,
    pub pdf_paper_size: String,
    pub diagnostics_enabled: bool,
    pub show_minimap: bool,
    pub table_density: String,
    pub code_block_highlight: bool,
    pub code_block_theme: String,
    pub code_block_theme_sync: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_save: false,
            editor_font_size: 0,
            editor_font_family: String::new(),
            editor_line_wrap: true,
            editor_wrap_column: 120,
            outline_font_size: 12,
            outline_row_spacing: 0,
            default_mode: EditorMode::Wysiwyg,
            focus_mode_enabled: false,
            typewriter_mode_enabled: false,
            asset_folder: "assets".to_string(),
            theme_follow_system: true,
            pdf_paper_size: "A4".to_string(),
            diagnostics_enabled: false,
            show_minimap: false,
            table_density: "compact".to_string(),
            code_block_highlight: true,
            code_block_theme: "one-dark".to_string(),
            code_block_theme_sync: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Settings;

    #[test]
    fn legacy_settings_json_without_line_wrap_defaults_to_enabled() {
        let legacy = r#"{"autoSave":true,"editorFontSize":16,"editorFontFamily":"Mono"}"#;
        let parsed: Settings = serde_json::from_str(legacy).expect("legacy settings.json parses");
        assert!(parsed.auto_save);
        assert_eq!(parsed.editor_font_size, 16);
        assert_eq!(parsed.editor_font_family, "Mono");
        assert!(
            parsed.editor_line_wrap,
            "missing editorLineWrap should default to true"
        );
        assert_eq!(parsed.outline_font_size, 12);
        assert_eq!(parsed.outline_row_spacing, 0);
    }

    #[test]
    fn settings_round_trip_preserves_editor_density_fields() {
        let original = Settings {
            auto_save: false,
            editor_font_size: 14,
            editor_font_family: String::new(),
            editor_line_wrap: false,
            outline_font_size: 12,
            outline_row_spacing: 1,
            ..Default::default()
        };
        let payload = serde_json::to_string(&original).expect("serialize");
        assert!(payload.contains("\"editorLineWrap\":false"));
        assert!(payload.contains("\"outlineFontSize\":12"));
        assert!(payload.contains("\"outlineRowSpacing\":1"));
        let parsed: Settings = serde_json::from_str(&payload).expect("parse");
        assert!(!parsed.editor_line_wrap);
        assert_eq!(parsed.outline_font_size, 12);
        assert_eq!(parsed.outline_row_spacing, 1);
    }

    #[test]
    fn settings_round_trip_preserves_code_block_highlighting_fields() {
        let original = r#"{
            "codeBlockHighlight": false,
            "codeBlockTheme": "one-light",
            "codeBlockThemeSync": true
        }"#;
        let parsed: Settings = serde_json::from_str(original).expect("parse settings");
        let value = serde_json::to_value(parsed).expect("serialize settings");

        assert_eq!(value["codeBlockHighlight"], false);
        assert_eq!(value["codeBlockTheme"], "one-light");
        assert_eq!(value["codeBlockThemeSync"], true);
    }
}
