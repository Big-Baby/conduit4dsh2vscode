import { get } from 'node:https';
import {
  ErrorCode,
  RpcError,
  type BundleItem,
  type PluginChangeResult,
  type PluginEventParams,
  type PluginInspectResult,
  type PluginInstallLog,
  type PluginItem,
  type RegistrySearchResult,
} from '@conduit4dsh2vscode/protocol';
import type { Harness, PluginManagerService } from './context';
import type { Logger } from '../runtime/logger';

interface SearchDocument {
  package?: {
    name?: string;
    version?: string;
    description?: string;
    keywords?: string[];
    date?: string;
  };
}

/**
 * Plugin management over the harness `pluginManager` service.
 *
 * Repository search is the only operation without a service counterpart: it
 * queries the registry's `/-/v1/search` endpoint, then `inspect` validates the
 * package before installation.
 */
export class PluginAdmin {
  private readonly listeners = new Set<(params: PluginEventParams) => void>();
  private readonly disposers: Array<() => void> = [];

  constructor(
    private readonly harness: Harness,
    private readonly log: Logger,
  ) {}

  get available(): boolean {
    return this.harness.pluginManager !== undefined;
  }

  onEvent(listener: (params: PluginEventParams) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Subscribes to harness plugin-manager events. */
  subscribe(): void {
    const forward = (params: PluginEventParams): void => {
      for (const listener of this.listeners) listener(params);
    };

    this.disposers.push(
      this.harness.on('plugin-manager/install-state', (payload) => {
        forward({ type: 'install-state', progress: payload as never });
      }),
      this.harness.on('plugin-manager/install-log', (payload) => {
        const chunk = payload as unknown as {
          requestId?: string;
          stream?: 'stdout' | 'stderr';
          text?: string;
          exitCode?: number | null;
        };
        const log: PluginInstallLog = {
          ...(chunk.requestId ? { requestId: chunk.requestId } : {}),
          stream: chunk.stream === 'stderr' ? 'stderr' : 'stdout',
          text: chunk.text ?? '',
          ...(chunk.exitCode !== undefined ? { exitCode: chunk.exitCode } : {}),
        };
        forward({ type: 'install-log', log });
      }),
      this.harness.on('plugin-manager/changed', (payload) => {
        const reason = (payload as unknown as { reason?: PluginEventParams['reason'] }).reason;
        forward({ type: 'changed', ...(reason ? { reason } : {}) });
      }),
    );
  }

  async list(): Promise<{ plugins: PluginItem[]; bundles: BundleItem[] }> {
    const manager = this.require();
    const [plugins, bundles] = await Promise.all([
      manager.listPlugins?.() ?? Promise.resolve([]),
      manager.listBundles?.() ?? Promise.resolve([]),
    ]);
    return { plugins: plugins as PluginItem[], bundles: bundles as BundleItem[] };
  }

  async search(query: string, size = 25): Promise<RegistrySearchResult> {
    const text = query.trim();
    if (!text) return { registry: null, results: [] };

    const registry = await this.resolveRegistry();
    const base = registry ?? 'https://registry.npmjs.org';
    const url = `${base.replace(/\/+$/, '')}/-/v1/search?text=${encodeURIComponent(text)}&size=${Math.min(Math.max(size, 1), 50)}`;

    try {
      const payload = await httpGetJson<{ objects?: SearchDocument[] }>(url, 10_000);
      const results = (payload.objects ?? [])
        .map((entry) => entry.package)
        .filter((entry): entry is NonNullable<SearchDocument['package']> => Boolean(entry?.name))
        .map((entry) => ({
          name: entry.name as string,
          version: entry.version ?? '',
          ...(entry.description ? { description: entry.description } : {}),
          ...(entry.keywords?.length ? { keywords: entry.keywords } : {}),
          ...(entry.date ? { date: entry.date } : {}),
        }));
      return { registry, results };
    } catch (error) {
      this.log.warn(`registry search failed for ${url}: ${(error as Error).message}`);
      return { registry, results: [], error: (error as Error).message };
    }
  }

  async inspect(spec: string): Promise<PluginInspectResult> {
    const manager = this.require();
    if (!manager.inspect) {
      throw new RpcError(ErrorCode.ServerNotReady, 'pluginManager.inspect is unavailable');
    }

    const raw = (await manager.inspect(spec)) as Record<string, unknown>;
    if (raw.status === 'refused') {
      return {
        status: 'refused',
        problem: String(raw.problem ?? 'unknown'),
        reason: String(raw.reason ?? ''),
      };
    }

    return {
      status: 'accepted',
      ...(typeof raw.kind === 'string' ? { kind: raw.kind as PluginInspectResult['kind'] } : {}),
      ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
      ...(typeof raw.version === 'string' ? { version: raw.version } : {}),
      ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
      bundle: (raw.bundle ?? null) as boolean | null,
    };
  }

  /**
   * Starts an installation and returns immediately.
   *
   * Package managers can run for minutes; the caller gets a request id and
   * follows progress through `plugin.event`.
   */
  async install(spec: string): Promise<{ requestId: string }> {
    const manager = this.require();
    if (!manager.installBundle) {
      throw new RpcError(ErrorCode.ServerNotReady, 'pluginManager.installBundle is unavailable');
    }

    const requestId = `pir_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const installBundle = manager.installBundle.bind(manager);

    void (async () => {
      try {
        const result = (await installBundle(spec, { requestId })) as Record<string, unknown>;
        if (result.changed !== true) {
          const code = (result.error as { code?: string } | undefined)?.code ?? '';
          const output = (result.packageResult as { output?: string } | undefined)?.output ?? '';
          this.emitFailure(requestId, `installation failed (${String(result.application ?? 'failed')}${code ? ` ${code}` : ''})`, output);
        }
      } catch (error) {
        this.emitFailure(requestId, `installation failed: ${(error as Error).message}`, '');
      }
    })();

    return { requestId };
  }

  async cancelInstall(requestId: string): Promise<{ status: string }> {
    const manager = this.require();
    if (!manager.cancelInstall) {
      throw new RpcError(ErrorCode.ServerNotReady, 'pluginManager.cancelInstall is unavailable');
    }
    const result = (await manager.cancelInstall(requestId)) as { status?: string };
    return { status: String(result?.status ?? 'not-running') };
  }

  async uninstall(name: string): Promise<PluginChangeResult> {
    const manager = this.require();
    if (!manager.removeBundle) {
      throw new RpcError(ErrorCode.ServerNotReady, 'pluginManager.removeBundle is unavailable');
    }
    return normalizeChange(await manager.removeBundle(name));
  }

  async setEnabled(kind: 'bundle' | 'plugin', id: string, enabled: boolean): Promise<PluginChangeResult> {
    const manager = this.require();
    if (kind === 'bundle') {
      if (!manager.setBundleEnabled) {
        throw new RpcError(ErrorCode.ServerNotReady, 'pluginManager.setBundleEnabled is unavailable');
      }
      return normalizeChange(await manager.setBundleEnabled(id, enabled));
    }
    if (!manager.setPluginEnabled) {
      throw new RpcError(ErrorCode.ServerNotReady, 'pluginManager.setPluginEnabled is unavailable');
    }
    return normalizeChange(await manager.setPluginEnabled(id, enabled));
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
    this.listeners.clear();
  }

  private require(): PluginManagerService {
    const manager = this.harness.pluginManager;
    if (!manager) {
      throw new RpcError(ErrorCode.ServerNotReady, 'pluginManager service is unavailable');
    }
    return manager;
  }

  private async resolveRegistry(): Promise<string | null> {
    try {
      const registries = await this.harness.pluginManager?.registries?.();
      return registries?.resolved ?? registries?.registry ?? null;
    } catch {
      return null;
    }
  }

  private emitFailure(requestId: string, summary: string, diagnostic: string): void {
    const text = `${summary}${diagnostic ? `\n${diagnostic.slice(-2000)}` : ''}`;
    for (const listener of this.listeners) {
      listener({ type: 'install-log', log: { requestId, stream: 'stderr', text, exitCode: -1 } });
    }
  }
}

function normalizeChange(raw: unknown): PluginChangeResult {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    changed: value.changed === true,
    application: (value.application ?? 'failed') as PluginChangeResult['application'],
    stage: (value.stage ?? 'install') as PluginChangeResult['stage'],
    target: String(value.target ?? ''),
    ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}),
    ...(typeof (value.error as { code?: string } | undefined)?.code === 'string'
      ? { errorCode: (value.error as { code: string }).code }
      : {}),
    ...(typeof (value.packageResult as { output?: string } | undefined)?.output === 'string'
      ? { diagnostic: ((value.packageResult as { output: string }).output ?? '').slice(-2000) }
      : {}),
    ...(Array.isArray(value.warnings) && value.warnings.length
      ? { warnings: value.warnings.map(String) }
      : {}),
  };
}

function httpGetJson<T>(url: string, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const request = get(url, { timeout: timeoutMs }, (response) => {
      const status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`registry returned HTTP ${status}`));
        return;
      }

      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
        } catch (error) {
          reject(new Error(`registry response is not JSON: ${(error as Error).message}`));
        }
      });
    });

    request.on('timeout', () => request.destroy(new Error(`registry timeout after ${timeoutMs}ms`)));
    request.on('error', reject);
  });
}
