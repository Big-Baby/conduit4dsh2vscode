import type { MethodHandlers } from '@conduit4dsh2vscode/protocol';
import type { WorkspaceFiles } from '../../core/workspace-files';
import { optionalNumber, optionalString, requireString } from '../params';

export function fileHandlers(files: WorkspaceFiles): Pick<
  MethodHandlers,
  'file.readText' | 'file.list' | 'file.stat'
> {
  return {
    'file.readText': (params) => files.readText(requireString(params, 'path')),

    'file.list': (params) => files.list(optionalString(params, 'query'), optionalNumber(params, 'maxFiles')),

    'file.stat': (params) => files.stat(requireString(params, 'path')),
  };
}
