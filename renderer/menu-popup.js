'use strict';

const panel = document.getElementById('panel');

function button(label, className, action, extra) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = className;
    el.textContent = label;
    el.addEventListener('click', () => window.menu.pick(action, extra));
    return el;
}

async function render() {
    const kind = window.menu.kind;
    if (kind === 'orders') {
        panel.append(
            button('Orders', 'nav-orders', 'orders'),
            button('KOT', 'nav-kot', 'kitchen'),
        );
        return;
    }
    if (kind === 'bills') {
        panel.append(
            button('Bills', 'nav-bills', 'reports'),
            button('Settings', 'nav-settings', 'settings'),
        );
        return;
    }
    if (kind === 'tools') {
        panel.append(
            button('Reload', 'ghost', 'reload'),
            button('Update', 'ghost', 'update'),
            button('Cloud', 'ghost', 'cloud'),
            button('Sync', 'gold', 'sync'),
        );
        return;
    }

    const kickerNet = document.createElement('p');
    kickerNet.className = 'kicker';
    kickerNet.textContent = 'Network';
    const copy = document.createElement('p');
    copy.className = 'copy';
    const badge = document.createElement('span');
    badge.className = `badge ${window.menu.online ? 'online' : 'offline'}`;
    badge.textContent = window.menu.online ? 'Online' : 'Offline';
    copy.append(badge);
    const kickerPrint = document.createElement('p');
    kickerPrint.className = 'kicker';
    kickerPrint.textContent = 'Receipt printer';
    panel.append(kickerNet, copy, kickerPrint);

    const printers = await window.menu.printers();
    const items = [{ name: '', label: 'System default' }, ...printers.map((printer) => ({
        name: printer.name,
        label: `${printer.name}${printer.isDefault ? ' (default)' : ''}`,
    }))];
    items.forEach((printer) => {
        const el = button(printer.label, 'ghost', 'printer', { printer: printer.name });
        el.style.textTransform = 'none';
        el.style.letterSpacing = '0';
        if ((printer.name || '') === (window.menu.printer || '')) {
            el.style.boxShadow = '0 0 0 2px rgba(243, 215, 160, .88)';
        }
        panel.append(el);
    });
}

render();
