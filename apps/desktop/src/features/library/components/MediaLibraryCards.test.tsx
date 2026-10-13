import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const LONG_TITLE = `超长候选标题不断尾CandidateTitleWithoutSpaces${"长".repeat(40)}尾`;

function pendingGroup(key: string, displayName: string) {
  return {
    root: "D:/m",
    group: {
      key,
      displayName,
      kind: "series",
      files: [`${key}.mp4`],
      manualTitle: null,
      resolution: { state: "pending" },
    },
  };
}

function mockBackend(
  overrides: Record<string, (cmd: string, args?: unknown) => Promise<unknown>> = {},
) {
  vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
    if (overrides[cmd]) return overrides[cmd](cmd, args);
    if (cmd === "library_status")
      return Promise.resolve({
        running: true,
        roots: ["D:/m"],
        pollIntervalSecs: 30,
        lastScanAtMs: null,
        lastScanError: null,
        indexedFiles: 0,
        pendingGroups: 0,
      });
    if (cmd === "library_pending_groups") return Promise.resolve([]);
    if (cmd === "library_search_tmdb") return Promise.resolve([]);
    if (cmd === "library_groups") return Promise.resolve([]);
    if (cmd === "library_credential_status")
      return Promise.resolve({ modelApiKeySaved: false, tmdbAccessTokenSaved: true });
    return Promise.resolve(null);
  });
}

function renderPanel(onClient?: (client: QueryClient) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  onClient?.(client);
  return render(
    <QueryClientProvider client={client}>
      <LibrarySettingsPanel />
    </QueryClientProvider>,
  );
}

function baseStore() {
  useLibrarySettingsStore.setState({
    roots: ["D:/m"],
    rootsFollowPlayback: false,
    pollIntervalSecs: 30,
    privacyAcknowledged: true,
    resolverProvider: "directApi",
    agentProfileId: "",
    agentModelId: "",
    agentReasoningEffort: "",
    modelBaseUrl: "https://api.example.com/v1",
    modelId: "test-model",
    tmdbLanguage: "zh-CN",
  });
}

beforeEach(() => {
  mockBackend();
  baseStore();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("MediaLibraryPanel cards", () => {
  it("retains cached pending and matched cards after refresh failure", async () => {
    let client!: QueryClient;
    let fail = false;
    mockBackend({
      library_pending_groups: () => fail ? Promise.reject(new TypeError("PRIVATE_PENDING_FAILURE")) : Promise.resolve([pendingGroup("p", "缓存待匹配")]),
      library_list_groups: () => fail ? Promise.reject(new TypeError("PRIVATE_GROUPS_FAILURE")) : Promise.resolve([{ ...pendingGroup("m", "缓存已匹配").group, resolution: { state: "matched" } }]),
      library_wiki_statuses: () => Promise.resolve([]),
      library_tmdb_statuses: () => Promise.resolve([]),
    });
    renderPanel(value => { client = value; });
    await screen.findByText("缓存待匹配");
    await screen.findByText("缓存已匹配");
    fail = true;
    await client.refetchQueries({ predicate: query => ["library-pending", "library-groups"].includes(String(query.queryKey[0])) });
    expect(screen.getByText("缓存待匹配")).toBeInTheDocument();
    expect(screen.getByText("缓存已匹配")).toBeInTheDocument();
    expect(screen.queryByText("待匹配分组（0）")).not.toBeInTheDocument();
  });

  it("does not show a zero count for failed pending data", async () => {
    mockBackend({ library_pending_groups: () => Promise.reject(new TypeError("PRIVATE_QUERY_FAILURE")) });
    renderPanel();
    await screen.findByText("操作失败，请重试");
    expect(screen.queryByText("待匹配分组（0）")).not.toBeInTheDocument();
  });
  it("shows a precondition instead of a fake zero when the watcher never ran", async () => {
    mockBackend({
      library_status: () =>
        Promise.resolve({
          running: false,
          roots: [],
          pollIntervalSecs: 30,
          lastScanAtMs: null,
          lastScanError: null,
          indexedFiles: 0,
          pendingGroups: 0,
        }),
    });
    renderPanel();
    await waitFor(() => {
      expect(
        screen.getByText(/启动媒体库扫描后，这里会列出待匹配分组/),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("手动选")).not.toBeInTheDocument();
    expect(screen.queryByText("待匹配分组（0）")).not.toBeInTheDocument();
  });

  it("shows a loading line while pending groups resolve", async () => {
    let release!: (value: unknown) => void;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    mockBackend({
      library_pending_groups: () => gate as Promise<unknown>,
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("正在读取待匹配分组…")).toBeInTheDocument();
    });
    release([]);
    await waitFor(() => {
      expect(screen.getByText("暂无待匹配分组。")).toBeInTheDocument();
    });
  });

  it("shows a mapped query error honestly without auto-retry", async () => {
    mockBackend({
      library_pending_groups: () =>
        Promise.reject(new TypeError("pending exploded")),
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("操作失败，请重试")).toBeInTheDocument();
    });
    expect(screen.queryByText(/pending exploded/)).not.toBeInTheDocument();
    expect(screen.queryByText(/未请求/)).not.toBeInTheDocument();
  });

  it("keeps field checkboxes scoped per card with identical labels", async () => {
    mockBackend({
      library_pending_groups: () =>
        Promise.resolve([pendingGroup("g1", "第一组"), pendingGroup("g2", "第二组")]),
      library_search_tmdb: () => Promise.resolve([]),
    });
    renderPanel();
    const manuals = await screen.findAllByText("手动选");
    expect(manuals).toHaveLength(2);
    for (const btn of manuals) {
      await waitFor(() => {
        expect(btn.closest("button")).toBeEnabled();
      });
      fireEvent.click(btn);
    }
    await waitFor(() => {
      expect(screen.getAllByText(/TMDb 没有返回候选/)).toHaveLength(2);
    });
    // Same business label in both cards, each resolving to its own control.
    const labels = screen.getAllByText("演员阵容");
    expect(labels.length).toBeGreaterThanOrEqual(2);
    const boxes = screen.getAllByRole("checkbox", { name: "演员阵容" });
    expect(boxes).toHaveLength(2);
    const labelledby = boxes.map((b) => b.getAttribute("aria-labelledby"));
    expect(new Set(labelledby).size).toBe(2);
    // Native enclosing label clicks toggle only their own card.
    fireEvent.click(boxes[1].closest("label")!);
    await waitFor(() => {
      expect(boxes[1]).not.toBeChecked();
    });
    expect(boxes[0]).toBeChecked();
  });

  it("confirms the right candidate per card without cross-wiring", async () => {
    mockBackend({
      library_pending_groups: () =>
        Promise.resolve([pendingGroup("g1", "第一组"), pendingGroup("g2", "第二组")]),
      library_search_tmdb: (_cmd, args) =>
        Promise.resolve([
          {
            tmdbId: (args as { title: string }).title === "第一组" ? 111 : 222,
            mediaType: "tv",
            title: (args as { title: string }).title,
            year: 2021,
          },
        ]),
      library_apply_tmdb_match: () =>
        Promise.resolve({ root: "D:/m", groupKey: "g", tmdbId: 1, mediaType: "tv", writtenFiles: ["a.json"] }),
    });
    renderPanel();
    const manuals = await screen.findAllByText("手动选");
    for (const btn of manuals) {
      await waitFor(() => {
        expect(btn.closest("button")).toBeEnabled();
      });
      fireEvent.click(btn);
    }
    await waitFor(() => {
      expect(screen.getAllByText("确认拉取")).toHaveLength(2);
    });
    fireEvent.click(screen.getAllByText("确认拉取")[1] as Element);
    await waitFor(() => {
      const calls = vi
        .mocked(invoke)
        .mock.calls.filter(([cmd]) => cmd === "library_apply_tmdb_match");
      expect(calls).toHaveLength(1);
    });
    expect(
      vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === "library_apply_tmdb_match")?.[1],
    ).toMatchObject({ tmdbId: 222, mediaType: "tv" });
    expect(
      vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "library_apply_tmdb_match"),
    ).toHaveLength(1);
  });

  it("renders long candidate titles and extracts in full", async () => {
    mockBackend({
      library_pending_groups: () => Promise.resolve([pendingGroup("g1", LONG_TITLE)]),
      library_search_tmdb: () =>
        Promise.resolve([{ tmdbId: 1, mediaType: "tv" as const, title: LONG_TITLE, year: null }]),
    });
    renderPanel();
    const manuals = await screen.findAllByText("手动选");
    const first = manuals[0] as Element;
    await waitFor(() => {
      expect(first.closest("button")).toBeEnabled();
    });
    fireEvent.click(first);
    // Card title + candidate row both carry the full title (no truncation).
    await waitFor(() => {
      expect(screen.getAllByText(LONG_TITLE, { exact: false })).toHaveLength(2);
    });
  });

  it("renders a matched card with wrapped title and honest counts", async () => {
    mockBackend({
      library_list_groups: () =>
        Promise.resolve([
          {
            key: "m1",
            displayName: LONG_TITLE,
            kind: "series",
            files: ["a.mp4", "b.mp4"],
            resolution: { state: "matched" },
          },
        ]),
      library_wiki_statuses: () => Promise.resolve([]),
      library_tmdb_statuses: () =>
        Promise.resolve([
          {
            groupKey: "m1",
            title: LONG_TITLE,
            castCount: 3,
            creatorsCount: 0,
            episodeFileCount: 0,
            network: null,
            status: null,
            updatedAtMs: 1_700_000_000_000,
          },
        ]),
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(LONG_TITLE, { exact: false })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText(/2 个文件/)).toBeInTheDocument();
    });
    expect(screen.getByText(/3 位演员/)).toBeInTheDocument();
  });

  it("gates the save-title action on editable input without busy writes", async () => {
    mockBackend({
      library_pending_groups: () => Promise.resolve([pendingGroup("g1", "第一组")]),
    });
    renderPanel();
    const save = await screen.findByText("仅存标题不上网");
    fireEvent.change(screen.getByLabelText("媒体匹配标题"), {
      target: { value: "" },
    });
    await waitFor(() => {
      expect(save.closest("button")).toBeDisabled();
    });
    fireEvent.change(screen.getByLabelText("媒体匹配标题"), {
      target: { value: "新标题" },
    });
    await waitFor(() => {
      expect(save.closest("button")).toBeEnabled();
    });
  });
});
