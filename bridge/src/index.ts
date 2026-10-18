/**
 * DSH transport bridge.
 *
 * Mounted on a profile in place of the interactive UI. It exposes the harness
 * capabilities over JSON-RPC 2.0 and owns no user interface.
 */
import type { Context } from '@deepseek-ai/cordis';
import { BridgeRuntime } from './container';
import { Config, type BridgeConfig } from './config';

export const name = 'dsh-bridge';

/** The bridge cannot work without the session service. */
export const inject = ['sessions'];

export { Config };

export async function apply(ctx: Context, config: BridgeConfig): Promise<void> {
  const runtime = await BridgeRuntime.create(ctx, config);

  ctx.effect(() => {
    runtime.start();
    return () => runtime.stop();
  });
}
