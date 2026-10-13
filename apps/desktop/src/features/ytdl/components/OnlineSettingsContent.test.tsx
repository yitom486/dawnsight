import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePlayerStore } from "@/features/player";

import { OnlineResourceSettingsPanel } from "./OnlineResourceSettingsPanel";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

import { invoke } from "@tauri-apps/api/core";
import { ytdlResolveKey } from "@dawnsight/query-keys";

const SIGNED =
  "https://user:pass@video.example.com:8443/watch/abc?token=secret123&sig=abcdef#frag";

function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <OnlineResourceSettingsPanel />
    </QueryClientProvider>,
  );
}

function playerOpenCalls() {
  return vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "player_open");
}

/** Rendered text and naming attributes, excluding editable input values
 * (the user's own pasted URL stays editable in the field by contract). */
function surfacedText() {
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  for (const el of Array.from(clone.querySelectorAll("input, textarea, select"))) {
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
  vi.clearAllMocks();
  usePlayerStore.setState({
    currentFile: null,
    sourceKind: "local",
    status: "Idle",
    statusMessage: "",
    error: null,
    busy: false,
  } as never);
});

afterEach(() => {
  cleanup();
  usePlayerStore.setState({
    currentFile: null,
    sourceKind: "local",
    status: "Idle",
    statusMessage: "",
    error: null,
    busy: false,
  } as never);
});

describe("OnlineSourcePanel settings form", () => {
  it.each([{ isComposing: true }, { keyCode: 229 }])(
    "does not submit an IME confirmation Enter (%j)",
    (event) => {
      renderSettings();
      fireEvent.change(screen.getByLabelText("在线视频 URL"), {
        target: { value: SIGNED },
      });
      fireEvent.keyDown(screen.getByLabelText("在线视频 URL"), {
        key: "Enter", ...event,
      });
      expect(playerOpenCalls()).toHaveLength(0);
      expect((screen.getByLabelText("在线视频 URL") as HTMLInputElement).value).toBe(SIGNED);
    },
  );
  it("keeps the functional title and links the visible label to the input", () => {
    renderSettings();
    expect(screen.getByRole("heading", { name: "打开在线视频" })).toBeInTheDocument();
    const input = screen.getByLabelText("在线视频 URL");
    expect(input).toHaveAttribute(
      "aria-describedby",
      expect.stringMatching(/.+/),
    );
    expect(input.getAttribute("aria-describedby")).toBe(
      document.getElementById(input.getAttribute("aria-describedby")!)?.id,
    );
  });

  it("disables open without a URL and never calls the handler", () => {
    renderSettings();
    const button = screen.getByRole("button", { name: "打开链接" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByLabelText("在线视频 URL"), { key: "Enter" });
    expect(invoke).not.toHaveBeenCalledWith("player_open", expect.anything());
  });

  it("submits the trimmed URL exactly once and clears on success", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "player_open")
        return Promise.resolve({
          status: "Playing",
          currentTimeMs: 0,
          durationMs: 1000,
          volume: 1,
          rate: 1,
          currentFile: SIGNED,
          sourceKind: "remote",
          error: null,
        });
      return Promise.resolve(null);
    });
    renderSettings();
    const input = screen.getByLabelText("在线视频 URL") as HTMLInputElement;
    fireEvent.change(input, { target: { value: `  ${SIGNED}  ` } });
    fireEvent.click(screen.getByRole("button", { name: "打开链接" }));
    await waitFor(() => {
      expect(playerOpenCalls()).toHaveLength(1);
    });
    expect(playerOpenCalls()[0]).toEqual(["player_open", { path: SIGNED }]);
    await waitFor(() => {
      expect(
        (screen.getByLabelText("在线视频 URL") as HTMLInputElement).value,
      ).toBe("");
    });
  });

  it("submits once via Enter with the same parameter", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "player_open")
        return Promise.resolve({
          status: "Playing",
          currentTimeMs: 0,
          durationMs: 1000,
          volume: 1,
          rate: 1,
          currentFile: SIGNED,
          sourceKind: "remote",
          error: null,
        });
      return Promise.resolve(null);
    });
    renderSettings();
    fireEvent.change(screen.getByLabelText("在线视频 URL"), {
      target: { value: SIGNED },
    });
    fireEvent.keyDown(screen.getByLabelText("在线视频 URL"), { key: "Enter" });
    await waitFor(() => {
      expect(playerOpenCalls()).toHaveLength(1);
    });
    expect(playerOpenCalls()[0]).toEqual(["player_open", { path: SIGNED }]);
  });

  it("disables input and action while busy with zero new calls", () => {
    usePlayerStore.setState({ busy: true } as never);
    renderSettings();
    expect(screen.getByLabelText("在线视频 URL")).toBeDisabled();
    expect(screen.getByRole("button", { name: "解析打开中…" })).toBeDisabled();
    expect(screen.getByText(/可能需要十几秒/)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("player_open", expect.anything());
  });

  it("keeps the typed URL and maps a technical failure to a safe message", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "player_open") return Promise.reject(new TypeError("failed to fetch"));
      return Promise.resolve(null);
    });
    renderSettings();
    fireEvent.change(screen.getByLabelText("在线视频 URL"), {
      target: { value: SIGNED },
    });
    fireEvent.click(screen.getByRole("button", { name: "打开链接" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    // Input preserved for retry.
    expect(
      (screen.getByLabelText("在线视频 URL") as HTMLInputElement).value,
    ).toBe(SIGNED);
    // Raw technical text never surfaces; user-typed input value is exempt
    // (kept editable by contract) but must not leak into copy or naming.
    expect(screen.queryByText(/failed to fetch/)).not.toBeInTheDocument();
    const surfaced = surfacedText();
    expect(surfaced.html).not.toContain("token=secret123");
    expect(surfaced.html).not.toContain("sig=abcdef");
    expect(surfaced.attrs).not.toContain("secret123");
    expect(
      screen.getByRole("alert").textContent ?? "",
    ).not.toMatch(/TypeError|details|stderr/i);
  });

  it("shows a business failure message and the recovery hint", () => {
    usePlayerStore.setState({
      status: "Error",
      error: { code: "AuthRequired", message: "该视频需要登录后才能播放" },
    } as never);
    renderSettings();
    expect(screen.getByText("该视频需要登录后才能播放")).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert.textContent ?? "").toMatch(/cookies\.txt/);
  });

  it("shows only the hostname in the playing summary, never signatures", async () => {
    usePlayerStore.setState({
      currentFile: SIGNED,
      sourceKind: "remote",
      status: "Playing",
    } as never);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(ytdlResolveKey(SIGNED), {
      mediaId: "video:abc",
      title: "示例在线视频",
      durationMs: 600_000,
      webpageUrl: SIGNED,
      extractor: "generic",
      chapters: [],
      formats: [],
      subtitles: [],
    });
    render(
      <QueryClientProvider client={client}>
        <OnlineResourceSettingsPanel />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText(/当前在线源/)).toBeInTheDocument();
    });
    expect(screen.getByText(/video\.example\.com/)).toBeInTheDocument();
    const surfaced = surfacedText();
    expect(surfaced.html).not.toContain("token=secret123");
    expect(surfaced.html).not.toContain("sig=abcdef");
    expect(surfaced.html).not.toContain("#frag");
    expect(surfaced.html).not.toContain("user:pass");
    expect(surfaced.attrs).not.toContain("secret123");
  });

  it("renders a long business error in full", () => {
    const longError = `打开失败：该地址需要登录后才能播放LoginRequiredWithoutSpaces${"错".repeat(40)}尾`;
    usePlayerStore.setState({
      status: "Error",
      error: { code: "AuthRequired", message: longError },
    } as never);
    renderSettings();
    expect(screen.getByText(longError, { exact: false })).toBeInTheDocument();
  });
});
