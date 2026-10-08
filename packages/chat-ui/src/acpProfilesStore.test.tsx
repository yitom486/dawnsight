import { beforeEach, describe, expect, it } from "vitest";

import type { AgentProfileInput, AgentProfileStatus } from "./types";
import { mergeProfiles, useAcpProfilesStore } from "./acpProfilesStore";

beforeEach(() => {
  localStorage.clear();
  useAcpProfilesStore.setState({ activeProfileId: "codex", profiles: [] });
});

describe("switchActiveProfileId (switch world entry)", () => {
  it("flips the active key to the target profile", () => {
    useAcpProfilesStore.getState().switchActiveProfileId("claude");
    expect(useAcpProfilesStore.getState().activeProfileId).toBe("claude");
  });

  it("is a no-op for the same id and for blank ids", () => {
    useAcpProfilesStore.getState().switchActiveProfileId("codex");
    expect(useAcpProfilesStore.getState().activeProfileId).toBe("codex");

    useAcpProfilesStore.getState().switchActiveProfileId("  ");
    expect(useAcpProfilesStore.getState().activeProfileId).toBe("codex");
  });

  it("keeps the profile list intact (switching never edits the registry)", () => {
    const before = useAcpProfilesStore.getState().profiles.map((p) => p.id);
    useAcpProfilesStore.getState().switchActiveProfileId("cursor");
    const after = useAcpProfilesStore.getState().profiles.map((p) => p.id);
    expect(after).toEqual(before);
    expect(useAcpProfilesStore.getState().activeProfileId).toBe("cursor");
  });

  it("leaves setActiveProfileId as the bare setter", () => {
    // Bare setter flips blindly (legacy direct writes); the guarded entry above
    // is what UI switches must use.
    useAcpProfilesStore.getState().setActiveProfileId("cursor");
    expect(useAcpProfilesStore.getState().activeProfileId).toBe("cursor");
  });
});

describe("mergeProfiles (stale app-side lineups are dropped)", () => {
  it("drops persisted builtin-era copies and hand-added customs", () => {
    const persisted = [
      { id: "codex", name: "ChatGPT", kind: "Codex", command: "bunx" },
      { id: "stale-copy", name: "ChatGPT", kind: "Custom", command: "" },
      { id: "custom", name: "自定义", kind: "Custom", command: "" },
    ] as AgentProfileInput[];
    expect(mergeProfiles(persisted, [])).toEqual([]);
  });

  it("resets an active key pointing at a dropped profile on rehydrate", async () => {
    localStorage.setItem(
      "dawnsight-acp-profiles",
      JSON.stringify({
        state: {
          activeProfileId: "stale-copy",
          profiles: [
            {
              id: "stale-copy",
              name: "ChatGPT",
              kind: "Custom",
              command: "",
            },
          ],
        },
        version: 0,
      }),
    );
    await useAcpProfilesStore.persist.rehydrate();
    const state = useAcpProfilesStore.getState();
    expect(state.profiles).toEqual([]);
    // No synced entry matches the saved key: fall back to the default key.
    expect(state.activeProfileId).toBe("codex");
  });
});

describe("syncEngineProfiles (engine-owned lineup)", () => {
  const engineEntry = (
    overrides: Partial<AgentProfileStatus> = {},
  ): AgentProfileStatus => ({
    id: "codex",
    name: "ChatGPT",
    kind: "Codex",
    command: "bunx",
    args: ["-y", "pkg@latest"],
    env: {},
    available: true,
    ...overrides,
  });

  const resetStore = (profiles: AgentProfileInput[]) => {
    useAcpProfilesStore.setState({
      activeProfileId: "codex",
      profiles: profiles.map((p) => ({ ...p })),
    });
  };

  it("replaces the whole lineup with the engine registry, nothing preserved", () => {
    resetStore([
      {
        id: "stale-copy",
        name: "ChatGPT",
        kind: "Custom",
        command: "",
        args: [],
        env: {},
      },
    ]);
    useAcpProfilesStore.getState().syncEngineProfiles([
      engineEntry(),
      { ...engineEntry(), id: "claude", name: "Claude", kind: "Claude" },
    ]);
    const ids = useAcpProfilesStore.getState().profiles.map((p) => p.id);
    expect(ids).toEqual(["codex", "claude"]);
  });

  it("adopts engine launch specs verbatim (no app-side overrides)", () => {
    resetStore([
      {
        id: "codex",
        name: "Stale Name",
        kind: "Codex",
        command: "C:\\tools\\codex.exe",
        args: ["--yolo"],
        env: { A: "1" },
      },
    ]);
    useAcpProfilesStore.getState().syncEngineProfiles([engineEntry()]);
    const codex = useAcpProfilesStore
      .getState()
      .profiles.find((p) => p.id === "codex");
    expect(codex?.name).toBe("ChatGPT");
    expect(codex?.command).toBe("bunx");
    expect(codex?.args).toEqual(["-y", "pkg@latest"]);
    expect(codex?.env).toEqual({});
  });

  it("resets the active key when it names no synced entry", () => {
    useAcpProfilesStore.setState({ activeProfileId: "stale-copy" });
    useAcpProfilesStore.getState().syncEngineProfiles([
      engineEntry(),
      { ...engineEntry(), id: "claude", name: "Claude", kind: "Claude" },
    ]);
    expect(useAcpProfilesStore.getState().activeProfileId).toBe("codex");
  });

  it("ignores an empty engine lineup (engine down destroys nothing)", () => {
    resetStore([
      {
        id: "codex",
        name: "ChatGPT",
        kind: "Codex",
        command: "bunx",
        args: ["-y", "pkg@latest"],
        env: {},
      },
    ]);
    const before = useAcpProfilesStore.getState();
    useAcpProfilesStore.getState().syncEngineProfiles([]);
    const after = useAcpProfilesStore.getState();
    expect(after.profiles).toBe(before.profiles);
    expect(after.activeProfileId).toBe("codex");
  });

  it("is a no-op when nothing changed (status polls stay quiet)", () => {
    resetStore([
      {
        id: "codex",
        name: "ChatGPT",
        kind: "Codex",
        command: "bunx",
        args: ["-y", "pkg@latest"],
        env: {},
      },
    ]);
    const before = useAcpProfilesStore.getState().profiles;
    useAcpProfilesStore.getState().syncEngineProfiles([engineEntry()]);
    expect(useAcpProfilesStore.getState().profiles).toBe(before);
  });
});
