import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnnotationProposalCard } from "./AnnotationProposalCard";
import type { VideoAnnotationProposal } from "@dawnsight/contracts";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

const PROPOSAL: VideoAnnotationProposal = {
  proposalId: "p1",
  mediaPath: "C:\\v\\a.mp4",
  positionMs: 5_000,
  body: "提议正文草稿",
  subtitleChoiceId: "emb:0",
  anchorCueIndex: 0,
  quoteCueIndices: [0, 1],
  quoteHint: null,
  includeQuotes: true,
  quotes: [
    { index: 0, startMs: 0, endMs: 9_000, text: "第一句引用", anchor: true },
    { index: 1, startMs: 10_000, endMs: 19_000, text: "第二句引用", anchor: false },
  ],
  previewMarkdown: "",
  createdAtMs: 0,
};

function seedProposal(createImpl?: (input: unknown) => Promise<unknown>) {
  vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
    if (cmd === "notes_create") {
      if (createImpl) return createImpl((args as { input?: unknown } | undefined)?.input);
      return Promise.resolve({ id: "n1" });
    }
    if (cmd === "notes_dismiss_proposal") return Promise.resolve(undefined);
    if (cmd === "notes_list") return Promise.resolve([]);
    return Promise.resolve(null);
  });
}

function renderCard(proposal: VideoAnnotationProposal = PROPOSAL, workspace = "ws-A") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onDismiss = vi.fn();
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <AnnotationProposalCard
        proposal={proposal}
        workspace={workspace}
        onDismiss={onDismiss}
        onSaved={onSaved}
      />
    </QueryClientProvider>,
  );
  return { onDismiss, onSaved };
}

function apiCalls(cmd: string) {
  return vi.mocked(invoke).mock.calls.filter(([name]) => name === cmd);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("AnnotationProposalCard", () => {
  it("stays a plain card without dialog semantics", () => {
    seedProposal();
    renderCard();
    expect(screen.getByText("Agent 提议批注")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText(/第一句引用/)).toBeInTheDocument();
    expect(screen.getByText(/第二句引用/)).toBeInTheDocument();
  });

  it("shows an honest fallback when there are no quotes", () => {
    seedProposal();
    renderCard({ ...PROPOSAL, quotes: [] });
    expect(screen.getByText("（无引用台词）")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("confirms with create-then-dismiss in the proposal workspace", async () => {
    seedProposal();
    const { onSaved, onDismiss } = renderCard();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "改后正文" } });
    fireEvent.click(screen.getByText("确认保存"));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
    const creates = apiCalls("notes_create");
    const dismisses = apiCalls("notes_dismiss_proposal");
    expect(creates).toHaveLength(1);
    expect(dismisses).toHaveLength(1);
    expect(creates[0]?.[1]).toMatchObject({
      input: expect.objectContaining({
        mediaPath: "C:\\v\\a.mp4",
        positionMs: 5_000,
        body: "改后正文",
        subtitleChoiceId: "emb:0",
        anchorCueIndex: 0,
        quoteCueIndices: [0, 1],
        includeQuotes: true,
      }),
    });
    expect(dismisses[0]?.[1]).toMatchObject({ workspace: "ws-A" });
    const sequence = vi
      .mocked(invoke)
      .mock.calls.map(([cmd]) => cmd as string);
    expect(sequence.indexOf("notes_create")).toBeLessThan(
      sequence.indexOf("notes_dismiss_proposal"),
    );
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("cancels with dismiss only and never creates", async () => {
    seedProposal();
    const { onDismiss, onSaved } = renderCard();
    fireEvent.click(screen.getByText("取消"));
    await waitFor(() => {
      expect(onDismiss).toHaveBeenCalled();
    });
    expect(apiCalls("notes_dismiss_proposal")).toHaveLength(1);
    expect(apiCalls("notes_dismiss_proposal")[0]?.[1]).toMatchObject({
      workspace: "ws-A",
    });
    expect(apiCalls("notes_create")).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("dismisses in the passed workspace, isolating sessions", async () => {
    seedProposal();
    renderCard(PROPOSAL, "ws-B");
    fireEvent.click(screen.getByText("取消"));
    await waitFor(() => {
      expect(apiCalls("notes_dismiss_proposal")).toHaveLength(1);
    });
    expect(apiCalls("notes_dismiss_proposal")[0]?.[1]).toMatchObject({
      workspace: "ws-B",
    });
  });

  it("validates an empty body without calling APIs", async () => {
    seedProposal();
    renderCard();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    fireEvent.click(screen.getByText("确认保存"));
    await screen.findByText("批注内容不能为空");
    expect(apiCalls("notes_create")).toHaveLength(0);
    expect(apiCalls("notes_dismiss_proposal")).toHaveLength(0);
  });

  it("rejects repeated confirms while pending", async () => {
    let release!: () => void;
    const gate = new Promise<unknown>((resolve) => {
      release = () => resolve({ id: "n1" });
    });
    seedProposal(() => gate);
    renderCard();
    fireEvent.click(screen.getByText("确认保存"));
    await screen.findByText("保存中…");
    fireEvent.click(screen.getByText("保存中…"));
    expect(apiCalls("notes_create")).toHaveLength(1);
    expect(screen.getByText("取消")).toBeDisabled();
    release();
    await waitFor(() => {
      expect(apiCalls("notes_dismiss_proposal")).toHaveLength(1);
    });
  });

  it("keeps the card with a business message when confirm fails, then retries", async () => {
    seedProposal();
    let fail = true;
    seedProposal(() => {
      if (fail) return Promise.reject(new Error("boom"));
      return Promise.resolve({ id: "n1" });
    });
    const { onSaved } = renderCard();
    fireEvent.click(screen.getByText("确认保存"));
    await waitFor(() => {
      expect(screen.getByText("操作失败，请重试")).toBeInTheDocument();
    });
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
    expect(screen.getByText("提议正文草稿")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    fail = false;
    fireEvent.click(screen.getByText("确认保存"));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
  });
});
