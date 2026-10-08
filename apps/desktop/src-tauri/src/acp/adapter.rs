//! App-side ACP adapters.
//!
//! Warm chat-snapshot state and all MCP/library IO live here so the
//! sidecar engine stays a generic transport. Session launch itself is owned
//! by `@yitom/acp-client` (compiled to the `acp-engine` sidecar).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use super::{AcpError, SessionEnvironment, SessionKind, VideoPromptContext};

use crate::library::MediaLibraryService;
use crate::mcp::{
    read_snapshot, snapshot_path_for_cwd, sync_snapshot_capabilities,
    write_chapter_task_snapshot as write_scoped_snapshot, write_snapshot, AgentCapabilities,
    ChapterTaskContext, DawnsightMcpSnapshot, PromptAnchor, PromptSnapshotState,
};

/// MCP-backed [`SessionEnvironment`] for sidecar sessions.
pub struct AppSessionEnvironment;

static MCP_DIAGNOSTIC_SEQUENCE: AtomicU64 = AtomicU64::new(1);

fn next_mcp_diagnostic_id() -> String {
    let sequence = MCP_DIAGNOSTIC_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let unix_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("{}-{unix_ms}-{sequence}", std::process::id())
}

impl SessionEnvironment for AppSessionEnvironment {
    fn snapshot_path(&self, cwd: &Path, kind: SessionKind) -> PathBuf {
        match kind {
            SessionKind::Chapter => cwd.join(".dawnsight").join("chapter-agent-context.json"),
            SessionKind::Chat | SessionKind::Workshop => snapshot_path_for_cwd(cwd),
        }
    }

    fn sync_snapshot(&self, snapshot_path: &Path, vision_capable: bool) -> Result<(), String> {
        // MCP 反向控制（seek）按会话工作区登记：snapshot 在
        // `<workspace>/.dawnsight/agent-context.json`，工作区是其祖父目录。
        if let Some(workspace) = snapshot_path.parent().and_then(|parent| parent.parent()) {
            crate::acp::mcp_control::register_workspace(workspace);
        }
        sync_snapshot_capabilities(snapshot_path, vision_capable)
    }

    fn mcp_servers(&self, snapshot_path: &Path, kind: SessionKind) -> serde_json::Value {
        let profile = mcp_profile_for_session(kind);
        let diagnostic_id = next_mcp_diagnostic_id();
        tracing::info!(
            diagnostic_id = %diagnostic_id,
            profile = %profile.env_value(),
            session_kind = ?kind,
            snapshot = %snapshot_path.display(),
            "prepared Dawnsight MCP server environment"
        );
        let mut servers = crate::mcp::dawnsight_mcp_servers(snapshot_path);
        if let Some(env) = servers
            .as_array_mut()
            .and_then(|list| list.first_mut())
            .and_then(|server| server.get_mut("env"))
            .and_then(serde_json::Value::as_array_mut)
        {
            env.push(serde_json::json!({
                "name": crate::mcp::TOOL_PROFILE_ENV,
                "value": profile.env_value(),
            }));
            env.push(serde_json::json!({
                "name": crate::mcp::DIAGNOSTIC_LOG_ENV,
                "value": crate::commands::system::log_dir()
                    .join("dawnsight-mcp.log")
                    .to_string_lossy(),
            }));
            env.push(serde_json::json!({
                "name": crate::mcp::DIAGNOSTIC_ID_ENV,
                "value": diagnostic_id,
            }));
        }
        servers
    }

    fn snapshot_vision_capable(&self, workspace: &Path) -> Option<bool> {
        read_snapshot(&snapshot_path_for_cwd(workspace))
            .ok()
            .and_then(|snapshot| {
                snapshot
                    .capabilities
                    .map(|capabilities| capabilities.vision_capable)
            })
    }
}

fn mcp_profile_for_session(kind: SessionKind) -> crate::mcp::McpToolProfile {
    match kind {
        SessionKind::Workshop => crate::mcp::McpToolProfile::NoTools,
        SessionKind::Chat | SessionKind::Chapter => crate::mcp::McpToolProfile::Chat,
    }
}

/// Installed once at startup; sidecar `session/open` wiring uses it.
pub fn install_session_environment() -> bool {
    super::environment::set_default_environment(Arc::new(AppSessionEnvironment))
}

/// Seed an isolated chapter session with its complete durable scope.
///
/// The MCP server treats the snapshot as the authority for task/attempt/
/// episode ownership. The database path is supplied by the desktop command
/// rather than by Agent arguments.
pub fn write_chapter_task_snapshot(
    cwd: &Path,
    media_path: &Path,
    position_ms: u64,
    duration_ms: u64,
    subtitle_choice_id: Option<&str>,
    chapter_task: ChapterTaskContext,
) -> Result<PathBuf, AcpError> {
    let environment = AppSessionEnvironment;
    let snapshot_path = environment.snapshot_path(cwd, SessionKind::Chapter);
    let snapshot = DawnsightMcpSnapshot {
        schema_version: crate::mcp::SNAPSHOT_SCHEMA_VERSION,
        anchor: Some(PromptAnchor {
            media_path: media_path.to_string_lossy().into_owned(),
            media_title: None,
            library_root: None,
            group_key: None,
            season: None,
            episode: None,
            position_ms,
            duration_ms: Some(duration_ms),
            sent_at_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_millis())
                .unwrap_or_default(),
            subtitle_choice_id: subtitle_choice_id
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            transcript_window_radius_sec: None,
        }),
        current_episode: None,
        library: None,
        session: None,
        capabilities: Some(AgentCapabilities {
            vision_capable: true,
            subtitle_workshop_enabled: false,
            video_annotations_enabled: true,
        }),
        online: None,
        updated_at_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or_default(),
    };
    write_scoped_snapshot(&snapshot_path, &snapshot, &chapter_task)
        .map_err(|error| AcpError::internal(Some(&error)))?;
    Ok(snapshot_path)
}

/// Build the next chat prompt snapshot (warm library policy).
/// Converts the ACP prompt context into MCP's own generic input (M7).
pub fn build_prompt_snapshot(
    snapshots: &Mutex<PromptSnapshotState>,
    library: &MediaLibraryService,
    context: Option<&VideoPromptContext>,
    vision_capable: bool,
) -> Result<(DawnsightMcpSnapshot, bool), AcpError> {
    let context = context.map(|context| crate::mcp::McpPromptContext {
        media_path: context.media_path.clone(),
        media_title: context.media_title.clone(),
        position_ms: context.position_ms,
        duration_ms: context.duration_ms,
        subtitle_choice_id: context.subtitle_choice_id.clone(),
        transcript_window_radius_sec: context.transcript_window_radius_sec,
    });
    let mut guard = snapshots
        .lock()
        .map_err(|_| AcpError::internal(Some("prompt snapshot mutex poisoned")))?;
    let built = guard
        .next_snapshot(context.as_ref(), library, vision_capable)
        .map_err(|error| AcpError::internal(error.details.as_deref()))?;
    Ok((built.snapshot, built.media_changed))
}

/// Persist the chat prompt snapshot.
pub fn write_prompt_snapshot(
    cwd: &Path,
    snapshot: &DawnsightMcpSnapshot,
) -> Result<PathBuf, AcpError> {
    let path = snapshot_path_for_cwd(cwd);
    write_snapshot(&path, snapshot).map_err(|details| AcpError::internal(Some(&details)))?;
    Ok(path)
}

/// Record session capabilities.
pub fn sync_mcp_capabilities(cwd_hint: Option<&str>, vision_capable: bool) -> Result<(), AcpError> {
    let workspace = super::workspace::resolve_agent_workspace(cwd_hint)?;
    let path = snapshot_path_for_cwd(&workspace);
    sync_snapshot_capabilities(&path, vision_capable)
        .map_err(|details| AcpError::internal(Some(&details)))
}

/// Clear chat snapshot warm state (close / new chat).
pub fn reset_prompt_snapshot_state(snapshots: &Mutex<PromptSnapshotState>) {
    if let Ok(mut guard) = snapshots.lock() {
        guard.reset();
    }
}
