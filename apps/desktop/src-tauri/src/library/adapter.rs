//! App-side library adapters (M7).
//!
//! Agent-backed resolver/discovery orchestration over agentpools (ACP
//! transport, per-call pools). Direct-API providers never touch the agent.

use crate::agent_pool::workshop_invoker;
use crate::agent_stub::{AgentProfilesHint, OfflineAgentInvoker};
use crate::library::{AgentModelDiscoveryResult, LibraryError, ResolverProviderConfig};
use dawnsight_core::{AgentInvoker, AgentTaskError, IsolatedAgentTask};

/// Agent invoker for library calls: pooled ACP session when profiles resolve,
/// offline otherwise (direct-API providers never invoke it successfully).
pub enum LibraryAgentInvoker {
    Pool(crate::agent_pool::PoolAgentInvoker),
    Offline(OfflineAgentInvoker),
}

impl AgentInvoker for LibraryAgentInvoker {
    fn invoke_isolated(&self, task: IsolatedAgentTask) -> Result<String, AgentTaskError> {
        match self {
            Self::Pool(invoker) => invoker.invoke_isolated(task),
            Self::Offline(invoker) => invoker.invoke_isolated(task),
        }
    }

    fn open_conversation<'a>(
        &'a self,
        task_label: Option<String>,
    ) -> Result<Box<dyn dawnsight_core::AgentConversation + 'a>, AgentTaskError> {
        match self {
            Self::Pool(invoker) => invoker.open_conversation(task_label),
            Self::Offline(invoker) => invoker.open_conversation(task_label),
        }
    }
}

/// Parse the opaque profiles payload from library configs into the ACP hint.
/// Unparseable payloads map to the same not-configured error the crate used
/// to produce for an empty selection.
pub fn parse_agent_profiles(value: &serde_json::Value) -> Result<AgentProfilesHint, LibraryError> {
    serde_json::from_value(value.clone())
        .map_err(|_| LibraryError::resolver_not_configured(Some("ACP profile selection is empty")))
}

/// Non-empty profile selection, mirroring the crate-side guard.
pub fn require_agent_profiles(
    value: &serde_json::Value,
) -> Result<AgentProfilesHint, LibraryError> {
    let profiles = parse_agent_profiles(value)?;
    if profiles.profiles.is_empty() {
        return Err(LibraryError::resolver_not_configured(Some(
            "ACP profile selection is empty",
        )));
    }
    Ok(profiles)
}

/// Build the resolver invoker for a provider config. ACP providers get a
/// pooled ACP invoker; direct API providers get an offline invoker that is
/// never successfully invoked.
pub fn resolver_invoker_for_provider(
    provider: &ResolverProviderConfig,
) -> Result<LibraryAgentInvoker, LibraryError> {
    match provider {
        ResolverProviderConfig::AcpAgent {
            profile_id,
            profiles,
            model_id,
            ..
        } => {
            let hint = require_agent_profiles(profiles)?;
            workshop_invoker(&hint, profile_id, model_id.as_deref(), None)
                .map(LibraryAgentInvoker::Pool)
                .map_err(|details| LibraryError::resolver_not_configured(Some(&details)))
        }
        ResolverProviderConfig::DirectApi { .. } => {
            Ok(LibraryAgentInvoker::Offline(OfflineAgentInvoker))
        }
    }
}

/// Lenient invoker for credential validation. The validation flow reports
/// per-service failure items instead of typed errors, so pool construction
/// failures fall back to offline (exactly like the old empty-selection guard).
pub fn validation_invoker(provider: &ResolverProviderConfig) -> LibraryAgentInvoker {
    resolver_invoker_for_provider(provider)
        .unwrap_or(LibraryAgentInvoker::Offline(OfflineAgentInvoker))
}

/// Legacy library projection of the shared, isolated ACP discovery capability.
pub fn discover_agent_models(
    profile_id: String,
    profiles: &serde_json::Value,
) -> Result<AgentModelDiscoveryResult, LibraryError> {
    let hint: crate::acp::AgentProfilesHint = serde_json::from_value(profiles.clone())
        .map_err(|error| LibraryError::resolver_not_configured(Some(&error.to_string())))?;
    let result = crate::acp::discovery::discover_models(&hint, &profile_id, None)
        .map_err(|error| LibraryError::resolver_not_configured(error.details.as_deref()))?;
    // The domain DTO intentionally excludes transport-only config dimensions.
    let value = serde_json::to_value(result)
        .map_err(|error| LibraryError::internal(Some(&error.to_string())))?;
    serde_json::from_value(value).map_err(|error| LibraryError::internal(Some(&error.to_string())))
}
