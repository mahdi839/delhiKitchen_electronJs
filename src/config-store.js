'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const FILE = () => path.join(app.getPath('userData'), 'till-config.json');

function bundledEngine() {
    const packaged = path.join(process.resourcesPath || '', 'engine');
    const extra = path.join(__dirname, '..', 'extra', 'engine');
    const root = app.isPackaged ? packaged : extra;
    const laravelPath = path.join(root, 'laravel');
    const phpPath = path.join(root, 'php', process.platform === 'win32' ? 'php.exe' : 'php');
    if (fs.existsSync(path.join(laravelPath, 'artisan')) && fs.existsSync(phpPath)) {
        return { laravelPath, phpPath };
    }
    return null;
}

function defaults() {
    const bundled = bundledEngine();
    return {
        laravelPath: bundled?.laravelPath || path.resolve(__dirname, '..', '..', 'delhi_kitchen_billing_software'),
        phpPath: bundled?.phpPath || '',
        cloudUrl: '',
        cloudToken: '',
        printerName: '',
        loopbackToken: '',
        lastSyncAt: null,
        setupDone: false,
    };
}

function load() {
    const base = defaults();
    let saved = {};
    try {
        saved = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    } catch {
        saved = {};
    }
    const current = { ...base, ...saved };
    const bundled = bundledEngine();
    if (bundled) {
        current.laravelPath = bundled.laravelPath;
        current.phpPath = bundled.phpPath;
    }
    return current;
}

function save(next) {
    const current = { ...load(), ...next };
    const bundled = bundledEngine();
    if (bundled) {
        current.laravelPath = bundled.laravelPath;
        current.phpPath = bundled.phpPath;
    }
    fs.mkdirSync(path.dirname(FILE()), { recursive: true });
    fs.writeFileSync(FILE(), JSON.stringify(current, null, 2));
    return current;
}

module.exports = { load, save, defaults, bundledEngine, filePath: FILE };
