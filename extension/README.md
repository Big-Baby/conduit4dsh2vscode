# DSH for VS Code

在编辑器里使用 DeepSeek Harness：会话、模型、多 agent 任务与文件变更，全部
通过本地 JSON-RPC 通道，不需要端口转发。

## 功能

- **会话面板**：创建、重命名、归档、删除，恢复上次打开的会话
- **对话区**：流式输出、思考过程、工具调用、按 agent 分组、`@` 文件提及、
  上滑加载更早消息
- **模型**：供应商管理（单页面板自动拉取模型列表）、密钥托管、默认模型、
  会话内切换模型与思考强度
- **多智能体**：层级、状态、耗时与工具计数
- **变更确认**：以上次确认为基线的 diff，逐个查看、还原或一键推进
- **插件**：搜索、安装、启停、卸载 dsh bundle

## 使用

需要先安装 dsh 与网关插件：

```bash
npm install -g @deepseek-ai/dsh
dsh plugin --profile rpc add /path/to/bridge
```

打开文件夹后，点击状态栏 **DSH** 或执行 `DSH: Connect`。

远端开发时扩展是 `workspace` 类型，会运行在远端扩展宿主，文件与终端操作都在
远端完成。

## 设置

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `dsh.transport` | `stdio` | 传输方式 |
| `dsh.profile` | `rpc` | harness profile |
| `dsh.permissionMode` | `workspace-write` | 沙箱级别 |
| `dsh.providerConfig` | `{}` | 声明式供应商配置 |
| `dsh.changes.exclude` | 构建产物 | 变更跟踪忽略项 |
| `dsh.ui.*` | 跟随主题 | 配色与折叠 |

## 命令

`DSH: Connect`、`DSH: New Session`、`DSH: Add Provider`、`DSH: Confirm Changes`、
`DSH: Compare Changes`、`DSH: Install Plugin` 等，均在命令面板以 `DSH:` 开头。

## 说明

- 未配置模型时进入回放模式：消息可收发，但回复为本地回执，界面会显示横幅；
- 对话区构建产物内联在 Webview 中，CSP 仅允许带 nonce 的脚本；
- 变更基线在 git 仓库中使用悬空提交，非 git 目录使用文件快照。

协议与架构文档见仓库 `docs/`。
