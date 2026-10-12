import { describe, expect, it } from "vitest";

import {
  isSettingsWorkspace,
  shouldRenderPlayerWorkspace,
  WORKSPACE_RAIL_ITEMS,
} from "./App";

describe("App workspace layout", () => {
  // 用户授权的新职责合同：在线媒体阅读在工作区；打开链接/下载/解析/
  // 登录配置仍在设置。在线资源（设置分类名）不进顶层导航。
  it("mounts online media in the rail while resolver work stays in Settings", () => {
    expect(WORKSPACE_RAIL_ITEMS.map((item) => item.id)).toEqual([
      "playlist",
      "transcript",
      "notes",
      "chapters",
      "library",
      "online",
      "settings",
    ]);
    expect(WORKSPACE_RAIL_ITEMS.map((item) => item.label)).toContain(
      "在线媒体",
    );
    expect(WORKSPACE_RAIL_ITEMS.map((item) => item.label)).not.toContain(
      "在线资源",
    );
  });

  it("makes Settings replace the player only outside fullscreen", () => {
    expect(isSettingsWorkspace(false, "settings")).toBe(true);
    expect(shouldRenderPlayerWorkspace(false, "settings")).toBe(false);
    expect(isSettingsWorkspace(true, "settings")).toBe(false);
    expect(shouldRenderPlayerWorkspace(true, "settings")).toBe(true);
    expect(shouldRenderPlayerWorkspace(false, "transcript")).toBe(true);
  });
});
