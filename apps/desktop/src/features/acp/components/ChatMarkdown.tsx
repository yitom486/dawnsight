import { useDeferredValue } from "react";
import { Streamdown, type Components } from "streamdown";
import { math } from "@streamdown/math";
import { cjk } from "@streamdown/cjk";
import { defaultUrlTransform } from "streamdown";

import { enhanceCitationChildren } from "@/features/evidence/EvidenceLink";
import { cn } from "@dawnsight/ui/utils";

import "katex/dist/katex.min.css";
import "streamdown/styles.css";

type Props = {
  content: string;
  className?: string;
  /**
   * Compatible streaming flag: the caller passes the real turn state.
   * Streaming turns get block-level incomplete-markdown repair + animation;
   * finished turns render in static mode (single pass, no per-block churn).
   */
  streaming?: boolean;
};

/**
 * Agent reply renderer — Streamdown (streaming GFM) + math/CJK plugins,
 * lazy Shiki highlighting, verified timestamp citations.
 *
 * Security posture (parity with the old react-markdown renderer, which had
 * no rehype-raw):
 * - `skipHtml`: raw HTML in Agent output is never executed.
 * - `urlTransform`: only http/https/mailto survive; `file:`, custom
 *   schemes and relative resource paths are stripped.
 * - No `linkSafety` modal, no fullscreen/download controls: nothing portals
 *   into document.body over the native player surface.
 * - All control labels are Chinese via `translations`.
 */

// Static plugin set: math (existing capability) + CJK emphasis repair.
// Never re-add remark-gfm/remark-math/rehype-katex here — Streamdown ships
// GFM by default and the math plugin owns the math pipeline.
// NOTE: @streamdown/code (Shiki) deliberately not wired: it emits every
// bundled grammar/theme as dist chunks (~10MB installer bloat) for a case
// this product almost never hits (prose/tables/math answers; the old
// renderer had no highlighting either). Code blocks still render plain with
// a Chinese copy button from core controls. Revisit via createCodePlugin +
// lazy import only with a real highlighting demand (see evidence file).
// Character separation also gives Chinese prose an incremental fade. No artificial
// typing queue: bound the cascade so fast streams stay visually caught up.
const STREAM_ANIMATION = {
  animation: "fadeIn",
  duration: 150,
  sep: "char",
  stagger: 8,
  maxBacklogMs: 120,
} as const;

const BASE_PLUGINS = { math, cjk } as const;

// Module-level singletons: stable identity across renders/turns so Streamdown
// never re-parses because a config object changed.
const STREAMDOWN_CONTROLS = {
  table: { copy: true, download: false, fullscreen: false },
  code: { copy: true, download: false },
  mermaid: false,
  image: false,
} as const;

const STREAMDOWN_TRANSLATIONS = {
  close: "关闭",
  copied: "已复制",
  copyCode: "复制代码",
  copyLink: "复制链接",
  copyTable: "复制表格",
  copyTableAsCsv: "复制为 CSV",
  copyTableAsMarkdown: "复制为 Markdown",
  copyTableAsTsv: "复制为 TSV",
  downloadDiagram: "下载图表",
  downloadDiagramAsMmd: "下载为 MMD",
  downloadDiagramAsPng: "下载为 PNG",
  downloadDiagramAsSvg: "下载为 SVG",
  downloadFile: "下载文件",
  downloadImage: "下载图片",
  downloadTable: "下载表格",
  downloadTableAsCsv: "下载 CSV",
  downloadTableAsMarkdown: "下载 Markdown",
  exitFullscreen: "退出全屏",
  externalLinkWarning: "外部链接提醒",
  imageNotAvailable: "图片不可用",
  mermaidFormatMmd: "MMD 格式",
  mermaidFormatPng: "PNG 格式",
  mermaidFormatSvg: "SVG 格式",
  openExternalLink: "打开外部链接",
  openLink: "打开链接",
  resetView: "重置视图",
  tableFormatCsv: "CSV 格式",
  tableFormatMarkdown: "Markdown 格式",
  tableFormatTsv: "TSV 格式",
  viewFullscreen: "全屏查看",
  zoomIn: "放大",
  zoomOut: "缩小",
} as const;

function chatUrlTransform(
  url: string,
  key: string,
  node: Parameters<typeof defaultUrlTransform>[2],
): string | null | undefined {
  const trimmed = url.trim();
  // Allow only web/mail links. Everything else (file:, custom schemes,
  // bare relative resource paths) loses its URL instead of becoming a
  // clickable/native-loading surface.
  if (/^(https?:|mailto:)/i.test(trimmed)) {
    return defaultUrlTransform(url, key, node);
  }
  return "";
}

const STREAMDOWN_COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="font-medium text-info underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  ),
  // Citations inside code/pre/link never linkify (see enhanceCitationChildren).
  p: ({ children, ...props }) => (
    <p {...props}>{enhanceCitationChildren(children)}</p>
  ),
  li: ({ children, ...props }) => (
    <li {...props}>{enhanceCitationChildren(children)}</li>
  ),
  td: ({ children, ...props }) => (
    <td {...props}>{enhanceCitationChildren(children)}</td>
  ),
  th: ({ children, ...props }) => (
    <th {...props}>{enhanceCitationChildren(children)}</th>
  ),
};

export function ChatMarkdown({ content, className, streaming = false }: Props) {
  const deferredContent = useDeferredValue(content);
  // Let input/scroll updates win while streaming; completion always renders all text.
  const renderedContent = streaming ? deferredContent : content;
  return (
    <div className={cn("chat-markdown", className)}>
      <Streamdown
        mode={streaming ? "streaming" : "static"}
        isAnimating={streaming}
        animated={streaming ? STREAM_ANIMATION : false}
        plugins={BASE_PLUGINS}
        components={STREAMDOWN_COMPONENTS}
        controls={STREAMDOWN_CONTROLS}
        translations={STREAMDOWN_TRANSLATIONS}
        skipHtml
        urlTransform={chatUrlTransform}
      >
        {renderedContent}
      </Streamdown>
    </div>
  );
}
