import dgram from 'dgram';
import { TelemetrySample, SessionInfo } from '../shared/types';

// ─── F1 (EA/Codemasters) UDP telemetry listener ───────────────────────────────
// The F1 games broadcast telemetry over UDP when enabled in the game's
// Settings → Telemetry. 20777 is the default, but motion software, dashboards,
// and other tools commonly occupy it first — in which case the game gets
// pointed at the next port up. So we open every port in the range below and
// lock onto whichever one real F1 packets actually arrive on.
// Packet layout: little-endian, no padding, 29-byte header, 22 car slots;
// the header carries the player's car index.

const PORTS      = [20777, 20778, 20779, 20780, 20781, 20782];
const HEADER     = 29;
const NUM_CARS   = 22;
const STALE_MS   = 2000;

// Packet ids
const PKT_SESSION   = 1;
const PKT_LAP_DATA  = 2;
const PKT_TELEMETRY = 6;

// F1 track ids → display names
const TRACKS: Record<number, string> = {
  0: 'Melbourne', 1: 'Paul Ricard', 2: 'Shanghai', 3: 'Sakhir', 4: 'Catalunya',
  5: 'Monaco', 6: 'Montreal', 7: 'Silverstone', 8: 'Hockenheim', 9: 'Hungaroring',
  10: 'Spa', 11: 'Monza', 12: 'Singapore', 13: 'Suzuka', 14: 'Abu Dhabi',
  15: 'Texas', 16: 'Brazil', 17: 'Austria', 18: 'Sochi', 19: 'Mexico',
  20: 'Baku', 21: 'Sakhir Short', 22: 'Silverstone Short', 23: 'Texas Short',
  24: 'Suzuka Short', 25: 'Hanoi', 26: 'Zandvoort', 27: 'Imola', 28: 'Portimao',
  29: 'Jeddah', 30: 'Miami', 31: 'Las Vegas', 32: 'Losail',
};

interface F1Telemetry {
  speedKmh: number; throttle: number; steer: number; brake: number;
  clutch: number; gear: number; rpm: number;
}

interface F1Lap {
  lastLapMs: number; curLapMs: number; lapDistance: number;
  currentLapNum: number; pitStatus: number; driverStatus: number;
}

let sockets: dgram.Socket[] = [];
let telem: F1Telemetry | null = null;
let lapData: F1Lap | null = null;
let trackId     = -1;
let trackLength = 0;
let gameYear    = 0;
let lastPacket  = 0;
let announced   = false;
let activePort  = 0; // the port F1 packets are actually arriving on

function onPacket(buf: Buffer, port: number): void {
  if (buf.length < HEADER) return;

  // Only real F1 packets pass this check, so unrelated traffic sharing these
  // ports (motion software, dashboards) is ignored rather than misread.
  const packetFormat = buf.readUInt16LE(0);
  if (packetFormat < 2022 || packetFormat > 2100) return;

  const packetId  = buf.readUInt8(6);
  const playerIdx = buf.readUInt8(27);
  if (playerIdx >= NUM_CARS) return;

  if (port !== activePort) {
    activePort = port;
    console.log(`[f1] detected F1 telemetry on port ${port}`);
  }

  // Per-car struct size derived from the packet length so minor spec
  // changes between game versions don't break the player-slot lookup
  // (trailing packet fields are < 22 bytes, so the floor stays exact).
  const carSize = Math.floor((buf.length - HEADER) / NUM_CARS);
  const o = HEADER + playerIdx * carSize;

  if (packetId === PKT_TELEMETRY) {
    if (o + 18 > buf.length) return;
    telem = {
      speedKmh: buf.readUInt16LE(o),
      throttle: buf.readFloatLE(o + 2),
      steer:    buf.readFloatLE(o + 6),
      brake:    buf.readFloatLE(o + 10),
      clutch:   buf.readUInt8(o + 14) / 100, // 0–100 = amount applied
      gear:     buf.readInt8(o + 15),        // −1=R 0=N 1–8 (already iRacing-style)
      rpm:      buf.readUInt16LE(o + 16),
    };
    gameYear   = 2000 + buf.readUInt8(2);
    lastPacket = Date.now();
  } else if (packetId === PKT_LAP_DATA) {
    if (o + 45 > buf.length) return;
    lapData = {
      lastLapMs:     buf.readUInt32LE(o),
      curLapMs:      buf.readUInt32LE(o + 4),
      lapDistance:   buf.readFloatLE(o + 20),
      currentLapNum: buf.readUInt8(o + 33),
      pitStatus:     buf.readUInt8(o + 34),  // 0=none 1=pitting 2=in pit area
      driverStatus:  buf.readUInt8(o + 44),  // 0=in garage 1–4=on circuit
    };
    lastPacket = Date.now();
  } else if (packetId === PKT_SESSION) {
    if (HEADER + 8 > buf.length) return;
    trackLength = buf.readUInt16LE(HEADER + 4);
    trackId     = buf.readInt8(HEADER + 7);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function f1Start(): void {
  if (sockets.length) return;

  const opened: number[] = [];

  for (const port of PORTS) {
    try {
      // reuseAddr lets us share a port that another tool already holds, so a
      // motion system on 20777 doesn't stop us from seeing the game's data.
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      sock.on('message', (buf) => onPacket(buf, port));

      // A port being unavailable is normal — just skip it and keep the rest
      sock.on('error', (e: NodeJS.ErrnoException) => {
        console.warn(`[f1] port ${port} unavailable (${e.code || e.message})`);
        try { sock.close(); } catch { /* already closing */ }
        sockets = sockets.filter(s => s !== sock);
      });

      sock.bind(port);
      sockets.push(sock);
      opened.push(port);
    } catch (e) {
      console.warn(`[f1] could not open port ${port}`, e);
    }
  }

  if (opened.length) {
    console.log(`[f1] listening for F1 UDP telemetry on ports ${opened.join(', ')}`);
  } else {
    console.warn('[f1] no UDP ports could be opened — F1 telemetry unavailable');
  }
}

export function f1Read(): { sample: TelemetrySample; session: SessionInfo } | null {
  if (!telem || !lapData) return null;
  if (Date.now() - lastPacket > STALE_MS) {
    if (announced) { announced = false; console.log('[f1] telemetry stopped'); }
    telem   = null;
    lapData = null;
    activePort = 0; // re-detect the port if the game comes back on a different one
    return null;
  }

  if (!announced) {
    announced = true;
    console.log(`[f1] live data (F1 ${gameYear || '2x'}) on port ${activePort}`);
  }

  const pct = trackLength > 0
    ? Math.max(0, Math.min(1, lapData.lapDistance / trackLength))
    : 0;

  const sample: TelemetrySample = {
    throttle:      telem.throttle,
    brake:         telem.brake,
    clutch:        telem.clutch,             // already "amount pressed" — no inversion
    steeringAngle: telem.steer * Math.PI,    // −1…1 of lock → ±180° for the visual wheel
    gear:          telem.gear,
    speedMs:       telem.speedKmh / 3.6,
    rpm:           telem.rpm,
    lap:           lapData.currentLapNum,
    lapDistPct:    pct,
    lapCurrentTime: lapData.curLapMs / 1000,
    lapLastTime:   lapData.lastLapMs > 0 ? lapData.lastLapMs / 1000 : 0,
    lapBestTime:   0,
    onPitRoad:     lapData.pitStatus !== 0,
    isOnTrack:     lapData.driverStatus !== 0,
    sessionFlags:  0,
    connected:     true,
  };

  const trackName = TRACKS[trackId] ?? (trackId >= 0 ? `Track ${trackId}` : 'unknown');
  const session: SessionInfo = {
    carName:     `F1 ${gameYear || ''}`.trim(),
    trackName,
    trackConfig: '',
  };

  return { sample, session };
}

export function f1Stop(): void {
  for (const sock of sockets) {
    try { sock.close(); } catch { /* ignore */ }
  }
  sockets = [];
  telem   = null;
  lapData = null;
  activePort = 0;
}
