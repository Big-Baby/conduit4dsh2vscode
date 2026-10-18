# Conduit · DSH to VS Code

DeepSeek Harness 的编辑器前端。它在 dsh 进程内挂载一个 JSON-RPC 传输桥，
再由 VS Code 扩展把项目、会话、模型、多 agent 任务与文件变更呈现到编辑器里。

与 `dsh web` 的区别在于链路方向：不经过 HTTP 与浏览器，也不依赖端口转发。
扩展以 `extensionKind: workspace` 运行，在 Remote-SSH 场景下直接跑在远端，
文件读写与终端操作都在真实工作区完成。

## 组成

| 包 | 角色 | 运行位置 |
| --- | --- | --- |
| [`protocol/`](../protocol/) | 通信契约：信封、方法表、DTO、事件、错误码 | 编译期，两侧内联 |
| [`bridge/`](../bridge/) | dsh 侧网关：把 harness 能力暴露为 JSON-RPC 服务端 | dsh 进程内 |
| [`extension/`](../extension/) | 编辑器客户端：连接、侧边栏、对话区 | VS Code 扩展宿主 |

依赖方向单一：`extension → core → rpc`，`bridge: rpc → core → dsh → store`，
两侧都只向下依赖 `protocol`。

## 能力

- **会话**：列表、创建、重命名、归档、删除、历史分页、取消当前轮次
- **模型**：供应商增删改查、密钥托管、默认模型、会话内模型与思考强度切换
- **多 agent**：子 agent 树、状态、耗时、工具调用计数，对话区按 agent 分组
- **文件**：工作区文件列举与读取（越界校验）、`@` 提及随消息投递
- **变更**：以上次确认为基线的 diff，支持逐文件查看、还原与一键推进基线
- **插件**：列出、搜索、安装、启停、卸载 dsh bundle

## 快速开始

前置条件：Node.js 22.11+、已安装 dsh（`npm i -g @deepseek-ai/dsh`）。

```bash
# 1. 安装网关到 rpc profile
dsh plugin --profile rpc add /absolute/path/to/bridge

# 2. 验证通道
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"system.info"}' | dsh --profile rpc

# 3. 构建并安装扩展
npm install
npm run build
cd extension && npm run package
code --install-extension conduit4dsh2vscode-0.8.0.vsix
```

也可以在 VS Code 中执行 `DSH: Connect`，扩展会自动探测 CLI（配置路径 → PATH → npx）。

## 配置

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| `dsh.transport` | `stdio` | `stdio` / `tcp` / `unix` |
| `dsh.profile` | `rpc` | 连接使用的 profile |
| `dsh.permissionMode` | `workspace-write` | 沙箱级别，经 `DSH_PERMISSION_MODE` 传入 |
| `dsh.enableLiveAgentLoop` | `true` | 关闭后回放本地记录，不调用模型 |
| `dsh.providerConfig` | `{}` | 声明式供应商配置，连接后自动同步 |
| `dsh.changes.exclude` | 构建产物等 | 变更跟踪忽略的 glob |
| `dsh.ui.*` | 跟随主题 | 对话区配色与折叠偏好 |

完整列表见 [docs/extension.md](extension.md)。

## 文档

- [架构](architecture.md)：分层、依赖规则、一次对话的完整链路
- [RPC 协议](protocol.md)：方法表、事件、错误码、版本与能力协商
- [网关](bridge.md)：profile 挂载、dsh 适配层、凭据与路由
- [编辑器客户端](extension.md)：连接状态机、Webview 契约、变更基线
- [开发](development.md)：构建、测试、部署与排障

`docs/*.html` 是同一份内容的在线版本，使用 CDN 渲染图表与代码高亮。

## 目录

```
protocol/     契约（类型与常量，无运行时依赖）
bridge/       网关插件（cordis 入口、dsh 适配、RPC 服务）
extension/    扩展（RPC 客户端、领域服务、视图、Vue 对话区）
docs/         文档（Markdown 离线版 + HTML 在线版）
scripts/      文档生成与打包脚本
deploy/       本机/远端安装脚本
```

## 许可

[MIT](../LICENSE)
