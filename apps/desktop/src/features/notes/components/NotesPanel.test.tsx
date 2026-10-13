import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePlayerStore } from "@/features/player";
import { useTrackStore } from "@/features/player/trackStore";
import { useNoteComposeStore } from "@/features/notes/noteComposeStore";

import { NotesPanel } from "./NotesPanel";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

const FRAMED_NOTE = {
  id: "n1",
  mediaPath: "C:\\v\\a.mp4",
  positionMs: 5000,
  body: "带图批注",
  quotes: [],
  frames: [{ atMs: 5000, file: "n1.jpg" }],
  createdAt: "t",
  updatedAt: "t",
};

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NotesPanel />
    </QueryClientProvider>,
  );
}

function seekCalls() {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "player_seek");
}

beforeEach(() => {
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "notes_list") return Promise.resolve([FRAMED_NOTE]);
    if (cmd === "notes_get_frame")
      return Promise.resolve({ mime: "image/jpeg", data: "AAA" });
    if (cmd === "notes_create")
      return Promise.resolve({ ...FRAMED_NOTE, id: "n2", frames: [] });
    if (cmd === "player_seek")
      return Promise.resolve({ status: "Paused", currentTimeMs: 5000 });
    return Promise.resolve(null);
  });
  usePlayerStore.setState({
    currentFile: "C:\\v\\a.mp4",
    status: "Paused",
    currentTimeMs: 9000,
  });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("NotesPanel frame references", () => {
  it("renders the thumbnail and seeks to the frame moment on click", async () => {
    renderPanel();
    const img = (await screen.findByAltText(
      "批注画面 0:05",
    )) as HTMLImageElement;
    expect(img.src).toContain("data:image/jpeg;base64,AAA");
    const button = img.closest("button");
    expect(button).not.toBeNull();
    fireEvent.click(button as Element);
    await waitFor(() => {
      expect(seekCalls()).toHaveLength(1);
    });
  });

  it("passes includeFrame when the checkbox is on", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("带图批注")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText("写下这一刻的感想…"), {
      target: { value: "新批注" },
    });
    fireEvent.click(screen.getByText("附带当前画面"));
    fireEvent.click(screen.getByText("保存批注"));
    await waitFor(() => {
      const create = vi
        .mocked(invoke)
        .mock.calls.find(([cmd]) => cmd === "notes_create");
      expect(create?.[1]).toMatchObject({
        input: expect.objectContaining({ includeFrame: true }),
      });
    });
  });

  it("does not fetch frames for frameless notes", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "notes_list")
        return Promise.resolve([{ ...FRAMED_NOTE, id: "n9", frames: [] }]);
      return Promise.resolve(null);
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("带图批注")).toBeInTheDocument();
    });
    expect(
      vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "notes_get_frame"),
    ).toHaveLength(0);
  });
});

const NOTE_A = {
  id: "a1",
  mediaPath: "C:\\v\\a.mp4",
  positionMs: 5000,
  body: "长正文nospace_mixed_empatheticComprehensionVerification混排不断尾",
  quotes: [
    { index: 0, startMs: 0, endMs: 1000, text: "引用台词", anchor: true },
  ],
  frames: [],
  createdAt: "t",
  updatedAt: "t",
};

const NOTE_B = {
  id: "b2",
  mediaPath: "C:\\v\\a.mp4",
  positionMs: 9000,
  body: "第二条批注",
  quotes: [],
  frames: [],
  createdAt: "t",
  updatedAt: "t",
};

function deleteCalls() {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "notes_delete");
}

describe("NotesPanel saved-list delete confirmation", () => {
  let liveNotes: typeof NOTE_A[];
  let deleteImpl: (id: string) => Promise<void>;

  function seedList() {
    liveNotes = [{ ...NOTE_A }, { ...NOTE_B }];
    deleteImpl = async (id: string) => {
      liveNotes = liveNotes.filter((note) => note.id !== id);
    };
    vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === "notes_list") {
        const mediaPath = (args as { mediaPath?: string } | undefined)
          ?.mediaPath;
        if (mediaPath === "C:\\v\\a.mp4") return Promise.resolve([...liveNotes]);
        return Promise.resolve([]);
      }
      if (cmd === "notes_delete") {
        const id = (args as { id?: string } | undefined)?.id ?? "";
        return deleteImpl(id);
      }
      if (cmd === "player_seek")
        return Promise.resolve({ status: "Paused", currentTimeMs: 5000 });
      return Promise.resolve(null);
    });
    usePlayerStore.setState({
      currentFile: "C:\\v\\a.mp4",
      status: "Paused",
      currentTimeMs: 9000,
    });
  }

  function deleteTriggerFor(body: string) {
    const card = screen.getByText(body).closest("div.rounded-md") as Element;
    const trigger = [...card.querySelectorAll("button")].find(
      (button) => button.textContent === "删除",
    ) as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    return trigger;
  }

  it("opens an inline confirm and calls no API until confirmed", async () => {
    seedList();
    renderPanel();
    await screen.findByText(NOTE_A.body);
    fireEvent.click(deleteTriggerFor(NOTE_A.body));
    expect(deleteCalls()).toHaveLength(0);
    expect(
      screen.getByRole("group", { name: "确认删除 0:05 的批注" }),
    ).toBeInTheDocument();
    expect(screen.getByText("取消")).toBeInTheDocument();
    expect(screen.getByText("确认删除")).toBeInTheDocument();
    // Safe default gets focus, not the destructive action.
    expect(document.activeElement).toHaveTextContent("取消");
  });

  it("cancel deletes nothing and returns focus to the trigger", async () => {
    seedList();
    renderPanel();
    await screen.findByText(NOTE_A.body);
    const trigger = deleteTriggerFor(NOTE_A.body);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByText("取消"));
    expect(deleteCalls()).toHaveLength(0);
    expect(screen.queryByText("确认删除")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("Escape deletes nothing and returns focus to the trigger", async () => {
    seedList();
    renderPanel();
    await screen.findByText(NOTE_A.body);
    const trigger = deleteTriggerFor(NOTE_A.body);
    fireEvent.click(trigger);
    fireEvent.keyDown(
      screen.getByRole("group", { name: "确认删除 0:05 的批注" }),
      { key: "Escape" },
    );
    expect(deleteCalls()).toHaveLength(0);
    expect(screen.queryByText("确认删除")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("confirm deletes the right note exactly once and moves focus on", async () => {
    seedList();
    renderPanel();
    await screen.findByText(NOTE_A.body);
    fireEvent.click(deleteTriggerFor(NOTE_A.body));
    fireEvent.click(screen.getByText("确认删除"));
    await waitFor(() => {
      expect(deleteCalls()).toHaveLength(1);
    });
    expect(deleteCalls()[0]?.[1]).toMatchObject({ id: "a1" });
    await waitFor(() => {
      expect(screen.queryByText(NOTE_A.body)).not.toBeInTheDocument();
    });
    expect(screen.getByText(NOTE_B.body)).toBeInTheDocument();
    // The gone trigger cannot keep focus: first surviving action takes over.
    expect(document.activeElement).toHaveTextContent("删除");
  });

  it("ignores repeated confirms while the delete is pending", async () => {
    seedList();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    deleteImpl = (id: string) =>
      gate.then(() => {
        liveNotes = liveNotes.filter((note) => note.id !== id);
      });
    renderPanel();
    await screen.findByText(NOTE_A.body);
    fireEvent.click(deleteTriggerFor(NOTE_A.body));
    fireEvent.click(screen.getByText("确认删除"));
    // Wait until the pending state is committed, then try to re-enter.
    await screen.findByText("删除中…");
    fireEvent.click(screen.getByText("删除中…"));
    expect(deleteCalls()).toHaveLength(1);
    expect(screen.getByText("删除中…")).toBeDisabled();
    expect(screen.getByText("取消")).toBeDisabled();
    release();
    await waitFor(() => {
      expect(screen.queryByText(NOTE_A.body)).not.toBeInTheDocument();
    });
  });

  it("failed delete keeps the note and shows only the business message", async () => {
    seedList();
    deleteImpl = () => Promise.reject(new Error("boom"));
    renderPanel();
    await screen.findByText(NOTE_A.body);
    fireEvent.click(deleteTriggerFor(NOTE_A.body));
    fireEvent.click(screen.getByText("确认删除"));
    await waitFor(() => {
      expect(screen.getByText("操作失败，请重试")).toBeInTheDocument();
    });
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
    // No fake delete: row and its confirm stay.
    expect(screen.getByText(NOTE_A.body)).toBeInTheDocument();
    expect(screen.getByText("取消")).toBeInTheDocument();
  });

  it("switching media clears the pending confirm without deleting", async () => {
    seedList();
    renderPanel();
    await screen.findByText(NOTE_A.body);
    fireEvent.click(deleteTriggerFor(NOTE_A.body));
    expect(screen.getByText("确认删除")).toBeInTheDocument();
    usePlayerStore.setState({ currentFile: "C:\\v\\other.mp4" });
    await waitFor(() => {
      expect(screen.queryByText("确认删除")).not.toBeInTheDocument();
    });
    expect(deleteCalls()).toHaveLength(0);
  });

  it("clears the pending confirm when the next media list fails", async () => {
    seedList();
    vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === "notes_list") {
        const mediaPath = (args as { mediaPath?: string } | undefined)
          ?.mediaPath;
        if (mediaPath === "C:\\v\\a.mp4") return Promise.resolve([...liveNotes]);
        return Promise.reject(new Error("list failed"));
      }
      if (cmd === "notes_delete") {
        const id = (args as { id?: string } | undefined)?.id ?? "";
        return deleteImpl(id);
      }
      return Promise.resolve(null);
    });
    renderPanel();
    await screen.findByText(NOTE_A.body);
    fireEvent.click(deleteTriggerFor(NOTE_A.body));
    expect(screen.getByText("确认删除")).toBeInTheDocument();
    // B list fails: notes stays undefined, the stale confirm must still go.
    usePlayerStore.setState({ currentFile: "C:\\v\\b.mp4" });
    await waitFor(() => {
      expect(screen.queryByText("确认删除")).not.toBeInTheDocument();
    });
    // Back on A the old confirm must not reappear, and nothing was deleted.
    usePlayerStore.setState({ currentFile: "C:\\v\\a.mp4" });
    await screen.findByText(NOTE_A.body);
    await waitFor(() => {
      expect(screen.queryByText("确认删除")).not.toBeInTheDocument();
    });
    expect(deleteCalls()).toHaveLength(0);
    expect(screen.getByText(NOTE_A.body)).toBeInTheDocument();
  });

  it("clears the pending confirm while the next media list is still loading", async () => {
    seedList();
    let releaseB!: () => void;
    const gateB = new Promise<unknown>((resolve) => {
      releaseB = () => resolve([]);
    });
    vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === "notes_list") {
        const mediaPath = (args as { mediaPath?: string } | undefined)
          ?.mediaPath;
        if (mediaPath === "C:\\v\\a.mp4") return Promise.resolve([...liveNotes]);
        return gateB;
      }
      if (cmd === "notes_delete") {
        const id = (args as { id?: string } | undefined)?.id ?? "";
        return deleteImpl(id);
      }
      return Promise.resolve(null);
    });
    renderPanel();
    await screen.findByText(NOTE_A.body);
    fireEvent.click(deleteTriggerFor(NOTE_A.body));
    expect(screen.getByText("确认删除")).toBeInTheDocument();
    usePlayerStore.setState({ currentFile: "C:\\v\\b.mp4" });
    await waitFor(() => {
      expect(screen.queryByText("确认删除")).not.toBeInTheDocument();
    });
    usePlayerStore.setState({ currentFile: "C:\\v\\a.mp4" });
    await screen.findByText(NOTE_A.body);
    expect(screen.queryByText("确认删除")).not.toBeInTheDocument();
    expect(deleteCalls()).toHaveLength(0);
    releaseB();
  });

  it("clears the pending confirm when media closes and returns", async () => {
    seedList();
    renderPanel();
    await screen.findByText(NOTE_A.body);
    fireEvent.click(deleteTriggerFor(NOTE_A.body));
    expect(screen.getByText("确认删除")).toBeInTheDocument();
    usePlayerStore.setState({ currentFile: null });
    await waitFor(() => {
      expect(screen.queryByText("确认删除")).not.toBeInTheDocument();
    });
    expect(screen.getByText("打开视频后可记录带时间戳的笔记。")).toBeInTheDocument();
    usePlayerStore.setState({ currentFile: "C:\\v\\a.mp4" });
    await screen.findByText(NOTE_A.body);
    expect(screen.queryByText("确认删除")).not.toBeInTheDocument();
    expect(deleteCalls()).toHaveLength(0);
  });
});

const EDITOR_CUES = Array.from({ length: 6 }, (_, i) => ({
  index: i,
  startMs: i * 10_000,
  endMs: i * 10_000 + 9_000,
  text: `第${i + 1}句台词内容`,
}));

function seedEditor() {
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "notes_list") return Promise.resolve([]);
    if (cmd === "notes_preview_quotes") return Promise.resolve([]);
    if (cmd === "subtitle_load_choice")
      return Promise.resolve({
        sourcePath: "C:\\v\\a.mp4",
        choiceId: "emb:0",
        streamIndex: 0,
        language: "zh",
        codecName: "ass",
        cues: EDITOR_CUES,
      });
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
    currentFile: "C:\\v\\a.mp4",
    status: "Paused",
    currentTimeMs: 15_000,
  });
  useTrackStore.setState({ subtitleChoiceId: "emb:0" });
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

function cueInput(cueText: string) {
  const span = screen.getByText(
    (_, element) =>
      element?.tagName === "SPAN" &&
      element?.textContent === `${spanTime(cueText)} ${cueText}`,
  );
  const input = span.closest("label")?.querySelector("input");
  expect(input).not.toBeNull();
  return input as HTMLInputElement;
}

function spanTime(cueText: string) {
  const i = EDITOR_CUES.findIndex((cue) => cue.text === cueText);
  const totalSeconds = Math.floor(EDITOR_CUES[i]!.startMs / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function createCalls() {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "notes_create");
}

describe("NotesPanel editor quotes and save", () => {
  it("keeps pressed semantics on the quote-mode switch", async () => {
    seedEditor();
    renderPanel();
    await screen.findByText("手动勾选");
    const auto = screen.getByRole("button", { name: "自动（最近三句）" });
    const manual = screen.getByRole("button", { name: "手动勾选" });
    expect(auto).toHaveAttribute("aria-pressed", "true");
    expect(manual).toHaveAttribute("aria-pressed", "false");
    expect(auto.closest("[role='group']")).not.toBeNull();
    fireEvent.click(manual);
    expect(manual).toHaveAttribute("aria-pressed", "true");
    expect(auto).toHaveAttribute("aria-pressed", "false");
  });

  it("marks an anchor with pressed state and an accurate name", async () => {
    seedEditor();
    renderPanel();
    await screen.findByText("手动勾选");
    fireEvent.click(screen.getByText("手动勾选"));
    fireEvent.click(screen.getByText("清空引用"));
    const input = cueInput("第1句台词内容");
    fireEvent.click(input);
    // Source of truth for picks is the store (real-browser proof in §35).
    expect(
      useNoteComposeStore.getState().selectedIndices,
    ).toEqual([0]);
    // Committed render: the row offers the anchor action.
    const anchor = screen.getByRole("button", { name: "标为锚点句" });
    expect(anchor).toHaveAttribute("aria-pressed", "false");
    // The anchor toggle itself cannot run in jsdom (the in-label button's
    // click is forwarded to the checkbox and unchecks the row; browsers
    // exempt nested buttons). Toggle semantics live in noteComposeStore
    // unit tests; the full cycle is browser-verified in §35.
  });

  it("shows the anchor action only on checked cues", async () => {
    seedEditor();
    renderPanel();
    await screen.findByText("手动勾选");
    fireEvent.click(screen.getByText("手动勾选"));
    fireEvent.click(screen.getByText("清空引用"));
    expect(screen.queryByRole("button", { name: "标为锚点句" })).not.toBeInTheDocument();
    fireEvent.click(cueInput("第2句台词内容"));
    expect(screen.getByRole("button", { name: "标为锚点句" })).toBeInTheDocument();
  });

  it("preserves picks and the anchor across mode switches", async () => {
    seedEditor();
    renderPanel();
    await screen.findByText("手动勾选");
    fireEvent.click(screen.getByText("手动勾选"));
    fireEvent.click(screen.getByText("清空引用"));
    fireEvent.click(cueInput("第1句台词内容"));
    fireEvent.click(cueInput("第3句台词内容"));
    // Anchor via store: the in-label anchor button cannot be clicked in jsdom
    // (label forwarding unchecks the row; browsers exempt buttons). The click
    // handler path is covered above + browser-side in §35.
    useNoteComposeStore.setState({ anchorCueIndex: 0 });
    fireEvent.click(screen.getByText("自动（最近三句）"));
    fireEvent.click(screen.getByText("手动勾选"));
    expect(useNoteComposeStore.getState().selectedIndices).toEqual([0, 2]);
    expect(useNoteComposeStore.getState().anchorCueIndex).toBe(0);
    const anchorAfter = [...cueInput("第1句台词内容").closest("label")!.querySelectorAll("button")].find(
      (button) => button.textContent === "锚",
    )!;
    expect(anchorAfter).toHaveAttribute("aria-pressed", "true");
    expect(anchorAfter).toHaveAccessibleName("取消锚点句");
  });

  it("saves manual picks with anchor and subtitle choice", async () => {
    seedEditor();
    renderPanel();
    await screen.findByText("手动勾选");
    fireEvent.click(screen.getByText("手动勾选"));
    fireEvent.click(screen.getByText("清空引用"));
    fireEvent.click(cueInput("第1句台词内容"));
    // Anchor via store (same jsdom label-forwarding reason as above).
    useNoteComposeStore.setState({ anchorCueIndex: 0 });
    fireEvent.change(screen.getByPlaceholderText("写下这一刻的感想…"), {
      target: { value: "手动批注" },
    });
    fireEvent.click(screen.getByText("保存批注"));
    await waitFor(() => {
      expect(createCalls()).toHaveLength(1);
    });
    expect(createCalls()[0]?.[1]).toMatchObject({
      input: expect.objectContaining({
        mediaPath: "C:\\v\\a.mp4",
        body: "手动批注",
        subtitleChoiceId: "emb:0",
        anchorCueIndex: 0,
        quoteCueIndices: [0],
        includeQuotes: true,
      }),
    });
  });

  it("saves auto mode without manual indices", async () => {
    seedEditor();
    renderPanel();
    await screen.findByText("手动勾选");
    fireEvent.change(screen.getByPlaceholderText("写下这一刻的感想…"), {
      target: { value: "自动批注" },
    });
    fireEvent.click(screen.getByText("保存批注"));
    await waitFor(() => {
      expect(createCalls()).toHaveLength(1);
    });
    expect(createCalls()[0]?.[1]).toMatchObject({
      input: expect.objectContaining({
        anchorCueIndex: null,
        quoteCueIndices: null,
        includeQuotes: true,
      }),
    });
  });

  it("disables save on an empty draft", async () => {
    seedEditor();
    renderPanel();
    await screen.findByText("手动勾选");
    expect(screen.getByText("保存批注")).toBeDisabled();
  });
});
