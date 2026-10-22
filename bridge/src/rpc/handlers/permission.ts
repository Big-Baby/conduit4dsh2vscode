import { ErrorCode, RpcError, type MethodHandlers } from '@conduit4dsh2vscode/protocol';
import type { PermissionService } from '../../core/permission-service';
import { requireString, optionalString } from '../params';

export function permissionHandlers(
  permissions: PermissionService,
): Pick<MethodHandlers, 'permission.get' | 'permission.set' | 'approval.respond'> {
  return {
    'permission.get': (params) => permissions.get(optionalString(params, 'sessionId')),

    'permission.set': (params) =>
      permissions.set(requireString(params, 'sessionId'), requireString(params, 'preset')),

    'approval.respond': (params) => {
      const outcome = requireString(params, 'outcome');
      if (outcome !== 'allowed-once' && outcome !== 'rejected') {
        throw new RpcError(ErrorCode.InvalidParams, `unsupported approval outcome: ${outcome}`);
      }
      return permissions.respond(requireString(params, 'requestId'), outcome);
    },
  };
}
