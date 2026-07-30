import fs   from 'fs';
import path from 'path';
import { app } from 'electron';
import type { Settings } from '../shared/types';

const defaults: Settings = {
  overlayVisible: true,
  overlayLocked: true,
  overlayBounds: { x: 20, y: 20, width: 640, height: 140 },
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
    _cache = { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) };
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
