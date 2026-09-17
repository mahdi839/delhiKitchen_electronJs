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

function publicError(error) {
    return String(error?.message || error || 'Request failed')
        .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '')
        .trim();
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

function setTillVisible(visible) {
    if (!mainWindow || !tillView) {
        return;
    }
    try {
        mainWindow.removeBrowserView(tillView);
    } catch {
        // View was not attached.
    }
    if (visible) {
        mainWindow.addBrowserView(tillView);
        layoutView();
    }
}

function openCloudSetup(message) {
    setTillVisible(false);
    sendStatus({
        phase: 'setup',
        sync: message ? 'error' : '',
        packaged: app.isPackaged,
        message: message || 'Enter the live website URL and sync token, then Pull from cloud.',
        config: {
            laravelPath: config?.laravelPath,
            phpPath: config?.phpPath,
            cloudUrl: config?.cloudUrl,
            cloudToken: config?.cloudToken ? 'saved' : '',
            printerName: config?.printerName,
        },
    });
}

async function loadTill(pathname = '/pos') {
    attachTill();
    setTillVisible(true);
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
    if (!config.setupDone) {
        config = configStore.save({ setupDone: true });
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
        sendStatus({
            phase: 'ready',
            message: 'Ready to bill',
            online: false,
            status,
            packaged: app.isPackaged,
            config: {
                laravelPath: config.laravelPath,
                phpPath: config.phpPath,
                cloudUrl: config.cloudUrl,
                cloudToken: config.cloudToken ? 'saved' : '',
                printerName: config.printerName,
            },
        });
        await loadTill('/pos');
        return { ok: true, needsSetup: false, packaged: app.isPackaged };
    } catch (error) {
        const message = publicError(error);
        sendStatus({ phase: 'error', message, online: false });
        return { ok: false, message };
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
    packaged: app.isPackaged,
    online: false,
}));

ipcMain.handle('save-setup', async (_event, payload) => {
    config = configStore.save({
        laravelPath: payload.laravelPath || config.laravelPath,
        phpPath: payload.phpPath || config.phpPath,
        cloudUrl: (payload.cloudUrl || '').replace(/\/+$/, '') || config.cloudUrl,
        cloudToken: payload.cloudToken || config.cloudToken,
        printerName: payload.printerName ?? config.printerName,
        setupDone: true,
    });
    if (payload.restart === false && engine) {
        sendStatus({ phase: 'setup', sync: 'ok', message: 'Settings saved.' });
        return { ok: true };
    }
    sendStatus({ phase: 'boot', message: 'Restarting till with your settings…' });
    laravel.stopServer();
    const status = await startEngine((message) => sendStatus({ phase: 'boot', message }));
    sendStatus({ phase: 'setup', status, message: 'Settings saved.' });
    return { ok: true, status };
});

ipcMain.handle('import-source', async () => {
    if (app.isPackaged) {
        throw new Error('Use Pull from cloud to load the menu on this till.');
    }
    sendStatus({ phase: 'setup', message: 'Copying products and tables from this PC…' });
    const result = await laravel.requestJson('/api/desktop/import-source', {
        method: 'POST',
        token: config.loopbackToken,
    });
    config = configStore.save({ setupDone: true });
    sendStatus({ phase: 'ready', message: 'Menu loaded.', status: result });
    await loadTill('/pos');
    return result;
});

ipcMain.handle('sync-now', async () => {
    if (!config?.cloudUrl || !config?.cloudToken) {
        openCloudSetup('Cloud URL and sync token are required. Paste them below, then Pull from cloud.');
        return { ok: false, message: 'Cloud URL and sync token are required.' };
    }
    setTillVisible(false);
    sendStatus({
        phase: 'setup',
        sync: 'working',
        message: `Connecting to ${config.cloudUrl} and downloading the menu…`,
    });
    const tick = setInterval(() => {
        sendStatus({
            phase: 'setup',
            sync: 'working',
            message: 'Still downloading menu from the cloud… please wait.',
        });
    }, 3000);
    try {
        const result = await laravel.requestJson('/api/desktop/sync', {
            method: 'POST',
            token: config.loopbackToken,
            body: { cloud_url: config.cloudUrl.replace(/\/+$/, ''), cloud_token: config.cloudToken },
        });
        config = configStore.save({ lastSyncAt: result.last_sync_at || new Date().toISOString() });
        const products = Number(result.pulled?.products || 0);
        const users = Number(result.pulled?.users || 0);
        const message = `Complete. Loaded ${products} products and ${users} users. Click Back to till.`;
        sendStatus({
            phase: 'setup',
            sync: 'ok',
            message,
            lastSyncAt: config.lastSyncAt,
            pending: 0,
        });
        return { ok: true, message, ...result };
    } catch (error) {
        const message = publicError(error);
        sendStatus({ phase: 'setup', sync: 'error', message });
        return { ok: false, message };
    } finally {
        clearInterval(tick);
    }
});

ipcMain.handle('open-cloud-setup', async () => {
    openCloudSetup();
    return { ok: true };
});

ipcMain.handle('close-cloud-setup', async () => {
    sendStatus({ phase: 'ready', message: 'Ready to bill' });
    await loadTill('/pos');
    return { ok: true };
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
