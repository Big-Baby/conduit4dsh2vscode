import type { MethodHandlers, ModelInfo, ProviderSyncInput } from '@conduit4dsh2vscode/protocol';
import type { ModelService } from '../../core/model-service';
import { optionalArray, optionalBoolean, optionalString, requireString } from '../params';

export function modelHandlers(models: ModelService): Pick<
  MethodHandlers,
  | 'model.providers.list'
  | 'model.providers.add'
  | 'model.providers.sync'
  | 'model.providers.setKey'
  | 'model.providers.remove'
  | 'model.list'
  | 'model.getDefault'
  | 'model.setDefault'
> {
  return {
    'model.providers.list': () => models.listProviders(),

    'model.providers.add': (params) => {
      const id = optionalString(params, 'id');
      const baseURL = optionalString(params, 'baseURL');
      const apiKey = optionalString(params, 'apiKey');
      const catalogue = optionalArray<Pick<ModelInfo, 'id' | 'name' | 'inputTypes'>>(params, 'models');
      return models.addProvider({
        kind: requireString(params, 'kind'),
        ...(id ? { id } : {}),
        ...(baseURL ? { baseURL } : {}),
        ...(apiKey ? { apiKey } : {}),
        ...(catalogue ? { models: catalogue } : {}),
      });
    },

    'model.providers.sync': (params) => {
      const providers = optionalArray<ProviderSyncInput>(params, 'providers');
      const replace = optionalBoolean(params, 'replace');
      const defaultModel = optionalString(params, 'defaultModel');
      return models.syncProviders({
        ...(providers ? { providers } : {}),
        ...(replace !== undefined ? { replace } : {}),
        ...(defaultModel ? { defaultModel } : {}),
      });
    },

    'model.providers.setKey': async (params) => {
      await models.setProviderKey(requireString(params, 'providerId'), requireString(params, 'apiKey'));
      return { ok: true };
    },

    'model.providers.remove': async (params) => {
      await models.removeProvider(requireString(params, 'providerId'));
      return { ok: true };
    },

    'model.list': (params) => models.listModels(optionalString(params, 'providerId')),

    'model.getDefault': () => models.getDefault(),

    'model.setDefault': async (params) => {
      await models.setDefault(
        requireString(params, 'modelId'),
        optionalString(params, 'sessionId'),
        optionalString(params, 'effort'),
      );
      return { ok: true };
    },
  };
}
