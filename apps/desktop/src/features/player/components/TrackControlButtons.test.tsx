import { createRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "@dawnsight/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@dawnsight/ui/dropdown-menu";
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
} from "@dawnsight/ui/tooltip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePlayerStore } from "@/features/player/store";
import { useTrackStore } from "@/features/player/trackStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: vi.fn().mockImplementation(() => ({ onmessage: null })),
}));

import { invoke } from "@tauri-apps/api/core";

import { RateSelect } from "./RateSelect";
import { TrackControlButtons } from "./TrackControlButtons";

function renderMenus() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <TrackControlButtons variant="sidebar" />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "subtitle_list_choices")
      return Promise.resolve([
        {
          id: "cache:subdl:en",
          source: "Sidecar",
          label: "下载 · subdl · en",
          supported: true,
          streamIndex: null,
          externalPath: null,
          codecName: "srt",
          language: "en",
        },
      ]);
    if (cmd === "media_inspect")
      return Promise.resolve({
        path: "C:\\v\\a.mp4",
        streams: [],
        chapters: [],
      });
    return Promise.resolve(null);
  });
  useTrackStore.setState({
    subtitleChoiceId: "cache:subdl:en",
    subtitleVisible: true,
    audioStreamIndex: null,
    directoryPrefs: {},
  });
  usePlayerStore.setState({
    currentFile: "C:\\v\\a.mp4",
    status: "Paused",
    currentTimeMs: 0,
    rate: 0.5,
  });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("TrackControlButtons subtitle menu", () => {
  it("opens the menu and toggles surface visibility", async () => {
    const user = userEvent.setup();
    renderMenus();
    // 按钮文案会剥掉"下载 · "前缀（菜单项里才是全名）。
    const trigger = await screen.findByText("subdl · en", undefined, {
      timeout: 8000,
    });
    await user.click(trigger);
    const toggle = await screen.findByRole("switch", { name: "显示字幕" });
    expect(toggle).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveClass("z-[100]");
    const track = screen.getByRole("option", {
      name: "下载 · subdl · en",
    });
    expect(track).toHaveAttribute("aria-selected", "true");
    await user.click(toggle);
    await waitFor(() => {
      expect(useTrackStore.getState().subtitleVisible).toBe(false);
    });
    // 选中轨不受影响。
    expect(useTrackStore.getState().subtitleChoiceId).toBe("cache:subdl:en");
  });
});

describe("shared primitive ref forwarding", () => {
  // Lock the Base UI render-chain contract: shared wrappers must forward refs,
  // or floating-layer positioning can fail silently.
  it("Button exposes the DOM node", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>x</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it("nested render trigger chains deliver the anchor to every layer", () => {
    let menuEl: Element | null = null;
    let tipEl: Element | null = null;
    render(
      <TooltipProvider>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              ref={(node: HTMLElement | null) => {
                tipEl = node;
              }}
              render={
                <DropdownMenuTrigger
                  ref={(node: HTMLElement | null) => {
                    menuEl = node;
                  }}
                  render={<Button>x</Button>}
                />
              }
            />
          </Tooltip>
        </DropdownMenu>
      </TooltipProvider>,
    );
    expect(menuEl).toBeInstanceOf(HTMLButtonElement);
    expect(tipEl).toBe(menuEl);
  });
});

describe("RateSelect menu", () => {
  it("opens the playback speed menu", async () => {
    const user = userEvent.setup();
    render(<RateSelect />);

    await user.click(screen.getByRole("combobox", { name: "选择播放速度" }));

    expect(await screen.findByPlaceholderText("搜索倍速")).toBeInTheDocument();
    const oneRate = screen.getByRole("option", { name: "1x" });
    expect(oneRate).toBeInTheDocument();
    expect(oneRate).toHaveAttribute("aria-selected", "false");
  });
});

