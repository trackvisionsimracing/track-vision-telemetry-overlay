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
  reportWheel:   (id: string, brand: string) => void;
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
const HISTORY = 210;

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

const ro = new ResizeObserver(() => {
  resizeTrace();
  resizeWheel();
  lastDrawnAngle = Infinity; // canvas contents were wiped by the resize
  needsRedraw    = true;
});
ro.observe(traceCanvas);
ro.observe(wheelContainer);
resizeTrace();
resizeWheel();

// ─── Wheel image detection ────────────────────────────────────────────────────

// Brand detection map. Keywords match against the lowercased gamepad id, which
// on Chromium includes the device name and "(Vendor: xxxx Product: xxxx)" — so
// both product-name fragments and USB vendor ids work as keywords.
// ORDER MATTERS: specific rims/models first, then brands. VRS uses the same STM
// vendor id (0483) as Simagic, so it must be checked before the generic Simagic
// entry. Missing image files fall back to the drawn wheel automatically.
const WHEEL_MAP: Array<{ keywords: string[]; image: string; brand: string }> = [
  // Specific rims
  { keywords: ['fx pro', 'fxpro', 'fx-pro'],                                     image: 'wheels/simagic-fx-pro.png', brand: 'simagic' },
  { keywords: ['gts'],                                                           image: 'wheels/simagic-gts.png',    brand: 'simagic' },
  { keywords: ['neo x', 'x-310', 'x310'],                                        image: 'wheels/simagic.png',        brand: 'simagic' },
  // Brands that share generic USB chips — check before the chip-id entries
  { keywords: ['vrs', 'directforce'],                                            image: 'wheels/vrs.png',            brand: 'vrs' },
  // Wheelbase brands
  { keywords: ['simucube', '16d0'],                                              image: 'wheels/simucube.png',       brand: 'simucube' },
  { keywords: ['simagic', 'simmagic', 'sim magic', '0483'],                      image: 'wheels/simagic-fx-pro.png', brand: 'simagic' },
  { keywords: ['moza', '346e'],                                                  image: 'wheels/moza.png',           brand: 'moza' },
  { keywords: ['fanatec', '0eb7', 'podium', 'clubsport', 'csl dd', 'gt dd'],     image: 'wheels/fanatec.png',        brand: 'fanatec' },
  { keywords: ['asetek', 'invicta', 'la prima', 'laprima', 'forte', 'initium', '2433'], image: 'wheels/asetek.png',  brand: 'asetek' },
  { keywords: ['logitech', '046d', 'g923', 'g920', 'g29', 'g27', 'rs50', 'pro racing wheel'], image: 'wheels/logitech.png', brand: 'logitech' },
  { keywords: ['thrustmaster', '044f', 't818', 't598', 't300', 't500', 't-gt', 'tgt', 'tx racing', 'tmx'], image: 'wheels/thrustmaster.png', brand: 'thrustmaster' },
  { keywords: ['velocityone', 'turtle beach', '10f5'],                           image: 'wheels/turtle-beach.png',   brand: 'turtle-beach' },
  { keywords: ['cammus'],                                                        image: 'wheels/cammus.png',         brand: 'cammus' },
  { keywords: ['pxn'],                                                           image: 'wheels/pxn.png',            brand: 'pxn' },
  { keywords: ['qubic', 'qs-220', 'qs-ch2'],                                     image: 'wheels/qubic.png',          brand: 'qubic' },
  { keywords: ['simsteering', 'sim steering'],                                   image: 'wheels/simsteering.png',    brand: 'simsteering' },
  { keywords: ['accuforce', 'simxperience'],                                     image: 'wheels/accuforce.png',      brand: 'accuforce' },
  { keywords: ['bodnar', '1dd2'],                                                image: 'wheels/leo-bodnar.png',     brand: 'leo-bodnar' },
  { keywords: ['ecci'],                                                          image: 'wheels/ecci.png',           brand: 'ecci' },
];

// Known pedal/accessory device names — skip these even if they match wheel keywords
const PEDAL_EXCLUSIONS = [
  'p1000', 'p-1000', 'p2000', 'pedal', 'loadcell', 'load cell',
  'heusinkveld', 'handbrake', 'shifter', 'sequential', 'ds-8x', 'tb-1',
  'button box', 'buttonbox',
];

function isPedalDevice(id: string): boolean {
  const lower = id.toLowerCase();
  return PEDAL_EXCLUSIONS.some(k => lower.includes(k));
}

let currentWheelImage = ''; // image path currently shown ('' = drawn canvas wheel)
let lastReportedWheel = '';
let wheelImageChoice  = 'drawn'; // from settings: 'drawn' | key in WHEEL_CHOICES

const WHEEL_CHOICES: Record<string, string> = {
  'simagic-gt':     'wheels/simagic.png',
  'simagic-fx-pro': 'wheels/simagic-fx-pro.png',
  'simagic-gts':    'wheels/simagic-gts.png',
  'fanatec':        'wheels/fanatec.png',
  'simucube':       'wheels/simucube.png',
};

// Image files that failed to load (brand not shipped yet) — don't retry them
const failedWheelImages = new Set<string>();

function applyWheelImage(imagePath: string, gpId: string): void {
  if (imagePath === currentWheelImage) return;
  if (failedWheelImages.has(imagePath)) { clearWheelImage(); return; }
  currentWheelImage = imagePath;
  const img = new Image();
  img.onload = () => {
    if (currentWheelImage !== imagePath) return; // superseded by a newer scan
    wheelImg.src = img.src;
    wheelImg.classList.remove('hidden');
    wheelCanvas.style.display = 'none';
    console.log('[wheel] loaded image for:', gpId);
  };
  img.onerror = () => {
    console.warn('[wheel] no image available:', imagePath, '— using drawn wheel');
    failedWheelImages.add(imagePath);
    if (currentWheelImage === imagePath) clearWheelImage();
  };
  img.src = imagePath;
}

function clearWheelImage(): void {
  if (!currentWheelImage) return;
  currentWheelImage = '';
  wheelImg.classList.add('hidden');
  wheelImg.style.transform = '';
  wheelCanvas.style.display = '';
  lastDrawnAngle = Infinity; // force the canvas wheel to repaint
  needsRedraw    = true;
  console.log('[wheel] wheel removed — using drawn wheel');
}

function scanGamepads(): void {
  let matchedBrand = '';
  let matchedGp: Gamepad | null = null;
  let firstWheel: Gamepad | null = null;

  for (const gp of navigator.getGamepads()) {
    if (!gp || !gp.id || isPedalDevice(gp.id)) continue;
    if (!firstWheel) firstWheel = gp;
    if (!matchedGp) {
      const id = gp.id.toLowerCase();
      const match = WHEEL_MAP.find(entry => entry.keywords.some(k => id.includes(k)));
      if (match) { matchedBrand = match.brand; matchedGp = gp; }
    }
  }

  // Tell the control panel which wheel is connected (changes on swap), so it can
  // filter the wheel-image dropdown to the detected wheelbase's own brand.
  // Button/axis counts are included — they're the only rim-dependent signal
  // some bases expose, and they make support questions much easier to answer.
  const reportGp = matchedGp ?? firstWheel;
  if (reportGp) {
    const report = `${reportGp.id} — ${reportGp.buttons.length} buttons, ${reportGp.axes.length} axes`;
    if (report !== lastReportedWheel) {
      lastReportedWheel = report;
      tvAPI.reportWheel(report, matchedBrand);
    }
  }

  // The wheel image is the user's manual choice from the control panel
  const chosen = WHEEL_CHOICES[wheelImageChoice];
  if (chosen) applyWheelImage(chosen, `manual: ${wheelImageChoice}`);
  else clearWheelImage(); // 'drawn'
}

window.addEventListener('gamepadconnected',    () => scanGamepads());
window.addEventListener('gamepaddisconnected', () => scanGamepads());

// Rescan continuously so swapping wheels updates the image
setInterval(scanGamepads, 2000);
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

  // Migrate the retired 'auto' value from older settings to 'drawn'
  const choice = (!s.wheelImage || s.wheelImage === 'auto') ? 'drawn' : s.wheelImage;
  if (choice !== wheelImageChoice) {
    wheelImageChoice = choice;
    scanGamepads(); // re-evaluate immediately with the new choice
  }

  needsRedraw = true; // channel/ghost toggles change what the canvas shows
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

btnResetPos.addEventListener('click', () => {
  tvAPI.resetPosition();
});

tvAPI.onDragMode((enabled: boolean) => {
  dragModeActive = enabled;
  root.classList.toggle('drag-mode', enabled);
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
// Telemetry arrives at 60 Hz but monitors often run at 120–240 Hz. Redrawing
// every vsync wastes GPU the game needs, so frames are skipped unless new data
// (or a settings/resize change) marked the canvas dirty.
let needsRedraw    = true;
let lastDrawnAngle = Infinity;

function markDirty(): void { needsRedraw = true; }

function render(): void {
  if (needsRedraw) {
    needsRedraw = false;

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

    // Canvas wheel: only when no photo is shown and the angle actually moved
    if (!currentWheelImage && Math.abs(steeringAngle - lastDrawnAngle) > 0.002) {
      lastDrawnAngle = steeringAngle;
      drawWheel(steeringAngle);
    }
  }
  requestAnimationFrame(render);
}

// ─── Telemetry handler ────────────────────────────────────────────────────────
// Every DOM write below is guarded so unchanged values cost nothing — style and
// text mutations are what trigger layout/paint work in the compositor.
let lastConnected = false;
let lastWheelDeg  = Infinity;
let lastClutchBar = -1;
let lastBrakeBar  = -1;
let lastThrBar    = -1;
let lastGearText  = '';
let lastSpeedText = '';

function setBar(el: HTMLElement, value: number, last: number): number {
  const v = Math.round(Math.max(0, Math.min(1, value)) * 200) / 200; // 0.5% steps
  if (v !== last) el.style.transform = `scaleY(${v})`;
  return v;
}

tvAPI.onTelemetry((sample: TelemetrySample) => {
  const connected = sample.connected ?? true;
  if (connected !== lastConnected) {
    lastConnected = connected;
    statusDot.className = connected ? 'connected' : 'disconnected';
  }

  // Disconnected packets carry no data — keep showing the last real values
  if (!connected || sample.gear === undefined) return;

  steeringAngle = sample.steeringAngle;

  // Rotate real wheel image via CSS (composited transform — no repaint)
  if (currentWheelImage) {
    const deg = Math.round(-(steeringAngle * 180 / Math.PI) * 10) / 10;
    if (deg !== lastWheelDeg) {
      lastWheelDeg = deg;
      wheelImg.style.transform = `rotate(${deg}deg)`;
    }
  }

  // Pedal bars — scaleY on a composited layer instead of height (no layout)
  lastClutchBar = setBar(barClutch,   sample.clutch,   lastClutchBar);
  lastBrakeBar  = setBar(barBrake,    sample.brake,    lastBrakeBar);
  lastThrBar    = setBar(barThrottle, sample.throttle, lastThrBar);

  // Gear (iRacing: 0=neutral, -1=reverse, 1+=forward)
  const g = sample.gear;
  const gearText = g === -1 ? 'R' : g === 0 ? 'N' : String(g);
  if (gearText !== lastGearText) { lastGearText = gearText; vGearBig.textContent = gearText; }
  const speedText = Math.round(sample.speedMs * 2.23694).toString();
  if (speedText !== lastSpeedText) { lastSpeedText = speedText; vSpeedBig.textContent = speedText; }

  ring.push({ pct: sample.lapDistPct, thr: sample.throttle, brk: sample.brake, clu: sample.clutch });
  if (ring.length > HISTORY) ring.shift();

  markDirty(); // canvas redraws once per telemetry packet, not once per vsync
});

tvAPI.onSettings(applySettings);
tvAPI.onGhosts((payload: GhostPayload) => { ghosts = payload; markDirty(); });

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  const s = await tvAPI.getSettings();
  applySettings(s);
  requestAnimationFrame(render);
})();
