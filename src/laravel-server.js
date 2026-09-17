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
    if (preferred) {
        const resolved = path.resolve(preferred);
        if (fs.existsSync(resolved)) {
            return resolved;
        }
        throw new Error('Bundled PHP was not found. Reinstall Delhi Kitchen Till.');
    }
    if (process.env.PHP_BINARY && fs.existsSync(process.env.PHP_BINARY)) {
        return path.resolve(process.env.PHP_BINARY);
    }
    return 'php';
}

function phpIniLines(phpPath, errorLog) {
    const phpDir = path.dirname(phpPath);
    const extDir = path.join(phpDir, 'ext');
    const slash = (value) => value.replace(/\\/g, '/');
    const cacert = path.join(phpDir, 'cacert.pem');
    const lines = [
        `extension_dir="${slash(extDir)}"`,
        'memory_limit=256M',
        'max_execution_time=90',
        'display_errors=0',
        'log_errors=1',
        `error_log="${slash(errorLog)}"`,
        'date.timezone=UTC',
        'extension=curl',
        'extension=fileinfo',
        'extension=gd',
        'extension=intl',
        'extension=mbstring',
        'extension=mysqli',
        'extension=openssl',
        'extension=pdo_mysql',
        'extension=pdo_sqlite',
        'extension=sqlite3',
        'extension=zip',
    ];
    if (fs.existsSync(cacert)) {
        lines.push(`curl.cainfo="${slash(cacert)}"`, `openssl.cafile="${slash(cacert)}"`);
    }
    return lines.join('\n') + '\n';
}

function writePhpIni(phpPath, userData) {
    const phpDir = path.dirname(phpPath);
    const extDir = path.join(phpDir, 'ext');
    if (!fs.existsSync(extDir)) {
        return null;
    }
    const contents = phpIniLines(phpPath, path.join(userData, 'php-error.log'));
    const iniPath = path.join(userData, 'php.ini');
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(iniPath, contents);
    try {
        fs.writeFileSync(path.join(phpDir, 'php.ini'), contents);
    } catch {
        // Program Files may be read-only; -c userData/php.ini is enough.
    }
    return iniPath;
}

function phpCliArgs(phpPath, userData, args) {
    const ini = writePhpIni(phpPath, userData);
    return ini ? ['-c', ini, ...args] : args;
}

function ensureStorage(laravelPath) {
    for (const dir of [
        'storage/app/public',
        'storage/framework/cache/data',
        'storage/framework/sessions',
        'storage/framework/views',
        'storage/logs',
        'bootstrap/cache',
    ]) {
        fs.mkdirSync(path.join(laravelPath, dir), { recursive: true });
    }
}

function engineBuildId(laravelPath) {
    const file = path.join(laravelPath, 'desktop-engine-build.txt');
    if (!fs.existsSync(file)) {
        return '';
    }
    return fs.readFileSync(file, 'utf8').trim();
}

function ensureWritableLaravel(laravelPath, userData) {
    ensureStorage(laravelPath);
    const probe = path.join(laravelPath, 'storage', 'logs', '.write-test');
    try {
        fs.writeFileSync(probe, 'ok');
        fs.unlinkSync(probe);
        return laravelPath;
    } catch {
        const dest = path.join(userData, 'engine');
        const srcBuild = engineBuildId(laravelPath);
        const destBuild = engineBuildId(dest);
        const needsCopy = !fs.existsSync(path.join(dest, 'artisan')) || (srcBuild !== '' && srcBuild !== destBuild);
        if (needsCopy) {
            fs.rmSync(dest, { recursive: true, force: true });
            fs.cpSync(laravelPath, dest, { recursive: true });
        }
        ensureStorage(dest);
        return dest;
    }
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
        DB_DATABASE: database.replace(/\\/g, '/'),
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

function toEnvLine(key, value) {
    const text = String(value ?? '');
    if (text === '') {
        return `${key}=`;
    }
    if (/[\s#"'$]/.test(text)) {
        return `${key}="${text.replace(/"/g, '\\"')}"`;
    }
    return `${key}=${text}`;
}

function writeDesktopEnv(laravelPath, env) {
    const body = Object.entries(env).map(([key, value]) => toEnvLine(key, value)).join('\n');
    fs.writeFileSync(path.join(laravelPath, '.env'), `${body}\n`);
}

function disableTelescopeArtifacts(laravelPath) {
    for (const rel of [
        'bootstrap/cache/packages.php',
        'bootstrap/cache/services.php',
        'bootstrap/cache/config.php',
    ]) {
        const file = path.join(laravelPath, rel);
        if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('Telescope')) {
            fs.unlinkSync(file);
        }
    }
}

function writeServerRouter(laravelPath, userData) {
    const publicDir = path.join(laravelPath, 'public').replace(/\\/g, '/');
    const router = path.join(userData, 'desktop-server.php');
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(router, `<?php
$publicPath = ${JSON.stringify(publicDir)};
chdir($publicPath);
$uri = urldecode(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/');
if ($uri !== '/' && file_exists($publicPath.$uri) && !is_dir($publicPath.$uri)) {
    return false;
}
require $publicPath.'/index.php';
`);
    return router;
}

function phpProcessEnv(phpPath, userData, env) {
    const iniDir = writePhpIni(phpPath, userData) ? userData : path.dirname(phpPath);
    return {
        ...process.env,
        ...env,
        PHPRC: iniDir,
        PHP_INI_SCAN_DIR: '',
    };
}

function runArtisan(phpPath, laravelPath, args, env, userData) {
    return new Promise((resolve, reject) => {
        const proc = spawn(phpPath, phpCliArgs(phpPath, userData, ['artisan', ...args]), {
            cwd: laravelPath,
            env: phpProcessEnv(phpPath, userData, env),
            windowsHide: true,
        });
        let output = '';
        proc.stdout.on('data', (chunk) => { output += chunk.toString(); });
        proc.stderr.on('data', (chunk) => { output += chunk.toString(); });
        proc.on('error', reject);
        proc.on('close', (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(output.trim() || `php artisan ${args.join(' ')} failed (${code})`));
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
    laravelPath = path.resolve(laravelPath);
    assertLaravel(laravelPath);
    const php = findPhp(phpPath);
    laravelPath = ensureWritableLaravel(laravelPath, userData);
    disableTelescopeArtifacts(laravelPath);
    const env = desktopEnv(laravelPath, userData, config);
    if (!env.APP_KEY) {
        throw new Error('Laravel .env is missing APP_KEY. Open the website project once so it can generate a key.');
    }
    writeDesktopEnv(laravelPath, env);

    pauseViteHot(laravelPath);
    onLog?.('Preparing local SQLite database…');
    await runArtisan(php, laravelPath, ['migrate', '--force'], env, userData);

    const publicDir = path.join(laravelPath, 'public');
    const router = writeServerRouter(laravelPath, userData);
    if (!fs.existsSync(path.join(publicDir, 'index.php'))) {
        throw new Error('Laravel public server files are missing. Reinstall Delhi Kitchen Till.');
    }

    port = PORT_START;
    const tryListen = async () => {
        onLog?.(`Starting billing engine on port ${port}…`);
        env.APP_URL = `http://127.0.0.1:${port}`;
        writeDesktopEnv(laravelPath, env);
        return new Promise((resolve, reject) => {
            const proc = spawn(php, phpCliArgs(php, userData, ['-S', `127.0.0.1:${port}`, '-t', publicDir, router]), {
                cwd: publicDir,
                env: phpProcessEnv(php, userData, env),
                windowsHide: true,
            });
            let settled = false;
            let healthStarted = false;
            const finish = (fn, value) => {
                if (settled) {
                    return;
                }
                settled = true;
                fn(value);
            };
            const startHealth = () => {
                if (healthStarted || settled) {
                    return;
                }
                healthStarted = true;
                waitForHealth(port).then(() => finish(resolve)).catch((error) => finish(reject, error));
            };
            const onServerText = (chunk) => {
                const text = chunk.toString();
                if (/already in use/i.test(text) && port < PORT_END) {
                    port += 1;
                    proc.kill();
                    if (!settled) {
                        settled = true;
                        tryListen().then(resolve).catch(reject);
                    }
                    return;
                }
                if (/started|listening/i.test(text)) {
                    startHealth();
                }
            };
            proc.on('error', (error) => finish(reject, error));
            proc.stderr.on('data', onServerText);
            proc.stdout.on('data', onServerText);
            child = proc;
            setTimeout(startHealth, 1500);
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

function requestJson(pathname, { method = 'GET', token, body, timeoutMs = 150000 } = {}) {
    const payload = body ? JSON.stringify(body) : null;
    const url = new URL(pathname, currentUrl());
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: url.hostname,
            port: url.port,
            path: url.pathname,
            method,
            timeout: timeoutMs,
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
                    let message = String(json.message || '').trim();
                    const looksHtml = /<\/?[a-z][\s\S]*>/i.test(message) || /<\/?[a-z][\s\S]*>/i.test(data);
                    if (!message || looksHtml) {
                        message = `Till request failed (HTTP ${res.statusCode}).`;
                    }
                    if (message.length > 400) {
                        message = `${message.slice(0, 397)}...`;
                    }
                    reject(new Error(message));
                    return;
                }
                resolve(json);
            });
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Cloud sync timed out. Check internet, the website URL, and DESKTOP_SYNC_TOKEN.'));
        });
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
