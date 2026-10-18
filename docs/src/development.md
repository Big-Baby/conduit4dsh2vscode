# 开发

## 环境

| 工具 | 版本 |
| --- | --- |
| Node.js | 22.11+ |
| npm | 10+ |
| dsh | 0.2.x |
| VS Code | 1.85+ |

```bash
npm install          # 安装三个 workspace
npm run typecheck    # protocol + bridge + extension
npm run build        # 扩展（宿主 + 对话区）
npm test             # 对话区单元测试
npm run docs         # 生成 docs/*.html
```

`bridge` 在 `stubs/dsh.d.ts` 中声明了 harness 的最小类型面，因此没有安装
`@deepseek-ai/*` 时也能完成类型检查；生产构建会解析真实包。

## 构建

| 产物 | 工具 | 说明 |
| --- | --- | --- |
| `bridge/lib/index.js` | esbuild | ESM，`@deepseek-ai/*` 保持 external |
| `extension/dist/extension.js` | esbuild | CJS 单文件，`vscode` external |
| `extension/dist/chat/*` | vite | IIFE + 单 CSS，供 Webview 内联 |

`@conduit4dsh2vscode/protocol` 在三个产物中都被内联，运行时没有 workspace 依赖，
vsix 不需要携带 `node_modules`。

对话区的两个构建约束：

1. **单文件 IIFE**：宿主只注入一个带 nonce 的脚本，多 chunk 需要逐个加 nonce；
2. **显式替换 `process.env.NODE_ENV`**：lib 模式不会自动替换，Webview 没有
   `process` 全局，残留引用会直接白屏。

## 本地联调

### 网关

```bash
cd bridge
npm run build
dsh --profile rpc --patch "$(pwd)/cordis.patch.yml"
```

或直接挂载源码（需要 tsx）：

```bash
dsh --profile rpc --patch "$(pwd)/cordis.yml"
```

冒烟：

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"system.info"}' \
  '{"jsonrpc":"2.0","id":2,"method":"project.list"}' \
  | dsh --profile rpc
```

stdio 模式下进程随 stdin 关闭退出。用 FIFO 保持 stdin 常开可以观察事件流：

```bash
mkfifo /tmp/dsh-in
dsh --profile rpc < /tmp/dsh-in | tee /tmp/dsh-out &
exec 3>/tmp/dsh-in
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"system.info"}' >&3
```

### 扩展

```bash
cd extension
npm run compile
code --extensionDevelopmentPath="$(pwd)"
```

`F5` 使用 `.vscode/launch.json` 时，确保 `outFiles` 指向 `dist/**`。

### 无模型环境

不配置任何 provider 时会进入 replay 后端：消息正常收发，但回复是本地回执。
这适合验证协议、分页、折叠与变更跟踪，不需要网络与额度。

## 测试

```bash
cd extension && npm run webview:test
```

当前覆盖卡片状态机：

- 同轮增量复用同一张卡；
- 跨轮增量关闭旧卡；
- 完整消息回填流式卡，不产生重复；
- 前缀残卡清理；
- 工具卡按 id upsert；
- 批量折叠跳过流式卡。

涉及 DOM 的行为（滚动补偿、提及弹层）建议在扩展开发宿主中手工验证，或在
`happy-dom` 中补充交互测试。

## 部署到远端

扩展是 `workspace` 类型，必须装在远端扩展宿主。推荐流程：

```bash
# 本地构建并用服务端 code-server 安装
npm run build
cd extension && npm run package
scp conduit4dsh2vscode-0.8.0.vsix user@host:/tmp/
ssh user@host 'code-server --install-extension /tmp/conduit4dsh2vscode-0.8.0.vsix'
```

网关更新只需覆盖 `lib/`：

```bash
rsync -a --exclude node_modules bridge/ user@host:/opt/dsh/bridge/
```

`deploy/setup.sh` 把上述步骤串成一条命令，支持本机与 `--remote user@host`。

## 排障

| 现象 | 排查 |
| --- | --- |
| 连接失败 `CLI not found` | 设置 `dsh.cliPath`，或执行 `DSH: Install CLI` |
| 面板空白、无样式 | 检查 `dist/chat` 是否生成；确认 CSP 使用 `cspSource` 而非 `'self'` |
| 历史为空 | 查看 `$DSH_HOME/bridge.log` 是否记录 `sessionQuery` 缺失与日志回退 |
| 模型列表为空 | `dsh.providerConfig` 为空时属正常；用 `DSH: Add Provider` 添加 |
| 429 | 网关已按 6 次 / 2s→60s 重试；仍失败说明配额耗尽，需等待或换模型 |
| 插件页空白 | 旧版网关没有 `plugin-management` 能力，升级 `bridge` |
| 配置保存后卡住 | 确认没有在插件激活期写配置；启动同步必须延后到 `apply` 返回后 |

诊断日志：

- `$DSH_HOME/bridge.log`：网关装配、路由写入、凭据迁移、事件流异常；
- VS Code 输出面板 `DSH`：连接、CLI 解析、bootstrap、命令结果。

## 发布清单

1. 三个 `package.json` 版本一致；
2. `npm run typecheck`、`npm test` 通过；
3. `npm run build` 生成 `dist/extension.js` 与 `dist/chat/*`；
4. `npm run docs` 重新生成 HTML；
5. `CHANGELOG.md` 写明变更；
6. `cd extension && npm run package` 生成 vsix；
7. 在干净环境安装：连接、发消息、分页、变更、插件各验证一次。

## 约定

- TypeScript strict，禁止 `any` 出现在跨层接口；
- 注释只解释“为什么”，不复述代码；
- 新增 RPC 方法先改 `protocol`，让编译错误驱动实现；
- 不在 `core` 中引用 `vscode`，不在 `bridge/core` 中引用 `rpc`。
