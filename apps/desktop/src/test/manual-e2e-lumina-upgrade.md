# Lumina 0.4.1 → Dawnsight 升级手动验收（干净 Windows 虚拟机）

这是**真实安装包 + 真实用户数据**验收，单元测试（`legacy_migration`、`legacy.rs`、
`legacyStorage.test.ts`）不能代替本清单。计划与实现说明见
`.plan/L2-lumina-to-dawnsight-upgrade-migration.md`。

记录证据时用 `%APPDATA%`、`%LOCALAPPDATA%` 这类变量写路径，不要记录账号凭据。

## 0. 准备

- [ ] 干净的 Windows 10/11 x64 虚拟机，从未装过 Lumina / Dawnsight。拍快照 **S0**。
- [ ] 下载 0.4.1 安装包（公开发布仓库 `yitom486/lumina-app` 的 v0.4.1）：
      `Lumina_0.4.1_x64-setup.exe`；场景 F 另需 `Lumina_0.4.1_x64_en-US.msi`。
- [ ] 准备待测的 Dawnsight 安装包：在开发机运行
      `bun run tauri build --bundles nsis`，取 `target/release/bundle/nsis/Dawnsight_*_x64-setup.exe`
      复制进虚拟机。记下构建所用的提交号（未提交时注明“工作区构建”）。
- [ ] 准备一个测试视频文件夹，例如 `C:\TestMedia\Show\`，放 1–2 个带内封字幕的短视频。

## 1. 制造 0.4.1 的用户数据

用 `Lumina_0.4.1_x64-setup.exe` 按默认选项安装（勾选创建桌面快捷方式），然后打开 Lumina：

- [ ] **笔记**：打开视频，写 2 条带截图的时间戳笔记。
- [ ] **媒体库**：把 `C:\TestMedia` 加为媒体库目录并完成扫描，确认能看到剧集分组。
- [ ] **设置**：修改至少 3 项可辨认的设置，记下改成了什么。例如：切换字幕/音轨偏好、
      改一个 Agent 配置项、让某个视频播放到中途（制造播放进度），把一集标为已读。
- [ ] **可选**：如果虚拟机里能配置 Agent，产生一段 AI 对话和一次章节生成；不能则跳过，
      并在结果里注明“未覆盖聊天/章节”。
- [ ] **可选**：在设置里下载一个 whisper 模型（体积小的即可），或安装 yt-dlp。
- [ ] 关闭 Lumina。在 PowerShell 里记录升级前状态：

```powershell
Get-ChildItem "$env:APPDATA\lumina" | Select-Object Name
Test-Path "$env:LOCALAPPDATA\com.lumina.desktop\EBWebView\Default\Local Storage"
Test-Path "C:\TestMedia\.lumina"
Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Lumina" | Select-Object DisplayVersion, UninstallString
Test-Path "$env:USERPROFILE\Desktop\Lumina.lnk"
```

- [ ] 拍快照 **S1**（后面每个场景都从 S1 恢复）。

## 2. 场景 A：模拟自动更新（主路径）

自动更新会以被动模式静默运行新安装包。在 0.4.2 正式发布前，无法让 0.4.1 真的拉到
新版，所以这里直接用更新器同样的方式运行安装包：

```powershell
.\Dawnsight_*_x64-setup.exe /UPDATE /P /R
```

（`/UPDATE` 更新模式，`/P` 被动模式，`/R` 装完后启动应用。）

### 2.1 安装结果

- [ ] `Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Lumina"` 报不存在。
- [ ] “设置 → 应用”里只有 **Dawnsight**，没有 Lumina。
- [ ] `%LOCALAPPDATA%\Lumina` 文件夹已不存在（或只剩空壳）；`%LOCALAPPDATA%\Dawnsight` 存在。
- [ ] 开始菜单搜索 “Dawnsight” 能找到并打开；搜索 “Lumina” 找不到。
- [ ] 桌面上有 `Dawnsight.lnk`，没有 `Lumina.lnk`。
- [ ] 应用在安装后自动启动（`/R`）。如未自动启动，记下来，手动从开始菜单打开继续测。

### 2.2 数据目录

```powershell
Get-ChildItem "$env:APPDATA\dawnsight" | Select-Object Name
Get-ChildItem "$env:APPDATA\lumina" | Select-Object Name
Get-Content "$env:APPDATA\dawnsight\.migrated-from-lumina"
```

- [ ] `%APPDATA%\dawnsight` 里有：`notes.json`、`note-frames`、`dawnsight.sqlite3`、
      `.migrated-from-lumina`；有章节/聊天时还有 `chapter-assets`；下载过的话还有 `whisper` / `yt-dlp`。
- [ ] `%APPDATA%\lumina` 里**仍然保留** `notes.json` 和 `lumina.sqlite3`（复制，不是移动）。
- [ ] `whisper` / `yt-dlp` 已从 `%APPDATA%\lumina` 移走（这两项设计上是移动）。
- [ ] `%LOCALAPPDATA%\com.dawnsight.desktop\EBWebView\Default\Local Storage` 存在。

### 2.3 应用内

- [ ] 笔记面板能看到第 1 步写的 2 条笔记，截图正常显示。
- [ ] 媒体库不用重新扫描就能看到原来的剧集分组；`C:\TestMedia\.dawnsight` 已出现，
      `C:\TestMedia\.lumina` 仍在。
- [ ] 第 1 步改过的每项设置都保持原样（逐项对照记录）。
- [ ] 中途播放过的视频能从原进度续播；标为已读的那集仍是已读。
- [ ] （如有）AI 对话历史、章节结果都在。

### 2.4 日志与幂等

打开 `%APPDATA%\dawnsight\logs\` 下最新的 `dawnsight.log.*`：

- [ ] 有 `legacy app data migration`，outcome 为 `Migrated`。
- [ ] 有 `legacy webview storage migration`，outcome 为 `Migrated`。
- [ ] 有 `migrated legacy library folder`。
- [ ] 没有 `legacy data item migration failed` 或其他迁移相关 warn。
- [ ] 完全退出再打开一次：两条迁移日志的 outcome 变成 `AlreadyMigrated`，数据没有重复或变化。

## 3. 场景 B：手动下载新安装包双击安装

从 S1 恢复，双击 `Dawnsight_*_x64-setup.exe`，按默认选项走完向导。

- [ ] 2.1、2.2、2.3 的检查全部通过（桌面快捷方式这项以向导里的勾选为准）。

## 4. 场景 C：升级时 Lumina 正在运行

从 S1 恢复，先打开 Lumina 不要关，再按场景 A 的命令运行安装包。

- [ ] 安装器提示或自动关闭正在运行的 Lumina，升级正常完成，2.1–2.3 通过。
- [ ] 如果数据库只迁移了一部分或报错，记录日志里的迁移 warn 原文。

## 5. 场景 D：从未用过 Lumina 的全新安装

从 S0 恢复（没有 Lumina），直接装 Dawnsight。

- [ ] 正常安装和启动，桌面/开始菜单快捷方式正常。
- [ ] `%APPDATA%\dawnsight` 里**没有** `.migrated-from-lumina`；日志里迁移 outcome 为 `NothingToMigrate`。

## 6. 场景 E：退回旧版

在场景 A 完成后的状态下，重新安装 `Lumina_0.4.1_x64-setup.exe`。

- [ ] Lumina 能看到原来的笔记、设置和媒体库（旧数据未被移走）。
- [ ] whisper 模型 / yt-dlp 需要重新下载（预期内）。
- [ ] 卸载 Lumina 时**不要**勾选“删除应用数据”，然后再打开 Dawnsight，数据仍在。

## 7. 场景 F：MSI 安装的 Lumina（已知未处理）

从 S0 恢复，用 `Lumina_0.4.1_x64_en-US.msi` 安装并制造数据，再按场景 A 安装 Dawnsight。

这个场景**预期不完整**：安装器钩子只处理 NSIS 安装的 Lumina。请记录实际表现，作为
后续是否要补 MSI 处理的依据：

- [ ] 旧 Lumina 是否仍在“设置 → 应用”里、快捷方式是否仍指向 Lumina。
- [ ] Dawnsight 是否有开始菜单/桌面快捷方式。
- [ ] 用户数据和设置是否迁移成功（数据迁移不依赖安装方式，预期能成功）。

## 结果记录

每个场景记录：通过/失败、失败的检查项、相关日志行（去掉用户名路径）、截图。任何一项
失败都不要发布 0.4.2，把记录交回后再修。
