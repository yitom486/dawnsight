# Dawnsight — Agent Guide

AI Video Reader 桌面应用。

**当前焦点：Monorepo 目标架构迁移与 Online Source 收敛。当前项目仍处于迁移状态，
必须严格按照最初制定的目标架构与迁移计划推进，不得自行创建替代性的组织模式。**

完整计划见 `project.md` / `ROADMAP.md`。执行计划与状态在 `.plan/`（本地，不入库）。每完成一个可检查点，必须更新对应文档的 `status` 与 `STATUS.md`。实现前先读本文件与 `.cursor/rules/`（尤其 `errors.mdc`、`phase-5.mdc`）。

### 当前迁移约束

- 架构唯一依据是 `.plan/L0-monorepo-target-architecture.md` 与
  `.plan/L1-monorepo-migration.md`；L2 任务只能细化它们，不能替换它们。
- M0–M10 是已完成的检查点，不代表整个目标架构迁移已经结束；当前总体状态仍为
  `doing`，后续工作必须继续沿原定依赖方向、边界和迁移顺序推进。
- 不得为了目录对称强行移动跨域编排、Tauri/native、libmpv、IPC 或真实桌面状态；
  任何暂缓项必须在对应 `.plan/` 文档中记录原因和下一步，不得私自改成“已完成”。
- 每个新迁移批次都必须先落盘可复制的执行提示词与验收标准，完成后更新状态，
  通过功能/静态门禁后再提交；不做无计划的大范围重构。

## Tech Stack

- Desktop: **Tauri 2**
- Backend: **Rust**
- Frontend: **React + TypeScript + Vite**
- Package manager（**仅开发/CI**）: **bun** — 终端用户安装包不需要 bun / pnpm / Node 才能播放
- UI: **Tailwind CSS + shadcn/ui on Base UI primitives**；Magic UI 仅按需复制适用组件
- Client state: **Zustand**
- Async/server state: **TanStack Query**
- Player: **libmpv**（`libmpv2`）
- Window: Tauri Window + `HasWindowHandle` / `raw-window-handle`
- Media tools: 项目本地 `ffprobe` / `ffmpeg`（`native/ffmpeg/`）
- ASR（可选）: 本地 `whisper-cli` + `ggml-*.bin`（`native/whisper/`，按需）
- ACP（可选）: **ACP Client** 按需 spawn 本机 Agent 进程（默认 Codex 适配器）

禁止用 HTML `<video>`、canvas 逐帧复制等方式伪装 native playback。

## Architecture

```
React → Tauri Command / Channel → PlayerService → LibMpvPlayer → libmpv
                              → MediaInspector → ffprobe（含 chapters）
                              → SubtitleService → ffmpeg + parse
                              → AsrService（按需）→ whisper-cli
                              → AcpService（按需）→ ACP Agent stdio JSON-RPC
                                   └ default: codex-acp → Codex App Server → Responses API
                              → NoteService → 本地 JSON + Markdown 导出
```

React 不得知道：mpv handle、native window handle、FFI pointer、libmpv / whisper / ACP 子进程 lifecycle。

## ACP 分层（必读）

| 层 | 是什么 | Dawnsight 关系 |
|----|--------|-------------|
| **ACP** | 开放协议（stdio JSON-RPC） | **产品稳定边界**（只做 Client） |
| **codex-acp** | TS/Node 适配器（可打成单文件） | 默认 Agent **启动命令**，不是领域逻辑 |
| **Codex App Server** | Codex harness 引擎 | 仅 Codex profile 内部使用；**不要**当主协议 |
| **模型 API** | 现以 **Responses API** 为主 | 经 Codex `config.toml`；非任意 Chat URL |

- **换模型 ≠ 换 Agent**：Codex 内换 provider（Responses）；换 Claude 等 = 换 ACP Agent 进程（profile）
- 终端用户**不必**装 bun/pnpm 才能播放；开发用 bun；产品不得把 bun 当用户运行时硬依赖

## Error handling（必读）

细则见 [`.cursor/rules/errors.mdc`](.cursor/rules/errors.mdc)。摘要：

1. **目标是隐藏实现，不是「翻译」**：用户看不到工具名 / stderr / serde / 路径等底层信息
2. 形状：`{ code, message, details? }` — UI **只展示** `message`；`details` 仅日志（前端默认不渲染）
3. 底层失败在域构造函数映射为**固定**业务 `message`；调用方只传 `details`
4. 用户输入校验可用具体中文（`bad_request` / `invalid`）
5. 前端只用 `formatPlayerError` / `errorMessage`，禁止拼「详情：」+ `details`

## Testing

```bash
bun run lint
bun run test
cargo fmt --all --check
cargo test --workspace --lib
cargo clippy --workspace --all-targets -- -D warnings
```

MCP 协议级黑盒测试需要启用确定性 fixture seam：

```bash
cargo test -p dawnsight-mcp --features test-support --test chapter_blackbox_stdio
```

### MCP / Agent 工具黑盒验收（强制）

- 每新增一个 MCP/Agent 工具，或改变现有工具的参数、权限、输出或副作用，都必须同时新增或更新协议级黑盒测试。
- 黑盒测试必须通过真实的 stdio `initialize → tools/list → tools/call` 链路调用工具，不能只测试内部函数或静态的 `tools/list`。
- 测试必须使用确定性的 mock 台词、图片、媒体和数据库输入，验证：工具是否出现在正确的 profile、是否可以正常调用、输出是否符合契约、越权/非法输入是否被拒绝，以及实际副作用是否正确落库或写入控制文件。
- 每个工具至少覆盖一个成功场景和一个边界/失败场景；有外部媒体工具依赖时使用 `cfg(test-support)` 的确定性 fixture seam，但仍必须经过生产工具 handler 和 MCP transport。
- 黑盒测试通过是工具完成和合并的必要条件；真实 ACP/桌面 E2E 是额外验收，不能替代黑盒测试。测试日志应记录工具名、阶段、耗时和最终状态，不输出媒体绝对路径、Agent stderr 或敏感上下文。

## ASR（Phase 4）

- **非必须**；仅用户点击才 spawn whisper-cli；未配置返回 `NotConfigured`

## ACP（Phase 5）

- **非必须**：播放 / 字幕 / 笔记不依赖 ACP
- **按需**：用户发起会话才 spawn 当前 Agent profile；启动 / Open **不**预连接
- 默认 profile：`codex`；可配置 `claude` / `custom`（command + args + env）
- 未配置 → `NotConfigured`，应用仍可用

## 笔记 / 章节

- 笔记：时间戳锚点 + Markdown 导出；不依赖 AI
- 章节目标只有两种来源：容器/在线源提供的真实章节，以及用户主动触发的 AI 语义分段。
  不再新增或扩展 soft/机械分段；现有 P6-M5 实现属于待下线迁移债务，迁移完成前不得把它
  当作新的产品能力继续设计。AI 分段必须结合字幕/台词与按需截帧，不能在打开视频时静默启动。

## UI 与 AI 实现约束

- UI 原语统一使用 `packages/ui` 中的 shadcn/ui + Base UI；业务组件优先组合共享原语。
- 编写通用交互前，先检查 `packages/ui` 和 shadcn/Magic UI 官方 registry 是否已有适用实现。
  有则复用并按调用方需求通过 `className` 或薄适配层定制；缺少时优先基于官方组件扩展到
  `packages/ui`，不要在 feature 内重复造菜单、弹层、选择器、表单控件、焦点管理或键盘交互。
  自定义只留给 Dawnsight 业务工作流、布局边界，或经审查确实无法由现有组件承载的行为。
- Magic UI 是可选的复制式视觉组件来源，不是全量依赖；只加入有明确产品场景的组件，检查
  运行时依赖、语义主题 token、键盘/读屏行为和 `prefers-reduced-motion`。装饰动效不得成为
  播放、字幕阅读或 AI 操作可用性的前提，也不得覆盖 libmpv HWND。
- 新增 UI 运行时依赖前先确认共享包或已有 workspace 已提供该能力；依赖集中声明在实际拥有
  原语实现的 package，不在 app 和共享 package 重复声明。
- 颜色不得在业务组件中硬编码十六进制、RGB 或命名色。必须使用语义 CSS 变量；亮色和暗色
  两套 token 都要完整定义。媒体画面黑色属于播放器 surface 的特殊语义，不得借此绕过主题变量。
- 快捷 AI 操作只能引用版本化的任务提示词，不得把专有提示词散落在 React 组件字符串中。
  提示词仓库、章节 Agent、输出校验、增量重试和 SQLite 数据层的执行约束见
  `.plan/L2-chapter-agent-data-pipeline.md`。
- AI 结构校验失败时，重试消息只能增量追加本次校验报告；同一校验错误最多重试三次，超过
  上限必须失败并保留原因。只有 Agent 会话因传输故障丢失时，才允许使用完整 bootstrap
  prompt 恢复新会话。底层技术细节仍只能进入 `details`/日志，不能直接展示给用户。

## Conventions

- 优先级：可运行 > 架构清晰 > 代码简洁 > UI 美观
- 业务代码禁止 `unwrap()` / `expect()`
- 给前端的错误必须是 `{ code, message, details? }`；底层错误只进 `details` / 日志
- 日志用 `tracing`；不要刷 position
- TanStack Query key 跨文件复用时走各 feature 的 `queries.ts` 工厂，不手写字面量
- 不与其他产品强行统一 lockfile；对齐领域模型与错误形状即可
- Vendor 原件只读：`packages/ui` 内 shadcn/Magic UI 官方拷贝保持上游实现；定制只允许调用方
  `className`（经 `cn` 合并）或 app-side 转接组件。Base UI 组合使用 `render`，wrapper 必须
  透传 `ref`、ARIA props 和事件；浮层触发器的 ref 必须落到实际锚点元素。

## UI design references

- 主界面视觉参考图：`ui/lumina-desktop-overview-reference.png`
- 文稿阅读工作区参考图：`ui/lumina-transcript-reading-reference.png`
- 时间戳笔记工作区参考图：`ui/dawnsight-notes-workspace-reference.png`
- 设置与资源管理工作区参考图：`ui/lumina-settings-workspace-reference.png`
- 通用聊天与富输出参考图：`ui/lumina-general-chat-rich-output-reference.png`
- AI 观剧流与自由聊天 Tab 参考图：`ui/dawnsight-ai-watch-feed-reference.png`
- 无章节视频的章节工作区参考图：`ui/lumina-chapter-generation-reference.png`
- AI 与自动化设置参考图：`ui/dawnsight-ai-automation-settings-reference.png`
- UI 交互与渲染约定：`ui/README.md`
- 设计方向：深蓝石墨背景、蓝青色 AI 状态光感、橙色播放操作强调，整体保持科技简约与低干扰。
- 参考图只定义视觉语言和信息层级，不改变原生播放器约束：`libmpv` HWND 必须与 WebView UI 使用并排布局，文稿、笔记、章节与 AI 面板不得依赖覆盖 HWND 的透明 WebView 层。
