'use strict';

const { app, BrowserWindow, BrowserView, ipcMain, dialog, session } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const configStore = require('./config-store');
const laravel = require('./laravel-server');

const SCREENS = {
    dashboard: '/',
    pos: '/pos',
    orders: '/orders',
    kitchen: '/kitchen',
    tables: '/tables',
    sections: '/sections',
    products: '/products',
    categories: '/categories',
    reports: '/reports',
    settings: '/settings',
};

let mainWindow = null;
let tillView = null;
let config = null;
let engine = null;

function createToken() {
    return crypto.randomBytes(24).toString('hex');
}

function sendStatus(partial) {
    mainWindow?.webContents.send('till-status', partial);
}

function chromeHeight() {
    return { top: 64, bottom: 42 };
}

function resetToActualSize(contents) {
    if (!contents || contents.isDestroyed()) {
        return;
    }
    contents.setZoomLevel(0);
    contents.setZoomFactor(1);
}

function layoutView() {
    if (!mainWindow || !tillView) {
        return;
    }
    const { width, height } = mainWindow.getContentBounds();
    const chrome = chromeHeight();
    tillView.setBounds({
        x: 0,
        y: chrome.top,
        width,
        height: Math.max(200, height - chrome.top - chrome.bottom),
    });
}

function attachTill() {
    if (!mainWindow || tillView) {
        layoutView();
        return;
    }
    tillView = new BrowserView({
        webPreferences: {
            preload: path.join(__dirname, 'preload-till.js'),
            contextIsolation: true,
            sandbox: false,
            spellcheck: false,
        },
    });
    mainWindow.addBrowserView(tillView);
    tillView.setAutoResize({ width: false, height: false });
    bindReloadKeys(tillView.webContents);
    layoutView();
    tillView.webContents.on('did-finish-load', () => {
        resetToActualSize(tillView.webContents);
        tillView.webContents.executeJavaScript(`
            document.documentElement.classList.add('desktop-till');
            document.querySelectorAll('[data-toggle-sidebar]').forEach((el) => el.remove());
            if (!window.__dkPrintPatched) {
                window.__dkPrintPatched = true;
                window.print = () => window.desktop && window.desktop.printReceipt
                    ? window.desktop.printReceipt()
                    : undefined;
            }
        `).catch(() => {});
    });
}

async function loadTill(pathname = '/pos') {
    attachTill();
    await tillView.webContents.loadURL(`${engine.url}${pathname}`);
}

async function reloadUi() {
    await session.defaultSession.clearCache();
    if (tillView && !tillView.webContents.isDestroyed()) {
        tillView.webContents.reloadIgnoringCache();
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reloadIgnoringCache();
    }
    return { ok: true };
}

function bindReloadKeys(contents) {
    contents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') {
            return;
        }
        const key = String(input.key || '');
        if (key === 'F5' || ((input.control || input.meta) && key.toLowerCase() === 'r')) {
            event.preventDefault();
            reloadUi();
        }
    });
}

async function printReceipt() {
    if (!tillView) {
        return { ok: false, message: 'Till is not ready.' };
    }
    const options = {
        silent: Boolean(config.printerName),
        deviceName: config.printerName || '',
        printBackground: true,
        margins: { marginType: 'none' },
        landscape: false,
    };
    return new Promise((resolve) => {
        tillView.webContents.print(options, (success, failureReason) => {
            resolve({ ok: success, message: success ? 'Sent to printer' : (failureReason || 'Print cancelled') });
        });
    });
}

async function startEngine(onLog) {
    config = configStore.load();
    if (!config.loopbackToken) {
        config = configStore.save({ loopbackToken: createToken() });
    }
    engine = await laravel.startServer({
        laravelPath: config.laravelPath,
        phpPath: config.phpPath,
        userData: app.getPath('userData'),
        config,
        onLog,
    });
    return laravel.requestJson('/api/desktop/status', { token: config.loopbackToken });
}

function createWindow() {
    const icon = path.join(__dirname, '..', 'resources', 'icon.png');
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 920,
        minWidth: 1100,
        minHeight: 720,
        backgroundColor: '#0b1020',
        frame: false,
        show: false,
        icon: fs.existsSync(icon) ? icon : undefined,
        webPreferences: {
            preload: path.join(__dirname, 'preload-shell.js'),
            contextIsolation: true,
            sandbox: false,
        },
    });
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'shell.html'));
    bindReloadKeys(mainWindow.webContents);
    mainWindow.webContents.on('did-finish-load', () => resetToActualSize(mainWindow.webContents));
    mainWindow.once('ready-to-show', () => {
        resetToActualSize(mainWindow.webContents);
        mainWindow.maximize();
        mainWindow.show();
    });
    mainWindow.on('resize', layoutView);
    mainWindow.on('closed', () => {
        tillView = null;
        mainWindow = null;
    });
}

app.whenReady().then(async () => {
    await session.defaultSession.clearCache();
    createWindow();
});

app.on('window-all-closed', () => {
    laravel.stopServer();
    app.quit();
});

app.on('before-quit', () => {
    laravel.stopServer();
});

ipcMain.on('window-control', (_event, action) => {
    if (!mainWindow) {
        return;
    }
    if (action === 'min') {
        mainWindow.minimize();
    } else if (action === 'max') {
        mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    } else if (action === 'close') {
        mainWindow.close();
    }
});

ipcMain.handle('shell-ready', async () => {
    sendStatus({ phase: 'boot', message: 'Starting local billing engine…', online: false });
    try {
        const status = await startEngine((message) => sendStatus({ phase: 'boot', message }));
        const needsSetup = !config.setupDone || Number(status.users || 0) < 1;
        sendStatus({
            phase: needsSetup ? 'setup' : 'ready',
            message: needsSetup ? 'Load menu data once, then bill offline.' : 'Ready to bill',
            online: false,
            status,
            config: {
                laravelPath: config.laravelPath,
                phpPath: config.phpPath,
                cloudUrl: config.cloudUrl,
                cloudToken: config.cloudToken ? 'saved' : '',
                printerName: config.printerName,
            },
        });
        if (!needsSetup) {
            await loadTill('/pos');
        }
        return { ok: true, needsSetup };
    } catch (error) {
        sendStatus({ phase: 'error', message: error.message, online: false });
        return { ok: false, message: error.message };
    }
});

ipcMain.handle('till-state', async () => ({
    config: {
        laravelPath: config?.laravelPath,
        phpPath: config?.phpPath,
        cloudUrl: config?.cloudUrl,
        printerName: config?.printerName,
        lastSyncAt: config?.lastSyncAt,
    },
    online: false,
}));

ipcMain.handle('save-setup', async (_event, payload) => {
    config = configStore.save({
        laravelPath: payload.laravelPath || config.laravelPath,
        phpPath: payload.phpPath || config.phpPath,
        cloudUrl: payload.cloudUrl ?? config.cloudUrl,
        cloudToken: payload.cloudToken || config.cloudToken,
        printerName: payload.printerName ?? config.printerName,
        setupDone: true,
    });
    sendStatus({ phase: 'boot', message: 'Restarting till with your settings…' });
    laravel.stopServer();
    const status = await startEngine((message) => sendStatus({ phase: 'boot', message }));
    sendStatus({ phase: 'setup', status, message: 'Settings saved.' });
    return { ok: true, status };
});

ipcMain.handle('import-source', async () => {
    sendStatus({ phase: 'setup', message: 'Copying products and tables from this PC…' });
    const result = await laravel.requestJson('/api/desktop/import-source', {
        method: 'POST',
        token: config.loopbackToken,
    });
    config = configStore.save({ setupDone: true });
    sendStatus({ phase: 'ready', message: 'Menu loaded. Sign in and bill.', status: result });
    await loadTill('/login');
    return result;
});

ipcMain.handle('sync-now', async () => {
    sendStatus({ message: 'Syncing with cloud…' });
    try {
        const result = await laravel.requestJson('/api/desktop/sync', {
            method: 'POST',
            token: config.loopbackToken,
            body: { cloud_url: config.cloudUrl, cloud_token: config.cloudToken },
        });
        config = configStore.save({ lastSyncAt: result.last_sync_at || new Date().toISOString() });
        sendStatus({ message: 'Cloud sync complete.', lastSyncAt: config.lastSyncAt, pending: 0 });
        return result;
    } catch (error) {
        sendStatus({ message: error.message });
        throw error;
    }
});

ipcMain.handle('list-printers', async () => {
    const printers = await (tillView || mainWindow).webContents.getPrintersAsync();
    return printers.map((printer) => ({ name: printer.name, isDefault: printer.isDefault }));
});

ipcMain.handle('set-printer', async (_event, name) => {
    config = configStore.save({ printerName: name || '' });
    return { printerName: config.printerName };
});

ipcMain.handle('open-screen', async (_event, screen) => {
    const pathname = SCREENS[screen] || '/pos';
    await loadTill(pathname);
    return { ok: true };
});

ipcMain.handle('print-receipt', () => printReceipt());
ipcMain.handle('reload-ui', () => reloadUi());
