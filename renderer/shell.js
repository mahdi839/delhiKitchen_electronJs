'use strict';

const netBadge = document.getElementById('netBadge');
const printerSelect = document.getElementById('printerSelect');
const stage = document.getElementById('stage');
const splashCard = document.getElementById('splashCard');
const setupCard = document.getElementById('setupCard');
const bootMessage = document.getElementById('bootMessage');
const setupMessage = document.getElementById('setupMessage');
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

function fillSetup(config) {
    document.getElementById('laravelPath').value = config.laravelPath || '';
    document.getElementById('phpPath').value = config.phpPath || '';
    document.getElementById('cloudUrl').value = config.cloudUrl || '';
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
    if (payload.message) {
        bootMessage.textContent = payload.message;
        setupMessage.textContent = payload.message;
        trayLeft.textContent = payload.message;
    }
    if (payload.lastSyncAt) {
        trayRight.textContent = `Last sync ${new Date(payload.lastSyncAt).toLocaleString()}`;
    }
    if (payload.phase === 'setup') {
        showSetup();
        if (payload.config) {
            fillSetup(payload.config);
        }
    }
    if (payload.phase === 'ready') {
        showTill();
    }
    if (payload.phase === 'error') {
        showSetup();
        setupMessage.textContent = payload.message;
    }
    if (payload.config?.printerName) {
        loadPrinters(payload.config.printerName);
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

document.getElementById('syncBtn').addEventListener('click', async () => {
    trayLeft.textContent = 'Syncing…';
    try {
        await window.till.syncNow();
        trayLeft.textContent = 'Cloud sync complete';
    } catch (error) {
        trayLeft.textContent = error.message || 'Sync failed — billing still works offline';
    }
});

printerSelect.addEventListener('change', async () => {
    await window.till.setPrinter(printerSelect.value);
    trayMid.textContent = printerSelect.value ? `Printer ${printerSelect.value}` : 'Printer system default';
});

document.getElementById('saveSetup').addEventListener('click', async () => {
    setupMessage.textContent = 'Saving…';
    await window.till.saveSetup({
        laravelPath: document.getElementById('laravelPath').value.trim(),
        phpPath: document.getElementById('phpPath').value.trim(),
        cloudUrl: document.getElementById('cloudUrl').value.trim(),
        cloudToken: document.getElementById('cloudToken').value.trim(),
        printerName: printerSelect.value,
    });
});

document.getElementById('importBtn').addEventListener('click', async () => {
    setupMessage.textContent = 'Importing menu from this PC…';
    try {
        await window.till.saveSetup({
            laravelPath: document.getElementById('laravelPath').value.trim(),
            phpPath: document.getElementById('phpPath').value.trim(),
            cloudUrl: document.getElementById('cloudUrl').value.trim(),
            cloudToken: document.getElementById('cloudToken').value.trim(),
            printerName: printerSelect.value,
        });
        await window.till.importSource();
        showTill();
    } catch (error) {
        setupMessage.textContent = error.message;
    }
});

document.getElementById('cloudPullBtn').addEventListener('click', async () => {
    setupMessage.textContent = 'Pulling catalog from the cloud…';
    try {
        await window.till.saveSetup({
            laravelPath: document.getElementById('laravelPath').value.trim(),
            phpPath: document.getElementById('phpPath').value.trim(),
            cloudUrl: document.getElementById('cloudUrl').value.trim(),
            cloudToken: document.getElementById('cloudToken').value.trim(),
            printerName: printerSelect.value,
        });
        await window.till.syncNow();
        await window.till.openScreen('pos');
        showTill();
    } catch (error) {
        setupMessage.textContent = error.message;
    }
});

window.addEventListener('online', setOnline);
window.addEventListener('offline', setOnline);
setOnline();

window.till.ready().then((result) => {
    if (result?.needsSetup) {
        showSetup();
    } else if (result?.ok) {
        showTill();
    }
    loadPrinters();
});
