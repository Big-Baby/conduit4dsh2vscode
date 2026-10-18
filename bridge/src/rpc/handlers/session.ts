import { ErrorCode, RpcError, type FileMention, type MethodHandlers } from '@conduit4dsh2vscode/protocol';
import type { SessionService } from '../../core/session-service';
import type { WorkspaceFiles } from '../../core/workspace-files';
import { optionalArray, optionalBoolean, optionalNumber, optionalString, requireString } from '../params';

export function sessionHandlers(
  sessions: SessionService,
  files: WorkspaceFiles,
): Pick<
  MethodHandlers,
  | 'session.list'
  | 'session.get'
  | 'session.history'
  | 'session.create'
  | 'session.append'
  | 'session.cancel'
  | 'session.rename'
  | 'session.fork'
  | 'session.archive'
  | 'session.unarchive'
  | 'session.delete'
> {
  return {
    'session.list': (params) => {
      const projectId = optionalString(params, 'projectId');
      const includeArchived = optionalBoolean(params, 'includeArchived');
      return sessions.list({
        ...(projectId ? { projectId } : {}),
        ...(includeArchived !== undefined ? { includeArchived } : {}),
      });
    },

    'session.get': (params) => sessions.get(requireString(params, 'sessionId')),

    'session.history': (params) =>
      sessions.history(
        requireString(params, 'sessionId'),
        optionalString(params, 'before'),
        optionalNumber(params, 'limit') ?? 30,
      ),

    'session.create': (params) =>
      sessions.create({
        projectId: requireString(params, 'projectId'),
        ...(optionalString(params, 'title') ? { title: optionalString(params, 'title') } : {}),
      }),

    'session.append': (params) => {
      const sessionId = requireString(params, 'sessionId');
      const content = requireString(params, 'content');
      const attachments = normalizeMentions(optionalArray<FileMention>(params, 'attachments'), files);
      return sessions.append(sessionId, content, attachments);
    },

    'session.cancel': async (params) => {
      await sessions.cancel(requireString(params, 'sessionId'));
      return { ok: true };
    },

    'session.rename': (params) => {
      sessions.rename(requireString(params, 'sessionId'), requireString(params, 'title'));
      return { ok: true };
    },

    'session.fork': (params) =>
      sessions.fork(requireString(params, 'sessionId'), optionalString(params, 'fromMessageId')),

    'session.archive': (params) => {
      sessions.archive(requireString(params, 'sessionId'), true);
      return { ok: true };
    },

    'session.unarchive': (params) => {
      sessions.archive(requireString(params, 'sessionId'), false);
      return { ok: true };
    },

    'session.delete': async (params) => {
      await sessions.remove(requireString(params, 'sessionId'));
      return { ok: true };
    },
  };
}

/**
 * Validates file mentions before they reach the agent loop.
 *
 * An entry with the wrong shape is rejected rather than dropped: silently
 * ignoring it would make the user believe the file was attached.
 */
function normalizeMentions(raw: FileMention[] | undefined, files: WorkspaceFiles): FileMention[] {
  if (!raw?.length) return [];
  const mentions: FileMention[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      throw new RpcError(ErrorCode.InvalidParams, 'attachment must be an object');
    }
    if (item.kind !== 'file') {
      throw new RpcError(ErrorCode.InvalidParams, `unsupported attachment kind: ${String(item.kind)}`);
    }
    const path = files.resolve(item.path);
    mentions.push({
      kind: 'file',
      path,
      ...(item.name?.trim() ? { name: item.name.trim() } : {}),
    });
  }
  return mentions;
}
