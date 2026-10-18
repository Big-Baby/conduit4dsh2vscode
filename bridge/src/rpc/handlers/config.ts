import { PROTOCOL_VERSION, type MethodHandlers } from '@conduit4dsh2vscode/protocol';
import type { SettingsService } from '../../core/settings-service';
import { optionalArray, requireObject } from '../params';

export interface ConfigContext {
  profile: string;
  home: string;
}

export function configHandlers(settings: SettingsService, context: ConfigContext): Pick<
  MethodHandlers,
  'config.get' | 'config.set'
> {
  return {
    'config.get': (params) => {
      const all: Record<string, unknown> = {
        profile: context.profile,
        home: context.home,
        protocolVersion: PROTOCOL_VERSION,
        ...settings.all(),
      };
      const keys = optionalArray<string>(params, 'keys');
      if (!keys?.length) return all;
      const picked: Record<string, unknown> = {};
      for (const key of keys) if (key in all) picked[key] = all[key];
      return picked;
    },

    'config.set': (params) => {
      const patch = requireObject<Record<string, unknown>>(params, 'patch');
      return { ok: true, applied: Object.keys(patch), config: settings.merge(patch) };
    },
  };
}
