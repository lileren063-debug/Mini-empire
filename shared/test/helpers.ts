import { DEFAULT_CONFIG, type RuleCtx } from '../src/index.js';

export const T0 = Date.UTC(2026, 0, 1);
let n = 0;
export function ctx(now = T0): RuleCtx {
  return { now, cfg: DEFAULT_CONFIG, newId: () => `id${++n}` };
}
