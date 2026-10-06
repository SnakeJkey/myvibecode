const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gameApi', {
  list: () => ipcRenderer.invoke('games:list'),
  get: (id, force) => ipcRenderer.invoke('games:get', id, Boolean(force)),
});
