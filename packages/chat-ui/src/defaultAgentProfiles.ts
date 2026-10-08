import type { AgentProfileInput, AgentProfilesHint } from "./types";

// Float-by-policy: `bunx <pkg>` reuses whatever stale copy sits in the bun
// cache (seen resolving to 1.7.0 with a 5.6-era model catalog while npm
// latest serves 6.x display names), and bare names only re-resolve about
// once a day. The explicit `@latest` suffix forces registry resolution on
// every cold launch instead. Never ship a bare or version-pinned spec here.
export const CODEX_ACP_PACKAGE = "@agentclientprotocol/codex-acp@latest";
// Shape shipped before the float; existing persisted profiles carry these.
// Merge logic upgrades default-shape copies to the spec above (backend keeps
// recognizing every same-package shape so old copies never lose presets).
export const LEGACY_CODEX_ACP_PACKAGE = "@agentclientprotocol/codex-acp";

/** Matches the default-shape spec in any version (`@latest`, explicit pins,
 *  or the legacy bare name). User args that merely track the same package
 *  upgrade to the current default; anything else is customization and stays.
 */
export function isDefaultCodexPackageSpec(arg: unknown): boolean {
  if (arg === LEGACY_CODEX_ACP_PACKAGE) return true;
  const base = `${LEGACY_CODEX_ACP_PACKAGE}@`;
  return (
    typeof arg === "string" &&
    arg.startsWith(base) &&
    arg.length > base.length
  );
}

/**
 * Default seed: only the empty custom template. The agent lineup itself is
 * owned by `@yitom/acp-client` (runtime registry) and arrives via
 * `acp_status` → `syncEngineProfiles`; nothing runtime-specific is
 * hardcoded here anymore. User customs (incl. former entries like a local
 * OpenCode v2 binary) live in the persisted store, never in this file.
 */
export function defaultAgentProfiles(): AgentProfileInput[] {
  return [
    {
      id: "custom",
      name: "自定义",
      kind: "Custom",
      command: "",
      args: [],
      env: {},
    },
  ];
}

export function defaultProfilesHint(): AgentProfilesHint {
  return {
    activeProfileId: "codex",
    profiles: defaultAgentProfiles(),
  };
}

export function normalizeProfileInput(profile: AgentProfileInput): AgentProfileInput {
  return {
    ...profile,
    args: profile.args ?? [],
    env: profile.env ?? {},
  };
}

export function profilesHintFromStore(
  activeProfileId: string,
  profiles: AgentProfileInput[] | undefined,
): AgentProfilesHint {
  const safeProfiles =
    Array.isArray(profiles) && profiles.length > 0
      ? profiles
      : defaultAgentProfiles();
  return {
    activeProfileId: activeProfileId || "codex",
    profiles: safeProfiles.map(normalizeProfileInput),
  };
}
