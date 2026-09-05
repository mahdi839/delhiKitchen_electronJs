'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
    printReceipt: () => ipcRenderer.invoke('print-receipt'),
});
