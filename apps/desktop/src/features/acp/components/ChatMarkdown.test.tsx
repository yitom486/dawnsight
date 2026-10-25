import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePlayerStore } from "@/features/player";

import { ChatMarkdown } from "./ChatMarkdown";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("ChatMarkdown", () => {
  it("animates live text and renders completed content without animation spans", () => {
    const { container, rerender } = render(<ChatMarkdown content="Live text" streaming />);
    expect(container.querySelector("[data-sd-animate]")).toBeTruthy();
    rerender(<ChatMarkdown content="Live text completed." />);
    expect(container.querySelector("[data-sd-animate]")).toBeNull();
    expect(container.textContent).toContain("Live text completed.");
  });

  it("renders headings and inline code", () => {
    render(<ChatMarkdown content={"## 标题\n\n这是 `code` 示例。"} />);
    expect(screen.getByRole("heading", { level: 2, name: "标题" })).toBeInTheDocument();
    expect(screen.getByText("code")).toBeInTheDocument();
  });

  it("renders block math with KaTeX", () => {
    const { container } = render(
      <ChatMarkdown content={"$$E = mc^2$$"} />,
    );
    expect(container.querySelector(".katex")).toBeTruthy();
  });

  it("keeps streaming an unclosed fence and completes without loss", async () => {
    const fence = "```";
    const partial = `结论如下：\n\n${fence}text\n未闭合的代码`;
    const { rerender } = render(
      <ChatMarkdown content={partial} streaming />,
    );
    expect(screen.getByText(/未闭合的代码/)).toBeInTheDocument();
    rerender(
      <ChatMarkdown content={`${partial}\n收尾。\n${fence}\n\n末尾段。`} />,
    );
    expect(await screen.findByText(/末尾段/)).toBeInTheDocument();
    expect(screen.getByText(/未闭合的代码/)).toBeInTheDocument();
  });

  it("renders tables and semantic links without hardcoded palette", () => {
    const { container } = render(
      <ChatMarkdown
        content={"| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n\n见[文档](https://example.com/a)。"}
      />,
    );
    expect(container.querySelector("table")).toBeTruthy();
    const link = screen.getByRole("link", { name: "文档" });
    expect(link).toHaveAttribute("href", "https://example.com/a");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.className).toContain("text-info");
    expect(link.className).not.toContain("text-sky-400");
  });

  it("never executes raw HTML from Agent output", () => {
    const { container } = render(
      <ChatMarkdown
        content={'正常文本<script>alert("x")</script><img src="x" onerror="alert(1)" />'}
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("strips dangerous URL schemes but keeps http and mailto", () => {
    const { container } = render(
      <ChatMarkdown
        content={
          "见[本地](file:///C:/secret.txt)和[弹](javascript:alert(1))，" +
          "以及[官网](https://example.com)与[邮件](mailto:a@b.c)。"
        }
      />,
    );
    expect(screen.getByRole("link", { name: "官网" })).toHaveAttribute(
      "href",
      "https://example.com/",
    );
    expect(screen.getByRole("link", { name: "邮件" })).toHaveAttribute(
      "href",
      "mailto:a@b.c",
    );
    const html = container.innerHTML;
    expect(html).not.toContain("file:///C:/secret.txt");
    expect(html).not.toContain("javascript:");
  });

  it("strips relative, fragment and non-web schemes (tightened vs old default)", () => {
    // 旧 react-markdown 默认已拒 file:（safeProtocol 仅 http(s)/irc(s)/
    // mailto/xmpp）；本渲染器进一步收紧到 http/https/mailto：相对路径、
    // 片段与 irc 等一律去 URL 只留文字（R1 §3.2）。
    const { container } = render(
      <ChatMarkdown
        content={
          "见[相对](./pic.png)、[片段](#sec2)与[聊天](irc://host/ch)，" +
          "官网[直链](https://example.com/x)正常。"
        }
      />,
    );
    expect(screen.getByRole("link", { name: "直链" })).toHaveAttribute(
      "href",
      "https://example.com/x",
    );
    const html = container.innerHTML;
    expect(html).not.toContain("./pic.png");
    expect(html).not.toContain("#sec2");
    expect(html).not.toContain("irc://host/ch");
    expect(screen.getByText("相对")).toBeInTheDocument();
  });

  it("offers a Chinese copy button for code blocks", async () => {
    const fence = "```";
    render(
      <ChatMarkdown content={`示例：\n\n${fence}js\nconsole.log("hi");\n${fence}\n`} />,
    );
    expect(
      await screen.findByRole("button", { name: "复制代码" }),
    ).toBeInTheDocument();
  });
});

function renderMarkdown(content: string, streaming = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ChatMarkdown content={content} streaming={streaming} />
    </QueryClientProvider>,
  );
}

describe("ChatMarkdown citations", () => {
  it.each([
    "See [03:12] now.",
    "- See [03:12] now.",
  ])("keeps verified citations usable during animated streaming: %s", async (content) => {
    renderMarkdown(content, true);
    expect(await screen.findByRole("button", { name: "[03:12]" })).toBeInTheDocument();
  });

  it("does not linkify animated code or web-link labels", () => {
    renderMarkdown("`[03:12]` and [[04:00]](https://example.com)", true);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://example.com/");
  });

  beforeEach(() => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "media_inspect")
        return Promise.resolve({
          path: "C:\\v\\b.mp4",
          durationMs: 120_000,
          streams: [],
          chapters: [],
        });
      if (cmd === "library_resolve_episode_file")
        return Promise.resolve("C:\\v\\b.mp4");
      if (cmd === "player_open")
        return Promise.resolve({
          status: "Paused",
          currentFile: "C:\\v\\b.mp4",
        });
      if (cmd === "player_seek")
        return Promise.resolve({ status: "Paused", currentTimeMs: 192000 });
      return Promise.resolve(null);
    });
    usePlayerStore.setState({
      currentFile: "C:\\v\\a.mp4",
      status: "Paused",
      currentTimeMs: 0,
      durationMs: 3_600_000,
    });
  });

  it("linkifies verified same-media citations; code stays plain", async () => {
    renderMarkdown(
      "关键在[03:12]这里。\n\n```\n[03:12] 不是引用\n```\n\n行内 `[04:00]` 也不链。",
    );
    const link = await screen.findByRole("button", { name: "[03:12]" });
    expect(link).toBeInTheDocument();
    // Bare prose time is not a citation.
    expect(screen.queryByText("3:12")).not.toBeInTheDocument();
  });

  it("clicking seeks without extra invokes", async () => {
    renderMarkdown("看[03:12]。");
    const link = await screen.findByRole("button", { name: "[03:12]" });
    fireEvent.click(link);
    await waitFor(() => {
      expect(
        vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "player_seek"),
      ).toHaveLength(1);
    });
  });

  it("out-of-range citations render unverified and never seek", async () => {
    renderMarkdown("超长的[99:59:59]伪造。");
    await waitFor(() => {
      expect(screen.getByText("[99:59:59]")).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: "[99:59:59]" }),
    ).not.toBeInTheDocument();
    expect(
      vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "player_seek"),
    ).toHaveLength(0);
  });

  it("cross-episode citations confirm, save position and jump", async () => {
    renderMarkdown("见[第2集 · 01:00]。");
    const link = await screen.findByRole("button", {
      name: "[第2集 · 01:00]",
    });
    fireEvent.click(link);
    expect(
      await screen.findByText("切换媒体并保存当前位置？"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("切换"));
    await waitFor(() => {
      expect(
        vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "player_open"),
      ).toHaveLength(1);
    });
  });
});
