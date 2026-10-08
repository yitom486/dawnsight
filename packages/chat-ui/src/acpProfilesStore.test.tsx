import { beforeEach, describe, expect, it } from "vitest";

import type { AgentProfileInput, AgentProfileStatus } from "./types";
import {
  CODEX_ACP_PACKAGE,
  LEGACY_CODEX_ACP_PACKAGE,
} from "./defaultAgentProfiles";
import { mergeProfiles, useAcpProfilesStore } from "./acpProfilesStore";

beforeEach(() => {
  localStorage.clear();
  useAcpProfilesStore.setState({ activeProfileId: "codex" });
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

describe("mergeProfiles (upgrade migration)", () => {
  // Explicit shell fixture: the builtin lineup now comes from the engine,
  // so migration tests pin their own fallback instead of the static seed.
  const codexShell = (): AgentProfileInput => ({
    id: "codex",
    name: "ChatGPT",
    kind: "Codex",
    command: "bunx",
    args: [CODEX_ACP_PACKAGE],
    env: {},
  });
  const cursorShell = (): AgentProfileInput => ({
    id: "cursor",
    name: "Cursor",
    kind: "Cursor",
    command: "agent",
    args: ["acp"],
    env: {},
  });
  const fallback = [codexShell(), cursorShell()];
  const asInput = (items: unknown[]) => items as AgentProfileInput[];

  it("drops removed runtime entries by id or stale variant markers", () => {
    const persisted = asInput([
      {
        id: "antigravity",
        name: "Google Antigravity",
        kind: "Antigravity",
        command: "agy_acp_server.exe",
        launcher: "antigravity-acp",
        envPreset: "antigravity-proxy",
        authPolicy: "antigravity-oauth",
      },
      {
        id: "sneaky",
        name: "Renamed copy",
        kind: "Antigravity",
        command: "agy_acp_server.exe",
      },
      { id: "codex", name: "Codex（默认）", kind: "Codex", command: "bunx" },
    ]);
    const ids = mergeProfiles(persisted, fallback).map((p) => p.id);
    expect(ids).not.toContain("antigravity");
    expect(ids).not.toContain("sneaky");
    expect(ids).toContain("codex");
  });

  it("refreshes builtin display names while preserving the user's launch command", () => {
    const persisted = asInput([
      {
        id: "codex",
        name: "Codex（默认）",
        kind: "Codex",
        command: "C:\\tools\\bunx.exe",
        args: ["pkg"],
        env: { X: "1" },
      },
    ]);
    const codex = mergeProfiles(persisted, fallback).find(
      (p) => p.id === "codex",
    );
    expect(codex?.name).toBe("ChatGPT");
    expect(codex?.command).toBe("C:\\tools\\bunx.exe");
    expect(codex?.args).toEqual(["pkg"]);
    expect(codex?.env).toEqual({ X: "1" });
  });

  it("orders builtins per new defaults and keeps custom ids last", () => {
    const persisted = asInput([
      { id: "my-agent", name: "Mine", kind: "Custom", command: "my-acp" },
      { id: "cursor", name: "Cursor CLI", kind: "Cursor", command: "agent" },
    ]);
    const ids = mergeProfiles(persisted, fallback).map((p) => p.id);
    expect(ids.slice(0, fallback.length)).toEqual(
      fallback.map((p) => p.id),
    );
    expect(ids[ids.length - 1]).toBe("my-agent");
  });

  it("resets an active key pointing at a removed profile on rehydrate", async () => {
    localStorage.setItem(
      "dawnsight-acp-profiles",
      JSON.stringify({
        state: {
          activeProfileId: "antigravity",
          profiles: [
            {
              id: "antigravity",
              name: "Google Antigravity",
              kind: "Antigravity",
              command: "agy_acp_server.exe",
              launcher: "antigravity-acp",
              envPreset: "antigravity-proxy",
              authPolicy: "antigravity-oauth",
            },
            {
              id: "codex",
              name: "Codex（默认）",
              kind: "Codex",
              command: "bunx",
            },
          ],
        },
        version: 0,
      }),
    );
    await useAcpProfilesStore.persist.rehydrate();
    const state = useAcpProfilesStore.getState();
    expect(state.activeProfileId).toBe("codex");
    expect(state.profiles.map((p) => p.id)).not.toContain("antigravity");
    // Display names now refresh from the engine registry, not the static
    // seed: sync an engine codex entry and the stale name heals.
    state.syncEngineProfiles([
      {
        id: "codex",
        name: "ChatGPT",
        kind: "Codex",
        command: "bunx",
        args: [CODEX_ACP_PACKAGE],
        env: {},
        available: true,
      },
    ]);
    expect(
      useAcpProfilesStore.getState().profiles.find((p) => p.id === "codex")
        ?.name,
    ).toBe("ChatGPT");
  });

  it("upgrades untouched legacy-unpinned codex args to the pinned adapter", () => {
    const upgraded = mergeProfiles(
      [
        {
          id: "codex",
          name: "Codex（默认）",
          kind: "Codex",
          command: "bunx",
          args: [LEGACY_CODEX_ACP_PACKAGE],
        } as AgentProfileInput,
      ],
      [codexShell()],
    ).find((p) => p.id === "codex");
    expect(upgraded?.args).toEqual([CODEX_ACP_PACKAGE]);
  });

  it("upgrades explicit version pins of the same package to the floating default", () => {
    const upgraded = mergeProfiles(
      [
        {
          id: "codex",
          name: "ChatGPT",
          kind: "Codex",
          command: "bunx",
          args: ["@agentclientprotocol/codex-acp@1.12.0"],
        } as AgentProfileInput,
      ],
      [codexShell()],
    ).find((p) => p.id === "codex");
    expect(upgraded?.args).toEqual([CODEX_ACP_PACKAGE]);
  });

  it("keeps user-customized codex args untouched", () => {
    const kept = mergeProfiles(
      [
        {
          id: "codex",
          name: "ChatGPT",
          kind: "Codex",
          command: "C:\\tools\\codex-acp.exe",
          args: ["--yolo"],
        } as AgentProfileInput,
      ],
      [codexShell()],
    ).find((p) => p.id === "codex");
    expect(kept?.command).toBe("C:\\tools\\codex-acp.exe");
    expect(kept?.args).toEqual(["--yolo"]);
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
    args: [CODEX_ACP_PACKAGE],
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

  it("adopts engine order and specs, keeps user customs last", () => {
    resetStore([
      {
        id: "opencode-v2",
        name: "OpenCode v2",
        kind: "Custom",
        command: "D:\\tools\\opencode.exe",
        args: ["acp"],
        env: {},
      },
    ]);
    useAcpProfilesStore.getState().syncEngineProfiles([
      engineEntry(),
      { ...engineEntry(), id: "claude", name: "Claude", kind: "Claude" },
    ]);
    const ids = useAcpProfilesStore.getState().profiles.map((p) => p.id);
    expect(ids).toEqual(["codex", "claude", "opencode-v2"]);
  });

  it("preserves user-modified launch triples but tracks engine names", () => {
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
    expect(codex?.command).toBe("C:\\tools\\codex.exe");
    expect(codex?.args).toEqual(["--yolo"]);
    expect(codex?.env).toEqual({ A: "1" });
  });

  it("floats untouched same-package codex specs to the canonical adapter", () => {
    resetStore([
      {
        id: "codex",
        name: "ChatGPT",
        kind: "Codex",
        command: "bunx",
        args: [LEGACY_CODEX_ACP_PACKAGE],
        env: {},
      },
    ]);
    useAcpProfilesStore.getState().syncEngineProfiles([engineEntry()]);
    expect(
      useAcpProfilesStore.getState().profiles.find((p) => p.id === "codex")
        ?.args,
    ).toEqual([CODEX_ACP_PACKAGE]);
  });

  it("ignores an empty engine lineup (engine down destroys nothing)", () => {
    resetStore([
      {
        id: "codex",
        name: "ChatGPT",
        kind: "Codex",
        command: "bunx",
        args: [CODEX_ACP_PACKAGE],
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
        args: [CODEX_ACP_PACKAGE],
        env: {},
      },
    ]);
    const before = useAcpProfilesStore.getState().profiles;
    useAcpProfilesStore.getState().syncEngineProfiles([engineEntry()]);
    expect(useAcpProfilesStore.getState().profiles).toBe(before);
  });
});
