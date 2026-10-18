import type { AgentInfo, AgentNode } from '@conduit4dsh2vscode/protocol';
import type { DshClient } from '../rpc/client';

/** Read-only agent tree plus cancellation of a single sub-agent. */
export class AgentService {
  constructor(private readonly client: () => DshClient) {}

  tree(sessionId: string): Promise<AgentNode[]> {
    return this.client().request<AgentNode[]>('agent.tree', { sessionId });
  }

  list(sessionId: string): Promise<AgentInfo[]> {
    return this.client().request<AgentInfo[]>('agent.list', { sessionId });
  }

  cancel(sessionId: string, agentId: string): Promise<{ ok: true }> {
    return this.client().request('agent.cancel', { sessionId, agentId });
  }

  countRunning(nodes: AgentNode[]): number {
    let count = 0;
    for (const node of nodes) {
      if (node.status === 'running' || node.status === 'pending' || node.status === 'waiting') count += 1;
      count += this.countRunning(node.children);
    }
    return count;
  }
}
