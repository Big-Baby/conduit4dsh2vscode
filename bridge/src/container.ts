import type { Context } from '@deepseek-ai/cordis';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { PluginEventParams } from '@conduit4dsh2vscode/protocol';
import type { BridgeConfig } from './config';
import { AgentRegistry } from './core/agent-registry';
import { ModelService } from './core/model-service';
import { PermissionService } from './core/permission-service';
import { ProjectService } from './core/project-service';
import { SessionService } from './core/session-service';
import { SessionMetaStore } from './core/session-store';
import { SettingsService } from './core/settings-service';
import { WorkspaceFiles } from './core/workspace-files';
import { Harness } from './dsh/context';
import { PluginAdmin } from './dsh/plugins';
import { readDshVersion } from './dsh/version';
import { LiveBackend } from './runtime/live-backend';
import { Logger } from './runtime/logger';
import { ReplayBackend } from './runtime/replay-backend';
import { SessionEventHub } from './runtime/events';
import { createHandlers } from './rpc/handlers';
import { Router } from './rpc/router';
import { RpcServer } from './rpc/server';
import { migrateLegacyState } from './store/migrate';
import { bridgePaths } from './store/paths';

/**
 * Composition root.
 *
 * Construction order is deliberate: stores, adapters, domain services,
 * transport. Nothing below the transport layer knows that JSON-RPC exists.
 */
export class BridgeRuntime {
  private constructor(
    private readonly server: RpcServer,
    private readonly models: ModelService,
    private readonly live: LiveBackend | undefined,
    private readonly plugins: PluginAdmin,
    private readonly permissions: PermissionService,
    private readonly config: BridgeConfig,
  ) {}

  static async create(ctx: Context, config: BridgeConfig): Promise<BridgeRuntime> {
    const home = process.env.DSH_HOME ?? join(homedir(), '.dsh');
    const paths = bridgePaths(home);
    migrateLegacyState(home, paths);

    const log = new Logger(paths.log, ctx.logger);
    const harness = new Harness(ctx);
    const registry = new AgentRegistry(paths);
    const hub = new SessionEventHub(registry);
    const meta = new SessionMetaStore(paths);

    const replay = new ReplayBackend(hub, paths);
    const live = await createLiveBackend({ harness, home, hub, log });

    const projects = new ProjectService(paths, meta);
    const sessions = new SessionService({
      replay,
      ...(live ? { live } : {}),
      meta,
      hub,
      agents: registry,
      paths,
      log,
    });

    const modelListeners = new Set<(info: { providerId?: string; modelId?: string }) => void>();
    const models = new ModelService({
      harness,
      paths,
      log,
      onChanged: (info) => {
        for (const listener of modelListeners) listener(info);
      },
      applyEffort: (effort) => sessions.setDefaultEffort(effort),
      selectSessionModel: (sessionId, provider, model, effort) =>
        sessions.selectModel(sessionId, provider, model, effort),
    });

    const plugins = new PluginAdmin(harness, log);
    plugins.subscribe();

    const permissions = new PermissionService({
      harness,
      log,
      sessionIdOfAgent: (agent) => live?.sessionIdOfAgent(agent),
      ensureSession: (sessionId) => live?.ensureLive(sessionId) ?? Promise.resolve(false),
    });
    permissions.install();

    const roots = (): string[] => {
      const all = new Set<string>([process.cwd()]);
      for (const project of projects.list()) all.add(project.path);
      return [...all];
    };
    const files = new WorkspaceFiles(roots);
    const settings = new SettingsService(paths);

    const router = new Router();
    const lifecycle = { shutdown: () => undefined as void };

    router.registerAll(
      createHandlers({
        projects,
        sessions,
        models,
        files,
        settings,
        plugins,
        permissions,
        system: {
          dshVersion: readDshVersion(home),
          profile: process.env.DSH_PROFILE ?? 'rpc',
          transport: config.transport,
          mode: sessions.mode,
          onShutdown: () => lifecycle.shutdown(),
        },
        config: { profile: process.env.DSH_PROFILE ?? 'rpc', home },
      }),
    );

    const binding = {
      bind(publish: (method: string, params: unknown, sessionId?: string) => void): Array<() => void> {
        const disposes: Array<() => void> = [
          hub.onEvent((sessionId, event) => publish('session.event', { sessionId, event }, sessionId)),
          hub.onStatus((sessionId, status) => publish('session.status', { sessionId, status }, sessionId)),
          hub.onAgent((sessionId, agent) => publish('agent.event', { sessionId, agent }, sessionId)),
          plugins.onEvent((params: PluginEventParams) => publish('plugin.event', params)),
          permissions.onChanged((event) => publish('permission.changed', event, event.sessionId)),
          // Approvals are a client-wide duty, not a per-session stream: a closed
          // panel must not swallow the question. Broadcast without a session id.
          permissions.onAsk((ask) => publish('approval.request', ask)),
        ];
        modelListeners.add((info) => publish('model.changed', info));
        disposes.push(() => modelListeners.clear());
        return disposes;
      },
    };

    const server = new RpcServer(
      router,
      binding,
      {
        transport: config.transport,
        host: config.host,
        port: config.port,
        socketPath: config.socketPath.replace(/^~/, homedir()),
        token: config.token,
      },
      log,
    );

    const runtime = new BridgeRuntime(server, models, live, plugins, permissions, config);
    lifecycle.shutdown = () => runtime.shutdown();

    // Optional debug handle. cordis requires `provide` before `set`, and some
    // versions expose only one of them; failing here must not affect the bridge.
    try {
      if (typeof ctx.provide === 'function') ctx.provide('dshBridge', runtime);
      else if (typeof ctx.set === 'function') ctx.set('dshBridge', runtime);
    } catch {
      /* the service is a convenience, not a requirement */
    }

    return runtime;
  }

  get mode(): 'live' | 'replay' {
    return this.live ? 'live' : 'replay';
  }

  start(): void {
    this.server.start();
    // Runs after activation completes; see ModelService.scheduleStartupSync.
    this.models.scheduleStartupSync();
  }

  stop(): void {
    this.server.stop();
    this.permissions.dispose();
    this.live?.dispose();
    this.plugins.dispose();
  }

  /** Honours `system.shutdown`: stdio owns the process, sockets only stop serving. */
  shutdown(): void {
    this.stop();
    if (this.config.transport === 'stdio') setTimeout(() => process.exit(0), 50);
  }
}

async function createLiveBackend(input: {
  harness: Harness;
  home: string;
  hub: SessionEventHub;
  log: Logger;
}): Promise<LiveBackend | undefined> {
  if (process.env.DSH_RPC_LIVE === '0') return undefined;
  if (!input.harness.agents || !input.harness.sessions) {
    input.log.info('live backend skipped: agents/sessions service unavailable');
    return undefined;
  }

  const backend = new LiveBackend({
    agents: input.harness.agents,
    sessions: input.harness.sessions,
    sessionQuery: input.harness.sessionQuery,
    defaultModel: input.harness.defaultModel,
    attachments: input.harness.attachments,
    home: input.home,
    hub: input.hub,
    log: input.log,
    on: (event, handler) => input.harness.on(event, handler),
  });

  await backend.init();
  if (!backend.available) {
    backend.dispose();
    input.log.warn('live backend unavailable; falling back to replay');
    return undefined;
  }
  return backend;
}
