import type { Settings, TelemetrySample, GhostPayload } from '../shared/types';

declare const tvAPI: {
  getSettings:    () => Promise<Settings>;
  onSettings:     (cb: (d: Settings) => void)         => void;
  onGhosts:       (cb: (d: GhostPayload) => void)     => void;
  onTelemetry:    (cb: (d: TelemetrySample) => void)  => void;
  toggleOverlay:  () => void;
  toggleLock:     () => void;
  setOpacity:     (v: number) => void;
  setGhosts:      (g: Settings['ghosts']) => void;
  setChannels:    (c: Settings['channels']) => void;
  setStartup:     (v: boolean) => void;
  setAccent:      (c: string) => void;
  setWheelImage:  (v: string) => void;
  toggleBranding: () => void;
  resetBest:      (p: { carKey?: string; trackKey?: string }) => void;
  quit:              () => void;
  startMove:         () => void;
  onWheelDetected:   (cb: (payload: { id: string; brand: string }) => void) => void;
};

// ─── DOM refs ──────────────────────────────────────────────────────────────────
const connBadge        = document.getElementById('conn-badge')!;
const btnOverlayPower  = document.getElementById('btn-overlay-power')!;
const overlayPowerLabel = document.getElementById('overlay-power-label')!;
const togLocked    = document.getElementById('tog-locked')    as HTMLInputElement;
const slOpacity    = document.getElementById('sl-opacity')    as HTMLInputElement;
const chThrottle   = document.getElementById('ch-throttle')   as HTMLInputElement;
const chBrake      = document.getElementById('ch-brake')      as HTMLInputElement;
const chClutch     = document.getElementById('ch-clutch')     as HTMLInputElement;
const chSteering   = document.getElementById('ch-steering')   as HTMLInputElement;
const chGear       = document.getElementById('ch-gear')       as HTMLInputElement;
const chSpeed      = document.getElementById('ch-speed')      as HTMLInputElement;
const chRpm        = document.getElementById('ch-rpm')        as HTMLInputElement;
const ghSession    = document.getElementById('gh-session')    as HTMLInputElement;
const ghThrottle   = document.getElementById('gh-throttle')   as HTMLInputElement;
const ghBrake      = document.getElementById('gh-brake')      as HTMLInputElement;
const colAccent    = document.getElementById('col-accent')    as HTMLInputElement;
const togStartup   = document.getElementById('tog-startup')   as HTMLInputElement;
const selWheelImg  = document.getElementById('sel-wheel-img') as HTMLSelectElement;
const btnResetCur    = document.getElementById('btn-reset-cur')!;
const btnResetAll    = document.getElementById('btn-reset-all')!;
const btnQuit        = document.getElementById('btn-quit')!;
const btnMoveOverlay = document.getElementById('btn-move-overlay')!;

let currentSettings: Settings | null = null;
let lastCarKey   = '';
let lastTrackKey = '';

// ─── Opacity curve ─────────────────────────────────────────────────────────────
// The slider position maps to opacity through a square-root curve so the top of
// the range fades gently — small drags near "fully opaque" barely change it, and
// most of the transparency happens in the lower half of the slider.
const OPACITY_MIN = 0.3;

function sliderToOpacity(t: number): number {
  return OPACITY_MIN + (1 - OPACITY_MIN) * Math.sqrt(Math.max(0, Math.min(1, t)));
}

function opacityToSlider(op: number): number {
  const n = (op - OPACITY_MIN) / (1 - OPACITY_MIN);
  const clamped = Math.max(0, Math.min(1, n));
  return clamped * clamped;
}

// ─── Apply settings to UI ──────────────────────────────────────────────────────
function applySettings(s: Settings): void {
  currentSettings = s;
  const on = s.overlayVisible;
  btnOverlayPower.classList.toggle('overlay-off', !on);
  togLocked.checked   = s.overlayLocked;
  slOpacity.value     = String(opacityToSlider(s.overlayOpacity));
  chThrottle.checked  = s.channels.throttle;
  chBrake.checked     = s.channels.brake;
  chClutch.checked    = s.channels.clutch;
  chSteering.checked  = s.channels.steering;
  chGear.checked      = s.channels.gear;
  chSpeed.checked     = s.channels.speed;
  chRpm.checked       = s.channels.rpm;
  ghSession.checked   = s.ghosts.sessionBest;
  ghThrottle.checked  = s.ghosts.throttle;
  ghBrake.checked     = s.ghosts.brake;
  colAccent.value     = s.accentColor;
  togStartup.checked  = s.launchOnStartup;
  selWheelImg.value   = (!s.wheelImage || s.wheelImage === 'auto') ? 'drawn' : s.wheelImage;
}

// ─── Event wiring ──────────────────────────────────────────────────────────────
btnOverlayPower.addEventListener('click', () => tvAPI.toggleOverlay());
togLocked.addEventListener('change',   () => tvAPI.toggleLock());
slOpacity.addEventListener('input',    () => tvAPI.setOpacity(sliderToOpacity(parseFloat(slOpacity.value))));

function syncChannels(): void {
  tvAPI.setChannels({
    throttle: chThrottle.checked,
    brake:    chBrake.checked,
    clutch:   chClutch.checked,
    steering: chSteering.checked,
    gear:     chGear.checked,
    speed:    chSpeed.checked,
    rpm:      chRpm.checked,
  });
}

[chThrottle, chBrake, chClutch, chSteering, chGear, chSpeed, chRpm].forEach(el =>
  el.addEventListener('change', syncChannels)
);

function updateGhostChannelRows(): void {
  const anyBest = ghSession.checked;
  const throttleRow = ghThrottle.closest('.checkbox-item') as HTMLElement;
  const brakeRow    = ghBrake.closest('.checkbox-item')    as HTMLElement;
  throttleRow.style.opacity       = anyBest ? '1' : '0.3';
  brakeRow.style.opacity          = anyBest ? '1' : '0.3';
  throttleRow.style.pointerEvents = anyBest ? '' : 'none';
  brakeRow.style.pointerEvents    = anyBest ? '' : 'none';
}

function syncGhosts(): void {
  tvAPI.setGhosts({
    sessionBest: ghSession.checked,
    allTimeBest: false,
    throttle:    ghThrottle.checked,
    brake:       ghBrake.checked,
  });
}

[ghThrottle, ghBrake].forEach(el => el.addEventListener('change', syncGhosts));
ghSession.addEventListener('change', () => {
  updateGhostChannelRows();
  syncGhosts();
});

colAccent.addEventListener('input', () => tvAPI.setAccent(colAccent.value));
togStartup.addEventListener('change', () => tvAPI.setStartup(togStartup.checked));
selWheelImg.addEventListener('change', () => tvAPI.setWheelImage(selWheelImg.value));

btnResetCur.addEventListener('click', () => {
  if (!confirm('Reset all-time best for the current car + track?')) return;
  tvAPI.resetBest({ carKey: lastCarKey, trackKey: lastTrackKey });
});

btnResetAll.addEventListener('click', () => {
  if (!confirm('Reset ALL all-time best laps? This cannot be undone.')) return;
  tvAPI.resetBest({});
});

btnQuit.addEventListener('click', () => tvAPI.quit());
btnMoveOverlay.addEventListener('click', () => tvAPI.startMove());

// Which manual wheel-image options belong to which wheelbase brand.
// When a base is detected, only its own brand's wheels are offered.
const OPTION_BRANDS: Record<string, string> = {
  'simagic-gt':     'simagic',
  'simagic-fx-pro': 'simagic',
  'simagic-gts':    'simagic',
  'fanatec':        'fanatec',
  'simucube':       'simucube',
};

function filterWheelOptions(brand: string): void {
  let selectionHidden = false;
  for (const opt of Array.from(selWheelImg.options)) {
    const optBrand = OPTION_BRANDS[opt.value];
    // 'drawn' has no brand and is always available
    const hide = !!optBrand && !!brand && optBrand !== brand;
    opt.hidden = hide;
    if (hide && selWheelImg.value === opt.value) selectionHidden = true;
  }
  if (selectionHidden) {
    selWheelImg.value = 'drawn';
    tvAPI.setWheelImage('drawn');
  }
}

tvAPI.onWheelDetected(({ id, brand }) => {
  const el = document.getElementById('detected-wheel')!;
  el.textContent = id;
  filterWheelOptions(brand);
});

// ─── Live updates ──────────────────────────────────────────────────────────────
tvAPI.onSettings(applySettings);

tvAPI.onTelemetry((sample: TelemetrySample) => {
  const connected = sample.connected ?? true;
  connBadge.textContent = connected ? 'CONNECTED' : 'WAITING';
  connBadge.className   = connected ? 'connected' : '';
});

// ─── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  const s = await tvAPI.getSettings();
  applySettings(s);
  updateGhostChannelRows();
})();
