import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAcpProfilesStore } from "@dawnsight/chat-ui/acpProfilesStore";
import { useAcpSettingsStore } from "@dawnsight/chat-ui/acpSettingsStore";
import { useModelCatalogStore } from "@dawnsight/chat-ui/modelCatalogStore";
import type { AcpStatus } from "./types";
import { useAgentModelControls } from "./useAgentModelControls";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: ((event: unknown) => void) | null = null;
  },
}));

import { invoke } from "@tauri-apps/api/core";

function statusFor(profileId: string): AcpStatus {
  return {
    available: true,
    adapterFound: true,
    codexFound: true,
    activeProfileId: profileId,
    profiles: [],
    message: "ok",
    sessionActive: false,
    busy: false,
  } as unknown as AcpStatus;
}

function optionsFor(profileId: string) {
  return {
    models: [{ value: `model-of-${profileId}`, name: `Model of ${profileId}` }],
    reasoningEfforts: [],
    currentModelId: null,
    currentReasoningEffort: null,
    extraOptions: [],
  };
}

function renderControls(profileId: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderHook(() => useAgentModelControls({ status: statusFor(profileId) }), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  localStorage.clear();
  useAcpProfilesStore.setState({ activeProfileId: "codex" });
  useAcpSettingsStore.setState({ modelId: "", reasoningEffort: "", modelSelectionsByProfile: {}, modelDefaultsInitializedByProfile: {} });
  useModelCatalogStore.getState().resetModelCatalog();
  vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
    if (cmd === "acp_models_discover") {
      const profileId =
        (args as { profileId?: string })?.profileId ??
        "codex";
      return Promise.resolve({
        connected: true,
        options: optionsFor(profileId),
        message: "ok",
      });
    }
    return Promise.resolve(null);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("useAgentModelControls profile-bucketed discovery", () => {
  it("keeps each agent's discovered options in its own bucket across switches", async () => {
    const { result } = renderControls("codex");

    await act(async () => {
      await result.current.discoverModels();
    });
    await waitFor(() => expect(
      result.current.discoveredOptionsByProfile["codex"]?.models.map((m) => m.value),
    ).toEqual(["model-of-codex"]));

    // 切到 claude：旧桶不清全量，只是失活（当前读到空）。
    await act(async () => {
      useAcpProfilesStore.getState().switchActiveProfileId("claude");
    });
    expect(result.current.discoveredOptions).toBeNull();
    expect(
      result.current.discoveredOptionsByProfile["codex"]?.models.map((m) => m.value),
    ).toEqual(["model-of-codex"]);

    await act(async () => {
      await result.current.discoverModels();
    });
    await waitFor(() => expect(
      result.current.discoveredOptionsByProfile["claude"]?.models.map((m) => m.value),
    ).toEqual(["model-of-claude"]));
    // codex 桶纹丝不动，绝不串台。
    expect(
      result.current.discoveredOptionsByProfile["codex"]?.models.map((m) => m.value),
    ).toEqual(["model-of-codex"]);

    // 切回 codex：自家桶即复用，当前读回 codex 模型。
    await act(async () => {
      useAcpProfilesStore.getState().switchActiveProfileId("codex");
    });
    expect(result.current.discoveredOptions?.models.map((m) => m.value)).toEqual([
      "model-of-codex",
    ]);
  });

  it("keeps the busy guard (switch-time disable mirrors prompting refusal)", async () => {    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result, rerender } = renderHook(
      ({ busy }: { busy: boolean }) =>
        useAgentModelControls({ status: statusFor("codex"), busy }),
      {
        initialProps: { busy: false },
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      },
    );
    await waitFor(() => expect(result.current.controlsDisabled).toBe(false));
    rerender({ busy: true });
    expect(result.current.controlsDisabled).toBe(true);
  });

  it("remembers live-advertised options per profile across switches without a session", async () => {
    const live = (profileId: string): AcpStatus =>
      ({
        ...statusFor(profileId),
        sessionModelOptions: optionsFor(profileId),
      }) as unknown as AcpStatus;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result, rerender } = renderHook(
      ({ status }: { status: AcpStatus }) => useAgentModelControls({ status }),
      {
        initialProps: { status: live("codex") },
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      },
    );
    // Live 下发即被记住（写穿证明）。
    expect(result.current.modelOptions.map((m) => m.value)).toEqual([
      "model-of-codex",
    ]);
    expect(
      useModelCatalogStore.getState().byProfile["codex"]?.models.map((m) => m.value),
    ).toEqual(["model-of-codex"]);

    // 切走且断开：清掉已存选择以隔离记忆与 saved 回退，再断言读空。
    await act(async () => {
      useAcpProfilesStore.getState().switchActiveProfileId("claude");
      useAcpSettingsStore.getState().patchSettings({ modelId: "", reasoningEffort: "" });
    });
    rerender({ status: { ...statusFor("claude"), available: false } });
    expect(result.current.modelOptions).toEqual([]);
    // codex 的记忆不受影响。
    expect(
      useModelCatalogStore.getState().byProfile["codex"]?.models.map((m) => m.value),
    ).toEqual(["model-of-codex"]);

    // 切回且依然无会话：记忆顶上，动态绑定不断。
    await act(async () => {
      useAcpProfilesStore.getState().switchActiveProfileId("codex");
    });
    rerender({ status: statusFor("codex") });
    expect(result.current.modelOptions.map((m) => m.value)).toEqual([
      "model-of-codex",
    ]);
  });
});
