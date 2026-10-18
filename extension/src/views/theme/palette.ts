import * as vscode from 'vscode';

export interface ChatPalette {
  accent: string;
  userBubble: string;
  assistantBubble: string;
  systemText: string;
  border: string;
  selectionText: string;
  selectionBg: string;
  agentRunning: string;
  agentSuccess: string;
  agentError: string;
  agentCancelled: string;
  agentWaiting: string;
  toolRunning: string;
  toolSuccess: string;
  toolError: string;
}

export interface UiPreferences {
  collapseLongMessages: boolean;
  collapseThresholdLines: number;
  collapseReasoning: boolean;
  collapseToolResults: boolean;
  showTimestamps: boolean;
  compact: boolean;
  maxWidth: number;
}

const LIGHT: ChatPalette = {
  accent: '#0e639c',
  userBubble: 'rgba(14, 99, 156, 0.10)',
  assistantBubble: 'rgba(0, 0, 0, 0.04)',
  systemText: 'rgba(0, 0, 0, 0.55)',
  border: 'rgba(0, 0, 0, 0.14)',
  selectionText: '#6b5bd2',
  selectionBg: 'rgba(107, 91, 210, 0.18)',
  agentRunning: '#b06a1b',
  agentSuccess: '#1e7a34',
  agentError: '#b3261e',
  agentCancelled: '#6f6f6f',
  agentWaiting: '#7a7a7a',
  toolRunning: '#b06a1b',
  toolSuccess: '#1e7a34',
  toolError: '#b3261e',
};

const DARK: ChatPalette = {
  accent: '#4da3ff',
  userBubble: 'rgba(77, 163, 255, 0.14)',
  assistantBubble: 'rgba(255, 255, 255, 0.06)',
  systemText: 'rgba(255, 255, 255, 0.62)',
  border: 'rgba(255, 255, 255, 0.16)',
  selectionText: '#ffe08a',
  selectionBg: 'rgba(255, 224, 138, 0.22)',
  agentRunning: '#e2a03f',
  agentSuccess: '#4cc26a',
  agentError: '#f14c4c',
  agentCancelled: '#9c9c9c',
  agentWaiting: '#b6b6b6',
  toolRunning: '#e2a03f',
  toolSuccess: '#4cc26a',
  toolError: '#f14c4c',
};

const HIGH_CONTRAST: Partial<ChatPalette> = {
  systemText: 'currentColor',
  border: 'currentColor',
  agentCancelled: 'currentColor',
  agentWaiting: 'currentColor',
};

/** Webviews cannot resolve theme tokens, so the host resolves them here. */
export function buildPalette(): ChatPalette {
  const kind = vscode.window.activeColorTheme.kind;
  const dark = kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast;
  const highContrast =
    kind === vscode.ColorThemeKind.HighContrast || kind === vscode.ColorThemeKind.HighContrastLight;
  const base = dark ? DARK : LIGHT;
  const config = vscode.workspace.getConfiguration('dsh.ui');

  const palette = {} as ChatPalette;
  for (const key of Object.keys(base) as Array<keyof ChatPalette>) {
    const custom = config.get<string>(key, '');
    if (custom.trim()) {
      palette[key] = custom.trim();
      continue;
    }
    palette[key] = (highContrast ? HIGH_CONTRAST[key] : undefined) ?? base[key];
  }
  return palette;
}

export function buildPreferences(): UiPreferences {
  const config = vscode.workspace.getConfiguration('dsh.ui');
  return {
    collapseLongMessages: config.get<boolean>('collapseLongMessages', true),
    collapseThresholdLines: config.get<number>('collapseThresholdLines', 14),
    collapseReasoning: config.get<boolean>('collapseReasoning', true),
    collapseToolResults: config.get<boolean>('collapseToolResults', true),
    showTimestamps: config.get<boolean>('showTimestamps', true),
    compact: config.get<boolean>('compact', false),
    maxWidth: config.get<number>('maxWidth', 860),
  };
}
