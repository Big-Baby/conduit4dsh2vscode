/**
 * Error codes. The JSON-RPC reserved range is used as-is; application errors
 * live in -32000..-32099 and are grouped by domain.
 */
export const ErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,

  ServerNotReady: -32000,
  AuthFailed: -32001,
  ProtocolMismatch: -32002,
  RequestCancelled: -32003,

  ProjectNotFound: -32010,
  SessionNotFound: -32011,
  SessionBusy: -32012,
  MessageNotFound: -32013,

  ProviderNotFound: -32020,
  ModelNotFound: -32021,
  ProviderExists: -32022,

  PathOutsideWorkspace: -32030,
  FileTooLarge: -32031,

  DshApiMismatch: -32040,
  AgentNotFound: -32050,

  PluginNotFound: -32060,
  PluginInstallFailed: -32061,
  RegistryUnavailable: -32062,
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export class RpcError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.data = data;
  }
}

export function isRpcError(value: unknown): value is RpcError {
  return value instanceof RpcError;
}

/** Normalizes any thrown value into the wire representation. */
export function toErrorObject(error: unknown): { code: number; message: string; data?: unknown } {
  if (error instanceof RpcError) {
    return error.data === undefined
      ? { code: error.code, message: error.message }
      : { code: error.code, message: error.message, data: error.data };
  }
  if (error instanceof Error) {
    return { code: ErrorCode.InternalError, message: error.message };
  }
  return { code: ErrorCode.InternalError, message: String(error) };
}
