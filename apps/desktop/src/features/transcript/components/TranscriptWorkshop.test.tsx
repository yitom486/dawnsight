import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePlayerStore } from "@/features/player";
import { useTrackStore } from "@/features/player/trackStore";
import { useAskAboutStore } from "@dawnsight/chat-ui/askAboutStore";

import { SubtitleWorkshopPanel } from "./SubtitleWorkshopPanel";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: vi.fn().mockImplementation(() => ({ onmessage: null })),
}));

import { invoke } from "@tauri-apps/api/core";

const LONG_MODEL = `超长翻译模型标识不断尾WorkshopModelIdentifierWithoutSpaces${"型".repeat(32)}尾`;
const LONG_CHAPTER = `超长章节标题不断尾ChapterTitleWithoutSpaces${"长".repeat(32)}尾`;

function mockBackend(
  overrides: Record<string, (cmd: string, args?: unknown) => Promise<unknown>> = {},
) {
  vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
    if (overrides[cmd]) return overrides[cmd](cmd, args);
    if (cmd === "subtitle_list_choices")
      return Promise.resolve([
        { id: "s1", source: "Embedded", label: "中文", supported: true, streamIndex: 0 },
      ]);
    if (cmd === "subtitle_load_choice")
      return Promise.resolve({ choiceId: "s1", cues: [] });
    if (cmd === "asr_status")
      return Promise.resolve({ available: true, installSupported: true, models: [], catalog: [] });
    if (cmd === "media_inspect")
      return Promise.resolve({ path: "C:\\v\\a.mp4", streams: [], chapters: [] });
    if (cmd === "library_agent_models_discover") return Promise.resolve(null);
    if (cmd === "acp_models_discover")
      return Promise.resolve({
        connected: true,
        options: { models: [{ value: LONG_MODEL, name: LONG_MODEL }], reasoning: [] },
        message: "ok",
      });
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

beforeEach(() => {
  mockBackend();
  usePlayerStore.setState({
    currentFile: "C:\\v\\a.mp4",
    status: "Paused",
    currentTimeMs: 500,
  });
  useTrackStore.setState({ subtitleChoiceId: "s1" });
  useAskAboutStore.setState({ request: null });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("SubtitleWorkshopPanel presentation", () => {
  it.each([
    ["asr_install", "下载模型"],
    ["asr_transcribe", "生成字幕 (ASR)"],
    ["subtitle_proofread_track", "校对字幕"],
  ])("shows a mapped %s failure in the workshop and enables retry", async (command, name) => {
    mockBackend({ [command]: () => Promise.reject(new TypeError("PRIVATE_TASK_FAILURE")) });
    renderWorkshop();
    const button = await screen.findByRole("button", { name });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("操作失败，请重试");
    expect(document.body.textContent).not.toContain("PRIVATE_TASK_FAILURE");
    await waitFor(() => expect(button).toBeEnabled());
    expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === command)).toHaveLength(1);
  });
  it("asks about the active chapter with its start anchor once", async () => {
    mockBackend({
      media_inspect: () =>
        Promise.resolve({
          path: "C:\\v\\a.mp4",
          streams: [],
          chapters: [{ startMs: 0, endMs: 60_000, title: LONG_CHAPTER }],
        }),
    });
    renderWorkshop();
    fireEvent.change(await screen.findByLabelText("ASR transcription scope"), {
      target: { value: "chapter" },
    });
    await waitFor(() => {
      expect(screen.getByText(LONG_CHAPTER, { exact: false })).toBeInTheDocument();
    });
    const summarize = await screen.findByRole("button", { name: "总结本章" });
    fireEvent.click(summarize);
    await waitFor(() => {
      expect(useAskAboutStore.getState().request).not.toBeNull();
    });
    expect(useAskAboutStore.getState().request).toMatchObject({ anchorMs: 0 });
  });

  it("returns from the ASR transcript to the reading list", async () => {
    mockBackend({
      asr_transcribe: () =>
        Promise.resolve({ choiceId: "asr-new", cues: [{ index: 0, startMs: 0, endMs: 1000, text: "hi" }] }),
    });
    renderWorkshop();
    const generate = await screen.findByRole("button", { name: "生成字幕 (ASR)" });
    await waitFor(() => {
      expect(generate).toBeEnabled();
    });
    fireEvent.click(generate);
    const back = await screen.findByRole("button", { name: "回到字幕文稿" });
    fireEvent.click(back);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "回到字幕文稿" })).not.toBeInTheDocument();
    });
  });

  it("renders a long discovered model label in full", async () => {
    renderWorkshop();
    await waitFor(() => {
      expect(screen.getAllByText(LONG_MODEL, { exact: false }).length).toBeGreaterThanOrEqual(1);
    });
  });

  it("disables workshop actions while busy with zero new calls", async () => {
    let release!: (value: unknown) => void;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    mockBackend({
      subtitle_translate_track: () => gate as Promise<unknown>,
    });
    renderWorkshop();
    const translate = await screen.findByRole("button", { name: "翻译字幕" });
    await waitFor(() => {
      expect(translate).toBeEnabled();
    });
    fireEvent.click(translate);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "翻译中…" })).toBeDisabled();
    });
    const before = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "subtitle_translate_track").length;
    fireEvent.click(screen.getByRole("button", { name: "校对字幕" }));
    expect(
      vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "subtitle_translate_track"),
    ).toHaveLength(before);
    release({ choiceId: "s1", cues: [] });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "翻译字幕" })).toBeEnabled();
    });
  });

  it("maps a technical translate failure without leaking internals", async () => {
    mockBackend({
      subtitle_translate_track: () =>
        Promise.reject(new TypeError("PIPELINE_BACKEND exploded")),
    });
    renderWorkshop();
    const translate = await screen.findByRole("button", { name: "翻译字幕" });
    await waitFor(() => {
      expect(translate).toBeEnabled();
    });
    fireEvent.click(translate);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.queryByText(/PIPELINE_BACKEND exploded/)).not.toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/TypeError|details/i);
  });

  it("renders a long business failure in full", async () => {
    const longError = `翻译失败：该模型暂不支持此语言对TranslateFailedWithoutSpaces${"错".repeat(40)}尾`;
    mockBackend({
      subtitle_translate_track: () =>
        Promise.reject({ code: "TranslateFailed", message: longError }),
    });
    renderWorkshop();
    const translate = await screen.findByRole("button", { name: "翻译字幕" });
    await waitFor(() => {
      expect(translate).toBeEnabled();
    });
    fireEvent.click(translate);
    await waitFor(() => {
      expect(screen.getByText(longError, { exact: false })).toBeInTheDocument();
    });
  });
});
