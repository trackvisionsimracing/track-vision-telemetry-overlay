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
  toggleBranding: () => void;
  resetBest:      (p: { carKey?: string; trackKey?: string }) => void;
  quit:              () => void;
  startMove:         () => void;
  onWheelDetected:   (cb: (id: string) => void) => void;
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
const btnResetCur    = document.getElementById('btn-reset-cur')!;
const btnResetAll    = document.getElementById('btn-reset-all')!;
const btnQuit        = document.getElementById('btn-quit')!;
const btnMoveOverlay = document.getElementById('btn-move-overlay')!;

let currentSettings: Settings | null = null;
let lastCarKey   = '';
let lastTrackKey = '';

// ─── Apply settings to UI ──────────────────────────────────────────────────────
function applySettings(s: Settings): void {
  currentSettings = s;
  const on = s.overlayVisible;
  btnOverlayPower.classList.toggle('overlay-off', !on);
  togLocked.checked   = s.overlayLocked;
  slOpacity.value     = String(s.overlayOpacity);
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
}

// ─── Event wiring ──────────────────────────────────────────────────────────────
btnOverlayPower.addEventListener('click', () => tvAPI.toggleOverlay());
togLocked.addEventListener('change',   () => tvAPI.toggleLock());
slOpacity.addEventListener('input',    () => tvAPI.setOpacity(parseFloat(slOpacity.value)));

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

tvAPI.onWheelDetected((id: string) => {
  const el = document.getElementById('detected-wheel')!;
  el.textContent = id;
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
