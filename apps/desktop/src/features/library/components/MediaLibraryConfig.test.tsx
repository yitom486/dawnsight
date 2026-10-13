import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAcpProfilesStore } from "@dawnsight/chat-ui/acpProfilesStore";
import { useLibrarySettingsStore } from "../settingsStore";
import { LibrarySettingsPanel } from "./LibrarySettingsPanel";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: vi.fn().mockImplementation(function (this: unknown) {
    (this as { onmessage: unknown }).onmessage = null;
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn().mockResolvedValue(null),
}));

import { invoke } from "@tauri-apps/api/core";

const IDLE_STATUS = {
  running: false,
  roots: [],
  pollIntervalSecs: 30,
  lastScanAtMs: null,
  lastScanError: null,
  indexedFiles: 0,
  pendingGroups: 0,
};

function mockBackend(
  overrides: Record<string, (cmd: string, args?: unknown) => Promise<unknown>> = {},
) {
  vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
    if (overrides[cmd]) return overrides[cmd](cmd, args);
    if (cmd === "library_status") return Promise.resolve({ ...IDLE_STATUS });
    if (cmd === "library_credential_status")
      return Promise.resolve({ modelApiKeySaved: false, tmdbAccessTokenSaved: false });
    return Promise.resolve(null);
  });
}

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <LibrarySettingsPanel />
    </QueryClientProvider>,
  );
}

async function openDetails() {
  fireEvent.click(await screen.findByText("智能匹配设置"));
  await waitFor(() => {
    expect(screen.getByLabelText("智能匹配来源")).toBeInTheDocument();
  });
}

/** Rendered copy and naming attributes, excluding editable secret fields. */
function surfacedText() {
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  for (const el of Array.from(
    clone.querySelectorAll('input[type="password"]'),
  )) {
    (el as HTMLInputElement).value = "";
    el.removeAttribute("value");
  }
  const attrs: string[] = [];
  for (const el of Array.from(clone.querySelectorAll("*"))) {
    for (const attr of ["title", "aria-label", "aria-description", "alt"]) {
      const v = el.getAttribute(attr);
      if (v) attrs.push(v);
    }
  }
  return { html: clone.outerHTML, attrs: attrs.join("\n") };
}

beforeEach(() => {
  mockBackend();
  useAcpProfilesStore.setState({
    activeProfileId: "codex",
    profiles: [
      { id: "codex", name: "Codex" },
      { id: "claude", name: "Claude" },
    ],
  } as never);
  useLibrarySettingsStore.setState({
    roots: [],
    rootsFollowPlayback: true,
    pollIntervalSecs: 30,
    privacyAcknowledged: false,
    resolverProvider: "directApi",
    agentProfileId: "",
    agentModelId: "",
    agentReasoningEffort: "",
    modelBaseUrl: "",
    modelId: "",
    tmdbLanguage: "zh-CN",
  });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("MediaLibraryPanel match config and credentials", () => {
  it.each([
    ["agent", "library_agent_models_discover", "连接 Agent 并获取模型"],
    ["direct", "library_models_discover", "连接并获取模型"],
    ["save", "library_credentials_save", "保存到此设备"],
    ["validate", "library_credentials_validate", "验证全部配置"],
    ["tmdb", "library_tmdb_credentials_validate", "验证 TMDb Token"],
    ["delete-model", "library_credential_delete", "删除模型密钥"],
    ["delete-tmdb", "library_credential_delete", "删除 TMDb Token"],
  ])("handles %s rejection with business copy and keeps retry usable", async (flow, command, buttonName) => {
    useLibrarySettingsStore.setState({ resolverProvider: flow === "agent" ? "acpAgent" : "directApi", modelBaseUrl: "https://api.example.com/v1" });
    mockBackend({
      library_credential_status: () => Promise.resolve({ modelApiKeySaved: true, tmdbAccessTokenSaved: true }),
      [command]: () => Promise.reject({ code: "CredentialAccessFailed", message: "PRIVATE_NATIVE_FAILURE", details: "PRIVATE_FAKE_SECRET" }),
    });
    renderPanel();
    await openDetails();
    if (flow === "save") fireEvent.change(screen.getByLabelText(/模型 API Key/), { target: { value: "fake-pending-key" } });
    const button = await screen.findByRole("button", { name: buttonName });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("无法访问系统安全凭据，请检查系统账户后重试");
    const surfaced = surfacedText();
    expect(surfaced.html).not.toMatch(/PRIVATE_NATIVE_FAILURE|PRIVATE_FAKE_SECRET/);
    if (flow === "save") expect((screen.getByLabelText(/模型 API Key/) as HTMLInputElement).value).toBe("fake-pending-key");
    await waitFor(() => expect(button).toBeEnabled());
    expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === command)).toHaveLength(1);
  });

  it("does not issue a duplicate save while pending and preserves the secret on failure", async () => {
    let reject!: (reason: unknown) => void;
    const gate = new Promise((_, fail) => { reject = fail; });
    mockBackend({ library_credentials_save: () => gate });
    renderPanel();
    await openDetails();
    fireEvent.change(screen.getByLabelText(/模型 API Key/), { target: { value: "fake-pending-key" } });
    const button = screen.getByRole("button", { name: "保存到此设备" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "library_credentials_save")).toHaveLength(1);
    reject(new TypeError("PRIVATE_SAVE_FAILURE"));
    expect(await screen.findByRole("alert")).toHaveTextContent("操作失败，请重试");
    await waitFor(() => expect(button).toBeEnabled());
    expect((screen.getByLabelText(/模型 API Key/) as HTMLInputElement).value).toBe("fake-pending-key");
  });
  it("switches resolver provider and clears pending validation", async () => {
    renderPanel();
    await openDetails();
    const select = screen.getByLabelText("智能匹配来源") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "acpAgent" } });
    await waitFor(() => {
      expect(useLibrarySettingsStore.getState().resolverProvider).toBe("acpAgent");
    });
    expect(screen.getByLabelText("用于智能匹配的 Agent")).toBeInTheDocument();
  });

  it("discovers agent models with profile context exactly once", async () => {
    useLibrarySettingsStore.setState({ resolverProvider: "acpAgent" });
    mockBackend({
      library_agent_models_discover: () =>
        Promise.resolve({
          connected: true,
          message: "Agent 已连接，可用模型 2 个",
          options: [{ value: "mini", name: "mini" }],
        }),
    });
    renderPanel();
    await openDetails();
    fireEvent.click(
      await screen.findByRole("button", { name: "连接 Agent 并获取模型" }),
    );
    await waitFor(() => {
      expect(
        vi
          .mocked(invoke)
          .mock.calls.filter(([cmd]) => cmd === "library_agent_models_discover"),
      ).toHaveLength(1);
    });
    const [, args] = vi
      .mocked(invoke)
      .mock.calls.find(([cmd]) => cmd === "library_agent_models_discover") as [
      string,
      { config: Record<string, unknown> },
    ];
    expect((args.config as Record<string, unknown>).profileId).toBe("codex");
    expect(await screen.findByText("Agent 已连接，可用模型 2 个")).toBeInTheDocument();
  });

  it("renders a long saved agent model id in full", async () => {
    const longId = `超长模型标识不断尾ModelIdentifierWithoutSpaces${"x".repeat(48)}尾`;
    useLibrarySettingsStore.setState({
      resolverProvider: "acpAgent",
      agentModelId: longId,
    });
    renderPanel();
    await openDetails();
    const saved = await screen.findByText((_, el) => {
      if (el?.tagName !== "P") return false;
      return (el.textContent ?? "").includes(longId);
    });
    expect(saved).toBeInTheDocument();
  });

  it("saves a pending key before discovering, then clears the field", async () => {
    const saved: unknown[] = [];
    mockBackend({
      library_credentials_save: (_cmd, args) => {
        saved.push((args as { input: unknown }).input);
        return Promise.resolve({ modelApiKeySaved: true, tmdbAccessTokenSaved: false });
      },
      library_models_discover: () =>
        Promise.resolve({
          connected: true,
          message: "直连模型已就绪",
          models: ["long-model-id"],
        }),
    });
    renderPanel();
    await openDetails();
    fireEvent.change(screen.getByLabelText(/模型服务地址/), {
      target: { value: "https://api.example.com/v1" },
    });
    fireEvent.change(screen.getByLabelText(/模型 API Key/), {
      target: { value: "  sk-test-123  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并连接" }));
    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });
    expect(saved[0]).toEqual({ modelApiKey: "sk-test-123" });
    await waitFor(() => {
      expect(
        (screen.getByLabelText(/模型 API Key/) as HTMLInputElement).value,
      ).toBe("");
    });
    expect(await screen.findByText("直连模型已就绪")).toBeInTheDocument();
  });

  it("validates everything with persisted pending secrets and shows item states", async () => {
    mockBackend({
      library_credentials_validate: () =>
        Promise.resolve({
          model: { verified: true, message: "模型服务连通" },
          tmdb: { verified: false, message: "TMDb Token 无效" },
        }),
    });
    renderPanel();
    await openDetails();
    fireEvent.change(screen.getByLabelText(/TMDb Read Access Token/), {
      target: { value: "tmdb-test-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: /验证全部配置/ }));
    await waitFor(() => {
      expect(screen.getByText("模型服务连通", { exact: false })).toBeInTheDocument();
    });
    expect(screen.getByText("TMDb Token 无效", { exact: false })).toBeInTheDocument();
    expect(
      vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === "library_credentials_save"),
    ).toBe(true);
  });

  it("deletes the TMDb token with its kind and keeps the contract", async () => {
    mockBackend({
      library_credential_status: () =>
        Promise.resolve({ modelApiKeySaved: false, tmdbAccessTokenSaved: true }),
      library_credential_delete: () =>
        Promise.resolve({ modelApiKeySaved: false, tmdbAccessTokenSaved: false }),
    });
    renderPanel();
    await openDetails();
    const del = await screen.findByRole("button", { name: "删除 TMDb Token" });
    await waitFor(() => {
      expect(del).toBeEnabled();
    });
    fireEvent.click(del);
    await waitFor(() => {
      expect(
        vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "library_credential_delete"),
      ).toHaveLength(1);
    });
    expect(
      vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === "library_credential_delete")?.[1],
    ).toEqual({ kind: "tmdbAccessToken" });
  });

  it("toggles the privacy acknowledgement in the purpose store", async () => {
    renderPanel();
    await openDetails();
    const box = screen.getByRole("checkbox", {
      name: /允许将文件名和相对目录名发送到所选解析器/,
    });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    await waitFor(() => {
      expect(useLibrarySettingsStore.getState().privacyAcknowledged).toBe(true);
    });
  });

  it("dismisses the global error and keeps its contract", async () => {
    mockBackend({
      library_status: () =>
        Promise.resolve({ ...IDLE_STATUS, running: true, roots: ["D:/媒体"] }),
      library_watch_stop: () => Promise.reject(new TypeError("stop exploded")),
    });
    renderPanel();
    const stop = await screen.findByRole("button", { name: "停止" });
    await waitFor(() => {
      expect(stop).toBeEnabled();
    });
    fireEvent.click(stop);
    const dismiss = await screen.findByRole("button", { name: "关闭错误提示" });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/stop exploded/)).not.toBeInTheDocument();
    fireEvent.click(dismiss);
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  it("never surfaces typed secrets outside their fields", async () => {
    mockBackend({
      library_credentials_save: () =>
        Promise.resolve({ modelApiKeySaved: true, tmdbAccessTokenSaved: true }),
      library_credentials_validate: () =>
        Promise.resolve({
          model: { verified: true, message: "模型服务连通" },
          tmdb: { verified: true, message: "TMDb 连通" },
        }),
    });
    renderPanel();
    await openDetails();
    fireEvent.change(screen.getByLabelText(/模型 API Key/), {
      target: { value: "sk-live-secret-123" },
    });
    fireEvent.change(screen.getByLabelText(/TMDb Read Access Token/), {
      target: { value: "tmdb-live-secret-456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /验证全部配置/ }));
    await waitFor(() => {
      expect(screen.getByText("模型服务连通", { exact: false })).toBeInTheDocument();
    });
    const surfaced = surfacedText();
    expect(surfaced.html).not.toContain("sk-live-secret-123");
    expect(surfaced.html).not.toContain("tmdb-live-secret-456");
    expect(surfaced.attrs).not.toContain("sk-live-secret");
  });

  it("keeps purpose model state out of chat and chapter stores", async () => {
    const { useAcpSettingsStore } = await import("@dawnsight/chat-ui/acpSettingsStore");
    const { useChapterAgentSettingsStore } = await import(
      "@dawnsight/chat-ui/chapterAgentSettingsStore"
    );
    const chatBefore = useAcpSettingsStore.getState().modelId;
    const chapterBefore = useChapterAgentSettingsStore.getState().profileId;
    renderPanel();
    await openDetails();
    fireEvent.change(screen.getByLabelText(/模型服务地址/), {
      target: { value: "https://api.example.com/v1" },
    });
    fireEvent.change(screen.getByLabelText(/模型 API Key/), {
      target: { value: "sk-x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并连接" }));
    await waitFor(() => {
      expect(
        vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === "library_models_discover"),
      ).toBe(true);
    });
    expect(useAcpSettingsStore.getState().modelId).toBe(chatBefore);
    expect(useChapterAgentSettingsStore.getState().profileId).toBe(chapterBefore);
    expect(useLibrarySettingsStore.getState().modelBaseUrl).toBe(
      "https://api.example.com/v1",
    );
  });
});
