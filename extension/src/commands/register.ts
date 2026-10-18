import * as vscode from 'vscode';

/** Registers a command with uniform error reporting. */
export function registerCommand(
  subscriptions: vscode.Disposable[],
  id: string,
  handler: (...args: never[]) => unknown,
): void {
  subscriptions.push(
    vscode.commands.registerCommand(id, async (...args: never[]) => {
      try {
        return await handler(...args);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`DSH: ${message}`);
        return undefined;
      }
    }),
  );
}
