import * as vscode from 'vscode';
import type { BundleItem, PluginItem } from '@conduit4dsh2vscode/protocol';
import type { PluginService } from '../../core/plugin-service';
import { BaseTree } from './base';

type Node =
  | { kind: 'group'; id: 'bundles' | 'plugins'; label: string }
  | { kind: 'bundle'; bundle: BundleItem }
  | { kind: 'plugin'; plugin: PluginItem };

export class PluginTreeProvider extends BaseTree<Node> {
  private bundles: BundleItem[] = [];
  private plugins: PluginItem[] = [];

  constructor(private readonly service: PluginService) {
    super();
  }

  async load(): Promise<void> {
    try {
      const catalog = await this.service.list();
      this.bundles = catalog.bundles ?? [];
      this.plugins = catalog.plugins ?? [];
    } catch {
      this.bundles = [];
      this.plugins = [];
    }
    this.refresh();
  }

  getChildren(element?: Node): Node[] {
    if (!element) {
      return [
        { kind: 'group', id: 'bundles', label: `Bundles (${this.bundles.length})` },
        { kind: 'group', id: 'plugins', label: `Plugins (${this.plugins.length})` },
      ];
    }
    if (element.kind === 'group') {
      return element.id === 'bundles'
        ? this.bundles.map((bundle) => ({ kind: 'bundle', bundle }))
        : this.plugins.map((plugin) => ({ kind: 'plugin', plugin }));
    }
    return [];
  }

  getTreeItem(element: Node): vscode.TreeItem {
    if (element.kind === 'group') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      item.id = element.id;
      item.contextValue = 'group';
      return item;
    }

    if (element.kind === 'bundle') {
      const bundle = element.bundle;
      const item = new vscode.TreeItem(bundle.name, vscode.TreeItemCollapsibleState.None);
      item.id = `bundle:${bundle.name}`;
      item.contextValue = bundle.removable ? 'bundle-removable' : 'bundle';
      item.description = [bundle.version, bundle.enabled ? '' : 'disabled', bundle.optional ? 'optional' : '']
        .filter(Boolean)
        .join(' · ');
      item.tooltip = bundle.description ?? bundle.name;
      item.iconPath = new vscode.ThemeIcon(bundle.enabled ? 'package' : 'circle-slash');
      return item;
    }

    const plugin = element.plugin;
    const item = new vscode.TreeItem(plugin.name, vscode.TreeItemCollapsibleState.None);
    item.id = `plugin:${plugin.entryId}`;
    item.contextValue = 'plugin-toggle';
    item.description = [plugin.version, plugin.enabled ? '' : 'disabled'].filter(Boolean).join(' · ');
    item.tooltip = plugin.description ?? plugin.name;
    item.iconPath = new vscode.ThemeIcon(plugin.enabled ? 'extensions' : 'circle-slash');
    return item;
  }
}
