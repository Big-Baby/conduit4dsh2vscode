# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.1] - 2026-10-22

### Added

- **Permission management.** The chat header and the status bar now expose the
  harness permission presets (`read-only`, `workspace-write`,
  `danger-full-access`). Switching is applied to the live session immediately
  through `dsh-permission-presets`, which moves the sandbox mode and the
  approval policy together; no restart and no new turn is needed. New RPC
  methods: `permission.get` and `permission.set`; new notification
  `permission.changed`.
- **Approval prompts.** The bridge now answers the harness
  `approval/request` waterfall. A tool action that needs to leave the sandbox
  raises a modal in the editor with *Allow once* / *Deny*; the grant is
  one-shot and nothing is remembered. Unanswered questions fail closed: after
  five minutes, or when no client is attached, the tool action is denied rather
  than allowed. New RPC method: `approval.respond`; new notification
  `approval.request`.
- **Real sub-agent termination.** `agent.cancel` used to rewrite the registry
  and emit an event while the harness agent kept running. Live sub-agent handles
  are now tracked per conversation, so stopping one actually stops it; stopping
  the turn cancels the root *and* every live sub-agent.
- Commands `DSH: Set Permission` and `DSH: Show Permission Details`; `Esc` in the
  transcript stops the running turn; each running sub-agent has its own *Stop*
  button; the chat header shows the active preset next to the model picker.

### Fixed

- Stopping a turn left every in-flight tool card on `(running)` forever: the
  harness never reports a result for an interrupted call. Interrupted calls are
  now closed as `cancelled`, both in the bridge and in the transcript.
- A client closing `stdin` while a notification was in flight crashed the bridge
  with an unhandled `EPIPE`.
- Resuming a conversation emitted a bogus `sub-agent … started` system note,
  because `agent/created` fires for the conversation root as well.
- `session.cancel` marked the root agent `cancelled` in the registry, which
  misreported the session as cancelled after the next turn had started.

### Changed

- Protocol 1.1 (major unchanged): adds `permission-management`,
  `approval-prompts` and `subagent-cancel` capabilities. A 1.0 bridge omits
  them and the client hides the affected controls instead of failing.
- The permission control is hidden when the harness composes no permission
  service, and the status bar hides when no session is open.

## [0.8.0] - 2026-10-18

### Fixed

- extension: the DSH activity-bar container could stay hidden indefinitely, and
  every view inside it was gated on `dsh.connected`, so opening it showed an
  empty panel. `Sessions` is now always visible and renders a connect prompt.
- extension: the model picker degraded to an empty `<select>` when no provider
  exposed any model; it is now an explicit "No model — add provider" button.
- extension: cards were squeezed instead of scrolled. `.message-list` and
  `.agent-body` are flex columns, so items shrank to fit the viewport and
  `scrollHeight` never exceeded `clientHeight`, which killed scrolling entirely.
- extension: live output re-pinned the transcript on every chunk, so manual
  scrolling was impossible while an agent was running. Following is now
  positional (only when already near the bottom).
- extension: tool cards stayed on `running` forever. The bridge never subscribed
  to the harness `session/event` stream where `tool/result` is published, so no
  outcome was ever forwarded.
- extension: partial JSON arguments were printed as a bare `{`, and tool output
  containing undecodable bytes filled the card with replacement glyphs.
- extension: concurrent bootstrap (auto-connect, workspace-folder change, panel
  creation) spawned several bridges and created duplicate empty sessions.
- extension: `chat/tsconfig.json` pointed `include` at a non-existent `src/`
  directory, so `vue-tsc` exited with TS18003 and the webview was never checked.

### Changed

- extension: removed the OpenCode Zen preset and its free-tier heuristic from the
  provider setup panel; only generic OpenAI-compatible presets remain.

### Removed

- All provider and credential material: the shipped code contains no preset
  gateway, no API key and no token.

## [0.8.0] - 2026-10-18

First public release. The codebase was rebuilt as a three-package monorepo with
an explicit protocol contract.

### Added

- `protocol`: JSON-RPC 2.0 method table, DTOs, events, error codes and NDJSON
  framing shared by both sides.
- `bridge`: dsh transport plugin with stdio/tcp/unix transports, token
  authentication, session event streaming and per-session subscriptions.
- `bridge`: live agent backend (real harness loop) with automatic fallback to a
  local replay backend when the loop or a model provider is unavailable.
- `bridge`: session history reconstructed from the harness session log,
  including multi-frame zstd files and damaged-frame recovery.
- `bridge`: provider catalog with credential references, LLM route registration
  and a 429-oriented retry policy.
- `bridge`: plugin management (list, registry search, install with progress,
  enable/disable, uninstall).
- `extension`: connection state machine with heartbeat and bounded reconnect,
  CLI auto-detection (config → PATH → npx).
- `extension`: chat panel (Vue 3) with streaming cards, reasoning blocks, tool
  calls, agent grouping, `@` file mentions and history paging.
- `extension`: session, model, agent, change and plugin tree views.
- `extension`: change tracking with a git baseline (`git stash create`) or a
  file snapshot outside git, including whitelist filtering and per-file revert.
- `extension`: theme palette, folding preferences and a single-page provider
  setup panel.
- `docs`: Markdown sources plus generated HTML with Mermaid diagrams and
  highlight.js.
- `deploy`: local and remote installation scripts.

### Known limitations

- `session.fork` requires the replay backend; the harness exposes no branching
  primitive.
- Sub-agents are attributed to the most recently active root session when
  several sessions run concurrently.
- Plugin search requires network access to the configured registry.

[0.8.0]: https://github.com/conduit4dsh2vscode/conduit4dsh2vscode/releases/tag/v0.8.0
