'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const extra = path.join(root, 'extra', 'engine');
const laravelSrc = path.resolve(root, '..', 'delhi_kitchen_billing_software');
const phpDest = path.join(extra, 'php');
const laravelDest = path.join(extra, 'laravel');

function phpHome() {
    if (process.env.PHP_HOME && fs.existsSync(path.join(process.env.PHP_HOME, 'php.exe'))) {
        return process.env.PHP_HOME;
    }
    const probe = spawnSync('php', ['-r', 'echo PHP_BINARY;'], { encoding: 'utf8', windowsHide: true });
    const binary = String(probe.stdout || '').trim();
    if (binary && fs.existsSync(binary)) {
        return path.dirname(binary);
    }
    throw new Error('PHP 8.3 was not found. Install PHP or set PHP_HOME.');
}

function emptyDir(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
}

function copyPhp(src) {
    console.log('Copying PHP from', src);
    fs.cpSync(src, phpDest, {
        recursive: true,
        filter: (from) => {
            const name = path.basename(from).toLowerCase();
            if (name.endsWith('.pdb') || name === 'dev' || name === 'php.ini' || name.startsWith('php.ini-')) {
                return false;
            }
            return true;
        },
    });
    const cacertNames = ['cacert.pem', path.join('extras', 'ssl', 'cacert.pem')];
    for (const rel of cacertNames) {
        const file = path.join(src, rel);
        if (fs.existsSync(file)) {
            fs.copyFileSync(file, path.join(phpDest, 'cacert.pem'));
            break;
        }
    }
    copyVcRuntime(src);
    writeBundledPhpIni();
}

function copyVcRuntime(phpSrc) {
    const names = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'];
    const search = [
        phpSrc,
        path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'),
        path.join(process.env.SystemRoot || 'C:\\Windows', 'SysWOW64'),
    ];
    for (const name of names) {
        const dest = path.join(phpDest, name);
        if (fs.existsSync(dest)) {
            continue;
        }
        const src = search.map((dir) => path.join(dir, name)).find((file) => fs.existsSync(file));
        if (!src) {
            console.warn('Missing Visual C++ runtime DLL (client PCs may need the VC++ 2015-2022 x64 redistributable):', name);
            continue;
        }
        fs.copyFileSync(src, dest);
        console.log('Bundled', name);
    }
}

function writeBundledPhpIni() {
    const slash = (value) => value.replace(/\\/g, '/');
    const extDir = path.join(phpDest, 'ext');
    const cacert = path.join(phpDest, 'cacert.pem');
    const lines = [
        `extension_dir="${slash(extDir)}"`,
        'memory_limit=256M',
        'max_execution_time=90',
        'display_errors=0',
        'log_errors=1',
        'error_log="php-error.log"',
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
    fs.writeFileSync(path.join(phpDest, 'php.ini'), `${lines.join('\n')}\n`);
}

function skipLaravel(from) {
    try {
        if (fs.lstatSync(from).isSymbolicLink()) {
            return true;
        }
    } catch {
        return true;
    }
    const rel = path.relative(laravelSrc, from).replace(/\\/g, '/');
    if (!rel || rel === '.') {
        return false;
    }
    const top = rel.split('/')[0];
    if (['node_modules', '.git', 'tests', '.idea', '.vscode', 'storage'].includes(top)) {
        return true;
    }
    if (rel === 'public/hot' || rel.startsWith('public/hot') || rel === 'public/storage' || rel.startsWith('public/storage/')) {
        return true;
    }
    if (top === '.env' || rel.startsWith('.env')) {
        return true;
    }
    if (rel === 'config/telescope.php' || rel === 'app/Providers/TelescopeServiceProvider.php') {
        return true;
    }
    if (rel === 'vendor/laravel/telescope' || rel.startsWith('vendor/laravel/telescope/')) {
        return true;
    }
    if (rel.startsWith('bootstrap/cache/') && path.basename(from) !== '.gitignore') {
        return true;
    }
    if (/^preview-/i.test(path.basename(from))) {
        return true;
    }
    return false;
}

function copyLaravel() {
    if (!fs.existsSync(path.join(laravelSrc, 'artisan')) || !fs.existsSync(path.join(laravelSrc, 'vendor'))) {
        throw new Error(`Laravel project with vendor/ was not found at ${laravelSrc}`);
    }
    if (!fs.existsSync(path.join(laravelSrc, 'public', 'build', 'manifest.json'))) {
        throw new Error('Laravel frontend is not built. Run npm run build in delhi_kitchen_billing_software first.');
    }
    console.log('Copying Laravel engine from', laravelSrc);
    fs.cpSync(laravelSrc, laravelDest, {
        recursive: true,
        filter: (from) => !skipLaravel(from),
    });
    const storageDirs = [
        'storage/app/public',
        'storage/framework/cache/data',
        'storage/framework/sessions',
        'storage/framework/views',
        'storage/logs',
        'bootstrap/cache',
    ];
    for (const dir of storageDirs) {
        fs.mkdirSync(path.join(laravelDest, dir), { recursive: true });
        fs.writeFileSync(path.join(laravelDest, dir, '.gitignore'), "*\n!.gitignore\n");
    }
    for (const rel of [
        'vendor/laravel/telescope',
        'config/telescope.php',
        'app/Providers/TelescopeServiceProvider.php',
        'bootstrap/cache/packages.php',
        'bootstrap/cache/services.php',
        'bootstrap/cache/config.php',
    ]) {
        fs.rmSync(path.join(laravelDest, rel), { recursive: true, force: true });
    }
    hardenComposerJson();
    patchAppServiceProvider();
    rebuildAutoload();
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    fs.writeFileSync(
        path.join(laravelDest, 'desktop-engine-build.txt'),
        `${pkg.version}-${Date.now()}\n`,
        { encoding: 'utf8' },
    );
    const key = `base64:${crypto.randomBytes(32).toString('base64')}`;
    fs.writeFileSync(
        path.join(laravelDest, '.env'),
        [
            'APP_NAME="Delhi Kitchen Till"',
            'APP_ENV=production',
            'APP_DEBUG=false',
            `APP_KEY=${key}`,
            'APP_URL=http://127.0.0.1:8765',
            'DB_CONNECTION=sqlite',
            'CACHE_STORE=file',
            'SESSION_DRIVER=file',
            'QUEUE_CONNECTION=sync',
            'LOG_CHANNEL=single',
            'LOG_LEVEL=error',
            'TELESCOPE_ENABLED=false',
            'DESKTOP_MODE=true',
            '',
        ].join('\n'),
        { encoding: 'utf8' },
    );
}

function patchAppServiceProvider() {
    const file = path.join(laravelDest, 'app', 'Providers', 'AppServiceProvider.php');
    if (!fs.existsSync(file)) {
        return;
    }
    const source = fs.readFileSync(file, 'utf8');
    const next = source.replace(
        /public function register\(\): void\s*\{[\s\S]*?\n    \}/,
        'public function register(): void\n    {\n        // Telescope is not shipped with the desktop till.\n    }',
    );
    if (next !== source) {
        fs.writeFileSync(file, next);
    }
}

function rebuildAutoload() {
    console.log('Installing production Composer packages…');
    for (const rel of ['bootstrap/cache/packages.php', 'bootstrap/cache/services.php']) {
        fs.rmSync(path.join(laravelDest, rel), { force: true });
    }
    const result = spawnSync('composer', ['install', '--no-dev', '--optimize-autoloader', '--no-interaction', '--prefer-dist'], {
        cwd: laravelDest,
        encoding: 'utf8',
        windowsHide: true,
        shell: true,
    });
    if (result.status !== 0) {
        throw new Error((result.stderr || result.stdout || 'composer install --no-dev failed').trim());
    }
}

function hardenComposerJson() {
    const file = path.join(laravelDest, 'composer.json');
    if (!fs.existsSync(file)) {
        return;
    }
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    json.extra = json.extra || {};
    json.extra.laravel = json.extra.laravel || {};
    const skip = new Set(json.extra.laravel['dont-discover'] || []);
    skip.add('laravel/telescope');
    skip.add('laravel/pail');
    skip.add('laravel/pao');
    skip.add('laravel/sentinel');
    json.extra.laravel['dont-discover'] = [...skip];
    fs.writeFileSync(file, `${JSON.stringify(json, null, 4)}\n`);
}

function verifyPhp() {
    const php = path.join(phpDest, process.platform === 'win32' ? 'php.exe' : 'php');
    const ini = path.join(phpDest, 'php.ini');
    const probe = spawnSync(php, ['-c', ini, '-r', 'echo (extension_loaded("openssl") && extension_loaded("pdo_sqlite") && extension_loaded("mbstring")) ? "ok" : "missing";'], {
        encoding: 'utf8',
        windowsHide: true,
    });
    if (String(probe.stdout || '').trim() !== 'ok') {
        throw new Error(`Bundled PHP failed extension check: ${(probe.stdout || '')} ${(probe.stderr || '')}`.trim());
    }
    console.log('Bundled PHP extensions OK');
}

function main() {
    emptyDir(extra);
    copyPhp(phpHome());
    copyLaravel();
    verifyPhp();
    console.log('Engine staged at', extra);
}

main();
