import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAcpSettingsStore } from "./acpSettingsStore";

import {
  defaultAgentProfiles,
  normalizeProfileInput,
  profilesHintFromStore,
} from "./defaultAgentProfiles";
import type {
  AgentProfileInput,
  AgentProfileStatus,
  AgentProfilesHint,
} from "./types";

/**
 * Reconcile persisted state with the engine-owned lineup. Runs on every
 * rehydration: the app keeps no agent matrix of its own, so any persisted
 * lineup (builtin-era copies, hand-added customs, stale duplicates) is
 * dropped outright. The next `acp_status` poll repopulates from the engine
 * registry via `syncEngineProfiles`. Only the active key is carried over,
 * and only when it still names a synced entry (validated on sync).
 */
export function mergeProfiles(
  persisted: unknown,
  fallback: AgentProfileInput[],
): AgentProfileInput[] {
  void persisted;
  return [...fallback];
}

type AcpProfilesStore = {
  activeProfileId: string;
  profiles: AgentProfileInput[];
  /** Bare setter: only flips the key. Prefer switchActiveProfileId for UI switches. */
  setActiveProfileId: (id: string) => void;
  /**
   * 切换世界 + 清瞬态的唯一入口（对标隔壁 setSelectedRuntimeId）。
   * 本 store 只做换键：同 id 与空白 id 直接 no-op；瞬态清理
   * （promptQueue/drainLock、pendingPermission、progress + seal、
   * proposal 记账、attachments、模型选择）由调用方 AcpPanel
   * handleSwitchProfile 执行。savedSessions hint 与 chatRestore
   * 快照按 profile 分键保留，这里绝不删任何键。
   */
  switchActiveProfileId: (id: string) => void;
  profilesHint: () => AgentProfilesHint;
  /**
   * Adopt the engine runtime registry (`acp_status` profiles) as the whole
   * lineup, replacing whatever was there. The engine is the only lineup
   * source: no custom entries are preserved, merged, or reordered — stale
   * app-side copies can never resurface as duplicate rows. No-op when the
   * lineup is empty (engine down carries no information) or nothing changed
   * (status polls stay quiet).
   */
  syncEngineProfiles: (engine: AgentProfileStatus[]) => void;
};

/** Agent spawn profiles; persisted in WebView storage, passed to Rust on invoke. */
export const useAcpProfilesStore = create<AcpProfilesStore>()(
  persist(
    (set, get) => ({
      activeProfileId: "codex",
      profiles: defaultAgentProfiles(),
      setActiveProfileId: (activeProfileId) => set({ activeProfileId }),
      switchActiveProfileId: (id) => {
        const next = id.trim();
        if (!next) return;
        if (next !== get().activeProfileId) {
          useAcpSettingsStore.getState().selectModelProfile(get().activeProfileId, next);
        }
        set((state) =>
          state.activeProfileId === next ? state : { activeProfileId: next },
        );
      },
      profilesHint: () =>
        profilesHintFromStore(get().activeProfileId, get().profiles),
      syncEngineProfiles: (engine) => {
        // An empty lineup carries no information (engine down, error
        // payload): never destroy local state on it.
        if (!Array.isArray(engine) || engine.length === 0) return;
        set((state) => {
          const next: AgentProfileInput[] = engine
            .filter((item) => item.id)
            .map((item) =>
              normalizeProfileInput({
                id: item.id,
                name: item.name,
                kind: item.kind,
                command: item.command ?? "",
                args: item.args ?? [],
                env: item.env ?? {},
              }),
            );
          const finalProfiles = next.length > 0 ? next : state.profiles;
          const active = finalProfiles.some(
            (item) => item.id === state.activeProfileId,
          )
            ? state.activeProfileId
            : (finalProfiles[0]?.id ?? state.activeProfileId);
          if (
            active === state.activeProfileId &&
            JSON.stringify(finalProfiles) === JSON.stringify(state.profiles)
          ) {
            return state;
          }
          return { profiles: finalProfiles, activeProfileId: active };
        });
      },
    }),
    {
      name: "dawnsight-acp-profiles",
      partialize: (state) => ({
        activeProfileId: state.activeProfileId,
        profiles: state.profiles,
      }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<
          Pick<AcpProfilesStore, "activeProfileId" | "profiles">
        >;
        const profiles = mergeProfiles(saved.profiles, current.profiles);
        const active = saved.activeProfileId ?? current.activeProfileId;
        return {
          ...current,
          activeProfileId: profiles.some((item) => item.id === active)
            ? active
            : current.activeProfileId,
          profiles,
        };
      },
    },
  ),
);
