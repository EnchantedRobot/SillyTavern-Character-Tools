// index.js
// SillyTavern Character Tools — extension entry point.
//
// One panel drives the whole suite. "Fix Characters" repairs/upgrades each card
// and compresses its image — one write per card — and deliberately leaves tags
// alone. Merging tags is a separate operation: you curate the dictionary in the
// Edit Tag Dictionary editor and hit "Apply Tags" there to write the merge onto
// your cards. "Compress Images" is the user/images sidecar. The tag dictionary
// is owned here (persisted in extension settings, seeded from the shipped
// tag-dictionary.json) and passed to the server only on an Apply Tags run; the
// server holds none of its own, so editing tags never needs a server restart.

import { openModal } from './ui-editor.js';
import { probePlugin, fetchUsers, fetchStats, runJob, fetchCharacterTags } from './api.js';

const MODULE_NAME = '[Character Tools]';
const PANEL_ID = 'sct-panel';
export const EXT_KEY = 'CharacterTools';

// ── Tag dictionary (extension-owned) ─────────────────────────────────────────

/**
 * Return the extension's persisted settings, initialising defaults on first
 * access. The dictionary ({ canonical: [variant…] } + removedTags) is the
 * source of truth the server is handed each run.
 */
export function getExtSettings() {
    const { extensionSettings, saveSettingsDebounced } = SillyTavern.getContext();
    if (!extensionSettings[EXT_KEY]) {
        extensionSettings[EXT_KEY] = {};
        saveSettingsDebounced?.();
    }
    const s = extensionSettings[EXT_KEY];
    if (typeof s.mapping !== 'object' || s.mapping === null) s.mapping = {};
    if (!Array.isArray(s.removedTags)) s.removedTags = [];
    return s;
}

/** Persist the working dictionary (mapping + removed tags) back to settings. */
export function saveDictionary(mapping, removedTags) {
    const s = getExtSettings();
    s.mapping = mapping;
    s.removedTags = removedTags;
    SillyTavern.getContext().saveSettingsDebounced?.();
}

const BASE_FILE = 'tag-dictionary.json';

/** Fetch the shipped base dictionary (used to seed empty settings / reset). */
export async function loadBaseDictionary() {
    try {
        const res = await fetch(new URL(`./${BASE_FILE}`, import.meta.url));
        if (!res.ok) return null;
        const json = await res.json();
        const flat = {};
        const canonicalCategories = {};
        const categoryOrder = Object.keys(json?.mapping ?? {});
        for (const [cat, canonicals] of Object.entries(json?.mapping ?? {})) {
            for (const [canonical, aliases] of Object.entries(canonicals)) {
                flat[canonical] = Array.isArray(aliases) ? aliases : [];
                canonicalCategories[canonical] = cat;
            }
        }
        return {
            mapping: flat,
            removedTags: Array.isArray(json?.removedTags) ? json.removedTags : [],
            canonicalCategories,
            categoryOrder,
        };
    } catch (e) {
        console.error(MODULE_NAME, `failed to load ${BASE_FILE}`, e);
        return null;
    }
}

/**
 * Return the user's dictionary, seeding it from the shipped base the first time
 * the extension is used. Always loads category metadata from the base file.
 */
async function ensureDictionary() {
    const s = getExtSettings();
    const base = await loadBaseDictionary();
    if (Object.keys(s.mapping).length === 0 && s.removedTags.length === 0 && base) {
        s.mapping = base.mapping;
        s.removedTags = base.removedTags;
        SillyTavern.getContext().saveSettingsDebounced?.();
    }
    return {
        mapping: s.mapping,
        removedTags: s.removedTags,
        canonicalCategories: base?.canonicalCategories ?? {},
        categoryOrder: base?.categoryOrder ?? [],
        baseMapping: base?.mapping ?? {},
        baseRemovedTags: base?.removedTags ?? [],
    };
}

/** The dictionary to hand the server for a character run, or undefined if empty. */
function getRunDictionary() {
    const s = getExtSettings();
    const hasMapping = Object.keys(s.mapping).length > 0;
    if (!hasMapping && s.removedTags.length === 0) return undefined;
    return { mapping: s.mapping, removedTags: s.removedTags };
}

// ── Formatting ───────────────────────────────────────────────────────────────

function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ── Panel ────────────────────────────────────────────────────────────────────

function buildPanel(users) {
    const options = users.map(u => `<option value="${u}">${u}</option>`).join('');
    const div = document.createElement('div');
    div.id = PANEL_ID;
    div.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Character Tools</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <p class="sct-desc" style="font-size:12px; opacity:0.8; margin:0 0 10px;">Repair cards and compress images across a user's library. <b>Fix Characters</b> repairs and compresses (it never changes tags); to merge tags, open <b>Edit Tag Dictionary</b> and hit <b>Apply Tags</b>.</p>
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
                    <label for="sct-user" style="white-space:nowrap; font-size:13px;">User</label>
                    <select id="sct-user" class="text_pole" style="flex:1;">${options}</select>
                    <div id="sct-refresh" class="menu_button" title="Refresh user list" style="padding:4px 9px;">
                        <i class="fa-solid fa-rotate-right"></i>
                    </div>
                </div>
                <div id="sct-fix" class="menu_button" style="width:100%; text-align:center; margin-bottom:8px;">
                    <i class="fa-solid fa-wand-magic-sparkles"></i>&nbsp;&nbsp;Fix Characters
                </div>
                <div id="sct-edit" class="menu_button" style="width:100%; text-align:center; margin-bottom:12px;">
                    <i class="fa-solid fa-tags"></i>&nbsp;&nbsp;Edit Tag Dictionary
                </div>
                <div style="display:flex; gap:8px; margin-bottom:8px;">
                    <div id="sct-compress" class="menu_button" style="flex:1; text-align:center;">
                        <i class="fa-solid fa-compress"></i>&nbsp;&nbsp;Compress Images
                    </div>
                    <div id="sct-stats" class="menu_button" style="flex:1; text-align:center;">
                        <i class="fa-solid fa-chart-pie"></i>&nbsp;&nbsp;Stats
                    </div>
                </div>
                <div style="display:flex; gap:8px; margin-bottom:12px;">
                    <div id="sct-reprocess-chars" class="menu_button" style="flex:1; text-align:center; font-size:12px;">
                        <i class="fa-solid fa-rotate"></i>&nbsp;&nbsp;Reprocess Characters
                    </div>
                    <div id="sct-reprocess-images" class="menu_button" style="flex:1; text-align:center; font-size:12px;">
                        <i class="fa-solid fa-rotate"></i>&nbsp;&nbsp;Reprocess Images
                    </div>
                </div>
                <div id="sct-progress-wrap" style="display:none; margin-bottom:8px;">
                    <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
                        <span id="sct-progress-label">Scanning...</span>
                        <span id="sct-progress-pct">0%</span>
                    </div>
                    <div style="background:rgba(255,255,255,0.1); border-radius:3px; height:6px; overflow:hidden;">
                        <div id="sct-bar" style="height:100%; width:0%; background:var(--SmartThemeBodyColor,#4a9eff); transition:width 0.4s ease;"></div>
                    </div>
                </div>
                <pre id="sct-log" style="display:none; font-size:11px; background:rgba(0,0,0,0.25); border-radius:4px; padding:8px; max-height:140px; overflow-y:auto; white-space:pre-wrap; margin:0; font-family:monospace;"></pre>
            </div>
        </div>
    `;
    return div;
}

const BUTTON_IDS = ['sct-fix', 'sct-edit', 'sct-compress', 'sct-stats', 'sct-reprocess-chars', 'sct-reprocess-images', 'sct-refresh'];

function setRunning(running) {
    for (const id of BUTTON_IDS) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.style.pointerEvents = running ? 'none' : '';
        el.style.opacity = running ? '0.5' : '';
    }
}

const LOG_MAX_LINES = 100;

function appendLog(msg) {
    const el = document.getElementById('sct-log');
    if (!el) return;
    el.style.display = 'block';
    const lines = el.textContent ? el.textContent.split('\n') : [];
    lines.push(msg);
    if (lines.length > LOG_MAX_LINES) {
        const dropped = lines.length - LOG_MAX_LINES;
        lines.splice(0, dropped);
        lines.unshift(`... (${dropped} earlier lines hidden)`);
    }
    el.textContent = lines.join('\n');
    el.scrollTop = el.scrollHeight;
}

// ── Stats display ─────────────────────────────────────────────────────────────

const STATS_TYPE_ORDER = ['png', 'jpg', 'gif', 'webp', 'other'];

function appendDirStats(label, stats) {
    appendLog(`${label}: ${stats.totalFiles.toLocaleString()} files, ${formatBytes(stats.totalBytes)}`);
    for (const type of STATS_TYPE_ORDER) {
        const t = stats.byType[type];
        if (t.count === 0) continue;
        appendLog(`  ${type.padEnd(5)} ${String(t.count).padStart(6)}  ${formatBytes(t.bytes)}`);
    }
}

function appendAllStats(stats) {
    appendLog('Images (user/images/):');
    appendDirStats('  Total', stats.images);
    appendLog('');
    appendLog('Characters:');
    appendDirStats('  Total', stats.characters);
}

async function runStats() {
    const user = document.getElementById('sct-user')?.value;
    if (!user) return;

    const log = document.getElementById('sct-log');
    log.textContent = '';
    log.style.display = 'none';
    document.getElementById('sct-progress-wrap').style.display = 'none';
    setRunning(true);

    try {
        appendAllStats(await fetchStats(user));
    } catch (err) {
        appendLog(`Error: ${err.message}`);
        console.error(MODULE_NAME, err);
        toastr.error('Failed to load stats. See the log for details.', 'Character Tools');
    } finally {
        setRunning(false);
    }
}

// ── Job runner ─────────────────────────────────────────────────────────────────

/**
 * Run a server job over SSE, streaming progress into the panel.
 * @param {string} path  endpoint path, e.g. '/fix-characters'
 * @param {'characters'|'images'} kind
 * @param {{withDictionary?: boolean}} [opts]  attach the tag dictionary (the
 *   Apply Tags / merge path). Off by default, so Fix Characters only repairs and
 *   compresses and never touches tags.
 */
async function runPanelJob(path, kind, { withDictionary = false } = {}) {
    const user = document.getElementById('sct-user')?.value;
    if (!user) {
        toastr.info('No user selected.', 'Character Tools');
        return;
    }

    const opLabel = kind === 'images' ? 'Compression' : withDictionary ? 'Apply Tags' : 'Fix Characters';

    const body = { user };
    if (kind === 'characters' && withDictionary) {
        const dict = getRunDictionary();
        if (dict) body.dictionary = dict;
    }

    const bar = document.getElementById('sct-bar');
    const label = document.getElementById('sct-progress-label');
    const pct = document.getElementById('sct-progress-pct');
    const log = document.getElementById('sct-log');

    log.textContent = '';
    log.style.display = 'none';
    bar.style.width = '0%';
    pct.textContent = '0%';
    label.textContent = 'Scanning files...';
    document.getElementById('sct-progress-wrap').style.display = 'block';
    setRunning(true);

    try {
        const result = await runJob(path, body, (e) => {
            bar.style.width = `${e.percent}%`;
            pct.textContent = `${e.percent}%`;
            label.textContent = `Processing... ${e.current.toLocaleString()} / ${e.total.toLocaleString()}`;
        });

        if (!result) {
            appendLog('Error: the job ended without a result.');
            toastr.error('The job ended unexpectedly. See the log.', 'Character Tools');
            return;
        }

        bar.style.width = '100%';
        pct.textContent = '100%';
        label.textContent = 'Done';

        appendLog(`Scanned:    ${result.filesScanned.toLocaleString()}`);
        appendLog(`Skipped:    ${result.filesSkipped.toLocaleString()}`);
        appendLog(`Compressed: ${result.filesCompressed.toLocaleString()}`);
        if (kind === 'characters') {
            appendLog(`Repaired:   ${(result.cardsRepaired ?? 0).toLocaleString()}`);
            if (withDictionary) appendLog(`Tags fixed: ${(result.tagsChanged ?? 0).toLocaleString()}`);
        }
        appendLog(`Saved:      ${formatBytes(result.bytesSaved)}`);
        if (result.errors.length > 0) {
            appendLog(`\nErrors (${result.errors.length}):`);
            for (const e of result.errors) appendLog(`  ${e}`);
        }

        const savedMsg = `Saved ${formatBytes(result.bytesSaved)} across ${result.filesCompressed.toLocaleString()} files`;
        const repaired = result.cardsRepaired ?? 0;
        const tags = result.tagsChanged ?? 0;
        let summary;
        if (kind !== 'characters') {
            summary = savedMsg;
        } else if (withDictionary) {
            summary = `${tags.toLocaleString()} tag${tags === 1 ? '' : 's'} fixed, ${repaired.toLocaleString()} card${repaired === 1 ? '' : 's'} repaired. ${savedMsg}`;
        } else {
            summary = `${repaired.toLocaleString()} card${repaired === 1 ? '' : 's'} repaired. ${savedMsg}`;
        }
        toastr.success(summary, 'Character Tools');

        // Character runs rewrite cards on disk — refresh ST so it picks them up.
        if (kind === 'characters') {
            try {
                const ctx = SillyTavern.getContext();
                await ctx.getCharacters?.();
                ctx.printCharactersDebounced?.();
            } catch (e) {
                console.warn(MODULE_NAME, 'character refresh failed', e);
            }
        }

        try {
            appendLog('');
            appendLog('Current state:');
            appendAllStats(await fetchStats(user));
        } catch {
            // post-run stats are a nice-to-have; ignore failures here
        }
    } catch (err) {
        appendLog(`Error: ${err.message}`);
        console.error(MODULE_NAME, err);
        toastr.error(`${opLabel} failed. See the log for details.`, 'Character Tools');
    } finally {
        setRunning(false);
    }
}

// Fix Characters: repair + compress only (no dictionary → the server skips the tag merge).
const runFixCharacters = (reprocess = false) => runPanelJob(reprocess ? '/reprocess-characters' : '/fix-characters', 'characters');
// Apply Tags: the same character pass WITH the dictionary attached, so the server merges tags.
// Triggered from the Edit Tag Dictionary editor's footer, not the main panel.
const runApplyTags = (reprocess = false) => runPanelJob(reprocess ? '/reprocess-characters' : '/fix-characters', 'characters', { withDictionary: true });
const runCompressImages = (reprocess = false) => runPanelJob(reprocess ? '/reprocess-all' : '/compress', 'images');

// ── Editor ─────────────────────────────────────────────────────────────────────

async function openEditor() {
    const user = document.getElementById('sct-user')?.value;
    if (!user) {
        toastr.info('No user selected.', 'Character Tools');
        return;
    }
    const editBtn = document.getElementById('sct-edit');
    editBtn?.setAttribute('disabled', 'true');
    try {
        // Survey the SELECTED user's cards server-side (SillyTavern's in-browser
        // list only ever holds the logged-in user), so the editor's counts and
        // "unassigned" discovery match the user Apply Tags will run against.
        const characters = await fetchCharacterTags(user);
        const { mapping, removedTags, canonicalCategories, categoryOrder, baseMapping, baseRemovedTags } = await ensureDictionary();
        openModal(characters, mapping, removedTags, canonicalCategories, categoryOrder, baseMapping, baseRemovedTags, () => runApplyTags(false));
    } catch (e) {
        console.error(MODULE_NAME, e);
        toastr.error('Failed to open the tag editor. See console.', 'Character Tools');
    } finally {
        editBtn?.removeAttribute('disabled');
    }
}

// ── Panel injection ────────────────────────────────────────────────────────────

async function refreshUsers() {
    const users = await fetchUsers();
    const select = document.getElementById('sct-user');
    if (!select) return;
    const current = select.value;
    select.innerHTML = users.map(u => `<option value="${u}">${u}</option>`).join('');
    if (users.includes(current)) select.value = current;
}

function injectPanel(users) {
    if (document.getElementById(PANEL_ID)) return true;
    const container = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (!container) return false;

    container.appendChild(buildPanel(users));

    document.getElementById('sct-refresh').addEventListener('click', refreshUsers);
    document.getElementById('sct-fix').addEventListener('click', () => runFixCharacters(false));
    document.getElementById('sct-edit').addEventListener('click', openEditor);
    document.getElementById('sct-compress').addEventListener('click', () => runCompressImages(false));
    document.getElementById('sct-stats').addEventListener('click', runStats);
    document.getElementById('sct-reprocess-chars').addEventListener('click', () => runFixCharacters(true));
    document.getElementById('sct-reprocess-images').addEventListener('click', () => runCompressImages(true));
    return true;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const available = await probePlugin();

if (!available) {
    toastr.warning(
        'Character Tools server plugin is not available. If you just cloned it into '
        + 'SillyTavern/plugins, run <b>npm install --omit=dev</b> in the plugin folder and '
        + 'restart SillyTavern. (No build step is needed — the plugin ships pre-built.)',
        'Character Tools',
        { timeOut: 0, closeButton: true, escapeHtml: false },
    );
} else {
    // Seed the dictionary from the shipped base on first use, then draw the panel.
    await ensureDictionary();
    const users = await fetchUsers();

    if (!injectPanel(users)) {
        const observer = new MutationObserver(() => {
            if (injectPanel(users)) observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
}
