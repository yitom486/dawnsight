import { Field as SharedField, FieldContent, FieldDescription, FieldLabel } from "@dawnsight/ui/field";
import { Switch } from "@dawnsight/ui/switch";
import { QualitySelect } from "@/features/player/components/QualitySelect";
import { usePlayerStore } from "@/features/player";
import { useUiStore } from "@/features/player/uiStore";

/**
 * Pure display mapping for the media identity line. Remote sources never
 * surface the raw URL (query/fragment/userinfo signatures stay out of text,
 * tooltips and ARIA); illegal URLs fall back to a fixed label.
 */
function describeMediaIdentity(
  currentFile: string | null,
  sourceKind: string | null | undefined,
): { label: string; remote: boolean } {
  if (!currentFile) return { label: "未打开", remote: false };
  const remote =
    sourceKind === "remote" || /^https?:/i.test(currentFile.trimStart());
  if (!remote) return { label: currentFile, remote: false };
  try {
    const url = new URL(currentFile);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { label: "在线视频", remote: true };
    }
    const host = url.hostname.replace(/^www\./, "");
    return { label: host || "在线视频", remote: true };
  } catch {
    return { label: "在线视频", remote: true };
  }
}

export function PlaybackInterfaceSettingsPanel() {
  const currentFile = usePlayerStore((state) => state.currentFile);
  const sourceKind = usePlayerStore((state) => state.sourceKind);
  const fullscreen = useUiStore((state) => state.fullscreen);
  const setFullscreen = useUiStore((state) => state.setFullscreen);
  const identity = describeMediaIdentity(currentFile, sourceKind);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        调整全屏播放，并查看当前媒体的播放选项。
      </p>
      <SharedField
        orientation="horizontal"
        className="items-center justify-between gap-3 rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-sm"
      >
        <FieldContent className="gap-0">
          <FieldLabel htmlFor="playback-fullscreen" className="font-medium">
            全屏播放
          </FieldLabel>
          <FieldDescription className="mt-0.5 text-xs">
            将播放窗口切换为全屏。
          </FieldDescription>
        </FieldContent>
        <Switch
          className="min-h-7 data-[size=default]:w-12 [&_[data-slot=switch-thumb]]:size-6"
          id="playback-fullscreen"
          checked={fullscreen}
          onCheckedChange={(checked) => void setFullscreen(checked)}
        />
      </SharedField>
      {sourceKind === "remote" ? (
        <div
          role="group"
          aria-label="在线视频清晰度"
          className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-sm"
        >
          <span>
            <span className="block font-medium">在线视频清晰度</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              选择当前视频可用的清晰度。
            </span>
          </span>
          <QualitySelect />
        </div>
      ) : null}
      <p className="break-words text-xs text-muted-foreground">
        当前媒体：{identity.label}
      </p>
    </div>
  );
}
