import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/types';

contextBridge.exposeInMainWorld('tvAPI', {
  onTelemetry:  (cb: (d: any) => void) => ipcRenderer.on(IPC.TELEMETRY_UPDATE, (_, d) => cb(d)),
  onSettings:   (cb: (d: any) => void) => ipcRenderer.on(IPC.SETTINGS_UPDATE,  (_, d) => cb(d)),
  onGhosts:     (cb: (d: any) => void) => ipcRenderer.on(IPC.GHOST_UPDATE,     (_, d) => cb(d)),
  onSessionInfo:(cb: (d: any) => void) => ipcRenderer.on(IPC.SESSION_INFO,      (_, d) => cb(d)),
  onDragMode:   (cb: (enabled: boolean) => void) => ipcRenderer.on(IPC.DRAG_MODE, (_, v) => cb(v)),
  getSettings:  ()                     => ipcRenderer.invoke(IPC.GET_SETTINGS),
  hoverIn:      ()                     => ipcRenderer.send(IPC.OVERLAY_HOVER_IN),
  hoverOut:     ()                     => ipcRenderer.send(IPC.OVERLAY_HOVER_OUT),
  setGhosts:    (g: any)               => ipcRenderer.send(IPC.SET_GHOSTS, g),
  setChannels:  (c: any)               => ipcRenderer.send(IPC.SET_CHANNELS, c),
  toggleLock:   ()                     => ipcRenderer.send(IPC.TOGGLE_LOCK),
  toggleOverlay:()                     => ipcRenderer.send(IPC.TOGGLE_OVERLAY),
  startMove:     ()                    => ipcRenderer.send(IPC.START_MOVE),
  savePosition:  ()                    => ipcRenderer.send(IPC.SAVE_POSITION),
  resetPosition: ()                    => ipcRenderer.send(IPC.RESET_POSITION),
  reportWheel:   (id: string)          => ipcRenderer.send(IPC.WHEEL_DETECTED, id),
});
