import { describe, expect, it } from "vitest";

import {
  defaultAgentProfiles,
  profilesHintFromStore,
} from "@dawnsight/chat-ui/defaultAgentProfiles";

/**
 * The agent lineup is owned exclusively by `@yitom/acp-client` (engine
 * runtime registry) and adopted at runtime via `syncEngineProfiles`. The app
 * ships no static seed at all: no custom template, no runtime matrix.
 */
describe("profilesHintFromStore", () => {
  it("falls back when persisted profiles are missing", () => {
    const hint = profilesHintFromStore("codex", undefined);
    expect(hint.activeProfileId).toBe("codex");
    expect(hint.profiles).toEqual(defaultAgentProfiles());
  });

  it("passes engine-synced profiles through untouched", () => {
    const hint = profilesHintFromStore("claude", [
      {
        id: "claude",
        name: "Claude",
        kind: "Claude",
        command: "claude-agent-acp",
        args: [],
        env: {},
      },
    ]);
    expect(hint.activeProfileId).toBe("claude");
    expect(hint.profiles.map((profile) => profile.id)).toEqual(["claude"]);
  });

  it("seeds no profiles at all", () => {
    expect(defaultAgentProfiles()).toEqual([]);
  });

  it("ships no hardcoded runtime matrix", () => {
    const ids = defaultAgentProfiles().map((profile) => profile.id);
    for (const runtime of [
      "codex",
      "claude",
      "gemini",
      "copilot",
      "opencode",
      "cursor",
      "deepseek",
      "agy",
      "custom",
    ]) {
      expect(ids).not.toContain(runtime);
    }
  });
});
