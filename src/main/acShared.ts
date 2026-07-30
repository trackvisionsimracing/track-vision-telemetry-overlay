import { TelemetrySample, SessionInfo } from '../shared/types';

// ─── Assetto Corsa shared-memory telemetry reader ─────────────────────────────
// Supports two generations of the Kunos shared-memory interface:
//   • AC EVO   — pages named acevo_pmf_* (physics keeps the AC1-compatible
//                prefix; graphics/static are new layouts, ASCII strings)
//   • AC / ACC — legacy pages named acpmf_* (wide-char strings)
// Offsets verified live against AC EVO 0.8.0.1 (sm_version "1.0").

let koffi: any = null;
let OpenFileMappingW: any = null;
let MapViewOfFile: any = null;
let UnmapViewOfFile: any = null;
let CloseHandle: any = null;

try {
  koffi = require('koffi');
  const kernel32   = koffi.load('kernel32.dll');
  OpenFileMappingW = kernel32.func('OpenFileMappingW', 'void*', ['uint32', 'int', 'str16']);
  MapViewOfFile    = kernel32.func('MapViewOfFile',    'void*', ['void*', 'uint32', 'uint32', 'uint32', 'size_t']);
  UnmapViewOfFile  = kernel32.func('UnmapViewOfFile',  'int',   ['void*']);
  CloseHandle      = kernel32.func('CloseHandle',      'int',   ['void*']);
  console.log('[ac] koffi loaded — AC shared memory support enabled');
} catch (e) {
  console.warn('[ac] koffi unavailable — AC support disabled:', (e as Error).message);
}

const FILE_MAP_READ = 0x0004;

// Physics page — identical prefix in AC1 / ACC / AC EVO
const PHYS = {
  packetId:   0,   // int — increments at physics rate while the sim runs
  gas:        4,   // float 0–1
  brake:      8,   // float 0–1
  gear:       16,  // int — 0=R, 1=N, 2=1st…
  rpms:       20,  // int
  steerAngle: 24,  // float −1…1, fraction of full steering lock
  speedKmh:   28,  // float
  clutch:     364, // float 0–1
};

// Legacy (AC1/ACC) graphics + static pages — wide-char strings
const LEGACY_GFX = {
  status:        4,   // 0=OFF 1=REPLAY 2=LIVE 3=PAUSE
  completedLaps: 132,
  iCurrentTime:  140, // ms
  iLastTime:     144, // ms
  iBestTime:     148, // ms
  isInPit:       160,
  normalizedPos: 248,
};
const LEGACY_STATIC = {
  carModel: 68,  // wchar_t[33]
  track:    134, // wchar_t[33]
};

// AC EVO graphics + static pages — ASCII strings, verified live
const EVO_GFX = {
  status:      4,    // 0=OFF 1=REPLAY 2=LIVE 3=PAUSE
  curLapMs:    188,
  npos:        1244, // float 0–1 around the lap
  lastLapMs:   2396,
  bestLapMs:   2400,
  carModel:    3086, // char[33]
  isInPitBox:  3119, // bool
  isInPitLane: 3120, // bool
};
const EVO_STATIC = {
  track:       136, // char[33]
  trackConfig: 169, // char[33]
};

// AC reports steering as −1…1 of full lock but not the lock angle itself.
// Assume 540° lock-to-lock (±270°) for the visual wheel rotation.
const STEER_HALF_LOCK_RAD = (270 * Math.PI) / 180;

const RECONNECT_MS = 2000;
const STALE_MS     = 5000;

type Mode = 'evo' | 'legacy';

interface Mapping { handle: any; view: any; }

let mode: Mode = 'evo';
let physMap:   Mapping | null = null;
let gfxMap:    Mapping | null = null;
let staticMap: Mapping | null = null;

let lastConnectAttempt = 0;
let lastPacketId       = -1;
let lastPacketChange   = 0;
let announced          = false;

// AC EVO has no completed-lap counter in an obvious spot, so laps are counted
// by watching the normalized lap position wrap from ~1 back to ~0.
let synthLap = 0;
let prevNpos = -1;

function openMapping(name: string): Mapping | null {
  for (const full of [`Local\\${name}`, name]) {
    const handle = OpenFileMappingW(FILE_MAP_READ, 0, full);
    if (!handle) continue;
    const view = MapViewOfFile(handle, FILE_MAP_READ, 0, 0, 0); // 0 = whole page
    if (!view) { CloseHandle(handle); continue; }
    return { handle, view };
  }
  return null;
}

function closeMapping(m: Mapping | null): void {
  if (!m) return;
  try { UnmapViewOfFile(m.view); } catch { /* ignore */ }
  try { CloseHandle(m.handle); }  catch { /* ignore */ }
}

function disconnect(): void {
  closeMapping(physMap);
  closeMapping(gfxMap);
  closeMapping(staticMap);
  physMap = gfxMap = staticMap = null;
  lastPacketId = -1;
  announced = false;
  synthLap  = 0;
  prevNpos  = -1;
}

function tryConnect(): boolean {
  const now = Date.now();
  if (now - lastConnectAttempt < RECONNECT_MS) return false;
  lastConnectAttempt = now;

  // AC EVO pages first, then the legacy AC1/ACC pages
  for (const [m, prefix] of [['evo', 'acevo_pmf'], ['legacy', 'acpmf']] as [Mode, string][]) {
    const phys = openMapping(`${prefix}_physics`);
    const gfx  = openMapping(`${prefix}_graphics`);
    if (phys && gfx) {
      mode      = m;
      physMap   = phys;
      gfxMap    = gfx;
      staticMap = openMapping(`${prefix}_static`); // optional — names only
      lastPacketChange = now;
      return true;
    }
    closeMapping(phys);
    closeMapping(gfx);
  }
  return false;
}

function readInt(m: Mapping, offset: number): number {
  return koffi.decode(m.view, offset, 'int32');
}

function readU8(m: Mapping, offset: number): number {
  return koffi.decode(m.view, offset, 'uint8');
}

function readFloat(m: Mapping, offset: number): number {
  return koffi.decode(m.view, offset, 'float');
}

function readWString(m: Mapping, offset: number, maxChars: number): string {
  const units: number[] = koffi.decode(m.view, offset, koffi.array('uint16', maxChars));
  let out = '';
  for (const u of units) {
    if (u === 0) break;
    out += String.fromCharCode(u);
  }
  return out.trim();
}

function readAscii(m: Mapping, offset: number, maxChars: number): string {
  const bytes: number[] = koffi.decode(m.view, offset, koffi.array('uint8', maxChars));
  let out = '';
  for (const b of bytes) {
    if (b === 0) break;
    out += String.fromCharCode(b);
  }
  return out.trim();
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function acRead(): { sample: TelemetrySample; session: SessionInfo } | null {
  if (!koffi) return null;

  if (!physMap || !gfxMap) {
    if (!tryConnect()) return null;
  }

  try {
    const now      = Date.now();
    const packetId = readInt(physMap!, PHYS.packetId);
    const status   = readInt(gfxMap!,  mode === 'evo' ? EVO_GFX.status : LEGACY_GFX.status);

    // Detect the game closing: the mapping stays alive but data freezes.
    // Also covers zombie pages left behind by other telemetry tools.
    if (packetId !== lastPacketId) {
      lastPacketId     = packetId;
      lastPacketChange = now;
    } else if (now - lastPacketChange > STALE_MS) {
      if (announced) console.log('[ac] data stale — disconnecting');
      disconnect();
      return null;
    }

    if (status === 0 || packetId === 0) return null; // menus / page not being written

    if (!announced) {
      announced = true;
      console.log(`[ac] live data (${mode} layout)`);
    }

    // Shared physics prefix
    const gas      = readFloat(physMap!, PHYS.gas);
    const brake    = readFloat(physMap!, PHYS.brake);
    const clutch   = readFloat(physMap!, PHYS.clutch);
    const steer    = readFloat(physMap!, PHYS.steerAngle);
    const acGear   = readInt(physMap!,   PHYS.gear);
    const rpm      = readInt(physMap!,   PHYS.rpms);
    const speedKmh = readFloat(physMap!, PHYS.speedKmh);

    let lap: number, npos: number, curMs: number, lastMs: number, bestMs: number;
    let inPit: boolean;
    let carName = 'unknown', trackName = 'unknown', trackConfig = '';

    if (mode === 'evo') {
      npos   = readFloat(gfxMap!, EVO_GFX.npos);
      curMs  = readInt(gfxMap!,   EVO_GFX.curLapMs);
      lastMs = readInt(gfxMap!,   EVO_GFX.lastLapMs);
      bestMs = readInt(gfxMap!,   EVO_GFX.bestLapMs);
      inPit  = readU8(gfxMap!, EVO_GFX.isInPitBox) !== 0 || readU8(gfxMap!, EVO_GFX.isInPitLane) !== 0;

      // Count laps by npos wrapping across the start line
      if (prevNpos > 0.8 && npos < 0.2) synthLap++;
      prevNpos = npos;
      lap = synthLap;

      carName = readAscii(gfxMap!, EVO_GFX.carModel, 33) || 'unknown';
      if (staticMap) {
        trackName   = readAscii(staticMap, EVO_STATIC.track, 33)       || 'unknown';
        trackConfig = readAscii(staticMap, EVO_STATIC.trackConfig, 33) || '';
      }
    } else {
      npos   = readFloat(gfxMap!, LEGACY_GFX.normalizedPos);
      curMs  = readInt(gfxMap!,   LEGACY_GFX.iCurrentTime);
      lastMs = readInt(gfxMap!,   LEGACY_GFX.iLastTime);
      bestMs = readInt(gfxMap!,   LEGACY_GFX.iBestTime);
      inPit  = readInt(gfxMap!,   LEGACY_GFX.isInPit) !== 0;
      lap    = readInt(gfxMap!,   LEGACY_GFX.completedLaps);

      if (staticMap) {
        carName   = readWString(staticMap, LEGACY_STATIC.carModel, 33) || 'unknown';
        trackName = readWString(staticMap, LEGACY_STATIC.track, 33)    || 'unknown';
      }
    }

    const sample: TelemetrySample = {
      throttle:      gas,
      brake:         brake,
      clutch:        clutch,
      steeringAngle: steer * STEER_HALF_LOCK_RAD,
      gear:          acGear - 1, // AC: 0=R 1=N 2=1st → iRacing: −1=R 0=N 1=1st
      speedMs:       speedKmh / 3.6,
      rpm,
      lap,
      lapDistPct:     Math.max(0, Math.min(1, npos)),
      lapCurrentTime: curMs / 1000,
      lapLastTime:    lastMs > 0 ? lastMs / 1000 : 0,
      lapBestTime:    bestMs > 0 ? bestMs / 1000 : 0,
      onPitRoad:      inPit,
      isOnTrack:      status === 2, // LIVE
      sessionFlags:   0,
      connected:      true,
    };

    return { sample, session: { carName, trackName, trackConfig } };
  } catch (e) {
    console.error('[ac] read error — disconnecting', e);
    disconnect();
    return null;
  }
}

export function acStop(): void {
  disconnect();
}
