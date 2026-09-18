'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const params = new URLSearchParams(window.location.search);

contextBridge.exposeInMainWorld('menu', {
    kind: params.get('kind') || 'tools',
    online: params.get('online') === '1',
    printer: params.get('printer') || '',
    pick: (action, extra) => ipcRenderer.invoke('chrome-menu-pick', { action, ...extra }),
    printers: () => ipcRenderer.invoke('list-printers'),
});
