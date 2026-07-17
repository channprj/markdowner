use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize};

use crate::EditorMode;

fn deserialize_bool_or_false<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(value.as_bool().unwrap_or(false))
}

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
    pub editor_show_wrap_line: bool,
    pub editor_word_break_keep_all: bool,
    #[serde(deserialize_with = "deserialize_bool_or_false")]
    pub wysiwyg_code_block_wrap: bool,
    pub outline_font_size: u32,
    pub outline_row_spacing: u32,
    pub default_mode: EditorMode,
    pub focus_mode_enabled: bool,
    pub typewriter_mode_enabled: bool,
    pub asset_folder: String,
    pub theme_follow_system: bool,
    pub pdf_paper_size: String,
    pub pdf_paper_orientation: String,
    pub pdf_paper_width_mm: f64,
    pub pdf_paper_height_mm: f64,
    pub diagnostics_enabled: bool,
    /// Opt-in (default on) sharing of anonymous, content-free usage analytics.
    pub analytics_enabled: bool,
    pub show_minimap: bool,
    pub table_density: String,
    pub table_view_mode: String,
    pub code_block_highlight: bool,
    pub code_block_theme: String,
    pub code_block_theme_sync: bool,
    pub terminal_font_family: String,
    pub terminal_font_size: u32,
    pub terminal_default_path: String,
    pub terminal_start_location: String,
    pub update_check_enabled: bool,
    pub last_update_check_at: Option<u64>,
    pub dismissed_update_version: Option<String>,
    /// One-time "make Markdowner the default .md app?" prompt was shown.
    pub default_app_prompt_seen: bool,
    /// Keymap overrides: command id → shortcut descriptor (e.g. "mod+shift+f").
    /// Commands without an entry keep their built-in default binding.
    pub keybinding_overrides: BTreeMap<String, String>,
    /// Folder names hidden from the workspace file tree (matched by exact
    /// basename, anywhere in the tree). `.git` is always hidden regardless.
    pub ignore_list: Vec<String>,
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
            editor_show_wrap_line: true,
            editor_word_break_keep_all: true,
            wysiwyg_code_block_wrap: false,
            outline_font_size: 12,
            outline_row_spacing: 0,
            default_mode: EditorMode::Wysiwyg,
            focus_mode_enabled: false,
            typewriter_mode_enabled: false,
            asset_folder: "assets".to_string(),
            theme_follow_system: true,
            pdf_paper_size: "A4".to_string(),
            pdf_paper_orientation: "portrait".to_string(),
            pdf_paper_width_mm: 210.0,
            pdf_paper_height_mm: 297.0,
            diagnostics_enabled: true,
            analytics_enabled: true,
            show_minimap: true,
            table_density: "compact".to_string(),
            table_view_mode: "normal".to_string(),
            code_block_highlight: true,
            code_block_theme: "one-dark".to_string(),
            code_block_theme_sync: true,
            terminal_font_family: String::new(),
            terminal_font_size: 13,
            terminal_default_path: String::new(),
            terminal_start_location: "document".to_string(),
            update_check_enabled: true,
            last_update_check_at: None,
            dismissed_update_version: None,
            default_app_prompt_seen: false,
            keybinding_overrides: BTreeMap::new(),
            ignore_list: crate::storage::default_ignore_list(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Settings;

    #[test]
    fn legacy_pdf_paper_settings_default_orientation_and_custom_dimensions() {
        let parsed: Settings =
            serde_json::from_str(r#"{"pdfPaperSize":"Letter"}"#).expect("settings parse");
        assert_eq!(parsed.pdf_paper_size, "Letter");
        assert_eq!(parsed.pdf_paper_orientation, "portrait");
        assert_eq!(parsed.pdf_paper_width_mm, 210.0);
        assert_eq!(parsed.pdf_paper_height_mm, 297.0);
    }

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
    fn keybinding_overrides_default_empty_and_round_trip() {
        let legacy = r#"{"autoSave":true}"#;
        let parsed: Settings = serde_json::from_str(legacy).expect("legacy settings parse");
        assert!(parsed.keybinding_overrides.is_empty());

        let json = serde_json::json!({
            "keybindingOverrides": { "file.newDocument": "mod+shift+n" }
        });
        let parsed: Settings = serde_json::from_value(json).expect("override settings parse");
        assert_eq!(
            parsed
                .keybinding_overrides
                .get("file.newDocument")
                .map(String::as_str),
            Some("mod+shift+n")
        );
        let serialized = serde_json::to_value(&parsed).expect("settings serialize");
        assert_eq!(
            serialized["keybindingOverrides"]["file.newDocument"],
            "mod+shift+n"
        );
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
        assert_eq!(
            parsed.dismissed_update_version.as_deref(),
            Some("0.260601.0")
        );
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
    fn show_wrap_line_defaults_to_enabled_and_round_trips() {
        // Legacy settings.json (pre-wrap-line) loads with the guide line ON.
        let legacy = r#"{"autoSave":true,"editorWrapColumn":100}"#;
        let parsed: Settings = serde_json::from_str(legacy).expect("legacy settings parse");
        assert!(
            parsed.editor_show_wrap_line,
            "missing editorShowWrapLine should default to true"
        );
        assert_eq!(parsed.editor_wrap_column, 100);

        // Explicit false survives round-trip via the camelCase key.
        let original = Settings {
            editor_show_wrap_line: false,
            ..Default::default()
        };
        let payload = serde_json::to_string(&original).expect("serialize");
        assert!(payload.contains("\"editorShowWrapLine\":false"));
        let parsed: Settings = serde_json::from_str(&payload).expect("parse");
        assert!(!parsed.editor_show_wrap_line);
    }

    #[test]
    fn wysiwyg_code_block_wrap_defaults_off_and_round_trips() {
        let legacy = r#"{"autoSave":true,"editorLineWrap":true}"#;
        let parsed: Settings = serde_json::from_str(legacy).expect("legacy settings parse");
        assert!(
            !parsed.wysiwyg_code_block_wrap,
            "missing wysiwygCodeBlockWrap should default to false"
        );

        for expected in [true, false] {
            let json = serde_json::json!({ "wysiwygCodeBlockWrap": expected });
            let parsed: Settings = serde_json::from_value(json).expect("wrap setting parse");
            assert_eq!(parsed.wysiwyg_code_block_wrap, expected);
            let value = serde_json::to_value(parsed).expect("serialize settings");
            assert_eq!(value["wysiwygCodeBlockWrap"], expected);
        }
    }

    #[test]
    fn wysiwyg_code_block_wrap_malformed_value_defaults_field_only() {
        let malformed =
            r#"{"autoSave":true,"editorFontSize":18,"wysiwygCodeBlockWrap":"true"}"#;
        let parsed: Settings =
            serde_json::from_str(malformed).expect("malformed wrap value should still parse");

        assert!(!parsed.wysiwyg_code_block_wrap);
        assert!(parsed.auto_save);
        assert_eq!(parsed.editor_font_size, 18);
    }

    #[test]
    fn word_break_keep_all_defaults_to_enabled_and_round_trips() {
        // Legacy settings.json (pre-word-break option) loads with keep-all ON.
        let legacy = r#"{"autoSave":true,"editorLineWrap":true}"#;
        let parsed: Settings = serde_json::from_str(legacy).expect("legacy settings parse");
        assert!(
            parsed.editor_word_break_keep_all,
            "missing editorWordBreakKeepAll should default to true"
        );

        // Explicit false survives round-trip via the camelCase key.
        let original = Settings {
            editor_word_break_keep_all: false,
            ..Default::default()
        };
        let payload = serde_json::to_string(&original).expect("serialize");
        assert!(payload.contains("\"editorWordBreakKeepAll\":false"));
        let parsed: Settings = serde_json::from_str(&payload).expect("parse");
        assert!(!parsed.editor_word_break_keep_all);
    }

    #[test]
    fn table_view_mode_defaults_to_normal_and_round_trips() {
        // Legacy settings.json (pre-table-view) loads as the normal layout.
        let legacy = r#"{"tableDensity":"normal"}"#;
        let parsed: Settings = serde_json::from_str(legacy).expect("legacy settings parse");
        assert_eq!(parsed.table_view_mode, "normal");

        // Explicit value survives a camelCase round-trip.
        let json = serde_json::json!({ "tableViewMode": "inline" });
        let parsed: Settings = serde_json::from_value(json).expect("explicit settings parse");
        assert_eq!(parsed.table_view_mode, "inline");
        let value = serde_json::to_value(parsed).expect("serialize settings");
        assert_eq!(value["tableViewMode"], "inline");
    }

    #[test]
    fn show_minimap_defaults_to_enabled_and_round_trips() {
        // Legacy settings.json (pre-minimap) loads with the minimap ON.
        let legacy = r#"{"autoSave":true,"editorFontSize":16}"#;
        let parsed: Settings = serde_json::from_str(legacy).expect("legacy settings parse");
        assert!(
            parsed.show_minimap,
            "missing showMinimap should default to true"
        );

        // Explicit false survives round-trip via the camelCase key.
        let original = Settings {
            show_minimap: false,
            ..Default::default()
        };
        let payload = serde_json::to_string(&original).expect("serialize");
        assert!(payload.contains("\"showMinimap\":false"));
        let parsed: Settings = serde_json::from_str(&payload).expect("parse");
        assert!(!parsed.show_minimap);
    }

    #[test]
    fn diagnostics_logging_defaults_to_enabled_and_round_trips() {
        // Legacy settings.json (pre-diagnostics) loads with diagnostics logging ON.
        let legacy = r#"{"autoSave":true,"editorFontSize":16}"#;
        let parsed: Settings = serde_json::from_str(legacy).expect("legacy settings parse");
        assert!(
            parsed.diagnostics_enabled,
            "missing diagnosticsEnabled should default to true"
        );

        // Explicit false survives round-trip via the camelCase key.
        let original = Settings {
            diagnostics_enabled: false,
            ..Default::default()
        };
        let payload = serde_json::to_string(&original).expect("serialize");
        assert!(payload.contains("\"diagnosticsEnabled\":false"));
        let parsed: Settings = serde_json::from_str(&payload).expect("parse");
        assert!(!parsed.diagnostics_enabled);
    }

    #[test]
    fn analytics_enabled_defaults_to_enabled_and_round_trips() {
        // Legacy settings.json (pre-analytics) loads with analytics opted in.
        let legacy = r#"{"autoSave":true,"editorFontSize":16}"#;
        let parsed: Settings = serde_json::from_str(legacy).expect("legacy settings parse");
        assert!(
            parsed.analytics_enabled,
            "missing analyticsEnabled should default to true"
        );

        // Explicit false survives round-trip via the camelCase key.
        let original = Settings {
            analytics_enabled: false,
            ..Default::default()
        };
        let payload = serde_json::to_string(&original).expect("serialize");
        assert!(payload.contains("\"analyticsEnabled\":false"));
        let parsed: Settings = serde_json::from_str(&payload).expect("parse");
        assert!(!parsed.analytics_enabled);
    }

    #[test]
    fn default_app_prompt_seen_defaults_to_false_and_round_trips() {
        // Legacy settings.json (pre-default-app prompt) must load as unseen so
        // the one-time prompt shows on the next launch.
        let legacy = r#"{"autoSave":true,"editorFontSize":16}"#;
        let parsed: Settings = serde_json::from_str(legacy).expect("legacy settings parse");
        assert!(
            !parsed.default_app_prompt_seen,
            "missing defaultAppPromptSeen should default to false"
        );

        // Explicit true survives round-trip via the camelCase key.
        let original = Settings {
            default_app_prompt_seen: true,
            ..Default::default()
        };
        let payload = serde_json::to_string(&original).expect("serialize");
        assert!(payload.contains("\"defaultAppPromptSeen\":true"));
        let parsed: Settings = serde_json::from_str(&payload).expect("parse");
        assert!(parsed.default_app_prompt_seen);
    }

    #[test]
    fn ignore_list_defaults_when_absent_and_round_trips() {
        // Legacy settings.json (pre-ignore-list) loads with the recommended defaults.
        let legacy = r#"{"autoSave":true,"editorFontSize":16}"#;
        let parsed: Settings = serde_json::from_str(legacy).expect("legacy settings parse");
        assert_eq!(parsed.ignore_list, crate::storage::default_ignore_list());
        assert!(parsed.ignore_list.iter().any(|name| name == "node_modules"));

        // Explicit list survives round-trip via the camelCase key.
        let json = serde_json::json!({ "ignoreList": [".diffs", ".claude"] });
        let parsed: Settings = serde_json::from_value(json).expect("explicit settings parse");
        assert_eq!(parsed.ignore_list, vec![".diffs", ".claude"]);
        let value = serde_json::to_value(&parsed).expect("serialize settings");
        assert_eq!(value["ignoreList"], serde_json::json!([".diffs", ".claude"]));
    }

    #[test]
    fn terminal_preferences_default_and_round_trip() {
        let legacy = r#"{"autoSave":true,"editorFontSize":16}"#;
        let parsed: Settings = serde_json::from_str(legacy).expect("legacy settings parse");
        assert_eq!(parsed.terminal_font_family, "");
        assert_eq!(parsed.terminal_font_size, 13);
        assert_eq!(parsed.terminal_default_path, "");
        assert_eq!(parsed.terminal_start_location, "document");

        let json = serde_json::json!({
            "terminalFontFamily": "JetBrains Mono",
            "terminalFontSize": 16_u32,
            "terminalDefaultPath": "/tmp/project",
            "terminalStartLocation": "workspace"
        });
        let parsed: Settings = serde_json::from_value(json).expect("terminal settings parse");
        assert_eq!(parsed.terminal_font_family, "JetBrains Mono");
        assert_eq!(parsed.terminal_font_size, 16);
        assert_eq!(parsed.terminal_default_path, "/tmp/project");
        assert_eq!(parsed.terminal_start_location, "workspace");

        let value = serde_json::to_value(&parsed).expect("serialize settings");
        assert_eq!(value["terminalFontFamily"], "JetBrains Mono");
        assert_eq!(value["terminalFontSize"], 16);
        assert_eq!(value["terminalDefaultPath"], "/tmp/project");
        assert_eq!(value["terminalStartLocation"], "workspace");
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
