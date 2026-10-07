import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { TooltipProvider } from "@dawnsight/ui/tooltip";
import { WindowControls } from "./WindowControls";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(),
}));

describe("WindowControls", () => {
  afterEach(() => {
    cleanup();
  });
  const mockWindow = {
    minimize: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn().mockResolvedValue(undefined),
    isMaximized: vi.fn().mockResolvedValue(false),
    close: vi.fn().mockResolvedValue(undefined),
    onResized: vi.fn().mockResolvedValue(() => {}),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentWindow).mockReturnValue(mockWindow as unknown as ReturnType<typeof getCurrentWindow>);
  });

  it("renders minimize, maximize and close buttons", () => {
    render(
      <TooltipProvider>
        <WindowControls />
      </TooltipProvider>,
    );

    expect(screen.getByRole("button", { name: "最小化窗口" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "最大化窗口" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭窗口" })).toBeInTheDocument();
  });

  it("triggers minimize when minimize button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <WindowControls />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: "最小化窗口" }));
    expect(mockWindow.minimize).toHaveBeenCalledTimes(1);
  });

  it("triggers toggleMaximize when maximize button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <WindowControls />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: "最大化窗口" }));
    expect(mockWindow.toggleMaximize).toHaveBeenCalledTimes(1);
  });

  it("triggers close when close button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <WindowControls />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: "关闭窗口" }));
    expect(mockWindow.close).toHaveBeenCalledTimes(1);
  });

  it("renders restore label when window is maximized", async () => {
    mockWindow.isMaximized.mockResolvedValue(true);
    render(
      <TooltipProvider>
        <WindowControls />
      </TooltipProvider>,
    );

    expect(await screen.findByRole("button", { name: "向下还原窗口" })).toBeInTheDocument();
  });
});
