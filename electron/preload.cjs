const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('forzaDesktop', {
  platform: process.platform,
  loadFH6Data: () => ipcRenderer.invoke('fh6-data:load'),
  saveFH6Data: (data) => ipcRenderer.invoke('fh6-data:save', data),
  installUpdate: (request) => ipcRenderer.invoke('update:download-and-install', request),
});
