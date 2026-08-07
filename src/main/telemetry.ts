import { BrowserWindow } from 'electron';
import { IPC, TelemetrySample, SessionInfo, LapTrace } from '../shared/types';
import { getSettings } from './settings';
import { resampleIntoBins, maybeUpdateAllTimeBest, getAllTimeBest } from './lapStore';
import { acRead, acStop } from './acShared';
import { f1Start, f1Read, f1Stop, getF1Ports } from './f1Udp';

export { getF1Ports };

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
    // Skip the 60 Hz telemetry stream for hidden windows — state updates
    // (settings/ghosts/session) still go through so they're fresh on re-show
    if (channel === IPC.TELEMETRY_UPDATE && !win.isVisible()) continue;
    try { win.webContents.send(channel, data); } catch { /* closing */ }
  }
}

// ─── Session info ─────────────────────────────────────────────────────────────

function applySessionInfo(si: SessionInfo): void {
  if (
    si.carName     === sessionInfo.carName &&
    si.trackName   === sessionInfo.trackName &&
    si.trackConfig === sessionInfo.trackConfig
  ) return;

  sessionInfo = si;
  broadcast(IPC.SESSION_INFO, sessionInfo);

  // Load stored all-time best for new car+track
  const stored = getAllTimeBest(si.carName, `${si.trackName}||${si.trackConfig}`);
  allTimeBest  = stored;
  broadcast(IPC.GHOST_UPDATE, { sessionBest, allTimeBest });
}

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

    applySessionInfo({ carName, trackName, trackConfig: trackCfg });
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

function irTick(): TelemetrySample | null {
  if (!sdk) return null;

  // waitForData(0) = non-blocking check for new data
  const hasData = sdk.waitForData(0);
  if (!hasData) return null;

  if (!sdk.sessionStatusOK) {
    // Try to reconnect automatically
    try { sdk.startSDK(); } catch { /* ignore */ }
    return null;
  }

  maybeUpdateSessionInfo();

  const telem = sdk.getTelemetry();
  if (!telem) return null;

  const settings = getSettings();
  const rawClutch: number = telem.Clutch?.value?.[0] ?? 0;
  const clutch = settings.invertClutch ? 1 - rawClutch : rawClutch;

  return {
    throttle:      telem.Throttle?.value?.[0] ?? 0,
    brake:         telem.Brake?.value?.[0]    ?? 0,
    clutch,
    steeringAngle: telem.SteeringWheelAngle?.value?.[0] ?? 0,
    gear:          telem.Gear?.value?.[0]     ?? 0,
    speedMs:       telem.Speed?.value?.[0]    ?? 0,
    rpm:           telem.RPM?.value?.[0]      ?? 0,
    lap:           telem.Lap?.value?.[0]      ?? 0,
    lapDistPct:    telem.LapDistPct?.value?.[0] ?? 0,
    lapCurrentTime: telem.LapCurrentLapTime?.value?.[0] ?? 0,
    lapLastTime:   telem.LapLastLapTime?.value?.[0]    ?? 0,
    lapBestTime:   telem.LapBestLapTime?.value?.[0]    ?? 0,
    onPitRoad:     telem.OnPitRoad?.value?.[0] ?? false,
    isOnTrack:     telem.IsOnTrack?.value?.[0] ?? false,
    sessionFlags:  telem.SessionFlags?.value?.[0] ?? 0,
    connected: true,
  };
}

function acTick(): TelemetrySample | null {
  const ac = acRead();
  if (!ac) return null;

  applySessionInfo(ac.session);

  const settings = getSettings();
  if (settings.invertClutch) ac.sample.clutch = 1 - ac.sample.clutch;
  return ac.sample;
}

function f1Tick(): TelemetrySample | null {
  const f1 = f1Read();
  if (!f1) return null;

  applySessionInfo(f1.session);
  return f1.sample; // F1 clutch is already "amount pressed" — no inversion
}

function processSample(sample: TelemetrySample): void {
  if (sample.isOnTrack) {
    currentLapSamples.push({
      lapDistPct: sample.lapDistPct,
      throttle:   sample.throttle,
      brake:      sample.brake,
      clutch:     sample.clutch,
    });
    if (sample.onPitRoad) hadPitRoad = true;
  }

  if (prevLap >= 0 && sample.lap > prevLap) {
    handleLapCompletion(sample.lapLastTime);
    hadPitRoad = false;
  }
  prevLap = sample.lap;

  broadcast(IPC.TELEMETRY_UPDATE, sample);
}

let lastSampleTime         = 0;
let lastDisconnectBroadcast = 0;

function tick(): void {
  // iRacing first; if it has nothing this tick, try AC / ACC / AC EVO, then F1
  const sample = irTick() ?? acTick() ?? f1Tick();
  const now = Date.now();

  if (sample) {
    lastSampleTime = now;
    processSample(sample);
    return;
  }

  // Only report disconnected after a real gap — iRacing legitimately has no
  // new frame on some 60 Hz ticks, and that must not flicker the status dot.
  if (now - lastSampleTime > 2000 && now - lastDisconnectBroadcast > 1000) {
    lastDisconnectBroadcast = now;
    broadcast(IPC.TELEMETRY_UPDATE, { connected: false } as Partial<TelemetrySample>);
  }
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

  if (IRacingSDK) {
    try {
      sdk = new IRacingSDK({ autoEnableTelemetry: false });
      const started = sdk.startSDK();
      console.log(`[telemetry] startSDK → ${started}`);
    } catch (e) {
      console.error('[telemetry] iRacing SDK init failed', e);
      sdk = null;
    }
  } else {
    console.log('[telemetry] iRacing SDK unavailable — AC shared memory only');
  }

  f1Start(); // UDP listener for F1 25 (and F1 22–24)

  // The loop always runs: iRacing first, then AC / ACC / AC EVO, then F1
  pollInterval = setInterval(tick, POLL_MS);
  console.log('[telemetry] poll loop started at', POLL_HZ, 'Hz');
}

export function stopTelemetry(): void {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  try { sdk?.stopSDK(); } catch { /* ignore */ }
  sdk = null;
  acStop();
  f1Stop();
  console.log('[telemetry] stopped');
}
