//! Model/config discovery uses a private connection, never the live chat service.
use super::config::{model_config_id, response_options};
use super::isolated::IsolatedSession;
use super::service::AcpService;
use super::{AcpError, AcpModelDiscoveryResult, AgentProfilesHint, SidecarEngine};
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;

pub fn discover_models(
    profiles: &AgentProfilesHint,
    profile_id: &str,
    model_id: Option<&str>,
) -> Result<AcpModelDiscoveryResult, AcpError> {
    // Resolve before creating any process, including for an invalid profile.
    AcpService::resolve_profile(profiles, Some(profile_id))?;
    let workspace = super::workspace::resolve_agent_workspace(None)?;
    discover_with_selection(
        profiles,
        profile_id,
        &workspace,
        SidecarEngine::new(),
        model_id,
    )
}

struct DiscoveryConnection {
    engine: SidecarEngine,
    session_id: Option<String>,
}
impl Drop for DiscoveryConnection {
    fn drop(&mut self) {
        if let Some(id) = self.session_id.take() {
            if let Err(error) = self.engine.request(
                "session/delete",
                json!({ "sessionId": id }),
                Duration::from_secs(2),
            ) {
                let is_unsupported = error.details.as_deref().is_some_and(|details| {
                    details.contains("Method not found") || details.contains("-32000")
                });
                if is_unsupported {
                    tracing::debug!(details = ?error.details, "model discovery session delete not supported by engine");
                } else {
                    tracing::warn!(details = ?error.details, "model discovery session cleanup failed");
                }
            }
        }
        // Disconnect lets the client reap its Agent; shutdown reaps the private sidecar.
        if self.engine.is_alive() {
            let _ = self
                .engine
                .request("client/disconnect", Value::Null, Duration::from_secs(3));
        }
        self.engine.shutdown();
    }
}

fn discover_with_selection(
    profiles: &AgentProfilesHint,
    profile_id: &str,
    workspace: &Path,
    engine: SidecarEngine,
    model_id: Option<&str>,
) -> Result<AcpModelDiscoveryResult, AcpError> {
    let profile = AcpService::resolve_profile(profiles, Some(profile_id))?;
    let mut connection = DiscoveryConnection {
        engine,
        session_id: None,
    };
    IsolatedSession::connect_runtime(&connection.engine, workspace, profile, &mut |_| {})?;
    let opened = connection.engine.call(
        "session/open",
        json!({ "resumeSessionId": null, "mcpServers": [] }),
    )?;
    connection.session_id = Some(
        opened
            .get("sessionId")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .ok_or_else(|| AcpError::protocol(Some("discovery session/open missing sessionId")))?
            .to_string(),
    );
    let mut options = response_options(&opened)?;
    if let Some(model) = model_id.map(str::trim).filter(|model| !model.is_empty()) {
        let selected = connection.engine.call("session/set_config", json!({
            "sessionId": connection.session_id, "configId": model_config_id(&options), "value": model,
        }))?;
        options = response_options(&selected)?;
        if options.current_model_id.is_none() {
            options.current_model_id = Some(model.to_string());
        }
    }
    Ok(AcpModelDiscoveryResult {
        connected: true,
        message: if options.models.is_empty() {
            "该运行时未提供模型列表，可使用默认模型"
        } else {
            "已获取可用模型和配置"
        }
        .to_string(),
        options,
    })
}

#[cfg(test)]
fn discover_with_engine(
    profiles: &AgentProfilesHint,
    profile_id: &str,
    workspace: &Path,
    engine: SidecarEngine,
) -> Result<AcpModelDiscoveryResult, AcpError> {
    discover_with_selection(profiles, profile_id, workspace, engine, None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);

    struct Fixture {
        root: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "dawnsight-config-{}-{}",
                std::process::id(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&root).expect("fixture workspace");
            Self { root }
        }
        fn engine(&self, name: &str, scenario: &str) -> SidecarEngine {
            let script =
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/config-engine.mjs");
            SidecarEngine::for_test(
                PathBuf::from("node"),
                vec![
                    script.to_string_lossy().into_owned(),
                    self.root.join(name).to_string_lossy().into_owned(),
                    scenario.into(),
                ],
            )
        }
        fn calls(&self, name: &str) -> Vec<Value> {
            std::fs::read_to_string(self.root.join(name))
                .expect("RPC log")
                .lines()
                .map(|line| serde_json::from_str(line).expect("RPC record"))
                .collect()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }
    fn profiles() -> AgentProfilesHint {
        serde_json::from_value(json!({ "activeProfileId": "codex", "profiles": [
            { "id": "codex", "name": "ChatGPT", "kind": "Codex", "command": "", "args": [], "env": {} },
            { "id": "opencode", "name": "OpenCode", "kind": "OpenCode", "command": "", "args": [], "env": {} }
        ] })).expect("profile fixture")
    }

    #[test]
    fn config_discovery_stdio_switches_models_effort_and_preserves_live_connection() {
        let fixture = Fixture::new();
        let live = fixture.engine("live.jsonl", "ok");
        live.call("client/connect", json!({ "runtime": "chat-fixture" }))
            .expect("live connect");
        let live_session = live
            .call(
                "session/open",
                json!({ "mcpServers": [{"name":"chat-only"}], "resumeSessionId": null }),
            )
            .expect("live session");
        for (profile_id, runtime) in [("codex", "codex-acp"), ("opencode", "opencode")] {
            let name = format!("{profile_id}.jsonl");
            let engine = fixture.engine(&name, "ok");
            let observer = engine.clone();
            let result = discover_with_engine(&profiles(), profile_id, &fixture.root, engine)
                .expect("discovery");
            assert!(result.connected);
            assert_eq!(result.options.models[0].value, format!("{runtime}-model"));
            assert_eq!(
                result.options.current_reasoning_effort.as_deref(),
                Some("high")
            );
            assert_eq!(
                result
                    .options
                    .reasoning_efforts
                    .iter()
                    .map(|option| option.value.as_str())
                    .collect::<Vec<_>>(),
                ["low", "high"]
            );
            assert!(!observer.is_alive(), "discovery process must be stopped");
            let calls = fixture.calls(&name);
            assert_eq!(
                calls
                    .iter()
                    .map(|call| call["method"].as_str().unwrap())
                    .collect::<Vec<_>>(),
                [
                    "client/connect",
                    "session/open",
                    "session/delete",
                    "client/disconnect"
                ]
            );
            assert_eq!(calls[1]["params"]["mcpServers"], json!([]));
            assert!(calls[1]["params"]["resumeSessionId"].is_null());
            assert_eq!(
                calls[2]["params"]["sessionId"],
                format!("fixture-{runtime}")
            );
        }
        assert_eq!(
            live.call("ping", Value::Null).expect("live still answers")["message"],
            "pong"
        );
        assert_eq!(live_session["sessionId"], "fixture-chat-fixture");
        assert_eq!(
            fixture.calls("live.jsonl").len(),
            3,
            "discovery never closes or configures live chat"
        );
        live.shutdown();
    }

    #[test]
    fn config_discovery_stdio_open_failure_and_empty_catalog_cleanup() {
        let fixture = Fixture::new();
        let failed = fixture.engine("failed.jsonl", "open-failure");
        let observer = failed.clone();
        let error = discover_with_engine(&profiles(), "codex", &fixture.root, failed)
            .expect_err("open fails");
        assert!(!error.message.contains("fixture open failed"));
        assert!(!observer.is_alive());
        assert_eq!(
            fixture.calls("failed.jsonl").last().unwrap()["method"],
            "client/disconnect"
        );
        let empty = discover_with_engine(
            &profiles(),
            "opencode",
            &fixture.root,
            fixture.engine("empty.jsonl", "empty"),
        )
        .expect("empty is supported");
        assert!(empty.options.models.is_empty());
        assert_eq!(fixture.calls("empty.jsonl")[2]["method"], "session/delete");
    }

    #[test]
    fn config_discovery_cleanup_timeout_still_stops_its_private_process() {
        let fixture = Fixture::new();
        let engine = fixture.engine("silent.jsonl", "silent-delete");
        let observer = engine.clone();
        let started = std::time::Instant::now();
        let result = discover_with_engine(&profiles(), "codex", &fixture.root, engine);
        assert!(result.is_ok(), "cleanup must not discard a valid directory");
        assert!(
            !observer.is_alive(),
            "cleanup timeout must still reap the engine"
        );
        assert!(
            started.elapsed() < Duration::from_secs(15),
            "cleanup must be bounded"
        );
        assert_eq!(
            fixture.calls("silent.jsonl").last().unwrap()["method"],
            "client/disconnect"
        );
    }

    #[test]
    fn config_discovery_rejects_unknown_profile_before_spawn() {
        let fixture = Fixture::new();
        let result = discover_with_engine(
            &profiles(),
            "unknown",
            &fixture.root,
            fixture.engine("unused.jsonl", "ok"),
        );
        assert!(result.is_err());
        assert!(!fixture.root.join("unused.jsonl").exists());
    }

    /// The bundled production acp-client adapter talks to a raw ACP fixture.
    /// Explicit opt-in requires a built sidecar, but no credentials or network.
    #[test]
    #[ignore = "requires built acp-engine; uses a local raw ACP fixture only"]
    fn config_discovery_real_engine_raw_acp_config_options() {
        let fixture = Fixture::new();
        let script =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/config-acp-agent.mjs");
        let node = which::which("node").expect("Node fixture runtime");
        let hint: AgentProfilesHint = serde_json::from_value(json!({
            "activeProfileId": "fixture", "profiles": [{ "id": "fixture", "name": "Fixture", "kind": "Custom",
                "command": node.to_string_lossy(), "args": [script.to_string_lossy(), fixture.root.join("raw.jsonl").to_string_lossy()], "env": {} }]
        })).expect("custom fixture profile");
        let engine = SidecarEngine::for_test(
            super::super::resolve_engine_path().expect("built engine"),
            vec![],
        );
        let options = discover_with_engine(&hint, "fixture", &fixture.root, engine)
            .expect("raw ACP directory")
            .options;
        assert_eq!(options.models.len(), 3);
        assert_eq!(options.models[0].value, "fixture-model");
        assert_eq!(options.current_model_id.as_deref(), Some("fixture-model"));
        assert_eq!(options.current_reasoning_effort.as_deref(), Some("high"));
        assert_eq!(
            options
                .reasoning_efforts
                .iter()
                .map(|option| option.value.as_str())
                .collect::<Vec<_>>(),
            ["low", "high"]
        );
        let calls = fixture.calls("raw.jsonl");
        assert!(calls.iter().any(|call| call["method"] == "initialize"));
        let opened = calls
            .iter()
            .find(|call| call["method"] == "session/new")
            .expect("real ACP new");
        assert_eq!(opened["params"]["mcpServers"], json!([]));
        assert!(!calls
            .iter()
            .any(|call| call["method"] == "session/prompt" || call["method"] == "session/load"));
        assert!(calls.iter().any(|call| call["method"] == "session/delete"));
    }

    #[test]
    #[ignore = "requires built acp-engine; uses a local raw ACP fixture only"]
    fn config_discovery_real_engine_model_dependent_effort_get_and_set() {
        let fixture = Fixture::new();
        let script =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/config-acp-agent.mjs");
        let hint: AgentProfilesHint = serde_json::from_value(json!({
            "activeProfileId": "fixture", "profiles": [{ "id": "fixture", "name": "Fixture", "kind": "Custom",
                "command": which::which("node").expect("Node fixture"), "args": [script, fixture.root.join("dependent.jsonl")], "env": {} }]
        })).expect("profile");
        let engine = || {
            SidecarEngine::for_test(
                super::super::resolve_engine_path().expect("built engine"),
                vec![],
            )
        };
        let discovered = discover_with_selection(
            &hint,
            "fixture",
            &fixture.root,
            engine(),
            Some("fixture-model-2"),
        )
        .expect("selected model directory")
        .options;
        assert_eq!(
            discovered
                .reasoning_efforts
                .iter()
                .map(|entry| entry.value.as_str())
                .collect::<Vec<_>>(),
            ["medium", "max"]
        );
        assert_eq!(
            super::super::config::effort_config_id(&discovered, "max"),
            Some("effort")
        );
        let service = AcpService::with_test_engine(engine());
        service
            .connect(
                Some(fixture.root.to_string_lossy().into_owned()),
                Some("fixture".into()),
                None,
                super::super::AcpClientSettings {
                    reasoning_effort: Some("low".into()),
                    ..Default::default()
                },
                hint.clone(),
                |_| {},
            )
            .expect("live connect");
        let first = service
            .set_session_model(None, Some("low".into()), |_| {})
            .expect("initial variant field");
        assert_eq!(first.current_reasoning_effort.as_deref(), Some("low"));
        let changed = service
            .set_session_model(Some("fixture-model-2".into()), None, |_| {})
            .expect("switch live model");
        assert_eq!(changed.reasoning_efforts, discovered.reasoning_efforts);
        let set = service
            .set_session_model(None, Some("max".into()), |_| {})
            .expect("set advertised variant");
        assert_eq!(set.current_reasoning_effort.as_deref(), Some("max"));
        let none = service
            .set_session_model(Some("fixture-model-3".into()), None, |_| {})
            .expect("model without effort");
        assert!(none.reasoning_efforts.is_empty());
        assert!(service
            .set_session_model(None, Some("max".into()), |_| {})
            .is_err());
        service.close_session_for_shutdown();
        let spec = super::super::isolated::IsolatedSessionSpec {
            profile_id: "fixture",
            profiles: &hint,
            workspace: &fixture.root,
            mcp_servers: json!([]),
            model_id: Some("fixture-model-2"),
            reasoning_effort: Some("max"),
        };
        super::super::isolated::IsolatedSession::open(&spec, &mut |_| {})
            .expect("chapter config")
            .close();
        let calls = fixture.calls("dependent.jsonl");
        let sets = calls
            .iter()
            .filter(|call| call["method"] == "session/set_config_option")
            .collect::<Vec<_>>();
        assert_eq!(
            sets.iter()
                .filter(|call| call["params"]["configId"] == "effort"
                    && call["params"]["value"] == "max")
                .count(),
            2,
            "chat and chapter both set the actual advertised config ID"
        );
        assert!(sets.iter().any(
            |call| call["params"]["configId"] == "variant" && call["params"]["value"] == "low"
        ));
        assert!(!sets
            .iter()
            .any(|call| call["params"]["configId"] == "reasoning_effort"));
        assert!(!calls.iter().any(|call| call["method"] == "session/prompt"));
    }

    #[test]
    #[ignore = "requires local OpenCode and DAWNSIGHT_ACP_MODEL_CONFIG_E2E_ID; sends no prompts"]
    fn config_discovery_real_opencode_selected_model_effort() {
        let model = std::env::var("DAWNSIGHT_ACP_MODEL_CONFIG_E2E_ID")
            .expect("explicit model for configuration-only acceptance");
        let fixture = Fixture::new();
        let result = discover_with_selection(
            &profiles(),
            "opencode",
            &fixture.root,
            SidecarEngine::new(),
            Some(&model),
        )
        .expect("real selected-model discovery")
        .options;
        assert_eq!(result.current_model_id.as_deref(), Some(model.as_str()));
        assert!(
            !result.reasoning_efforts.is_empty(),
            "chosen model must advertise effort for this opt-in check"
        );
        for level in &result.reasoning_efforts {
            assert!(super::super::config::effort_config_id(&result, &level.value).is_some());
        }
        let selected = result
            .reasoning_efforts
            .iter()
            .find(|entry| entry.value == "medium")
            .unwrap_or(&result.reasoning_efforts[0])
            .value
            .clone();
        let service = AcpService::new();
        let applied = (|| {
            service.connect(
                Some(fixture.root.to_string_lossy().into_owned()),
                Some("opencode".into()),
                None,
                super::super::AcpClientSettings {
                    model_id: Some(model.clone()),
                    ..Default::default()
                },
                profiles(),
                |_| {},
            )?;
            service.set_session_model(None, Some(selected.clone()), |_| {})
        })();
        let _ = service.close_session();
        service.close_session_for_shutdown();
        assert_eq!(
            applied
                .expect("real effort setting")
                .current_reasoning_effort
                .as_deref(),
            Some(selected.as_str())
        );
        println!(
            "[config-e2e] runtime=opencode phase=model-and-effort-get-set levels={} status=passed",
            result.reasoning_efforts.len()
        );
    }
}
