import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnlineResourceSettingsPanel } from "./OnlineResourceSettingsPanel";
import { errorMessage } from "@/lib/format";

const { invoke, pickFile } = vi.hoisted(() => ({
  invoke: vi.fn(),
  pickFile: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  Channel: class {
    onmessage: ((event: unknown) => void) | null = null;
  },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => pickFile(...args),
}));

const READY_STATUS = {
  available: true,
  cliReady: true,
  cliPath: "C:/tools/yt-dlp.exe",
  version: "2026.01.01",
  installSupported: true,
  message: "在线解析组件就绪",
};

const FILE_COOKIES = {
  mode: "file",
  browser: "chrome",
  browserProfile: null,
  filePath: "D:/Data/cookies.txt",
  message: "已导入 cookies.txt（仅本机使用）",
};

function mockBackend(overrides: Record<string, (cmd: string, args?: unknown) => Promise<unknown>> = {}) {
  vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
    if (overrides[cmd]) return overrides[cmd](cmd, args);
    if (cmd === "ytdl_status") return Promise.resolve(READY_STATUS);
    if (cmd === "ytdl_cookie_status") return Promise.resolve(FILE_COOKIES);
    if (cmd === "ytdl_list_browser_profiles") return Promise.resolve([]);
    if (cmd === "ytdl_set_cookies")
      return Promise.resolve({
        mode: "file",
        browser: "chrome",
        browserProfile: null,
        filePath: null,
        message: "已保存",
        ...((args as { config?: Record<string, unknown> } | undefined)?.config ?? {}),
      });
    return Promise.resolve(null);
  });
}

function renderPanel(onClient?: (client: QueryClient) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  onClient?.(client);
  return render(
    <QueryClientProvider client={client}>
      <OnlineResourceSettingsPanel />
    </QueryClientProvider>,
  );
}

const setCookiesCalls = () =>
  vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "ytdl_set_cookies");

beforeEach(() => {
  mockBackend();
  pickFile.mockReset();
  pickFile.mockResolvedValue(null);
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("OnlineSourceSettings presentation and wiring", () => {
  it("keeps cached profiles usable when a background refresh fails", async () => {
    let client!: QueryClient;
    let refreshFails = false;
    mockBackend({
      ytdl_cookie_status: () => Promise.resolve({ ...FILE_COOKIES, mode: "browser", filePath: null }),
      ytdl_list_browser_profiles: () => refreshFails
        ? Promise.reject(new TypeError("PRIVATE_REFRESH_FAILURE"))
        : Promise.resolve([{ id: "Default", label: "Default" }]),
    });
    renderPanel((value) => { client = value; });
    const profile = await screen.findByRole("button", { name: "Default" });
    refreshFails = true;
    await client.refetchQueries({ predicate: (query) => query.queryKey[0] === "ytdl-browser-profiles" });
    expect(profile).toBeInTheDocument();
    expect(profile).toBeEnabled();
    fireEvent.click(profile);
    await waitFor(() => expect(setCookiesCalls()).toHaveLength(1));
    expect((setCookiesCalls()[0][1] as { config: { browserProfile: string } }).config.browserProfile).toBe("Default");
  });
  it.each([
    ["mode", "ytdl_set_cookies", "不使用"],
    ["browser", "ytdl_set_cookies", "Firefox"],
    ["profile", "ytdl_set_cookies", "Default"],
    ["install", "ytdl_install", "更新在线解析组件"],
    ["import-save", "ytdl_set_cookies", "重新导入 cookies.txt"],
    ["import-test", "ytdl_test_cookies", "重新导入 cookies.txt"],
  ])("handles %s rejection and allows retry without a second implicit call", async (flow, command, name) => {
    const failure = { code: "StorageFailed", message: "操作未完成，请重试", details: "PRIVATE_NATIVE_DETAIL" };
    let failedCalls = 0;
    pickFile.mockResolvedValue("D:/Data/cookies.txt");
    mockBackend({
      ytdl_cookie_status: () => Promise.resolve(flow === "profile" ? { ...FILE_COOKIES, mode: "browser", filePath: null } : FILE_COOKIES),
      ytdl_list_browser_profiles: () => Promise.resolve([{ id: "Default", label: "Default" }]),
      [command]: () => { failedCalls++; return Promise.reject(failure); },
    });
    renderPanel();
    const button = await screen.findByRole("button", { name });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent(failure.message);
    expect(document.body.textContent).not.toContain(failure.details);
    expect(failedCalls).toBe(1);
    if (flow === "import-save") {
      expect(invoke.mock.calls.filter(([cmd]) => cmd === "ytdl_test_cookies")).toHaveLength(0);
    }
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(failedCalls).toBe(2));
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("reports file-picker failure without writing or testing cookies", async () => {
    pickFile.mockRejectedValue(new TypeError("PRIVATE_PICKER_FAILURE"));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "重新导入 cookies.txt" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(errorMessage(new TypeError("PRIVATE_PICKER_FAILURE")));
    expect(setCookiesCalls()).toHaveLength(0);
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "ytdl_test_cookies")).toHaveLength(0);
    expect(document.body.textContent).not.toContain("PRIVATE_PICKER_FAILURE");
  });

  it("shows an honest cookie query error rather than the default message", async () => {
    mockBackend({ ytdl_cookie_status: () => Promise.reject(new TypeError("PRIVATE_COOKIE_QUERY")) });
    renderPanel();
    await screen.findByText(errorMessage(new TypeError("PRIVATE_COOKIE_QUERY")));
    expect(screen.queryByText("登录态仅本机使用，不会交给 AI。公开视频可不导入。")).not.toBeInTheDocument();
  });
  it("keeps the functional title separate from the open-form heading", () => {
    renderPanel();
    expect(screen.getByText("在线解析 / 登录态")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "打开在线视频" })).toBeInTheDocument();
  });

  it("marks the active mode and browser with aria-pressed", async () => {
    mockBackend({
      ytdl_cookie_status: () =>
        Promise.resolve({
          mode: "browser",
          browser: "edge",
          browserProfile: null,
          filePath: null,
          message: "使用 Edge 读取",
        }),
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Edge" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
    expect(screen.getByRole("button", { name: "Chrome" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "不使用" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("persists mode none with the exact merged parameters once", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "不使用" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "不使用" }));
    await waitFor(() => {
      expect(setCookiesCalls()).toHaveLength(1);
    });
    expect(setCookiesCalls()[0]).toEqual([
      "ytdl_set_cookies",
      {
        config: {
          mode: "none",
          browser: "chrome",
          browserProfile: null,
          filePath: null,
        },
      },
    ]);
  });

  it("switches browser, resets the profile and refreshes the profile list", async () => {
    mockBackend({
      ytdl_cookie_status: () =>
        Promise.resolve({
          mode: "browser",
          browser: "chrome",
          browserProfile: "Default",
          filePath: null,
          message: "使用 Chrome 读取",
        }),
      ytdl_list_browser_profiles: () =>
        Promise.resolve([{ id: "Default", label: "Default" }]),
    });
    renderPanel();
    const firefox = await screen.findByRole("button", { name: "Firefox" });
    fireEvent.click(firefox);
    await waitFor(() => {
      expect(setCookiesCalls()).toHaveLength(1);
    });
    await waitFor(() => {
      expect(setCookiesCalls()).toHaveLength(1);
    });
    expect(setCookiesCalls()[0]).toEqual([
      "ytdl_set_cookies",
      {
        config: {
          mode: "browser",
          browser: "firefox",
          browserProfile: null,
          filePath: null,
        },
      },
    ]);
    await waitFor(() => {
      expect(
        vi
          .mocked(invoke)
          .mock.calls.filter(
            ([cmd, args]) =>
              cmd === "ytdl_list_browser_profiles" &&
              (args as { browser?: string })?.browser === "firefox",
          ),
      ).toHaveLength(1);
    });
  });

  it("selects a profile with the exact parameters and marks it pressed", async () => {
    mockBackend({
      ytdl_cookie_status: () =>
        Promise.resolve({
          mode: "browser",
          browser: "chrome",
          browserProfile: null,
          filePath: null,
          message: "使用 Chrome 读取",
        }),
      ytdl_list_browser_profiles: () =>
        Promise.resolve([
          { id: "Default", label: "Default" },
          {
            id: "Profile 1 超长配置档案名称不断尾ProfileWithoutSpacesxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx尾",
            label: "Profile 1 超长配置档案名称不断尾ProfileWithoutSpacesxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx尾",
          },
        ]),
    });
    renderPanel();
    const longProfile = await screen.findByRole("button", {
      name: /超长配置档案名称/,
    });
    fireEvent.click(longProfile);
    await waitFor(() => {
      expect(setCookiesCalls()).toHaveLength(1);
    });
    expect(setCookiesCalls()[0]?.[1]).toEqual({
      config: {
        mode: "browser",
        browser: "chrome",
        browserProfile:
          "Profile 1 超长配置档案名称不断尾ProfileWithoutSpacesxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx尾",
        filePath: null,
      },
    });
    await waitFor(() => {
      expect(longProfile).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("writes nothing when the import dialog is cancelled", async () => {
    pickFile.mockResolvedValue(null);
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /导入 cookies\.txt/ }));
    await waitFor(() => {
      expect(pickFile).toHaveBeenCalledTimes(1);
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(setCookiesCalls()).toHaveLength(0);
    expect(
      vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "ytdl_test_cookies"),
    ).toHaveLength(0);
  });

  it("imports a file then tests readability in order", async () => {
    pickFile.mockResolvedValue("D:/Data/cookies.txt");
    const order: string[] = [];
    mockBackend({
      ytdl_set_cookies: () => {
        order.push("persist");
        return Promise.resolve({
          mode: "file",
          browser: "chrome",
          browserProfile: null,
          filePath: "D:/Data/cookies.txt",
          message: "已导入",
        });
      },
      ytdl_test_cookies: () => {
        order.push("test");
        return Promise.resolve({ ok: true, message: "登录态可读" });
      },
    });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /导入 cookies\.txt/ }));
    await waitFor(() => {
      expect(screen.getByText("登录态可读")).toBeInTheDocument();
    });
    expect(order).toEqual(["persist", "test"]);
  });

  it("makes zero calls while busy", async () => {
    let release!: (value: unknown) => void;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    mockBackend({
      ytdl_test_cookies: () => gate as Promise<unknown>,
    });
    renderPanel();
    const testButton = await screen.findByRole(
      "button",
      { name: "测试登录态是否可读" },
      { timeout: 5000 },
    );
    await waitFor(() => {
      expect(testButton).toBeEnabled();
    });
    fireEvent.click(testButton);
    await waitFor(() => {
      expect(testButton).toBeDisabled();
    });
    const before = setCookiesCalls().length;
    fireEvent.click(screen.getByRole("button", { name: "不使用" }));
    fireEvent.click(screen.getByRole("button", { name: /导入 cookies\.txt/ }));
    expect(setCookiesCalls()).toHaveLength(before);
    release({ ok: true, message: "登录态可读" });
    await waitFor(() => {
      expect(screen.getByText("登录态可读")).toBeInTheDocument();
    });
  });

  it("maps a technical mutation failure without details leakage", async () => {
    mockBackend({
      ytdl_test_cookies: () => Promise.reject(new TypeError("fetch failed")),
    });
    renderPanel();
    const testButton = await screen.findByRole(
      "button",
      { name: "测试登录态是否可读" },
      { timeout: 5000 },
    );
    await waitFor(() => {
      expect(testButton).toBeEnabled();
    });
    fireEvent.click(testButton);
    expect(await screen.findByRole("alert")).toHaveTextContent(errorMessage(new TypeError("fetch failed")));
    expect(document.body.textContent ?? "").not.toMatch(/TypeError|details/i);
  });

  it("shows a failed test with the cookie-file recovery hint", async () => {
    mockBackend({
      ytdl_test_cookies: () =>
        Promise.resolve({ ok: false, message: "浏览器加密 Cookie 文件不可读" }),
    });
    renderPanel();
    const testButton = await screen.findByRole(
      "button",
      { name: "测试登录态是否可读" },
      { timeout: 5000 },
    );
    await waitFor(() => {
      expect(testButton).toBeEnabled();
    });
    fireEvent.click(testButton);
    await waitFor(() => {
      expect(screen.getByText("浏览器加密 Cookie 文件不可读")).toBeInTheDocument();
    });
    expect(screen.getByText(/按上方三步导入 cookies\.txt/)).toBeInTheDocument();
  });

  it("shows an honest error instead of a perpetual loader when status fails", async () => {
    mockBackend({
      ytdl_status: () => Promise.reject(new TypeError("backend gone")),
    });
    renderPanel();
    await screen.findByText(errorMessage(new TypeError("backend gone")));
    expect(screen.queryByText("正在检查解析组件…")).not.toBeInTheDocument();
    expect(screen.queryByText(/backend gone/)).not.toBeInTheDocument();
  });

  it("shows an honest error instead of an empty profile hint when the scan fails", async () => {
    mockBackend({
      ytdl_cookie_status: () =>
        Promise.resolve({
          mode: "browser",
          browser: "chrome",
          browserProfile: null,
          filePath: null,
          message: "使用 Chrome 读取",
        }),
      ytdl_list_browser_profiles: () =>
        Promise.reject(new TypeError("scan exploded")),
    });
    renderPanel();
    await screen.findByText(errorMessage(new TypeError("scan exploded")));
    expect(screen.queryByText(/scan exploded/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/未找到可用配置档案/),
    ).not.toBeInTheDocument();
  });

  it("hides the test row when cookies are disabled", async () => {
    mockBackend({
      ytdl_cookie_status: () =>
        Promise.resolve({
          mode: "none",
          browser: "chrome",
          browserProfile: null,
          filePath: null,
          message: "不使用登录态",
        }),
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "不使用" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
    expect(
      screen.queryByRole("button", { name: "测试登录态是否可读" }),
    ).not.toBeInTheDocument();
  });
});
