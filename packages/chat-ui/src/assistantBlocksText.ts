import type { AssistantBlock } from "./assistantBlocks";

/**
 * 把已验证的 AssistantBlock 还原为可复制的纯文本/Markdown。
 *
 * 输入只能是归一化后的闭世界 union（RichBlockRenderer 展示的同一批数据），
 * 绝不碰原始工具 detail 或 JSON 信封。卡片只导出其业务文字：
 * 标题/正文/条目/引用原文；跳转、追问、重试一类动作无文字可拷，从略。
 * 时间戳锚点转为 m:ss 文字，落款不带机器 id。
 */
export function blocksToPlainText(blocks: readonly AssistantBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    const text = blockToPlainText(block).trim();
    if (text) parts.push(text);
  }
  return parts.join("\n\n");
}

function blockToPlainText(block: AssistantBlock): string {
  switch (block.kind) {
    case "narrative":
      return block.markdown;
    case "transcript-quote":
      return block.quote;
    case "timeline": {
      const lines = block.items.map((item) => {
        const head = `${formatTime(item.atMs)} ${item.title}`;
        return item.summary ? `${head}\n${item.summary}` : head;
      });
      return [block.title, ...lines].join("\n");
    }
    case "structured-result": {
      const lines: string[] = [block.title];
      if (block.summary) lines.push(block.summary);
      for (const section of block.sections) {
        lines.push(section.title);
        lines.push(...section.paragraphs, ...section.items);
      }
      return lines.join("\n");
    }
    case "watch-feed-card": {
      const lines: string[] = [block.title];
      if (block.summary) lines.push(block.summary);
      lines.push(...block.bullets);
      return lines.join("\n");
    }
    case "question-card":
      return [block.question, ...block.options.map((option) => option.label)].join(
        "\n",
      );
    case "agent-task-status":
      return block.message ? `${block.title}\n${block.message}` : block.title;
    case "action-chip":
      return block.label;
  }
}

function formatTime(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "时间轴";
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
