'use strict';

const netBadge = document.getElementById('netBadge');
const printerSelect = document.getElementById('printerSelect');
const printerLabel = document.getElementById('printerLabel');
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
    const label = online ? 'Online' : 'Offline';
    netBadge.textContent = label;
    netBadge.className = `badge ${online ? 'online' : 'offline'}`;
}

function printerText(name) {
    return name ? `Printer ${name}` : 'Printer system default';
}

function setPrinterLabel(name) {
    if (printerLabel) {
        printerLabel.textContent = name || 'System default';
        printerLabel.title = name || 'System default';
    }
    trayMid.textContent = printerText(name);
}

const DROP_SCREENS = {
    orders: ['orders', 'kitchen'],
    bills: ['reports', 'settings'],
};

function setNavActive(screen) {
    document.querySelectorAll('#screens [data-screen]').forEach((item) => {
        item.classList.toggle('active', item.dataset.screen === screen);
    });
    document.querySelectorAll('#screens .nav-drop').forEach((drop) => {
        const screens = DROP_SCREENS[drop.dataset.drop] || [];
        drop.querySelector('.nav-drop-btn')?.classList.toggle('active', screens.includes(screen));
    });
}

function openChromeMenu(kind, trigger, align) {
    const rect = trigger.getBoundingClientRect();
    window.till.openChromeMenu({
        kind,
        x: align === 'right' ? rect.right : rect.left,
        y: rect.bottom + 8,
        align,
        online: navigator.onLine,
    });
}

async function runReload() {
    trayLeft.textContent = 'Reloading…';
    try {
        await window.till.reloadUi();
        trayLeft.textContent = 'Reloaded — latest page loaded';
    } catch (error) {
        trayLeft.textContent = error.message || 'Reload failed';
    }
}

async function runUpdate() {
    trayLeft.textContent = 'Checking for updates…';
    try {
        const result = await window.till.checkUpdate();
        trayLeft.textContent = result?.message || (result?.ok ? 'Up to date' : 'Update failed');
    } catch (error) {
        trayLeft.textContent = error.message || 'Update failed';
    }
}

async function runCloud() {
    setSyncBanner('', 'Change the website URL or token, then pull again.');
    await window.till.openCloudSetup();
}

async function runSync() {
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
    setPrinterLabel(selected);
}

window.till.onStatus((payload) => {
    if (payload.lastSyncAt) {
        trayRight.textContent = `Last sync ${new Date(payload.lastSyncAt).toLocaleString()}`;
    }
    if (payload.message) {
        trayLeft.textContent = payload.message;
    }
    if (payload.phase === 'boot') {
        showSplash(payload.message);
        document.getElementById('screens')?.classList.add('is-disabled');
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
        document.getElementById('screens')?.classList.remove('is-disabled');
    }
    if (payload.phase === 'error') {
        showSplash(payload.message);
        bootMessage.textContent = payload.message;
        document.getElementById('screens')?.classList.remove('is-disabled');
    }
    if (payload.config?.printerName !== undefined) {
        loadPrinters(payload.config.printerName);
    }
    if (payload.packaged) {
        document.querySelectorAll('.dev-path').forEach((el) => el.classList.add('hidden'));
    }
});

document.getElementById('screens').addEventListener('click', (event) => {
    const menuBtn = event.target.closest('[data-menu]');
    if (menuBtn) {
        openChromeMenu(menuBtn.dataset.menu, menuBtn);
        return;
    }
    const button = event.target.closest('[data-screen]');
    if (!button) {
        return;
    }
    setNavActive(button.dataset.screen);
    window.till.openScreen(button.dataset.screen);
});

document.getElementById('statusBtn').addEventListener('click', (event) => {
    event.stopPropagation();
    openChromeMenu('status', event.currentTarget, 'right');
});

document.getElementById('toolsBtn').addEventListener('click', (event) => {
    event.stopPropagation();
    openChromeMenu('tools', event.currentTarget, 'right');
});

window.till.onMenuAction((payload) => {
    if (payload?.type === 'screen' && payload.screen) {
        setNavActive(payload.screen);
        window.till.openScreen(payload.screen);
        return;
    }
    if (payload?.type === 'reload') {
        runReload();
        return;
    }
    if (payload?.type === 'update') {
        runUpdate();
        return;
    }
    if (payload?.type === 'cloud') {
        runCloud();
        return;
    }
    if (payload?.type === 'sync') {
        runSync();
    }
});

document.querySelector('.win').addEventListener('click', (event) => {
    const button = event.target.closest('[data-win]');
    if (button) {
        window.till.windowControl(button.dataset.win);
    }
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
        document.getElementById('screens')?.classList.remove('is-disabled');
    }
    loadPrinters();
});
