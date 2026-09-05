'use strict';

const fs = require('fs');
const path = require('path');
const extract = require('extract-zip');
const { downloadArtifact } = require('@electron/get');
const { version } = require('../node_modules/electron/package.json');

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron');
const distDir = path.join(electronDir, 'dist');

process.env.ELECTRON_MIRROR = process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';
console.log('Downloading Electron', version);

async function main() {
    const zipPath = await downloadArtifact({
        version,
        artifactName: 'electron',
        platform: process.platform,
        arch: process.arch,
        checksums: require('../node_modules/electron/checksums.json'),
    });
    fs.writeFileSync(path.join(electronDir, 'download-zip.txt'), String(zipPath || 'empty'));

    fs.mkdirSync(distDir, { recursive: true });
    const { spawnSync } = require('child_process');
    const unpacked = spawnSync('tar', ['-xf', zipPath, '-C', distDir], { stdio: 'inherit' });
    if (unpacked.status !== 0) {
        await extract(zipPath, { dir: distDir });
    }
    fs.writeFileSync(path.join(electronDir, 'path.txt'), process.platform === 'win32' ? 'electron.exe' : 'electron');
    fs.writeFileSync(path.join(electronDir, 'download-ok.txt'), version);
    console.log('Electron binary ready:', version);
    process.exit(0);
}

main().catch((error) => {
    console.error(error.stack || error);
    process.exit(1);
});
