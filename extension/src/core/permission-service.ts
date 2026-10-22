import type { PermissionState } from '@conduit4dsh2vscode/protocol';
import type { DshClient } from '../rpc/client';

/**
 * Permission presets over RPC.
 *
 * A bridge that predates protocol 1.1 answers `Method not found`; that is
 * reported as an unavailable state rather than an error, because an old bridge
 * is a supported peer and the control simply hides.
 */
export class PermissionService {
  constructor(private readonly client: () => DshClient) {}

  async get(sessionId?: string): Promise<PermissionState> {
    try {
      return await this.client().request<PermissionState>(
        'permission.get',
        sessionId ? { sessionId } : {},
      );
    } catch (error) {
      if (isMethodMissing(error)) return { available: false, options: [] };
      throw error;
    }
  }

  async set(sessionId: string, preset: string): Promise<PermissionState> {
    return this.client().request<PermissionState>('permission.set', { sessionId, preset });
  }

  respond(requestId: string, outcome: 'allowed-once' | 'rejected'): Promise<{ ok: true }> {
    return this.client().request('approval.respond', { requestId, outcome });
  }
}

export function isMethodMissing(error: unknown): boolean {
  const code = (error as { code?: number } | undefined)?.code;
  if (code === -32601) return true;
  return /method not found|-32601/i.test((error as Error | undefined)?.message ?? '');
}
