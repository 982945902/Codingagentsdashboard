# Coding Agents Dashboard

Web/Mobile 控制台，用来远程操作本地 coding agent CLI 进程（首要支持 **Codex** 与 **Claude**），并支持复用既有 session 继续开发。

UI 原稿：https://www.figma.com/design/x5cz6ACA67qdgKtc1Pv1L5/Coding-Agents-Dashboard

## 架构

```
浏览器 / 手机 (React + Tailwind + shadcn)
        │   REST: /api/agents (CRUD + start/stop/commands)
        │   WS:   /ws/agents  (双向实时事件)
        ▼
Bun.serve  ──►  AgentSupervisor  ──►  Runtime
                     │                 ├─ MockRuntime  (确定性 stub，发完整结构化事件)
                     │                 ├─ CodexExecRuntime  (codex exec --json，每条命令一次子进程)
                     │                 └─ ClaudeCliRuntime  (claude -p --output-format stream-json)
                     ▼
                  AgentStore (messages + logs，内存 + 可选 JSON 持久化)
```

- **共享契约**：`src/shared/contracts.ts`（zod schema，前后端共用类型）
- **后端**：`server/`（Bun + TypeScript）
- **前端**：`src/`（Vite + React 18）

### Codex/Claude session 复用

- `CodexExecRuntime` 每次 `send()` 会 spawn 一次 `codex exec --json [resume <id>] -C <workspacePath> "<prompt>"`，解析 NDJSON 事件流（`task_started` / `agent_message_delta` / `tool_use` / `tool_result` / `task_complete` 等，多字段兜底，无法识别的 JSON 行作为 log 行兜底输出）。
- `ClaudeCliRuntime` 使用 `claude -p --output-format stream-json --input-format stream-json` 并把 prompt 作为 user message 写入 stdin；解析 system / assistant content blocks / tool_use / tool_result / result / done 事件。
- 两个 runtime 都会从输出中抓 session id（codex: `session_id` 字段；claude: `session.id`），自动写回 `AgentSnapshot.sessionId` 并持久化（若设置了 `PERSISTENCE_PATH`），后续 send 自动 resume。
- 也可以通过 REST `POST /api/agents` 时显式传 `sessionId` / `runtimeArgs` 来手动接管。

## 快速开始

```bash
pnpm install

# 终端 A：起后端 (默认 8787)
pnpm dev:server

# 终端 B：起前端 (默认 5173)
pnpm dev

# 或者一起跑
pnpm dev:full

# Tauri 桌面 app（server 仍然独立运行）
pnpm tauri:dev

# 生成 macOS app / dmg
pnpm tauri:build
```

打开前端后进入 Settings 页：
- Server URL: `http://localhost:8787`
- API Key: `dev-api-key`（可被环境变量覆盖）

Tauri 只是客户端壳，不内嵌后端服务。桌面 app 默认连接 `http://localhost:8787`，也可以在 Settings 里改成远程 server 地址。

### 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `8787` | 监听端口 |
| `API_KEY` | `dev-api-key` | 客户端通过 `x-api-key` 头或 `?apiKey=` 查询参数携带 |
| `CORS_ORIGINS` | `*` | 逗号分隔的允许来源 |
| `PERSISTENCE_PATH` | (空) | 设置后将 agent 快照写入 JSON 文件，重启后自动恢复 |

> 注意：`server/config.ts` 当前读取 `HOST/PORT/API_KEY/CORS_ORIGINS`。`PERSISTENCE_PATH` 已在契约中预留，按需在 `loadServerSettings` 接入。

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

## WebSocket

`ws://<host>:<port>/ws/agents?apiKey=<key>`

- 客户端 → 服务端：`{type: "agent.start" | "agent.stop" | "agent.command", agentId, payload?}`
- 服务端 → 客户端：
  - **生命周期**：`agent.created` / `agent.updated` / `agent.deleted`
  - **日志/命令**：`agent.log` / `command.ack` / `command.error`
  - **结构化对话**：`agent.message.start` / `agent.message.delta` / `agent.message.end`
  - **工具调用**：`agent.tool.call` / `agent.tool.result`
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
