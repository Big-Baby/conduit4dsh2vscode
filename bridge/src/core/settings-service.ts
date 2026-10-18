import { JsonStore } from '../store/json-store';
import type { BridgePaths } from '../store/paths';

/** Free-form runtime settings exposed through `config.*`. */
export class SettingsService {
  private readonly store: JsonStore<Record<string, unknown>>;

  constructor(paths: BridgePaths) {
    this.store = new JsonStore<Record<string, unknown>>(paths.runtimeConfig, () => ({}));
  }

  all(): Record<string, unknown> {
    return this.store.read();
  }

  get(keys?: string[]): Record<string, unknown> {
    const all = this.all();
    if (!keys?.length) return all;
    const picked: Record<string, unknown> = {};
    for (const key of keys) if (key in all) picked[key] = all[key];
    return picked;
  }

  merge(patch: Record<string, unknown>): Record<string, unknown> {
    const next = { ...this.all(), ...patch };
    this.store.write(next);
    return next;
  }
}
