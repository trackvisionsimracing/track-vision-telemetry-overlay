import { BrowserWindow } from 'electron';
import { IPC, TelemetrySample, SessionInfo, LapTrace } from '../shared/types';
import { getSettings } from './settings';
import { resampleIntoBins, maybeUpdateAllTimeBest, getAllTimeBest } from './lapStore';

// irsdk-node v4 — has N-API prebuilt binaries for win32-x64
let IRacingSDK: any = null;
try {
  const mod = require('irsdk-node');
  IRacingSDK = mod.IRacingSDK;
  console.log('[telemetry] irsdk-node loaded');
} catch (e) {
  console.warn('[telemetry] irsdk-node unavailable — stub mode:', (e as Error).message);
}

const POLL_HZ = 60;
const POLL_MS = Math.round(1000 / POLL_HZ);
const MIN_LAP_TIME = 30;

interface LapSample {
  lapDistPct: number;
  throttle:   number;
  brake:      number;
  clutch:     number;
}

let pollInterval: ReturnType<typeof setInterval> | null = null;
let windows: BrowserWindow[] = [];
let sdk: any = null;

let sessionBest: LapTrace | null = null;
let allTimeBest: LapTrace | null = null;
let currentLapSamples: LapSample[] = [];
let prevLap = -1;
let hadPitRoad  = false;
let sessionInfo: SessionInfo = { carName: '', trackName: '', trackConfig: '' };

// ─── Window management ────────────────────────────────────────────────────────

export function registerTelemetryWindow(win: BrowserWindow): void {
  windows = windows.filter(w => !w.isDestroyed());
  windows.push(win);
}

function broadcast(channel: string, data: unknown): void {
  windows = windows.filter(w => !w.isDestroyed());
  for (const win of windows) {
    try { win.webContents.send(channel, data); } catch { /* closing */ }
  }
}

// ─── Stub (no iRacing / no SDK) ───────────────────────────────────────────────

function stubSample(): TelemetrySample {
  const t = Date.now() / 1000;
  return {
    throttle: Math.max(0, Math.sin(t * 0.7) * 0.5 + 0.5),
    brake:    Math.max(0, Math.sin(t * 0.4 + 1) * 0.3),
    clutch:   0,
    steeringAngle: Math.sin(t * 0.3) * 0.4,
    gear: 3, speedMs: 40, rpm: 6500,
    lap: 1, lapDistPct: (t % 90) / 90,
    lapCurrentTime: t % 90, lapLastTime: 0, lapBestTime: 0,
    onPitRoad: false, isOnTrack: true, sessionFlags: 0,
    connected: false,
  };
}

// ─── Session info ─────────────────────────────────────────────────────────────

let lastSessionVer = -1;

function maybeUpdateSessionInfo(): void {
  if (!sdk) return;
  const ver = sdk.currDataVersion ?? 0;
  if (ver === lastSessionVer) return;
  lastSessionVer = ver;

  try {
    const weekend = sdk.getWeekendInfo();
    const driver  = sdk.getDriverInfo();
    const myIdx   = driver?.DriverCarIdx ?? 0;
    const myDriver = driver?.Drivers?.[myIdx];

    const carName   = myDriver?.CarScreenName ?? myDriver?.CarPath ?? 'unknown';
    const trackName = weekend?.TrackDisplayName ?? 'unknown';
    const trackCfg  = weekend?.TrackConfigName  ?? '';

    if (
      carName   !== sessionInfo.carName ||
      trackName !== sessionInfo.trackName ||
      trackCfg  !== sessionInfo.trackConfig
    ) {
      sessionInfo = { carName, trackName, trackConfig: trackCfg };
      broadcast(IPC.SESSION_INFO, sessionInfo);

      // Load stored all-time best for new car+track
      const stored = getAllTimeBest(carName, `${trackName}||${trackCfg}`);
      allTimeBest  = stored;
      broadcast(IPC.GHOST_UPDATE, { sessionBest, allTimeBest });
    }
  } catch (e) {
    console.error('[telemetry] session info error', e);
  }
}

// ─── Lap completion ───────────────────────────────────────────────────────────

function handleLapCompletion(lapTime: number): void {
  const samples = currentLapSamples.slice();
  currentLapSamples = [];

  if (lapTime <= 0 || lapTime < MIN_LAP_TIME) {
    console.log('[telemetry] skip: bad lap time', lapTime);
    return;
  }
  if (hadPitRoad) {
    console.log('[telemetry] skip: pit road');
    return;
  }
  if (samples.length < 100) {
    console.log('[telemetry] skip: too few samples', samples.length);
    return;
  }
  const minPct = Math.min(...samples.map(s => s.lapDistPct));
  const maxPct = Math.max(...samples.map(s => s.lapDistPct));
  if (maxPct - minPct < 0.8) {
    console.log('[telemetry] skip: incomplete lap', minPct.toFixed(2), maxPct.toFixed(2));
    return;
  }

  const { throttle, brake, clutch } = resampleIntoBins(samples);
  const carKey   = sessionInfo.carName;
  const trackKey = `${sessionInfo.trackName}||${sessionInfo.trackConfig}`;
  const trace: LapTrace = { throttle, brake, clutch, lapTime, carKey, trackKey };

  console.log(`[telemetry] clean lap ${lapTime.toFixed(3)}s  samples=${samples.length}`);

  if (!sessionBest || lapTime < sessionBest.lapTime) {
    sessionBest = trace;
    console.log('[telemetry] new session best');
  }
  if (maybeUpdateAllTimeBest(trace)) {
    allTimeBest = trace;
    console.log('[telemetry] new all-time best');
  }

  broadcast(IPC.GHOST_UPDATE, { sessionBest, allTimeBest });
}

// ─── Telemetry tick ───────────────────────────────────────────────────────────

function tick(): void {
  if (!sdk) return;

  // waitForData(0) = non-blocking check for new data
  const hasData = sdk.waitForData(0);
  if (!hasData) return;

  const alive = sdk.sessionStatusOK;

  if (!alive) {
    broadcast(IPC.TELEMETRY_UPDATE, { connected: false } as Partial<TelemetrySample>);
    // Try to reconnect automatically
    try { sdk.startSDK(); } catch { /* ignore */ }
    return;
  }

  maybeUpdateSessionInfo();

  const telem = sdk.getTelemetry();
  if (!telem) return;

  const settings = getSettings();
  const rawClutch: number = telem.Clutch?.value?.[0] ?? 0;
  const clutch = settings.invertClutch ? 1 - rawClutch : rawClutch;

  const lap: number     = telem.Lap?.value?.[0] ?? 0;
  const onPit: boolean  = telem.OnPitRoad?.value?.[0] ?? false;
  const isOnTrack: boolean = telem.IsOnTrack?.value?.[0] ?? false;
  const lapDistPct: number = telem.LapDistPct?.value?.[0] ?? 0;
  const lapLastTime: number = telem.LapLastLapTime?.value?.[0] ?? 0;

  const sample: TelemetrySample = {
    throttle:      telem.Throttle?.value?.[0] ?? 0,
    brake:         telem.Brake?.value?.[0]    ?? 0,
    clutch,
    steeringAngle: telem.SteeringWheelAngle?.value?.[0] ?? 0,
    gear:          telem.Gear?.value?.[0]     ?? 0,
    speedMs:       telem.Speed?.value?.[0]    ?? 0,
    rpm:           telem.RPM?.value?.[0]      ?? 0,
    lap,
    lapDistPct,
    lapCurrentTime: telem.LapCurrentLapTime?.value?.[0] ?? 0,
    lapLastTime,
    lapBestTime:   telem.LapBestLapTime?.value?.[0]    ?? 0,
    onPitRoad:  onPit,
    isOnTrack,
    sessionFlags:  telem.SessionFlags?.value?.[0] ?? 0,
    connected: true,
  };

  if (isOnTrack) {
    currentLapSamples.push({ lapDistPct, throttle: sample.throttle, brake: sample.brake, clutch });
    if (onPit) hadPitRoad = true;
  }

  if (prevLap >= 0 && lap > prevLap) {
    handleLapCompletion(lapLastTime);
    hadPitRoad = false;
  }
  prevLap = lap;

  broadcast(IPC.TELEMETRY_UPDATE, sample);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function resetSessionBest(): void {
  sessionBest = null;
  broadcast(IPC.GHOST_UPDATE, { sessionBest, allTimeBest });
}

export function getGhosts() {
  return { sessionBest, allTimeBest };
}

export function startTelemetry(): void {
  if (pollInterval) return;

  if (!IRacingSDK) {
    console.log('[telemetry] stub mode');
    pollInterval = setInterval(() => broadcast(IPC.TELEMETRY_UPDATE, stubSample()), POLL_MS);
    return;
  }

  try {
    sdk = new IRacingSDK({ autoEnableTelemetry: false });
    const started = sdk.startSDK();
    console.log(`[telemetry] startSDK → ${started}`);
  } catch (e) {
    console.error('[telemetry] SDK init failed, falling back to stub', e);
    sdk = null;
    pollInterval = setInterval(() => broadcast(IPC.TELEMETRY_UPDATE, stubSample()), POLL_MS);
    return;
  }

  pollInterval = setInterval(tick, POLL_MS);
  console.log('[telemetry] poll loop started at', POLL_HZ, 'Hz');
}

export function stopTelemetry(): void {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  try { sdk?.stopSDK(); } catch { /* ignore */ }
  sdk = null;
  console.log('[telemetry] stopped');
}
