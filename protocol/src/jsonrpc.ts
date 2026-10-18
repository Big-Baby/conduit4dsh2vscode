/**
 * JSON-RPC 2.0 envelopes.
 *
 * Kept dependency-free so both packages can bundle this module as-is.
 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcErrorObject;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export function isRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  const candidate = message as JsonRpcRequest;
  return candidate.id !== undefined && typeof candidate.method === 'string';
}

export function isNotification(message: JsonRpcMessage): message is JsonRpcNotification {
  const candidate = message as JsonRpcRequest;
  return candidate.id === undefined && typeof candidate.method === 'string';
}

export function isResponse(message: JsonRpcMessage): message is JsonRpcResponse {
  const candidate = message as JsonRpcResponse;
  return candidate.result !== undefined || candidate.error !== undefined;
}

export function requestMessage(id: number | string, method: string, params?: unknown): JsonRpcRequest {
  return params === undefined
    ? { jsonrpc: '2.0', id, method }
    : { jsonrpc: '2.0', id, method, params };
}

export function notificationMessage(method: string, params?: unknown): JsonRpcNotification {
  return params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params };
}
