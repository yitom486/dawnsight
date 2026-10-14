import { Checkbox } from "@dawnsight/ui/checkbox";
import { Input } from "@dawnsight/ui/input";
import { Label } from "@dawnsight/ui/label";
import { NativeSelect, NativeSelectOption } from "@dawnsight/ui/native-select";
import { cn } from "@dawnsight/ui/utils";

import type { AcpStatus, PermissionMode } from "../types";
import { useAgentModelControls } from "../useAgentModelControls";
import { useCursorConfigControls } from "../useCursorConfigControls";
import {
  currentBooleanValue,
  currentSelectValue,
} from "@dawnsight/chat-ui/modelConfig";
import type { SessionConfigOption } from "@dawnsight/chat-ui/types";

const compactSelectClassName =
  "max-w-[9.5rem] [&_[data-slot=native-select]]:h-7 [&_[data-slot=native-select]]:truncate [&_[data-slot=native-select]]:bg-background [&_[data-slot=native-select]]:px-2 [&_[data-slot=native-select]]:text-[length:var(--text-ui-label)] [&_[data-slot=native-select]]:focus-visible:ring-1";

/**
 * 参数化 Agent（cursor）的一个 select 维度。值绑定 agent 下发的 current，
 * 空位表示“不动、沿用 agent 默认”（空值从不下发，listed 门槛在 hook 里卡）。
 */
function CursorDimSelect({
  option,
  emptyLabel,
  disabled,
  onPick,
}: {
  option: SessionConfigOption;
  emptyLabel: string;
  disabled: boolean;
  onPick: (value: string) => void;
}) {
  if (option.kind.kind !== "select") return null;
  const values = option.kind.options;
  return (
    <NativeSelect
      size="sm"
      className={compactSelectClassName}
      value={currentSelectValue(option)}
      disabled={disabled}
      aria-label={emptyLabel}
      title={option.description ?? option.name}
      onChange={(e) => {
        const next = e.target.value;
        if (!next) return;
        onPick(next);
      }}
    >
      <NativeSelectOption value="">{emptyLabel}</NativeSelectOption>
      {values.map((item) => (
        <NativeSelectOption key={item.value} value={item.value} title={item.description ?? undefined}>
          {item.name}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

type Props = {
  status: AcpStatus | undefined;
  busy?: boolean;
  sessionConnected?: boolean;
};

/**
 * Composer 下方的模型/权限/参数化配置行（原 ChatComposerBar 内联集群，
 * 新旧 composer 共用同一份，行为与文案保持一致）。
 */
export function ComposerModelControls({ status, busy, sessionConnected }: Props) {
  const {
    permissionMode,
    modelId,
    reasoningEffort,
    modelOptions,
    reasoningOptions,
    controlsDisabled,
    controlError,
    staleModelNotice,
    hasModelOptions,
    hasReasoningOptions,
    patchSettings,
    applyModelSelection,
  } = useAgentModelControls({
    status,
    busy,
    sessionConnected,
  });
  const cursor = useCursorConfigControls({
    status,
    busy,
    sessionConnected,
  });

  return (
    <>
      <NativeSelect
        size="sm"
        className={cn(compactSelectClassName, "max-w-[7.5rem]")}
        value={permissionMode}
        disabled={controlsDisabled}
        aria-label="权限模式"
        onChange={(e) =>
          patchSettings({
            permissionMode: e.target.value as PermissionMode,
          })
        }
      >
        <NativeSelectOption value="auto">自动批准</NativeSelectOption>
        <NativeSelectOption value="ask">每次询问</NativeSelectOption>
      </NativeSelect>

      {cursor.hasCursorDims ? (
        <>
          {cursor.dims.mode ? (
            <CursorDimSelect
              option={cursor.dims.mode}
              emptyLabel="模式"
              disabled={cursor.controlsDisabled}
              onPick={(value) =>
                void cursor.applyConfigOption(cursor.dims.mode?.id ?? "", value)
              }
            />
          ) : null}
          {cursor.dims.model ? (
            <CursorDimSelect
              option={cursor.dims.model}
              emptyLabel="模型"
              disabled={cursor.controlsDisabled}
              onPick={(value) =>
                void cursor.applyConfigOption(cursor.dims.model?.id ?? "", value)
              }
            />
          ) : null}
          {cursor.dims.effort ? (
            <CursorDimSelect
              option={cursor.dims.effort}
              emptyLabel="思考"
              disabled={cursor.controlsDisabled}
              onPick={(value) =>
                void cursor.applyConfigOption(cursor.dims.effort?.id ?? "", value)
              }
            />
          ) : null}
          {cursor.dims.context ? (
            <CursorDimSelect
              option={cursor.dims.context}
              emptyLabel="上下文"
              disabled={cursor.controlsDisabled}
              onPick={(value) =>
                void cursor.applyConfigOption(cursor.dims.context?.id ?? "", value)
              }
            />
          ) : null}
          {cursor.dims.fastToggle &&
          cursor.dims.fastToggle.kind.kind === "boolean" ? (
            <Label
              className="flex shrink-0 cursor-pointer items-center gap-1 px-1 text-[length:var(--text-ui-label)] text-muted-foreground hover:text-foreground"
              title={cursor.dims.fastToggle.description ?? "Fast 模式"}
            >
              <Checkbox
                checked={currentBooleanValue(cursor.dims.fastToggle)}
                disabled={cursor.controlsDisabled}
                aria-label="Fast"
                onCheckedChange={(checked) => {
                  const id = cursor.dims.fastToggle?.id ?? "";
                  void cursor.applyConfigOption(
                    id,
                    checked === true ? "true" : "false",
                  );
                }}
              />
              Fast
            </Label>
          ) : null}
          {cursor.dims.fastSelect ? (
            <CursorDimSelect
              option={cursor.dims.fastSelect}
              emptyLabel={cursor.dims.fastSelect.name || "更多设置"}
              disabled={cursor.controlsDisabled}
              onPick={(value) =>
                void cursor.applyConfigOption(
                  cursor.dims.fastSelect?.id ?? "",
                  value,
                )
              }
            />
          ) : null}
        </>
      ) : (
        <>
          {hasModelOptions ? (
            <NativeSelect
              size="sm"
              className={compactSelectClassName}
              value={modelId}
              disabled={controlsDisabled}
              aria-label="模型"
              onChange={(e) => {
                void applyModelSelection({ modelId: e.target.value });
              }}
            >
              <NativeSelectOption value="">Agent 默认</NativeSelectOption>
              {modelOptions.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ) : (
            <Input
              className="h-7 min-w-[7rem] max-w-[9.5rem] rounded-md px-2 text-[length:var(--text-ui-label)]"
              value={modelId}
              disabled={controlsDisabled}
              placeholder="模型 ID"
              aria-label="模型 ID"
              onChange={(e) => patchSettings({ modelId: e.target.value })}
              onBlur={() => {
                if (modelId.trim()) {
                  void applyModelSelection({ modelId });
                }
              }}
            />
          )}

          {hasReasoningOptions ? (
            <NativeSelect
              size="sm"
              className={compactSelectClassName}
              value={reasoningEffort}
              disabled={controlsDisabled}
              aria-label="思考程度"
              onChange={(e) => {
                void applyModelSelection({ reasoningEffort: e.target.value });
              }}
            >
              <NativeSelectOption value="">默认</NativeSelectOption>
              {reasoningOptions.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ) : null}
        </>
      )}

      {controlError ?? cursor.controlError ? (
        <p className="mt-1 w-full text-[length:var(--text-ui-label)] leading-relaxed text-destructive">
          {controlError ?? cursor.controlError}
        </p>
      ) : cursor.applying ? (
        <p className="mt-1 w-full text-[length:var(--text-ui-label)] leading-relaxed text-muted-foreground">
          正在应用 Agent 配置…（cursor 切换模型需要几秒，请稍候）
        </p>
      ) : staleModelNotice ? (
        <p className="mt-1 w-full break-words text-[length:var(--text-ui-label)] leading-relaxed text-muted-foreground">
          {staleModelNotice}
        </p>
      ) : null}
    </>
  );
}
