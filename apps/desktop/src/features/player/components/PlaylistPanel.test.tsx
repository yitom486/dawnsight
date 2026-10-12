import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePlayerStore } from "../store";
import { PlaylistPanel } from "./PlaylistPanel";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

const FILES = [
  "D:\\v\\第一集.mp4",
  "D:\\v\\第二集.mp4",
  "D:\\v\\第三集.mp4",
];

function snapshotFor(path: string) {
  return {
    status: "Paused",
    currentTimeMs: 0,
    durationMs: 60_000,
    volume: 80,
    rate: 1,
    currentFile: path,
    error: null,
  };
}

function openCalls() {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "player_open");
}

beforeEach(() => {
  vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
    if (cmd === "media_list_siblings") return Promise.resolve([]);
    if (cmd === "player_open") {
      const path = (args as { path?: string }).path ?? FILES[0];
      return Promise.resolve(snapshotFor(path));
    }
    if (cmd === "player_play") return Promise.resolve(snapshotFor(FILES[1]));
    return Promise.resolve(null);
  });
  usePlayerStore.setState({
    playlist: FILES,
    playlistIndex: 0,
    currentFile: FILES[0],
    status: "Paused",
    busy: false,
  });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("PlaylistPanel", () => {
  it("marks the current item without disabling it", () => {
    render(<PlaylistPanel />);

    const active = screen.getByRole("button", { name: /第一集/ });
    expect(active).toHaveAttribute("aria-current", "true");
    // Current item stays focusable; activating it is a deliberate no-op by
    // the existing contract (openPath is for other rows). Retrying a failed
    // current item belongs to the transport controls, not this row.
    expect(active).not.toBeDisabled();
  });

  it("does not reopen the current item", async () => {
    render(<PlaylistPanel />);

    fireEvent.click(screen.getByRole("button", { name: /第一集/ }));
    await waitFor(() => {
      expect(usePlayerStore.getState().currentFile).toBe(FILES[0]);
    });
    expect(openCalls()).toHaveLength(0);
  });

  it("opens another item without rebuilding and plays when no resume", async () => {
    render(<PlaylistPanel />);

    fireEvent.click(screen.getByRole("button", { name: /第二集/ }));
    await waitFor(() => {
      expect(openCalls()).toHaveLength(1);
    });
    expect(openCalls()[0]?.[1]).toMatchObject({ path: FILES[1] });
    await waitFor(() => {
      expect(
        vi
          .mocked(invoke)
          .mock.calls.filter(([cmd]) => cmd === "player_play"),
      ).toHaveLength(1);
    });
  });

  it("disables every row while busy", () => {
    usePlayerStore.setState({ busy: true });
    render(<PlaylistPanel />);

    for (const name of [/第一集/, /第二集/, /第三集/]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
  });
});
