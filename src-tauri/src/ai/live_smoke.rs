//! Opt-in end-to-end checks. Only synthetic documents leave this process;
//! credentials stay in Keychain and normal account/ZDR policies remain active.
use super::*;
use serde_json::{Value, json};

#[tokio::test]
#[ignore = "Uses the configured OpenRouter account; set MARKDOWNER_LIVE_AI_MODEL explicitly"]
async fn configured_provider_validates_synthetic_tasks_and_interview() {
    let model = std::env::var("MARKDOWNER_LIVE_AI_MODEL").expect("Choose the model explicitly");
    let secret = KeychainService::system().read_secret().expect("Configured Keychain credential required");
    let client = OpenRouterClient::new().unwrap();
    client.list_models(&secret).await.unwrap();
    for (task, selection) in [(AiTask::Summary, false), (AiTask::Custom, true),
        (AiTask::Prd, false), (AiTask::Translation, false)] {
        let selected = "The app helps writers organize notes.";
        let source = if selection {
            format!("{}\n{selected}\nUntouched suffix.", "Unselected synthetic context.\n".repeat(3_000))
        } else { "# Notes app\n\nThe app helps writers organize notes.\n\nUsers can search their notes and export Markdown files.".to_string() };
        let start = source.find(selected).unwrap();
        let request: AiRunRequest = serde_json::from_value(json!({
            "requestId":"live-synthetic", "documentId":"synthetic-only", "source":source,
            "selection":if selection { json!({"start":start,"end":start+selected.len()}) } else { Value::Null },
            "task":task,"model":model,"zdrOnly":true,"maxOutputTokens":4096,
            "targetLanguage":if task == AiTask::Translation { Some("ko") } else { None },
            "instruction":if selection {"Rewrite the selected sentence more concisely."} else {"Keep the answer concise."},
            "recordHistory":false
        })).unwrap();
        let envelope = prepare_run_envelope(&request).unwrap();
        let mut received = 0;
        let outcome = bounded_completion(&client, &request, &envelope, &secret,
            &CancellationToken::new(), empty_completion_outcome(), |chars, _, _, _| received = chars).await.unwrap();
        assert!(outcome.result.is_some(), "{task:?}: {:?}", outcome.validation_issues);
        assert!(received > 0, "{task:?} emitted no progress");
        eprintln!("Live {task:?}: validated, streamed {received} characters, usage {:?}", outcome.usage);
    }
    let request = PrdInterviewCompletionRequest {
        model, document: json!({"source":"A Markdown notes app for writers. Supports search and export."}),
        interview_history: json!([]), instruction: Some("Ask one concise question.".to_string()),
        system_prompt: None, zdr_only:true, max_output_tokens:4096,
    };
    let turn = bounded_interview_turn(&client, request, &secret, &CancellationToken::new(), |_, _, _, _| {}).await.unwrap();
    assert!(!turn.question.trim().is_empty());
    eprintln!("Live PRD interview: validated question received");
}
