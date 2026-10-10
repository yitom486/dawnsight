import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAcpProfilesStore } from "@dawnsight/chat-ui/acpProfilesStore";
import { useAcpSettingsStore } from "@dawnsight/chat-ui/acpSettingsStore";
import { useAcpSessionStore } from "@dawnsight/chat-ui/acpSessionStore";
import { useModelCatalogStore } from "@dawnsight/chat-ui/modelCatalogStore";
import { useChapterAgentSettingsStore } from "@dawnsight/chat-ui/chapterAgentSettingsStore";
import type { AcpSessionModelOptions, AgentProfileStatus } from "../types";
import { usePlayerStore } from "@/features/player";
import { ChaptersPanel } from "@/features/chapters/components/ChaptersPanel";
import { AcpPanel } from "./AcpPanel";
import { resetChatStoreEphemeralState } from "../chatRestore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class { onmessage: ((event: unknown) => void) | null = null; },
}));
import { invoke } from "@tauri-apps/api/core";

const profiles: AgentProfileStatus[] = [
  { id: "codex", name: "ChatGPT", kind: "Codex", command: "", args: [], env: {}, available: true },
  { id: "opencode", name: "OpenCode", kind: "OpenCode", command: "", args: [], env: {}, available: true },
];
function options(profileId: string): AcpSessionModelOptions {
  return {
    models: [1, 2].map((n) => ({ value: `${profileId}-model-${n}`, name: `${profileId} 模型 ${n}` })),
    reasoningEfforts: ["low", "high"].map((value) => ({ value, name: `${profileId} ${value}` })),
    currentModelId: `${profileId}-model-1`, currentReasoningEffort: "low", extraOptions: [],
  };
}
let liveProfile: string | null;
let discover: (profileId: string, modelId?: string | null) => Promise<unknown>;
let modelOptionsFor: (profileId: string, modelId?: string | null) => AcpSessionModelOptions;
let liveModels: Record<string, string>;
let clients: QueryClient[];

function mount(chat = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}><ChaptersPanel />{chat ? <AcpPanel /> : null}</QueryClientProvider>);
}
function calls(cmd: string) { return vi.mocked(invoke).mock.calls.filter(([name]) => name === cmd); }
function chapterRuntime() { return screen.getByRole("combobox", { name: "重分段运行时" }); }
function chapterModel() { return screen.getByRole("combobox", { name: "重分段模型" }); }

beforeEach(() => {
  localStorage.clear();
  resetChatStoreEphemeralState();
  clients = [];
  liveProfile = null;
  liveModels = {};
  useAcpProfilesStore.setState({ activeProfileId: "codex", profiles });
  useAcpSettingsStore.setState({ modelId: "", reasoningEffort: "", modelSelectionsByProfile: {}, modelDefaultsInitializedByProfile: {} });
  useChapterAgentSettingsStore.setState({ profileId: null, selections: {}, defaultsInitializedByProfile: {} });
  useAcpSessionStore.setState({ savedSessions: {} });
  useModelCatalogStore.getState().resetModelCatalog();
  usePlayerStore.setState({ currentFile: "C:\\fixture\\movie.mp4", status: "Paused", sourceKind: null });
  modelOptionsFor = (id, modelId) => ({ ...options(id), currentModelId: modelId || `${id}-model-1` });
  discover = async (id, modelId) => ({ connected: true, options: modelOptionsFor(id, modelId), message: "已获取配置" });
  vi.mocked(invoke).mockImplementation(async (cmd, args?: unknown) => {
    const input = args as { profileId?: string; modelId?: string | null; reasoningEffort?: string | null; profiles?: { activeProfileId: string }; config?: { profileId: string } };
    if (cmd === "acp_models_discover") return discover(input.profileId!, input.modelId);
    if (cmd === "library_agent_models_discover") return discover(input.config!.profileId);
    if (cmd === "acp_status") return {
      available: true, adapterFound: true, codexFound: true, profiles, busy: false, message: "可用",
      activeProfileId: input.profiles!.activeProfileId,
      sessionActive: liveProfile === input.profiles!.activeProfileId,
      // Deliberately omit sessionModelOptions: catalogue must work without chat.
      sessionModelOptions: null,
    };
    if (cmd === "acp_connect") { liveProfile = input.profileId!; return null; }
    if (cmd === "acp_close") { liveProfile = null; return null; }
    if (cmd === "acp_set_session_model") {
      const id = liveProfile || "codex";
      if (input.modelId) liveModels[id] = input.modelId;
      return { ...modelOptionsFor(id, liveModels[id]), ...(input.reasoningEffort ? { currentReasoningEffort: input.reasoningEffort } : {}) };
    }
    if (cmd === "media_inspect") return { path: "C:\\fixture\\movie.mp4", streams: [], chapters: [{ id: 0, startMs: 0, endMs: 60_000, title: "开场" }] };
    if (cmd === "chapter_segmentation_status") throw { code: "NotFound", message: "尚未开始" };
    if (cmd === "chapter_segmentation_start") return { id: 1, status: "pending", draftChapters: [] };
    if (cmd === "acp_task_contracts") return [];
    return null;
  });
});
afterEach(() => { cleanup(); clients.forEach((client) => client.clear()); vi.clearAllMocks(); });

describe("runtime configuration end-to-end (real UI → mocked ACP boundary)", () => {
  it("refreshes model-dependent reasoning levels in chapter and chat, without leaking old levels", async () => {
    modelOptionsFor = (id, requested) => {
      const modelId = requested || `${id}-model-1`;
      const levels = modelId.endsWith("-3") ? [] : modelId.endsWith("-2") ? ["medium", "max"] : ["low", "high"];
      return { ...options(id), models: [1, 2, 3].map((n) => ({ value: `${id}-model-${n}`, name: `${id} 模型 ${n}` })),
        currentModelId: modelId, reasoningEfforts: levels.map((value) => ({ value, name: value })), currentReasoningEffort: levels[0] ?? null };
    };
    mount(true);
    await waitFor(() => expect(chapterModel()).toHaveValue("codex-model-1"));
    fireEvent.change(chapterModel(), { target: { value: "codex-model-2" } });
    await waitFor(() => expect(within(screen.getByLabelText("重分段思考档")).getByRole("option", { name: "max" })).toBeInTheDocument());
    expect(within(screen.getByLabelText("重分段思考档")).queryByRole("option", { name: "high" })).toBeNull();
    expect(screen.getByLabelText("思考程度")).toHaveValue("low");
    expect(calls("acp_models_discover").some(([, args]) => (args as { modelId?: string }).modelId === "codex-model-2")).toBe(true);
    fireEvent.change(screen.getByRole("combobox", { name: "模型" }), { target: { value: "codex-model-2" } });
    await waitFor(() => expect(within(screen.getByLabelText("思考程度")).getByRole("option", { name: "max" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("思考程度"), { target: { value: "max" } });
    await waitFor(() => expect(calls("acp_set_session_model").slice(-1)[0]?.[1]).toMatchObject({ reasoningEffort: "max" }));
    fireEvent.change(chapterModel(), { target: { value: "codex-model-3" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新配置" })).not.toBeDisabled());
    expect(within(screen.getByLabelText("重分段思考档")).getAllByRole("option")).toHaveLength(1);
    expect(screen.getByLabelText("思考程度")).toHaveValue("max");
  });
  it("loads models and reasoning without mounting chat, switches runtimes and restores choices", async () => {
    mount();
    await waitFor(() => expect(chapterModel()).toHaveValue("codex-model-1"));
    fireEvent.change(chapterModel(), { target: { value: "codex-model-2" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新配置" })).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("重分段思考档"), { target: { value: "high" } });
    fireEvent.change(chapterRuntime(), { target: { value: "opencode" } });
    await waitFor(() => expect(chapterModel()).toHaveValue("opencode-model-1"));
    expect(within(chapterModel()).queryByText("codex 模型 2")).toBeNull();
    expect(screen.getByLabelText("重分段思考档")).toHaveValue("low");
    fireEvent.change(chapterModel(), { target: { value: "opencode-model-2" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新配置" })).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("重分段思考档"), { target: { value: "high" } });
    fireEvent.change(chapterRuntime(), { target: { value: "codex" } });
    await waitFor(() => expect(chapterModel()).toHaveValue("codex-model-2"));
    expect(screen.getByLabelText("重分段思考档")).toHaveValue("high");
    // Explicit Agent-default selection must remain blank, rather than silently backfilling.
    fireEvent.change(chapterModel(), { target: { value: "" } });
    expect(chapterModel()).toHaveValue("");
    const beforeRefresh = calls("acp_models_discover").length;
    fireEvent.click(screen.getByRole("button", { name: "刷新配置" }));
    await waitFor(() => expect(calls("acp_models_discover")).toHaveLength(beforeRefresh + 1));
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新配置" })).not.toBeDisabled());
    expect(chapterModel()).toHaveValue("");
    expect(calls("acp_connect")).toHaveLength(0);
    expect(calls("acp_close")).toHaveLength(0);
    expect(calls("acp_prompt")).toHaveLength(0);
    fireEvent.change(chapterRuntime(), { target: { value: "opencode" } });
    await waitFor(() => expect(chapterModel()).toHaveValue("opencode-model-2"));
    expect(screen.getByLabelText("重分段思考档")).toHaveValue("high");
    fireEvent.click(screen.getByRole("button", { name: "开始 AI 分段" }));
    await waitFor(() => expect(calls("chapter_segmentation_start").slice(-1)[0]?.[1]).toMatchObject({ request: { profileId: "opencode", modelId: "opencode-model-2", reasoningEffort: "high" } }));
  });

  it("loads and switches main chat models/effort while chapter configuration stays independent", async () => {
    mount(true);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "模型" })).toHaveValue("codex-model-1"));
    fireEvent.change(screen.getByRole("combobox", { name: "模型" }), { target: { value: "codex-model-2" } });
    await waitFor(() => expect(screen.getByLabelText("思考程度")).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("思考程度"), { target: { value: "high" } });
    await waitFor(() => expect(calls("acp_set_session_model").slice(-1)[0]?.[1]).toMatchObject({ modelId: null, reasoningEffort: "high" }));
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("切换 Agent"));
    await user.click(await screen.findByRole("menuitem", { name: "OpenCode" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "模型" })).toHaveValue("opencode-model-1"));
    expect(screen.getByLabelText("思考程度")).toHaveValue("low");
    expect(chapterRuntime()).toHaveValue("codex");
    expect(chapterModel()).toHaveValue("codex-model-1");
    const connects = calls("acp_connect").length;
    const closes = calls("acp_close").length;
    fireEvent.change(chapterRuntime(), { target: { value: "opencode" } });
    await waitFor(() => expect(chapterModel()).toHaveValue("opencode-model-1"));
    expect(calls("acp_connect")).toHaveLength(connects);
    expect(calls("acp_close")).toHaveLength(closes);
    fireEvent.change(screen.getByRole("combobox", { name: "模型" }), { target: { value: "opencode-model-2" } });
    await waitFor(() => expect(calls("acp_set_session_model").slice(-1)[0]?.[1]).toMatchObject({ modelId: "opencode-model-2", reasoningEffort: null }));
    await user.click(screen.getByLabelText("切换 Agent"));
    await user.click(await screen.findByRole("menuitem", { name: "ChatGPT" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "模型" })).toHaveValue("codex-model-2"));
    expect(screen.getByLabelText("思考程度")).toHaveValue("high");
  });

  it("ignores a late previous-runtime response and deduplicates requests across both surfaces", async () => {
    let finishCodex!: (result: unknown) => void;
    discover = (id) => id === "codex" ? new Promise((resolve) => { finishCodex = resolve; })
      : Promise.resolve({ connected: true, options: options(id), message: "已获取" });
    mount(true);
    await waitFor(() => expect(calls("acp_models_discover")).toHaveLength(1));
    fireEvent.change(chapterRuntime(), { target: { value: "opencode" } });
    await waitFor(() => expect(chapterModel()).toHaveValue("opencode-model-1"));
    fireEvent.change(chapterModel(), { target: { value: "opencode-model-2" } });
    await act(async () => finishCodex({ connected: true, options: options("codex"), message: "已获取" }));
    expect(chapterModel()).toHaveValue("opencode-model-2");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "模型" })).toHaveValue("codex-model-1"));
    expect(calls("acp_models_discover")).toHaveLength(3);
  });

  it("shows discovery failures, retries, and never invents reasoning levels for an unsupported runtime", async () => {
    discover = async () => { throw { code: "ProtocolError", message: "无法获取可用模型，请重试", details: "secret fixture stderr" }; };
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("无法获取可用模型，请重试");
    expect(screen.queryByText(/secret fixture/)).toBeNull();
    const plain = { ...options("codex"), reasoningEfforts: [], currentReasoningEffort: null };
    discover = async () => ({ connected: true, options: plain, message: "已获取" });
    fireEvent.click(screen.getByRole("button", { name: "刷新配置" }));
    await waitFor(() => expect(chapterModel()).toHaveValue("codex-model-1"));
    expect(within(screen.getByLabelText("重分段思考档")).getAllByRole("option")).toHaveLength(1);
    expect(calls("acp_connect")).toHaveLength(0);
    expect(calls("acp_models_discover")).toHaveLength(2);
  });

  it("invalidates changed launch configuration and preserves explicit defaults after remount", async () => {
    const view = mount();
    await waitFor(() => expect(chapterModel()).toHaveValue("codex-model-1"));
    fireEvent.change(chapterModel(), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("重分段思考档"), { target: { value: "" } });
    discover = async () => ({ connected: true, options: {
      ...options("codex"), models: [{ value: "changed-model", name: "新配置模型" }], currentModelId: "changed-model",
    }, message: "已获取" });
    act(() => useAcpProfilesStore.setState({ profiles: profiles.map((profile) => profile.id === "codex"
      ? { ...profile, env: { FIXTURE_REVISION: "2" } } : profile) }));
    await waitFor(() => expect(within(chapterModel()).getByRole("option", { name: "新配置模型" })).toBeInTheDocument());
    expect(calls("acp_models_discover")).toHaveLength(2);
    expect(chapterModel()).toHaveValue("");
    expect(screen.getByLabelText("重分段思考档")).toHaveValue("");
    view.unmount();
    mount();
    await waitFor(() => expect(calls("acp_models_discover")).toHaveLength(3));
    await waitFor(() => expect(within(chapterModel()).getByRole("option", { name: "新配置模型" })).toBeInTheDocument());
    expect(chapterModel()).toHaveValue("");
    expect(screen.getByLabelText("重分段思考档")).toHaveValue("");
  });
});
