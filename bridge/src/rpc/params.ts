import { ErrorCode, RpcError } from '@conduit4dsh2vscode/protocol';

type Bag = Record<string, unknown>;

function bag(params: unknown): Bag {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new RpcError(ErrorCode.InvalidParams, 'params must be an object');
  }
  return params as Bag;
}

export function requireString(params: unknown, key: string): string {
  const value = bag(params)[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new RpcError(ErrorCode.InvalidParams, `${key} is required`);
  }
  return value;
}

export function optionalString(params: unknown, key: string): string | undefined {
  const value = bag(params)[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new RpcError(ErrorCode.InvalidParams, `${key} must be a string`);
  }
  return value;
}

export function optionalBoolean(params: unknown, key: string): boolean | undefined {
  const value = bag(params)[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    throw new RpcError(ErrorCode.InvalidParams, `${key} must be a boolean`);
  }
  return value;
}

export function optionalNumber(params: unknown, key: string): number | undefined {
  const value = bag(params)[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RpcError(ErrorCode.InvalidParams, `${key} must be a number`);
  }
  return value;
}

export function requireObject<T extends object>(params: unknown, key: string): T {
  const value = bag(params)[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RpcError(ErrorCode.InvalidParams, `${key} must be an object`);
  }
  return value as T;
}

export function optionalArray<T>(params: unknown, key: string): T[] | undefined {
  const value = bag(params)[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new RpcError(ErrorCode.InvalidParams, `${key} must be an array`);
  }
  return value as T[];
}

export function requireBoolean(params: unknown, key: string): boolean {
  const value = bag(params)[key];
  if (typeof value !== 'boolean') {
    throw new RpcError(ErrorCode.InvalidParams, `${key} must be a boolean`);
  }
  return value;
}
