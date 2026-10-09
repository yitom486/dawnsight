import { create } from "zustand";

import type { AcpSessionModelOptions } from "./types";

type ModelCatalogStore = {
  /** Last-seen advertised options per profile. Session-only memory. */
  byProfile: Record<string, AcpSessionModelOptions>;
  rememberOptions: (profileId: string, options: AcpSessionModelOptions) => void;
  resetModelCatalog: () => void;
};

/**
 * Shared per-runtime model catalogue memory.
 *
 * The only working list source is a live session advertisement, which arrives
 * sporadically (only the connected profile, only while connected). Every
 * surface that shows model/effort selectors (chat composer, settings, chapter
 * panel) reads through `useAgentModelControls`, which consults this store so
 * a previously-connected runtime keeps its lists across switches and
 * reconnects — dynamic binding from real data, never fabricated.
 *
 * Deliberately NOT persisted: a restart must re-verify against the agent
 * rather than serve a frozen list.
 */
export const useModelCatalogStore = create<ModelCatalogStore>()((set) => ({
  byProfile: {},
  rememberOptions: (profileId, options) =>
    set((state) => {
      const id = profileId.trim();
      if (!id || state.byProfile[id] === options) return state;
      return { byProfile: { ...state.byProfile, [id]: options } };
    }),
  resetModelCatalog: () => set({ byProfile: {} }),
}));
