//! Manual `session/update` projection: engine notification -> [`AcpEvent`].
//!
//! The engine forwards raw ACP updates as `{ sessionId, update }`. This maps
//! the known `sessionUpdate` variants onto chat UI events. Unknown future
//! variants are ignored (never fatal); display scalars stay raw so missing
//! stays missing.

use serde_json::Value;

use super::{AcpEvent, PermissionOption};

/// Unwrap the engine envelope `{ sessionId, update }` (or a bare update).
fn update_payload(value: &Value) -> Option<&Value> {
    if value.get("sessionUpdate").and_then(Value::as_str).is_some() {
        return Some(value);
    }
    value
        .get("update")
        .filter(|inner| inner.get("sessionUpdate").and_then(Value::as_str).is_some())
}

fn update_kind(update: &Value) -> Option<&str> {
    update.get("sessionUpdate").and_then(Value::as_str)
}

/// Concatenate `content` text blocks. Real agents send all three shapes:
/// a bare string, a single `{type:"text",text}` object (codex streams
/// message chunks this way), or an array mixing both.
pub fn content_blocks_text(content: Option<&Value>) -> String {
    let mut out = String::new();
    let Some(content) = content else {
        return out;
    };
    if let Some(text) = content.as_str() {
        out.push_str(text);
        return out;
    }
    if content.is_object() {
        // Single block object: text only counts for text blocks; image
        // blocks and friends contribute nothing to chat text.
        let is_text = content
            .get("type")
            .and_then(Value::as_str)
            .is_none_or(|kind| kind == "text");
        if is_text {
            if let Some(text) = content.get("text").and_then(Value::as_str) {
                out.push_str(text);
            }
        }
        return out;
    }
    if let Some(items) = content.as_array() {
        for item in items {
            if let Some(text) = item.get("text").and_then(Value::as_str) {
                // Array items may also be image blocks carrying no text.
                let is_text = item
                    .get("type")
                    .and_then(Value::as_str)
                    .is_none_or(|kind| kind == "text");
                if is_text {
                    out.push_str(text);
                }
            } else if let Some(text) = item.as_str() {
                out.push_str(text);
            }
        }
    }
    out
}

fn tool_scalars(update: &Value) -> (Option<String>, Option<String>, Option<String>) {
    (
        update
            .get("title")
            .and_then(Value::as_str)
            .map(str::to_string),
        update
            .get("status")
            .and_then(Value::as_str)
            .map(str::to_string),
        update
            .get("kind")
            .and_then(Value::as_str)
            .map(str::to_string),
    )
}

fn tool_call_id(update: &Value) -> String {
    update
        .get("toolCallId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

/// Project one engine `session/update` notification onto chat events.
/// Returns an empty vec for ignorable updates (mode changes, diffs, …).
pub fn project_session_update(value: &Value) -> Vec<AcpEvent> {
    let Some(update) = update_payload(value) else {
        return Vec::new();
    };
    let Some(kind) = update_kind(update) else {
        return Vec::new();
    };
    match kind {
        "agent_message_chunk" => {
            let text = content_blocks_text(update.get("content"));
            if text.is_empty() {
                Vec::new()
            } else {
                vec![AcpEvent::AgentMessage { text }]
            }
        }
        "agent_thought_chunk" => {
            let text = content_blocks_text(update.get("content"));
            if text.is_empty() {
                Vec::new()
            } else {
                vec![AcpEvent::AgentThought { text }]
            }
        }
        "tool_call" => {
            let (title, status, kind) = tool_scalars(update);
            vec![AcpEvent::ToolCall {
                tool_call_id: tool_call_id(update),
                title,
                kind,
                status,
                detail: None,
            }]
        }
        "tool_call_update" => {
            let (title, status, _) = tool_scalars(update);
            vec![AcpEvent::ToolCallUpdate {
                tool_call_id: tool_call_id(update),
                status,
                title,
                detail: None,
                append_detail: false,
            }]
        }
        // codex extension: streams tool result text.
        "tool_call_content_chunk" => {
            let text = content_blocks_text(update.get("content"));
            if text.is_empty() {
                Vec::new()
            } else {
                vec![AcpEvent::ToolCallUpdate {
                    tool_call_id: tool_call_id(update),
                    status: None,
                    title: None,
                    detail: Some(text),
                    append_detail: true,
                }]
            }
        }
        "plan" => {
            let mut text = update
                .get("entries")
                .map(|entries| content_blocks_text(Some(entries)))
                .unwrap_or_default();
            if text.is_empty() {
                text = content_blocks_text(update.get("content"));
            }
            if text.is_empty() {
                Vec::new()
            } else {
                vec![AcpEvent::Plan { text }]
            }
        }
        _ => Vec::new(),
    }
}

/// Project an engine `permission/request` notification onto [`AcpEvent`].
/// Returns `None` when the payload is unusable (caller then auto-cancels).
pub fn project_permission_request(value: &Value) -> Option<AcpEvent> {
    let request_id = value
        .get("requestId")
        .and_then(Value::as_str)
        .map(str::to_string)?;
    let tool_call = value.get("toolCall");
    let tool_call_id = tool_call
        .and_then(|call| call.get("id"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let title = tool_call
        .and_then(|call| call.get("title"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let params = value.get("params");
    let options = params
        .and_then(|params| params.get("options"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let option_id = item
                        .get("optionId")
                        .and_then(Value::as_str)
                        .or_else(|| item.get("id").and_then(Value::as_str))?;
                    Some(PermissionOption {
                        option_id: option_id.to_string(),
                        name: item
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or(option_id)
                            .to_string(),
                        kind: item.get("kind").and_then(Value::as_str).map(str::to_string),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Some(AcpEvent::PermissionRequest {
        request_id,
        tool_call_id,
        title,
        options,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn message_chunk_projects_text() {
        let value = json!({
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": [{ "type": "text", "text": "hello" }],
            },
        });
        let events = project_session_update(&value);
        assert_eq!(events.len(), 1);
        assert!(matches!(
            events[0],
            AcpEvent::AgentMessage { ref text } if text == "hello"
        ));
    }

    #[test]
    fn message_chunk_projects_single_object_content() {
        // Real codex streams chunks as one object, not an array. Dropping
        // this shape produced permanently empty replies (NoOutput).
        for content in [
            json!({ "type": "text", "text": "hello" }),
            json!({ "text": "hello" }),
        ] {
            let value = json!({
                "sessionId": "s1",
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "content": content,
                },
            });
            let events = project_session_update(&value);
            assert_eq!(events.len(), 1, "content: {content}");
            assert!(matches!(
                events[0],
                AcpEvent::AgentMessage { ref text } if text == "hello"
            ));
        }
    }

    #[test]
    fn image_blocks_contribute_no_text() {
        let value = json!({
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": { "type": "image", "mimeType": "image/png", "data": "aGk=" },
            },
        });
        assert!(project_session_update(&value).is_empty());
    }

    #[test]
    fn unknown_update_is_ignored() {
        let value = json!({
            "sessionId": "s1",
            "update": { "sessionUpdate": "available_commands_update" },
        });
        assert!(project_session_update(&value).is_empty());
    }

    #[test]
    fn permission_request_projects_options() {
        let value = json!({
            "requestId": "req_1",
            "sessionId": "s1",
            "toolCall": { "id": "t1", "title": "run tests" },
            "params": { "options": [{ "optionId": "allow", "name": "Allow" }] },
        });
        let event = project_permission_request(&value).expect("projects");
        assert!(matches!(
            event,
            AcpEvent::PermissionRequest { ref request_id, .. } if request_id == "req_1"
        ));
    }
}
