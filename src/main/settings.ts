import fs   from 'fs';
import path from 'path';
import { app } from 'electron';
import type { Settings } from '../shared/types';

// Overlay height. Bumped from 140 → 180 in v1.1.1; OLD_OVERLAY_HEIGHT is used
// by the one-time migration below so machines still on the old default catch up.
const OVERLAY_HEIGHT     = 180;
const OLD_OVERLAY_HEIGHT = 140;

const defaults: Settings = {
  overlayVisible: true,
  overlayLocked: true,
  overlayBounds: { x: 20, y: 20, width: 640, height: OVERLAY_HEIGHT },
  overlayOpacity: 0.85,
  launchOnStartup: false,
  invertClutch: true,
  accentColor: '#00FF87',   // ← Track Vision brand green — update here
  showBranding: true,
  wheelImage: 'drawn',
  channels: {
    throttle: true,
    brake: true,
    clutch: true,
    steering: true,
    gear: true,
    speed: true,
    rpm: true,
  },
  ghosts: {
    sessionBest: true,
    allTimeBest: true,
    throttle: true,
    brake: true,
  },
  debugWaiting: false,
};

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

let _cache: Settings | null = null;

export function getSettings(): Settings {
  if (_cache) return _cache;
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    const loaded = { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) };

    // One-time migration: a machine still sitting on the retired 140 default
    // gets bumped to the new taller height, then written back so it sticks.
    // 140 was never user-selectable, so bumping it is always safe.
    if (loaded.overlayBounds?.height === OLD_OVERLAY_HEIGHT) {
      loaded.overlayBounds = { ...loaded.overlayBounds, height: OVERLAY_HEIGHT };
      try { fs.writeFileSync(settingsPath(), JSON.stringify(loaded, null, 2), 'utf8'); } catch { /* ignore */ }
    }

    _cache = loaded;
  } catch {
    _cache = { ...defaults };
  }
  return _cache;
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  const s = getSettings();
  (s as any)[key] = value;
  _cache = s;
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2), 'utf8');
  } catch (e) {
    console.error('[settings] write error', e);
  }
}
