import type { Context } from '@deepseek-ai/cordis';

/** A live agent handle as exposed by the harness agent service. */
export interface LiveAgent {
  readonly session: { id: string; seq: number };
  readonly status: string;
  readonly id?: string;
  followup(message: unknown): void;
  whenIdle(): Promise<void>;
  cancel(cause: unknown): void;
}

export interface AgentsService {
  create(options: {
    sessionId: string;
    meta?: Record<string, unknown>;
    agentOptions?: Record<string, unknown>;
    setup?: (agentCtx: unknown, agent: unknown) => void;
  }): Promise<{ agent: LiveAgent }>;
  resume(options: {
    resumeSessionId: string;
    agentOptions?: Record<string, unknown>;
    setup?: (agentCtx: unknown, agent: unknown) => void;
  }): Promise<{ agent: LiveAgent }>;
}

export interface SessionsService {
  flush(session: unknown): Promise<void> | void;
}

export interface SessionRecord {
  header: { id: string; createdAt: number; cwd?: string; origin?: string };
  live: boolean;
  persisted: boolean;
}

export interface SessionSnapshot {
  session: SessionRecord['header'];
  events: Array<{ type?: string; seq?: number; time?: number; data?: unknown }>;
}

export interface SessionQueryService {
  listSessions(): Promise<SessionRecord[]>;
  readSession(sessionId: string): Promise<SessionSnapshot>;
}

export interface DefaultModelService {
  currentSelection(): { provider?: string; model?: string };
  saveSelection?(next: { provider: string; model: string }): Promise<void>;
}

export interface AttachmentsService {
  saveFile?(input: { data: Uint8Array; name?: string }): Promise<{
    attachmentId: string;
    name: string;
    bytes: number;
  }>;
}

export interface CredentialsService {
  set?(ref: string, value: string): Promise<void>;
  unset?(ref: string): Promise<void>;
  resolve?(ref: string): Promise<{ value: string } | undefined>;
}

export interface SettingsService {
  update?(namespace: string, patch: object): Promise<void>;
  replace?(namespace: string, section: object): Promise<void>;
  mutate?(
    namespace: string,
    operations: ReadonlyArray<{ op: 'set' | 'unset'; path: readonly string[]; value?: unknown }>,
  ): Promise<void>;
}

export interface PluginManagerService {
  listPlugins?(): Promise<unknown[]>;
  listBundles?(): Promise<unknown[]>;
  registries?(): Promise<{ registry: string | null; resolved: string | null }>;
  inspect?(spec: string): Promise<unknown>;
  installBundle?(spec: string, options?: Record<string, unknown>): Promise<unknown>;
  cancelInstall?(requestId: string): Promise<unknown>;
  removeBundle?(name: string): Promise<unknown>;
  setPluginEnabled?(id: string, enabled: boolean): Promise<unknown>;
  setBundleEnabled?(name: string, enabled: boolean): Promise<unknown>;
}

/** Probes are defensive: a missing service is a supported configuration. */
export class Harness {
  constructor(private readonly ctx: Context) {}

  private probe<T>(key: string): T | undefined {
    try {
      const value = this.ctx.get(key) as T | undefined;
      return value && typeof value === 'object' ? value : undefined;
    } catch {
      return undefined;
    }
  }

  get agents(): AgentsService | undefined {
    return this.probe('agents');
  }

  get sessions(): SessionsService | undefined {
    return this.probe('sessions');
  }

  get sessionQuery(): SessionQueryService | undefined {
    return this.probe('sessionQuery');
  }

  get defaultModel(): DefaultModelService | undefined {
    return this.probe('agentDefaultModel');
  }

  get attachments(): AttachmentsService | undefined {
    return this.probe('attachments');
  }

  get credentials(): CredentialsService | undefined {
    return this.probe('credentials');
  }

  get settings(): SettingsService | undefined {
    return this.probe('settings');
  }

  get pluginManager(): PluginManagerService | undefined {
    return this.probe('pluginManager');
  }

  on(event: string, handler: (...args: unknown[]) => void): () => void {
    try {
      return this.ctx.on(event, handler as never);
    } catch {
      return () => undefined;
    }
  }

  get context(): Context {
    return this.ctx;
  }
}
