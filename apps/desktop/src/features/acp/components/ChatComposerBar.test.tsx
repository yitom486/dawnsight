import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAcpSettingsStore } from "@dawnsight/chat-ui/acpSettingsStore";

import { ChatComposerBar } from "./ChatComposerBar";
import type { AcpStatus } from "../types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

function renderBar(props: Partial<React.ComponentProps<typeof ChatComposerBar>> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onChange = vi.fn();
  const onSend = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <ChatComposerBar
        value=""
        status={undefined}
        sessionConnected={false}
        onChange={onChange}
        onSend={onSend}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onChange, onSend };
}

beforeEach(() => {
  vi.mocked(invoke).mockImplementation(() => Promise.resolve(null));
  useAcpSettingsStore.setState({
    permissionMode: "auto",
    modelId: "",
    reasoningEffort: "",
  });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("ChatComposerBar send and keys", () => {
  it("sends idle text on Enter", () => {
    const { onSend } = renderBar({ value: "提问" });
    const box = screen.getByPlaceholderText("输入问题…");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("keeps Shift+Enter as a newline, not a send", () => {
    const { onSend } = renderBar({ value: "提问" });
    fireEvent.keyDown(screen.getByPlaceholderText("输入问题…"), {
      key: "Enter",
      shiftKey: true,
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  it.each([
    { busy: false, isComposing: true, keyCode: 13 },
    { busy: false, isComposing: false, keyCode: 229 },
    { busy: true, isComposing: true, keyCode: 13 },
    { busy: true, isComposing: false, keyCode: 229 },
  ])("leaves IME confirmation alone: %j", ({ busy, isComposing, keyCode }) => {
    const onBargeIn = vi.fn();
    const { onSend } = renderBar({ value: "候选文字", busy, onBargeIn });
    const allowed = fireEvent.keyDown(screen.getByPlaceholderText(busy ? /回复进行中/ : "输入问题…"), {
      key: "Enter", ctrlKey: busy, isComposing, keyCode,
    });
    expect(onSend).not.toHaveBeenCalled();
    expect(onBargeIn).not.toHaveBeenCalled();
    expect(allowed).toBe(true);
  });

  it("disables send on empty input", () => {
    const { onSend } = renderBar({ value: "   " });
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    fireEvent.keyDown(screen.getByPlaceholderText("输入问题…"), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("sends on Ctrl+Enter when no barge action exists", () => {
    const { onSend } = renderBar({ value: "提问" });
    fireEvent.keyDown(screen.getByPlaceholderText("输入问题…"), {
      key: "Enter",
      ctrlKey: true,
    });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("barges instead of sending when busy with text", () => {
    const onBargeIn = vi.fn();
    const { onSend } = renderBar({
      value: "插队问题",
      busy: true,
      sessionConnected: true,
      onBargeIn,
    });
    fireEvent.keyDown(screen.getByPlaceholderText(/回复进行中/), {
      key: "Enter",
      ctrlKey: true,
    });
    expect(onBargeIn).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("queues on Enter while busy and offers cancel", () => {
    const onCancel = vi.fn();
    const { onSend } = renderBar({
      value: "排队问题",
      busy: true,
      sessionConnected: true,
      onCancel,
      onBargeIn: vi.fn(),
    });
    expect(screen.getByRole("button", { name: "加入排队" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByPlaceholderText(/回复进行中/), { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "取消当前回合" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables everything when disconnected", () => {
    renderBar({ value: "提问", disabled: true });
    expect(screen.getByPlaceholderText("输入问题…")).toBeDisabled();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  });
});

describe("ChatComposerBar queue", () => {
  const queue = [
    { id: "q1", text: "第一问", anchorPositionMs: 1 },
    {
      id: "q2",
      text: "很长的排队问题正文，超过二十八字后预览应当截断并保留省略号。",
      anchorPositionMs: 2,
    },
  ];

  it("shows the count, truncated previews and per-item removal", async () => {
    const onRemoveQueued = vi.fn();
    const onClearQueue = vi.fn();
    renderBar({
      value: "",
      busy: true,
      sessionConnected: true,
      queue,
      onRemoveQueued,
      onClearQueue,
    });
    expect(await screen.findByText(/排队 2 条/)).toBeInTheDocument();
    expect(screen.getByText(/很长的排队问题正文，超过二十八字后预览应当截断/)).toBeInTheDocument();
    const removes = screen.getAllByRole("button", { name: "移除排队" });
    expect(removes).toHaveLength(2);
    fireEvent.click(removes[1] as Element);
    expect(onRemoveQueued).toHaveBeenCalledWith("q2");
    fireEvent.click(screen.getByText("清空"));
    expect(onClearQueue).toHaveBeenCalledTimes(1);
  });
});

describe("ChatComposerBar attachments", () => {
  const png = (name: string) => new File(["x"], name, { type: "image/png" });

  it("previews pasted images and removes them by id", () => {
    const onRemoveAttachment = vi.fn();
    renderBar({
      value: "",
      attachments: [
        { id: "a1", mimeType: "image/png", dataUrl: "data:image/png;base64,AAA" },
        { id: "a2", mimeType: "image/png", dataUrl: "data:image/png;base64,BBB" },
      ],
      onRemoveAttachment,
    });
    expect(screen.getAllByAltText("粘贴的图片")).toHaveLength(2);
    const removes = screen.getAllByRole("button", { name: "移除图片" });
    fireEvent.click(removes[0] as Element);
    expect(onRemoveAttachment).toHaveBeenCalledWith("a1");
  });

  it("pastes only images and prevents the default paste", () => {
    const onPasteImages = vi.fn();
    renderBar({ value: "", onPasteImages });
    const box = screen.getByPlaceholderText("输入问题…");
    const prevented = !fireEvent.paste(box, {
      clipboardData: { files: [png("a.png"), new File(["x"], "b.txt", { type: "text/plain" })] },
    });
    expect(prevented).toBe(true);
    expect(onPasteImages).toHaveBeenCalledTimes(1);
    expect(onPasteImages.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it("ignores non-image pastes without preventing default", () => {
    const onPasteImages = vi.fn();
    renderBar({ value: "", onPasteImages });
    const prevented = !fireEvent.paste(screen.getByPlaceholderText("输入问题…"), {
      clipboardData: { files: [new File(["x"], "b.txt", { type: "text/plain" })] },
    });
    expect(prevented).toBe(false);
    expect(onPasteImages).not.toHaveBeenCalled();
  });
});

describe("ChatComposerBar focus and controls", () => {
  it("refocuses the input when busy settles", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const base = {
      value: "",
      status: undefined,
      sessionConnected: false,
      onChange: vi.fn(),
      onSend: vi.fn(),
    } as const;
    const view = render(
      <QueryClientProvider client={client}>
        <ChatComposerBar {...base} busy />
      </QueryClientProvider>,
    );
    view.rerender(
      <QueryClientProvider client={client}>
        <ChatComposerBar {...base} />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByPlaceholderText("输入问题…"));
    });
  });

  it("offers auto/ask permission modes", () => {
    renderBar({});
    expect(screen.getByRole("combobox", { name: "权限模式" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "权限模式" }), {
      target: { value: "ask" },
    });
    expect(useAcpSettingsStore.getState().permissionMode).toBe("ask");
  });

  it("keeps a long model id fully present in the input", () => {
    const longId = `超长模型标识-${"m".repeat(60)}`;
    renderBar({});
    const input = screen.getByRole("textbox", { name: "模型 ID" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: longId } });
    expect(input.value).toBe(longId);
    expect(useAcpSettingsStore.getState().modelId).toBe(longId);
  });

  it("shows only the business message when model discovery fails", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "acp_models_discover") return Promise.reject({
        code: "DiscoveryFailed", message: "暂时无法读取模型，请重试。",
        details: "acp_models_discover stderr PRIVATE_DETAILS",
      });
      return Promise.resolve(null);
    });
    renderBar({
      value: "",
      status: { available: true, activeProfileId: "codex" } as unknown as AcpStatus,
      sessionConnected: false,
    });
    await screen.findByText("暂时无法读取模型，请重试。");
    expect(screen.queryByText(/acp_models_discover/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PRIVATE_DETAILS/)).not.toBeInTheDocument();
  });
});
