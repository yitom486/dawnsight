//! Backend ACP chat transport now lives in `crate::acp` (sidecar engine).
//!
//! AI worker commands (chapter segmentation, subtitle workshop, library
//! resolver) still run offline until isolated engine sessions land; this
//! module keeps their wire-compatible DTOs plus the offline invoker.

pub use crate::acp::{AgentProfileInput, AgentProfilesHint};

/// Offline [`dawnsight_core::AgentInvoker`]: every isolated call fails with
/// `NotConfigured`, which the AI pipelines already map to their
/// "agent not configured" business message.
pub struct OfflineAgentInvoker;

impl dawnsight_core::AgentInvoker for OfflineAgentInvoker {
    fn invoke_isolated(
        &self,
        _task: dawnsight_core::IsolatedAgentTask,
    ) -> Result<String, dawnsight_core::AgentTaskError> {
        Err(dawnsight_core::AgentTaskError::NotConfigured {
            details: Some("ACP transport 已下线".to_string()),
        })
    }
}
