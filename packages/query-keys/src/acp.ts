export const acpModelCatalogKey = (profileId: string, launchRevision: string, modelId = "") =>
  ["acp-model-catalog", profileId, launchRevision, modelId] as const;
