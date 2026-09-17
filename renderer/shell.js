'use strict';

const netBadge = document.getElementById('netBadge');
const printerSelect = document.getElementById('printerSelect');
const stage = document.getElementById('stage');
const splashCard = document.getElementById('splashCard');
const setupCard = document.getElementById('setupCard');
const bootMessage = document.getElementById('bootMessage');
const setupMessage = document.getElementById('setupMessage');
const syncBanner = document.getElementById('syncBanner');
const cloudPullBtn = document.getElementById('cloudPullBtn');
const saveSetupBtn = document.getElementById('saveSetup');
const cancelSetupBtn = document.getElementById('cancelSetup');
const trayLeft = document.getElementById('trayLeft');
const trayMid = document.getElementById('trayMid');
const trayRight = document.getElementById('trayRight');

function setOnline() {
    const online = navigator.onLine;
    netBadge.textContent = online ? 'Online' : 'Offline';
    netBadge.className = `badge ${online ? 'online' : 'offline'}`;
}

function showSplash(message) {
    stage.className = 'stage splash';
    splashCard.classList.remove('hidden');
    setupCard.classList.add('hidden');
    if (message) {
        bootMessage.textContent = message;
    }
}

function showSetup() {
    stage.className = 'stage splash';
    splashCard.classList.add('hidden');
    setupCard.classList.remove('hidden');
}

function showTill() {
    stage.className = 'stage till';
}

function setBusy(busy) {
    cloudPullBtn.disabled = busy;
    saveSetupBtn.disabled = busy;
    cancelSetupBtn.disabled = busy;
}

function setSyncBanner(state, message) {
    syncBanner.hidden = !state && !message;
    syncBanner.className = `sync-banner${state ? ` is-${state}` : ''}`;
    if (message) {
        setupMessage.textContent = message;
        trayLeft.textContent = message;
    }
    setBusy(state === 'working');
    cancelSetupBtn.textContent = 'Back to till';
}

function fillSetup(config) {
    document.getElementById('laravelPath').value = config.laravelPath || '';
    document.getElementById('phpPath').value = config.phpPath || '';
    document.getElementById('cloudUrl').value = config.cloudUrl || '';
    const token = document.getElementById('cloudToken');
    token.value = '';
    token.placeholder = config.cloudToken
        ? 'Saved on this PC — type a new token to replace it'
        : 'Same DESKTOP_SYNC_TOKEN as the website .env';
}

function setupPayload() {
    return {
        laravelPath: document.getElementById('laravelPath').value.trim(),
        phpPath: document.getElementById('phpPath').value.trim(),
        cloudUrl: document.getElementById('cloudUrl').value.trim().replace(/\/+$/, ''),
        cloudToken: document.getElementById('cloudToken').value.trim(),
        printerName: printerSelect.value,
        restart: false,
    };
}

async function loadPrinters(selected) {
    const printers = await window.till.printers();
    printerSelect.innerHTML = '<option value="">System default</option>' + printers
        .map((printer) => `<option value="${printer.name}">${printer.name}${printer.isDefault ? ' (default)' : ''}</option>`)
        .join('');
    printerSelect.value = selected || '';
    trayMid.textContent = selected ? `Printer ${selected}` : 'Printer system default';
}

window.till.onStatus((payload) => {
    if (payload.lastSyncAt) {
        trayRight.textContent = `Last sync ${new Date(payload.lastSyncAt).toLocaleString()}`;
    }
    if (payload.phase === 'boot') {
        showSplash(payload.message);
    }
    if (payload.phase === 'setup') {
        showSetup();
        if (payload.config) {
            fillSetup(payload.config);
        }
        if (payload.sync) {
            setSyncBanner(payload.sync, payload.message);
        } else if (payload.message) {
            setSyncBanner('', payload.message);
        }
    }
    if (payload.phase === 'ready' && payload.sync !== 'ok') {
        showTill();
        setBusy(false);
    }
    if (payload.phase === 'error') {
        showSplash(payload.message);
        bootMessage.textContent = payload.message;
    }
    if (payload.config?.printerName) {
        loadPrinters(payload.config.printerName);
    }
    if (payload.packaged) {
        document.querySelectorAll('.dev-path').forEach((el) => el.classList.add('hidden'));
    }
});

document.getElementById('screens').addEventListener('click', (event) => {
    const button = event.target.closest('[data-screen]');
    if (!button) {
        return;
    }
    document.querySelectorAll('#screens button').forEach((item) => item.classList.toggle('active', item === button));
    window.till.openScreen(button.dataset.screen);
});

document.querySelector('.win').addEventListener('click', (event) => {
    const button = event.target.closest('[data-win]');
    if (button) {
        window.till.windowControl(button.dataset.win);
    }
});

document.getElementById('reloadBtn').addEventListener('click', async () => {
    trayLeft.textContent = 'Reloading…';
    try {
        await window.till.reloadUi();
        trayLeft.textContent = 'Reloaded — latest page loaded';
    } catch (error) {
        trayLeft.textContent = error.message || 'Reload failed';
    }
});

document.getElementById('cloudBtn').addEventListener('click', async () => {
    setSyncBanner('', 'Change the website URL or token, then pull again.');
    await window.till.openCloudSetup();
});

document.getElementById('syncBtn').addEventListener('click', async () => {
    showSetup();
    setSyncBanner('working', 'Syncing with cloud… downloading menu and users.');
    await window.till.openCloudSetup();
    const result = await window.till.syncNow();
    if (result && result.ok === false) {
        setSyncBanner('error', result.message || 'Sync failed.');
        return;
    }
    const products = Number(result?.pulled?.products || 0);
    const users = Number(result?.pulled?.users || 0);
    setSyncBanner('ok', `Complete. Loaded ${products} products and ${users} users. Click Back to till.`);
});

printerSelect.addEventListener('change', async () => {
    await window.till.setPrinter(printerSelect.value);
    trayMid.textContent = printerSelect.value ? `Printer ${printerSelect.value}` : 'Printer system default';
});

cancelSetupBtn.addEventListener('click', async () => {
    await window.till.closeCloudSetup();
});

saveSetupBtn.addEventListener('click', async () => {
    setSyncBanner('working', 'Saving settings…');
    await window.till.saveSetup(setupPayload());
    setSyncBanner('ok', 'Settings saved. Click Save & pull from cloud to load the menu.');
});

document.getElementById('importBtn').addEventListener('click', async () => {
    setSyncBanner('working', 'Importing menu from this PC…');
    try {
        await window.till.saveSetup(setupPayload());
        await window.till.importSource();
        showTill();
    } catch (error) {
        setSyncBanner('error', error.message);
    }
});

cloudPullBtn.addEventListener('click', async () => {
    setSyncBanner('working', 'Saving settings, then downloading the live menu…');
    try {
        await window.till.saveSetup(setupPayload());
        setSyncBanner('working', 'Connecting to the cloud… this can take up to 2 minutes.');
        const result = await window.till.syncNow();
        if (result && result.ok === false) {
            setSyncBanner('error', result.message || 'Pull failed');
            return;
        }
        const products = Number(result?.pulled?.products || 0);
        const users = Number(result?.pulled?.users || 0);
        setSyncBanner('ok', `Complete. Loaded ${products} products and ${users} users. Click Back to till.`);
    } catch (error) {
        setSyncBanner('error', error.message || 'Pull failed');
    }
});

window.addEventListener('online', setOnline);
window.addEventListener('offline', setOnline);
setOnline();

window.till.ready().then((result) => {
    if (result?.packaged) {
        document.querySelectorAll('.dev-path').forEach((el) => el.classList.add('hidden'));
    }
    if (result?.ok) {
        showTill();
    }
    loadPrinters();
});
