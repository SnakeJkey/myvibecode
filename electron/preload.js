const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gameApi', {
  list: () => ipcRenderer.invoke('games:list'),
  get: (id, force) => ipcRenderer.invoke('games:get', id, Boolean(force)),
  launch: (target) => ipcRenderer.invoke('games:launch', target),
  article: (id, ref) => ipcRenderer.invoke('articles:get', id, ref),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    onChange: (callback) => ipcRenderer.on('settings:changed', (_event, value) => callback(value)),
  },
  onGameSession: (callback) => ipcRenderer.on('game:session', (_event, info) => callback(info)),
  playtime: {
    get: () => ipcRenderer.invoke('playtime:get'),
    reset: () => ipcRenderer.invoke('playtime:reset'),
    onChange: (callback) => ipcRenderer.on('playtime:changed', (_event, summary) => callback(summary)),
  },
});
