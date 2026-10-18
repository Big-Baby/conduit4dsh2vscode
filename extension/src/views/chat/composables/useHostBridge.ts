interface HostApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): HostApi;

export function useHostBridge(): {
  post: (message: unknown) => void;
  onMessage: (listener: (message: never) => void) => void;
} {
  const api = acquireVsCodeApi();
  return {
    post: (message) => api.postMessage(message),
    onMessage: (listener) => {
      window.addEventListener('message', (event) => listener(event.data as never));
    },
  };
}
