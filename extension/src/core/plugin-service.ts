import type {
  BundleItem,
  PluginChangeResult,
  PluginEventParams,
  PluginInspectResult,
  PluginItem,
  PluginTargetKind,
  RegistrySearchResult,
} from '@conduit4dsh2vscode/protocol';
import type { DshClient } from '../rpc/client';

export interface PluginCatalog {
  plugins: PluginItem[];
  bundles: BundleItem[];
}

/** Plugin management facade, including installation progress events. */
export class PluginService {
  constructor(private readonly client: () => DshClient) {}

  list(): Promise<PluginCatalog> {
    return this.client().request<PluginCatalog>('plugin.list');
  }

  search(query: string): Promise<RegistrySearchResult> {
    return this.client().request<RegistrySearchResult>('plugin.registry.search', { query });
  }

  inspect(spec: string): Promise<PluginInspectResult> {
    return this.client().request<PluginInspectResult>('plugin.registry.inspect', { spec });
  }

  install(spec: string): Promise<{ requestId: string }> {
    return this.client().request('plugin.install', { spec });
  }

  cancelInstall(requestId: string): Promise<{ status: string }> {
    return this.client().request('plugin.install.cancel', { requestId });
  }

  uninstall(name: string): Promise<PluginChangeResult> {
    return this.client().request('plugin.uninstall', { name });
  }

  setEnabled(kind: PluginTargetKind, id: string, enabled: boolean): Promise<PluginChangeResult> {
    return this.client().request('plugin.setEnabled', { kind, id, enabled });
  }

  onEvent(listener: (params: PluginEventParams) => void): () => void {
    const disposable = this.client().on('plugin.event', (params) => listener(params as PluginEventParams));
    return () => disposable.dispose();
  }
}
