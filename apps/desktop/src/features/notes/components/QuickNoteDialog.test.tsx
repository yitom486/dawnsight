import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePlayerStore } from "@/features/player";
import { useTrackStore } from "@/features/player/trackStore";
import { useNoteComposeStore } from "@/features/notes/noteComposeStore";

import { QuickNoteDialog } from "./QuickNoteDialog";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

const CUES = Array.from({ length: 6 }, (_, i) => ({
  index: i,
  startMs: i * 10_000,
  endMs: i * 10_000 + 9_000,
  text: `第${i + 1}句台词内容`,
}));

function seedQuickNote(options?: { media?: string | null; transcriptGate?: Promise<unknown> }) {
  const media = options?.media === undefined ? "C:\\v\\a.mp4" : options.media;
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "notes_list") return Promise.resolve([]);
    if (cmd === "notes_preview_quotes") return Promise.resolve([]);
    if (cmd === "subtitle_load_choice") {
      const transcript = {
        sourcePath: "C:\\v\\a.mp4",
        choiceId: "emb:0",
        streamIndex: 0,
        language: "zh",
        codecName: "ass",
        cues: CUES,
      };
      return options?.transcriptGate ?? Promise.resolve(transcript);
    }
    if (cmd === "notes_create")
      return Promise.resolve({
        id: "created",
        mediaPath: "C:\\v\\a.mp4",
        positionMs: 15_000,
        body: "x",
        quotes: [],
        frames: [],
        createdAt: "t",
        updatedAt: "t",
      });
    return Promise.resolve(null);
  });
  usePlayerStore.setState({
    currentFile: media,
    status: "Paused",
    currentTimeMs: 15_000,
  });
  useTrackStore.setState({ subtitleChoiceId: media ? "emb:0" : null });
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
}

function Harness({
  onOpenChange,
  onSaved,
  triggerDisabled,
}: {
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  triggerDisabled?: boolean;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button type="button">外部动作</button>
      <div ref={anchorRef} style={{ position: "relative" }}>
        <button
          ref={triggerRef}
          type="button"
          disabled={triggerDisabled}
          onClick={() => setOpen(true)}
        >
          写批注
        </button>
        <QuickNoteDialog
          open={open}
          onOpenChange={(value) => {
            setOpen(value);
            onOpenChange(value);
          }}
          onSaved={onSaved}
          anchorRef={anchorRef}
          triggerRef={triggerRef}
        />
      </div>
    </div>
  );
}

function renderHarness(props?: Partial<ComponentProps<typeof Harness>>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <Harness onOpenChange={onOpenChange} onSaved={onSaved} {...props} />
    </QueryClientProvider>,
  );
  return { onOpenChange, onSaved };
}

function cueInput(cueText: string) {
  const i = CUES.findIndex((cue) => cue.text === cueText);
  const totalSeconds = Math.floor(CUES[i]!.startMs / 1000);
  const label = `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")} ${cueText}`;
  const span = screen.getByText(
    (_, element) => element?.tagName === "SPAN" && element?.textContent === label,
  );
  const input = span.closest("label")?.querySelector("input");
  expect(input).not.toBeNull();
  return input as HTMLInputElement;
}

async function findCueInput(cueText: string) {
  await waitFor(() => {
    expect(cueInput(cueText)).not.toBeNull();
  });
  return cueInput(cueText);
}

function createCalls() {
  return vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "notes_create");
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("QuickNoteDialog close and focus", () => {
  it("handles Escape on the real trigger before focus enters the panel", async () => {
    seedQuickNote();
    const { onOpenChange } = renderHarness();
    await screen.findByText("快速写批注");
    const trigger = screen.getByText("写批注");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("leaves external Escape and focus to the external control", async () => {
    seedQuickNote();
    const { onOpenChange } = renderHarness();
    await screen.findByText("快速写批注");
    const outside = screen.getByText("外部动作");
    outside.focus();
    fireEvent.keyDown(outside, { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(document.activeElement).toBe(outside);
  });

  it.each(["composing", "229", "handled"])("preserves the draft for %s Escape", async (kind) => {
    seedQuickNote();
    const { onOpenChange } = renderHarness();
    await screen.findByText("快速写批注");
    const box = screen.getByPlaceholderText("记录此刻的观感或要点…");
    fireEvent.change(box, { target: { value: "未完成的草稿" } });
    box.focus();
    const event = new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
      isComposing: kind === "composing", keyCode: kind === "229" ? 229 : 27,
    });
    if (kind === "handled") event.preventDefault();
    fireEvent(box, event);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(box).toHaveValue("未完成的草稿");
    expect(document.activeElement).toBe(box);
  });

  it("does not consume events from an inert dock", async () => {
    seedQuickNote();
    const { onOpenChange } = renderHarness();
    const dialog = await screen.findByRole("dialog");
    dialog.parentElement!.setAttribute("inert", "");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("Escape closes and returns focus to the live trigger", async () => {
    seedQuickNote();
    const { onOpenChange } = renderHarness();
    await screen.findByText("快速写批注");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toHaveTextContent("写批注");
  });

  it("Escape never focuses a disabled trigger", async () => {
    seedQuickNote();
    const { onOpenChange } = renderHarness({ triggerDisabled: true });
    await screen.findByText("快速写批注");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(document.activeElement?.textContent).not.toBe("写批注");
  });

  it("cancel and the X button close with focus return", async () => {
    seedQuickNote();
    const { onOpenChange } = renderHarness();
    await screen.findByText("快速写批注");
    fireEvent.click(screen.getByText("取消"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(document.activeElement).toHaveTextContent("写批注");
  });

  it("outside mousedown closes without stealing the new focus", async () => {
    seedQuickNote();
    const { onOpenChange } = renderHarness();
    await screen.findByText("快速写批注");
    const outside = screen.getByText("外部动作");
    outside.focus();
    fireEvent.mouseDown(outside);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(document.activeElement).toBe(outside);
  });
});

describe("QuickNoteDialog quotes and save", () => {
  it("checks cues and ranges with Shift in the store", async () => {
    seedQuickNote();
    renderHarness();
    await screen.findByText("快速写批注");
    fireEvent.click(await findCueInput("第1句台词内容"));
    expect(useNoteComposeStore.getState().selectedIndices).toEqual([0]);
    fireEvent.click(await findCueInput("第3句台词内容"), { shiftKey: true });
    expect(useNoteComposeStore.getState().selectedIndices).toEqual([0, 1, 2]);
    // Committed render offers one anchor per checked row.
    expect(screen.getAllByRole("button", { name: "标为锚点句" })).toHaveLength(3);
  });

  it("shows the pressed anchor from state", async () => {
    seedQuickNote();
    renderHarness();
    await screen.findByText("快速写批注");
    fireEvent.click(await findCueInput("第1句台词内容"));
    // Source of truth for picks is the store (real-browser proof in §37).
    expect(
      useNoteComposeStore.getState().selectedIndices,
    ).toEqual([0]);
    // The in-label anchor click cannot run in jsdom (label forwarding
    // unchecks the row; browsers exempt nested buttons), so the anchor is
    // seeded; waitFor flushes the out-of-act store update before querying.
    useNoteComposeStore.setState({ anchorCueIndex: 0 });
    const anchored = await screen.findByRole("button", { name: "取消锚点句" });
    expect(anchored).toHaveAttribute("aria-pressed", "true");
    expect(useNoteComposeStore.getState().selectedIndices).toEqual([0]);
  });

  it("saves with Ctrl+Enter using the quote params", async () => {
    seedQuickNote();
    const { onSaved } = renderHarness();
    await screen.findByText("快速写批注");
    fireEvent.click(await findCueInput("第1句台词内容"));
    const box = screen.getByPlaceholderText("记录此刻的观感或要点…");
    fireEvent.change(box, { target: { value: "速记正文" } });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await waitFor(() => {
      expect(createCalls()).toHaveLength(1);
    });
    expect(createCalls()[0]?.[1]).toMatchObject({
      input: expect.objectContaining({
        mediaPath: "C:\\v\\a.mp4",
        body: "速记正文",
        subtitleChoiceId: "emb:0",
        anchorCueIndex: null,
        quoteCueIndices: [0],
        includeQuotes: true,
      }),
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
  });

  it("disables save on an empty body and ignores Ctrl+Enter", async () => {
    seedQuickNote();
    renderHarness();
    await screen.findByText("快速写批注");
    expect(screen.getByText("保存")).toBeDisabled();
    fireEvent.keyDown(screen.getByPlaceholderText("记录此刻的观感或要点…"), {
      key: "Enter",
      ctrlKey: true,
    });
    expect(createCalls()).toHaveLength(0);
  });

  it("rejects repeated saves while pending and shows failure honestly", async () => {
    seedQuickNote();
    let release!: () => void;
    const gate = new Promise<unknown>((resolve) => {
      release = () => resolve(null);
    });
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "notes_create") return gate;
      if (cmd === "notes_list") return Promise.resolve([]);
      if (cmd === "notes_preview_quotes") return Promise.resolve([]);
      if (cmd === "subtitle_load_choice")
        return Promise.resolve({
          sourcePath: "C:\\v\\a.mp4",
          choiceId: "emb:0",
          streamIndex: 0,
          language: "zh",
          codecName: "ass",
          cues: CUES,
        });
      return Promise.resolve(null);
    });
    renderHarness();
    await screen.findByText("快速写批注");
    fireEvent.change(screen.getByPlaceholderText("记录此刻的观感或要点…"), {
      target: { value: "速记正文" },
    });
    fireEvent.click(screen.getByText("保存"));
    await screen.findByText("保存中…");
    fireEvent.click(screen.getByText("保存中…"));
    expect(createCalls()).toHaveLength(1);
    release();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("keeps the dialog with a business message when save fails", async () => {
    seedQuickNote();
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "notes_create") return Promise.reject(new Error("boom"));
      if (cmd === "notes_list") return Promise.resolve([]);
      if (cmd === "notes_preview_quotes") return Promise.resolve([]);
      if (cmd === "subtitle_load_choice")
        return Promise.resolve({
          sourcePath: "C:\\v\\a.mp4",
          choiceId: "emb:0",
          streamIndex: 0,
          language: "zh",
          codecName: "ass",
          cues: CUES,
        });
      return Promise.resolve(null);
    });
    renderHarness();
    await screen.findByText("快速写批注");
    fireEvent.change(screen.getByPlaceholderText("记录此刻的观感或要点…"), {
      target: { value: "速记正文" },
    });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => {
      expect(screen.getByText("操作失败，请重试")).toBeInTheDocument();
    });
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not refocus or clear the draft when the transcript resolves", async () => {
    let releaseTranscript!: (value: unknown) => void;
    const gate = new Promise<unknown>((resolve) => {
      releaseTranscript = resolve;
    });
    seedQuickNote({ transcriptGate: gate });
    renderHarness();
    await screen.findByText("快速写批注");
    const box = screen.getByPlaceholderText("记录此刻的观感或要点…") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "未写完的草稿" } });
    box.focus();
    releaseTranscript({
      sourcePath: "C:\\v\\a.mp4",
      choiceId: "emb:0",
      streamIndex: 0,
      language: "zh",
      codecName: "ass",
      cues: CUES,
    });
    await waitFor(() => {
      expect(cueInput("第1句台词内容")).not.toBeNull();
    });
    expect(document.activeElement).toBe(box);
    expect(box.value).toBe("未写完的草稿");
  });

  it("explains the no-media state with disabled inputs", async () => {
    seedQuickNote({ media: null });
    renderHarness();
    await screen.findByText("快速写批注");
    expect(screen.getByText("请先打开视频")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("记录此刻的观感或要点…")).toBeDisabled();
    expect(screen.getByText("保存")).toBeDisabled();
  });
});
