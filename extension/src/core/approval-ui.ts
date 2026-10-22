import * as vscode from 'vscode';
import type { PermissionService } from './permission-service';

/** Payload of the `approval.request` notification. */
export interface ApprovalAsk {
  sessionId: string;
  requestId: string;
  toolName: string;
  callId?: string;
  reason?: string;
  agentId?: string;
  timeoutMs?: number;
}

/**
 * Turns harness approval questions into editor modals.
 *
 * Prompts are serialized: concurrent questions would otherwise stack modals
 * and the user would answer them in an arbitrary order. Every path ends in an
 * explicit decision — dismissing the dialog denies, and a question the bridge
 * already withdrew is answered with a harmless error that is swallowed.
 */
export class ApprovalPrompter implements vscode.Disposable {
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(
    private readonly permissions: PermissionService,
    private readonly output: vscode.OutputChannel,
  ) {}

  /** Queues one question; never rejects. */
  ask(question: ApprovalAsk): void {
    if (this.disposed) return;
    this.queue = this.queue.then(() => this.prompt(question)).catch(() => undefined);
  }

  dispose(): void {
    this.disposed = true;
  }

  private async prompt(question: ApprovalAsk): Promise<void> {
    if (this.disposed) return;

    const summary = question.reason?.trim() || 'This action is outside the workspace sandbox.';
    const detail = [
      `Tool: ${question.toolName}`,
      question.callId ? `Call: ${question.callId}` : '',
      question.agentId ? `Agent: ${question.agentId}` : '',
      '',
      'Allow once grants this single call; nothing is remembered.',
    ]
      .filter((line) => line !== '')
      .join('\n');

    const allow = 'Allow once';
    const deny = 'Deny';
    let choice: string | undefined;
    try {
      choice = await vscode.window.showWarningMessage(
        `DSH wants to run “${question.toolName}” — ${summary}`,
        { modal: true, detail },
        allow,
        deny,
      );
    } catch {
      choice = undefined;
    }

    // Dismissed or failed: fail closed. The harness accepts an explicit denial
    // and reports the tool outcome back to the model.
    const outcome = choice === allow ? 'allowed-once' : 'rejected';
    try {
      await this.permissions.respond(question.requestId, outcome);
      this.output.appendLine(`[approval] ${question.toolName} → ${outcome}`);
    } catch (error) {
      // The question may have expired while the dialog was open.
      this.output.appendLine(
        `[approval] ${question.toolName} → could not answer: ${(error as Error).message}`,
      );
    }
  }
}
