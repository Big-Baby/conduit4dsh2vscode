import * as vscode from 'vscode';
import type { ModelService } from '../../core/model-service';
import { DIAGNOSTIC_BOOTSTRAP, renderHtml } from './html';

export interface FetchedModel {
  id: string;
  free: boolean;
}

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'cancel' }
  | { type: 'fetchModels'; baseURL: string; apiKey: string; kind: string }
  | {
      type: 'save';
      provider: { id: string; kind: string; baseURL?: string; models: Array<{ id: string; name: string }> };
      apiKey: string;
      setDefaultModelId: string;
    };

const PRESETS = [
  { kind: 'openai', label: 'OpenAI', baseURL: 'https://api.openai.com/v1' },
  { kind: 'deepseek', label: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1' },
  { kind: 'anthropic', label: 'Anthropic', baseURL: 'https://api.anthropic.com/v1' },
  { kind: 'moonshotai', label: 'Moonshot', baseURL: 'https://api.moonshot.cn/v1' },
  { kind: 'zai', label: 'Z.ai', baseURL: 'https://open.bigmodel.cn/api/paas/v4' },
  { kind: 'custom', label: 'Custom (OpenAI compatible)', baseURL: '' },
];

/** Single-page provider setup: paste a key, load models, tick what to enable. */
export class ProviderPanel {
  private static current: ProviderPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  static createOrShow(
    extensionUri: vscode.Uri,
    models: ModelService,
    onSaved: () => void,
  ): ProviderPanel {
    if (ProviderPanel.current) {
      ProviderPanel.current.panel.reveal();
      return ProviderPanel.current;
    }

    const panel = vscode.window.createWebviewPanel('dshProvider', 'Add model provider', vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
    });
    ProviderPanel.current = new ProviderPanel(panel, models, onSaved);
    return ProviderPanel.current;
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly models: ModelService,
    private readonly onSaved: () => void,
  ) {
    this.panel.webview.html = renderHtml({
      webview: this.panel.webview,
      title: 'Add model provider',
      body: BODY,
      style: STYLE,
      bootstrap: DIAGNOSTIC_BOOTSTRAP,
      script: script(),
    });

    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => void this.handle(message),
      null,
      this.disposables,
    );
    this.panel.onDidDispose(() => this.cleanup(), null, this.disposables);
  }

  private post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }

  private async handle(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        break;

      case 'cancel':
        this.panel.dispose();
        break;

      case 'fetchModels':
        try {
          this.post({ type: 'models', models: await fetchModels(message.baseURL, message.apiKey, message.kind) });
        } catch (error) {
          this.post({ type: 'modelsError', message: (error as Error).message });
        }
        break;

      case 'save':
        try {
          const { id, kind, baseURL, models } = message.provider;
          if (!id) throw new Error('Provider id is required');
          if (!models.length) throw new Error('Select at least one model');

          await this.models.addProvider({
            id,
            kind,
            ...(baseURL ? { baseURL } : {}),
            ...(message.apiKey ? { apiKey: message.apiKey } : {}),
            models,
          });
          if (message.setDefaultModelId) {
            await this.models.setDefault(message.setDefaultModelId);
          }

          this.post({ type: 'saved', defaultModelId: message.setDefaultModelId });
          this.onSaved();
        } catch (error) {
          this.post({ type: 'saveError', message: (error as Error).message });
        }
        break;
    }
  }

  private cleanup(): void {
    ProviderPanel.current = undefined;
    for (const disposable of this.disposables) disposable.dispose();
  }
}

/**
 * Loads the model list from an OpenAI-compatible endpoint.
 *
 * This runs in the extension host because the webview CSP forbids network
 * access; Anthropic needs its own authentication headers.
 */
export async function fetchModels(baseURL: string, apiKey: string, kind: string): Promise<FetchedModel[]> {
  const url = `${baseURL.replace(/\/+$/, '')}/models`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  const key = apiKey.trim();

  if (key) {
    if (kind === 'anthropic') {
      headers['x-api-key'] = key;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers.Authorization = `Bearer ${key}`;
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

  const payload = (await response.json()) as { data?: Array<{ id?: string; name?: string }> };
  const models = (Array.isArray(payload.data) ? payload.data : [])
    .map((entry) => String(entry?.id ?? entry?.name ?? '').trim())
    .filter(Boolean)
    // Purely cosmetic: marks ids the endpoint itself advertises as free.
    .map((id) => ({ id, free: /-free$/i.test(id) }));

  if (!models.length) throw new Error('The endpoint returned no models');
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

const BODY = `
<div class="page">
  <h1>Add model provider</h1>
  <p class="subtitle">
    Choose a preset or enter an OpenAI-compatible endpoint, paste the key, then load the model list.
  </p>

  <label class="field">
    <span>Provider type</span>
    <select id="kind"></select>
  </label>

  <div class="row">
    <label class="field">
      <span>Provider id</span>
      <input id="provider-id" type="text" placeholder="unique id, e.g. my-gateway" />
    </label>
    <label class="field">
      <span>Base URL</span>
      <input id="base-url" type="text" placeholder="https://api.example.com/v1" />
    </label>
  </div>

  <label class="field">
    <span>API key <em>(optional for open gateways)</em></span>
    <input id="api-key" type="password" autocomplete="off" spellcheck="false" />
  </label>

  <div class="actions">
    <button class="btn primary" id="fetch" type="button">Load models</button>
    <span class="status" id="status"></span>
  </div>

  <div class="toolbar">
    <strong>Models</strong>
    <input class="search" id="search" type="text" placeholder="Filter model ids…" />
    <button class="btn" id="select-all" type="button">Select all</button>
    <button class="btn" id="clear" type="button">Clear</button>
  </div>
  <div class="models" id="models"></div>

  <footer>
    <span id="count">No models loaded</span>
    <span class="grow"></span>
    <button class="btn" id="cancel" type="button">Cancel</button>
    <button class="btn" id="save" type="button" disabled>Save</button>
    <button class="btn primary" id="save-default" type="button" disabled>Save and use</button>
  </footer>
</div>`;

const STYLE = `
:root { color-scheme: light dark; }
body {
  margin: 0; padding: 24px; font-family: var(--vscode-font-family);
  font-size: 13px; color: var(--vscode-foreground); background: var(--vscode-editor-background);
}
.page { max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
h1 { font-size: 18px; margin: 0; font-weight: 600; }
.subtitle { margin: 0; color: var(--vscode-descriptionForeground); line-height: 1.5; }
.field { display: flex; flex-direction: column; gap: 6px; flex: 1; }
.field span { color: var(--vscode-descriptionForeground); }
.field em { font-style: normal; opacity: .7; }
.row { display: flex; gap: 12px; }
input, select {
  padding: 6px 8px; border-radius: 4px; font: inherit;
  color: var(--vscode-input-foreground); background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
}
input:focus, select:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.actions { display: flex; align-items: center; gap: 12px; }
.status { color: var(--vscode-descriptionForeground); font-size: 12px; }
.toolbar { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.toolbar .search { flex: 1; }
.models {
  min-height: 180px; max-height: 320px; overflow: auto; padding: 8px;
  border: 1px solid var(--vscode-panel-border); border-radius: 6px;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 4px 12px;
}
.models label { display: flex; gap: 8px; align-items: center; padding: 2px 4px; border-radius: 4px; }
.models label:hover { background: var(--vscode-list-hoverBackground); }
.models .free { color: var(--vscode-charts-green); font-size: 11px; }
.empty { grid-column: 1 / -1; color: var(--vscode-descriptionForeground); padding: 8px; }
footer { display: flex; align-items: center; gap: 8px; padding-top: 8px; }
.grow { flex: 1; }
.btn {
  padding: 5px 12px; border-radius: 4px; cursor: pointer; font: inherit;
  color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground);
  border: none;
}
.btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
.btn.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
.btn.primary:hover { background: var(--vscode-button-hoverBackground); }
.btn:disabled { opacity: .5; cursor: default; }
#count { color: var(--vscode-descriptionForeground); font-size: 12px; }
`;

function script(): string {
  return `
const vscode = acquireVsCodeApi();
const presets = ${JSON.stringify(PRESETS)};
let models = [];
let selected = new Set();

const kind = document.getElementById('kind');
const idInput = document.getElementById('provider-id');
const baseURL = document.getElementById('base-url');
const apiKey = document.getElementById('api-key');
const list = document.getElementById('models');
const status = document.getElementById('status');
const count = document.getElementById('count');
const search = document.getElementById('search');
const save = document.getElementById('save');
const saveDefault = document.getElementById('save-default');

for (const preset of presets) {
  const option = document.createElement('option');
  option.value = preset.kind;
  option.textContent = preset.label;
  kind.appendChild(option);
}

function applyPreset() {
  const preset = presets.find((item) => item.kind === kind.value);
  if (!preset) return;
  baseURL.value = preset.baseURL;
  if (!idInput.value) idInput.value = preset.kind === 'custom' ? '' : preset.kind;
}

function render() {
  const query = search.value.trim().toLowerCase();
  list.textContent = '';
  const visible = models.filter((model) => !query || model.id.toLowerCase().includes(query));
  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = models.length ? 'No model matches the filter.' : 'Load the model list first.';
    list.appendChild(empty);
  }
  for (const model of visible) {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selected.has(model.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selected.add(model.id); else selected.delete(model.id);
      updateCount();
    });
    const text = document.createElement('span');
    text.textContent = model.id;
    label.append(checkbox, text);
    if (model.free) {
      const badge = document.createElement('span');
      badge.className = 'free';
      badge.textContent = 'free';
      label.appendChild(badge);
    }
    list.appendChild(label);
  }
  updateCount();
}

function updateCount() {
  count.textContent = selected.size
    ? selected.size + ' of ' + models.length + ' selected'
    : models.length ? 'No model selected' : 'No models loaded';
  const enabled = Boolean(idInput.value.trim()) && selected.size > 0;
  save.disabled = !enabled;
  saveDefault.disabled = !enabled;
}

async function loadModels() {
  if (!baseURL.value.trim()) { status.textContent = 'Base URL is required.'; return; }
  status.textContent = 'Loading models…';
  vscode.postMessage({ type: 'fetchModels', baseURL: baseURL.value.trim(), apiKey: apiKey.value, kind: kind.value });
}

function submit(useAsDefault) {
  const chosen = models
    .filter((model) => selected.has(model.id))
    .map((model) => ({ id: model.id, name: model.id }));
  vscode.postMessage({
    type: 'save',
    provider: {
      id: idInput.value.trim(),
      kind: kind.value,
      baseURL: baseURL.value.trim(),
      models: chosen,
    },
    apiKey: apiKey.value,
    setDefaultModelId: useAsDefault ? chosen[0]?.id || '' : '',
  });
}

kind.addEventListener('change', applyPreset);
document.getElementById('fetch').addEventListener('click', loadModels);
apiKey.addEventListener('keydown', (event) => { if (event.key === 'Enter') loadModels(); });
search.addEventListener('input', render);
document.getElementById('select-all').addEventListener('click', () => {
  for (const model of models) selected.add(model.id);
  render();
});
document.getElementById('clear').addEventListener('click', () => { selected.clear(); render(); });
document.getElementById('cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
save.addEventListener('click', () => submit(false));
saveDefault.addEventListener('click', () => submit(true));
idInput.addEventListener('input', updateCount);

window.addEventListener('message', (event) => {
  const message = event.data;
  if (message.type === 'models') {
    models = message.models;
    selected = new Set();
    status.textContent = models.length + ' models available';
    render();
  } else if (message.type === 'modelsError') {
    status.textContent = 'Load failed: ' + message.message;
  } else if (message.type === 'saved') {
    status.textContent = 'Provider saved.';
  } else if (message.type === 'saveError') {
    status.textContent = 'Save failed: ' + message.message;
  }
});

applyPreset();
updateCount();
vscode.postMessage({ type: 'ready' });
`;
}
