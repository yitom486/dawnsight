import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Channel } from "@tauri-apps/api/core";

import { Button } from "@dawnsight/ui/button";
import { errorMessage } from "@/lib/format";
import {
  getYtdlCookieStatus,
  getYtdlStatus,
  installYtdl,
  listBrowserProfiles,
  pickCookiesFile,
  setYtdlCookies,
  testYtdlCookies,
  type CookieBrowser,
  type CookieMode,
  type YtdlInstallEvent,
} from "@/features/ytdl";

const BROWSERS: { id: CookieBrowser; label: string }[] = [
  { id: "chrome", label: "Chrome" },
  { id: "edge", label: "Edge" },
  { id: "firefox", label: "Firefox" },
];

function recommendsCookieFile(message: string | undefined): boolean {
  if (!message) return false;
  return (
    message.includes("加密") ||
    message.includes("Cookie 文件") ||
    message.includes("任务管理器")
  );
}

export function OnlineSourceSettings() {
  const [actionError, setActionError] = useState<unknown>(null);
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: ["ytdl-status"],
    queryFn: getYtdlStatus,
  });
  const cookieQuery = useQuery({
    queryKey: ["ytdl-cookies"],
    queryFn: getYtdlCookieStatus,
  });

  const cookie = cookieQuery.data;
  const selectedBrowser = cookie?.browser ?? "chrome";
  const browserMode = cookie?.mode === "browser";
  const fileMode = cookie?.mode === "file";

  const profilesQuery = useQuery({
    queryKey: ["ytdl-browser-profiles", selectedBrowser],
    queryFn: () => listBrowserProfiles(selectedBrowser),
    enabled: browserMode,
  });

  const saveCookies = useMutation({
    mutationFn: setYtdlCookies,
    onSuccess: (status) => {
      queryClient.setQueryData(["ytdl-cookies"], status);
    },
  });

  const install = useMutation({
    mutationFn: async () => {
      const channel = new Channel<YtdlInstallEvent>();
      return installYtdl(channel);
    },
    onSuccess: (status) => {
      queryClient.setQueryData(["ytdl-status"], status);
    },
  });

  const testCookies = useMutation({
    mutationFn: testYtdlCookies,
  });

  const ytdl = statusQuery.data;
  const busy =
    saveCookies.isPending || install.isPending || testCookies.isPending;

  // Mutation errors remain in Query; also handle failures before a mutation
  // (for example the native file picker) without an unhandled rejection.
  const runAction = async (action: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(error);
    }
  };

  const persist = (input: {
    mode: CookieMode;
    browser?: CookieBrowser;
    browserProfile?: string | null;
    filePath?: string | null;
  }) =>
    saveCookies.mutateAsync({
      mode: input.mode,
      browser: input.browser ?? cookie?.browser ?? "chrome",
      browserProfile:
        input.browserProfile === undefined
          ? (cookie?.browserProfile ?? null)
          : input.browserProfile,
      filePath:
        input.filePath === undefined ? (cookie?.filePath ?? null) : input.filePath,
    });

  const setMode = (mode: CookieMode) => {
    void runAction(() =>
      persist({
        mode,
        filePath: mode === "file" ? cookie?.filePath ?? null : null,
        browserProfile: mode === "browser" ? cookie?.browserProfile ?? null : null,
      }),
    );
  };

  const setBrowser = (browser: CookieBrowser) => {
    void runAction(async () => {
      await persist({
        mode: "browser",
        browser,
        browserProfile: null,
        filePath: null,
      });
      await queryClient.invalidateQueries({
        queryKey: ["ytdl-browser-profiles", browser],
      });
    });
  };

  const setProfile = (browserProfile: string) => {
    void runAction(() =>
      persist({
        mode: "browser",
        browser: selectedBrowser,
        browserProfile,
        filePath: null,
      }),
    );
  };

  const importFile = async () => {
    const path = await pickCookiesFile();
    if (!path) return;
    await persist({
      mode: "file",
      browserProfile: null,
      filePath: path,
    });
    await testCookies.mutateAsync();
  };

  const profiles = profilesQuery.data ?? [];

  return (
    <div className="space-y-2 text-left text-xs">
      <p className="font-medium text-foreground">在线解析 / 登录态</p>
      <p className="break-words text-muted-foreground">
        {ytdl?.message ?? (statusQuery.isError ? null :  "正在检查解析组件…")}
      </p>
      {statusQuery.isError && !ytdl ? (
        <p className="break-words text-[11px] text-destructive">
          {errorMessage(statusQuery.error)}
        </p>
      ) : null}
      {ytdl?.installSupported ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => void runAction(() => install.mutateAsync())}
        >
          {install.isPending
            ? ytdl.cliReady
              ? "正在更新…"
              : "正在安装…"
            : ytdl.cliReady
              ? "更新在线解析组件"
              : "安装在线解析组件"}
        </Button>
      ) : null}

      <p className="break-words pt-1 text-muted-foreground">
        {cookie?.message ?? (cookieQuery.isError ? null :
          "登录态仅本机使用，不会交给 AI。公开视频可不导入。")}
      </p>
      {cookieQuery.isError && !cookie ? (
        <p className="break-words text-[11px] text-destructive">
          {errorMessage(cookieQuery.error)}
        </p>
      ) : null}

      <div className="space-y-2 px-0 py-1 text-[11px] leading-relaxed">
        <p className="font-medium text-foreground">
          Chrome 无法直读时：三步导入 cookies.txt
        </p>
        <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
          <li>扩展商店安装可导出 Netscape cookies.txt 的扩展</li>
          <li>在 youtube.com（或 B 站）用目标账号登录后导出文件</li>
          <li>点下方按钮导入 →「测试登录态是否可读」→ 再打开链接</li>
        </ol>
        <p className="text-muted-foreground">
          说明：这不是 Google / B 站官方 OAuth；只是把浏览器里的登录态文件交给本机解析。路径会记住，过期后再导出一次即可。
        </p>
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => void runAction(importFile)}
        >
          {fileMode ? "重新导入 cookies.txt" : "导入 cookies.txt（推荐）"}
        </Button>
      </div>

      <details className="rounded-md border border-border/60 px-2 py-1.5">
        <summary className="cursor-pointer text-[11px] text-muted-foreground">
          高级：尝试从浏览器直接读取（多数 Chrome 会失败）
        </summary>
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={cookie?.mode === "none" ? "default" : "outline"}
              aria-pressed={cookie?.mode === "none"}
              disabled={busy}
              onClick={() => setMode("none")}
            >
              不使用
            </Button>
            {BROWSERS.map((b) => (
              <Button
                key={b.id}
                type="button"
                size="sm"
                variant={
                  cookie?.mode === "browser" && cookie.browser === b.id
                    ? "default"
                    : "outline"
                }
                aria-pressed={cookie?.mode === "browser" && cookie.browser === b.id}
                disabled={busy}
                onClick={() => setBrowser(b.id)}
              >
                {b.label}
              </Button>
            ))}
          </div>

          {browserMode ? (
            <div className="space-y-1.5">
              <p className="text-[11px] text-muted-foreground">选择配置档案</p>
              {profilesQuery.isLoading ? (
                <p className="text-muted-foreground">正在扫描本机配置档案…</p>
              ) : profilesQuery.isError && profiles.length === 0 ? (
                <p className="break-words text-[11px] text-destructive">
                  {errorMessage(profilesQuery.error)}
                </p>
              ) : profiles.length === 0 ? (
                <p className="text-muted-foreground">
                  未找到可用配置档案，请改用上方导入 cookies.txt。
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {profiles.map((profile) => (
                    <Button
                      key={profile.id}
                      className="max-w-full min-w-0 whitespace-normal break-words text-left"
                      type="button"
                      size="sm"
                      variant={
                        cookie?.browserProfile === profile.id
                          ? "default"
                          : "outline"
                      }
                      aria-pressed={cookie?.browserProfile === profile.id}
                      disabled={busy}
                      onClick={() => setProfile(profile.id)}
                    >
                      {profile.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </details>

      {cookie?.mode !== "none" ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy || !ytdl?.cliReady}
            onClick={() => void runAction(() => testCookies.mutateAsync())}
          >
            {testCookies.isPending ? "测试中…" : "测试登录态是否可读"}
          </Button>
          {testCookies.data ? (
            <span
              className={
                testCookies.data.ok ? "inline-flex min-w-0 max-w-full items-center gap-1.5 text-[11px] font-medium text-foreground" : "break-words text-destructive"
              }
            >
              {testCookies.data.ok ? (
                <>
                  <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success" />
                  <span className="min-w-0 break-words">{testCookies.data.message}</span>
                </>
              ) : (
                testCookies.data.message
              )}
            </span>
          ) : null}
        </div>
      ) : null}

      {testCookies.data &&
      !testCookies.data.ok &&
      recommendsCookieFile(testCookies.data.message) ? (
        <p className="break-words text-[11px] text-foreground">
          <span aria-hidden="true" className="mr-1 inline-block size-1.5 rounded-full bg-warning" />
          浏览器直读失败时，请按上方三步导入 cookies.txt（不要期待 Google
          一键授权）。
        </p>
      ) : null}

      {(actionError || saveCookies.error || install.error || testCookies.error) && (
        <p role="alert" className="break-words text-destructive">
          {errorMessage(
            actionError ?? saveCookies.error ?? install.error ?? testCookies.error,
          )}
        </p>
      )}
    </div>
  );
}
