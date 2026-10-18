import { ErrorCode, RpcError, type MethodHandlers } from '@conduit4dsh2vscode/protocol';
import type { SessionService } from '../../core/session-service';
import { requireString } from '../params';

export function agentHandlers(sessions: SessionService): Pick<
  MethodHandlers,
  'agent.list' | 'agent.tree' | 'agent.get' | 'agent.cancel'
> {
  return {
    'agent.list': (params) => sessions.agentList(requireString(params, 'sessionId')),

    'agent.tree': (params) => sessions.agentTree(requireString(params, 'sessionId')),

    'agent.get': (params) => {
      const sessionId = requireString(params, 'sessionId');
      const agentId = requireString(params, 'agentId');
      const agent = sessions.getAgent(sessionId, agentId);
      if (!agent) {
        throw new RpcError(ErrorCode.AgentNotFound, `agent not found: ${agentId}`, { sessionId, agentId });
      }
      return agent;
    },

    'agent.cancel': (params) => {
      const sessionId = requireString(params, 'sessionId');
      const agentId = requireString(params, 'agentId');
      sessions.cancelAgent(sessionId, agentId);
      return { ok: true };
    },
  };
}
