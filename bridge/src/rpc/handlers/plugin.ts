import { ErrorCode, RpcError, type MethodHandlers, type PluginTargetKind } from '@conduit4dsh2vscode/protocol';
import type { PluginAdmin } from '../../dsh/plugins';
import { optionalNumber, requireBoolean, requireString } from '../params';

export function pluginHandlers(plugins: PluginAdmin): Pick<
  MethodHandlers,
  | 'plugin.list'
  | 'plugin.registry.search'
  | 'plugin.registry.inspect'
  | 'plugin.install'
  | 'plugin.install.cancel'
  | 'plugin.uninstall'
  | 'plugin.setEnabled'
> {
  return {
    'plugin.list': () => plugins.list(),

    'plugin.registry.search': (params) =>
      plugins.search(requireString(params, 'query'), optionalNumber(params, 'size')),

    'plugin.registry.inspect': (params) => plugins.inspect(requireString(params, 'spec')),

    'plugin.install': (params) => plugins.install(requireString(params, 'spec')),

    'plugin.install.cancel': (params) => plugins.cancelInstall(requireString(params, 'requestId')),

    'plugin.uninstall': (params) => plugins.uninstall(requireString(params, 'name')),

    'plugin.setEnabled': (params) => {
      const kind = requireString(params, 'kind');
      if (kind !== 'bundle' && kind !== 'plugin') {
        throw new RpcError(ErrorCode.InvalidParams, "kind must be 'bundle' or 'plugin'");
      }
      return plugins.setEnabled(kind as PluginTargetKind, requireString(params, 'id'), requireBoolean(params, 'enabled'));
    },
  };
}
