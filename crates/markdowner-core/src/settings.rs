use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize};

use crate::EditorMode;

pub const DEFAULT_AI_MODEL: &str = "upstage/solar-pro4";
pub const AI_MODEL_DEFAULTS_VERSION: u32 = 1;

fn legacy_ai_model_defaults_version() -> u32 {
    0
}

fn deserialize_bool_or_false<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(value.as_bool().unwrap_or(false))
}

fn deserialize_bool_or_true<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(value.as_bool().unwrap_or(true))
}

fn default_ai_translation_target_language() -> String {
    sys_locale::get_locale()
        .filter(|locale| locale.to_ascii_lowercase().starts_with("ko"))
        .map(|_| "ko".to_string())
        .unwrap_or_else(|| "en".to_string())
}

fn normalize_ai_model(value: serde_json::Value) -> String {
    value
        .as_str()
        .map(str::trim)
        .filter(|candidate| {
            !candidate.is_empty()
                && candidate.len() <= 256
                && candidate.contains('/')
                && !candidate.chars().any(char::is_whitespace)
        })
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| DEFAULT_AI_MODEL.to_string())
}

fn deserialize_ai_model<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(normalize_ai_model(value))
}

fn normalize_target_language(value: serde_json::Value) -> String {
    value
        .as_str()
        .map(str::trim)
        .filter(|candidate| {
            !candidate.is_empty()
                && candidate.len() <= 64
                && candidate
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
        .map(ToOwned::to_owned)
        .unwrap_or_else(default_ai_translation_target_language)
}

fn deserialize_target_language<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(normalize_target_language(value))
}

fn normalize_summary_target_language(value: serde_json::Value) -> String {
    value
        .as_str()
        .map(str::trim)
        .filter(|candidate| {
            !candidate.is_empty()
                && candidate.len() <= 64
                && candidate
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "source".to_string())
}

fn deserialize_summary_target_language<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(normalize_summary_target_language(value))
}

fn deserialize_ai_default_scope<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(match value.as_str() {
        Some("workspace") => "workspace".to_string(),
        _ => "document".to_string(),
    })
}

fn normalize_hex_color(value: serde_json::Value, fallback: &str) -> String {
    value
        .as_str()
        .filter(|candidate| {
            candidate.len() == 7
                && candidate.starts_with('#')
                && candidate[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
        })
        .map(str::to_ascii_uppercase)
        .unwrap_or_else(|| fallback.to_string())
}

macro_rules! hex_color_deserializer {
    ($name:ident, $fallback:literal) => {
        fn $name<'de, D>(deserializer: D) -> Result<String, D::Error>
        where
            D: Deserializer<'de>,
        {
            let value = serde_json::Value::deserialize(deserializer)?;
            Ok(normalize_hex_color(value, $fallback))
        }
    };
}

hex_color_deserializer!(deserialize_zinc_950, "#18181B");
hex_color_deserializer!(deserialize_zinc_100, "#F4F4F5");
hex_color_deserializer!(deserialize_zinc_50, "#FAFAFA");
hex_color_deserializer!(deserialize_zinc_800, "#27272A");

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LocalAgentExecutablePaths {
    pub claude: String,
    pub codex: String,
    pub opencode: String,
}

fn deserialize_local_agent_executable_paths<'de, D>(
    deserializer: D,
) -> Result<LocalAgentExecutablePaths, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    let Some(entries) = value.as_object() else {
        return Ok(LocalAgentExecutablePaths::default());
    };
    let string_entry = |key: &str| {
        entries
            .get(key)
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    Ok(LocalAgentExecutablePaths {
        claude: string_entry("claude"),
        codex: string_entry("codex"),
        opencode: string_entry("opencode"),
    })
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
    /// Highlight known Claude Code / Codex skill tokens (`/name`, `$name`)
    /// like inline code in both editors.
    #[serde(deserialize_with = "deserialize_bool_or_true")]
    pub highlight_skill_tokens: bool,
    #[serde(deserialize_with = "deserialize_zinc_950")]
    pub skill_token_light_text_color: String,
    #[serde(deserialize_with = "deserialize_zinc_100")]
    pub skill_token_light_background_color: String,
    #[serde(deserialize_with = "deserialize_zinc_50")]
    pub skill_token_dark_text_color: String,
    #[serde(deserialize_with = "deserialize_zinc_800")]
    pub skill_token_dark_background_color: String,
    #[serde(deserialize_with = "deserialize_zinc_950")]
    pub inline_code_light_text_color: String,
    #[serde(deserialize_with = "deserialize_zinc_100")]
    pub inline_code_light_background_color: String,
    #[serde(deserialize_with = "deserialize_zinc_50")]
    pub inline_code_dark_text_color: String,
    #[serde(deserialize_with = "deserialize_zinc_800")]
    pub inline_code_dark_background_color: String,
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
    #[serde(default = "legacy_ai_model_defaults_version")]
    pub ai_model_defaults_version: u32,
    #[serde(deserialize_with = "deserialize_ai_model")]
    pub ai_prd_model: String,
    #[serde(deserialize_with = "deserialize_ai_model")]
    pub ai_summary_model: String,
    #[serde(deserialize_with = "deserialize_ai_model")]
    pub ai_translation_model: String,
    #[serde(deserialize_with = "deserialize_ai_model")]
    pub ai_custom_prompt_model: String,
    #[serde(deserialize_with = "deserialize_summary_target_language")]
    pub ai_summary_target_language: String,
    #[serde(deserialize_with = "deserialize_target_language")]
    pub ai_translation_target_language: String,
    #[serde(deserialize_with = "deserialize_bool_or_true")]
    pub ai_zdr_only: bool,
    #[serde(deserialize_with = "deserialize_bool_or_false")]
    pub ai_cloud_disclosure_accepted: bool,
    #[serde(deserialize_with = "deserialize_bool_or_false")]
    pub local_agent_disclosure_accepted: bool,
    #[serde(deserialize_with = "deserialize_local_agent_executable_paths")]
    pub local_agent_executable_paths: LocalAgentExecutablePaths,
    #[serde(deserialize_with = "deserialize_ai_default_scope")]
    pub ai_default_scope: String,
    #[serde(deserialize_with = "deserialize_bool_or_true")]
    pub ai_history_enabled: bool,
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
            highlight_skill_tokens: true,
            skill_token_light_text_color: "#18181B".to_string(),
            skill_token_light_background_color: "#F4F4F5".to_string(),
            skill_token_dark_text_color: "#FAFAFA".to_string(),
            skill_token_dark_background_color: "#27272A".to_string(),
            inline_code_light_text_color: "#18181B".to_string(),
            inline_code_light_background_color: "#F4F4F5".to_string(),
            inline_code_dark_text_color: "#FAFAFA".to_string(),
            inline_code_dark_background_color: "#27272A".to_string(),
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
            ai_model_defaults_version: AI_MODEL_DEFAULTS_VERSION,
            ai_prd_model: DEFAULT_AI_MODEL.to_string(),
            ai_summary_model: DEFAULT_AI_MODEL.to_string(),
            ai_translation_model: DEFAULT_AI_MODEL.to_string(),
            ai_custom_prompt_model: DEFAULT_AI_MODEL.to_string(),
            ai_summary_target_language: "source".to_string(),
            ai_translation_target_language: default_ai_translation_target_language(),
            ai_zdr_only: true,
            ai_cloud_disclosure_accepted: false,
            local_agent_disclosure_accepted: false,
            local_agent_executable_paths: LocalAgentExecutablePaths::default(),
            ai_default_scope: "document".to_string(),
            ai_history_enabled: true,
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
        let malformed = r#"{"autoSave":true,"editorFontSize":18,"wysiwygCodeBlockWrap":"true"}"#;
        let parsed: Settings =
            serde_json::from_str(malformed).expect("malformed wrap value should still parse");

        assert!(!parsed.wysiwyg_code_block_wrap);
        assert!(parsed.auto_save);
        assert_eq!(parsed.editor_font_size, 18);
    }

    #[test]
    fn highlight_skill_tokens_defaults_on_and_round_trips() {
        let legacy = r#"{"autoSave":true,"editorLineWrap":true}"#;
        let parsed: Settings = serde_json::from_str(legacy).expect("legacy settings parse");
        assert!(
            parsed.highlight_skill_tokens,
            "missing highlightSkillTokens should default to true"
        );

        for expected in [true, false] {
            let json = serde_json::json!({ "highlightSkillTokens": expected });
            let parsed: Settings = serde_json::from_value(json).expect("highlight setting parse");
            assert_eq!(parsed.highlight_skill_tokens, expected);
            let value = serde_json::to_value(parsed).expect("serialize settings");
            assert_eq!(value["highlightSkillTokens"], expected);
        }
    }

    #[test]
    fn highlight_skill_tokens_malformed_value_defaults_field_only() {
        let malformed = r#"{"autoSave":true,"editorFontSize":18,"highlightSkillTokens":"false"}"#;
        let parsed: Settings =
            serde_json::from_str(malformed).expect("malformed highlight value should still parse");

        assert!(parsed.highlight_skill_tokens);
        assert!(parsed.auto_save);
        assert_eq!(parsed.editor_font_size, 18);
    }

    #[test]
    fn inline_style_colors_default_validate_and_round_trip() {
        let parsed: Settings = serde_json::from_str("{}").expect("settings parse");
        assert_eq!(parsed.skill_token_light_text_color, "#18181B");
        assert_eq!(parsed.skill_token_light_background_color, "#F4F4F5");
        assert_eq!(parsed.skill_token_dark_text_color, "#FAFAFA");
        assert_eq!(parsed.skill_token_dark_background_color, "#27272A");
        assert_eq!(parsed.inline_code_light_text_color, "#18181B");
        assert_eq!(parsed.inline_code_light_background_color, "#F4F4F5");
        assert_eq!(parsed.inline_code_dark_text_color, "#FAFAFA");
        assert_eq!(parsed.inline_code_dark_background_color, "#27272A");

        let malformed = serde_json::json!({
            "autoSave": true,
            "skillTokenLightTextColor": "orange",
            "skillTokenLightBackgroundColor": "#aabbcc",
            "inlineCodeDarkTextColor": "#123456",
            "inlineCodeDarkBackgroundColor": "#fff"
        });
        let parsed: Settings =
            serde_json::from_value(malformed).expect("malformed colors should default by field");
        assert!(parsed.auto_save);
        assert_eq!(parsed.skill_token_light_text_color, "#18181B");
        assert_eq!(parsed.skill_token_light_background_color, "#AABBCC");
        assert_eq!(parsed.inline_code_dark_text_color, "#123456");
        assert_eq!(parsed.inline_code_dark_background_color, "#27272A");

        let serialized = serde_json::to_value(parsed).expect("settings serialize");
        assert_eq!(serialized["skillTokenLightBackgroundColor"], "#AABBCC");
        assert_eq!(serialized["inlineCodeDarkTextColor"], "#123456");
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
    fn legacy_analytics_preference_is_dropped_on_save() {
        let legacy = r#"{"autoSave":true,"analyticsEnabled":false}"#;
        let parsed: Settings = serde_json::from_str(legacy).expect("legacy settings parse");
        let payload = serde_json::to_string(&parsed).expect("serialize");

        assert!(!payload.contains("analyticsEnabled"));
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
        assert_eq!(
            value["ignoreList"],
            serde_json::json!([".diffs", ".claude"])
        );
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

    #[test]
    fn ai_settings_default_and_recover_malformed_fields_independently() {
        let parsed: Settings = serde_json::from_value(serde_json::json!({
            "autoSave": true,
            "aiPrdModel": 7,
            "aiSummaryModel": 42,
            "aiTranslationModel": "",
            "aiCustomPromptModel": "vendor/model",
            "aiSummaryTargetLanguage": false,
            "aiTranslationTargetLanguage": false,
            "aiZdrOnly": "yes",
            "aiCloudDisclosureAccepted": true,
            "aiDefaultScope": "invalid",
            "aiHistoryEnabled": "no"
        }))
        .expect("settings parse");

        assert_eq!(parsed.ai_model_defaults_version, 0);
        assert_eq!(parsed.ai_prd_model, "upstage/solar-pro4");
        assert_eq!(parsed.ai_summary_model, "upstage/solar-pro4");
        assert_eq!(parsed.ai_translation_model, "upstage/solar-pro4");
        assert_eq!(parsed.ai_custom_prompt_model, "vendor/model");
        assert_eq!(parsed.ai_summary_target_language, "source");
        assert_eq!(parsed.ai_translation_target_language, "en");
        assert!(parsed.ai_zdr_only);
        assert!(parsed.ai_cloud_disclosure_accepted);
        assert_eq!(parsed.ai_default_scope, "document");
        assert!(parsed.ai_history_enabled);
        assert!(parsed.auto_save);

        let serialized = serde_json::to_value(parsed).expect("settings serialize");
        assert_eq!(serialized["aiModelDefaultsVersion"], 0);
        assert_eq!(serialized["aiPrdModel"], "upstage/solar-pro4");
        assert_eq!(serialized["aiSummaryModel"], "upstage/solar-pro4");
        assert_eq!(serialized["aiTranslationModel"], "upstage/solar-pro4");
        assert_eq!(serialized["aiCustomPromptModel"], "vendor/model");
        assert_eq!(serialized["aiSummaryTargetLanguage"], "source");
        assert_eq!(serialized["aiTranslationTargetLanguage"], "en");
        assert_eq!(serialized["aiZdrOnly"], true);
        assert_eq!(serialized["aiCloudDisclosureAccepted"], true);
        assert_eq!(serialized["aiDefaultScope"], "document");
        assert_eq!(serialized["aiHistoryEnabled"], true);
    }

    #[test]
    fn new_ai_defaults_use_solar_while_legacy_version_is_zero() {
        let defaults = Settings::default();
        assert_eq!(defaults.ai_model_defaults_version, 1);
        assert_eq!(defaults.ai_prd_model, "upstage/solar-pro4");
        assert_eq!(defaults.ai_summary_model, "upstage/solar-pro4");
        assert_eq!(defaults.ai_translation_model, "upstage/solar-pro4");
        assert_eq!(defaults.ai_custom_prompt_model, "upstage/solar-pro4");

        let legacy: Settings = serde_json::from_str(
            r#"{"aiPrdModel":"z-ai/glm-5.2","aiCustomPromptModel":"vendor/custom"}"#,
        )
        .expect("legacy settings parse");
        assert_eq!(legacy.ai_model_defaults_version, 0);
        assert_eq!(legacy.ai_prd_model, "z-ai/glm-5.2");
        assert_eq!(legacy.ai_custom_prompt_model, "vendor/custom");
    }

    #[test]
    fn local_agent_disclosure_defaults_false_and_round_trips_independently() {
        let legacy: Settings = serde_json::from_value(serde_json::json!({
            "aiCloudDisclosureAccepted": true
        }))
        .expect("legacy settings parse");
        assert!(legacy.ai_cloud_disclosure_accepted);
        assert!(!legacy.local_agent_disclosure_accepted);

        let parsed: Settings = serde_json::from_value(serde_json::json!({
            "aiCloudDisclosureAccepted": false,
            "localAgentDisclosureAccepted": true
        }))
        .expect("settings parse");
        assert!(!parsed.ai_cloud_disclosure_accepted);
        assert!(parsed.local_agent_disclosure_accepted);

        let serialized = serde_json::to_value(parsed).expect("settings serialize");
        assert_eq!(serialized["localAgentDisclosureAccepted"], true);
        assert_eq!(serialized["aiCloudDisclosureAccepted"], false);

        let malformed: Settings = serde_json::from_value(serde_json::json!({
            "localAgentDisclosureAccepted": "true"
        }))
        .expect("malformed setting parse");
        assert!(!malformed.local_agent_disclosure_accepted);
    }

    #[test]
    fn local_agent_executable_paths_default_and_normalize_each_entry() {
        let legacy: Settings = serde_json::from_value(serde_json::json!({
            "autoSave": true
        }))
        .expect("legacy settings parse");
        assert!(legacy.auto_save);
        assert_eq!(legacy.local_agent_executable_paths.claude, "");
        assert_eq!(legacy.local_agent_executable_paths.codex, "");
        assert_eq!(legacy.local_agent_executable_paths.opencode, "");

        let partial: Settings = serde_json::from_value(serde_json::json!({
            "autoSave": true,
            "localAgentExecutablePaths": {
                "claude": "/opt/homebrew/bin/claude",
                "opencode": 42
            }
        }))
        .expect("partial settings parse");
        assert!(partial.auto_save);
        assert_eq!(
            partial.local_agent_executable_paths.claude,
            "/opt/homebrew/bin/claude"
        );
        assert_eq!(partial.local_agent_executable_paths.codex, "");
        assert_eq!(partial.local_agent_executable_paths.opencode, "");

        let malformed: Settings = serde_json::from_value(serde_json::json!({
            "autoSave": true,
            "localAgentExecutablePaths": "not-an-object"
        }))
        .expect("malformed path object should not discard other settings");
        assert!(malformed.auto_save);
        assert_eq!(malformed.local_agent_executable_paths.claude, "");

        let serialized = serde_json::to_value(partial).expect("settings serialize");
        assert_eq!(
            serialized["localAgentExecutablePaths"]["claude"],
            "/opt/homebrew/bin/claude"
        );
        assert_eq!(serialized["localAgentExecutablePaths"]["codex"], "");
        assert_eq!(serialized["localAgentExecutablePaths"]["opencode"], "");
    }
}
