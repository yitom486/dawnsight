//! `acp-engine` sidecar driver (newline JSON-RPC over stdio).
//!
//! The engine is built from `@yitom/acp-client` (`scripts/build-acp-engine.mjs`)
//! and runs as a Tauri `externalBin` sidecar. This driver owns its process:
//! request/response matching, notification dispatch (session updates,
//! permission requests, status changes), lazy spawn and shutdown.
//!
//! Updates and permission requests are fanned out to the currently installed
//! update sink (one live chat call at a time, guarded by the service busy
//! flag). Everything else is traced.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use serde_json::Value;

use super::error::AcpError;

const REQUEST_TIMEOUT_SECS: u64 = 120;
const CANCEL_POLL_MS: u64 = 200;

type PendingTx = mpsc::Sender<Result<Value, String>>;

/// Resolve the sidecar binary path.
///
/// 1. `DAWNSIGHT_ACP_ENGINE` env override (absolute path, dev/tests).
/// 2. Next to the current executable: `acp-engine-<triple>[.exe]`
///    (production bundle layout for `externalBin`).
/// 3. `bin/acp-engine-<triple>[.exe]` next to the current executable.
/// 4. Dev-tree walk-up: `<root>/apps/desktop/src-tauri/bin/...`.
pub fn resolve_engine_path() -> Result<PathBuf, AcpError> {
    if let Some(path) = std::env::var_os("DAWNSIGHT_ACP_ENGINE").map(PathBuf::from) {
        if path.is_file() {
            return Ok(path);
        }
        return Err(AcpError::spawn_failed(Some(&format!(
            "DAWNSIGHT_ACP_ENGINE is not a file: {}",
            path.display()
        ))));
    }
    let file_name = engine_file_name();
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(&file_name));
            candidates.push(dir.join("bin").join(&file_name));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let mut dir = Some(cwd.as_path());
        for _ in 0..6 {
            let Some(parent) = dir else { break };
            candidates.push(
                parent
                    .join("apps")
                    .join("desktop")
                    .join("src-tauri")
                    .join("bin")
                    .join(&file_name),
            );
            candidates.push(parent.join("src-tauri").join("bin").join(&file_name));
            dir = parent.parent();
        }
    }
    for candidate in &candidates {
        if candidate.is_file() {
            return Ok(candidate.clone());
        }
    }
    Err(AcpError::not_configured(Some(
        "acp-engine sidecar binary is missing; run node scripts/build-acp-engine.mjs",
    )))
}

fn engine_file_name() -> String {
    let triple = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => "x86_64-pc-windows-msvc",
        ("windows", "aarch64") => "aarch64-pc-windows-msvc",
        ("macos", "aarch64") => "aarch64-apple-darwin",
        ("macos", "x86_64") => "x86_64-apple-darwin",
        ("linux", "x86_64") => "x86_64-unknown-linux-gnu",
        ("linux", "aarch64") => "aarch64-unknown-linux-gnu",
        (os, arch) => return format!("acp-engine-{arch}-{os}"),
    };
    if std::env::consts::OS == "windows" {
        format!("acp-engine-{triple}.exe")
    } else {
        format!("acp-engine-{triple}")
    }
}

pub fn engine_binary_present() -> bool {
    resolve_engine_path().is_ok()
}

struct Running {
    child: Child,
    stdin: ChildStdin,
}

struct Shared {
    next_id: AtomicU64,
    slots: Mutex<HashMap<u64, PendingTx>>,
    running: Mutex<Option<Running>>,
    update_sink: Mutex<Option<mpsc::Sender<Value>>>,
    alive: AtomicBool,
    /// Incremented on every fresh spawn. Lets the service tell a live
    /// engine from a respawned one holding no client or sessions.
    gen: AtomicU64,
}

#[derive(Clone)]
pub struct SidecarEngine {
    shared: Arc<Shared>,
}

impl SidecarEngine {
    pub fn new() -> Self {
        Self {
            shared: Arc::new(Shared {
                next_id: AtomicU64::new(1),
                slots: Mutex::new(HashMap::new()),
                running: Mutex::new(None),
                update_sink: Mutex::new(None),
                alive: AtomicBool::new(false),
                gen: AtomicU64::new(0),
            }),
        }
    }

    pub fn is_alive(&self) -> bool {
        self.shared.alive.load(Ordering::SeqCst)
    }

    /// Current engine generation (0 = never spawned).
    pub fn generation(&self) -> u64 {
        self.shared.gen.load(Ordering::SeqCst)
    }

    /// Install the notification sink for the current call (prompt / load).
    pub fn set_update_sink(&self, tx: mpsc::Sender<Value>) {
        if let Ok(mut sink) = self.shared.update_sink.lock() {
            *sink = Some(tx);
        }
    }

    pub fn clear_update_sink(&self) {
        if let Ok(mut sink) = self.shared.update_sink.lock() {
            *sink = None;
        }
    }

    /// Spawn the engine if it is not running. Cheap to call repeatedly.
    pub fn ensure_running(&self) -> Result<(), AcpError> {
        let mut guard = self
            .shared
            .running
            .lock()
            .map_err(|_| AcpError::internal(Some("engine state mutex poisoned")))?;
        if let Some(running) = guard.as_mut() {
            match running.child.try_wait() {
                Ok(None) => return Ok(()),
                Ok(Some(_)) | Err(_) => {
                    drop(guard);
                    self.fail_all_pending("acp-engine process exited");
                    guard = self
                        .shared
                        .running
                        .lock()
                        .map_err(|_| AcpError::internal(Some("engine state mutex poisoned")))?;
                    *guard = None;
                }
            }
        }
        let path = resolve_engine_path()?;
        let mut child = Command::new(&path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                AcpError::spawn_failed(Some(&format!("start {}: {error}", path.display())))
            })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AcpError::spawn_failed(Some("acp-engine stdin unavailable")))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AcpError::spawn_failed(Some("acp-engine stdout unavailable")))?;
        let stderr = child.stderr.take();
        self.spawn_reader(stdout);
        if let Some(stderr) = stderr {
            // Engine diagnostics must never vanish into a null pipe again:
            // a silent connect failure once cost a full blind debug round.
            std::thread::Builder::new()
                .name("acp-engine-stderr".into())
                .spawn(move || {
                    let reader = BufReader::new(stderr);
                    for line in reader.lines().map_while(Result::ok) {
                        let trimmed = line.trim();
                        if !trimmed.is_empty() {
                            tracing::debug!(engine_stderr = %trimmed, "acp-engine");
                        }
                    }
                })
                .ok();
        }
        *guard = Some(Running { child, stdin });
        self.shared.alive.store(true, Ordering::SeqCst);
        self.shared.gen.fetch_add(1, Ordering::SeqCst);
        tracing::info!(engine = %path.display(), "acp-engine sidecar started");
        Ok(())
    }

    fn spawn_reader(&self, stdout: std::process::ChildStdout) {
        let shared = Arc::clone(&self.shared);
        std::thread::Builder::new()
            .name("acp-engine-reader".into())
            .spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    let line = match line {
                        Ok(line) => line,
                        Err(error) => {
                            tracing::warn!(%error, "acp-engine stdout read failed");
                            break;
                        }
                    };
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let value: Value = match serde_json::from_str(trimmed) {
                        Ok(value) => value,
                        Err(error) => {
                            tracing::debug!(%error, "acp-engine skipping non-JSON stdout line");
                            continue;
                        }
                    };
                    if let Some(id) = value.get("id").and_then(Value::as_u64) {
                        let tx = shared
                            .slots
                            .lock()
                            .ok()
                            .and_then(|mut guard| guard.remove(&id));
                        if let Some(tx) = tx {
                            if let Some(result) = value.get("result") {
                                let _ = tx.send(Ok(result.clone()));
                            } else if let Some(error) = value.get("error") {
                                let message = error
                                    .get("message")
                                    .and_then(Value::as_str)
                                    .unwrap_or("acp-engine request failed");
                                let code =
                                    error.get("code").and_then(Value::as_i64).unwrap_or(-32000);
                                let _ = tx.send(Err(format!("engine {code}: {message}")));
                            } else {
                                let _ = tx.send(Err("engine response without result".to_string()));
                            }
                        }
                    } else if let Some(method) = value.get("method").and_then(Value::as_str) {
                        match method {
                            "ready" => {
                                tracing::info!("acp-engine ready");
                            }
                            "session/update" | "permission/request" => {
                                let params = value.get("params").cloned().unwrap_or(Value::Null);
                                // Tag notifications so the service can route them.
                                let tagged = serde_json::json!({
                                    "notification": method,
                                    "params": params,
                                });
                                if let Ok(guard) = shared.update_sink.lock() {
                                    if let Some(tx) = guard.as_ref() {
                                        let _ = tx.send(tagged);
                                    }
                                }
                            }
                            "status/change" => {
                                tracing::debug!(params = ?value.get("params"), "engine status");
                            }
                            "stderr/line" => {
                                if let Some(line) = value
                                    .get("params")
                                    .and_then(|params| params.get("line"))
                                    .and_then(Value::as_str)
                                {
                                    tracing::debug!(agent_stderr = %line, "agent stderr");
                                }
                            }
                            _ => {
                                tracing::debug!(method, "ignoring engine notification");
                            }
                        }
                    }
                }
                shared.alive.store(false, Ordering::SeqCst);
                if let Ok(mut guard) = shared.slots.lock() {
                    for (_, tx) in guard.drain() {
                        let _ = tx.send(Err("acp-engine process exited".to_string()));
                    }
                }
                tracing::warn!("acp-engine reader stopped");
            })
            .ok();
    }

    fn fail_all_pending(&self, reason: &str) {
        if let Ok(mut guard) = self.shared.slots.lock() {
            for (_, tx) in guard.drain() {
                let _ = tx.send(Err(reason.to_string()));
            }
        }
        self.shared.alive.store(false, Ordering::SeqCst);
    }

    fn send_line(&self, line: &str) -> Result<(), AcpError> {
        let mut guard = self
            .shared
            .running
            .lock()
            .map_err(|_| AcpError::internal(Some("engine state mutex poisoned")))?;
        let running = guard
            .as_mut()
            .ok_or_else(|| AcpError::protocol(Some("acp-engine is not running")))?;
        running
            .stdin
            .write_all(line.as_bytes())
            .and_then(|_| running.stdin.write_all(b"\n"))
            .and_then(|_| running.stdin.flush())
            .map_err(|error| AcpError::protocol(Some(&format!("write engine stdin: {error}"))))?;
        Ok(())
    }

    /// Send a request and wait for its response (bounded by `timeout`).
    pub fn request(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, AcpError> {
        self.ensure_running()?;
        let id = self.shared.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        if let Ok(mut guard) = self.shared.slots.lock() {
            guard.insert(id, tx);
        }
        let line = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        })
        .to_string();
        if let Err(error) = self.send_line(&line) {
            if let Ok(mut guard) = self.shared.slots.lock() {
                guard.remove(&id);
            }
            return Err(error);
        }
        match rx.recv_timeout(timeout) {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(message)) => Err(AcpError::protocol(Some(&message))),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Ok(mut guard) = self.shared.slots.lock() {
                    guard.remove(&id);
                }
                Err(AcpError::protocol(Some(&format!(
                    "engine request {method} timed out"
                ))))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                Err(AcpError::protocol(Some("engine response channel closed")))
            }
        }
    }

    /// Default-timeout request shorthand for quick control calls.
    pub fn call(&self, method: &str, params: Value) -> Result<Value, AcpError> {
        self.request(method, params, Duration::from_secs(REQUEST_TIMEOUT_SECS))
    }

    /// Long-running request (prompt): polls the cancel flag while waiting so
    /// `acp_cancel` resolves promptly; the late engine response is dropped.
    pub fn request_cancellable(
        &self,
        method: &str,
        params: Value,
        cancel: &AtomicBool,
    ) -> Result<Value, AcpError> {
        self.ensure_running()?;
        let id = self.shared.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        if let Ok(mut guard) = self.shared.slots.lock() {
            guard.insert(id, tx);
        }
        let line = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        })
        .to_string();
        if let Err(error) = self.send_line(&line) {
            if let Ok(mut guard) = self.shared.slots.lock() {
                guard.remove(&id);
            }
            return Err(error);
        }
        loop {
            if cancel.load(Ordering::SeqCst) {
                if let Ok(mut guard) = self.shared.slots.lock() {
                    guard.remove(&id);
                }
                return Err(AcpError::cancelled());
            }
            match rx.recv_timeout(Duration::from_millis(CANCEL_POLL_MS)) {
                Ok(Ok(value)) => return Ok(value),
                Ok(Err(message)) => {
                    if cancel.load(Ordering::SeqCst) {
                        return Err(AcpError::cancelled());
                    }
                    return Err(AcpError::protocol(Some(&message)));
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err(AcpError::protocol(Some("engine response channel closed")));
                }
            }
        }
    }

    /// Terminate the engine (app shutdown). Best effort, never blocks.
    pub fn shutdown(&self) {
        self.fail_all_pending("engine shutting down");
        let child = self
            .shared
            .running
            .lock()
            .ok()
            .and_then(|mut guard| guard.take());
        if let Some(mut running) = child {
            let _ = running.child.kill();
            let _ = running.child.wait();
        }
        self.clear_update_sink();
    }
}

impl Default for SidecarEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_engine() -> Option<SidecarEngine> {
        if resolve_engine_path().is_err() {
            return None;
        }
        Some(SidecarEngine::new())
    }

    #[test]
    fn engine_resolves_bundled_binary() {
        if test_engine().is_none() {
            eprintln!("SKIP: acp-engine binary not built; run node scripts/build-acp-engine.mjs");
        }
    }

    #[test]
    fn engine_answers_ping() {
        let Some(engine) = test_engine() else {
            eprintln!("SKIP: acp-engine binary missing");
            return;
        };
        let response = engine
            .request("ping", Value::Null, Duration::from_secs(30))
            .expect("engine ping");
        assert_eq!(
            response.get("message").and_then(Value::as_str),
            Some("pong")
        );
        engine.shutdown();
    }

    #[test]
    fn engine_lists_runtimes() {
        let Some(engine) = test_engine() else {
            eprintln!("SKIP: acp-engine binary missing");
            return;
        };
        let response = engine
            .request("runtimes/list", Value::Null, Duration::from_secs(30))
            .expect("engine runtimes/list");
        let runtimes = response
            .get("runtimes")
            .and_then(Value::as_array)
            .expect("runtimes array");
        assert!(!runtimes.is_empty());
        assert!(runtimes
            .iter()
            .any(|entry| entry.get("id").and_then(Value::as_str).is_some()));
        engine.shutdown();
    }

    /// Full driver roundtrip against real Codex: connect -> open -> prompt.
    /// This is the test that would have caught the `.data` vs `.value`
    /// contract break. Needs the engine binary, Codex login and network.
    /// Run explicitly:
    /// `cargo test -p dawnsight-app --lib -- --ignored engine_codex_roundtrip`.
    #[test]
    #[ignore = "needs acp-engine binary + logged-in codex + network (~2min)"]
    fn engine_codex_roundtrip() {
        let Some(engine) = test_engine() else {
            eprintln!("SKIP: acp-engine binary missing");
            return;
        };
        let workspace =
            std::env::temp_dir().join(format!("dawnsight-engine-test-{}", std::process::id()));
        std::fs::create_dir_all(&workspace).expect("test workspace");
        roundtrip_on(&engine, &workspace);
        engine.shutdown();
        let _ = std::fs::remove_dir_all(&workspace);
    }

    /// CJK media directories hash to an ASCII agent workspace; the prompt
    /// must answer in seconds, not minutes (regression: 117s on a raw CJK
    /// cwd with the same model/prompt). Same live requirements as above.
    /// Run explicitly:
    /// `cargo test -p dawnsight-app --lib -- --ignored engine_cjk_workspace_roundtrip`.
    #[test]
    #[ignore = "needs acp-engine binary + logged-in codex + network (~2min)"]
    fn engine_cjk_workspace_roundtrip() {
        let Some(engine) = test_engine() else {
            eprintln!("SKIP: acp-engine binary missing");
            return;
        };
        let media_dir =
            std::env::temp_dir().join(format!("dawnsight-cjk-电视剧测试-{}", std::process::id()));
        std::fs::create_dir_all(&media_dir).expect("cjk media dir");
        let workspace = crate::acp::workspace::resolve_agent_workspace(media_dir.to_str())
            .expect("hashed workspace");
        assert!(
            workspace.to_string_lossy().is_ascii(),
            "agent workspace must be ASCII, got {}",
            workspace.display()
        );
        let started = std::time::Instant::now();
        roundtrip_on(&engine, &workspace);
        let elapsed = started.elapsed();
        assert!(
            elapsed < Duration::from_secs(90),
            "CJK-hashed workspace prompt took too long: {elapsed:?}"
        );
        engine.shutdown();
        let _ = std::fs::remove_dir_all(&media_dir);
        let _ = std::fs::remove_dir_all(&workspace);
    }

    fn roundtrip_on(engine: &SidecarEngine, workspace: &std::path::Path) {
        let connected = engine
            .request(
                "client/connect",
                serde_json::json!({
                    "runtime": "codex-acp",
                    "workspaceRoot": workspace.to_string_lossy(),
                    "clientInfo": { "name": "dawnsight-test", "version": "0.0.0" },
                }),
                Duration::from_secs(150),
            )
            .expect("engine client/connect");
        assert_eq!(
            connected.get("status").and_then(Value::as_str),
            Some("connected")
        );
        let opened = engine
            .request(
                "session/open",
                serde_json::json!({ "resumeSessionId": null, "mcpServers": [] }),
                Duration::from_secs(150),
            )
            .expect("engine session/open");
        let session_id = opened
            .get("sessionId")
            .and_then(Value::as_str)
            .expect("open returns sessionId")
            .to_string();
        assert!(!session_id.is_empty());
        let answered = engine
            .request(
                "session/prompt",
                serde_json::json!({
                    "sessionId": session_id,
                    "promptText": "Reply with exactly: ENGINE_OK",
                    "timeoutMs": 120000,
                }),
                Duration::from_secs(180),
            )
            .expect("engine session/prompt");
        assert!(
            answered.get("result").is_some(),
            "prompt returns a result, got: {answered}"
        );
        let _ = engine.call("client/disconnect", Value::Null);
    }
}
