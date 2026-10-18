import {
  CAPABILITIES,
  PROTOCOL_VERSION,
  type MethodHandlers,
} from '@conduit4dsh2vscode/protocol';
import type { TransportKind } from '../../config';

export interface SystemContext {
  dshVersion: string;
  profile: string;
  transport: TransportKind;
  mode: 'live' | 'replay';
  onShutdown: () => void;
}

export function systemHandlers(context: SystemContext): Pick<
  MethodHandlers,
  'system.ping' | 'system.info' | 'system.shutdown'
> {
  return {
    'system.ping': () => ({ pong: true }),

    'system.info': () => ({
      protocolVersion: PROTOCOL_VERSION,
      dshVersion: context.dshVersion,
      profile: context.profile,
      transports: ['stdio', 'tcp', 'unix'],
      pid: process.pid,
      capabilities: [...CAPABILITIES],
      mode: context.mode,
    }),

    'system.shutdown': () => {
      const mode = context.transport === 'stdio' ? 'process-exit' : 'server-stop';
      if (mode === 'process-exit') setTimeout(context.onShutdown, 50);
      return { ok: true, mode };
    },
  };
}
