use serde::{Deserialize, Serialize};

use crate::EditorMode;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub auto_save: bool,
    pub editor_font_size: u32,
    /// Unitless line-height multiplier; the frontend normalizes 0 → default.
    pub editor_line_height: f32,
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
    pub update_check_enabled: bool,
    pub last_update_check_at: Option<u64>,
    pub dismissed_update_version: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_save: false,
            editor_font_size: 0,
            editor_line_height: 0.0,
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
            update_check_enabled: true,
            last_update_check_at: None,
            dismissed_update_version: None,
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
    fn update_check_fields_default_when_absent_and_round_trip() {
        // Legacy settings.json (pre-update-notifier) must load with update-check ON.
        let legacy = r#"{"autoSave":true,"editorFontSize":16}"#;
        let parsed: Settings = serde_json::from_str(legacy).expect("legacy settings parse");
        assert!(parsed.update_check_enabled);
        assert_eq!(parsed.last_update_check_at, None);
        assert_eq!(parsed.dismissed_update_version, None);

        // Explicit values survive round-trip via camelCase keys.
        let json = serde_json::json!({
            "updateCheckEnabled": false,
            "lastUpdateCheckAt": 1234567890_u64,
            "dismissedUpdateVersion": "0.260601.0"
        });
        let parsed: Settings = serde_json::from_value(json).expect("explicit settings parse");
        assert!(!parsed.update_check_enabled);
        assert_eq!(parsed.last_update_check_at, Some(1234567890));
        assert_eq!(parsed.dismissed_update_version.as_deref(), Some("0.260601.0"));
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
