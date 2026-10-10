//! Dedicated transient ACP sessions for background chapter tasks.
//!
//! One engine process + one session per task attempt: no pool, no queue, no
//! shared state with the live chat session. The lifecycle mirrors a chat
//! session minus resume, history, and UI permission roundtrips:
//! connect → open (task-scoped MCP servers) → set_config (model + effort) →
//! prompt → close. Chapter work is strictly ordered inside a single session
//! (outline → evidence → draft → finalize), which is exactly what pools are
//! *not* for, so chapters deliberately bypass `agent_pool`.

use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::mpsc;
use std::time::Duration;

use serde_json::{json, Value};

use super::engine::SidecarEngine;
use super::error::{AcpError, AcpErrorCode};
use super::model::{AcpEvent, AgentProfileInput, AgentProfilesHint};
use super::service::AcpService;
use super::updates::project_session_update;

/// Same prompt budget as a chat turn: chapter turns run long multi-round tool
/// sessions, so this mirrors `service.rs`, not a short RPC timeout.
const PROMPT_TIMEOUT_MS: u64 = 600_000;

/// Client identity is fixed by the engine contract (mirrors `service.rs`).
const CLIENT_NAME: &str = "dawnsight-desktop";
const CLIENT_VERSION: &str = "0.4.0";

pub struct IsolatedSessionSpec<'a> {
    pub profile_id: &'a str,
    pub profiles: &'a AgentProfilesHint,
    pub workspace: &'a Path,
    pub mcp_servers: Value,
    pub model_id: Option<&'a str>,
    pub reasoning_effort: Option<&'a str>,
}

pub struct IsolatedSession {
    engine: SidecarEngine,
    session_id: String,
}

impl IsolatedSession {
    /// Spawn a private engine and open one session scoped to the chapter task.
    /// Never touches the live chat session, history, or resume state.
    pub fn open(
        spec: &IsolatedSessionSpec<'_>,
        on_event: &mut dyn FnMut(AcpEvent),
    ) -> Result<Self, AcpError> {
        let profile = resolve_task_profile(spec.profiles, spec.profile_id)?;
        let engine = SidecarEngine::new();
        engine.ensure_running().map_err(|error| {
            tracing::warn!(code = ?error.code, details = ?error.details, "isolated engine start failed");
            if error.code == AcpErrorCode::NotConfigured {
                error
            } else {
                AcpError::spawn_failed(error.details.as_deref())
            }
        })?;
        Self::connect_runtime(&engine, spec.workspace, profile, on_event)?;
        let (session_id, advertised) = Self::open_task_session(&engine, &spec.mcp_servers)?;
        Self::apply_model_selection(
            &engine,
            &session_id,
            spec.model_id,
            spec.reasoning_effort,
            advertised,
            on_event,
        );
        tracing::debug!(session_id = %session_id, profile_id = %profile.id, "isolated chapter session opened");
        Ok(Self { engine, session_id })
    }

    /// Run one prompt turn, auto-approving tool permission requests (this is a
    /// background task: there is no UI roundtrip by design).
    pub fn prompt(
        &self,
        text: String,
        on_event: &mut dyn FnMut(AcpEvent),
    ) -> Result<String, AcpError> {
        let (tx, rx) = mpsc::channel();
        self.engine.set_update_sink(tx);
        let engine = self.engine.clone();
        let session_id = self.session_id.clone();
        let cancel_flag = AtomicBool::new(false);
        let worker = std::thread::Builder::new()
            .name("acp-isolated-prompt".into())
            .spawn(move || {
                engine.request_cancellable(
                    "session/prompt",
                    json!({
                        "sessionId": session_id,
                        "promptText": text,
                        "timeoutMs": PROMPT_TIMEOUT_MS,
                    }),
                    &cancel_flag,
                )
            })
            .map_err(|_| AcpError::internal(Some("spawn isolated prompt worker failed")))?;

        let mut full_text = String::new();
        let mut finished = false;
        while !finished {
            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok(note) => Self::route_notification(&self.engine, &note, on_event, &mut full_text),
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if worker.is_finished() {
                        while let Ok(note) = rx.try_recv() {
                            Self::route_notification(&self.engine, &note, on_event, &mut full_text);
                        }
                        finished = true;
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    finished = true;
                }
            }
        }
        self.engine.clear_update_sink();
        let response = worker
            .join()
            .map_err(|_| AcpError::internal(Some("isolated prompt worker thread panicked")))?;
        match response {
            Ok(response) => {
                if full_text.trim().is_empty() {
                    on_event(AcpEvent::Failed {
                        code: format!("{:?}", AcpErrorCode::NoOutput),
                        message: AcpError::no_output(None).message,
                    });
                    return Err(AcpError::no_output(Some("agent returned no text")));
                }
                on_event(AcpEvent::Finished {
                    text: full_text.clone(),
                    stop_reason: response
                        .get("result")
                        .and_then(|result| result.get("stopReason"))
                        .and_then(Value::as_str)
                        .map(str::to_string),
                });
                Ok(full_text)
            }
            Err(error) => {
                on_event(AcpEvent::Failed {
                    code: format!("{:?}", error.code),
                    message: error.message.clone(),
                });
                Err(error)
            }
        }
    }

    /// Best-effort teardown: delete the transient session, then stop the
    /// private engine (which reaps the agent processes it spawned).
    pub fn close(self) {
        let _ = self
            .engine
            .call("session/delete", json!({ "sessionId": self.session_id }));
        self.engine.shutdown();
    }

    pub(crate) fn connect_runtime(
        engine: &SidecarEngine,
        workspace: &Path,
        profile: &AgentProfileInput,
        on_event: &mut dyn FnMut(AcpEvent),
    ) -> Result<(), AcpError> {
        let runtime = AcpService::runtime_for(profile)?;
        let (runtime_param, custom_command, custom_args): (Value, Option<String>, Vec<String>) =
            match &runtime {
                super::service::EngineRuntime::Builtin(id) => (json!(id), None, Vec::new()),
                super::service::EngineRuntime::Custom(program, args) => {
                    (json!("custom"), Some(program.clone()), args.clone())
                }
            };
        let mut params = json!({
            "runtime": runtime_param,
            "workspaceRoot": workspace.to_string_lossy(),
            "clientInfo": { "name": CLIENT_NAME, "version": CLIENT_VERSION },
        });
        if let Some(cmd) = custom_command {
            params["customCommand"] = json!(cmd);
            params["customArgs"] = json!(custom_args);
        }
        if !profile.env.is_empty() {
            params["env"] = json!(profile.env);
        }
        on_event(AcpEvent::Started);
        let result = engine.call("client/connect", params);
        result
            .map(|_| ())
            .map_err(|error| {
                tracing::warn!(code = ?error.code, details = ?error.details, "isolated engine client/connect failed");
                if error.code == AcpErrorCode::NotConfigured {
                    error
                } else {
                    AcpError::spawn_failed(error.details.as_deref())
                }
            })
    }

    fn open_task_session(
        engine: &SidecarEngine,
        mcp_servers: &Value,
    ) -> Result<(String, super::AcpSessionModelOptions), AcpError> {
        let result = engine
            .call(
                "session/open",
                json!({
                    "resumeSessionId": Value::Null,
                    "mcpServers": mcp_servers,
                }),
            )
            .inspect_err(|error| {
                tracing::warn!(code = ?error.code, details = ?error.details, "isolated engine session/open failed");
            })?;
        let session_id = result
            .get("sessionId")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| AcpError::protocol(Some("engine session/open without sessionId")))?;
        Ok((session_id, super::config::response_options(&result)?))
    }

    /// Apply model + effort before the first prompt. Failures only warn and
    /// continue, mirroring the chat `open_session` behavior: an unlisted value
    /// must not kill the whole task.
    fn apply_model_selection(
        engine: &SidecarEngine,
        session_id: &str,
        model_id: Option<&str>,
        reasoning_effort: Option<&str>,
        advertised: super::AcpSessionModelOptions,
        on_event: &mut dyn FnMut(AcpEvent),
    ) {
        let mut options = Some(advertised);
        if let Some(model) = model_id.map(str::trim).filter(|value| !value.is_empty()) {
            on_event(AcpEvent::Progress {
                message: format!("正在切换模型到 {model}…"),
            });
            match engine.call(
                "session/set_config",
                json!({ "sessionId": session_id, "configId": options.as_ref().map(super::config::model_config_id).unwrap_or("model"), "value": model }),
            ) {
                Ok(response) => options = super::config::response_options(&response).ok(),
                Err(error) => tracing::warn!(details = ?error.details, "isolated model pre-selection failed; continuing"),
            }
        }
        if let Some(effort) = reasoning_effort
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let Some(config_id) = options
                .as_ref()
                .and_then(|options| super::config::effort_config_id(options, effort))
            else {
                return;
            };
            if let Err(error) = engine.call(
                "session/set_config",
                json!({ "sessionId": session_id, "configId": config_id, "value": effort }),
            ) {
                tracing::warn!(details = ?error.details, "isolated effort pre-selection failed; continuing");
            }
        }
    }

    fn route_notification(
        engine: &SidecarEngine,
        note: &Value,
        on_event: &mut dyn FnMut(AcpEvent),
        full_text: &mut String,
    ) {
        if note.get("notification").and_then(Value::as_str) == Some("permission/request") {
            if let Some((request_id, option_id)) =
                pick_approve_option(note.get("params").unwrap_or(&Value::Null))
            {
                on_event(AcpEvent::PermissionResolved {
                    tool_call_id: note
                        .get("params")
                        .and_then(|params| params.get("toolCall"))
                        .and_then(|call| call.get("id"))
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    decision: "auto".to_string(),
                });
                let engine = engine.clone();
                std::thread::Builder::new()
                    .name("acp-isolated-permission-auto".into())
                    .spawn(move || {
                        let _ = engine.call(
                            "permission/respond",
                            json!({ "requestId": request_id, "outcome": { "outcome": "selected", "optionId": option_id } }),
                        );
                    })
                    .ok();
                return;
            }
        }
        let params = note.get("params").unwrap_or(note);
        for event in project_session_update(params) {
            if let AcpEvent::AgentMessage { ref text } = event {
                full_text.push_str(text);
            }
            on_event(event);
        }
    }
}

fn resolve_task_profile<'a>(
    prepared: &'a AgentProfilesHint,
    profile_id: &str,
) -> Result<&'a AgentProfileInput, AcpError> {
    AcpService::resolve_profile(prepared, Some(profile_id))
}

/// Pick the approve option for a background permission request: one-shot
/// allow first, then any allow*, then the first option. Pure for tests.
fn pick_approve_option(params: &Value) -> Option<(String, String)> {
    let request_id = params.get("requestId")?.as_str()?.to_string();
    let options: Vec<(String, String)> = params
        .get("params")
        .and_then(|inner| inner.get("options"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|option| {
                    let id = option
                        .get("optionId")
                        .and_then(Value::as_str)
                        .or_else(|| option.get("id").and_then(Value::as_str))?;
                    let kind = option.get("kind").and_then(Value::as_str).unwrap_or("");
                    Some((id.to_string(), kind.to_string()))
                })
                .collect()
        })
        .unwrap_or_default();
    let option_id = options
        .iter()
        .find(|(_, kind)| kind == "allow_once")
        .or_else(|| options.iter().find(|(_, kind)| kind.starts_with("allow")))
        .or_else(|| options.first())
        .map(|(id, _)| id.clone())?;
    Some((request_id, option_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hint_with(profile_id: &str) -> AgentProfilesHint {
        AgentProfilesHint {
            active_profile_id: profile_id.to_string(),
            profiles: Vec::new(),
        }
    }

    #[test]
    fn missing_profile_is_not_configured_without_spawning() {
        let hint = hint_with("codex");
        let error = resolve_task_profile(&hint, "nope").expect_err("missing profile errors");
        assert_eq!(error.code, AcpErrorCode::NotConfigured);
    }

    #[test]
    fn empty_profile_id_falls_back_to_active_then_reports_missing() {
        let hint = hint_with("codex");
        let error =
            resolve_task_profile(&hint, "  ").expect_err("empty id with empty lineup errors");
        assert_eq!(error.code, AcpErrorCode::NotConfigured);
    }

    #[test]
    fn approve_picker_prefers_allow_once_then_allow_prefix_then_first() {
        let params = json!({
            "requestId": "r1",
            "params": { "options": [
                { "optionId": "deny", "kind": "deny" },
                { "optionId": "once", "kind": "allow_once" },
                { "optionId": "always", "kind": "allow_always" },
            ] },
        });
        assert_eq!(
            pick_approve_option(&params),
            Some(("r1".to_string(), "once".to_string()))
        );
        let params = json!({
            "requestId": "r2",
            "params": { "options": [
                { "optionId": "deny", "kind": "deny" },
                { "optionId": "always", "kind": "allow_always" },
            ] },
        });
        assert_eq!(
            pick_approve_option(&params),
            Some(("r2".to_string(), "always".to_string()))
        );
        let params = json!({
            "requestId": "r3",
            "params": { "options": [{ "optionId": "only", "kind": "ask" }] },
        });
        assert_eq!(
            pick_approve_option(&params),
            Some(("r3".to_string(), "only".to_string()))
        );
    }

    #[test]
    fn approve_picker_rejects_unusable_payloads() {
        assert_eq!(pick_approve_option(&json!({})), None);
        assert_eq!(
            pick_approve_option(&json!({ "requestId": "r", "params": { "options": [] } })),
            None
        );
    }

    #[test]
    fn route_notification_accumulates_streamed_chunks() {
        let note = json!({
            "notification": "session/update",
            "params": {
                "sessionId": "s1",
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "content": [{ "type": "text", "text": "chapter chunk 1; " }],
                },
            },
        });
        let engine = SidecarEngine::new();
        let mut full_text = String::new();
        let mut events = Vec::new();
        IsolatedSession::route_notification(
            &engine,
            &note,
            &mut |ev| events.push(ev),
            &mut full_text,
        );
        assert_eq!(full_text, "chapter chunk 1; ");
        assert_eq!(events.len(), 1);
        assert!(
            matches!(&events[0], AcpEvent::AgentMessage { text } if text == "chapter chunk 1; ")
        );
    }
}
