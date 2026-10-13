import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePlayerStore } from "@/features/player";
import { useNoteComposeStore } from "@/features/notes/noteComposeStore";

import { RecapCardDialog } from "./RecapCardDialog";
import { NotesPanel } from "./NotesPanel";
import { decodeImage } from "../recapCard";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));

vi.mock("../recapCard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../recapCard")>();
  return { ...actual, decodeImage: vi.fn() };
});

import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

const NOTE = {
  id: "n1",
  mediaPath: "C:\\v\\a.mp4",
  positionMs: 512_000,
  body: "卡片正文",
  quotes: [
    { index: 11, startMs: 495_000, endMs: 540_000, text: "引用台词", anchor: true },
  ],
  frames: [{ atMs: 512_000, file: "n1.jpg" }],
  createdAt: "t",
  updatedAt: "t",
};

const FRAME = { mime: "image/png", data: "AAA" };

function mockCanvas() {
  const ctx = {
    fillRect: vi.fn(),
    fillText: vi.fn(),
    drawImage: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    font: "",
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/png;base64,AAA",
  );
  (globalThis as unknown as { __recapCtx: unknown }).__recapCtx = ctx;
  return ctx;
}

function lastCtx() {
  return (globalThis as unknown as { __recapCtx: {
    fillRect: { mock: { calls: unknown[][] } };
    drawImage: { mock: { calls: unknown[][] } };
  } }).__recapCtx;
}

function exportCalls() {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "notes_export_recap_card");
}

function renderDialog(onClose: () => void = () => {}, mediaPath = NOTE.mediaPath) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <RecapCardDialog note={NOTE} mediaPath={mediaPath} open onClose={onClose} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockCanvas();
  vi.mocked(decodeImage).mockResolvedValue({ width: 2, height: 2 } as never);
  vi.mocked(save).mockResolvedValue("C:\\v\\card.png");
  vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
    if (cmd === "notes_get_frame") return Promise.resolve(FRAME);
    if (cmd === "notes_list") {
      const mediaPath = (args as { mediaPath?: string } | undefined)?.mediaPath;
      return Promise.resolve(mediaPath === NOTE.mediaPath ? [NOTE] : []);
    }
    if (cmd === "notes_export_recap_card") return Promise.resolve(null);
    return Promise.resolve(null);
  });
  usePlayerStore.setState({
    currentFile: "C:\\v\\a.mp4",
    status: "Paused",
    currentTimeMs: 512_000,
  });
  useNoteComposeStore.setState({
    mediaPath: null,
    body: "",
    includeQuotes: true,
    quoteMode: "auto",
    selectedIndices: [],
    anchorCueIndex: null,
    lastPickedCueIndex: null,
    lastPickedListIndex: null,
  });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("RecapCardDialog inline preview", () => {
  it.each([
    ["https://www.example.com/stream.m3u8?sig=PRIVATE_REVIEW_SECRET", "在线视频 · example.com · 8:32"],
    ["https://bad url?sig=PRIVATE_REVIEW_SECRET", "在线视频 · 8:32"],
  ])("keeps remote credentials out of the caption and exported drawing: %s", async (path, caption) => {
    renderDialog(undefined, path);
    await screen.findByText(caption);
    expect(document.body.textContent).not.toContain("PRIVATE_REVIEW_SECRET");
    const ctx = (globalThis as unknown as { __recapCtx: {
      fillText: { mock: { calls: unknown[][] } };
    } }).__recapCtx;
    expect(ctx.fillText.mock.calls.length).toBeGreaterThan(0);
    expect(ctx.fillText.mock.calls.flat().join(" ")).not.toContain("PRIVATE_REVIEW_SECRET");
  });

  it("renders in normal flow without dialog semantics or backdrop", async () => {
    const onClose = vi.fn();
    renderDialog(onClose);
    await screen.findByText("打卡卡片预览");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText(/S01|a\.mp4|卡片正文|8:32/)).toBeInTheDocument();
    expect(document.activeElement).toHaveTextContent("返回笔记");
    const canvas = document.querySelector("canvas") as HTMLCanvasElement;
    expect(canvas.width).toBe(720);
    expect(canvas.height).toBe(960);
    // Frame branch draws the decoded image; the text fallback does not.
    await waitFor(() => {
      expect(lastCtx().drawImage.mock.calls.length).toBeGreaterThan(0);
    });
  });

  it("switches ratio and redraws without moving focus", async () => {
    renderDialog();
    await screen.findByText("打卡卡片预览");
    const select = screen.getByLabelText("打卡卡片比例") as HTMLSelectElement;
    select.focus();
    fireEvent.change(select, { target: { value: "9:16" } });
    await waitFor(() => {
      expect((document.querySelector("canvas") as HTMLCanvasElement).width).toBe(640);
    });
    expect(document.activeElement).toBe(select);
  });

  it("degrades to a text card when there is no frame", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "notes_get_frame") return Promise.resolve(null);
      return Promise.resolve(null);
    });
    vi.mocked(decodeImage).mockResolvedValue(null);
    renderDialog();
    await screen.findByText("打卡卡片预览");
    expect((document.querySelector("canvas") as HTMLCanvasElement).width).toBe(720);
    expect(lastCtx().drawImage.mock.calls).toHaveLength(0);
    expect(screen.queryByText(/2d context|解码/)).not.toBeInTheDocument();
  });

  it("exports with the canvas PNG and reports the saved path", async () => {
    renderDialog();
    await screen.findByText("打卡卡片预览");
    fireEvent.click(screen.getByText("导出 PNG"));
    await waitFor(() => {
      expect(exportCalls()).toHaveLength(1);
    });
    expect(exportCalls()[0]?.[1]).toMatchObject({
      destPath: "C:\\v\\card.png",
      pngBase64: "AAA",
    });
    await screen.findByText(/已保存至/);
  });

  it("does nothing when the save dialog is cancelled", async () => {
    vi.mocked(save).mockResolvedValue(null);
    renderDialog();
    await screen.findByText("打卡卡片预览");
    fireEvent.click(screen.getByText("导出 PNG"));
    await waitFor(() => {
      expect(vi.mocked(save)).toHaveBeenCalled();
    });
    expect(exportCalls()).toHaveLength(0);
  });

  it("rejects repeated exports while busy and retries after failure", async () => {
    let release!: (value: unknown) => void;
    const gate = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "notes_get_frame") return Promise.resolve(FRAME);
      if (cmd === "notes_export_recap_card") return gate;
      return Promise.resolve(null);
    });
    renderDialog();
    await screen.findByText("打卡卡片预览");
    fireEvent.click(screen.getByText("导出 PNG"));
    await screen.findByText("导出中…");
    fireEvent.click(screen.getByText("导出中…"));
    expect(exportCalls()).toHaveLength(1);
    release(null);
    await screen.findByText(/已保存至/);
  });

  it("shows only the business message when export fails", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "notes_get_frame") return Promise.resolve(FRAME);
      if (cmd === "notes_export_recap_card") return Promise.reject(new Error("boom"));
      return Promise.resolve(null);
    });
    renderDialog();
    await screen.findByText("打卡卡片预览");
    fireEvent.click(screen.getByText("导出 PNG"));
    await waitFor(() => {
      expect(screen.getByText("操作失败，请重试")).toBeInTheDocument();
    });
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
    expect(screen.getByText("导出 PNG")).toBeInTheDocument();
  });

  it("returns via its own Escape and skips already-consumed keys", async () => {
    const onClose = vi.fn();
    renderDialog(onClose);
    await screen.findByText("打卡卡片预览");
    const section = screen.getByText("打卡卡片预览").closest("section") as Element;
    const consumed = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    consumed.preventDefault();
    fireEvent(section, consumed);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(section, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("NotesPanel recap assembly", () => {
  function renderAssembly() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <NotesPanel />
      </QueryClientProvider>,
    );
    return client;
  }

  function cardTriggerFor(body: string) {
    const card = screen.getByText(body).closest("div.rounded-md") as Element;
    const trigger = [...card.querySelectorAll("button")].find(
      (button) => button.textContent === "打卡卡片",
    ) as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    return trigger;
  }

  it("opens the preview exclusively and keeps the draft", async () => {
    renderAssembly();
    await screen.findByText("卡片正文");
    fireEvent.change(screen.getByPlaceholderText("写下这一刻的感想…"), {
      target: { value: "未写完的草稿" },
    });
    fireEvent.click(cardTriggerFor("卡片正文"));
    await screen.findByText("打卡卡片预览");
    // Editor is unmounted: nothing to Tab into.
    expect(screen.queryByPlaceholderText("写下这一刻的感想…")).not.toBeInTheDocument();
    expect(screen.queryByText("保存批注")).not.toBeInTheDocument();
    expect(document.activeElement).toHaveTextContent("返回笔记");
    expect(exportCalls()).toHaveLength(0);
    fireEvent.click(screen.getByText("返回笔记"));
    await screen.findByText("卡片正文");
    expect(
      (screen.getByPlaceholderText("写下这一刻的感想…") as HTMLTextAreaElement).value,
    ).toBe("未写完的草稿");
  });

  it("returns focus to the originating card action", async () => {
    renderAssembly();
    await screen.findByText("卡片正文");
    const trigger = cardTriggerFor("卡片正文");
    fireEvent.click(trigger);
    await screen.findByText("打卡卡片预览");
    fireEvent.click(screen.getByText("返回笔记"));
    await screen.findByText("卡片正文");
    // The row remounts, so identity changes; the focused node must be the
    // same note's card action.
    const focused = document.activeElement as HTMLButtonElement;
    expect(focused.textContent).toBe("打卡卡片");
    expect(focused.closest("div.rounded-md")?.textContent).toContain("卡片正文");
  });

  it("opening the preview clears a pending delete confirm", async () => {
    renderAssembly();
    await screen.findByText("卡片正文");
    const card = screen.getByText("卡片正文").closest("div.rounded-md") as Element;
    const del = [...card.querySelectorAll("button")].find(
      (button) => button.textContent === "删除",
    ) as HTMLButtonElement;
    fireEvent.click(del);
    expect(screen.getByText("确认删除")).toBeInTheDocument();
    fireEvent.click(cardTriggerFor("卡片正文"));
    await screen.findByText("打卡卡片预览");
    expect(screen.queryByText("确认删除")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("返回笔记"));
    await screen.findByText("卡片正文");
    expect(screen.queryByText("确认删除")).not.toBeInTheDocument();
  });

  it("closes the preview when the media switches", async () => {
    renderAssembly();
    await screen.findByText("卡片正文");
    fireEvent.click(cardTriggerFor("卡片正文"));
    await screen.findByText("打卡卡片预览");
    usePlayerStore.setState({ currentFile: "C:\\v\\b.mp4" });
    await waitFor(() => {
      expect(screen.queryByText("打卡卡片预览")).not.toBeInTheDocument();
    });
    await screen.findByText("暂无批注");
  });

  it("returns focus to the empty-media hint when the media closes", async () => {
    renderAssembly();
    await screen.findByText("卡片正文");
    fireEvent.click(cardTriggerFor("卡片正文"));
    await screen.findByText("打卡卡片预览");
    usePlayerStore.setState({ currentFile: null });
    const hint = await screen.findByText("打开视频后可记录带时间戳的笔记。");
    await waitFor(() => expect(document.activeElement).toBe(hint));
    expect(screen.queryByText("打卡卡片预览")).not.toBeInTheDocument();
    expect(exportCalls()).toHaveLength(0);
  });

  it("closes the preview when its note disappears on the same media", async () => {
    const client = renderAssembly();
    await screen.findByText("卡片正文");
    fireEvent.click(cardTriggerFor("卡片正文"));
    await screen.findByText("打卡卡片预览");
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "notes_list") return Promise.resolve([]);
      if (cmd === "notes_get_frame") return Promise.resolve(FRAME);
      return Promise.resolve(null);
    });
    await client.invalidateQueries();
    await waitFor(() => {
      expect(screen.queryByText("打卡卡片预览")).not.toBeInTheDocument();
    });
    expect(screen.getByText("暂无批注")).toBeInTheDocument();
  });
});
