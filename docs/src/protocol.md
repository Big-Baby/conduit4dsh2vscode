# RPC 协议

协议版本 **1.1**。传输为 JSON-RPC 2.0，帧格式为 NDJSON：一行一条消息，UTF-8，
单帧上限 16 MiB。

## 信封

```json
{"jsonrpc":"2.0","id":1,"method":"session.list","params":{"projectId":"p_..."}}
{"jsonrpc":"2.0","id":1,"result":[]}
{"jsonrpc":"2.0","id":1,"error":{"code":-32011,"message":"session not found: s_..."}}
{"jsonrpc":"2.0","method":"session.event","params":{"sessionId":"s_...","event":{}}}
```

- 请求必须有 `id`；通知没有 `id`，服务端不回复。
- 客户端到服务端的通知只有 `session.subscribe` / `session.unsubscribe`。
- 批量请求不支持；一行一条消息。

## 版本与能力

`system.info` 返回 `protocolVersion` 与 `capabilities`。兼容规则：

1. 主版本不同 → 客户端拒绝连接（`-32002`）；
2. 次版本不同 → 按 `capabilities` 降级，不阻断。

当前能力：`multi-agent`、`changes-baseline`、`plugin-management`、
`file-mentions`、`history-paging`、`session-model-selection`、
`permission-management`、`approval-prompts`、`subagent-cancel`。

1.1 只新增方法与通知，未改变既有字段语义；1.0 端不会收到这些方法，
客户端按能力名隐藏对应控件。

## 错误码

| 码 | 名称 | 含义 |
| --- | --- | --- |
| -32700 | ParseError | 帧不是合法 JSON |
| -32600 | InvalidRequest | 信封不合法 |
| -32601 | MethodNotFound | 方法不存在 |
| -32602 | InvalidParams | 参数缺失或类型错误 |
| -32603 | InternalError | 未分类失败 |
| -32000 | ServerNotReady | 依赖服务未激活 |
| -32001 | AuthFailed | 鉴权失败 |
| -32002 | ProtocolMismatch | 主版本不一致 |
| -32003 | RequestCancelled | 超时或主动取消 |
| -32010 | ProjectNotFound | 项目不存在 |
| -32011 | SessionNotFound | 会话不存在 |
| -32012 | SessionBusy | 会话正在运行 |
| -32013 | MessageNotFound | 消息游标不存在 |
| -32020 | ProviderNotFound | 供应商不存在 |
| -32021 | ModelNotFound | 模型不存在 |
| -32022 | ProviderExists | 供应商 id 冲突 |
| -32030 | PathOutsideWorkspace | 路径越界 |
| -32031 | FileTooLarge | 文件超过 8 MiB |
| -32040 | DshApiMismatch | harness 版本不兼容 |
| -32050 | AgentNotFound | agent 不存在 |
| -32060 | PluginNotFound | 插件不存在 |
| -32061 | PluginInstallFailed | 安装失败 |
| -32062 | RegistryUnavailable | 仓库不可达 |

## 方法表

### system

| 方法 | 参数 | 结果 |
| --- | --- | --- |
| `system.ping` | — | `{pong:true}` |
| `system.info` | — | `ServerInfo` |
| `system.shutdown` | — | `{ok, mode}` |

`ServerInfo`：`{protocolVersion, dshVersion, profile, transports, pid, capabilities, mode}`。
`mode` 为 `live` 或 `replay`。

### workspace / project

| 方法 | 参数 | 结果 |
| --- | --- | --- |
| `workspace.list` | — | `{id,name,path}[]` |
| `project.list` | — | `ProjectInfo[]` |
| `project.ensure` | `{name,path}` | `ProjectInfo` |
| `project.remove` | `{projectId}` | `{ok}` |

`project.ensure` 以路径为准；同路径重复调用不会创建第二个项目。

### session

| 方法 | 参数 | 结果 |
| --- | --- | --- |
| `session.list` | `{projectId?,includeArchived?}` | `SessionInfo[]` |
| `session.get` | `{sessionId}` | `{session,messages}` |
| `session.history` | `{sessionId,before?,limit?}` | `{messages,hasMore,total}` |
| `session.create` | `{projectId,title?}` | `SessionInfo` |
| `session.append` | `{sessionId,content,attachments?}` | `{messageId,status}` |
| `session.cancel` | `{sessionId}` | `{ok}` |
| `session.rename` | `{sessionId,title}` | `{ok}` |
| `session.fork` | `{sessionId,fromMessageId?}` | `SessionInfo` |
| `session.archive` / `session.unarchive` | `{sessionId}` | `{ok}` |
| `session.delete` | `{sessionId}` | `{ok}` |

**分页语义**：`before` 是客户端已加载的最早一条消息 id；返回它之前的
`limit` 条（默认 30，上限 200）。省略 `before` 表示从最新往回取一页。
返回 `hasMore=false` 或空页时客户端停止翻页。

**附件语义**：`attachments` 为 `{kind:'file', path, name?}[]`。`path` 必须
是工作区内的绝对路径，服务端会做越界校验。live 模式下文件被投影为 harness
的 FileBlock；附件服务不可用时退化为带截断的文本内联。

**fork 限制**：harness 没有分支原语，`session.fork` 只在 replay 后端可用；
live 模式返回 `-32000` 并说明原因。

### model

| 方法 | 参数 | 结果 |
| --- | --- | --- |
| `model.providers.list` | — | `ProviderInfo[]` |
| `model.providers.add` | `{kind,id?,baseURL?,apiKey?,models?}` | `ProviderInfo` |
| `model.providers.sync` | `{providers?,replace?,defaultModel?}` | `{providers,models,defaultModel?,warnings}` |
| `model.providers.setKey` | `{providerId,apiKey}` | `{ok}` |
| `model.providers.remove` | `{providerId}` | `{ok}` |
| `model.list` | `{providerId?}` | `ModelInfo[]` |
| `model.getDefault` | — | `{modelId?,effort?}` |
| `model.setDefault` | `{modelId,sessionId?,effort?}` | `{ok}` |

`model.setDefault` 的三种效果：

1. 持久化全局默认模型，影响之后创建或恢复的 agent；
2. 带 `effort` 时更新全局思考强度；
3. 带 `sessionId` 时，立即作用于该会话已创建 agent 的**下一轮**请求
   （通过可变 model selection，无需重建 agent）。

密钥永不回传。`hasKey` 只表示“可用凭据存在”。

### agent

| 方法 | 参数 | 结果 |
| --- | --- | --- |
| `agent.list` | `{sessionId}` | `AgentInfo[]` |
| `agent.tree` | `{sessionId}` | `AgentNode[]` |
| `agent.get` | `{sessionId,agentId}` | `AgentInfo` |
| `agent.cancel` | `{sessionId,agentId}` | `{ok}` |

`AgentNode` 是 `AgentInfo` 加 `children`。主 agent 的 id 固定为 `root`；
父节点缺失的子 agent 会挂到 root 下，界面始终只有一棵树。

`agent.cancel` 现在会真正终止 harness 子 agent，而不只是改写本地记录：
`agentId=root` 等价于终止整轮（`session.cancel`），未知或已结束的 id
返回 `-32602`，避免客户端误以为它停下了什么。

### permission / approval

| 方法 | 参数 | 结果 |
| --- | --- | --- |
| `permission.get` | `{sessionId?}` | `PermissionState` |
| `permission.set` | `{sessionId,preset}` | `PermissionState` |
| `approval.respond` | `{requestId,outcome}` | `{ok}` |

```ts
PermissionState = {
  available: boolean            // harness 未装配权限服务时为 false
  options: {value,name,description?}[]
  preset?: string               // 当前生效的预设，或派生的 'custom'
  defaultPreset?: string
  sandbox?: string              // 预设背后的沙箱级别
  approval?: string             // 预设背后的审批策略 ask | never
}
```

`permission.set` 由 harness 的预设服务同时改写沙箱模式与审批策略，**立即对
该会话生效**，无需重启或新建一轮。未知预设返回 `-32602`；会话仅在元数据中
存在时，网关会先创建或恢复对应 agent 再应用。

`approval.respond` 回答 harness 的 `approval/request` 瀑布。网关是唯一的
回答者：未回答（无人连接、5 分钟内无响应或请求被撤销）一律**失败关闭**，
被阻塞的工具调用不会执行。`allowed-once` 只授予当前这一次调用。

### file

| 方法 | 参数 | 结果 |
| --- | --- | --- |
| `file.list` | `{query?,maxFiles?}` | `{files,truncated}` |
| `file.readText` | `{path}` | `{path,content}` |
| `file.stat` | `{path}` | `{path,size,mtime,isDirectory}` |

`file.list` 遍历已注册工作区，跳过 VCS、依赖与缓存目录（`.git`、`node_modules`、
`dist` 等）、符号链接与超过 12 层的目录，默认上限 5000 个文件。

### plugin

| 方法 | 参数 | 结果 |
| --- | --- | --- |
| `plugin.list` | — | `{plugins,bundles}` |
| `plugin.registry.search` | `{query,size?}` | `{registry,results,error?}` |
| `plugin.registry.inspect` | `{spec}` | `{status,...}` |
| `plugin.install` | `{spec}` | `{requestId}` |
| `plugin.install.cancel` | `{requestId}` | `{status}` |
| `plugin.uninstall` | `{name}` | `PluginChangeResult` |
| `plugin.setEnabled` | `{kind,id,enabled}` | `PluginChangeResult` |

安装是异步的：立即返回 `requestId`，进度经 `plugin.event` 推送。

### config

| 方法 | 参数 | 结果 |
| --- | --- | --- |
| `config.get` | `{keys?}` | `Record<string,unknown>` |
| `config.set` | `{patch}` | `{ok,applied,config}` |

## 通知

| 方法 | 载荷 | 范围 |
| --- | --- | --- |
| `session.event` | `{sessionId,event}` | 按会话订阅 |
| `session.status` | `{sessionId,status}` | 按会话订阅 |
| `agent.event` | `{sessionId,agent}` | 按会话订阅 |
| `model.changed` | `{providerId?,modelId?}` | 全局 |
| `plugin.event` | `PluginEventParams` | 全局 |
| `approval.request` | `{sessionId,requestId,toolName,callId?,reason?,agentId?,timeoutMs?}` | 全局 |
| `permission.changed` | `{sessionId?,preset}` | 按会话订阅 |
| `system.shutting-down` | `{reason,clientId?}` | 全局 |

stdio 只有一个客户端，全部下发。tcp/unix 下带 `sessionId` 的通知只发给
订阅了该会话的连接；`approval.request` 例外，它**不带会话过滤**——面板没开
也必须能弹窗批准，否则请求会超时失败。

### SessionEvent

```ts
{
  id: string
  seq: number
  ts: string
  type:
    | 'user.message' | 'assistant.message'
    | 'text.delta' | 'reasoning.delta'
    | 'tool.call' | 'tool.result'
    | 'context.inject' | 'error'
    | 'agent.spawn' | 'agent.status' | 'agent.result'
  role?: 'user' | 'assistant' | 'system' | 'tool'
  text?: string
  tool?: { id, name, args, status, result?, durationMs? }
  agent?: { id, parentId?, name?, kind?, status?, task? }
}
```

`agent` 缺省表示主 agent。`text.delta` 与 `reasoning.delta` 是增量；
`assistant.message` 是一轮的完整文本，客户端应以它为准做最终回填。

## 鉴权

- `stdio`：进程由客户端创建，视为已认证。
- `tcp` / `unix`：必须配置 `token`，首条请求为
  `{"method":"auth","params":{"token":"..."}}`；失败返回 `-32001` 并保持未认证状态。

token 比较使用 `timingSafeEqual`；长度不同直接失败。

## 订阅

```json
{"jsonrpc":"2.0","method":"session.subscribe","params":{"sessionId":"s_..."}}
{"jsonrpc":"2.0","method":"session.unsubscribe","params":{"sessionId":"s_..."}}
```

订阅是连接级状态，重连后客户端需要重新发送。stdio 下订阅无副作用，但保留
同一套语义，便于客户端只实现一条路径。

## 兼容性检查清单

新增方法时：

1. `protocol/src/methods.ts` 加入 `MethodMap`；
2. 实现对应 handler（类型缺失会编译失败）；
3. `CAPABILITIES` 增加能力名（若客户端需要降级）；
4. 更新本文件与 `docs/protocol.html`；
5. 只在主版本变化时改变既有字段语义。
