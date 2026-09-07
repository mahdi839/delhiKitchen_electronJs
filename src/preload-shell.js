'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('till', {
    ready: () => ipcRenderer.invoke('shell-ready'),
    state: () => ipcRenderer.invoke('till-state'),
    saveSetup: (payload) => ipcRenderer.invoke('save-setup', payload),
    importSource: () => ipcRenderer.invoke('import-source'),
    syncNow: () => ipcRenderer.invoke('sync-now'),
    printers: () => ipcRenderer.invoke('list-printers'),
    setPrinter: (name) => ipcRenderer.invoke('set-printer', name),
    openScreen: (screen) => ipcRenderer.invoke('open-screen', screen),
    reloadUi: () => ipcRenderer.invoke('reload-ui'),
    windowControl: (action) => ipcRenderer.send('window-control', action),
    onStatus: (fn) => ipcRenderer.on('till-status', (_event, payload) => fn(payload)),
});
