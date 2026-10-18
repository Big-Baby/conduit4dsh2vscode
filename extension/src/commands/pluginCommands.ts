import * as vscode from 'vscode';
import type { BundleItem, PluginEventParams, PluginItem, PluginTargetKind } from '@conduit4dsh2vscode/protocol';
import type { CommandContext } from './context';
import { registerCommand } from './register';

type PluginTreeNode =
  | { kind: 'group'; id: string }
  | { kind: 'bundle'; bundle: BundleItem }
  | { kind: 'plugin'; plugin: PluginItem };

export function registerPluginCommands(
  context: CommandContext,
  subscriptions: vscode.Disposable[],
): void {
  const { plugins, trees, output, connection } = context;

  const installWithProgress = async (spec: string): Promise<void> => {
    try {
      const inspection = await plugins.inspect(spec);
      if (inspection.status === 'refused') {
        void vscode.window.showErrorMessage(`Cannot install ${spec}: ${inspection.reason ?? inspection.problem}`);
        return;
      }
      if (inspection.bundle === false) {
        const proceed = await vscode.window.showWarningMessage(
          `${spec} does not declare a dsh bundle patch and will not take effect as a plugin. Install anyway?`,
          { modal: true },
          'Install anyway',
        );
        if (proceed !== 'Install anyway') return;
      }
    } catch (error) {
      output.appendLine(`[plugin] inspect ${spec} failed: ${(error as Error).message}`);
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Installing ${spec}`, cancellable: true },
      async (progress, token) => {
        let requestId = '';
        let logTail = '';
        let settled = false;
        let dispose: (() => void) | undefined;

        const done = new Promise<void>((resolve) => {
          dispose = plugins.onEvent((event: PluginEventParams) => {
            if (event.type === 'install-state' && event.progress) {
              if (requestId && event.progress.requestId !== requestId) return;
              requestId = requestId || event.progress.requestId;
              progress.report({ message: phaseLabel(event.progress.phase, event.progress.attempt) });
              return;
            }
            if (event.type === 'install-log' && event.log) {
              if (requestId && event.log.requestId && event.log.requestId !== requestId) return;
              logTail = `${logTail}${event.log.text}`.slice(-4000);
              if (event.log.stream === 'stderr') progress.report({ message: event.log.text.slice(0, 120) });
              if (event.log.exitCode !== undefined && event.log.exitCode !== null) {
                settled = true;
                if (event.log.exitCode !== 0) {
                  void vscode.window.showErrorMessage(`Install failed: ${spec}\n${logTail.slice(-600)}`);
                }
                resolve();
              }
              return;
            }
            if (event.type === 'changed') {
              settled = true;
              resolve();
            }
          });
        });

        token.onCancellationRequested(() => {
          if (requestId) void plugins.cancelInstall(requestId).catch(() => undefined);
          else settled = true;
        });

        try {
          const started = await plugins.install(spec);
          requestId = started.requestId;
          await Promise.race([done, new Promise<void>((resolve) => setTimeout(resolve, 600_000))]);
        } finally {
          dispose?.();
        }

        await trees.plugins.load();
        if (!settled) return;
      },
    );
  };

  registerCommand(subscriptions, 'dsh.installPlugin', async () => {
    const spec = await vscode.window.showInputBox({
      prompt: 'Package name, path, git URL or tarball',
      placeHolder: '@scope/dsh-plugin or github:user/repo',
      ignoreFocusOut: true,
    });
    if (spec?.trim()) await installWithProgress(spec.trim());
  });

  registerCommand(subscriptions, 'dsh.searchPlugins', async () => {
    const query = await vscode.window.showInputBox({
      prompt: 'Search the npm registry',
      placeHolder: 'dsh tool, skill, workflow…',
      ignoreFocusOut: true,
    });
    if (!query?.trim()) return;

    const found = await plugins.search(query.trim());
    if (found.error) {
      void vscode.window.showErrorMessage(`Registry search failed: ${found.error}`);
      return;
    }
    if (!found.results.length) {
      void vscode.window.showInformationMessage(`No plugin matches "${query.trim()}"`);
      return;
    }

    const picked = await vscode.window.showQuickPick(
      found.results.map((result) => ({
        label: result.name,
        description: result.version,
        detail: result.description,
      })),
      { matchOnDetail: true, placeHolder: `${found.results.length} results` },
    );
    if (picked) await installWithProgress(picked.label);
  });

  registerCommand(subscriptions, 'dsh.uninstallPlugin', async (node: PluginTreeNode) => {
    const bundle = bundleOf(node);
    if (!bundle) return;
    const confirmed = await vscode.window.showWarningMessage(
      `Uninstall ${bundle.name}${bundle.version ? ` @ ${bundle.version}` : ''}? Its patch layer is removed from the profile.`,
      { modal: true },
      'Uninstall',
    );
    if (confirmed !== 'Uninstall') return;
    await plugins.uninstall(bundle.name);
    await trees.plugins.load();
  });

  registerCommand(subscriptions, 'dsh.enablePlugin', async (node: PluginTreeNode) => {
    await setEnabled(node, true);
  });

  registerCommand(subscriptions, 'dsh.disablePlugin', async (node: PluginTreeNode) => {
    await setEnabled(node, false);
  });

  registerCommand(subscriptions, 'dsh.refreshPlugins', async () => {
    if (!connection.hasCapability('plugin-management')) {
      void vscode.window.showInformationMessage('This bridge does not expose plugin management.');
      return;
    }
    await trees.plugins.load();
  });

  async function setEnabled(node: PluginTreeNode, enabled: boolean): Promise<void> {
    const bundle = bundleOf(node);
    if (bundle) {
      await plugins.setEnabled('bundle' as PluginTargetKind, bundle.name, enabled);
    } else {
      const plugin = pluginOf(node);
      if (!plugin) return;
      await plugins.setEnabled('plugin' as PluginTargetKind, plugin.entryId, enabled);
    }
    await trees.plugins.load();
  }
}

function bundleOf(node: PluginTreeNode | BundleItem | undefined): BundleItem | undefined {
  if (!node) return undefined;
  if ('bundle' in node) return node.bundle;
  if ('name' in node && 'rows' in node) return node as BundleItem;
  return undefined;
}

function pluginOf(node: PluginTreeNode | PluginItem | undefined): PluginItem | undefined {
  if (!node) return undefined;
  if ('plugin' in node) return node.plugin;
  if ('entryId' in node) return node as PluginItem;
  return undefined;
}

function phaseLabel(
  phase: string,
  attempt?: { registry: string | null; index: number; total: number },
): string {
  if (phase === 'installing' && attempt) {
    return `Downloading (${attempt.registry ?? 'default registry'} ${attempt.index}/${attempt.total})`;
  }
  if (phase === 'applying') return 'Applying bundle patch…';
  if (phase === 'cancelling') return 'Cancelling…';
  return phase;
}
