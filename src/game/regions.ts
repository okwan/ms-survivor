/** The run is split into seven regions, one per boss interval (docs/DESIGN.md). Pure data, no DOM. */
import { BOSS_EVERY } from './data.ts';

export const REGION_COUNT = 7;

/** Region index at run time t (seconds): it advances at 2:15, 4:30, ... 13:30, exactly when each boss spawns. */
export function regionAt(t: number): number {
  return Math.max(0, Math.min(REGION_COUNT - 1, Math.floor(t / BOSS_EVERY)));
}
