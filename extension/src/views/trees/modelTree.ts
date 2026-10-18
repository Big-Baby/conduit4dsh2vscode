import * as vscode from 'vscode';
import type { ModelInfo, ProviderInfo } from '@conduit4dsh2vscode/protocol';
import type { ModelService } from '../../core/model-service';
import { BaseTree } from './base';

export type ModelNode = ProviderInfo | ModelInfo;

export function isProvider(node: ModelNode): node is ProviderInfo {
  return Array.isArray((node as ProviderInfo).models);
}

export class ModelTreeProvider extends BaseTree<ModelNode> {
  private providers: ProviderInfo[] = [];

  constructor(private readonly service: ModelService) {
    super();
  }

  async load(): Promise<void> {
    try {
      this.providers = await this.service.providers();
    } catch {
      this.providers = [];
    }
    this.refresh();
  }

  getChildren(element?: ModelNode): ModelNode[] {
    if (!element) return this.providers;
    return isProvider(element) ? element.models : [];
  }

  getTreeItem(node: ModelNode): vscode.TreeItem {
    if (isProvider(node)) {
      const item = new vscode.TreeItem(node.id, vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `provider:${node.id}`;
      item.contextValue = 'provider';
      item.description = `${node.models.length} models${node.hasKey ? '' : ' · no key'}`;
      item.tooltip = `${node.id} (${node.kind})${node.baseURL ? `\n${node.baseURL}` : ''}`;
      item.iconPath = new vscode.ThemeIcon(node.hasKey ? 'key' : 'warning');
      return item;
    }

    const item = new vscode.TreeItem(node.name || node.id, vscode.TreeItemCollapsibleState.None);
    item.id = `model:${node.providerId}:${node.id}`;
    item.contextValue = 'model';
    item.description = node.id === node.name ? '' : node.id;
    item.iconPath = new vscode.ThemeIcon('symbol-method');
    return item;
  }
}
