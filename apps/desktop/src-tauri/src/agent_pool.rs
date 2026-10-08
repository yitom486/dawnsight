//! agentpools-backed [`dawnsight_core::AgentInvoker`] for background AI jobs.
//!
//! Subtitle workshop (translate/proofread) and the library resolver run
//! data-only isolated prompts through a per-job pool (4 workers, ACP
//! transport, unattended permissions). The pool is owned by the calling
//! command and drops cleanly when the job finishes.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use agentpools::{AgentPool, PoolConfig, SessionLease};
use agentpools_acp::{AcpBackend, AcpConfig, AcpError, AcpPrompt};
use dawnsight_core::{AgentConversation, AgentInvoker, AgentTaskError, IsolatedAgentTask};

use crate::agent_stub::AgentProfilesHint;

/// Workers per job pool (matches the previous workshop default).
pub const WORKSHOP_POOL_SIZE: usize = 4;

pub struct PoolAgentInvoker {
    pool: Arc<AgentPool<AcpBackend>>,
}

struct PoolConversation {
    lease: SessionLease<AcpBackend>,
}

/// Pool construction inputs. `mcp_servers` carries opaque ACP MCP server
/// objects for tool-using sessions (chapter agent); data-only workshops
/// pass an empty vec (previous NoTools behavior).
pub struct PoolSpec<'a> {
    pub profiles: &'a AgentProfilesHint,
    pub profile_id: &'a str,
    pub model_id: Option<&'a str>,
    pub cwd: Option<&'a Path>,
    pub mcp_servers: Vec<serde_json::Value>,
}

/// Build a per-job pool invoker from an explicit profile selection.
///
/// `model_id` is fixed for the whole job (pool-level session config).
/// `reasoning_effort` has no pool-level knob in agentpools-acp and is ignored.
pub fn build_pool(spec: &PoolSpec<'_>) -> Result<PoolAgentInvoker, String> {
    let profile = spec
        .profiles
        .profiles
        .iter()
        .find(|profile| profile.id == spec.profile_id)
        .ok_or_else(|| "agent profile is missing".to_string())?;
    let mut tokens: Vec<String> = profile
        .command
        .split_whitespace()
        .map(str::to_string)
        .collect();
    tokens.extend(profile.args.iter().cloned());
    let program = tokens
        .first()
        .cloned()
        .filter(|token| !token.is_empty())
        .ok_or_else(|| "agent profile has empty command".to_string())?;
    // Bare command names resolve via PATH (with platform extension
    // handling); the resolved absolute path is what gets spawned, since
    // `std::process::Command` does not apply PATHEXT itself on Windows.
    // Compound/absolute programs go through spawn and fail there.
    let program = if program.contains(['/', '\\']) {
        program
    } else {
        which::which(&program)
            .map(|path| path.to_string_lossy().into_owned())
            .map_err(|_| format!("agent command not found: {program}"))?
    };
    let args: Vec<OsString> = tokens.into_iter().skip(1).map(OsString::from).collect();
    let workspace = match spec.cwd {
        Some(dir) => dir.to_path_buf(),
        None => {
            crate::acp::workspace::resolve_session_cwd(None).map_err(|error| error.to_string())?
        }
    };
    let mut config = AcpConfig::new(PathBuf::from(program), workspace);
    config.args = args;
    config.env = profile
        .env
        .iter()
        .map(|(key, value)| (OsString::from(key), OsString::from(value)))
        .collect();
    config.mcp_servers = spec.mcp_servers.clone();
    if let Some(model) = spec.model_id.filter(|id| !id.trim().is_empty()) {
        config.model = Some(model.trim().to_string());
    }
    // Background jobs have no UI permission roundtrip.
    config.auto_approve_permissions = true;
    let pool = AgentPool::new(
        AcpBackend,
        config,
        PoolConfig {
            workers: WORKSHOP_POOL_SIZE,
            max_queued: 128,
        },
    )
    .map_err(|error| format!("create agent pool: {error}"))?;
    Ok(PoolAgentInvoker {
        pool: Arc::new(pool),
    })
}

/// Build a data-only workshop pool (no MCP tools). Kept for subtitle and
/// library callers.
pub fn workshop_invoker(
    profiles: &AgentProfilesHint,
    profile_id: &str,
    model_id: Option<&str>,
    cwd: Option<&Path>,
) -> Result<PoolAgentInvoker, String> {
    build_pool(&PoolSpec {
        profiles,
        profile_id,
        model_id,
        cwd,
        mcp_servers: Vec::new(),
    })
}

fn map_acp_error(error: &AcpError) -> AgentTaskError {
    match error {
        AcpError::InvalidConfig(_) => AgentTaskError::NotConfigured {
            details: Some(error.to_string()),
        },
        AcpError::Cancelled => AgentTaskError::Failed {
            details: Some("已取消".to_string()),
        },
        AcpError::NoOutput => AgentTaskError::NoOutput {
            details: Some(error.to_string()),
        },
        _ => AgentTaskError::Failed {
            details: Some(error.to_string()),
        },
    }
}

fn map_task_error(error: agentpools::TaskError<AcpError>) -> AgentTaskError {
    match error {
        agentpools::TaskError::Open(inner) | agentpools::TaskError::Run { source: inner, .. } => {
            map_acp_error(&inner)
        }
        agentpools::TaskError::Cancelled => AgentTaskError::Failed {
            details: Some("已取消".to_string()),
        },
        agentpools::TaskError::WorkerStopped => AgentTaskError::Failed {
            details: Some("agent worker stopped".to_string()),
        },
    }
}

fn map_acquire_error(error: agentpools::AcquireError<AcpError>) -> AgentTaskError {
    match error {
        agentpools::AcquireError::Open(inner) => map_acp_error(&inner),
        agentpools::AcquireError::Cancelled => AgentTaskError::Failed {
            details: Some("已取消".to_string()),
        },
        _ => AgentTaskError::Failed {
            details: Some(error.to_string()),
        },
    }
}

impl AgentInvoker for PoolAgentInvoker {
    fn invoke_isolated(&self, task: IsolatedAgentTask) -> Result<String, AgentTaskError> {
        let lease = self.pool.acquire().map_err(map_acquire_error)?;
        let mut conversation = PoolConversation { lease };
        let text = conversation.prompt(task)?;
        conversation.lease.finish().map_err(map_acquire_error)?;
        Ok(text)
    }

    fn open_conversation<'a>(
        &'a self,
        _task_label: Option<String>,
    ) -> Result<Box<dyn AgentConversation + 'a>, AgentTaskError> {
        let lease = self.pool.acquire().map_err(map_acquire_error)?;
        Ok(Box::new(PoolConversation { lease }))
    }
}

impl AgentConversation for PoolConversation {
    fn prompt(&mut self, task: IsolatedAgentTask) -> Result<String, AgentTaskError> {
        let response = self
            .lease
            .ask(AcpPrompt::text(task.prompt))
            .map_err(map_task_error)?;
        Ok(response.text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hint_with(profile: crate::agent_stub::AgentProfileInput) -> AgentProfilesHint {
        AgentProfilesHint {
            active_profile_id: profile.id.clone(),
            profiles: vec![profile],
        }
    }

    fn profile(id: &str, command: &str) -> crate::agent_stub::AgentProfileInput {
        crate::agent_stub::AgentProfileInput {
            id: id.to_string(),
            name: id.to_string(),
            kind: crate::acp::AgentKind::Custom,
            command: command.to_string(),
            args: Vec::new(),
            env: std::collections::HashMap::new(),
            launcher: None,
            env_preset: None,
            auth_policy: None,
            auth_methods: Vec::new(),
            session_storage: None,
        }
    }

    #[test]
    fn workshop_invoker_rejects_missing_profile() {
        let hint = hint_with(profile("codex", "codex-acp"));
        let error = workshop_invoker(&hint, "nope", None, None)
            .err()
            .expect("missing profile errors");
        assert!(error.contains("missing"));
    }

    #[test]
    fn workshop_invoker_rejects_empty_command() {
        let hint = hint_with(profile("custom", ""));
        let error = workshop_invoker(&hint, "custom", None, None)
            .err()
            .expect("empty command errors");
        assert!(error.contains("empty command"));
    }

    #[test]
    fn workshop_invoker_rejects_unresolvable_command() {
        let hint = hint_with(profile("custom", "definitely-not-a-real-binary-xyz"));
        let error = workshop_invoker(&hint, "custom", None, None)
            .err()
            .expect("unresolvable command errors");
        assert!(error.contains("not found"));
    }

    /// Live smoke: subtitle-workshop path against real Codex (needs
    /// `bunx` + codex login; network). Run explicitly:
    /// `cargo test -p dawnsight-app --lib -- --ignored workshop_codex_smoke`.
    #[test]
    #[ignore = "needs logged-in codex CLI and network"]
    fn workshop_codex_smoke_prompt_roundtrip() {
        let hint_json = serde_json::json!({
            "activeProfileId": "codex",
            "profiles": [{
                "id": "codex",
                "name": "ChatGPT",
                "kind": "Codex",
                "command": "bunx.exe",
                "args": ["@agentclientprotocol/codex-acp@latest"],
                "env": {},
            }],
        });
        let hint: AgentProfilesHint = serde_json::from_value(hint_json).expect("codex hint parses");
        let invoker = workshop_invoker(&hint, "codex", None, None).expect("codex pool builds");
        let mut conversation = invoker
            .open_conversation(Some("workshop-codex-smoke".to_string()))
            .expect("codex lease acquired");
        let reply = conversation
            .prompt(dawnsight_core::IsolatedAgentTask {
                prompt: "Translate to Simplified Chinese. Reply with ONLY the translation: \"Good morning\"".to_string(),
                bootstrap_prompt: None,
                profile_id: "codex".to_string(),
                model_id: None,
                reasoning_effort: None,
                task_label: Some("workshop-codex-smoke".to_string()),
                retry_task_label: None,
            })
            .expect("codex prompt answers");
        assert!(!reply.trim().is_empty(), "codex returned no text");
        assert!(
            reply
                .chars()
                .any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c)),
            "expected Chinese translation, got: {reply}"
        );
    }

    #[test]
    fn agent_errors_map_to_business_variants() {
        let not_configured = map_acp_error(&AcpError::InvalidConfig("bad"));
        assert!(matches!(
            not_configured,
            AgentTaskError::NotConfigured { .. }
        ));
        let no_output = map_acp_error(&AcpError::NoOutput);
        assert!(matches!(no_output, AgentTaskError::NoOutput { .. }));
        let failed = map_acp_error(&AcpError::Timeout("prompt"));
        assert!(matches!(failed, AgentTaskError::Failed { .. }));
        let cancelled = map_task_error(agentpools::TaskError::Cancelled);
        assert!(matches!(cancelled, AgentTaskError::Failed { .. }));
    }
}
