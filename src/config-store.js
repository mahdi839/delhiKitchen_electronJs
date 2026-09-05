'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const FILE = () => path.join(app.getPath('userData'), 'till-config.json');

function defaults() {
    return {
        laravelPath: path.resolve(__dirname, '..', '..', 'delhi_kitchen_billing_software'),
        phpPath: '',
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
    try {
        const saved = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
        return { ...base, ...saved };
    } catch {
        return base;
    }
}

function save(next) {
    const current = { ...load(), ...next };
    fs.mkdirSync(path.dirname(FILE()), { recursive: true });
    fs.writeFileSync(FILE(), JSON.stringify(current, null, 2));
    return current;
}

module.exports = { load, save, defaults, filePath: FILE };
