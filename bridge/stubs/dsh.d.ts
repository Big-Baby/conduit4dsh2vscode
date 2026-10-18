/**
 * Minimal declarations of the harness packages used by the bridge.
 *
 * They allow this repository to be type-checked without the harness installed;
 * production builds resolve the real packages, which expose a wider API surface
 * than the subset declared here.
 */

declare module '@deepseek-ai/cordis' {
  export interface Context {
    get<T = unknown>(key: string): T;
    set?(key: string, value: unknown): void;
    provide?(key: string, value: unknown): void;
    effect(fn: () => (() => void) | void): void;
    on(event: string, callback: (payload: never) => void): () => void;
    logger: {
      info(message: string): void;
      warn(message: string): void;
      error(message: string): void;
    };
  }
}

declare module '@deepseek-ai/schemastery' {
  export interface Schema<T> {
    readonly __type?: T;
    default(value: T): Schema<T>;
  }

  interface Z {
    object(shape: Record<string, Schema<unknown>>): Schema<Record<string, unknown>>;
    string(): Schema<string>;
    number(): Schema<number>;
    boolean(): Schema<boolean>;
    const<V extends string | number | boolean>(value: V): Schema<V>;
    union<T>(members: Schema<T>[]): Schema<T>;
  }

  const z: Z;
  export default z;
}
