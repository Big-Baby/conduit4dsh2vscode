import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';

export type TransportKind = 'stdio' | 'tcp' | 'unix';

export interface BridgeConfig {
  /** Where the bridge listens. `stdio` owns the process lifetime. */
  transport: TransportKind;
  host: string;
  port: number;
  socketPath: string;
  /** Required for tcp/unix; ignored for stdio. */
  token: string;
}

/**
 * Schemastery has no enum helper: literal unions are expressed with `const`.
 */
export const Config = z.object({
  transport: z.union([z.const('stdio'), z.const('tcp'), z.const('unix')]).default('stdio'),
  host: z.string().default('127.0.0.1'),
  port: z.number().default(4113),
  socketPath: z.string().default('~/.dsh/run/bridge.sock'),
  token: z.string().default(''),
});

export type ApplyConfig = BridgeConfig;
