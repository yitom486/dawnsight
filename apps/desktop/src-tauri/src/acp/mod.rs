//! ACP chat backend over the `acp-engine` sidecar.
//!
//! The ACP wire protocol, agent adapters and process lifecycle live in
//! `@yitom/acp-client` (compiled to `bin/acp-engine`); this module only
//! translates between the engine's JSON-RPC and the long-standing `acp_*`
//! Tauri surface the frontend already uses.

pub mod adapter;
mod config;
pub mod context;
pub mod discovery;
pub mod engine;
pub mod environment;
pub mod error;
pub mod isolated;
pub mod mcp_control;
pub mod model;
pub mod service;
pub mod settings;
pub mod updates;
pub mod workspace;

pub use context::VideoPromptContext;
pub use engine::{engine_binary_present, resolve_engine_path, SidecarEngine};
pub use environment::SessionEnvironment;
pub use error::{AcpError, AcpErrorCode};
pub use model::{
    AcpEvent, AcpModelDiscoveryResult, AcpSessionModelOptions, AcpSessionModelSelection,
    AcpSessionOption, AcpStatus, AgentKind, AgentProfileInput, AgentProfileStatus,
    AgentProfilesHint, AgentSessionInfo, AgentSessionListResult, PermissionOption, PromptImage,
    ResumeOutcome, SavedSessionHint, SessionConfigKind, SessionConfigOption, SessionConfigValue,
    SessionKind,
};
pub use service::{AcpService, LiveSession, LoadedTurn};
pub use settings::{AcpClientSettings, PermissionMode, ThinkingLevel};
