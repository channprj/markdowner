use std::sync::{Arc, Mutex};

use serde_json::{Value, json};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
use tokio_util::sync::CancellationToken;

use super::*;

async fn provider(
    first_failure: &str,
) -> (
    OpenRouterClient,
    Arc<Mutex<Vec<Value>>>,
    tokio::task::JoinHandle<()>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let client =
        OpenRouterClient::with_base_url(&format!("http://{}", listener.local_addr().unwrap()))
            .unwrap();
    let captured = Arc::new(Mutex::new(Vec::new()));
    let requests = captured.clone();
    let first_failure = first_failure.to_string();
    let task = tokio::spawn(async move {
        loop {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0; 4096];
            let body = loop {
                let count = socket.read(&mut buffer).await.unwrap();
                if count == 0 {
                    return;
                }
                bytes.extend_from_slice(&buffer[..count]);
                if let Some(end) = bytes.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..end]).to_ascii_lowercase();
                    let length = headers
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length:"))
                        .unwrap()
                        .trim()
                        .parse::<usize>()
                        .unwrap();
                    if bytes.len() >= end + 4 + length {
                        break serde_json::from_slice::<Value>(&bytes[end + 4..end + 4 + length])
                            .unwrap();
                    }
                }
            };
            let first = requests.lock().unwrap().is_empty();
            requests.lock().unwrap().push(body.clone());
            let interview = body["response_format"]["json_schema"]["name"] == "prd_interview_question";
            let oversized_interview = first_failure == "interview" && interview
                && body["messages"][1]["content"].as_str().unwrap().len() > 3_000;
            let (status, content_type, response) = if (first && first_failure == "context") || oversized_interview {
                (
                    400,
                    "application/json",
                    json!({"error":{"message":"Maximum context length exceeded"}}).to_string(),
                )
            } else if first_failure == "billing" {
                (
                    402,
                    "application/json",
                    json!({"error":{"message":"Insufficient credits for max_tokens"}}).to_string(),
                )
            } else {
                let truncated = first && first_failure == "truncated";
                let content = if truncated {
                    "{\"schemaVersion\":".to_string()
                } else if interview {
                    json!({"question":"Which accessibility requirement is highest priority?",
                        "rationale":"This decision remains unresolved.","recommendedAnswer":"Keyboard navigation."}).to_string()
                } else {
                    let mut response = echo_edit(&body);
                    if first_failure == "interview" {
                        response["summaryMarkdown"] = json!("# PRD context\n\nThe primary users are product managers. Preserve accessibility requirements and existing resolved decisions.");
                    }
                    if first_failure == "unsafe" {
                        let first = response["replacements"].as_object_mut().unwrap()
                            .values_mut().next().unwrap();
                        *first = json!(format!("<script>{}", first.as_str().unwrap()));
                    }
                    response.to_string()
                };
                let event = json!({"choices":[{"delta":{"content":content},"finish_reason":if truncated {"length"} else {"stop"}}],
                    "usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30,"cost":0.01}});
                (
                    200,
                    "text/event-stream",
                    format!("data: {event}\n\ndata: [DONE]\n\n"),
                )
            };
            let response = format!(
                "HTTP/1.1 {status} OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}",
                response.len()
            );
            let _ = socket.write_all(response.as_bytes()).await;
        }
    });
    (client, captured, task)
}

#[tokio::test]
async fn long_interview_reads_every_document_part_and_prior_answer_before_asking() {
    let source = request(AiTask::Prd, false).source;
    let request = PrdInterviewCompletionRequest {
        model: "test/model".to_string(), document: json!({"source":source}),
        interview_history: json!([{"question":"Already decided primary user?","answer":"Product managers."}]),
        instruction: None, system_prompt: Some("Ask about accessibility.".to_string()),
        zdr_only: true, max_output_tokens: 1024,
    };
    let (client, requests, server) = provider("interview").await;
    let mut progress = Vec::new();
    let turn = bounded_interview_turn(&client, request, "test-key", &CancellationToken::new(),
        |_, completed, total, label| progress.push((completed, total, label.to_string()))).await.unwrap();
    server.abort();
    assert!(turn.question.contains("accessibility"));
    let requests = requests.lock().unwrap();
    let summaries = requests.iter().filter(|body| body["response_format"]["json_schema"]["name"] == "markdown_summary")
        .map(|body| body["messages"][1]["content"].as_str().unwrap()).collect::<String>();
    assert_eq!(summaries.matches("Old wording").count(), 160);
    assert!(summaries.contains("Already decided primary user?"));
    assert!(summaries.contains("Product managers."));
    assert!(progress.iter().any(|(_, total, _)| *total > 1));
    assert!(requests.last().unwrap()["messages"][0]["content"].as_str().unwrap().contains("Ask about accessibility."));
}

fn echo_edit(body: &Value) -> Value {
    let user = body["messages"][1]["content"].as_str().unwrap();
    let document: Value = serde_json::from_str(
        user.split_once("<document_data>\n")
            .unwrap()
            .1
            .split_once("\n</document_data>")
            .unwrap()
            .0,
    )
    .unwrap();
    let schema = body["response_format"]["json_schema"]["name"]
        .as_str()
        .unwrap();
    if schema == "markdown_summary" {
        return json!({"schemaVersion":1,"detectedSourceLanguage":"en","summaryLanguage":"en",
            "summaryMarkdown":format!("# Summary\n\n{}", document["source"].as_str().unwrap()),"warnings":[]});
    }
    let segments = document["segments"].as_array().unwrap();
    if schema == "selection_text_edits" {
        return json!({"schema_version":1,"replacements":segments.iter().map(|segment| (
            segment["id"].as_str().unwrap().to_string(),
            json!(segment["text"].as_str().unwrap().replace("Old", "New")),
        )).collect::<serde_json::Map<_, _>>(),"warnings":[]});
    }
    if schema == "markdown_translation" {
        return json!({"schemaVersion":1,"detectedSourceLanguage":"en","targetLanguage":"ko",
            "segments":segments.iter().map(|segment| json!({"id":segment["id"],"translatedText":segment["text"].as_str().unwrap().replace("Old", "New")})).collect::<Vec<_>>(),"warnings":[]});
    }
    json!({"schemaVersion":1,"summary":"Updated wording","findings":[],"assumptions":[],
        "operations":segments.iter().enumerate().map(|(index, segment)| json!({"id":format!("edit-{index}"),
            "kind":"replace","targetSegmentId":segment["id"],"markdown":segment["text"].as_str().unwrap().replace("Old", "New"),"findingIds":[]})).collect::<Vec<_>>()})
}

fn request(task: AiTask, selection: bool) -> AiRunRequest {
    let selected = "Old wording and 한국어 must survive with `protected_code`.\n".repeat(160);
    let source = if selection {
        format!("prefix untouched\n{selected}suffix untouched")
    } else {
        selected.clone()
    };
    serde_json::from_value(json!({"requestId":"test-run","documentId":"doc","source":source,
        "selection":if selection {json!({"start":17,"end":17+selected.len()})} else {Value::Null},
        "task":task,"model":"test/model","targetLanguage":if task == AiTask::Translation {Some("ko")} else {None},
        "instruction":"Change Old to New.","systemPrompt":"Preserve this customized task behavior.","zdrOnly":true,"maxOutputTokens":8192})).unwrap()
}

#[tokio::test]
async fn provider_context_and_truncated_streams_recover_all_tasks_without_losing_source() {
    for (task, selection) in [
        (AiTask::Custom, true),
        (AiTask::Custom, false),
        (AiTask::Prd, false),
        (AiTask::Translation, false),
        (AiTask::Summary, false),
    ] {
        for failure in ["context", "truncated"] {
            let (client, requests, server) = provider(failure).await;
            let request = request(task, selection);
            let envelope = prepare_run_envelope(&request).unwrap();
            let mut progress = Vec::new();
            let outcome = bounded_completion(
                &client,
                &request,
                &envelope,
                "test-key",
                &CancellationToken::new(),
                empty_completion_outcome(),
                |received, completed, total, _| progress.push((received, completed, total)),
            )
            .await
            .unwrap();
            server.abort();
            let result = outcome
                .result
                .unwrap_or_else(|| panic!("{task:?} {failure}: {:?}", outcome.validation_issues));
            if task == AiTask::Summary {
                assert_eq!(result.proposed_markdown.matches("Old wording").count(), 160);
            } else {
                assert_eq!(
                    result.proposed_markdown,
                    request.source.replace("Old", "New"),
                    "{task:?} {failure}"
                );
            }
            let requests = requests.lock().unwrap();
            assert!(requests.len() > 2);
            assert!(requests.iter().all(|request| request["messages"][0]["content"].as_str().unwrap()
                .contains("Preserve this customized task behavior.")));
            assert_eq!(progress.last().unwrap().1, progress.last().unwrap().2);
            assert!(progress.windows(2).all(|pair| pair[0].0 <= pair[1].0));
            assert!(outcome.usage.unwrap().cost_usd.unwrap() >= 0.02);
            if selection {
                assert!(
                    requests
                        .iter()
                        .all(|request| !request.to_string().contains("untouched"))
                );
            }
        }
    }
}

#[test]
fn clipped_selection_needs_the_original_markdown_context_for_final_validation() {
    let mut request = request(AiTask::Custom, true);
    request.source = "Text\nNext `code`.\n".to_string();
    request.selection = Some(ByteRange {
        start: 4,
        end: request.source.len(),
    });
    let envelope = prepare_run_envelope(&request).unwrap();
    let mut contextual_failure = false;
    for chunk in recovery_chunks(AiTask::Custom, &envelope).unwrap() {
        for piece in recovery_chunks(AiTask::Custom, &chunk).unwrap() {
            let response = SelectionResponse {
                schema_version: 1,
                replacement_text: piece
                    .segments
                    .iter()
                    .map(|segment| segment.text.as_str())
                    .collect(),
                warnings: vec![],
            };
            if let Err(error) = validate_selection_response(&piece, response) {
                assert!(
                    validation_issues(error)
                        .iter()
                        .all(|issue| issue.code == "markdown_structure_changed")
                );
                contextual_failure = true;
            }
        }
    }
    assert!(
        contextual_failure,
        "fixture must exercise a clipped newline changing parser context"
    );
}

#[tokio::test]
async fn deferring_fragment_context_checks_never_allows_unsafe_combined_edits() {
    let request = request(AiTask::Custom, true);
    let envelope = prepare_run_envelope(&request).unwrap();
    let (client, _, server) = provider("unsafe").await;
    let outcome = bounded_completion(
        &client,
        &request,
        &envelope,
        "test-key",
        &CancellationToken::new(),
        empty_completion_outcome(),
        |_, _, _, _| {},
    )
    .await
    .unwrap();
    server.abort();
    assert!(outcome.result.is_none());
    assert!(!outcome.validation_issues.is_empty());
}

#[tokio::test]
async fn billing_failure_and_user_cancellation_do_not_retry_or_return_partial_edits() {
    let request = request(AiTask::Custom, true);
    let envelope = prepare_run_envelope(&request).unwrap();
    let (client, requests, server) = provider("billing").await;
    let error = bounded_completion(
        &client,
        &request,
        &envelope,
        "test-key",
        &CancellationToken::new(),
        empty_completion_outcome(),
        |_, _, _, _| {},
    )
    .await
    .err()
    .unwrap();
    assert_eq!(error.code, "insufficient_credits");
    assert_eq!(requests.lock().unwrap().len(), 1);
    server.abort();
    let (client, requests, server) = provider("").await;
    let cancellation = CancellationToken::new();
    let error = bounded_completion(
        &client,
        &request,
        &envelope,
        "test-key",
        &cancellation,
        empty_completion_outcome(),
        |_, completed, _, _| {
            if completed == 1 {
                cancellation.cancel();
            }
        },
    )
    .await
    .err()
    .unwrap();
    assert_eq!(error.code, "cancelled");
    assert_eq!(requests.lock().unwrap().len(), 1);
    server.abort();
}
