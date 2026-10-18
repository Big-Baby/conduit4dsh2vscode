import * as vscode from 'vscode';
import type {
  DefaultModelSelection,
  ModelInfo,
  ProviderInfo,
  ProviderSyncInput,
  ProviderSyncResult,
} from '@conduit4dsh2vscode/protocol';
import type { DshClient } from '../rpc/client';

export interface ProviderConfigSetting {
  providers?: Array<{
    id: string;
    kind?: string;
    baseURL?: string;
    apiKey?: string;
    apiKeyEnv?: string;
    models?: Array<string | { id?: string; name?: string }>;
  }>;
  defaultModel?: string;
  replace?: boolean;
}

/** Provider catalog and default model selection. */
export class ModelService {
  constructor(private readonly client: () => DshClient) {}

  providers(): Promise<ProviderInfo[]> {
    return this.client().request<ProviderInfo[]>('model.providers.list');
  }

  models(providerId?: string): Promise<ModelInfo[]> {
    return this.client().request<ModelInfo[]>('model.list', {
      ...(providerId ? { providerId } : {}),
    });
  }

  getDefault(): Promise<DefaultModelSelection> {
    return this.client().request<DefaultModelSelection>('model.getDefault');
  }

  setDefault(modelId: string, sessionId?: string, effort?: string): Promise<{ ok: true }> {
    return this.client().request('model.setDefault', {
      modelId,
      ...(sessionId ? { sessionId } : {}),
      ...(effort !== undefined ? { effort } : {}),
    });
  }

  addProvider(input: {
    id: string;
    kind: string;
    baseURL?: string;
    apiKey?: string;
    models?: Array<Pick<ModelInfo, 'id' | 'name' | 'inputTypes'>>;
  }): Promise<ProviderInfo> {
    return this.client().request<ProviderInfo>('model.providers.add', input);
  }

  setKey(providerId: string, apiKey: string): Promise<{ ok: true }> {
    return this.client().request('model.providers.setKey', { providerId, apiKey });
  }

  removeProvider(providerId: string): Promise<{ ok: true }> {
    return this.client().request('model.providers.remove', { providerId });
  }

  readSettings(): ProviderConfigSetting {
    return vscode.workspace.getConfiguration('dsh').get<ProviderConfigSetting>('providerConfig') ?? {};
  }

  /**
   * Pushes `dsh.providerConfig` to the bridge.
   *
   * Returns `undefined` when the setting is empty, so a fresh install does not
   * overwrite providers the user configured in the UI.
   */
  async syncFromSettings(): Promise<ProviderSyncResult | undefined> {
    const settings = this.readSettings();
    const providers = Array.isArray(settings.providers) ? settings.providers : [];
    if (!providers.length && !settings.defaultModel) return undefined;

    return this.client().request<ProviderSyncResult>('model.providers.sync', {
      providers: providers as ProviderSyncInput[],
      replace: Boolean(settings.replace),
      defaultModel: settings.defaultModel ?? '',
    });
  }
}
