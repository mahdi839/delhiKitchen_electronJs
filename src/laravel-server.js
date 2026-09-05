'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { parseEnvFile } = require('./env-file');

const PORT_START = 8765;
const PORT_END = 8780;

let child = null;
let port = PORT_START;
let hotBackup = null;

function findPhp(preferred) {
    const candidates = [
        preferred,
        process.env.PHP_BINARY,
        'D:\\laragon\\bin\\php\\php-8.3.30-Win32-vs16-x64\\php.exe',
        'C:\\laragon\\bin\\php\\php.exe',
        'C:\\xampp\\php\\php.exe',
        'php',
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (candidate !== 'php' && !fs.existsSync(candidate)) {
            continue;
        }
        return candidate;
    }

    return 'php';
}

function assertLaravel(laravelPath) {
    const artisan = path.join(laravelPath, 'artisan');
    const publicIndex = path.join(laravelPath, 'public', 'index.php');
    if (!fs.existsSync(artisan) || !fs.existsSync(publicIndex)) {
        throw new Error(`Laravel project not found at ${laravelPath}`);
    }
}

function sqlitePath(userData) {
    return path.join(userData, 'delhi-kitchen-till.sqlite');
}

function desktopEnv(laravelPath, userData, config) {
    const source = parseEnvFile(path.join(laravelPath, '.env'));
    const database = sqlitePath(userData);
    if (!fs.existsSync(database)) {
        fs.writeFileSync(database, '');
    }

    return {
        APP_NAME: 'Delhi Kitchen Till',
        APP_ENV: 'production',
        APP_DEBUG: 'false',
        APP_KEY: source.APP_KEY || '',
        APP_URL: `http://127.0.0.1:${port}`,
        APP_LOCALE: source.APP_LOCALE || 'en',
        DB_CONNECTION: 'sqlite',
        DB_DATABASE: database,
        DB_URL: '',
        CACHE_STORE: 'file',
        SESSION_DRIVER: 'file',
        SESSION_LIFETIME: source.SESSION_LIFETIME || '43200',
        QUEUE_CONNECTION: 'sync',
        BROADCAST_CONNECTION: 'log',
        FILESYSTEM_DISK: source.FILESYSTEM_DISK || 'local',
        LOG_CHANNEL: 'single',
        LOG_LEVEL: 'error',
        TELESCOPE_ENABLED: 'false',
        DESKTOP_MODE: 'true',
        DESKTOP_LOOPBACK_TOKEN: config.loopbackToken,
        DESKTOP_SYNC_TOKEN: config.cloudToken || source.DESKTOP_SYNC_TOKEN || config.loopbackToken,
        DESKTOP_CLOUD_URL: config.cloudUrl || source.DESKTOP_CLOUD_URL || '',
        DESKTOP_CLOUD_TOKEN: config.cloudToken || source.DESKTOP_CLOUD_TOKEN || '',
        DESKTOP_SOURCE_HOST: source.DB_HOST || '127.0.0.1',
        DESKTOP_SOURCE_PORT: source.DB_PORT || '3306',
        DESKTOP_SOURCE_DATABASE: source.DB_DATABASE || '',
        DESKTOP_SOURCE_USERNAME: source.DB_USERNAME || 'root',
        DESKTOP_SOURCE_PASSWORD: source.DB_PASSWORD || '',
    };
}

function runArtisan(phpPath, laravelPath, args, env) {
    return new Promise((resolve, reject) => {
        const proc = spawn(phpPath, ['artisan', ...args], {
            cwd: laravelPath,
            env: { ...process.env, ...env },
            windowsHide: true,
        });
        let stderr = '';
        proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        proc.on('error', reject);
        proc.on('close', (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(stderr.trim() || `php artisan ${args.join(' ')} failed (${code})`));
        });
    });
}

function waitForHealth(targetPort, timeoutMs = 25000) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
        const ping = () => {
            const req = http.get({ host: '127.0.0.1', port: targetPort, path: '/up', timeout: 1500 }, (res) => {
                res.resume();
                if (res.statusCode && res.statusCode < 500) {
                    resolve();
                    return;
                }
                retry();
            });
            req.on('error', retry);
            req.on('timeout', () => { req.destroy(); retry(); });
        };
        const retry = () => {
            if (Date.now() - started > timeoutMs) {
                reject(new Error('Local billing engine did not start in time.'));
                return;
            }
            setTimeout(ping, 400);
        };
        ping();
    });
}

function pauseViteHot(laravelPath) {
    const hot = path.join(laravelPath, 'public', 'hot');
    if (fs.existsSync(hot)) {
        hotBackup = `${hot}.desktop-bak`;
        fs.renameSync(hot, hotBackup);
    }
}

function restoreViteHot() {
    if (hotBackup && fs.existsSync(hotBackup)) {
        fs.renameSync(hotBackup, hotBackup.replace(/\.desktop-bak$/, ''));
        hotBackup = null;
    }
}

function stopServer() {
    restoreViteHot();
    if (!child || !child.pid) {
        child = null;
        return;
    }
    if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
        child.kill('SIGTERM');
    }
    child = null;
}

async function startServer({ laravelPath, phpPath, userData, config, onLog }) {
    stopServer();
    assertLaravel(laravelPath);
    const php = findPhp(phpPath);
    const env = desktopEnv(laravelPath, userData, config);
    if (!env.APP_KEY) {
        throw new Error('Laravel .env is missing APP_KEY. Open the website project once so it can generate a key.');
    }

    pauseViteHot(laravelPath);
    onLog?.('Preparing local SQLite database…');
    await runArtisan(php, laravelPath, ['migrate', '--force'], env);

    port = PORT_START;
    const tryListen = async () => {
        onLog?.(`Starting billing engine on port ${port}…`);
        return new Promise((resolve, reject) => {
            const proc = spawn(php, ['artisan', 'serve', `--host=127.0.0.1`, `--port=${port}`], {
                cwd: laravelPath,
                env: { ...process.env, ...env, APP_URL: `http://127.0.0.1:${port}` },
                windowsHide: true,
            });
            let booted = false;
            proc.on('error', reject);
            proc.stderr.on('data', (chunk) => {
                const text = chunk.toString();
                if (text.toLowerCase().includes('address already in use') && port < PORT_END) {
                    port += 1;
                    proc.kill();
                    tryListen().then(resolve).catch(reject);
                }
            });
            proc.stdout.on('data', (chunk) => {
                if (!booted && /started/i.test(chunk.toString())) {
                    booted = true;
                }
            });
            child = proc;
            waitForHealth(port).then(resolve).catch(reject);
        });
    };

    await tryListen();
    return { port, url: `http://127.0.0.1:${port}`, php };
}

function currentUrl() {
    return `http://127.0.0.1:${port}`;
}

function loopbackHeaders(token) {
    return {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Desktop-Token': token,
    };
}

function requestJson(pathname, { method = 'GET', token, body } = {}) {
    const payload = body ? JSON.stringify(body) : null;
    const url = new URL(pathname, currentUrl());
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: url.hostname,
            port: url.port,
            path: url.pathname,
            method,
            headers: {
                ...loopbackHeaders(token),
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
            },
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                let json = {};
                try { json = data ? JSON.parse(data) : {}; } catch { json = { message: data }; }
                if (res.statusCode >= 400) {
                    reject(new Error(json.message || `Request failed (${res.statusCode})`));
                    return;
                }
                resolve(json);
            });
        });
        req.on('error', reject);
        if (payload) {
            req.write(payload);
        }
        req.end();
    });
}

module.exports = {
    findPhp,
    sqlitePath,
    startServer,
    stopServer,
    currentUrl,
    requestJson,
};
