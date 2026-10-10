import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAcpProfilesStore } from "./acpProfilesStore";
import { useAcpSettingsStore } from "./acpSettingsStore";
import type { ModelSelection } from "./modelConfig";

type ChapterAgentSettings = {
  profileId: string | null;
  selections: Record<string, ModelSelection>;
  defaultsInitializedByProfile: Record<string, boolean>;
  markDefaultsInitialized: (profileId: string) => void;
  initialize: () => void;
  selectProfile: (id: string) => void;
  patchSelection: (patch: Partial<ModelSelection>) => void;
};

/** Separate chapter preferences. Only the initial migration copies chat defaults. */
export const useChapterAgentSettingsStore = create<ChapterAgentSettings>()(persist((set, get) => ({
  profileId: null,
  selections: {},
  defaultsInitializedByProfile: {},
  markDefaultsInitialized: (profileId) => set((state) => ({ defaultsInitializedByProfile: { ...state.defaultsInitializedByProfile, [profileId]: true } })),
  initialize: () => {
    if (get().profileId) return;
    const profileId = useAcpProfilesStore.getState().activeProfileId;
    const chat = useAcpSettingsStore.getState();
    set({ profileId, selections: { [profileId]: { modelId: chat.modelId ?? "", reasoningEffort: chat.reasoningEffort ?? "" } } });
  },
  selectProfile: (id) => { if (id.trim()) set({ profileId: id.trim() }); },
  patchSelection: (patch) => {
    get().initialize();
    set((state) => {
      const id = state.profileId!;
      return { selections: { ...state.selections, [id]: { ...(state.selections[id] ?? { modelId: "", reasoningEffort: "" }), ...patch } } };
    });
  },
}), { name: "dawnsight-chapter-agent-settings", partialize: (state) => ({ profileId: state.profileId, selections: state.selections, defaultsInitializedByProfile: state.defaultsInitializedByProfile }) }));
