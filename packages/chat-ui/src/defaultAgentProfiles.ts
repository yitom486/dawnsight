import type { AgentProfileInput, AgentProfilesHint } from "./types";

/**
 * Static seed: empty. The agent lineup is owned exclusively by the
 * `@yitom/acp-client` engine runtime registry and arrives via `acp_status`
 * → `syncEngineProfiles`, which adopts it wholesale. The app keeps no agent
 * matrix, no custom template, no launch-spec migration: it never manages ACP
 * details. Until the first status poll the lineup is simply empty.
 */
export function defaultAgentProfiles(): AgentProfileInput[] {
  return [];
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
  const safeProfiles = Array.isArray(profiles) ? profiles : defaultAgentProfiles();
  return {
    activeProfileId: activeProfileId || "codex",
    profiles: safeProfiles.map(normalizeProfileInput),
  };
}
