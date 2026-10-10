//! Chat session state machine over the `acp-engine` sidecar.
//!
//! On-demand only: the engine process spawns on first use and dies on app
//! exit. One live chat session at a time (guarded by `busy` for prompts).
//! Profile-to-runtime mapping, snapshot sync and MCP wiring mirror the
//! previous backend; the ACP wire itself lives in the engine.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};

use super::engine::SidecarEngine;
use super::environment::session_env;
use super::error::{AcpError, AcpErrorCode};
use super::model::{
    AcpEvent, AcpSessionModelOptions, AcpSessionOption, AcpStatus, AgentProfileStatus,
    AgentProfilesHint, AgentSessionInfo, AgentSessionListResult, PromptImage, ResumeOutcome,
    SavedSessionHint, SessionConfigKind, SessionConfigOption, SessionConfigValue, SessionKind,
};
use super::settings::{AcpClientSettings, PermissionMode};
use super::updates::{content_blocks_text, project_permission_request, project_session_update};
use super::workspace::resolve_agent_workspace;

const PROMPT_TIMEOUT_MS: u64 = 600_000;
const LOAD_TRANSCRIPT_TIMEOUT_SECS: u64 = 120;
const MAX_LOADED_TRANSCRIPT_TURNS: usize = 2_000;
const MAX_LOADED_TRANSCRIPT_MESSAGE_CHARS: usize = 64 * 1024;

/// One public, completed transcript message replayed by `session/load`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedTurn {
    pub role: String,
    pub text: String,
}

impl LoadedTurn {
    fn new(role: &str, text: String) -> Option<Self> {
        if text.trim().is_empty() {
            return None;
        }
        Some(Self {
            role: role.to_string(),
            text,
        })
    }
}

#[derive(Debug, Clone)]
pub struct LiveSession {
    pub session_id: String,
    pub profile_id: String,
    pub cwd: PathBuf,
    pub model_options: Option<AcpSessionModelOptions>,
    /// Engine generation that owns this session. A respawned engine holds
    /// no client or sessions, so a stale generation invalidates it.
    pub engine_gen: u64,
}

pub struct AcpService {
    engine: SidecarEngine,
    busy: AtomicBool,
    cancel: std::sync::Arc<AtomicBool>,
    session: Mutex<Option<LiveSession>>,
    connected_runtime: Mutex<Option<(String, u64)>>,
    permission_mode: Mutex<PermissionMode>,
    /// Serializes connect/open sequences (connect, new/switch chat, prompt
    /// setup, transcript load). The engine holds a single client: two
    /// concurrent connects disconnect each other and the loser reports a
    /// false failure; a connect racing a prompt also steals its update sink.
    /// Lock order is always busy -> exclusive, never the reverse.
    exclusive: Mutex<()>,
}

impl AcpService {
    #[cfg(test)]
    pub(crate) fn with_test_engine(engine: SidecarEngine) -> Self {
        Self {
            engine,
            ..Self::new()
        }
    }

    pub fn new() -> Self {
        Self {
            engine: SidecarEngine::new(),
            busy: AtomicBool::new(false),
            cancel: std::sync::Arc::new(AtomicBool::new(false)),
            session: Mutex::new(None),
            connected_runtime: Mutex::new(None),
            permission_mode: Mutex::new(PermissionMode::Auto),
            exclusive: Mutex::new(()),
        }
    }

    fn lock_exclusive(&self) -> Result<std::sync::MutexGuard<'_, ()>, AcpError> {
        self.exclusive
            .lock()
            .map_err(|_| AcpError::internal(Some("ACP operation mutex poisoned")))
    }

    pub fn is_busy(&self) -> bool {
        self.busy.load(Ordering::SeqCst)
    }

    fn lock_busy(&self) -> Result<BusyGuard<'_>, AcpError> {
        if self
            .busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err(AcpError::busy());
        }
        Ok(BusyGuard { busy: &self.busy })
    }

    // ---- profiles ------------------------------------------------------

    pub(crate) fn resolve_profile<'a>(
        prepared: &'a AgentProfilesHint,
        profile_id: Option<&str>,
    ) -> Result<&'a super::model::AgentProfileInput, AcpError> {
        let wanted = profile_id
            .filter(|id| !id.trim().is_empty())
            .unwrap_or(&prepared.active_profile_id);
        prepared
            .profiles
            .iter()
            .find(|profile| profile.id == wanted)
            .ok_or_else(|| AcpError::not_configured(Some("selected agent profile is missing")))
    }

    /// Map a profile to the engine runtime id (or a custom program + args).
    pub(crate) fn runtime_for(
        profile: &super::model::AgentProfileInput,
    ) -> Result<EngineRuntime, AcpError> {
        use super::model::AgentKind;
        match profile.kind {
            AgentKind::Codex => Ok(EngineRuntime::Builtin("codex-acp")),
            AgentKind::Claude => Ok(EngineRuntime::Builtin("claude")),
            AgentKind::Cursor => Ok(EngineRuntime::Builtin("cursor-cli")),
            AgentKind::Gemini => Ok(EngineRuntime::Builtin("gemini")),
            AgentKind::Copilot => Ok(EngineRuntime::Builtin("copilot")),
            AgentKind::OpenCode => Ok(EngineRuntime::Builtin("opencode")),
            AgentKind::DeepSeek => Ok(EngineRuntime::Builtin("deepseek")),
            AgentKind::Custom => {
                let program = profile.command.trim().to_string();
                if program.is_empty() {
                    return Err(AcpError::not_configured(Some(
                        "custom agent profile has empty command",
                    )));
                }
                Ok(EngineRuntime::Custom(program, profile.args.clone()))
            }
        }
    }

    // ---- status --------------------------------------------------------

    pub fn status(&self, profiles: &AgentProfilesHint) -> AcpStatus {
        let active_profile_id = profiles.active_profile_id.clone();
        let mut status = AcpStatus {
            available: false,
            adapter_found: false,
            codex_found: false,
            codex_config_found: false,
            active_profile_id: active_profile_id.clone(),
            profiles: Vec::new(),
            cli_path: None,
            codex_path: None,
            message: String::new(),
            hint: String::new(),
            responses_only_note:
                "Agent 经由 acp-engine sidecar 连接，模型经 Codex config.toml（Responses API）。"
                    .to_string(),
            session_active: false,
            busy: self.busy.load(Ordering::SeqCst),
            session_model_options: None,
            live_profile_id: None,
        };
        if !super::engine::engine_binary_present() {
            status.message = "ACP 引擎缺失".to_string();
            status.hint = "运行 node scripts/build-acp-engine.mjs 构建 acp-engine".to_string();
            // Engine-only lineup: with no engine there is nothing to offer.
            // App-side copies are never echoed back, so they cannot linger as
            // duplicate rows once the engine is back.
            status.profiles = Vec::new();
            return status;
        }
        status.adapter_found = true;
        // The engine runtime registry is the only lineup source: ids, names,
        // launch specs and auth probes all come from `runtimes/list`. The app
        // keeps no agent matrix of its own; anything the engine does not
        // report is not offered, so stale app-side copies can never resurface
        // as duplicate dropdown rows.
        let runtimes = self.engine.ensure_running().ok().and_then(|_| {
            self.engine
                .call("runtimes/list", Value::Null)
                .ok()
                .and_then(|value| value.get("runtimes").cloned())
        });
        let runtime_entries: Vec<&Value> = runtimes
            .as_ref()
            .and_then(|list| list.as_array())
            .map(|list| list.iter().collect())
            .unwrap_or_default();
        let mut any_available = false;
        for entry in &runtime_entries {
            let Some(engine_id) = entry.get("id").and_then(Value::as_str) else {
                continue;
            };
            let id = Self::profile_id_for_runtime_id(engine_id);
            let available = entry
                .get("looksLoggedIn")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            any_available |= available;
            let kind = Self::kind_for_runtime_id(engine_id);
            if matches!(kind, super::model::AgentKind::Codex) && available {
                status.codex_found = true;
            }
            status.profiles.push(AgentProfileStatus {
                id: id.to_string(),
                name: entry
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or(id)
                    .to_string(),
                kind,
                command: entry
                    .get("command")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                args: entry
                    .get("args")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect()
                    })
                    .unwrap_or_default(),
                env: std::collections::HashMap::new(),
                available,
                resolved_command: None,
                description: entry
                    .get("description")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                auth_hint: entry
                    .get("authHint")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            });
        }
        status.available = any_available;
        if any_available {
            status.message = "Agent 可用".to_string();
        } else {
            status.message = "未检测到已登录的 Agent".to_string();
            status.hint =
                "请先完成对应 Agent 的登录（Codex / Claude / Cursor 等）后重试".to_string();
        }
        if let Ok(guard) = self.session.lock() {
            if let Some(session) = guard.as_ref() {
                if session.engine_gen == self.engine.generation() && self.engine.is_alive() {
                    // The live session's owner is reported regardless of the
                    // requested profile; options stay gated on an exact match.
                    status.live_profile_id = Some(session.profile_id.clone());
                }
                if session.profile_id == active_profile_id
                    && session.engine_gen == self.engine.generation()
                    && self.engine.is_alive()
                {
                    status.session_active = true;
                    status.session_model_options = session.model_options.clone();
                }
            }
        }
        status
    }

    /// Map an engine runtime id to the local agent kind. Unknown future
    /// runtimes fall through to Custom so a new engine release needs no
    /// backend change to appear in the lineup.
    fn kind_for_runtime_id(id: &str) -> super::model::AgentKind {
        use super::model::AgentKind;
        match id {
            "codex-acp" => AgentKind::Codex,
            "claude" => AgentKind::Claude,
            "cursor-cli" => AgentKind::Cursor,
            "deepseek" => AgentKind::DeepSeek,
            "gemini" => AgentKind::Gemini,
            "copilot" => AgentKind::Copilot,
            "opencode" => AgentKind::OpenCode,
            _ => AgentKind::Custom,
        }
    }

    /// Map an engine runtime id to the stable Dawnsight profile id. The engine
    /// owns transport ids (`codex-acp`, `cursor-cli`); persisted hints,
    /// snapshots and the UI key on the product ids (`codex`, `cursor`).
    /// Unknown ids pass through unchanged (e.g. `opencode-v2`).
    fn profile_id_for_runtime_id(id: &str) -> &str {
        match id {
            "codex-acp" => "codex",
            "cursor-cli" => "cursor",
            _ => id,
        }
    }

    // ---- connect -------------------------------------------------------

    fn mcp_servers_for(&self, workspace: &std::path::Path, vision_capable: bool) -> Value {
        let env = match session_env() {
            Ok(env) => env,
            Err(_) => return Value::Array(Vec::new()),
        };
        let snapshot_path = env.snapshot_path(workspace, SessionKind::Chat);
        let _ = env.sync_snapshot(&snapshot_path, vision_capable);
        let servers = env.mcp_servers(&snapshot_path, SessionKind::Chat);
        if servers.is_array() {
            servers
        } else {
            Value::Array(Vec::new())
        }
    }

    fn engine_connect(
        &self,
        runtime: &EngineRuntime,
        workspace: &std::path::Path,
        profile: &super::model::AgentProfileInput,
        on_event: &mut dyn FnMut(AcpEvent),
    ) -> Result<(), AcpError> {
        on_event(AcpEvent::Started);
        on_event(AcpEvent::Progress {
            message: format!("正在连接 Agent 运行时（{}）…", profile.name),
        });
        // Custom profiles keep command and args separate (paths with spaces
        // survive; mirrors agent_pool program splitting).
        let (runtime_param, custom_command, custom_args): (Value, Option<String>, Vec<String>) =
            match runtime {
                EngineRuntime::Builtin(id) => (json!(id), None, Vec::new()),
                EngineRuntime::Custom(program, args) => {
                    (json!("custom"), Some(program.clone()), args.clone())
                }
            };
        let mut params = serde_json::json!({
            "runtime": runtime_param,
            "workspaceRoot": workspace.to_string_lossy(),
            "clientInfo": { "name": "dawnsight-desktop", "version": "0.4.0" },
        });
        if let Some(cmd) = custom_command {
            params["customCommand"] = json!(cmd);
            params["customArgs"] = json!(custom_args);
        }
        if !profile.env.is_empty() {
            params["env"] = json!(profile.env);
        }
        // Install a sink so connect-time updates surface instead of dropping.
        let (tx, rx) = mpsc::channel();
        self.engine.set_update_sink(tx);
        let result = self.engine.call("client/connect", params);
        while let Ok(note) = rx.try_recv() {
            self.route_notification(&note, on_event);
        }
        self.engine.clear_update_sink();
        let result = result.map_err(|error| {
            tracing::warn!(
                code = ?error.code,
                details = ?error.details,
                "engine client/connect failed"
            );
            if error.code == AcpErrorCode::NotConfigured {
                error
            } else {
                AcpError::spawn_failed(error.details.as_deref())
            }
        })?;
        let _ = result;
        Ok(())
    }

    fn open_session(
        &self,
        workspace: &std::path::Path,
        profile: &super::model::AgentProfileInput,
        resume_session_id: Option<&str>,
        mcp_servers: Value,
        model_selection: Option<super::model::AcpSessionModelSelection>,
        on_event: &mut dyn FnMut(AcpEvent),
    ) -> Result<LiveSession, AcpError> {
        let (tx, rx) = mpsc::channel();
        self.engine.set_update_sink(tx);
        let result = self.engine.call(
            "session/open",
            json!({
                "resumeSessionId": resume_session_id,
                "mcpServers": mcp_servers,
            }),
        );
        while let Ok(note) = rx.try_recv() {
            self.route_notification(&note, on_event);
        }
        self.engine.clear_update_sink();
        let result = result.inspect_err(|error| {
            tracing::warn!(
                code = ?error.code,
                details = ?error.details,
                "engine session/open failed"
            );
        })?;
        let session_id = result
            .get("sessionId")
            .and_then(Value::as_str)
            .ok_or_else(|| AcpError::protocol(Some("engine session/open without sessionId")))?
            .to_string();
        let restore_method = result
            .get("restoreMethod")
            .and_then(Value::as_str)
            .unwrap_or("new");
        let mut model_options = Some(super::config::response_options(&result)?);
        // Apply the requested model before the first prompt.
        if let Some(selection) = model_selection.as_ref() {
            if !selection.model_id.trim().is_empty() {
                on_event(AcpEvent::Progress {
                    message: format!("正在切换模型到 {}…", selection.model_id),
                });
                let config_id = model_options
                    .as_ref()
                    .map(super::config::model_config_id)
                    .unwrap_or("model");
                let response = self.engine.call(
                    "session/set_config",
                    json!({
                        "sessionId": session_id, "configId": config_id, "value": selection.model_id,
                    }),
                );
                match response {
                    Ok(response) => {
                        model_options = super::config::response_options(&response)
                            .ok()
                            .or(model_options)
                    }
                    Err(error) => {
                        tracing::warn!(details = ?error.details, "model pre-selection failed; continuing")
                    }
                }
            }
            if let Some(effort) = selection
                .reasoning_effort
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .filter(|value| {
                    model_options
                        .as_ref()
                        .and_then(|options| super::config::effort_config_id(options, value))
                        .is_some()
                })
            {
                match self.engine.call(
                    "session/set_config",
                    json!({
                        "sessionId": session_id,
                        "configId": model_options.as_ref().and_then(|options| super::config::effort_config_id(options, effort)),
                        "value": effort,
                    }),
                ) {
                    Ok(response) => {
                        model_options = super::config::response_options(&response).ok().or(model_options);
                    }
                    Err(error) => {
                        tracing::warn!(details = ?error.details, "effort pre-selection failed; continuing");
                    }
                }
            }
        }
        let resume = match restore_method {
            "resume" | "load" => Some(ResumeOutcome::Resumed),
            "new" if resume_session_id.is_some() => Some(ResumeOutcome::Unavailable),
            _ => None,
        };
        let session = LiveSession {
            session_id: session_id.clone(),
            profile_id: profile.id.clone(),
            cwd: workspace.to_path_buf(),
            model_options,
            engine_gen: self.engine.generation(),
        };
        tracing::debug!(
            session_id = %session.session_id,
            profile_id = %session.profile_id,
            restore_method = ?restore_method,
            "engine session opened"
        );
        if let Ok(mut guard) = self.session.lock() {
            *guard = Some(session.clone());
        }
        on_event(AcpEvent::SessionSaved {
            session_id,
            profile_id: profile.id.clone(),
            cwd: workspace.to_string_lossy().into_owned(),
            resume,
        });
        on_event(AcpEvent::Progress {
            message: "Agent 已就绪".into(),
        });
        Ok(session)
    }

    fn ensure_runtime_connected(
        &self,
        runtime: &EngineRuntime,
        workspace: &std::path::Path,
        profile: &super::model::AgentProfileInput,
        on_event: &mut dyn FnMut(AcpEvent),
    ) -> Result<(), AcpError> {
        let runtime_id = runtime.id().to_string();
        let engine_gen = self.engine.generation();
        let connected = self
            .connected_runtime
            .lock()
            .ok()
            .and_then(|guard| guard.clone());
        if connected
            .as_ref()
            .is_some_and(|(id, gen)| id == &runtime_id && *gen == engine_gen)
            && self.engine.is_alive()
        {
            return Ok(());
        }
        self.engine_connect(runtime, workspace, profile, on_event)?;
        if let Ok(mut guard) = self.connected_runtime.lock() {
            *guard = Some((runtime_id, self.engine.generation()));
        }
        Ok(())
    }

    /// Warm up Agent process + session without sending a prompt.
    #[allow(clippy::too_many_arguments)]
    pub fn connect<F>(
        &self,
        cwd: Option<String>,
        profile_id: Option<String>,
        saved_session: Option<SavedSessionHint>,
        client_settings: AcpClientSettings,
        profiles: AgentProfilesHint,
        mut on_event: F,
    ) -> Result<(), AcpError>
    where
        F: FnMut(AcpEvent),
    {
        if self.is_busy() {
            return Err(AcpError::busy());
        }
        let _exclusive = self.lock_exclusive()?;
        self.cancel.store(false, Ordering::SeqCst);
        if let Ok(mut guard) = self.permission_mode.lock() {
            *guard = client_settings.permission_mode;
        }
        let workspace = resolve_agent_workspace(cwd.as_deref())?;
        let profile = Self::resolve_profile(&profiles, profile_id.as_deref())?;
        let runtime = Self::runtime_for(profile)?;
        // Same live session on the same engine generation: nothing to do
        // beyond capability sync. A generation mismatch means the engine
        // respawned and the recorded session is a ghost: fall through and
        // reconnect instead of declaring a false "connected".
        {
            let guard = self
                .session
                .lock()
                .map_err(|_| AcpError::internal(Some("ACP session mutex poisoned")))?;
            if let Some(session) = guard.as_ref() {
                if session.profile_id == profile.id
                    && session.cwd == workspace
                    && session.engine_gen == self.engine.generation()
                    && self.engine.is_alive()
                {
                    drop(guard);
                    let mcp_servers =
                        self.mcp_servers_for(&workspace, client_settings.vision_capable);
                    let _ = mcp_servers;
                    on_event(AcpEvent::Progress {
                        message: "Agent 已连接".into(),
                    });
                    return Ok(());
                }
            }
        }
        self.drop_live_session();
        self.ensure_runtime_connected(&runtime, &workspace, profile, &mut on_event)?;
        let mcp_servers = self.mcp_servers_for(&workspace, client_settings.vision_capable);
        let resume_id = Self::resume_id_for(saved_session.as_ref(), &profile.id, &workspace);
        let _session = self.open_session(
            &workspace,
            profile,
            resume_id.as_deref(),
            mcp_servers,
            client_settings.model_selection(),
            &mut on_event,
        )?;
        Ok(())
    }

    /// Start a fresh chat session (new conversation on the live client).
    pub fn new_chat<F>(
        &self,
        cwd: Option<String>,
        profile_id: Option<String>,
        client_settings: AcpClientSettings,
        profiles: AgentProfilesHint,
        mut on_event: F,
    ) -> Result<(), AcpError>
    where
        F: FnMut(AcpEvent),
    {
        if self.is_busy() {
            return Err(AcpError::busy());
        }
        let _exclusive = self.lock_exclusive()?;
        self.cancel.store(false, Ordering::SeqCst);
        if let Ok(mut guard) = self.permission_mode.lock() {
            *guard = client_settings.permission_mode;
        }
        let workspace = resolve_agent_workspace(cwd.as_deref())?;
        let profile = Self::resolve_profile(&profiles, profile_id.as_deref())?.clone();
        on_event(AcpEvent::Progress {
            message: "正在开始新对话…".into(),
        });
        self.drop_live_session();
        self.ensure_runtime_connected(
            &Self::runtime_for(&profile)?,
            &workspace,
            &profile,
            &mut on_event,
        )?;
        let mcp_servers = self.mcp_servers_for(&workspace, client_settings.vision_capable);
        let _session = self.open_session(
            &workspace,
            &profile,
            None,
            mcp_servers,
            client_settings.model_selection(),
            &mut on_event,
        )?;
        on_event(AcpEvent::Progress {
            message: "已开启新对话".into(),
        });
        Ok(())
    }

    /// Switch the visible conversation (resume-or-create on the live client).
    pub fn switch_session<F>(
        &self,
        cwd: Option<String>,
        profile_id: Option<String>,
        saved_session: Option<SavedSessionHint>,
        client_settings: AcpClientSettings,
        profiles: AgentProfilesHint,
        mut on_event: F,
    ) -> Result<(), AcpError>
    where
        F: FnMut(AcpEvent),
    {
        self.connect_inner(
            cwd,
            profile_id,
            saved_session,
            client_settings,
            profiles,
            "正在切换对话…",
            &mut on_event,
        )
    }

    /// Honor a saved-session hint only when it belongs to this profile and
    /// resolves to this workspace. Cross-profile/cross-directory hints are
    /// silently dropped: resuming a foreign session id is meaningless across
    /// agent runtimes and is the classic broken-resume loop.
    fn resume_id_for(
        hint: Option<&SavedSessionHint>,
        profile_id: &str,
        workspace: &std::path::Path,
    ) -> Option<String> {
        let hint = hint?;
        if hint.profile_id != profile_id || hint.session_id.trim().is_empty() {
            return None;
        }
        let hint_workspace = resolve_agent_workspace(Some(&hint.cwd)).ok()?;
        if hint_workspace != workspace {
            return None;
        }
        Some(hint.session_id.clone())
    }

    #[allow(clippy::too_many_arguments)]
    fn connect_inner(
        &self,
        cwd: Option<String>,
        profile_id: Option<String>,
        saved_session: Option<SavedSessionHint>,
        client_settings: AcpClientSettings,
        profiles: AgentProfilesHint,
        progress: &str,
        on_event: &mut dyn FnMut(AcpEvent),
    ) -> Result<(), AcpError> {
        if self.is_busy() {
            return Err(AcpError::busy());
        }
        let _exclusive = self.lock_exclusive()?;
        self.cancel.store(false, Ordering::SeqCst);
        if let Ok(mut guard) = self.permission_mode.lock() {
            *guard = client_settings.permission_mode;
        }
        let workspace = resolve_agent_workspace(cwd.as_deref())?;
        let profile = Self::resolve_profile(&profiles, profile_id.as_deref())?.clone();
        on_event(AcpEvent::Progress {
            message: progress.to_string(),
        });
        self.drop_live_session();
        self.ensure_runtime_connected(
            &Self::runtime_for(&profile)?,
            &workspace,
            &profile,
            on_event,
        )?;
        let mcp_servers = self.mcp_servers_for(&workspace, client_settings.vision_capable);
        let resume_id = Self::resume_id_for(saved_session.as_ref(), &profile.id, &workspace);
        let _session = self.open_session(
            &workspace,
            &profile,
            resume_id.as_deref(),
            mcp_servers,
            client_settings.model_selection(),
            on_event,
        )?;
        Ok(())
    }

    // ---- prompt --------------------------------------------------------

    /// Send one prompt on the live session (connecting first when needed).
    #[allow(clippy::too_many_arguments)]
    pub fn prompt<F>(
        &self,
        text: String,
        cwd: Option<String>,
        profile_id: Option<String>,
        images: Vec<PromptImage>,
        saved_session: Option<SavedSessionHint>,
        client_settings: AcpClientSettings,
        profiles: AgentProfilesHint,
        mut on_event: F,
    ) -> Result<String, AcpError>
    where
        F: FnMut(AcpEvent),
    {
        use super::model::validate_prompt_images;
        if text.trim().is_empty() && images.is_empty() {
            return Err(AcpError::bad_request("消息不能为空"));
        }
        validate_prompt_images(&images)?;
        let _guard = self.lock_busy()?;
        let _exclusive = self.lock_exclusive()?;
        self.cancel.store(false, Ordering::SeqCst);
        if let Ok(mut guard) = self.permission_mode.lock() {
            *guard = client_settings.permission_mode;
        }
        let workspace = resolve_agent_workspace(cwd.as_deref())?;
        let profile = Self::resolve_profile(&profiles, profile_id.as_deref())?.clone();
        // Reuse the live session only when it belongs to this
        // profile+workspace on the current engine generation.
        let engine_gen = self.engine.generation();
        let live = self
            .session
            .lock()
            .ok()
            .and_then(|guard| guard.clone())
            .filter(|session| {
                session.profile_id == profile.id
                    && session.cwd == workspace
                    && session.engine_gen == engine_gen
            });
        let session = match live {
            Some(session) => session,
            None => {
                self.drop_live_session();
                self.ensure_runtime_connected(
                    &Self::runtime_for(&profile)?,
                    &workspace,
                    &profile,
                    &mut on_event,
                )?;
                let mcp_servers = self.mcp_servers_for(&workspace, client_settings.vision_capable);
                let resume_id =
                    Self::resume_id_for(saved_session.as_ref(), &profile.id, &workspace);
                self.open_session(
                    &workspace,
                    &profile,
                    resume_id.as_deref(),
                    mcp_servers,
                    client_settings.model_selection(),
                    &mut on_event,
                )?
            }
        };

        let images_param: Vec<Value> = images
            .iter()
            .map(|image| json!({ "mimeType": image.mime_type, "data": image.data }))
            .collect();
        let (tx, rx) = mpsc::channel();
        self.engine.set_update_sink(tx);
        let engine = self.engine.clone();
        let session_id = session.session_id.clone();
        let cancel_flag = std::sync::Arc::clone(&self.cancel);
        let worker = std::thread::Builder::new()
            .name("acp-engine-prompt".into())
            .spawn(move || {
                engine.request_cancellable(
                    "session/prompt",
                    json!({
                        "sessionId": session_id,
                        "promptText": text,
                        "timeoutMs": PROMPT_TIMEOUT_MS,
                        "images": images_param,
                    }),
                    &cancel_flag,
                )
            })
            .map_err(|_| AcpError::internal(Some("spawn prompt worker failed")))?;

        let mut full_text = String::new();
        let mut finished = false;
        while !finished {
            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok(note) => {
                    self.route_notification_text(&note, &mut on_event, &mut full_text);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if worker.is_finished() {
                        while let Ok(note) = rx.try_recv() {
                            self.route_notification_text(&note, &mut on_event, &mut full_text);
                        }
                        finished = true;
                    } else if self.cancel.load(Ordering::SeqCst) {
                        // Nudge the engine; the worker observes the flag too.
                        let _ = self
                            .engine
                            .call("session/cancel", json!({ "sessionId": session.session_id }));
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
            .map_err(|_| AcpError::internal(Some("prompt worker thread panicked")))?;
        match response {
            Ok(response) => {
                let stop_reason = response
                    .get("result")
                    .and_then(|result| result.get("stopReason"))
                    .and_then(Value::as_str)
                    .map(str::to_string);
                // A stopReason of `cancelled` with the flag set is a cancel,
                // not a protocol failure.
                if stop_reason.as_deref() == Some("cancelled") && self.cancel.load(Ordering::SeqCst)
                {
                    on_event(AcpEvent::Failed {
                        code: format!("{:?}", AcpErrorCode::Cancelled),
                        message: AcpError::cancelled().message,
                    });
                    return Err(AcpError::cancelled());
                }
                if full_text.trim().is_empty() {
                    on_event(AcpEvent::Failed {
                        code: format!("{:?}", AcpErrorCode::NoOutput),
                        message: AcpError::no_output(None).message,
                    });
                    return Err(AcpError::no_output(Some("agent returned no text")));
                }
                on_event(AcpEvent::Finished {
                    text: full_text.clone(),
                    stop_reason,
                });
                Ok(full_text)
            }
            Err(error) => {
                if error.code == AcpErrorCode::Cancelled {
                    on_event(AcpEvent::Failed {
                        code: format!("{:?}", AcpErrorCode::Cancelled),
                        message: error.message.clone(),
                    });
                    return Err(error);
                }
                on_event(AcpEvent::Failed {
                    code: format!("{:?}", error.code),
                    message: error.message.clone(),
                });
                Err(error)
            }
        }
    }

    /// Route one engine notification: forward projected events, return them.
    fn route_notification_collect(&self, note: &Value) -> Vec<AcpEvent> {
        match note.get("notification").and_then(Value::as_str) {
            Some("session/update") => {
                project_session_update(note.get("params").unwrap_or(&Value::Null))
            }
            Some("permission/request") => {
                match project_permission_request(note.get("params").unwrap_or(&Value::Null)) {
                    Some(event) => vec![event],
                    None => Vec::new(),
                }
            }
            _ => Vec::new(),
        }
    }

    fn permission_mode_auto(&self) -> bool {
        self.permission_mode
            .lock()
            .map(|guard| *guard == PermissionMode::Auto)
            .unwrap_or(true)
    }

    /// Auto-approve one engine permission request (Auto mode only).
    ///
    /// Mirrors the previous backend: Auto answers one-shot allow without
    /// bothering the UI and emits `PermissionResolved{auto}` for consistency.
    /// Returns true when answered here; false means the caller must forward
    /// the request to the UI (Ask mode or unusable payload).
    fn auto_approve_permission(&self, note: &Value, on_event: &mut dyn FnMut(AcpEvent)) -> bool {
        if !self.permission_mode_auto() {
            return false;
        }
        let params = note.get("params").unwrap_or(&Value::Null);
        let request_id = params
            .get("requestId")
            .and_then(Value::as_str)
            .map(str::to_string);
        let tool_call_id = params
            .get("toolCall")
            .and_then(|call| call.get("id"))
            .and_then(Value::as_str)
            .map(str::to_string);
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
        // Prefer one-shot allow, then any allow*, then the first option.
        let option_id = options
            .iter()
            .find(|(_, kind)| kind == "allow_once")
            .or_else(|| options.iter().find(|(_, kind)| kind.starts_with("allow")))
            .or_else(|| options.first())
            .map(|(id, _)| id.clone());
        let (Some(request_id), Some(option_id)) = (request_id, option_id) else {
            return false;
        };
        on_event(AcpEvent::PermissionResolved {
            tool_call_id,
            decision: "auto".to_string(),
        });
        let engine = self.engine.clone();
        std::thread::Builder::new()
            .name("acp-permission-auto".into())
            .spawn(move || {
                let _ = engine.call(
                    "permission/respond",
                    json!({
                        "requestId": request_id,
                        "outcome": { "outcome": "selected", "optionId": option_id },
                    }),
                );
            })
            .ok();
        true
    }

    fn route_notification(&self, note: &Value, on_event: &mut dyn FnMut(AcpEvent)) {
        let mut sink = String::new();
        self.route_notification_text(note, on_event, &mut sink);
    }

    /// Route one engine notification, accumulating assistant text. Auto mode
    /// answers permission requests inline instead of stalling the turn.
    fn route_notification_text(
        &self,
        note: &Value,
        on_event: &mut dyn FnMut(AcpEvent),
        full_text: &mut String,
    ) {
        if note.get("notification").and_then(Value::as_str) == Some("permission/request")
            && self.auto_approve_permission(note, on_event)
        {
            return;
        }
        for event in self.route_notification_collect(note) {
            if let AcpEvent::AgentMessage { ref text } = event {
                full_text.push_str(text);
            }
            on_event(event);
        }
    }

    // ---- control -------------------------------------------------------

    /// Soft-cancel: set flag + best-effort `session/cancel`.
    pub fn request_cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
        if let Ok(guard) = self.session.lock() {
            if let Some(session) = guard.as_ref() {
                let _ = self
                    .engine
                    .call("session/cancel", json!({ "sessionId": session.session_id }));
            }
        }
    }

    pub fn close_session(&self) -> Result<(), AcpError> {
        self.cancel.store(true, Ordering::SeqCst);
        let _ = self.engine.call("client/disconnect", Value::Null);
        self.drop_live_session();
        if let Ok(mut guard) = self.connected_runtime.lock() {
            *guard = None;
        }
        self.cancel.store(false, Ordering::SeqCst);
        Ok(())
    }

    pub fn close_session_for_shutdown(&self) {
        self.cancel.store(true, Ordering::SeqCst);
        self.engine.shutdown();
        self.drop_live_session();
    }

    fn drop_live_session(&self) {
        if let Ok(mut guard) = self.session.lock() {
            *guard = None;
        }
    }

    pub fn respond_permission(
        &self,
        request_id: &str,
        option_id: Option<String>,
    ) -> Result<(), AcpError> {
        let outcome = match option_id.filter(|id| !id.trim().is_empty()) {
            Some(id) => json!({ "outcome": "selected", "optionId": id }),
            None => json!({ "outcome": "cancelled" }),
        };
        self.engine
            .call(
                "permission/respond",
                json!({ "requestId": request_id, "outcome": outcome }),
            )
            .map(|_| ())
            .map_err(|_| AcpError::bad_request("该权限请求已失效或不存在"))
    }

    // ---- sessions ------------------------------------------------------

    pub fn list_agent_sessions(
        &self,
        profile_id: Option<&str>,
        cwd: Option<&str>,
    ) -> Result<AgentSessionListResult, AcpError> {
        let connected = self
            .connected_runtime
            .lock()
            .ok()
            .and_then(|guard| guard.clone());
        let live = self.session.lock().ok().and_then(|guard| guard.clone());
        // Never spawn an agent just to list: without a matching connection
        // on the current engine generation there is nothing authoritative
        // to report.
        let engine_gen = self.engine.generation();
        let generation_ok = connected
            .as_ref()
            .is_some_and(|(_, gen)| *gen == engine_gen)
            && live
                .as_ref()
                .is_none_or(|session| session.engine_gen == engine_gen);
        let usable = match (&connected, &live, profile_id) {
            (Some(_), Some(session), Some(requested)) if session.profile_id != requested => false,
            (Some(_), _, _) => generation_ok && self.engine.is_alive(),
            _ => false,
        };
        if !usable {
            return Ok(AgentSessionListResult::default());
        }
        // Normalize the hint the same way sessions are created, otherwise
        // the agent's cwd filter never matches hashed workspaces.
        let workspace = match cwd.filter(|hint| !hint.trim().is_empty()) {
            Some(hint) => match resolve_agent_workspace(Some(hint)) {
                Ok(workspace) => workspace,
                Err(_) => return Ok(AgentSessionListResult::default()),
            },
            None => live.map(|session| session.cwd).unwrap_or_default(),
        };
        let response = self.engine.call(
            "session/list",
            json!({ "cwd": workspace.to_string_lossy() }),
        )?;
        let sessions = response
            .get("sessions")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        serde_json::from_value::<AgentSessionInfo>(item.clone()).ok()
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok(AgentSessionListResult {
            sessions,
            verified: response
                .get("verified")
                .and_then(Value::as_bool)
                .unwrap_or(true),
            truncated: false,
        })
    }

    pub fn delete_session(
        &self,
        profile_id: Option<String>,
        session_id: String,
    ) -> Result<(), AcpError> {
        let session_id = session_id.trim();
        if session_id.is_empty() {
            return Err(AcpError::bad_request("会话标识不能为空"));
        }
        if let Ok(guard) = self.session.lock() {
            if let Some(session) = guard
                .as_ref()
                .filter(|session| session.engine_gen == self.engine.generation())
            {
                if let Some(requested) = profile_id.as_deref().filter(|id| !id.trim().is_empty()) {
                    if session.profile_id != requested {
                        return Err(AcpError::bad_request(
                            "该对话属于其他 Agent，请先切换到对应 Agent 再删除",
                        ));
                    }
                }
                if session.session_id == session_id {
                    return Err(AcpError::bad_request("不能删除正在使用的对话"));
                }
            }
        }
        let _ = self
            .engine
            .call("session/delete", json!({ "sessionId": session_id }));
        Ok(())
    }

    /// Replay a stored thread's text via agent `session/load`.
    pub fn load_session_transcript(
        &self,
        profile_id: Option<String>,
        session_id: String,
        cwd: Option<String>,
    ) -> Result<Vec<LoadedTurn>, AcpError> {
        let session_id = session_id.trim();
        if session_id.is_empty() {
            return Err(AcpError::bad_request("会话标识不能为空"));
        }
        let _guard = self.lock_busy()?;
        let _exclusive = self.lock_exclusive()?;
        self.cancel.store(false, Ordering::SeqCst);
        let engine_gen = self.engine.generation();
        let live = self
            .session
            .lock()
            .map_err(|_| AcpError::internal(Some("ACP session mutex poisoned")))?
            .clone()
            .filter(|session| session.engine_gen == engine_gen)
            .ok_or_else(|| AcpError::protocol(Some("no active agent session")))?;
        if let Some(requested) = profile_id.as_deref().filter(|id| !id.trim().is_empty()) {
            if live.profile_id != requested {
                return Err(AcpError::bad_request(
                    "该对话属于其他 Agent，请先切换到对应 Agent 再查看",
                ));
            }
        }
        let workspace = resolve_agent_workspace(cwd.as_deref())?;
        let mcp_servers = self.mcp_servers_for(&workspace, true);
        let (tx, rx) = mpsc::channel();
        self.engine.set_update_sink(tx);
        let engine = self.engine.clone();
        let params = json!({
            "method": "session/load",
            "params": {
                "sessionId": session_id,
                "cwd": workspace.to_string_lossy(),
                "mcpServers": mcp_servers,
            },
        });
        let worker = std::thread::Builder::new()
            .name("acp-engine-load".into())
            .spawn(move || engine.call("agent/request", params))
            .map_err(|_| AcpError::internal(Some("spawn load worker failed")))?;
        let deadline =
            std::time::Instant::now() + Duration::from_secs(LOAD_TRANSCRIPT_TIMEOUT_SECS);
        let mut projector = LoadTranscriptProjector::default();
        let mut load_error: Option<AcpError> = None;
        while !worker.is_finished() {
            if self.cancel.load(Ordering::SeqCst) {
                load_error = Some(AcpError::cancelled());
                break;
            }
            if std::time::Instant::now() > deadline {
                load_error = Some(AcpError::protocol(Some("session/load timed out")));
                break;
            }
            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok(note) => projector.push(&note),
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        while let Ok(note) = rx.try_recv() {
            projector.push(&note);
        }
        self.engine.clear_update_sink();
        let response = worker
            .join()
            .map_err(|_| AcpError::internal(Some("load worker thread panicked")))?;
        if let Some(error) = load_error {
            return Err(error);
        }
        match response {
            Ok(_) => Ok(projector.finish()),
            Err(error) => Err(AcpError::protocol(error.details.as_deref())),
        }
    }

    // ---- model options -------------------------------------------------

    pub fn set_session_model<F>(
        &self,
        model_id: Option<String>,
        reasoning_effort: Option<String>,
        mut on_event: F,
    ) -> Result<AcpSessionModelOptions, AcpError>
    where
        F: FnMut(AcpEvent),
    {
        let session_id = self.live_session_id()?;
        let mut latest = self.session.lock().ok().and_then(|session| {
            session
                .as_ref()
                .and_then(|session| session.model_options.clone())
        });
        if let Some(id) = model_id.as_deref().filter(|value| !value.trim().is_empty()) {
            on_event(AcpEvent::Progress {
                message: format!("正在切换模型到 {id}…"),
            });
            let response = self.engine.call(
                "session/set_config",
                json!({ "sessionId": session_id, "configId": latest.as_ref().map(super::config::model_config_id).unwrap_or("model"), "value": id }),
            )?;
            latest = Some(super::config::response_options(&response)?);
        }
        if let Some(effort) = reasoning_effort
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            on_event(AcpEvent::Progress {
                message: format!("正在设置推理深度到 {effort}…"),
            });
            let config_id = latest
                .as_ref()
                .and_then(|options| super::config::effort_config_id(options, effort))
                .ok_or_else(|| AcpError::bad_request("该模型不支持所选思考档"))?;
            let response = self.engine.call(
                "session/set_config",
                json!({
                    "sessionId": session_id,
                    "configId": config_id,
                    "value": effort,
                }),
            )?;
            latest = Some(super::config::response_options(&response)?);
        }
        let mut latest = latest.ok_or_else(|| AcpError::protocol(Some("no model options")))?;
        // Fill gaps the engine omits (it only returns what changed).
        if latest.current_model_id.is_none() {
            latest.current_model_id = model_id.filter(|id| !id.trim().is_empty());
        }
        if latest.current_reasoning_effort.is_none() {
            latest.current_reasoning_effort =
                reasoning_effort.filter(|value| !value.trim().is_empty());
        }
        if let Ok(mut guard) = self.session.lock() {
            if let Some(session) = guard.as_mut() {
                session.model_options = Some(latest.clone());
            }
        }
        Ok(latest)
    }

    pub fn set_session_config<F>(
        &self,
        config_id: String,
        value: String,
        mut on_event: F,
    ) -> Result<AcpSessionModelOptions, AcpError>
    where
        F: FnMut(AcpEvent),
    {
        let config_id = config_id.trim().to_string();
        if config_id.is_empty() {
            return Err(AcpError::bad_request("配置项 id 不能为空"));
        }
        let session_id = self.live_session_id()?;
        on_event(AcpEvent::Progress {
            message: format!("正在设置 {config_id} 到 {value}…"),
        });
        let parsed: Value = if value.eq_ignore_ascii_case("true") {
            json!(true)
        } else if value.eq_ignore_ascii_case("false") {
            json!(false)
        } else {
            json!(value)
        };
        let response = self.engine.call(
            "session/set_config",
            json!({ "sessionId": session_id, "configId": config_id, "value": parsed }),
        )?;
        let options = super::config::response_options(&response)?;
        if let Ok(mut guard) = self.session.lock() {
            if let Some(session) = guard.as_mut() {
                session.model_options = Some(options.clone());
            }
        }
        Ok(options)
    }

    fn live_session_id(&self) -> Result<String, AcpError> {
        let engine_gen = self.engine.generation();
        self.session
            .lock()
            .ok()
            .and_then(|guard| guard.clone())
            .filter(|session| session.engine_gen == engine_gen)
            .map(|session| session.session_id)
            .ok_or_else(|| AcpError::protocol(Some("no active agent session")))
    }
}

struct BusyGuard<'a> {
    busy: &'a AtomicBool,
}

impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.busy.store(false, Ordering::SeqCst);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum EngineRuntime {
    Builtin(&'static str),
    Custom(String, Vec<String>),
}

impl EngineRuntime {
    pub(crate) fn id(&self) -> &str {
        match self {
            Self::Builtin(id) => id,
            Self::Custom(..) => "custom",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ghost_session() -> LiveSession {
        LiveSession {
            session_id: "ghost".to_string(),
            profile_id: "opencode".to_string(),
            cwd: PathBuf::from("C:\\ghost"),
            model_options: None,
            // Never-spawned engine sits at generation 0; any recorded
            // session from a dead engine is stale by construction.
            engine_gen: u64::MAX,
        }
    }

    #[test]
    fn stale_generation_invalidates_ghost_session() {
        let service = AcpService::new();
        assert_eq!(service.engine.generation(), 0);
        *service.session.lock().expect("session lock") = Some(ghost_session());
        // `live_session_id` never touches the engine process: pure state check.
        assert!(service.live_session_id().is_err());
    }

    #[test]
    fn resume_hint_is_namespaced_by_profile_and_workspace() {
        let media_dir = std::env::temp_dir().join("dawnsight-acp-hint-test");
        std::fs::create_dir_all(&media_dir).expect("mkdir");
        let media_hint = media_dir.to_str().expect("utf8").to_string();
        let workspace = resolve_agent_workspace(Some(&media_hint)).expect("workspace");
        let hint = SavedSessionHint {
            session_id: "ses_1".to_string(),
            profile_id: "codex".to_string(),
            cwd: media_hint,
        };
        // Matching profile + directory: honored.
        assert_eq!(
            AcpService::resume_id_for(Some(&hint), "codex", &workspace),
            Some("ses_1".to_string())
        );
        // Foreign profile: dropped.
        assert!(AcpService::resume_id_for(Some(&hint), "opencode", &workspace).is_none());
        // Same profile but foreign directory: dropped.
        let other = resolve_agent_workspace(None).expect("default root");
        if other != workspace {
            assert!(AcpService::resume_id_for(Some(&hint), "codex", &other).is_none());
        }
        // Empty id: dropped.
        let empty = SavedSessionHint {
            session_id: "  ".to_string(),
            profile_id: "codex".to_string(),
            cwd: hint.cwd.clone(),
        };
        assert!(AcpService::resume_id_for(Some(&empty), "codex", &workspace).is_none());
        // Missing hint: dropped.
        assert!(AcpService::resume_id_for(None, "codex", &workspace).is_none());
        let _ = std::fs::remove_dir_all(&media_dir);
    }

    fn permission_note() -> serde_json::Value {
        serde_json::json!({
            "notification": "permission/request",
            "params": {
                "requestId": "req_1",
                "sessionId": "ses_1",
                "toolCall": { "id": "t1", "title": "read file" },
                "params": {
                    "options": [
                        { "optionId": "allow_once", "name": "Allow once", "kind": "allow_once" },
                        { "optionId": "deny", "name": "Deny", "kind": "deny" },
                    ],
                },
            },
        })
    }

    #[test]
    fn ask_mode_forwards_permission_to_ui() {
        let service = AcpService::new();
        *service.permission_mode.lock().expect("mode lock") = PermissionMode::Ask;
        let mut events = Vec::new();
        // Ask mode never answers inline: false tells the caller to forward
        // the request event to the UI.
        assert!(!service
            .auto_approve_permission(&permission_note(), &mut |event| { events.push(event) }));
        assert!(events.is_empty());
    }

    #[test]
    fn auto_mode_approves_without_ui_event() {
        let service = AcpService::new();
        *service.permission_mode.lock().expect("mode lock") = PermissionMode::Auto;
        let mut events = Vec::new();
        // Well-formed request in Auto mode is answered inline (a worker
        // thread responds to the engine); the UI only sees the resolution.
        // Skipped when the engine binary is absent to avoid spawning nothing.
        if !super::super::engine::engine_binary_present() {
            eprintln!("SKIP: acp-engine binary missing");
            return;
        }
        assert!(service
            .auto_approve_permission(&permission_note(), &mut |event| { events.push(event) }));
        assert!(matches!(
            events.as_slice(),
            [AcpEvent::PermissionResolved { .. }]
        ));
        std::thread::sleep(std::time::Duration::from_secs(2));
    }

    /// Live regression for the Auto-approve path: a prompt that drives the
    /// agent into dawnsight MCP tools must answer in minutes, not stall on
    /// an unanswered permission request. Needs engine + codex login + network.
    /// Run explicitly (the suite skips it by default).
    #[test]
    #[ignore = "needs acp-engine binary + logged-in codex + network (~4min)"]
    fn prompt_with_mcp_tools_auto_approves() {
        crate::acp::adapter::install_session_environment();
        let service = AcpService::new();
        assert!(service.permission_mode_auto());
        let hint: AgentProfilesHint = serde_json::from_value(serde_json::json!({
            "activeProfileId": "codex",
            "profiles": [{
                "id": "codex",
                "name": "ChatGPT",
                "kind": "Codex",
                "command": "bunx.exe",
                "args": ["@agentclientprotocol/codex-acp@latest"],
                "env": {},
            }],
        }))
        .expect("codex hint parses");
        let workspace = std::env::temp_dir().join(format!(
            "dawnsight-auto-approve-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&workspace).expect("test workspace");
        let workspace_text = workspace.to_str().expect("utf8").to_string();
        let started = std::time::Instant::now();
        let text = service
            .prompt(
                "调用 dawnsight MCP 工具查询当前媒体信息，然后用一句话中文总结你看到了什么。"
                    .to_string(),
                Some(workspace_text),
                Some("codex".to_string()),
                Vec::new(),
                None,
                AcpClientSettings::default(),
                hint,
                |event| {
                    if let AcpEvent::Failed { code, message } = &event {
                        panic!("prompt failed event: {code} {message}");
                    }
                },
            )
            .expect("prompt answers");
        let elapsed = started.elapsed();
        assert!(!text.trim().is_empty(), "prompt returned no text");
        assert!(
            elapsed < std::time::Duration::from_secs(300),
            "tool-call prompt stalled: {elapsed:?}"
        );
        service.close_session_for_shutdown();
        let _ = std::fs::remove_dir_all(&workspace);
    }

    #[test]
    fn auto_mode_without_options_falls_back_to_ui() {
        let service = AcpService::new();
        *service.permission_mode.lock().expect("mode lock") = PermissionMode::Auto;
        let note = serde_json::json!({
            "notification": "permission/request",
            "params": { "requestId": "req_9", "params": { "options": [] } },
        });
        let mut events = Vec::new();
        assert!(!service.auto_approve_permission(&note, &mut |event| { events.push(event) }));
        assert!(events.is_empty());
    }

    /// Live contract: the status lineup comes from the engine runtime
    /// registry (ids, names, launch specs), never from a hardcoded matrix.
    /// Needs the engine binary. Run explicitly (the suite skips it by default).
    #[test]
    #[ignore = "needs acp-engine binary (~30s)"]
    fn status_lineup_comes_from_engine_registry() {
        if !super::super::engine::engine_binary_present() {
            eprintln!("SKIP: acp-engine binary missing");
            return;
        }
        let service = AcpService::new();
        let hint = AgentProfilesHint {
            active_profile_id: "codex".to_string(),
            profiles: Vec::new(),
        };
        let status = service.status(&hint);
        assert!(status.adapter_found);
        let ids: Vec<&str> = status
            .profiles
            .iter()
            .map(|profile| profile.id.as_str())
            .collect();
        // Engine transport ids surface as stable product ids.
        for expected in [
            "codex",
            "claude",
            "cursor",
            "deepseek",
            "gemini",
            "copilot",
            "opencode",
            "opencode-v2",
            "agy",
        ] {
            assert!(
                ids.contains(&expected),
                "engine lineup missing {expected}: {ids:?}"
            );
        }
        // Launch specs ride along (pool + UI spawn from these, not defaults).
        let codex = status
            .profiles
            .iter()
            .find(|profile| profile.id == "codex")
            .expect("codex entry");
        assert!(!codex.command.trim().is_empty());
        assert!(!codex.args.is_empty());
        service.close_session_for_shutdown();
    }

    /// Engine-only lineup: app-side hint entries never surface in status.
    /// Runs without the engine binary (that is exactly the path under test);
    /// skips when a binary is present since the live registry takes over.
    #[test]
    fn status_without_engine_reports_empty_lineup() {
        if super::super::engine::engine_binary_present() {
            eprintln!("SKIP: acp-engine binary present, live registry owns lineup");
            return;
        }
        let service = AcpService::new();
        let hint = AgentProfilesHint {
            active_profile_id: "codex".to_string(),
            profiles: vec![
                crate::acp::model::AgentProfileInput {
                    id: "codex".to_string(),
                    name: "ChatGPT".to_string(),
                    kind: crate::acp::model::AgentKind::Codex,
                    command: "bunx".to_string(),
                    args: vec!["pkg".to_string()],
                    env: std::collections::HashMap::new(),
                    launcher: None,
                    env_preset: None,
                    auth_policy: None,
                    auth_methods: Vec::new(),
                    session_storage: None,
                },
                crate::acp::model::AgentProfileInput {
                    id: "stale-copy".to_string(),
                    name: "ChatGPT".to_string(),
                    kind: crate::acp::model::AgentKind::Custom,
                    command: String::new(),
                    args: Vec::new(),
                    env: std::collections::HashMap::new(),
                    launcher: None,
                    env_preset: None,
                    auth_policy: None,
                    auth_methods: Vec::new(),
                    session_storage: None,
                },
            ],
        };
        let status = service.status(&hint);
        assert!(!status.adapter_found);
        assert!(status.profiles.is_empty());
        service.close_session_for_shutdown();
    }

    #[test]
    fn runtime_ids_translate_to_stable_product_ids() {
        assert_eq!(AcpService::profile_id_for_runtime_id("codex-acp"), "codex");
        assert_eq!(
            AcpService::profile_id_for_runtime_id("cursor-cli"),
            "cursor"
        );
        assert_eq!(
            AcpService::profile_id_for_runtime_id("opencode"),
            "opencode"
        );
        // Unknown future ids (e.g. `opencode-v2`) pass through so new engine
        // releases need no backend change.
        assert_eq!(
            AcpService::profile_id_for_runtime_id("opencode-v2"),
            "opencode-v2"
        );
    }
}

/// Convert the engine `modelOptions` projection into [`AcpSessionModelOptions`].
pub(crate) fn convert_engine_model_options(
    value: &Value,
) -> Result<AcpSessionModelOptions, AcpError> {
    let option = |item: &Value| {
        Some(AcpSessionOption {
            value: item.get("value")?.as_str()?.to_string(),
            name: item
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            description: item
                .get("description")
                .and_then(Value::as_str)
                .map(str::to_string),
        })
    };
    let models = value
        .get("models")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(option).collect())
        .unwrap_or_default();
    let mut reasoning_efforts = Vec::new();
    let mut extra_options = Vec::new();
    if let Some(items) = value.get("extra_options").and_then(Value::as_array) {
        for item in items {
            let id = item.get("id").and_then(Value::as_str).unwrap_or("");
            let name = item
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(id)
                .to_string();
            let kind = item.get("kind");
            let select = kind.and_then(|kind| kind.get("Select"));
            let boolean = kind.and_then(|kind| kind.get("Boolean"));
            if id == "reasoning_effort" {
                if let Some(select) = select {
                    for entry in select
                        .get("options")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                        .filter_map(option)
                    {
                        reasoning_efforts.push(entry);
                    }
                }
            }
            let kind = if let Some(select) = select {
                SessionConfigKind::Select {
                    options: select
                        .get("options")
                        .and_then(Value::as_array)
                        .map(|entries| {
                            entries
                                .iter()
                                .filter_map(|entry| {
                                    Some(SessionConfigValue {
                                        value: entry.get("value")?.as_str()?.to_string(),
                                        name: entry
                                            .get("name")
                                            .and_then(Value::as_str)
                                            .unwrap_or("")
                                            .to_string(),
                                        description: entry
                                            .get("description")
                                            .and_then(Value::as_str)
                                            .map(str::to_string),
                                    })
                                })
                                .collect()
                        })
                        .unwrap_or_default(),
                    current: select
                        .get("current")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                }
            } else if let Some(boolean) = boolean {
                SessionConfigKind::Boolean {
                    current: boolean
                        .get("current")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                }
            } else {
                SessionConfigKind::Unsupported
            };
            extra_options.push(SessionConfigOption {
                id: id.to_string(),
                name,
                description: None,
                category: None,
                kind,
            });
        }
    }
    Ok(AcpSessionModelOptions {
        models,
        reasoning_efforts,
        current_model_id: value
            .get("current_model_id")
            .and_then(Value::as_str)
            .map(str::to_string),
        current_reasoning_effort: value
            .get("current_reasoning_effort")
            .and_then(Value::as_str)
            .map(str::to_string),
        extra_options,
    })
}

/// Accumulates `session/load` history replay into public turns.
#[derive(Default)]
struct LoadTranscriptProjector {
    turns: Vec<LoadedTurn>,
    pending_role: Option<String>,
    pending_text: String,
}

impl LoadTranscriptProjector {
    fn push(&mut self, note: &Value) {
        let params = note.get("params").unwrap_or(note);
        let update = params.get("update").unwrap_or(params);
        let kind = update.get("sessionUpdate").and_then(Value::as_str);
        let (role, text) = match kind {
            Some("user_message_chunk") => ("user", content_blocks_text(update.get("content"))),
            Some("agent_message_chunk") => ("agent", content_blocks_text(update.get("content"))),
            _ => return,
        };
        if text.is_empty() {
            return;
        }
        match self.pending_role.as_deref() {
            Some(current) if current == role => {
                self.pending_text.push_str(&text);
            }
            _ => {
                self.flush();
                self.pending_role = Some(role.to_string());
                self.pending_text = text;
            }
        }
        if self.pending_text.len() > MAX_LOADED_TRANSCRIPT_MESSAGE_CHARS {
            self.pending_text
                .truncate(MAX_LOADED_TRANSCRIPT_MESSAGE_CHARS);
        }
    }

    fn flush(&mut self) {
        if let Some(role) = self.pending_role.take() {
            if self.turns.len() < MAX_LOADED_TRANSCRIPT_TURNS {
                if let Some(turn) = LoadedTurn::new(&role, std::mem::take(&mut self.pending_text)) {
                    self.turns.push(turn);
                }
            }
            self.pending_text.clear();
        }
    }

    fn finish(mut self) -> Vec<LoadedTurn> {
        self.flush();
        self.turns
    }
}

impl Default for AcpService {
    fn default() -> Self {
        Self::new()
    }
}
