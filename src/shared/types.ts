// ─── Telemetry ───────────────────────────────────────────────────────────────

export interface TelemetrySample {
  throttle: number;       // 0–1
  brake: number;          // 0–1
  clutch: number;         // 0–1 (display value — inversion already applied)
  steeringAngle: number;  // radians, raw from SDK; renderer scales for display
  gear: number;
  speedMs: number;        // m/s — renderer converts to mph/kph
  rpm: number;
  lap: number;
  lapDistPct: number;     // 0–1
  lapCurrentTime: number; // seconds
  lapLastTime: number;    // seconds
  lapBestTime: number;    // seconds
  onPitRoad: boolean;
  isOnTrack: boolean;
  sessionFlags: number;
  connected: boolean;
}

// ─── Lap storage ─────────────────────────────────────────────────────────────

export const LAP_BINS = 1000;

export interface LapTrace {
  throttle: Float32Array | number[];
  brake: Float32Array | number[];
  clutch: Float32Array | number[];
  lapTime: number;        // seconds
  carKey: string;
  trackKey: string;
}

export interface SessionInfo {
  carName: string;
  trackName: string;
  trackConfig: string;
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface OverlayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GhostToggles {
  sessionBest: boolean;
  allTimeBest: boolean;
  throttle: boolean;
  brake: boolean;
}

export interface ChannelToggles {
  throttle: boolean;
  brake: boolean;
  clutch: boolean;
  steering: boolean;
  gear: boolean;
  speed: boolean;
  rpm: boolean;
}

export interface Settings {
  overlayVisible: boolean;
  overlayLocked: boolean;
  overlayBounds: OverlayBounds;
  overlayOpacity: number;       // 0–1
  launchOnStartup: boolean;
  invertClutch: boolean;        // true = display (1 - clutch)
  accentColor: string;          // hex, default '#00FF87'
  showBranding: boolean;
  wheelImage: string;           // 'drawn' | wheel key e.g. 'simagic-gt'
  channels: ChannelToggles;
  ghosts: GhostToggles;
  debugWaiting: boolean;        // show "waiting for iRacing" overlay when disconnected
}

// ─── IPC channels ────────────────────────────────────────────────────────────

export const IPC = {
  // Main → renderer
  TELEMETRY_UPDATE: 'telemetry:update',
  SESSION_INFO:     'session:info',
  SETTINGS_UPDATE:  'settings:update',
  GHOST_UPDATE:     'ghost:update',

  // Renderer → main
  TOGGLE_OVERLAY:   'overlay:toggle',
  TOGGLE_LOCK:      'overlay:lock-toggle',
  SET_OPACITY:      'overlay:opacity',
  SET_GHOSTS:       'ghosts:set',
  SET_CHANNELS:     'channels:set',
  SET_STARTUP:      'startup:set',
  SET_ACCENT:       'accent:set',
  SET_WHEEL_IMAGE:  'wheel-image:set',
  TOGGLE_BRANDING:  'branding:toggle',
  RESET_BEST:       'lap:reset-best',
  GET_SETTINGS:     'settings:get',

  // Overlay interactive region hover
  OVERLAY_HOVER_IN:  'overlay:hover-in',
  OVERLAY_HOVER_OUT: 'overlay:hover-out',

  // Overlay drag-to-position
  START_MOVE:      'overlay:start-move',
  SAVE_POSITION:   'overlay:save-position',
  RESET_POSITION:  'overlay:reset-position',
  DRAG_MODE:       'overlay:drag-mode',

  // Wheel detection (overlay → main → control)
  WHEEL_DETECTED: 'wheel:detected',

  // Quit
  QUIT: 'app:quit',
} as const;

// ─── Ghost payload sent over IPC ─────────────────────────────────────────────

export interface GhostPayload {
  sessionBest: LapTrace | null;
  allTimeBest: LapTrace | null;
}
