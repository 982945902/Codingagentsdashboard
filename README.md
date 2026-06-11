# Coding Agents Dashboard

Web/Mobile 控制台，用来远程操作本地 coding agent CLI 进程（首要支持 **Codex** 与 **Claude**），并支持复用既有 session 继续开发。

UI 原稿：https://www.figma.com/design/x5cz6ACA67qdgKtc1Pv1L5/Coding-Agents-Dashboard

## 架构

```
浏览器 / 手机 (React + Tailwind + shadcn)
        │   REST: /api/agents (CRUD + start/stop/commands) + /api/transcribe
        │   WS:   /ws/agents  (双向实时事件)
        ▼
Bun.serve  ──►  AgentSupervisor  ──►  Runtime
                     │                 ├─ CodexAppServerRuntime  (codex app-server 长驻 JSON-RPC)
                     │                 └─ ClaudeCliRuntime  (claude -p --output-format stream-json)
                     ▼
                  AgentStore (messages + logs，内存 + 可选 JSON 持久化)
                     │
                     └─ WhisperCliTranscriber (whisper.cpp 服务端语音转录)
```

- **共享契约**：`src/shared/contracts.ts`（zod schema，前后端共用类型）
- **后端**：`server/`（Bun + TypeScript）
- **前端**：`src/`（Vite + React 18）

### Codex/Claude session 复用

- `CodexAppServerRuntime` 启动长驻 `codex app-server` 子进程，通过 JSON-RPC 创建/恢复 thread 并发送 turn；解析 message/tool/usage/approval 事件，保持同一进程内上下文。
- `ClaudeCliRuntime` 使用 `claude -p --output-format stream-json --input-format stream-json` 并把 prompt 作为 user message 写入 stdin；解析 system / assistant content blocks / tool_use / tool_result / result / done 事件。
- 两个 runtime 都会从输出中抓 session id（codex: `session_id` 字段；claude: `session.id`），自动写回 `AgentSnapshot.sessionId` 并持久化（若设置了 `PERSISTENCE_PATH`），后续 send 自动 resume。
- 也可以通过 REST `POST /api/agents` 时显式传 `sessionId` / `runtimeArgs` 来手动接管。
- Codex runtime 的 command/patch approval 会通过 WebSocket 发给前端，用户可 Allow/Deny；无人响应时后端 60s 后自动 allow，避免 runtime 卡死。

### 语音输入转录

前端麦克风按钮使用浏览器 `MediaRecorder` 录音，停止后将音频以 multipart 上传到后端 `POST /api/transcribe`。后端使用本机 `whisper.cpp` 的 `whisper-cli` 做服务端转录，返回文本后填回命令输入框。

准备 whisper.cpp：

```bash
git clone https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp
sh ./models/download-ggml-model.sh base
cmake -B build
cmake --build build -j --config Release
```

启动后端前配置：

```bash
export WHISPER_CPP_BIN=/path/to/whisper.cpp/build/bin/whisper-cli
export WHISPER_CPP_MODEL=/path/to/whisper.cpp/models/ggml-base.bin
# 浏览器常录到 webm/mp4；后端会用 ffmpeg 转成 16k mono wav 再交给 whisper.cpp
export FFMPEG_BIN=ffmpeg
pnpm dev:server
```

`whisper-cli` 原生支持 flac/mp3/ogg/wav；webm/mp4 等浏览器录音格式依赖 `ffmpeg` 转码。

## 快速开始

```bash
pnpm install

# 终端 A：起后端 (默认 8787)
pnpm dev:server

# 终端 B：起前端 (默认 5173)
pnpm dev

# 或者一起跑
pnpm dev:full
```

打开前端后进入 Settings 页：
- Server URL: `http://localhost:8787`
- API Key: `dev-api-key`（可被环境变量覆盖）

### 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `8787` | 监听端口 |
| `API_KEY` | `dev-api-key` | 客户端通过 `x-api-key` 头或 `?apiKey=` 查询参数携带 |
| `CORS_ORIGINS` | `*` | 逗号分隔的允许来源 |
| `PERSISTENCE_PATH` | (空) | 设置后将 agent 快照写入 JSON 文件，重启后自动恢复 |
| `WHISPER_CPP_BIN` | `whisper-cli` | whisper.cpp CLI 可执行文件 |
| `WHISPER_CPP_MODEL` | (空) | ggml 模型路径；为空时禁用语音转录并返回 503 |
| `WHISPER_LANGUAGE` | `auto` | 转录语言，`auto` 表示自动检测 |
| `FFMPEG_BIN` | `ffmpeg` | 转换浏览器录音格式的 ffmpeg 可执行文件 |

## REST API

| 方法 | 路径 | 描述 |
| --- | --- | --- |
| GET | `/health` | 健康检查（无需鉴权） |
| GET | `/api/agents` | 列出所有 agent |
| GET | `/api/agents/:id` | 单个 agent 快照 |
| POST | `/api/agents` | 创建 agent（支持 `sessionId`、`runtimeArgs`） |
| DELETE | `/api/agents/:id` | 删除 agent（自动停 runtime） |
| POST | `/api/agents/:id/start` | 启动 runtime |
| POST | `/api/agents/:id/stop` | 停止 runtime |
| POST | `/api/agents/:id/commands` | 给运行中的 agent 发命令 |
| POST | `/api/transcribe` | multipart 上传 `audio` 文件，返回 `{ text }` |

## WebSocket

`ws://<host>:<port>/ws/agents?apiKey=<key>`

- 客户端 → 服务端：`agent.start` / `agent.stop` / `agent.command` / `agent.approval.response`
- 服务端 → 客户端：
  - **生命周期**：`agent.created` / `agent.updated` / `agent.deleted`
  - **日志/命令**：`agent.log` / `command.ack` / `command.error`
  - **结构化对话**：`agent.message.start` / `agent.message.delta` / `agent.message.end`
  - **工具调用**：`agent.tool.call` / `agent.tool.result`
  - **Approval**：`agent.approval.request` / `agent.approval.resolved`
  - **回合**：`agent.turn.complete`

每条 assistant 消息走 `start → delta* → end` 序列；该消息内的工具调用走 `tool.call → tool.result`，`messageId` 与父消息一致。前端 `useAgents` hook 用 reducer 风格把这些事件还原成 `AgentSnapshot.messages[]` 供 `WorkspacePanel` 的 Chat 卡片流渲染（含流式光标 + tool call 子卡片）。

详见 `wsClientMessageSchema` 与 `wsServerEventSchema`（`src/shared/contracts.ts`）。

## 前端使用

- **看板**：`KanbanBoard` 以 status 分列展示所有 agent，支持 **+ New Agent** 对话框（runtimeKind / workspacePath / model / sessionId / runtimeArgs）和卡片悬停删除按钮。
- **工作区**：`WorkspacePanel` 顶部为状态条 + Quick Actions（start/pause/restart/stop），中部 Chat 卡片流（user 右对齐，assistant 左对齐 + Markdown，streaming 显示光标，工具调用以子卡片展示 status / input / output），底部为可折叠 Logs 区。
- **Slash 命令**：输入框输入 `/` 弹出 palette，内置 `/clear`（本地清 logs）、`/resume <id>` / `/model <name>` / `/dir <path>`（发送给 runtime）。`↑/↓` 选择，`Tab` 或 `Enter`（无空格）补全，`Esc` 清空。

## 测试与构建

```bash
bun test              # 跑后端单测
pnpm build:server     # 后端 TypeScript 类型检查
pnpm build            # 前端构建
```
