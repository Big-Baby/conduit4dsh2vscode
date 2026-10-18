import { join } from 'node:path';

export interface BridgePaths {
  root: string;
  projects: string;
  sessions: string;
  messages: string;
  providers: string;
  defaultModel: string;
  runtimeConfig: string;
  agents: string;
  log: string;
}

/** All persisted state lives under one directory to keep backup and cleanup trivial. */
export function bridgePaths(home: string): BridgePaths {
  const root = home;
  return {
    root,
    projects: join(root, 'bridge-projects.json'),
    sessions: join(root, 'bridge-sessions.json'),
    messages: join(root, 'bridge-messages'),
    providers: join(root, 'bridge-providers.json'),
    defaultModel: join(root, 'bridge-default-model.json'),
    runtimeConfig: join(root, 'bridge-config.json'),
    agents: join(root, 'bridge-agents'),
    log: join(root, 'bridge.log'),
  };
}

export function sessionLogFile(paths: BridgePaths, sessionId: string): string {
  return join(paths.messages, `${sessionId}.jsonl`);
}

export function agentLogFile(paths: BridgePaths, sessionId: string): string {
  return join(paths.agents, `${sessionId}.json`);
}
