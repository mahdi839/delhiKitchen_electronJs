'use strict';

const { app, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

let mainWindow = null;
let busy = false;

function sendStatus(partial) {
    mainWindow?.webContents.send('till-status', { ...partial, update: true });
}

function publicError(error) {
    return String(error?.message || error || 'Update failed')
        .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '')
        .trim();
}

function bind(window) {
    mainWindow = window;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;

    autoUpdater.on('download-progress', (progress) => {
        const percent = Math.max(0, Math.min(100, Math.round(progress.percent || 0)));
        sendStatus({ phase: 'ready', message: `Downloading update… ${percent}%` });
    });
}

async function checkAndInstall() {
    if (busy) {
        return { ok: false, message: 'An update is already in progress.' };
    }
    if (!app.isPackaged) {
        return { ok: false, message: 'Updates only work in the installed app, not in development.' };
    }

    busy = true;
    sendStatus({ phase: 'ready', message: 'Checking GitHub for a newer till…' });
    try {
        const result = await autoUpdater.checkForUpdates();
        const available = result?.isUpdateAvailable === true
            || (result?.updateInfo?.version && result.updateInfo.version !== app.getVersion());
        const next = result?.updateInfo?.version;
        if (!available || !next) {
            return { ok: true, message: `This till is up to date (v${app.getVersion()}).` };
        }

        sendStatus({ phase: 'ready', message: `Downloading v${next}…` });
        await autoUpdater.downloadUpdate();

        const choice = await dialog.showMessageBox(mainWindow, {
            type: 'info',
            buttons: ['Restart now', 'Later'],
            defaultId: 0,
            cancelId: 1,
            title: 'Delhi Kitchen Till',
            message: `Version ${next} is ready.`,
            detail: 'Bills and menu on this PC will stay. Restart to finish the update.',
        });
        if (choice.response === 0) {
            autoUpdater.quitAndInstall(false, true);
            return { ok: true, message: 'Restarting to finish the update…' };
        }
        return { ok: true, message: `v${next} will install the next time the till is closed.` };
    } catch (error) {
        const message = publicError(error);
        if (/404|not found|no published versions/i.test(message)) {
            return { ok: false, message: 'No update is published on GitHub yet. This till is up to date.' };
        }
        return { ok: false, message };
    } finally {
        busy = false;
    }
}

module.exports = { bind, checkAndInstall };
