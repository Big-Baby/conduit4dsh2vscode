import * as vscode from 'vscode';

/**
 * Shared tree plumbing: change notification and refresh.
 *
 * Subclasses only implement `getChildren` and `getTreeItem`.
 */
export abstract class BaseTree<T> implements vscode.TreeDataProvider<T>, vscode.Disposable {
  protected readonly emitter = new vscode.EventEmitter<T | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  abstract getChildren(element?: T): vscode.ProviderResult<T[]>;
  abstract getTreeItem(element: T): vscode.TreeItem;

  refresh(): void {
    this.emitter.fire(undefined);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
