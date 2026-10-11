import { describe, expect, it } from "vitest";

import type { AssistantBlock } from "./assistantBlocks";
import { blocksToPlainText } from "./assistantBlocksText";

describe("blocksToPlainText", () => {
  it("exports narrative markdown as-is", () => {
    const blocks: AssistantBlock[] = [
      { kind: "narrative", id: "n-a", format: "markdown", markdown: "这是用户看到的结论。" },
    ];
    expect(blocksToPlainText(blocks)).toBe("这是用户看到的结论。");
  });

  it("exports quotes, timelines and cards as readable text without ids or actions", () => {
    const blocks: AssistantBlock[] = [
      {
        kind: "transcript-quote",
        id: "q-1",
        quote: "总有一天真相会走到光下。",
        speaker: "小夭",
        anchor: { startMs: 754_000 },
      },
      {
        kind: "timeline",
        id: "t-1",
        title: "时间线",
        items: [
          { id: "t-1-0", atMs: 0, title: "开始", summary: "开场白" },
        ],
      },
      {
        kind: "question-card",
        id: "qq-1",
        question: "谁拿走了玉佩？",
        options: [],
      },
    ];
    const text = blocksToPlainText(blocks);
    expect(text).toContain("总有一天真相会走到光下。");
    expect(text).toContain("时间线");
    expect(text).toContain("0:00 开始");
    expect(text).toContain("开场白");
    expect(text).toContain("谁拿走了玉佩？");
    // 机器 id、动作 label 不进剪贴板。
    expect(text).not.toContain("q-1");
    expect(text).not.toContain("t-1-0");
  });

  it("exports structured results without the JSON envelope", () => {
    const blocks: AssistantBlock[] = [
      {
        kind: "structured-result",
        id: "r-1",
        contract: "plot_summary.v1",
        title: "剧情梳理",
        metadata: [],
        summary: "两人在争执后和解。",
        sections: [
          { id: "s-1", title: "证据", paragraphs: [], items: ["字幕：一起回去。"] },
        ],
        spoilerLevel: "none",
        actions: [],
      },
    ];
    const text = blocksToPlainText(blocks);
    expect(text).toContain("剧情梳理");
    expect(text).toContain("两人在争执后和解。");
    expect(text).toContain("字幕：一起回去。");
    expect(text).not.toContain("plot_summary.v1");
    expect(text).not.toContain('"blocks"');
  });

  it("returns empty text for empty input", () => {
    expect(blocksToPlainText([])).toBe("");
  });
});
