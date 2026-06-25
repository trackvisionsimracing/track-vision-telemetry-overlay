import type { TelemetrySample, Settings, GhostPayload, LapTrace } from '../shared/types';

declare const tvAPI: {
  onTelemetry:   (cb: (d: TelemetrySample) => void) => void;
  onSettings:    (cb: (d: Settings) => void)         => void;
  onGhosts:      (cb: (d: GhostPayload) => void)     => void;
  onDragMode:    (cb: (enabled: boolean) => void)    => void;
  getSettings:   () => Promise<Settings>;
  hoverIn:       () => void;
  hoverOut:      () => void;
  setGhosts:     (g: Settings['ghosts']) => void;
  setChannels:   (c: Settings['channels']) => void;
  startMove:     () => void;
  savePosition:  () => void;
  resetPosition: () => void;
  reportWheel:   (id: string) => void;
};

// ─── Theme ────────────────────────────────────────────────────────────────────
const COLOR = {
  throttle:      '#39FF14',
  brake:         '#FF3131',
  clutch:        '#00CFFF',
  throttleGhost: '#39FF14',
  brakeGhost:    '#FF3131',
};

// ─── Ring buffer of live samples ──────────────────────────────────────────────
const HISTORY = 240;

interface Sample { pct: number; thr: number; brk: number; clu: number; }

const ring: Sample[] = [];
let settings: Settings | null = null;
let ghosts: GhostPayload = { sessionBest: null, allTimeBest: null };
let steeringAngle = 0;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const root        = document.getElementById('root')!;
const traceCanvas = document.getElementById('trace-canvas') as HTMLCanvasElement;
const tCtx        = traceCanvas.getContext('2d')!;
const header      = document.getElementById('header')!;
const controls    = document.getElementById('controls')!;
const branding    = document.getElementById('branding')!;
const chkThrottle = document.getElementById('chk-throttle') as HTMLInputElement;
const chkBrake    = document.getElementById('chk-brake')    as HTMLInputElement;
const chkBest     = document.getElementById('chk-best')     as HTMLInputElement;
const statusDot   = document.getElementById('status-dot')!;
const barClutch   = document.getElementById('bar-clutch')!  as HTMLElement;
const barBrake    = document.getElementById('bar-brake')!   as HTMLElement;
const barThrottle = document.getElementById('bar-throttle')!as HTMLElement;
const vGearBig    = document.getElementById('v-gear-big')!;
const vSpeedBig   = document.getElementById('v-speed-big')!;
const wheelPanel  = document.getElementById('wheel-panel')!;
const wheelContainer = document.getElementById('wheel-container')!;
const wheelCanvas = document.getElementById('wheel-canvas') as HTMLCanvasElement;
const wCtx        = wheelCanvas.getContext('2d')!;
const wheelImg    = document.getElementById('wheel-img')!   as HTMLImageElement;
const btnMovePos  = document.getElementById('btn-move-pos')!  as HTMLButtonElement;
const btnResetPos = document.getElementById('btn-reset-pos')! as HTMLButtonElement;

// ─── Canvas sizing ────────────────────────────────────────────────────────────
function resizeTrace(): void {
  const r = traceCanvas.getBoundingClientRect();
  traceCanvas.width  = Math.round(r.width  * devicePixelRatio);
  traceCanvas.height = Math.round(r.height * devicePixelRatio);
}

function resizeWheel(): void {
  const size = Math.min(wheelContainer.clientWidth, wheelContainer.clientHeight) - 4;
  const px   = Math.round(Math.max(size, 20) * devicePixelRatio);
  wheelCanvas.width  = px;
  wheelCanvas.height = px;
  wheelCanvas.style.width  = Math.max(size, 20) + 'px';
  wheelCanvas.style.height = Math.max(size, 20) + 'px';
}

const ro = new ResizeObserver(() => { resizeTrace(); resizeWheel(); });
ro.observe(traceCanvas);
ro.observe(wheelContainer);
resizeTrace();
resizeWheel();

// ─── Wheel image detection ────────────────────────────────────────────────────

const WHEEL_MAP: Array<{ keywords: string[]; image: string }> = [
  { keywords: ['fanatec', '0eb7'],                          image: 'wheels/fanatec.webp'       },
  { keywords: ['fx pro', 'fxpro', 'fx-pro'],                image: 'wheels/simagic-fx-pro.png' },
  { keywords: ['simagic', 'simmagic', 'sim magic', '0483'], image: 'wheels/simagic-fx-pro.png' },
];

// Known pedal/accessory device names — skip these even if they match wheel keywords
const PEDAL_EXCLUSIONS = ['p1000', 'p-1000', 'pedal', 'loadcell'];

function isPedalDevice(id: string): boolean {
  const lower = id.toLowerCase();
  return PEDAL_EXCLUSIONS.some(k => lower.includes(k));
}

let usingWheelImage = false;

function tryLoadWheelImage(gpId: string): void {
  if (usingWheelImage) return;
  if (isPedalDevice(gpId)) return;
  const id = gpId.toLowerCase();
  const match = WHEEL_MAP.find(entry => entry.keywords.some(k => id.includes(k)));
  if (!match) return;

  const img = new Image();
  img.onload = () => {
    wheelImg.src   = img.src;
    wheelImg.classList.remove('hidden');
    wheelCanvas.style.display = 'none';
    usingWheelImage = true;
    console.log('[wheel] loaded image for:', gpId);
  };
  img.src = match.image;
}

function scanGamepads(): void {
  for (const gp of navigator.getGamepads()) {
    if (!gp || !gp.id) continue;
    if (!isPedalDevice(gp.id)) tvAPI.reportWheel(gp.id);
    tryLoadWheelImage(gp.id);
  }
}

window.addEventListener('gamepadconnected', (e: GamepadEvent) => {
  console.log('[wheel] gamepad connected:', e.gamepad.id);
  if (!isPedalDevice(e.gamepad.id)) tvAPI.reportWheel(e.gamepad.id);
  tryLoadWheelImage(e.gamepad.id);
});

// Also scan once on load in case a gamepad is already connected
setTimeout(scanGamepads, 1000);

// ─── Settings → DOM ───────────────────────────────────────────────────────────
function applySettings(s: Settings): void {
  settings = s;
  branding.classList.toggle('hidden', !s.showBranding);
  header.classList.toggle('unlocked', !s.overlayLocked);
  chkThrottle.checked = s.channels.throttle;
  chkBrake.checked    = s.channels.brake;
  chkBest.checked     = s.ghosts.sessionBest;
  document.documentElement.style.setProperty('--tv-accent', s.accentColor);
  COLOR.throttle      = s.accentColor;
  COLOR.throttleGhost = s.accentColor;
}

// ─── Header hover — enables mouse events so buttons/checkboxes are clickable ──
header.addEventListener('mouseenter', () => tvAPI.hoverIn());
header.addEventListener('mouseleave', () => {
  if (!root.classList.contains('drag-mode')) tvAPI.hoverOut();
});

// ─── Overlay control sync ─────────────────────────────────────────────────────
function syncOverlayControls(): void {
  if (!settings) return;
  const channels = { ...settings.channels, throttle: chkThrottle.checked, brake: chkBrake.checked };
  settings.channels = channels;
  tvAPI.setChannels(channels);
  const ghosts = { sessionBest: chkBest.checked, allTimeBest: false, throttle: true, brake: true };
  settings.ghosts = ghosts;
  tvAPI.setGhosts(ghosts);
}

[chkThrottle, chkBrake, chkBest].forEach(el =>
  el.addEventListener('change', syncOverlayControls)
);

// ─── Drag mode (move overlay) ─────────────────────────────────────────────────
let dragModeActive = false;

btnMovePos.addEventListener('click', () => {
  if (!dragModeActive) {
    tvAPI.startMove();
  } else {
    tvAPI.savePosition();
  }
});

btnResetPos.addEventListener('click', () => {
  tvAPI.resetPosition();
});

tvAPI.onDragMode((enabled: boolean) => {
  dragModeActive = enabled;
  root.classList.toggle('drag-mode', enabled);
  btnMovePos.textContent = enabled ? 'Save Position' : 'Move Overlay';
  btnMovePos.classList.toggle('active', enabled);
});

// ─── Steering wheel drawing ───────────────────────────────────────────────────
function drawWheel(angle: number): void {
  const W   = wheelCanvas.width;
  const H   = wheelCanvas.height;
  const cx  = W / 2;
  const cy  = H / 2;
  const r   = Math.min(W, H) * 0.42;
  const rimW   = r * 0.13;
  const hubR   = r * 0.13;
  const spokeW = rimW * 0.52;

  wCtx.clearRect(0, 0, W, H);
  wCtx.save();
  wCtx.translate(cx, cy);
  // iRacing positive steeringAngle = left turn = CCW on screen
  wCtx.rotate(-angle);

  // Outer rim
  wCtx.beginPath();
  wCtx.arc(0, 0, r - rimW / 2, 0, Math.PI * 2);
  wCtx.strokeStyle = 'rgba(255,255,255,0.88)';
  wCtx.lineWidth   = rimW;
  wCtx.stroke();

  // Three spokes at top, lower-left, lower-right
  const spokeAngles = [
    -Math.PI / 2,
    -Math.PI / 2 + (2 * Math.PI) / 3,
    -Math.PI / 2 - (2 * Math.PI) / 3,
  ];
  wCtx.strokeStyle = 'rgba(255,255,255,0.88)';
  wCtx.lineWidth   = spokeW;
  wCtx.lineCap     = 'round';
  for (const a of spokeAngles) {
    wCtx.beginPath();
    wCtx.moveTo(Math.cos(a) * hubR,         Math.sin(a) * hubR);
    wCtx.lineTo(Math.cos(a) * (r - rimW),   Math.sin(a) * (r - rimW));
    wCtx.stroke();
  }

  // Center hub
  wCtx.beginPath();
  wCtx.arc(0, 0, hubR, 0, Math.PI * 2);
  wCtx.fillStyle = 'rgba(255,255,255,0.88)';
  wCtx.fill();

  wCtx.restore();
}

// ─── Trace drawing ────────────────────────────────────────────────────────────
function drawLiveTrace(color: string, channel: 'thr' | 'brk' | 'clu'): void {
  if (ring.length < 2) return;
  const W = traceCanvas.width;
  const H = traceCanvas.height;

  tCtx.save();
  tCtx.strokeStyle = color;
  tCtx.globalAlpha = 1.0;
  tCtx.lineWidth   = 3.5 * devicePixelRatio;
  tCtx.lineCap     = 'round';
  tCtx.lineJoin    = 'round';
  tCtx.beginPath();
  for (let i = 0; i < ring.length; i++) {
    const x = (i / (ring.length - 1)) * W;
    const y = H - ring[i][channel] * H;
    i === 0 ? tCtx.moveTo(x, y) : tCtx.lineTo(x, y);
  }
  tCtx.stroke();
  tCtx.restore();
}

function drawGhostChannel(trace: LapTrace, color: string, channel: 'throttle' | 'brake'): void {
  if (ring.length < 2) return;
  const W        = traceCanvas.width;
  const H        = traceCanvas.height;
  const data     = trace[channel] as number[];
  const LAP_BINS = data.length;

  tCtx.save();
  tCtx.strokeStyle = color;
  tCtx.globalAlpha = 0.45;
  tCtx.lineWidth   = 1.5 * devicePixelRatio;
  tCtx.setLineDash([5, 4]);
  tCtx.lineCap     = 'round';
  tCtx.lineJoin    = 'round';
  tCtx.beginPath();

  // Index by ring position (same as live trace) so ghost and live share identical x coords
  for (let i = 0; i < ring.length; i++) {
    const x   = (i / (ring.length - 1)) * W;
    const bin = Math.min(LAP_BINS - 1, Math.floor(ring[i].pct * LAP_BINS));
    const y   = H - data[bin] * H;
    i === 0 ? tCtx.moveTo(x, y) : tCtx.lineTo(x, y);
  }

  tCtx.stroke();
  tCtx.restore();
}

// ─── Render loop ──────────────────────────────────────────────────────────────
function render(): void {
  const W = traceCanvas.width;
  const H = traceCanvas.height;
  tCtx.clearRect(0, 0, W, H);

  if (settings) {
    const s = settings;
    if (s.channels.throttle) drawLiveTrace(COLOR.throttle, 'thr');
    if (s.channels.brake)    drawLiveTrace(COLOR.brake,    'brk');
    if (s.channels.clutch)   drawLiveTrace(COLOR.clutch,   'clu');

    const drawGhostFor = (trace: LapTrace | null) => {
      if (!trace) return;
      if (s.ghosts.throttle && s.channels.throttle) drawGhostChannel(trace, COLOR.throttleGhost, 'throttle');
      if (s.ghosts.brake    && s.channels.brake)    drawGhostChannel(trace, COLOR.brakeGhost,    'brake');
    };

    if (s.ghosts.sessionBest) drawGhostFor(ghosts.sessionBest);
    if (s.ghosts.allTimeBest) drawGhostFor(ghosts.allTimeBest);
  }

  drawWheel(steeringAngle);
  requestAnimationFrame(render);
}

// ─── Telemetry handler ────────────────────────────────────────────────────────
tvAPI.onTelemetry((sample: TelemetrySample) => {
  const connected   = sample.connected ?? true;
  steeringAngle = sample.steeringAngle;

  // Rotate real wheel image via CSS (faster than canvas for an img element)
  if (usingWheelImage) {
    const deg = -(steeringAngle * 180 / Math.PI);
    wheelImg.style.transform = `rotate(${deg}deg)`;
  }

  statusDot.className = connected ? 'connected' : 'disconnected';

  // Pedal bars — fill from bottom
  barClutch.style.height   = (sample.clutch   * 100).toFixed(1) + '%';
  barBrake.style.height    = (sample.brake    * 100).toFixed(1) + '%';
  barThrottle.style.height = (sample.throttle * 100).toFixed(1) + '%';

  // Gear (iRacing: 0=neutral, -1=reverse, 1+=forward)
  const g = sample.gear;
  vGearBig.textContent  = g === -1 ? 'R' : g === 0 ? 'N' : String(g);
  vSpeedBig.textContent = Math.round(sample.speedMs * 2.23694).toString();

  ring.push({ pct: sample.lapDistPct, thr: sample.throttle, brk: sample.brake, clu: sample.clutch });
  if (ring.length > HISTORY) ring.shift();
});

tvAPI.onSettings(applySettings);
tvAPI.onGhosts((payload: GhostPayload) => { ghosts = payload; });

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  const s = await tvAPI.getSettings();
  applySettings(s);
  requestAnimationFrame(render);
})();
