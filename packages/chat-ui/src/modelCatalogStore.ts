import { create } from "zustand";

import type { AcpSessionModelOptions } from "./types";

type ModelCatalogStore = {
  /** Last-seen advertised options per profile. Session-only memory. */
  byProfile: Record<string, AcpSessionModelOptions>;
  revisionByProfile: Record<string, string>;
  rememberOptions: (profileId: string, options: AcpSessionModelOptions, revision?: string) => void;
  resetModelCatalog: () => void;
};

/**
 * Shared per-runtime model catalogue memory.
 *
 * Options come from live session advertisements or isolated backend discovery. Every
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
  revisionByProfile: {},
  rememberOptions: (profileId, options, revision) =>
    set((state) => {
      const id = profileId.trim();
      if (!id || (state.byProfile[id] === options && state.revisionByProfile[id] === revision)) return state;
      return { byProfile: { ...state.byProfile, [id]: options }, revisionByProfile: { ...state.revisionByProfile, ...(revision ? { [id]: revision } : {}) } };
    }),
  resetModelCatalog: () => set({ byProfile: {}, revisionByProfile: {} }),
}));
