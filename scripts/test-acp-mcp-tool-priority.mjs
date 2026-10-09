import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const timeoutMs = Number.parseInt(process.env.DAWNSIGHT_MCP_E2E_TIMEOUT_MS ?? "90000", 10);
const codexPath =
  process.env.CODEX_PATH ??
  "C:\\Users\\zheye\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe";
const mcpCommand = process.env.DAWNSIGHT_MCP_COMMAND ?? path.join(root, "target", "debug", "dawnsight-app.exe");
const codexAcpCandidates = [
  process.env.CODEX_ACP_ENTRY,
  path.join(root, "node_modules", "@agentclientprotocol", "codex-acp", "dist", "index.js"),
  path.join(
    root,
    "apps",
    "desktop",
    "node_modules",
    "@agentclientprotocol",
    "codex-acp",
    "dist",
    "index.js",
  ),
].filter(Boolean);
const codexAcpEntry = codexAcpCandidates.find((candidate) => fs.existsSync(candidate)) ?? codexAcpCandidates[0];

const PLOT_TOOLS = new Set(["dawnsight_get_library_context", "dawnsight_get_transcript_window"]);
const WEB_SEARCH_PATTERN = /web[_-]?search/i;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Real ACP/MCP priority E2E (opt-in)

Run:
  DAWNSIGHT_MCP_E2E=1 bun run test:e2e:acp-mcp-priority

Optional environment:
  DAWNSIGHT_MCP_E2E_TIMEOUT_MS  Per-RPC timeout in milliseconds (default: 90000)
  CODEX_PATH                Codex executable path
  CODEX_ACP_ENTRY           codex-acp dist/index.js path override
  DAWNSIGHT_MCP_COMMAND        Dawnsight executable with --dawnsight-mcp (default: target/debug/dawnsight-app.exe)

The test uses a temporary, redacted fixture snapshot and never prints snapshot
contents, media paths, or Agent stderr. It is intentionally excluded from the
default unit/UI test suites.`);
  process.exit(0);
}

if (process.env.DAWNSIGHT_MCP_E2E !== "1") {
  console.error("[skip] set DAWNSIGHT_MCP_E2E=1 to run the real Codex ACP/MCP priority check");
  process.exit(0);
}

if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) {
  console.error("[fail] invalid timeout: set DAWNSIGHT_MCP_E2E_TIMEOUT_MS to an integer >= 1000");
  process.exit(1);
}

for (const required of [codexPath, codexAcpEntry, mcpCommand]) {
  if (!fs.existsSync(required)) {
    console.error(`[skip] required local executable is unavailable: ${path.basename(required)}`);
    process.exit(0);
  }
}

class E2eFailure extends Error {
  constructor(message, { code, phase, action }) {
    super(message);
    this.name = "E2eFailure";
    this.code = code;
    this.phase = phase;
    this.action = action;
  }
}

function fail(message, metadata) {
  throw new E2eFailure(message, metadata);
}

function send(child, payload) {
  if (!child.stdin.writable) {
    fail("RPC process stdin is unavailable", {
      code: "process",
      phase: "send",
      action: "check the local executable and its process startup logs",
    });
  }
  child.stdin.write(`${JSON.stringify(payload)}\n`);
}

function stop(child) {
  if (child && !child.killed) child.kill();
}

class RpcLines {
  constructor(stream, label) {
    this.label = label;
    this.responses = new Map();
    this.waiters = new Map();
    this.notifications = [];
    this.listeners = new Set();
    this.readline = readline.createInterface({ input: stream });
    this.readline.on("line", (line) => this.onLine(line));
  }

  onLine(line) {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id !== undefined && message.id !== null) {
      const waiter = this.waiters.get(message.id);
      if (waiter) {
        this.waiters.delete(message.id);
        waiter.resolve(message);
      } else {
        this.responses.set(message.id, message);
      }
      return;
    }
    this.notifications.push(message);
    for (const listener of this.listeners) listener(message);
  }

  waitFor(id) {
    const existing = this.responses.get(id);
    if (existing) {
      this.responses.delete(id);
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new E2eFailure("RPC response timed out", {
          code: "timeout",
          phase: this.label,
          action: "increase DAWNSIGHT_MCP_E2E_TIMEOUT_MS or inspect local Agent/MCP startup",
        }));
      }, timeoutMs);
      this.waiters.set(id, {
        timer,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close() {
    this.readline.close();
  }
}

function attachProcessDiagnostics(child, rpc, label) {
  child.once("error", () => {
    for (const waiter of rpc.waiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new E2eFailure("local RPC process could not start", {
        code: "process",
        phase: label,
        action: "verify the executable exists and can run outside Dawnsight",
      }));
    }
    rpc.waiters.clear();
  });
  child.once("exit", (code, signal) => {
    if (rpc.closed || rpc.waiters.size === 0) return;
    for (const waiter of rpc.waiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new E2eFailure("local RPC process exited before replying", {
        code: "process",
        phase: label,
        action: signal
          ? "inspect the local process configuration and termination signal"
          : `inspect the local process exit status (${code ?? "unknown"})`,
      }));
    }
    rpc.waiters.clear();
  });
}

function request(rpc, child, id, method, params, phase) {
  try {
    send(child, { jsonrpc: "2.0", id, method, params });
  } catch (error) {
    if (error instanceof E2eFailure) {
      throw error;
    }
    fail("RPC request could not be sent", {
      code: "process",
      phase,
      action: "verify the local process is still running",
    });
  }
  return rpc.waitFor(id);
}

function failForAcpError(response, { phase, label, fallbackCode, fallbackAction }) {
  const raw = String(response?.error?.message ?? "").toLowerCase();
  if (/sqlite|state runtime|access denied|os error 5|permission|codex_home/.test(raw)) {
    fail(label, {
      code: "codex_state",
      phase,
      action: "ensure CODEX_HOME is writable, close other Codex clients, then rerun the opt-in test",
    });
  }
  if (/login|auth|credential|sign in|authenticate/.test(raw)) {
    fail(label, {
      code: "auth",
      phase,
      action: "log in to the local Codex client, then rerun with DAWNSIGHT_MCP_E2E=1",
    });
  }
  fail(label, { code: fallbackCode, phase, action: fallbackAction });
}

function sessionEnv(snapshotPath) {
  return {
    ...process.env,
    DAWNSIGHT_MCP_CONTEXT_FILE: snapshotPath,
    DAWNSIGHT_MCP_TOOL_PROFILE: "chat",
  };
}

function mcpServer(snapshotPath) {
  return {
    name: "dawnsight",
    command: mcpCommand,
    args: ["--dawnsight-mcp"],
    env: [
      { name: "DAWNSIGHT_MCP_CONTEXT_FILE", value: snapshotPath },
      { name: "DAWNSIGHT_MCP_TOOL_PROFILE", value: "chat" },
    ],
  };
}

function snapshotFixture() {
  const subtitleChoiceId = "online:e2e-fixture";
  return {
    schemaVersion: 5,
    anchor: {
      mediaPath: path.join(os.tmpdir(), "dawnsight-mcp-e2e-fixture.mp4"),
      mediaTitle: "Dawnsight MCP priority fixture",
      libraryRoot: null,
      groupKey: null,
      season: 1,
      episode: 2,
      positionMs: 60000,
      durationMs: 120000,
      sentAtMs: Date.now(),
      subtitleChoiceId,
    },
    currentEpisode: {
      season: 1,
      episode: 2,
      title: "MCP priority fixture",
      overview: "用于验证 Agent 会先读取 Dawnsight 上下文，而不是搜索网络。",
    },
    library: null,
    session: { turn: 1, mediaPath: "fixture", libraryWarmedTurn: 1, libraryWarmEvery: 5 },
    capabilities: {
      visionCapable: false,
      subtitleWorkshopEnabled: false,
      videoAnnotationsEnabled: true,
    },
    online: {
      mediaId: "e2e-fixture",
      title: "Dawnsight MCP priority fixture",
      durationMs: 120000,
      webpageUrl: "https://example.invalid/dawnsight-mcp-e2e",
      extractor: "fixture",
      chapters: [],
      subtitles: [{
        id: subtitleChoiceId,
        source: "Embedded",
        label: "Fixture transcript",
        supported: true,
        streamIndex: null,
        externalPath: null,
        codecName: "webvtt",
        language: "en",
      }],
      transcript: {
        sourcePath: "online-cache",
        choiceId: subtitleChoiceId,
        streamIndex: null,
        language: "en",
        codecName: "webvtt",
        cues: [{
          index: 0,
          startMs: 59000,
          endMs: 61000,
          text: "The fixture verifies that Dawnsight transcript context is available.",
        }],
      },
    },
    updatedAtMs: Date.now(),
  };
}

async function verifyMcpCatalog(snapshotPath) {
  const child = spawn(mcpCommand, ["--dawnsight-mcp"], {
    cwd: root,
    env: sessionEnv(snapshotPath),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const rpc = new RpcLines(child.stdout, "dawnsight MCP");
  attachProcessDiagnostics(child, rpc, "dawnsight MCP");
  try {
    const initialized = await request(rpc, child, 1, "initialize", {}, "initialize");
    if (initialized.error) {
      fail("Dawnsight MCP initialize failed", {
        code: "mcp_initialize",
        phase: "initialize",
        action: "rebuild the Dawnsight MCP executable and inspect its diagnostic log",
      });
    }
    const instructions = initialized.result?.instructions ?? "";
    for (const required of ["dawnsight_get_library_context", "dawnsight_get_transcript_window", "tools/list"]) {
      if (!instructions.includes(required)) {
        fail(`Dawnsight MCP instructions omitted ${required}`, {
          code: "mcp_instructions",
          phase: "initialize",
          action: "verify the stable MCP instructions contain the current tool directory",
        });
      }
    }

    const listed = await request(rpc, child, 2, "tools/list", {}, "tools/list");
    if (listed.error) {
      fail("Dawnsight MCP tools/list failed", {
        code: "mcp_tools_list",
        phase: "tools/list",
        action: "check the snapshot fixture and DAWNSIGHT_MCP_TOOL_PROFILE=chat",
      });
    }
    const names = (listed.result?.tools ?? []).map((tool) => tool.name);
    for (const required of ["dawnsight_get_library_context", "dawnsight_get_transcript_window"]) {
      if (!names.includes(required)) {
        fail(`Dawnsight MCP tools/list omitted ${required}`, {
          code: "mcp_tools_list",
          phase: "tools/list",
          action: "check the chat tool profile and snapshot capabilities",
        });
      }
    }
    if (names.some((name) => WEB_SEARCH_PATTERN.test(name))) {
      fail("Dawnsight MCP tools/list exposed a web-search tool", {
        code: "unexpected_tool",
        phase: "tools/list",
        action: "remove network-search tools from the Dawnsight MCP chat profile",
      });
    }

    const playback = await request(
      rpc,
      child,
      3,
      "tools/call",
      { name: "dawnsight_get_playback_context", arguments: {} },
      "snapshot playback context",
    );
    assertToolSuccess(playback, "dawnsight_get_playback_context", "snapshot playback context");
    const playbackPayload = parseToolText(playback, "dawnsight_get_playback_context", "snapshot playback context");
    if (playbackPayload?.anchor?.positionMs !== 60000 || playbackPayload?.currentEpisode?.episode !== 2) {
      fail("Dawnsight MCP returned an unexpected media snapshot", {
        code: "snapshot",
        phase: "snapshot playback context",
        action: "confirm the ACP prompt writes the current media snapshot before MCP startup",
      });
    }

    const transcript = await request(
      rpc,
      child,
      4,
      "tools/call",
      { name: "dawnsight_get_transcript_window", arguments: { beforeSec: 30, afterSec: 30 } },
      "snapshot transcript context",
    );
    assertToolSuccess(transcript, "dawnsight_get_transcript_window", "snapshot transcript context");
    const transcriptPayload = parseToolText(transcript, "dawnsight_get_transcript_window", "snapshot transcript context");
    if (!Array.isArray(transcriptPayload?.lines) || transcriptPayload.lines.length === 0) {
      fail("Dawnsight MCP snapshot transcript was empty", {
        code: "snapshot_transcript",
        phase: "snapshot transcript context",
        action: "select/cache a subtitle track before starting the ACP session",
      });
    }
    console.error("[ok] MCP initialize + instructions + tools/list + media snapshot verified");
  } finally {
    rpc.closed = true;
    rpc.close();
    stop(child);
  }
}

function assertToolSuccess(response, toolName, phase) {
  if (response.error || response.result?.isError === true) {
    fail(`Dawnsight MCP ${toolName} returned an error`, {
      code: "mcp_tool",
      phase,
      action: "check that the temporary media snapshot contains the required context",
    });
  }
}

function parseToolText(response, toolName, phase) {
  const text = response.result?.content?.find((item) => item.type === "text")?.text;
  if (typeof text !== "string") {
    fail(`Dawnsight MCP ${toolName} returned no text payload`, {
      code: "mcp_payload",
      phase,
      action: "check the MCP tool response contract",
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(`Dawnsight MCP ${toolName} returned invalid JSON text`, {
      code: "mcp_payload",
      phase,
      action: "check the MCP tool response contract",
    });
  }
}

function stringsIn(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => stringsIn(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => stringsIn(item, output));
  return output;
}

function namesFromToolUpdate(message) {
  const update = message?.params?.update;
  if (!update || !["tool_call", "tool_call_update"].includes(update.sessionUpdate)) return [];
  return stringsIn(update).filter((value) => /^dawnsight_[a-z_]+$/.test(value) || /web[_-]?search/i.test(value));
}

async function verifyAgentPriority(snapshotPath, workspace) {
  const child = spawn(process.execPath, [codexAcpEntry], {
    cwd: root,
    env: {
      ...process.env,
      CODEX_PATH: codexPath,
      CODEX_HOME: process.env.CODEX_HOME ?? path.join(process.env.USERPROFILE, ".codex"),
      TERM: "xterm-256color",
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stderr.on("data", () => {}); // Agent stderr is intentionally not surfaced by this test.
  const rpc = new RpcLines(child.stdout, "Codex ACP");
  attachProcessDiagnostics(child, rpc, "Codex ACP");
  const calls = [];
  const unsubscribe = rpc.subscribe((message) => calls.push(...namesFromToolUpdate(message)));
  try {
    const init = await request(rpc, child, 1, "initialize", {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
        clientInfo: { name: "dawnsight-mcp-e2e", title: "Dawnsight MCP E2E", version: "0.3.0" },
      }, "ACP initialize");
    if (init.error) {
      failForAcpError(init, {
        phase: "ACP initialize",
        label: "Codex ACP initialize failed",
        fallbackCode: "acp_initialize",
        fallbackAction: "verify the installed codex-acp and Codex versions are compatible",
      });
    }

    const auth = await request(rpc, child, 2, "authenticate", { methodId: "chat-gpt" }, "ACP authenticate");
    if (auth.error) {
      failForAcpError(auth, {
        phase: "ACP authenticate",
        label: "Codex ACP authentication/login failed",
        fallbackCode: "auth",
        fallbackAction: "log in to the local Codex client, then rerun with DAWNSIGHT_MCP_E2E=1",
      });
    }

    const created = await request(
      rpc,
      child,
      3,
      "session/new",
      { cwd: workspace, mcpServers: [mcpServer(snapshotPath)] },
      "ACP session/new",
    );
    if (created.error || !created.result?.sessionId) {
      if (created.error) {
        failForAcpError(created, {
          phase: "ACP session/new",
          label: "Codex ACP session/new failed",
          fallbackCode: "session_new",
          fallbackAction: "check the local ACP workspace and Dawnsight MCP executable configuration",
        });
      }
      fail("Codex ACP session/new returned no session", {
        code: "session_new",
        phase: "ACP session/new",
        action: "check the local ACP workspace and Dawnsight MCP executable configuration",
      });
    }

    const answered = await request(rpc, child, 4, "session/prompt", {
        sessionId: created.result.sessionId,
        prompt: [{ type: "text", text: "这一集主要讲了怎样的剧情？请仅依据 Dawnsight 当前媒体上下文回答。" }],
      }, "ACP plot prompt");
    if (answered.error) {
      failForAcpError(answered, {
        phase: "ACP plot prompt",
        label: "Codex ACP plot prompt failed",
        fallbackCode: "prompt",
        fallbackAction: "check Codex login, model availability, network access, and MCP startup diagnostics",
      });
    }

    if (calls.some((name) => WEB_SEARCH_PATTERN.test(name))) {
      fail("Agent used web search for the episode-plot prompt", {
        code: "web_search",
        phase: "ACP plot prompt",
        action: "inspect the recorded tool sequence and restore Dawnsight context-first instructions",
      });
    }
    const firstDawnsight = calls.find((name) => name.startsWith("dawnsight_"));
    if (!firstDawnsight) {
      fail("Agent did not call a Dawnsight context tool", {
        code: "no_dawnsight_tool",
        phase: "ACP plot prompt",
        action: "confirm the MCP server was attached to session/new and the model can use tools",
      });
    }
    if (!PLOT_TOOLS.has(firstDawnsight)) {
      fail(`first Dawnsight tool for plot was ${firstDawnsight}, not a plot-context tool`, {
        code: "tool_priority",
        phase: "ACP plot prompt",
        action: "inspect instructions/tool visibility and keep transcript/library first for plot questions",
      });
    }
    console.error(`[ok] plot prompt first Dawnsight tool: ${firstDawnsight}; web search: none`);
  } finally {
    unsubscribe();
    rpc.closed = true;
    rpc.close();
    stop(child);
  }
}

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "dawnsight-mcp-priority-"));
const snapshotPath = path.join(workspace, ".dawnsight", "agent-context.json");
fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
fs.writeFileSync(snapshotPath, JSON.stringify(snapshotFixture()));

try {
  await verifyMcpCatalog(snapshotPath);
  await verifyAgentPriority(snapshotPath, workspace);
} catch (error) {
  if (error instanceof E2eFailure) {
    console.error(`[fail] code=${error.code} phase=${error.phase}: ${error.message}`);
    console.error(`[diag] action=${error.action}`);
  } else {
    console.error("[fail] code=unexpected phase=runner: unexpected E2E failure");
    console.error("[diag] action=inspect the local test runner and rerun with a larger timeout");
  }
  process.exitCode = 1;
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}
