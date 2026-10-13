import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePlayerStore } from "@/features/player";

import { SubtitleWorkshopPanel } from "./SubtitleWorkshopPanel";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: vi.fn().mockImplementation(() => ({ onmessage: null })),
}));

import { invoke } from "@tauri-apps/api/core";

const LONG_RELEASE = `超长发布组标题不断尾ReleaseNameWithoutSpaces${"长".repeat(48)}尾`;

function mockBackend(
  overrides: Record<string, (cmd: string, args?: unknown) => Promise<unknown>> = {},
) {
  vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
    if (overrides[cmd]) return overrides[cmd](cmd, args);
    if (cmd === "subtitle_providers" || cmd === "subtitle_provider_status")
      return Promise.resolve([{ id: "subdl", hasKey: false }]);
    if (cmd === "subtitle_list_choices") return Promise.resolve([]);
    if (cmd === "subtitle_load_choice") return Promise.resolve({ choiceId: null, cues: [] });
    if (cmd === "asr_status")
      return Promise.resolve({ available: false, installSupported: false, models: [], catalog: [] });
    if (cmd === "media_inspect")
      return Promise.resolve({ path: "C:\\v\\a.mp4", streams: [], chapters: [] });
    if (cmd === "library_context_for_media") return Promise.resolve(null);
    if (cmd === "library_parse_filename") return Promise.resolve(null);
    if (cmd === "library_agent_models_discover") return Promise.resolve(null);
    if (cmd === "acp_models_discover")
      return Promise.resolve({ connected: false, options: { models: [], reasoning: [] }, message: "" });
    return Promise.resolve(null);
  });
}

function renderWorkshop() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SubtitleWorkshopPanel />
    </QueryClientProvider>,
  );
}

/** Rendered copy and naming attributes, excluding the editable secret field. */
function surfacedText() {
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  for (const el of Array.from(clone.querySelectorAll('input[type="password"]'))) {
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
  usePlayerStore.setState({
    currentFile: "C:\\v\\a.mp4",
    status: "Paused",
    currentTimeMs: 500,
  });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("OnlineSubtitleSection presentation", () => {
  it("names fields with their visible Chinese labels", async () => {
    renderWorkshop();
    await waitFor(() => {
      expect(screen.getByText("搜索字幕")).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/SubDL Key/)).toBeInTheDocument();
    expect(screen.getByLabelText("片名")).toBeInTheDocument();
    expect(screen.getByLabelText("季")).toBeInTheDocument();
    expect(screen.getByLabelText("集")).toBeInTheDocument();
    expect(screen.getByLabelText("优先语言")).toBeInTheDocument();
  });

  it("distinguishes provider loading from unconfigured", async () => {
    let release!: (value: unknown) => void;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    mockBackend({
      subtitle_providers: () => gate as Promise<unknown>,
      subtitle_provider_status: () => gate as Promise<unknown>,
    });
    renderWorkshop();
    await waitFor(() => {
      expect(screen.getByText(/检查中/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/未配置/)).not.toBeInTheDocument();
    release([{ id: "subdl", hasKey: false }]);
    await waitFor(() => {
      expect(screen.getByText(/未配置/)).toBeInTheDocument();
    });
  });

  it("shows a mapped provider failure instead of a stuck loader", async () => {
    mockBackend({
      subtitle_providers: () => Promise.reject(new TypeError("providers exploded")),
      subtitle_provider_status: () => Promise.reject(new TypeError("providers exploded")),
    });
    renderWorkshop();
    await waitFor(() => {
      expect(screen.queryByText(/检查中/)).not.toBeInTheDocument();
    });
    expect(screen.getByText("操作失败，请重试")).toBeInTheDocument();
    expect(screen.queryByText(/providers exploded/)).not.toBeInTheDocument();
  });

  it("checks the typed key without saving and keeps it on failure", async () => {
    mockBackend({
      subtitle_validate_provider_key: () =>
        Promise.resolve({ verified: false, message: "Key 无效，请检查后重试" }),
    });
    renderWorkshop();
    await waitFor(() => {
      expect(screen.getByText("搜索字幕")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText(/SubDL Key/), {
      target: { value: "test-key-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "检测" }));
    await waitFor(() => {
      expect(screen.getByText("Key 无效，请检查后重试")).toBeInTheDocument();
    });
    expect(
      (screen.getByLabelText(/SubDL Key/) as HTMLInputElement).value,
    ).toBe("test-key-123");
    expect(
      vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === "subtitle_set_provider_key"),
    ).toBe(false);
  });

  it("maps a technical check failure without leaking internals", async () => {
    mockBackend({
      subtitle_validate_provider_key: () =>
        Promise.reject(new TypeError("CHECK_BACKEND exploded")),
    });
    renderWorkshop();
    await waitFor(() => {
      expect(screen.getByText("搜索字幕")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText(/SubDL Key/), {
      target: { value: "test-key-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "检测" }));
    await waitFor(() => {
      expect(screen.getByText("操作失败，请重试")).toBeInTheDocument();
    });
    expect(screen.queryByText(/CHECK_BACKEND exploded/)).not.toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/TypeError|details/i);
  });

  it("saves the key once and clears the field", async () => {
    mockBackend({
      subtitle_set_provider_key: () => Promise.resolve({ id: "subdl", hasKey: true }),
    });
    renderWorkshop();
    await waitFor(() => {
      expect(screen.getByText("搜索字幕")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText(/SubDL Key/), {
      target: { value: "save-me" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存 Key" }));
    await waitFor(() => {
      expect(
        vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "subtitle_set_provider_key"),
      ).toHaveLength(1);
    });
    expect(
      vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === "subtitle_set_provider_key")?.[1],
    ).toMatchObject({ key: "save-me" });
    await waitFor(() => {
      expect((screen.getByLabelText(/SubDL Key/) as HTMLInputElement).value).toBe("");
    });
  });

  it("keeps the typed key when saving fails", async () => {
    mockBackend({
      subtitle_set_provider_key: () =>
        Promise.reject(new TypeError("SAVE_BACKEND exploded")),
    });
    renderWorkshop();
    await waitFor(() => {
      expect(screen.getByText("搜索字幕")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText(/SubDL Key/), {
      target: { value: "keep-me" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存 Key" }));
    await waitFor(() => {
      expect(screen.getByText("操作失败，请重试")).toBeInTheDocument();
    });
    expect(
      (screen.getByLabelText(/SubDL Key/) as HTMLInputElement).value,
    ).toBe("keep-me");
    expect(screen.queryByText(/SAVE_BACKEND exploded/)).not.toBeInTheDocument();
  });

  it("maps a technical search failure without clearing the inputs", async () => {
    mockBackend({
      subtitle_search_online: () =>
        Promise.reject(new TypeError("SEARCH_BACKEND exploded")),
    });
    renderWorkshop();
    await waitFor(() => {
      expect(screen.getByText("搜索字幕")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText("片名"), {
      target: { value: "Our Beloved Summer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "搜索字幕" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText("操作失败，请重试")).toBeInTheDocument();
    expect(screen.getByLabelText("片名")).toHaveValue("Our Beloved Summer");
    expect(screen.queryByText(/SEARCH_BACKEND exploded/)).not.toBeInTheDocument();
  });

  it("maps a technical download failure and keeps the row retryable", async () => {
    mockBackend({
      subtitle_search_online: () =>
        Promise.resolve([
          {
            provider: "subdl",
            language: "zh",
            releaseName: LONG_RELEASE,
            format: "srt",
            sizeBytes: 12345,
            cached: false,
          },
        ]),
      subtitle_download_candidate: () =>
        Promise.reject(new TypeError("DOWNLOAD_BACKEND exploded")),
    });
    renderWorkshop();
    await waitFor(() => {
      expect(screen.getByText("搜索字幕")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "搜索字幕" }));
    await waitFor(() => {
      expect(screen.getByText(LONG_RELEASE, { exact: false })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "下载" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText("操作失败，请重试")).toBeInTheDocument();
    expect(screen.queryByText(/DOWNLOAD_BACKEND exploded/)).not.toBeInTheDocument();
    expect(screen.getByText(LONG_RELEASE, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下载" })).toBeEnabled();
  });

  it("renders long candidate names in full with cached state as text", async () => {
    mockBackend({
      subtitle_search_online: () =>
        Promise.resolve([
          {
            provider: "subdl",
            language: "zh",
            releaseName: LONG_RELEASE,
            format: "srt",
            sizeBytes: 12345,
            cached: true,
          },
        ]),
    });
    renderWorkshop();
    await waitFor(() => {
      expect(screen.getByText("搜索字幕")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "搜索字幕" }));
    await waitFor(() => {
      expect(screen.getByText(LONG_RELEASE, { exact: false })).toBeInTheDocument();
    });
    expect(screen.getByText(/已缓存/)).toBeInTheDocument();
  });

  it("disables everything while busy with zero additional calls", async () => {
    let release!: (value: unknown) => void;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    mockBackend({
      subtitle_search_online: () => gate as Promise<unknown>,
    });
    renderWorkshop();
    await waitFor(() => {
      expect(screen.getByText("搜索字幕")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "搜索字幕" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "搜索中…" })).toBeDisabled();
    });
    expect(screen.getByLabelText(/SubDL Key/)).toBeDisabled();
    const before = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "subtitle_search_online").length;
    fireEvent.click(screen.getByRole("button", { name: "搜索中…" }));
    expect(
      vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "subtitle_search_online"),
    ).toHaveLength(before);
    release([]);
    await waitFor(() => {
      expect(screen.getByText(/没有找到可用字幕/)).toBeInTheDocument();
    });
  });

  it("never surfaces the typed key outside its field", async () => {
    mockBackend({
      subtitle_validate_provider_key: () =>
        Promise.resolve({ verified: false, message: "Key 无效" }),
    });
    renderWorkshop();
    await waitFor(() => {
      expect(screen.getByText("搜索字幕")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText(/SubDL Key/), {
      target: { value: "super-secret-key-999" },
    });
    fireEvent.click(screen.getByRole("button", { name: "检测" }));
    await waitFor(() => {
      expect(screen.getByText("Key 无效")).toBeInTheDocument();
    });
    const surfaced = surfacedText();
    expect(surfaced.html).not.toContain("super-secret-key-999");
    expect(surfaced.attrs).not.toContain("super-secret");
  });
});
