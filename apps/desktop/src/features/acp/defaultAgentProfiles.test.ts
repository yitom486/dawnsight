import { describe, expect, it } from "vitest";

import {
  defaultAgentProfiles,
  profilesHintFromStore,
} from "@dawnsight/chat-ui/defaultAgentProfiles";

/**
 * The agent lineup is owned by `@yitom/acp-client` (engine runtime
 * registry) and adopted at runtime via `syncEngineProfiles`. This file
 * only pins the static seed contract: exactly the empty custom template,
 * nothing runtime-specific hardcoded.
 */
describe("profilesHintFromStore", () => {
  it("falls back when persisted profiles are missing", () => {
    const hint = profilesHintFromStore("codex", undefined);
    expect(hint.activeProfileId).toBe("codex");
    expect(hint.profiles).toEqual(defaultAgentProfiles());
  });

  it("seeds only the empty custom template", () => {
    expect(defaultAgentProfiles()).toEqual([
      {
        id: "custom",
        name: "自定义",
        kind: "Custom",
        command: "",
        args: [],
        env: {},
      },
    ]);
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
    ]) {
      expect(ids).not.toContain(runtime);
    }
  });
});
