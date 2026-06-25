import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import type { LapTrace } from '../shared/types';
import { LAP_BINS } from '../shared/types';

const STORE_FILE = () => path.join(app.getPath('userData'), 'all-time-best.json');

interface StoredTrace {
  throttle: number[];
  brake: number[];
  clutch: number[];
  lapTime: number;
  carKey: string;
  trackKey: string;
}

interface AllTimeBestMap {
  [key: string]: StoredTrace;
}

let cache: AllTimeBestMap | null = null;

function load(): AllTimeBestMap {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(STORE_FILE(), 'utf8');
    cache = JSON.parse(raw) as AllTimeBestMap;
  } catch {
    cache = {};
  }
  return cache;
}

function save(map: AllTimeBestMap): void {
  fs.writeFileSync(STORE_FILE(), JSON.stringify(map), 'utf8');
}

export function makeTraceKey(carKey: string, trackKey: string): string {
  return `${carKey}||${trackKey}`;
}

export function getAllTimeBest(carKey: string, trackKey: string): LapTrace | null {
  const map = load();
  const key = makeTraceKey(carKey, trackKey);
  const stored = map[key];
  if (!stored) return null;
  return {
    throttle: stored.throttle,
    brake: stored.brake,
    clutch: stored.clutch,
    lapTime: stored.lapTime,
    carKey: stored.carKey,
    trackKey: stored.trackKey,
  };
}

export function maybeUpdateAllTimeBest(trace: LapTrace): boolean {
  const map = load();
  const key = makeTraceKey(trace.carKey, trace.trackKey);
  const existing = map[key];
  if (existing && existing.lapTime <= trace.lapTime) return false;

  map[key] = {
    throttle: Array.from(trace.throttle),
    brake: Array.from(trace.brake),
    clutch: Array.from(trace.clutch),
    lapTime: trace.lapTime,
    carKey: trace.carKey,
    trackKey: trace.trackKey,
  };
  cache = map;
  save(map);
  return true;
}

export function resetAllTimeBest(carKey?: string, trackKey?: string): void {
  const map = load();
  if (carKey && trackKey) {
    delete map[makeTraceKey(carKey, trackKey)];
  } else {
    for (const k of Object.keys(map)) delete map[k];
  }
  cache = map;
  save(map);
}

// Resample raw samples (each with lapDistPct 0–1) into LAP_BINS fixed bins
export function resampleIntoBins(
  samples: Array<{ lapDistPct: number; throttle: number; brake: number; clutch: number }>
): { throttle: number[]; brake: number[]; clutch: number[] } {
  const throttle = new Array<number>(LAP_BINS).fill(0);
  const brake    = new Array<number>(LAP_BINS).fill(0);
  const clutch   = new Array<number>(LAP_BINS).fill(0);
  const counts   = new Array<number>(LAP_BINS).fill(0);

  for (const s of samples) {
    const bin = Math.min(LAP_BINS - 1, Math.floor(s.lapDistPct * LAP_BINS));
    throttle[bin] += s.throttle;
    brake[bin]    += s.brake;
    clutch[bin]   += s.clutch;
    counts[bin]   += 1;
  }

  for (let i = 0; i < LAP_BINS; i++) {
    if (counts[i] > 0) {
      throttle[i] /= counts[i];
      brake[i]    /= counts[i];
      clutch[i]   /= counts[i];
    }
  }

  // Forward-fill any empty bins
  for (let i = 1; i < LAP_BINS; i++) {
    if (counts[i] === 0) {
      throttle[i] = throttle[i - 1];
      brake[i]    = brake[i - 1];
      clutch[i]   = clutch[i - 1];
    }
  }

  return { throttle, brake, clutch };
}
