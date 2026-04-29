/**
 * Persistent config via GM_getValue / GM_setValue
 */
export interface Config {
  token: string;
  interval: number;
  autoApprove: boolean;
  autoSkip: boolean;
  saveLog: boolean;
  panelVisible: boolean;
}

export function loadConfig(): Config {
  return {
    token: GM_getValue('gh_token', ''),
    interval: GM_getValue('interval', 15),
    autoApprove: GM_getValue('auto_approve', true),
    autoSkip: GM_getValue('auto_skip', true),
    saveLog: GM_getValue('save_log', false),
    panelVisible: GM_getValue('panel_visible', true),
  };
}

export function saveConfigField<K extends keyof Config>(key: K, value: Config[K]): void {
  const keyMap: Record<keyof Config, string> = {
    token: 'gh_token',
    interval: 'interval',
    autoApprove: 'auto_approve',
    autoSkip: 'auto_skip',
    saveLog: 'save_log',
    panelVisible: 'panel_visible',
  };
  GM_setValue(keyMap[key], value);
}
