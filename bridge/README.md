# @conduit4dsh2vscode/bridge

dsh 传输层插件。挂载在 `rpc` profile，把项目、会话、模型、多 agent、文件与插件
能力暴露为 JSON-RPC 2.0 服务（默认 stdio NDJSON，协议 1.0）。

它不是 UI 插件：不启动 HTTP 服务，不渲染界面，进程只通过 stdin/stdout 通信。

## 安装

```bash
dsh plugin --profile rpc add /absolute/path/to/bridge
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"system.info"}' | dsh --profile rpc
```

## 配置

```yaml
- insert:
    - id: dsh-bridge
      name: '@conduit4dsh2vscode/bridge'
      config:
        transport: stdio        # stdio | tcp | unix
        # transport: tcp
        # host: 127.0.0.1
        # port: 4113
        # token: '${DSH_RPC_TOKEN}'
```

`tcp` / `unix` 必须配置 `token`，否则拒绝启动。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `DSH_HOME` | 状态与日志根目录 |
| `DSH_PROFILE` | 上报给客户端的 profile 名 |
| `DSH_RPC_LIVE` | `0` 强制回放模式；默认尝试真实 agent loop |
| `DSH_BRIDGE_DEBUG` | `1` 时记录 debug 级日志 |

## 结构

```
src/
├── index.ts        cordis 入口（name / inject / Config / apply）
├── config.ts       schemastery 配置
├── container.ts    组合根与启动顺序
├── dsh/            harness 适配（服务探测、会话日志、消息、插件、凭据）
├── core/           业务域（项目、会话、模型、agent 登记、文件、设置）
├── runtime/        SessionBackend 端口与 live/replay 实现、事件总线
├── rpc/            server、router、参数校验、handler
└── store/          原子 JSON 存储与路径
```

`rpc → core → dsh → store` 为唯一依赖方向；`dsh/` 是 harness 升级时需要改动的
唯一目录。

## 持久化

`$DSH_HOME/` 下：

- `bridge-projects.json`、`bridge-sessions.json`：编辑器侧元数据
- `bridge-providers.json`、`bridge-default-model.json`：模型配置
- `bridge-messages/`、`bridge-agents/`：回放消息与 agent 登记表
- `bridge.log`：诊断日志（2 MiB 上限）

首次启动会从旧版 `rpc-*.json` 迁移。

## 构建

```bash
npm run build        # esbuild → lib/index.js
npm run typecheck
```

构建产物保持 `@deepseek-ai/*` external，直接使用 dsh 宿主内的真实包。

完整设计见 [../docs/bridge.md](../docs/bridge.md)。
