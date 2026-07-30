import {
  app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen
} from 'electron';
import path from 'path';
import { IPC, Settings, GhostToggles, ChannelToggles } from '../shared/types';
import { getSettings, setSetting } from './settings';
import {
  startTelemetry, stopTelemetry, registerTelemetryWindow, getGhosts, resetSessionBest
} from './telemetry';
import { resetAllTimeBest, getAllTimeBest } from './lapStore';

let overlayWin: BrowserWindow | null = null;
let controlWin: BrowserWindow | null = null;
let tray: Tray | null = null;
const positionHistory: { x: number; y: number; width: number; height: number }[] = [];
let inDragMode     = false;
let suppressMoved  = false; // ignore 'moved' fired by programmatic setBounds

const DIST = path.join(__dirname, '..');
function getAssetsPath(): string {
  return path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '../../'), 'assets');
}

// ─── Overlay window ───────────────────────────────────────────────────────────

function createOverlayWindow(): void {
  const s = getSettings();
  const { x, y, width, height } = s.overlayBounds;

  overlayWin = new BrowserWindow({
    x, y, width, height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(DIST, 'overlay/preload.js'),
    },
  });

  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setIgnoreMouseEvents(true, { forward: true });
  overlayWin.setOpacity(s.overlayOpacity);

  overlayWin.loadFile(path.join(DIST, 'overlay/overlay.html'));

  if (!s.overlayVisible) overlayWin.hide();

  overlayWin.on('closed', () => { overlayWin = null; });

  // Every completed drag: remember where it was (for Reset) and save the new spot
  overlayWin.on('moved', () => {
    if (!overlayWin || suppressMoved) return;
    const prev = getSettings().overlayBounds;
    const b    = overlayWin.getBounds();
    if (b.x === prev.x && b.y === prev.y) return;
    positionHistory.push({ ...prev });
    setSetting('overlayBounds', b);
    if (inDragMode) saveOverlayPosition(); // control-panel move: one drag, then done
  });

  registerTelemetryWindow(overlayWin);
}

// ─── Control window ───────────────────────────────────────────────────────────

function createControlWindow(): void {
  if (controlWin && !controlWin.isDestroyed()) {
    controlWin.focus();
    return;
  }

  controlWin = new BrowserWindow({
    width: 420,
    height: 760,
    title: 'Track Vision Overlay — Control Panel',
    resizable: false,
    icon: path.join(getAssetsPath(), 'tv-icon3.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(DIST, 'control/preload.js'),
    },
  });

  controlWin.loadFile(path.join(DIST, 'control/control.html'));
  controlWin.on('closed', () => { controlWin = null; app.quit(); });

  registerTelemetryWindow(controlWin);
}

// ─── Tray ─────────────────────────────────────────────────────────────────────

function buildTrayMenu(): Menu {
  const s = getSettings();
  return Menu.buildFromTemplate([
    {
      label: s.overlayVisible ? 'Hide Overlay' : 'Show Overlay',
      click: () => toggleOverlay(),
    },
    {
      label: s.overlayLocked ? 'Unlock Position' : 'Lock Position',
      click: () => toggleLock(),
    },
    { type: 'separator' },
    { label: 'Open Control Panel', click: () => createControlWindow() },
    { type: 'separator' },
    {
      label: 'Launch on Startup',
      type: 'checkbox',
      checked: s.launchOnStartup,
      click: (item) => setStartup(item.checked),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.quit(); } },
  ]);
}

function rebuildTray(): void {
  if (!tray) return;
  tray.setContextMenu(buildTrayMenu());
}

function createTray(): void {
  const iconPath = path.join(getAssetsPath(), 'icon.ico');
  let img: Electron.NativeImage;
  try {
    img = nativeImage.createFromPath(iconPath);
  } catch {
    img = nativeImage.createEmpty();
  }

  tray = new Tray(img);
  tray.setToolTip('Track Vision Overlay');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => toggleOverlay());
}

// ─── Actions ──────────────────────────────────────────────────────────────────

function toggleOverlay(): void {
  if (!overlayWin) return;
  const visible = !getSettings().overlayVisible;
  setSetting('overlayVisible', visible);
  visible ? overlayWin.show() : overlayWin.hide();
  rebuildTray();
  broadcastSettings();
}

function toggleLock(): void {
  const locked = !getSettings().overlayLocked;
  setSetting('overlayLocked', locked);
  if (overlayWin) {
    if (locked) {
      overlayWin.setIgnoreMouseEvents(true, { forward: true });
    } else {
      overlayWin.setIgnoreMouseEvents(false);
    }
  }
  rebuildTray();
  broadcastSettings();
}

function startMoveOverlay(): void {
  if (!overlayWin) return;
  inDragMode = true; // history push happens in the 'moved' handler
  overlayWin.setFocusable(true);
  overlayWin.setIgnoreMouseEvents(false);
  overlayWin.webContents.send(IPC.DRAG_MODE, true);
}

function saveOverlayPosition(): void {
  if (!overlayWin) return;
  inDragMode = false;
  setSetting('overlayBounds', overlayWin.getBounds());
  overlayWin.setFocusable(false);
  overlayWin.setIgnoreMouseEvents(true, { forward: true });
  overlayWin.webContents.send(IPC.DRAG_MODE, false);
}

function resetOverlayPosition(): void {
  if (!overlayWin || positionHistory.length === 0) return;
  const prev = positionHistory.pop()!;
  inDragMode    = false;
  suppressMoved = true;
  overlayWin.setBounds(prev);
  setTimeout(() => { suppressMoved = false; }, 100);
  setSetting('overlayBounds', prev);
  overlayWin.setFocusable(false);
  overlayWin.setIgnoreMouseEvents(true, { forward: true });
  overlayWin.webContents.send(IPC.DRAG_MODE, false);
}

function setStartup(enabled: boolean): void {
  setSetting('launchOnStartup', enabled);
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath });
  rebuildTray();
  broadcastSettings();
}

function broadcastSettings(): void {
  const s = getSettings();
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.webContents.send(IPC.SETTINGS_UPDATE, s);
  if (controlWin  && !controlWin.isDestroyed())  controlWin.webContents.send(IPC.SETTINGS_UPDATE, s);
}

// ─── App lifecycle ─────────────────────────────────────────────────────────────

function registerIpc(): void {
  ipcMain.on(IPC.TOGGLE_OVERLAY, () => toggleOverlay());
  ipcMain.on(IPC.TOGGLE_LOCK,    () => toggleLock());

  ipcMain.on(IPC.SET_OPACITY, (_, opacity: number) => {
    const clamped = Math.max(0.3, Math.min(1, opacity));
    setSetting('overlayOpacity', clamped);
    overlayWin?.setOpacity(clamped);
    broadcastSettings();
  });

  ipcMain.on(IPC.SET_GHOSTS, (_, ghosts: GhostToggles) => {
    setSetting('ghosts', ghosts);
    broadcastSettings();
  });

  ipcMain.on(IPC.SET_CHANNELS, (_, channels: ChannelToggles) => {
    setSetting('channels', channels);
    broadcastSettings();
  });

  ipcMain.on(IPC.SET_STARTUP, (_, enabled: boolean) => setStartup(enabled));

  ipcMain.on(IPC.SET_ACCENT, (_, color: string) => {
    setSetting('accentColor', color);
    broadcastSettings();
  });

  ipcMain.on(IPC.SET_WHEEL_IMAGE, (_, choice: string) => {
    setSetting('wheelImage', choice);
    broadcastSettings();
  });

  ipcMain.on(IPC.TOGGLE_BRANDING, () => {
    setSetting('showBranding', !getSettings().showBranding);
    broadcastSettings();
  });

  ipcMain.on(IPC.RESET_BEST, (_, payload: { carKey?: string; trackKey?: string }) => {
    resetAllTimeBest(payload?.carKey, payload?.trackKey);
    resetSessionBest();
    const ghosts = getGhosts();
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.webContents.send(IPC.GHOST_UPDATE, ghosts);
    if (controlWin  && !controlWin.isDestroyed())  controlWin.webContents.send(IPC.GHOST_UPDATE, ghosts);
  });

  ipcMain.handle(IPC.GET_SETTINGS, () => getSettings());

  ipcMain.on(IPC.WHEEL_DETECTED, (_, payload: { id: string; brand: string }) => {
    if (controlWin && !controlWin.isDestroyed()) controlWin.webContents.send(IPC.WHEEL_DETECTED, payload);
  });

  ipcMain.on(IPC.START_MOVE,     () => startMoveOverlay());
  ipcMain.on(IPC.SAVE_POSITION,  () => saveOverlayPosition());
  ipcMain.on(IPC.RESET_POSITION, () => resetOverlayPosition());

  ipcMain.on(IPC.OVERLAY_HOVER_IN, () => {
    overlayWin?.setIgnoreMouseEvents(false);
  });

  ipcMain.on(IPC.OVERLAY_HOVER_OUT, () => {
    if (getSettings().overlayLocked) {
      overlayWin?.setIgnoreMouseEvents(true, { forward: true });
    }
  });

  ipcMain.on(IPC.QUIT, () => app.quit());

  ipcMain.on('overlay:bounds', (_, bounds: Partial<Settings['overlayBounds']>) => {
    const current = getSettings().overlayBounds;
    setSetting('overlayBounds', { ...current, ...bounds });
  });
}

app.on('ready', () => {
  registerIpc();
  createTray();
  createOverlayWindow();
  createControlWindow();
  startTelemetry();
});

app.on('window-all-closed', (e: Event) => {
  e.preventDefault(); // Keep running in tray
});

app.on('before-quit', () => {
  stopTelemetry();
});
