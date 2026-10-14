import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { acpModelCatalogKey } from "@dawnsight/query-keys";
import { errorMessage } from "@/lib/format";
import { useAcpProfilesStore } from "@dawnsight/chat-ui/acpProfilesStore";
import { useAcpSettingsStore } from "@dawnsight/chat-ui/acpSettingsStore";
import { useChapterAgentSettingsStore } from "@dawnsight/chat-ui/chapterAgentSettingsStore";
import { useModelCatalogStore } from "@dawnsight/chat-ui/modelCatalogStore";
import { acpSetSessionModel, discoverAcpModels } from "./api";
import { profilesHintFromStore } from "@dawnsight/chat-ui/defaultAgentProfiles";
import { buildModelOptions, buildReasoningOptions, mergeModelDefaults, selectedOptionLabel } from "@dawnsight/chat-ui/modelConfig";
import type { ModelSelection } from "@dawnsight/chat-ui/modelConfig";
import type { AcpClientSettings, AcpStatus } from "./types";

type Options = { status: AcpStatus | undefined; busy?: boolean; sessionConnected?: boolean; purpose?: "chat" | "chapter" };

// Cache identity includes launch/env changes, without putting credential values in query keys.
function launchRevision(value: unknown): string {
  const input = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}

/** Same directory/controller implementation; each purpose owns its selection and session. */
export function useAgentModelControls({ status, busy, sessionConnected, purpose = "chat" }: Options) {
  const queryClient = useQueryClient();
  const chatProfileId = useAcpProfilesStore((s) => s.activeProfileId);
  const profiles = useAcpProfilesStore((s) => s.profiles);
  const chapterProfileId = useChapterAgentSettingsStore((s) => s.profileId);
  const chapterSelections = useChapterAgentSettingsStore((s) => s.selections);
  const activeProfileId = purpose === "chapter" ? chapterProfileId ?? chatProfileId : chatProfileId;
  const permissionMode = useAcpSettingsStore((s) => s.permissionMode);
  const chatModelId = useAcpSettingsStore((s) => s.modelId ?? "");
  const chatEffort = useAcpSettingsStore((s) => s.reasoningEffort ?? "");
  const patchChat = useAcpSettingsStore((s) => s.patchSettings);
  const patchChapter = useChapterAgentSettingsStore((s) => s.patchSelection);
  const modelId = purpose === "chapter" ? chapterSelections[activeProfileId]?.modelId ?? "" : chatModelId;
  const reasoningEffort = purpose === "chapter" ? chapterSelections[activeProfileId]?.reasoningEffort ?? "" : chatEffort;
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [staleModelNotice, setStaleModelNotice] = useState<string | null>(null);
  const patchSettings = useCallback((patch: Partial<AcpClientSettings>) => {
    if (purpose === "chat") {
      if (patch.modelId != null || patch.reasoningEffort != null) useAcpSettingsStore.getState().markModelDefaultsInitialized(activeProfileId);
      patchChat(patch); return;
    }
    const selection: Partial<ModelSelection> = {};
    if (patch.modelId != null) selection.modelId = patch.modelId;
    if (patch.reasoningEffort != null) selection.reasoningEffort = patch.reasoningEffort;
    if (Object.keys(selection).length) useChapterAgentSettingsStore.getState().markDefaultsInitialized(activeProfileId);
    patchChapter(selection);
  }, [purpose, activeProfileId, patchChat, patchChapter]);
  useEffect(() => { if (purpose === "chapter") useChapterAgentSettingsStore.getState().initialize(); }, [purpose]);
  useEffect(() => { setSelectionError(null); setStaleModelNotice(null); }, [activeProfileId]);

  const selectedProfile = profiles.find((profile) => profile.id === activeProfileId);
  const revision = launchRevision(selectedProfile ?? activeProfileId);
  const liveOptions = status?.activeProfileId === activeProfileId
    ? status.sessionModelOptions ?? null : null;
  const liveMatchesModel = Boolean(liveOptions && (!modelId || liveOptions.currentModelId === modelId));
  const rememberedOptions = useModelCatalogStore((s) =>
    !s.revisionByProfile[activeProfileId] || s.revisionByProfile[activeProfileId] === revision
      ? s.byProfile[activeProfileId] ?? null : null);
  const catalogByProfile = useModelCatalogStore((s) => s.byProfile);
  const directory = useQuery({
    queryKey: acpModelCatalogKey(activeProfileId, revision, modelId),
    queryFn: async () => {
      const result = await discoverAcpModels(profilesHintFromStore(activeProfileId, profiles), activeProfileId, modelId);
      if (!result?.connected) throw new Error(result?.message || "无法获取可用模型，请重试");
      if (!modelId && result.options.currentModelId) {
        queryClient.setQueryData(acpModelCatalogKey(activeProfileId, revision, result.options.currentModelId), result.options);
      }
      return result.options;
    },
    enabled: Boolean(status?.available && status.activeProfileId === activeProfileId && !busy
      && !liveMatchesModel && !(purpose === "chat" && sessionConnected && liveOptions)),
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
  useEffect(() => {
    if (liveOptions) {
      useModelCatalogStore.getState().rememberOptions(activeProfileId, liveOptions, revision);
      if (liveOptions.currentModelId) queryClient.setQueryData(acpModelCatalogKey(activeProfileId, revision, liveOptions.currentModelId), liveOptions);
    }
  }, [activeProfileId, liveOptions, revision, queryClient]);
  useEffect(() => {
    if (directory.data) useModelCatalogStore.getState().rememberOptions(activeProfileId, directory.data, revision);
  }, [activeProfileId, directory.data, revision]);
  const optionSource = directory.data ?? (liveMatchesModel ? liveOptions : null)
    ?? (rememberedOptions && (!modelId || rememberedOptions.currentModelId === modelId) ? rememberedOptions : null);
  const modelSource = optionSource ?? liveOptions ?? rememberedOptions;
  useEffect(() => {
    if (!optionSource) return;
    const initialized = purpose === "chapter"
      ? useChapterAgentSettingsStore.getState().defaultsInitializedByProfile[activeProfileId]
      : useAcpSettingsStore.getState().modelDefaultsInitializedByProfile[activeProfileId];
    if (initialized) return;
    const saved = purpose === "chapter"
      ? useChapterAgentSettingsStore.getState().selections[activeProfileId] ?? { modelId: "", reasoningEffort: "" }
      : useAcpSettingsStore.getState();
    const patch = mergeModelDefaults({ modelId: saved.modelId ?? "", reasoningEffort: saved.reasoningEffort ?? "" }, optionSource);
    if (Object.keys(patch).length) patchSettings(patch);
    if (purpose === "chapter") useChapterAgentSettingsStore.getState().markDefaultsInitialized(activeProfileId);
    else useAcpSettingsStore.getState().markModelDefaultsInitialized(activeProfileId);
  }, [activeProfileId, optionSource, purpose, patchSettings]);

  useEffect(() => {
    if (optionSource && reasoningEffort && !optionSource.reasoningEfforts.some((option) => option.value === reasoningEffort)) {
      patchSettings({ reasoningEffort: "" });
    }
  }, [optionSource, reasoningEffort, patchSettings]);

  // 已存模型必须活在新鲜列表里：切 profile/重拉目录后，已显式选过的值也
  // 要复验（首轮 merge 的 initialized 豁免不适用）。remembered 快照可能
  // 本来就旧，只能信刚拿到的 directory 数据或 live 会话广告。
  useEffect(() => {
    const validationSource = directory.data ?? liveOptions;
    if (!validationSource || !modelId) return;
    if (validationSource.models.some((option) => option.value === modelId)) {
      setStaleModelNotice(null);
      return;
    }
    patchSettings({ modelId: "", reasoningEffort: "" });
    setStaleModelNotice(`“${modelId}”已不在可用模型中，已恢复为 Agent 默认`);
  }, [activeProfileId, directory.data, liveOptions, modelId, patchSettings]);

  const modelOptions = useMemo(() => buildModelOptions(modelSource, modelId), [modelSource, modelId]);
  const reasoningOptions = useMemo(() => buildReasoningOptions(optionSource, ""), [optionSource]);
  const applyModelSelection = async (next: Partial<ModelSelection>) => {
    const changingModel = next.modelId != null && next.modelId !== modelId;
    patchSettings(changingModel ? { ...next, reasoningEffort: "" } : next);
    if (purpose !== "chat" || !sessionConnected || busy || status?.activeProfileId !== activeProfileId) return;
    try {
      setSelectionError(null);
      if (!(next.modelId || next.reasoningEffort)) return;
      // A model change may replace the effort dimension. Never send the previous model's effort.
      const result = await acpSetSessionModel({ modelId: next.modelId || null, reasoningEffort: next.reasoningEffort || null });
      if (result) queryClient.setQueryData(acpModelCatalogKey(activeProfileId, revision, next.modelId ?? modelId), result);
      await queryClient.invalidateQueries({ queryKey: ["acp-status"] });
    } catch (error) { setSelectionError(errorMessage(error)); }
  };
  return {
    activeProfileId,
    permissionMode,
    discoveredOptions: optionSource,
    discoveredOptionsByProfile: catalogByProfile,
    modelId, reasoningEffort, modelOptions, reasoningOptions,
    selectedModelLabel: selectedOptionLabel(modelOptions, modelId, "Agent 默认"),
    selectedReasoningLabel: selectedOptionLabel(reasoningOptions, reasoningEffort, "默认"),
    controlsDisabled: Boolean(busy || directory.isFetching),
    controlError: selectionError ?? (directory.error ? errorMessage(directory.error) : null),
    staleModelNotice,
    discoverBusy: directory.isFetching,
    hasModelOptions: modelOptions.length > 0,
    hasReasoningOptions: reasoningOptions.length > 0,
    patchSettings, applyModelSelection,
    discoverModels: () => directory.refetch(),
    canDiscover: Boolean(status?.available),
  };
}
