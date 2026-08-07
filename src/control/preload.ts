import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/types';

contextBridge.exposeInMainWorld('tvAPI', {
  getSettings:   ()             => ipcRenderer.invoke(IPC.GET_SETTINGS),
  getF1Ports:    ()             => ipcRenderer.invoke(IPC.GET_F1_PORTS),
  onSettings:    (cb: (d: any) => void) => ipcRenderer.on(IPC.SETTINGS_UPDATE, (_, d) => cb(d)),
  onGhosts:      (cb: (d: any) => void) => ipcRenderer.on(IPC.GHOST_UPDATE,    (_, d) => cb(d)),
  onTelemetry:   (cb: (d: any) => void) => ipcRenderer.on(IPC.TELEMETRY_UPDATE,(_, d) => cb(d)),
  toggleOverlay: ()             => ipcRenderer.send(IPC.TOGGLE_OVERLAY),
  toggleLock:    ()             => ipcRenderer.send(IPC.TOGGLE_LOCK),
  setOpacity:    (v: number)    => ipcRenderer.send(IPC.SET_OPACITY, v),
  setGhosts:     (g: any)       => ipcRenderer.send(IPC.SET_GHOSTS, g),
  setChannels:   (c: any)       => ipcRenderer.send(IPC.SET_CHANNELS, c),
  setStartup:    (v: boolean)   => ipcRenderer.send(IPC.SET_STARTUP, v),
  setAccent:     (c: string)    => ipcRenderer.send(IPC.SET_ACCENT, c),
  setWheelImage: (v: string)    => ipcRenderer.send(IPC.SET_WHEEL_IMAGE, v),
  toggleBranding:()             => ipcRenderer.send(IPC.TOGGLE_BRANDING),
  resetBest:     (p: any)       => ipcRenderer.send(IPC.RESET_BEST, p),
  quit:          ()             => ipcRenderer.send(IPC.QUIT),
  startMove:        ()                         => ipcRenderer.send(IPC.START_MOVE),
  onWheelDetected:  (cb: (payload: { id: string; brand: string }) => void) => ipcRenderer.on(IPC.WHEEL_DETECTED, (_, p) => cb(p)),
});
