import { ErrorCode, RpcError, type PermissionState } from '@conduit4dsh2vscode/protocol';
import type { Harness, HarnessApprovalRequest, PermissionPresetsService } from '../dsh/context';
import type { Logger } from '../runtime/logger';

/** Delivered when a session's preset changes, so clients can refresh. */
export interface PermissionChanged {
  sessionId?: string;
  preset: string;
}

/** One pending approval question, as forwarded to clients. */
export interface ApprovalAsk {
  sessionId: string;
  requestId: string;
  toolName: string;
  callId?: string;
  reason?: string;
  agentId?: string;
  timeoutMs: number;
}

/** What the bridge resolves the pending question with. */
type Decision = 'allowed-once' | 'rejected' | 'cancelled';

export interface PermissionServiceDeps {
  harness: Harness;
  log: Logger;
  /** Maps a harness agent to the conversation that owns it. */
  sessionIdOfAgent(agent: unknown): string | undefined;
  /** Brings a metadata-only session to life so the harness can address it. */
  ensureSession?(sessionId: string): Promise<boolean>;
}

/** A hung question must not block a turn forever; the harness fails closed. */
const APPROVAL_TIMEOUT_MS = 5 * 60_000;

/**
 * Permission management and the approval seam.
 *
 * Two harness capabilities are surfaced here:
 *
 * - `permissionPresets` bundles the sandbox mode with an approval policy, so a
 *   client can switch between read-only, workspace-write and full access on a
 *   live session.
 * - `approval/request` is a *waterfall*: whoever answers first decides whether
 *   a blocked tool action runs. Without an answerer the harness fails closed,
 *   so the bridge registers one and forwards each question to the editor. The
 *   answer is a one-shot grant; nothing is remembered across requests.
 */
export class PermissionService {
  private readonly changedListeners = new Set<(event: PermissionChanged) => void>();
  private readonly askListeners = new Set<(ask: ApprovalAsk) => void>();
  private readonly pending = new Map<string, { settle(outcome: Decision): void }>();
  private readonly disposers: Array<() => void> = [];
  private sequence = 0;
  private installed = false;

  constructor(private readonly deps: PermissionServiceDeps) {}

  get available(): boolean {
    return Boolean(this.deps.harness.permissionPresets);
  }

  onChanged(listener: (event: PermissionChanged) => void): () => void {
    this.changedListeners.add(listener);
    return () => this.changedListeners.delete(listener);
  }

  onAsk(listener: (ask: ApprovalAsk) => void): () => void {
    this.askListeners.add(listener);
    return () => this.askListeners.delete(listener);
  }

  /**
   * Registers the approval answerer.
   *
   * Safe during activation: it only subscribes. A profile without the approval
   * service keeps working — it simply never asks.
   */
  install(): void {
    if (this.installed) return;
    if (!this.deps.harness.approval) {
      this.deps.log.info('approval service unavailable: permission prompts disabled');
      return;
    }

    this.installed = true;
    this.disposers.push(
      this.deps.harness.on('approval/request', (payload, next) => this.answer(payload, next)),
    );
    this.deps.log.info('approval answerer installed');
  }

  /**
   * Reads the catalog and, when a session is given, its effective preset.
   *
   * A session that exists only as a log has no live object, so the preset is
   * pinned in the log and readable only after a resume. Resolving lazily keeps
   * the first paint correct instead of showing "unknown" until the first turn.
   */
  async get(sessionId?: string): Promise<PermissionState> {
    const presets = this.deps.harness.permissionPresets;
    if (!presets) return { available: false, options: [] };

    const catalog = this.catalogOf(presets);
    let session = this.sessionOf(sessionId);
    if (!session && sessionId && this.deps.ensureSession) {
      await this.deps.ensureSession(sessionId).catch(() => false);
      session = this.sessionOf(sessionId);
    }
    let preset: string | undefined;
    let sandbox: string | undefined;
    let approval: string | undefined;

    if (session) {
      try {
        preset = presets.current(session);
      } catch (error) {
        this.deps.log.debug(`permission.current failed: ${(error as Error).message}`);
      }
    }
    if (preset) {
      try {
        const spec = presets.resolve?.(preset);
        sandbox = spec?.sandbox;
        approval = spec?.approval;
      } catch {
        // `custom` is a derived value with no configured bundle.
      }
    }

    return {
      available: true,
      options: catalog.options,
      ...(preset ? { preset } : {}),
      ...(catalog.defaultPreset ? { defaultPreset: catalog.defaultPreset } : {}),
      ...(sandbox ? { sandbox } : {}),
      ...(approval ? { approval } : {}),
    };
  }

  /**
   * Switches the session's preset.
   *
   * The harness writes the sandbox and approval knobs itself; a session that
   * only exists as bridge metadata is brought live first, otherwise there is
   * no object to address.
   */
  async set(sessionId: string, preset: string): Promise<PermissionState> {
    const presets = this.deps.harness.permissionPresets;
    if (!presets) {
      throw new RpcError(ErrorCode.ServerNotReady, 'the harness composes no permission service');
    }
    if (!preset.trim()) throw new RpcError(ErrorCode.InvalidParams, 'preset is required');

    let session = this.sessionOf(sessionId);
    if (!session && this.deps.ensureSession) {
      await this.deps.ensureSession(sessionId).catch(() => false);
      session = this.sessionOf(sessionId);
    }
    if (!session) {
      throw new RpcError(ErrorCode.InvalidParams, `session is not live: ${sessionId}`);
    }

    try {
      presets.set(session, preset);
    } catch (error) {
      throw new RpcError(ErrorCode.InvalidParams, (error as Error).message);
    }

    for (const listener of this.changedListeners) listener({ sessionId, preset });
    return this.get(sessionId);
  }
  /**
   * Answers a pending question.
   *
   * An unknown id is an error rather than a silent success: the client would
   * otherwise believe it granted access to a tool call that is still blocked.
   */
  respond(requestId: string, outcome: 'allowed-once' | 'rejected'): { ok: true } {
    const entry = this.pending.get(requestId);
    if (!entry) throw new RpcError(ErrorCode.InvalidParams, `unknown approval request: ${requestId}`);
    this.pending.delete(requestId);
    entry.settle(outcome);
    return { ok: true };
  }

  dispose(): void {
    for (const requestId of [...this.pending.keys()]) this.withdraw(requestId);
    for (const dispose of this.disposers) {
      try {
        dispose();
      } catch {
        /* ignore */
      }
    }
    this.disposers.length = 0;
    this.changedListeners.clear();
    this.askListeners.clear();
  }

  /* ------------------------------ internals ------------------------------ */

  private async answer(payload: unknown, next: unknown): Promise<Decision | 'unavailable'> {
    const request = payload as HarnessApprovalRequest | undefined;
    const sessionId = this.deps.sessionIdOfAgent(request?.agent);

    // Another answerer may own this request; delegating keeps the waterfall intact.
    if (!sessionId) return this.delegate(next);

    const requestId = `ap_${(this.sequence += 1).toString(36)}`;
    const timeoutMs = APPROVAL_TIMEOUT_MS;
    const agentId = agentIdOf(request?.agent);
    const ask: ApprovalAsk = {
      sessionId,
      requestId,
      toolName: String(request?.toolName ?? 'tool'),
      timeoutMs,
      ...(request?.callId ? { callId: request.callId } : {}),
      ...(request?.reason ? { reason: request.reason } : {}),
      ...(agentId ? { agentId } : {}),
    };

    const signal = request?.signal;
    let finish: (outcome: Decision) => void = () => undefined;

    const decision = new Promise<Decision>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const onAbort = (): void => {
        this.pending.delete(requestId);
        finish('cancelled');
      };

      finish = (outcome: Decision): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        signal?.removeEventListener?.('abort', onAbort);
        resolve(outcome);
      };

      timer = setTimeout(() => {
        this.pending.delete(requestId);
        this.deps.log.warn(`approval ${requestId} timed out; the tool action is denied`);
        finish('cancelled');
      }, timeoutMs);
      // A timer must not keep the process alive: the harness owns the turn.
      timer.unref?.();

      if (signal?.aborted) {
        finish('cancelled');
        return;
      }
      signal?.addEventListener?.('abort', onAbort);
      this.pending.set(requestId, { settle: finish });
    });

    if (!this.askListeners.size) {
      // Nobody to ask is the same as no answer: fail closed.
      this.pending.delete(requestId);
      finish('cancelled');
      this.deps.log.warn(`approval ${requestId} has no client; the tool action is denied`);
      return 'unavailable';
    }

    for (const listener of this.askListeners) listener(ask);
    return decision;
  }

  private delegate(next: unknown): Decision | 'unavailable' | Promise<Decision | 'unavailable'> {
    if (typeof next !== 'function') return 'unavailable';
    try {
      return (next as () => Promise<Decision | 'unavailable'>)();
    } catch {
      return 'unavailable';
    }
  }

  private withdraw(requestId: string): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    this.pending.delete(requestId);
    entry.settle('cancelled');
  }

  private sessionOf(sessionId?: string): unknown | undefined {
    if (!sessionId) return undefined;
    const get = this.deps.harness.sessions?.get;
    if (typeof get !== 'function') return undefined;
    try {
      return get.call(this.deps.harness.sessions, sessionId);
    } catch {
      return undefined;
    }
  }

  private catalogOf(presets: PermissionPresetsService): {
    options: Array<{ value: string; name: string; description?: string }>;
    defaultPreset?: string;
  } {
    try {
      const catalog = presets.catalog();
      const options = (catalog.options ?? []).map((option) => ({
        value: String(option.value),
        name: String(option.name ?? option.value),
        ...(option.description ? { description: option.description } : {}),
      }));
      return {
        options,
        ...(catalog.defaultPreset ? { defaultPreset: catalog.defaultPreset } : {}),
      };
    } catch (error) {
      this.deps.log.warn(`permission catalog unavailable: ${(error as Error).message}`);
      return { options: [] };
    }
  }
}

function agentIdOf(agent: unknown): string | undefined {
  const id = (agent as { id?: unknown } | undefined)?.id;
  return typeof id === 'string' && id ? id : undefined;
}
