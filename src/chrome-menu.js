'use strict';

const { BrowserWindow } = require('electron');
const path = require('path');

const SIZES = {
    orders: { width: 188, height: 108 },
    bills: { width: 188, height: 108 },
    tools: { width: 208, height: 204 },
    status: { width: 248, height: 260 },
};

let popup = null;

function close() {
    if (popup && !popup.isDestroyed()) {
        popup.close();
    }
    popup = null;
}

function open(mainWindow, payload) {
    if (!mainWindow) {
        return;
    }
    close();
    const kind = payload.kind || 'tools';
    const size = SIZES[kind] || SIZES.tools;
    const content = mainWindow.getContentBounds();
    let x = Math.round(content.x + Number(payload.x || 0));
    if (payload.align === 'right') {
        x = Math.round(content.x + Number(payload.x || 0) - size.width);
    }
    const y = Math.round(content.y + Number(payload.y || 0));
    popup = new BrowserWindow({
        parent: mainWindow,
        modal: false,
        frame: false,
        show: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        hasShadow: true,
        backgroundColor: '#101827',
        width: size.width,
        height: size.height,
        x,
        y,
        webPreferences: {
            preload: path.join(__dirname, 'preload-menu.js'),
            contextIsolation: true,
            sandbox: false,
        },
    });
    popup.setMenu(null);
    popup.loadFile(path.join(__dirname, '..', 'renderer', 'menu-popup.html'), {
        query: {
            kind,
            online: payload.online ? '1' : '0',
            printer: payload.printer || '',
        },
    });
    popup.once('ready-to-show', () => {
        if (popup && !popup.isDestroyed()) {
            popup.show();
        }
    });
    popup.on('blur', () => close());
    popup.on('closed', () => {
        popup = null;
    });
}

module.exports = { open, close };
