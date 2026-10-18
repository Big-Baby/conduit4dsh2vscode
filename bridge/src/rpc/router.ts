import { ErrorCode, RpcError, type MethodHandlers, type MethodName } from '@conduit4dsh2vscode/protocol';

type AnyHandler = (params: never) => unknown;

/** Method table with runtime lookup and uniform error semantics. */
export class Router {
  private readonly table = new Map<string, AnyHandler>();

  registerAll(handlers: MethodHandlers): void {
    for (const [method, handler] of Object.entries(handlers) as Array<[MethodName, AnyHandler]>) {
      this.table.set(method, handler);
    }
  }

  has(method: string): boolean {
    return this.table.has(method);
  }

  get size(): number {
    return this.table.size;
  }

  async dispatch(method: string, params: unknown): Promise<unknown> {
    const handler = this.table.get(method);
    if (!handler) {
      throw new RpcError(ErrorCode.MethodNotFound, `method not found: ${method}`);
    }
    return handler((params ?? {}) as never);
  }
}
