import {
  ErrorCode,
  RpcError,
  createId,
  type DefaultModelSelection,
  type ModelInfo,
  type ProviderInfo,
  type ProviderSyncInput,
  type ProviderSyncResult,
} from '@conduit4dsh2vscode/protocol';
import type { Harness } from '../dsh/context';
import { JsonStore } from '../store/json-store';
import type { BridgePaths } from '../store/paths';
import type { Logger } from '../runtime/logger';

const LLM_NAMESPACE = 'llm-pi-ai';

/**
 * Provider-level retry policy written into every route.
 *
 * Quota-style 429s need longer backoff than the harness default, and a
 * `Retry-After` larger than the maximum delay would otherwise disable retries
 * entirely.
 */
const RETRY_POLICY = {
  mode: 'normal',
  maxRetries: 6,
  backoff: { initialDelayMs: 2000, maxDelayMs: 60000, jitterRatio: 0.25 },
} as const;

export interface ModelServiceDeps {
  harness: Harness;
  paths: BridgePaths;
  log: Logger;
  onChanged: (info: { providerId?: string; modelId?: string }) => void;
  applyEffort: (effort: string | undefined) => void;
  selectSessionModel: (sessionId: string, provider: string, model: string, effort?: string) => boolean;
}

/**
 * Provider catalog, credentials and default-model selection.
 *
 * Secrets never enter the bridge store or the harness settings: they are
 * written to the harness credential service and referenced by name.
 */
export class ModelService {
  private readonly providers: JsonStore<ProviderInfo[]>;
  private readonly selection: JsonStore<DefaultModelSelection>;
  private postSync: Promise<void> | undefined;
  private inPostSync = false;

  constructor(private readonly deps: ModelServiceDeps) {
    this.providers = new JsonStore<ProviderInfo[]>(deps.paths.providers, () => []);
    this.selection = new JsonStore<DefaultModelSelection>(deps.paths.defaultModel, () => ({}));
  }

  /* ------------------------------ catalog ------------------------------ */

  listProviders(): ProviderInfo[] {
    return this.providers.read().map((provider) => ({
      ...provider,
      models: provider.models.map((model) => ({ ...model, providerId: provider.id })),
    }));
  }

  listModels(providerId?: string): ModelInfo[] {
    const all = this.listProviders().flatMap((provider) => provider.models);
    return providerId ? all.filter((model) => model.providerId === providerId) : all;
  }

  async addProvider(input: {
    id?: string;
    kind: string;
    baseURL?: string;
    apiKey?: string;
    models?: Array<Pick<ModelInfo, 'id' | 'name' | 'inputTypes'>>;
  }): Promise<ProviderInfo> {
    const providers = this.listProviders();
    const id = input.id?.trim() || createId('pv');
    if (providers.some((provider) => provider.id === id)) {
      throw new RpcError(ErrorCode.ProviderExists, `provider already exists: ${id}`, { providerId: id });
    }

    const provider: ProviderInfo = {
      id,
      kind: input.kind,
      ...(input.baseURL ? { baseURL: input.baseURL } : {}),
      hasKey: Boolean(input.apiKey),
      models: (input.models ?? []).map((model) => ({ ...model, providerId: id })),
    };

    providers.push(provider);
    this.providers.write(providers);
    if (input.apiKey) await this.writeCredential(id, input.apiKey);

    await this.syncRoutes(providers);
    this.deps.onChanged({ providerId: id });
    return provider;
  }

  /**
   * Declarative, idempotent provider sync used by `dsh.providerConfig`.
   *
   * Same id updates instead of failing, `replace` drops entries that are not in
   * the payload, and secrets may come from an environment variable so they do
   * not end up in settings.json.
   */
  async syncProviders(input: {
    providers?: ProviderSyncInput[];
    replace?: boolean;
    defaultModel?: string;
  }): Promise<ProviderSyncResult> {
    const warnings: string[] = [];
    const incoming = input.providers ?? [];
    if (!Array.isArray(incoming)) {
      throw new RpcError(ErrorCode.InvalidParams, 'providers must be an array');
    }

    const existing = this.listProviders();
    const untouched = new Map(existing.map((provider) => [provider.id, provider]));
    const next: ProviderInfo[] = [];

    for (const raw of incoming) {
      if (!raw || typeof raw !== 'object') {
        warnings.push('skipped a non-object provider entry');
        continue;
      }

      const id = String(raw.id ?? '').trim();
      if (!id) {
        warnings.push('skipped a provider without id');
        continue;
      }

      const kind = String(raw.kind ?? id).trim() || id;
      const models = normalizeModels(raw.models, id);
      if (!models.length) warnings.push(`provider ${id} has no models`);

      const previous = untouched.get(id);
      const provider: ProviderInfo = {
        id,
        kind,
        hasKey: previous?.hasKey ?? false,
        models,
        ...(raw.baseURL?.trim()
          ? { baseURL: raw.baseURL.trim() }
          : previous?.baseURL
            ? { baseURL: previous.baseURL }
            : {}),
      };

      const envName = raw.apiKeyEnv?.trim();
      const inlineKey = raw.apiKey ?? '';
      if (envName) {
        const value = process.env[envName];
        if (value) {
          await this.writeCredential(id, value);
          provider.hasKey = true;
        } else {
          warnings.push(`provider ${id}: environment variable ${envName} is not set`);
        }
      } else if (inlineKey) {
        await this.writeCredential(id, inlineKey);
        provider.hasKey = true;
      }

      next.push(provider);
      untouched.delete(id);
    }

    const final = input.replace ? next : [...next, ...untouched.values()];
    this.providers.write(final);
    await this.syncRoutes(final, input.replace === true);

    let defaultModel: string | undefined;
    const requested = input.defaultModel?.trim();
    if (requested) {
      const hit = final.flatMap((provider) => provider.models).find((model) => model.id === requested);
      if (hit) {
        this.selection.write({ modelId: hit.id });
        defaultModel = hit.id;
        this.deps.onChanged({ modelId: hit.id });
        await this.saveHarnessSelection(hit.providerId, hit.id);
      } else {
        warnings.push(`default model ${requested} is not in the synced catalog and was ignored`);
      }
    }

    return {
      providers: final.length,
      models: final.reduce((count, provider) => count + provider.models.length, 0),
      ...(defaultModel ? { defaultModel } : {}),
      warnings,
    };
  }

  async setProviderKey(providerId: string, apiKey: string): Promise<void> {
    const providers = this.listProviders();
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) {
      throw new RpcError(ErrorCode.ProviderNotFound, `provider not found: ${providerId}`, { providerId });
    }

    provider.hasKey = true;
    this.providers.write(providers);
    await this.writeCredential(providerId, apiKey);
    await this.syncRoutes(providers);
    this.deps.onChanged({ providerId });
  }

  async removeProvider(providerId: string): Promise<void> {
    this.providers.write(this.listProviders().filter((provider) => provider.id !== providerId));
    await this.removeCredential(providerId);
    await this.unsetRoute(providerId);
    this.deps.onChanged({ providerId });
  }

  /* ------------------------------ default model ------------------------------ */

  getDefault(): DefaultModelSelection {
    const stored = this.selection.read();
    return {
      ...(stored.modelId ? { modelId: stored.modelId } : {}),
      ...(stored.effort ? { effort: stored.effort } : {}),
    };
  }

  async setDefault(modelId: string, sessionId?: string, effort?: string): Promise<void> {
    const model = this.listModels().find((item) => item.id === modelId);
    if (!model) throw new RpcError(ErrorCode.ModelNotFound, `model not found: ${modelId}`, { modelId });

    const trimmedEffort = effort?.trim() || undefined;
    this.selection.write({
      modelId,
      ...(trimmedEffort ? { effort: trimmedEffort } : {}),
    });
    this.deps.onChanged({ modelId });

    this.deps.applyEffort(trimmedEffort);
    await this.saveHarnessSelection(model.providerId, model.id);

    if (sessionId) {
      this.deps.selectSessionModel(sessionId, model.providerId, model.id, trimmedEffort);
    }
  }

  /* ------------------------------ startup sync ------------------------------ */

  /**
   * Runs once after activation.
   *
   * Config writes reload the profile, which waits for every plugin fiber to
   * become active; doing this inside `apply()` would wait on ourselves. The
   * promise is created eagerly so concurrent RPC writes can queue behind it.
   */
  scheduleStartupSync(): void {
    this.postSync = new Promise<void>((resolve) => {
      setTimeout(() => {
        void this.runStartupSync().finally(resolve);
      }, 0);
    });
  }

  private async runStartupSync(): Promise<void> {
    this.inPostSync = true;
    try {
      await this.guard('reconcileDefaultModel', 15_000, () => this.reconcileDefaultModel());
      await this.guard('migrateCredentials', 15_000, () => this.migrateCredentials());
      const providers = this.listProviders();
      if (providers.some((provider) => provider.baseURL)) {
        await this.guard('resyncRoutes', 20_000, () => this.syncRoutes(providers));
      }
    } finally {
      this.inPostSync = false;
    }
  }

  private async reconcileDefaultModel(): Promise<void> {
    const { modelId, effort } = this.getDefault();
    if (!modelId) return;
    const model = this.listModels().find((item) => item.id === modelId);
    if (!model) return;
    this.deps.applyEffort(effort);
    await this.saveHarnessSelection(model.providerId, model.id);
  }

  /** Moves legacy credentials (`ref = providerId`) to the namespaced ref. */
  private async migrateCredentials(): Promise<void> {
    const credentials = this.deps.harness.credentials;
    if (!credentials?.set || !credentials.resolve) return;

    for (const provider of this.listProviders()) {
      if (!provider.hasKey) continue;
      const ref = credentialRef(provider.id);
      if (provider.id === ref || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(provider.id)) continue;

      try {
        if ((await credentials.resolve(ref))?.value) continue;
        const legacy = await credentials.resolve(provider.id);
        if (!legacy?.value) continue;
        await credentials.set(ref, legacy.value);
        await credentials.unset?.(provider.id);
      } catch (error) {
        this.deps.log.warn(`credential migration ${provider.id} -> ${ref} failed: ${(error as Error).message}`);
      }
    }
  }

  /* ------------------------------ harness routes ------------------------------ */

  /**
   * Registers providers with the harness LLM router.
   *
   * The router ships dormant: a provider only becomes usable once it appears in
   * the `llm-pi-ai` settings section. Only credential references are written,
   * never secrets.
   */
  private async syncRoutes(providers: ProviderInfo[], replace = false): Promise<void> {
    const settings = this.deps.harness.settings;
    if (!settings) return;

    const routes: Record<string, unknown> = {};
    for (const provider of providers) {
      if (!provider.baseURL) continue;
      routes[provider.id] = {
        displayName: provider.id,
        baseURL: provider.baseURL,
        api: apiOf(provider.kind),
        ...(provider.hasKey ? { apiKeyEnv: credentialRef(provider.id) } : {}),
        retryPolicy: RETRY_POLICY,
        models: provider.models.map((model) => ({ id: model.id, name: model.name })),
      };
    }
    if (!Object.keys(routes).length) return;

    try {
      await this.awaitStartupSync();
      if (replace && settings.replace) await settings.replace(LLM_NAMESPACE, { providers: routes });
      else await settings.update?.(LLM_NAMESPACE, { providers: routes });
    } catch (error) {
      this.deps.log.warn(`writing ${LLM_NAMESPACE} routes failed: ${(error as Error).message}`);
    }
  }

  private async unsetRoute(providerId: string): Promise<void> {
    const settings = this.deps.harness.settings;
    if (!settings?.mutate) return;
    try {
      await this.awaitStartupSync();
      await settings.mutate(LLM_NAMESPACE, [{ op: 'unset', path: ['providers', providerId] }]);
    } catch (error) {
      this.deps.log.warn(`removing ${LLM_NAMESPACE} route ${providerId} failed: ${(error as Error).message}`);
    }
  }

  private async saveHarnessSelection(provider: string, model: string): Promise<void> {
    const service = this.deps.harness.defaultModel;
    if (!service?.saveSelection) return;
    try {
      await this.awaitStartupSync();
      await service.saveSelection({ provider, model });
    } catch (error) {
      this.deps.log.warn(`saveSelection(${provider}/${model}) failed: ${(error as Error).message}`);
    }
  }

  private async writeCredential(providerId: string, apiKey: string): Promise<void> {
    if (!/^[A-Za-z0-9._-]+$/.test(providerId)) {
      throw new RpcError(ErrorCode.InvalidParams, `invalid providerId: ${providerId}`);
    }
    if (!apiKey) return;

    await this.awaitStartupSync();
    const ref = credentialRef(providerId);
    const credentials = this.deps.harness.credentials;

    if (credentials?.set) {
      try {
        await credentials.set(ref, apiKey);
        return;
      } catch (error) {
        const message = (error as Error).message ?? '';
        // The launching environment is read-only but already wins at resolve time.
        if (/read-only by the launching environment/i.test(message)) return;
        this.deps.log.warn(`credentials.set(${ref}) failed: ${message}`);
      }
    }
    process.env[ref] = apiKey;
  }

  private async removeCredential(providerId: string): Promise<void> {
    await this.awaitStartupSync();
    const ref = credentialRef(providerId);
    try {
      await this.deps.harness.credentials?.unset?.(ref);
    } catch (error) {
      this.deps.log.warn(`credentials.unset(${ref}) failed: ${(error as Error).message}`);
    }
    delete process.env[ref];
  }

  private async awaitStartupSync(): Promise<void> {
    if (this.inPostSync || !this.postSync) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.postSync.catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 12_000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async guard(label: string, timeoutMs: number, run: () => Promise<void>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        run(),
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            this.deps.log.warn(`${label} exceeded ${timeoutMs}ms`);
            resolve();
          }, timeoutMs);
        }),
      ]);
    } catch (error) {
      this.deps.log.warn(`${label} failed: ${(error as Error).message}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/** `my-gateway` becomes `DSH_RPC_KEY_MY_GATEWAY`. */
export function credentialRef(providerId: string): string {
  return `DSH_RPC_KEY_${providerId.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}`;
}

export function apiOf(kind: string): string {
  const normalized = kind.toLowerCase();
  if (normalized.includes('anthropic') || normalized.includes('claude')) return 'anthropic-messages';
  return 'openai-completions';
}

function normalizeModels(
  input: ProviderSyncInput['models'],
  providerId: string,
): ModelInfo[] {
  if (!Array.isArray(input)) return [];
  const models: ModelInfo[] = [];
  const seen = new Set<string>();

  for (const item of input) {
    const id = (typeof item === 'string' ? item : String(item?.id ?? '')).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = typeof item === 'string' ? id : String(item?.name ?? id).trim() || id;
    models.push({ id, providerId, name });
  }
  return models;
}
