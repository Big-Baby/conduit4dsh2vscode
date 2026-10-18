# Contributing

## Setup

```bash
npm install
npm run typecheck
npm test
```

Node.js 22.11+ is required. `bridge` ships stub declarations for the harness, so
type checking works without installing `@deepseek-ai/*`; building the plugin for
production needs the real packages, which are provided by the dsh installation.

## Architecture rules

These are enforced by review, and mostly by the compiler:

1. `protocol` has no runtime dependencies.
2. `bridge/rpc` may depend on `core`, never on `dsh/*` directly.
3. `bridge/core` may depend on `dsh/*` and `store`, never on `rpc`.
4. `extension/core` must not import views; `extension/views` must not import
   `rpc` internals.
5. Only `extension/commands` may touch both services and views.

## Adding an RPC method

1. Add the entry to `MethodMap` in `protocol/src/methods.ts`.
2. Implement the handler; the `MethodHandlers` type makes a missing
   implementation a compile error.
3. Add a capability to `CAPABILITIES` if clients need to degrade.
4. Update `docs/src/protocol.md` and run `npm run docs`.
5. Add a client method only if the UI needs it.

## Style

- TypeScript strict; no `any` in cross-layer signatures.
- Comments explain intent or constraints, not the code that follows.
- UI strings are English; documentation is Chinese with English identifiers.
- Prefer named exports and small modules over classes with many methods.
- Errors carry a protocol error code; unknown failures map to `-32603`.

## Tests

`extension` uses Vitest with happy-dom. Card state transitions are pure
functions and must stay covered. For behaviour that needs a real webview, test
manually in the extension development host and note the steps in the PR.

## Pull requests

- Keep changes focused; separate protocol changes from UI changes.
- Include the commands you ran (`typecheck`, `test`, `build`).
- Update `CHANGELOG.md` under “Unreleased” for user-visible changes.
- Do not commit `dist/`, `node_modules/`, `*.vsix` or log files.
