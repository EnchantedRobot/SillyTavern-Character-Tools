// ui-editor.js
// Builds the Tag Dictionary editor modal. This is a pure curation surface: it
// edits the persistent dictionary and saves every change automatically. It does
// NOT rewrite any cards itself — applying the dictionary is the server's job. The
// footer's "Apply Tags" button closes the editor and runs the character pass WITH
// the dictionary attached (merge tags + repair + compress). The main panel's "Fix
// Characters" button runs that same pass WITHOUT the dictionary, so merging tags
// onto cards happens only from here.
//
// The model is a persistent dictionary. The modal shows three lists:
//   • Canonical tags + the variants that merge into each (the full dictionary).
//   • Unassigned — every tag seen on a card that no canonical claims.
//   • Removed — junk tags that get deleted from every card when applied.
// Moving a tag between buckets edits the dictionary and is saved immediately.

import { buildBuckets, pickCanonical } from './tag-analysis.js';
import { saveDictionary, loadBaseDictionary } from './index.js';

// Live state for the open modal.
let state = null;       // { groups, unassigned, removed }
let overlayEl = null;
let characterList = [];
let groupSeq = 0;
let canonicalCategories = {};   // canonical → category name
let categoryOrder = [];         // category names in dictionary order
let baseSnapshot = null;        // serialized base dict for dirty-check
let resetBtnEl = null;
let onApplyTagsCb = null;       // panel callback: run the character pass WITH the dictionary (Apply Tags)

// Per-bucket filter text and a single shared selection (one bucket at a time).
let bucketFilter = { unassigned: '', removed: '' };
let selectionBucket = null;     // 'unassigned' | 'removed' | null
let selected = new Set();       // Set of variant objects

function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function closeModal() {
    closeChipMenu();
    overlayEl?.remove();
    overlayEl = null;
    state = null;
    resetBtnEl = null;
}

function dictSnapshot(mapping, removedTags) {
    const m = {};
    for (const k of Object.keys(mapping).sort()) m[k] = [...mapping[k]].sort();
    return JSON.stringify({ m, r: [...removedTags].sort() });
}

function currentSnapshot() {
    const mapping = {};
    for (const g of state.groups) {
        if (!g.canonical) continue;
        mapping[g.canonical] = g.variants.map(v => v.tag);
    }
    return dictSnapshot(mapping, state.removed.map(v => v.tag));
}

function updateResetBtn() {
    if (!resetBtnEl) return;
    const dirty = baseSnapshot && currentSnapshot() !== baseSnapshot;
    resetBtnEl.classList.toggle('ctm-btn-disabled', !dirty);
}

/** Union of card avatars across a group's variants. */
function cardCount(group) {
    const set = new Set();
    for (const v of group.variants) for (const a of v.avatars) set.add(a);
    return set.size;
}

/** Rebuild the dictionary from live state and persist it to settings. */
function persist() {
    const mapping = {};
    for (const g of state.groups) {
        if (!g.canonical) continue;
        mapping[g.canonical] = g.variants.map(v => v.tag);
    }
    saveDictionary(mapping, state.removed.map(v => v.tag));
    updateResetBtn();
}

/** (Re)build the modal's three buckets from a dictionary into `state`. */
function loadState(mapping, removedTags) {
    const { groups, unassigned, removed } = buildBuckets(characterList, mapping, removedTags);
    state = {
        groups: groups.map(g => ({
            id: `g${groupSeq++}`,
            canonical: g.canonical,
            variants: g.variants,
            category: canonicalCategories[g.canonical] ?? '',
        })),
        unassigned,
        removed,
    };
}

/**
 * Open the Tag Mapping editor.
 * @param {object[]} characters
 * @param {Object<string,string[]>} mapping  persistent canonical -> variants dict
 * @param {string[]} [removedTags]  persistent junk list
 */
export function openModal(characters, mapping, removedTags, catCategories = {}, catOrder = [], baseMapping = {}, baseRemovedTags = [], onApplyTags = null) {
    closeModal();
    characterList = characters;
    groupSeq = 0;
    canonicalCategories = catCategories;
    categoryOrder = catOrder;
    onApplyTagsCb = onApplyTags;
    bucketFilter = { unassigned: '', removed: '' };
    selectionBucket = null;
    selected = new Set();

    loadState(baseMapping, baseRemovedTags);
    baseSnapshot = currentSnapshot();
    loadState(mapping, removedTags);

    overlayEl = el(`
        <div id="ctm-overlay" class="ctm-overlay">
            <div class="ctm-modal">
                <div class="ctm-header">
                    <h3><i class="fa-solid fa-tags"></i> Tag Mapping</h3>
                    <div class="ctm-close menu_button" title="Close"><i class="fa-solid fa-xmark"></i></div>
                </div>
                <div class="ctm-body"></div>
                <div class="ctm-footer"></div>
            </div>
        </div>
    `);
    overlayEl.querySelector('.ctm-close').addEventListener('click', closeModal);
    overlayEl.addEventListener('click', (e) => {
        if (e.target === overlayEl) closeModal();
        else if (!e.target.closest('.ctm-chip-menu') && !e.target.closest('.ctm-chip')) closeChipMenu();
    });

    const footer = overlayEl.querySelector('.ctm-footer');
    if (onApplyTagsCb) {
        const applyBtn = el(`<div id="ctm-apply" class="menu_button" title="Save the dictionary and apply it to your cards: merge tags + repair + compress in one pass"><i class="fa-solid fa-tags"></i>&nbsp;&nbsp;Apply Tags</div>`);
        applyBtn.addEventListener('click', () => { const cb = onApplyTagsCb; closeModal(); cb(); });
        footer.appendChild(applyBtn);
    }
    const newGroupBtn = el(`<div class="menu_button" title="Create an empty canonical tag"><i class="fa-solid fa-plus"></i>&nbsp;&nbsp;New canonical</div>`);
    newGroupBtn.addEventListener('click', onNewEmptyGroup);
    footer.appendChild(newGroupBtn);
    const resetBtn = el(`<div class="menu_button" title="Discard your edits and restore the shipped default mapping"><i class="fa-solid fa-rotate-left"></i>&nbsp;&nbsp;Reset Tags</div>`);
    resetBtn.addEventListener('click', onResetTags);
    footer.appendChild(resetBtn);
    resetBtnEl = resetBtn;
    updateResetBtn();
    const closeBtn = el(`<div class="menu_button"><i class="fa-solid fa-xmark"></i>&nbsp;&nbsp;Close</div>`);
    closeBtn.addEventListener('click', closeModal);
    footer.appendChild(closeBtn);

    document.body.appendChild(overlayEl);
    renderBody();
}

/** Read DOM-only edits (canonical text) back into the model. */
function syncFromDom() {
    if (!overlayEl) return;
    for (const group of state.groups) {
        const tr = overlayEl.querySelector(`.ctm-row[data-id="${group.id}"]`);
        const input = tr?.querySelector('.ctm-canonical');
        if (input) group.canonical = input.value.trim() || group.canonical;
    }
}

function renderBody() {
    const body = overlayEl.querySelector('.ctm-body');
    body.innerHTML = '';
    body.appendChild(buildSummary());
    body.appendChild(buildTable());
    body.appendChild(buildBucket('unassigned'));
    body.appendChild(buildBucket('removed'));
}

function buildSummary() {
    return el(`
        <div class="ctm-summary">
            <b>${state.groups.length}</b> canonical tag${state.groups.length === 1 ? '' : 's'}, <b>${state.unassigned.length}</b> unassigned, <b>${state.removed.length}</b> removed.
            <div class="ctm-bulk">
                <span class="ctm-hint">Click a tag to move it between canonicals, Unassigned, or Removed. ✕ on a variant sends it back to Unassigned. Edits save automatically.</span>
            </div>
        </div>
    `);
}

/** True if this group will actually rename at least one tag on a real card. */
function groupHasRename(group) {
    return group.variants.some(v => v.count > 0 && v.tag !== group.canonical);
}

function buildRow(group) {
    const tr = el(`
        <tr class="ctm-row" data-id="${group.id}">
            <td><input type="text" class="ctm-canonical text_pole" value="${escapeHtml(group.canonical)}"></td>
            <td class="ctm-variants"></td>
            <td class="ctm-col-count">${cardCount(group)}</td>
            <td class="ctm-col-dismiss"><span class="ctm-row-dismiss" title="Delete canonical — send all variants to Unassigned">✕</span></td>
        </tr>
    `);
    const visibleVariants = group.variants.filter(v => v.count > 0);
    if (!groupHasRename(group)) tr.classList.add('ctm-row--muted');
    const cell = tr.querySelector('.ctm-variants');
    for (const v of visibleVariants) cell.appendChild(buildChip(v, group));
    tr.querySelector('.ctm-canonical').addEventListener('change', (e) => {
        group.canonical = e.target.value.trim() || group.canonical;
        e.target.value = group.canonical;
        persist();
    });
    tr.querySelector('.ctm-row-dismiss').addEventListener('click', () => {
        syncFromDom();
        state.groups = state.groups.filter(g => g !== group);
        for (const v of group.variants) state.unassigned.push(v);
        persist();
        renderBody();
    });
    return tr;
}

function buildTable() {
    const wrap = el(`<div class="ctm-categories"></div>`);

    // Group by category, preserving dictionary order; uncategorised at end.
    const byCat = new Map();
    for (const group of state.groups) {
        const cat = group.category || 'Custom';
        if (!byCat.has(cat)) byCat.set(cat, []);
        byCat.get(cat).push(group);
    }
    const orderedCats = [
        ...categoryOrder.filter(c => byCat.has(c)),
        ...[...byCat.keys()].filter(c => !categoryOrder.includes(c)),
    ];

    for (const cat of orderedCats) {
        const groups = byCat.get(cat);
        const hasChanges = groups.some(groupHasRename);
        const section = el(`
            <details class="ctm-category${hasChanges ? '' : ' ctm-category--clean'}"${hasChanges ? ' open' : ''}>
                <summary class="ctm-category-header">
                    <span class="ctm-category-name">${escapeHtml(cat)}</span>
                    <span class="ctm-category-count">${groups.length}</span>
                </summary>
                <div class="ctm-table-wrap">
                    <table class="ctm-table">
                        <thead><tr>
                            <th>Canonical tag</th><th>Merged variants</th>
                            <th class="ctm-col-count">Cards</th><th class="ctm-col-dismiss"></th>
                        </tr></thead>
                        <tbody></tbody>
                    </table>
                </div>
            </details>
        `);
        const tbody = section.querySelector('tbody');
        for (const group of groups) tbody.appendChild(buildRow(group));
        wrap.appendChild(section);
    }
    return wrap;
}

/** A variant chip inside a canonical group. */
function buildChip(variant, group) {
    const chip = el(`
        <span class="ctm-chip" title="Click to move">
            <span class="ctm-chip-label">${escapeHtml(variant.tag)}</span>
            <span class="ctm-chip-count">${variant.count}</span>
            <span class="ctm-chip-x" title="Remove from group">✕</span>
        </span>
    `);
    const openMenu = (e) => { e.stopPropagation(); openChipMenu(chip, variant, group); };
    chip.querySelector('.ctm-chip-label').addEventListener('click', openMenu);
    chip.querySelector('.ctm-chip-count').addEventListener('click', openMenu);
    chip.querySelector('.ctm-chip-x').addEventListener('click', (e) => {
        e.stopPropagation();
        moveVariant(variant, group, 'unassigned');
    });
    return chip;
}

// ── Unassigned / Removed buckets (shared implementation) ─────────────────────

const BUCKET_META = {
    unassigned: {
        cls: 'ctm-bucket-unassigned',
        chipCls: 'ctm-chip-excluded',
        header: n => `Unassigned — no canonical mapping (${n})`,
        empty: 'Every tag on your cards is mapped or removed. 🎉',
        clickTitle: 'Click to assign to a canonical',
    },
    removed: {
        cls: 'ctm-bucket-removed',
        chipCls: 'ctm-chip-removed',
        header: n => `Removed — deleted from all cards on apply (${n})`,
        empty: 'No tags flagged for removal.',
        clickTitle: 'Click to move out of Removed',
    },
};

function bucketArr(kind) { return kind === 'removed' ? state.removed : state.unassigned; }

function refreshBucket(kind) {
    const node = overlayEl.querySelector(`.${BUCKET_META[kind].cls}`);
    if (node) node.replaceWith(buildBucket(kind));
}

function buildBucket(kind) {
    const meta = BUCKET_META[kind];
    const arr = bucketArr(kind);
    const visible = kind === 'removed' ? arr.filter(v => v.count > 0) : arr;
    const wrap = el(`<div class="ctm-excluded ${meta.cls}"></div>`);
    const inSelection = selectionBucket === kind;

    const headerRow = el(`<div class="ctm-excluded-header-row">
        <span class="ctm-excluded-header">${meta.header(visible.length)}</span>
        ${visible.length > 0 ? `<span class="ctm-link ctm-excluded-toggle">${inSelection ? 'Cancel' : 'Select'}</span>` : ''}
    </div>`);
    headerRow.querySelector('.ctm-excluded-toggle')?.addEventListener('click', () => {
        selectionBucket = inSelection ? null : kind;
        selected.clear();
        renderBody();
    });
    wrap.appendChild(headerRow);

    if (visible.length === 0) {
        wrap.appendChild(el(`<div class="ctm-excluded-empty">${meta.empty}</div>`));
        return wrap;
    }

    if (inSelection && selected.size > 0) wrap.appendChild(buildBulkActionBar(kind));

    const filter = el(`<input type="text" class="ctm-excluded-filter text_pole" placeholder="Filter ${visible.length} tags…" value="${escapeHtml(bucketFilter[kind])}">`);
    wrap.appendChild(filter);
    const sorted = [...visible].sort((a, b) =>
        kind === 'removed'
            ? b.count - a.count
            : a.tag.toLowerCase().replace(/^#+/, '').localeCompare(b.tag.toLowerCase().replace(/^#+/, '')));
    const strip = el(`<div class="ctm-excluded-strip"></div>`);
    for (const v of sorted) {
        const chip = buildBucketChip(kind, v);
        chip.dataset.tag = v.tag.toLowerCase().replace(/^#+/, '');
        strip.appendChild(chip);
    }
    wrap.appendChild(strip);

    filter.addEventListener('input', (e) => { bucketFilter[kind] = e.target.value; applyBucketFilter(kind, strip); });
    applyBucketFilter(kind, strip);
    return wrap;
}

function buildBucketChip(kind, variant) {
    const meta = BUCKET_META[kind];
    const inSelection = selectionBucket === kind;
    const isSelected = selected.has(variant);
    const chip = el(`
        <span class="ctm-chip ${meta.chipCls}${isSelected ? ' ctm-chip-selected' : ''}"
              title="${inSelection ? 'Click to select' : meta.clickTitle}">
            <span class="ctm-chip-label">${escapeHtml(variant.tag)}</span>
            <span class="ctm-chip-count">${variant.count}</span>
        </span>
    `);
    chip.addEventListener('click', (e) => {
        e.stopPropagation();
        if (inSelection) {
            if (selected.has(variant)) selected.delete(variant); else selected.add(variant);
            refreshBucket(kind);
        } else {
            openChipMenu(chip, variant, kind);
        }
    });
    return chip;
}

function buildBulkActionBar(kind) {
    const n = selected.size;
    const restoreLabel = kind === 'removed' ? '↩ To Unassigned' : '🗑 Remove';
    const restoreTo = kind === 'removed' ? 'unassigned' : 'removed';
    const bar = el(`<div class="ctm-bulk-bar">
        <span class="ctm-bulk-count">${n} selected</span>
        <div class="ctm-bulk-move-wrap">
            <input type="text" class="ctm-bulk-filter text_pole" placeholder="Move to canonical…">
            <div class="ctm-bulk-group-list" style="display:none;"></div>
        </div>
        <div class="menu_button ctm-bulk-newgroup">＋ New canonical</div>
        <div class="menu_button ctm-bulk-restore">${restoreLabel}</div>
        <span class="ctm-link ctm-bulk-clear">Deselect all</span>
    </div>`);

    const filterInput = bar.querySelector('.ctm-bulk-filter');
    const groupList = bar.querySelector('.ctm-bulk-group-list');

    function renderGroupList(q) {
        groupList.innerHTML = '';
        const filtered = state.groups.filter(g => !q || g.canonical.toLowerCase().includes(q));
        if (filtered.length === 0) {
            groupList.appendChild(el(`<div class="ctm-bulk-group-item ctm-chip-menu-empty">No matching canonicals</div>`));
            return;
        }
        for (const g of filtered.slice(0, 50)) {
            const item = el(`<div class="ctm-bulk-group-item">→ ${escapeHtml(g.canonical)}</div>`);
            item.addEventListener('click', () => bulkMoveSelected(kind, g));
            groupList.appendChild(item);
        }
    }

    filterInput.addEventListener('focus', () => { groupList.style.display = 'block'; renderGroupList(filterInput.value.trim().toLowerCase()); });
    filterInput.addEventListener('input', (e) => renderGroupList(e.target.value.trim().toLowerCase()));
    filterInput.addEventListener('keydown', (e) => e.stopPropagation());
    filterInput.addEventListener('click', (e) => e.stopPropagation());
    filterInput.addEventListener('blur', () => setTimeout(() => { groupList.style.display = 'none'; }, 150));

    bar.querySelector('.ctm-bulk-newgroup').addEventListener('click', () => bulkMoveSelected(kind, 'new'));
    bar.querySelector('.ctm-bulk-restore').addEventListener('click', () => bulkMoveSelected(kind, restoreTo));
    bar.querySelector('.ctm-bulk-clear').addEventListener('click', () => { selected.clear(); refreshBucket(kind); });
    return bar;
}

function bulkMoveSelected(kind, to) {
    syncFromDom();
    const variants = [...selected];
    selected.clear();
    if (kind === 'removed') state.removed = state.removed.filter(v => !variants.includes(v));
    else state.unassigned = state.unassigned.filter(v => !variants.includes(v));

    if (to === 'new') {
        state.groups.push({ id: `g${groupSeq++}`, canonical: pickCanonical(variants), variants });
    } else if (to === 'removed') {
        for (const v of variants) state.removed.push(v);
    } else if (to === 'unassigned') {
        for (const v of variants) state.unassigned.push(v);
    } else {
        for (const v of variants) to.variants.push(v);
    }
    selectionBucket = null;
    persist();
    renderBody();
}

function applyBucketFilter(kind, strip) {
    const q = bucketFilter[kind].trim().toLowerCase().replace(/^#+/, '');
    for (const chip of strip.children) {
        chip.style.display = (!q || chip.dataset.tag.includes(q)) ? '' : 'none';
    }
}

function onNewEmptyGroup() {
    syncFromDom();
    state.groups.push({ id: `g${groupSeq++}`, canonical: 'New Tag', variants: [] });
    persist();
    renderBody();
}

// ── Chip move menu ─────────────────────────────────────────────────────────

let chipMenuEl = null;

function closeChipMenu() {
    chipMenuEl?.remove();
    chipMenuEl = null;
}

/** `from` is a group object, or 'unassigned' / 'removed' for bucket chips. */
function openChipMenu(anchor, variant, from) {
    closeChipMenu();
    syncFromDom();

    const fromGroup = typeof from === 'object' ? from : null;
    const groupItems = state.groups.filter(g => g !== fromGroup).map(g => ({ label: g.canonical, g }));

    const fixedItems = [];
    if (fromGroup) {
        fixedItems.push({ label: '✕ Unassign (leave unmapped)', onClick: () => moveVariant(variant, from, 'unassigned') });
        fixedItems.push({ label: '🗑 Remove (delete from cards)', onClick: () => moveVariant(variant, from, 'removed') });
    } else if (from === 'unassigned') {
        fixedItems.push({ label: '🗑 Remove (delete from cards)', onClick: () => moveVariant(variant, from, 'removed') });
    } else if (from === 'removed') {
        fixedItems.push({ label: '↩ Restore to Unassigned', onClick: () => moveVariant(variant, from, 'unassigned') });
    }
    fixedItems.push({ label: '＋ New canonical from this tag', onClick: () => moveVariant(variant, from, 'new') });

    chipMenuEl = el(`<div class="ctm-chip-menu"></div>`);
    const filterInput = el(`<input type="text" class="ctm-chip-menu-filter text_pole" placeholder="Filter canonicals…">`);
    chipMenuEl.appendChild(filterInput);
    const list = el(`<div class="ctm-chip-menu-list"></div>`);
    chipMenuEl.appendChild(list);

    chipMenuEl.appendChild(el(`<div class="ctm-chip-menu-divider"></div>`));
    for (const item of fixedItems) {
        const row = el(`<div class="ctm-chip-menu-item ctm-chip-menu-item-fixed">${escapeHtml(item.label)}</div>`);
        row.addEventListener('click', (e) => { e.stopPropagation(); closeChipMenu(); item.onClick(); });
        chipMenuEl.appendChild(row);
    }

    function renderList(q) {
        list.innerHTML = '';
        const filtered = (q ? groupItems.filter(i => i.label.toLowerCase().includes(q)) : groupItems).slice(0, 50);
        if (filtered.length === 0) list.appendChild(el(`<div class="ctm-chip-menu-empty">No matching canonicals</div>`));
        for (const item of filtered) {
            const row = el(`<div class="ctm-chip-menu-item">→ ${escapeHtml(item.label)}</div>`);
            row.addEventListener('click', (e) => { e.stopPropagation(); closeChipMenu(); moveVariant(variant, from, item.g); });
            list.appendChild(row);
        }
    }

    renderList('');
    filterInput.addEventListener('input', (e) => renderList(e.target.value.trim().toLowerCase()));
    filterInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); closeChipMenu(); }
        e.stopPropagation();
    });
    filterInput.addEventListener('click', (e) => e.stopPropagation());

    const modal = overlayEl.querySelector('.ctm-modal');
    modal.appendChild(chipMenuEl);
    filterInput.focus();

    const modalRect = modal.getBoundingClientRect();
    const r = anchor.getBoundingClientRect();
    chipMenuEl.style.top = `${r.bottom - modalRect.top + 4}px`;
    chipMenuEl.style.left = `${r.left - modalRect.left}px`;
    const menuRect = chipMenuEl.getBoundingClientRect();
    if (menuRect.right > modalRect.right) chipMenuEl.style.left = `${Math.max(4, modalRect.width - menuRect.width - 8)}px`;
    if (menuRect.bottom > modalRect.bottom) chipMenuEl.style.top = `${r.top - modalRect.top - menuRect.height - 4}px`;
}

/**
 * Move a variant between groups / unassigned / removed / a new group, then persist.
 * @param {object} variant
 * @param {object|'unassigned'|'removed'} from  source group or bucket
 * @param {object|'unassigned'|'removed'|'new'} to  destination
 */
function moveVariant(variant, from, to) {
    syncFromDom();
    const fromGroup = typeof from === 'object' ? from : null;

    // Remove from source.
    if (fromGroup) fromGroup.variants = fromGroup.variants.filter(v => v !== variant);
    else if (from === 'removed') state.removed = state.removed.filter(v => v !== variant);
    else state.unassigned = state.unassigned.filter(v => v !== variant);

    // Add to destination.
    if (to === 'unassigned') {
        if (!state.unassigned.includes(variant)) state.unassigned.push(variant);
    } else if (to === 'removed') {
        if (!state.removed.includes(variant)) state.removed.push(variant);
    } else if (to === 'new') {
        state.groups.push({ id: `g${groupSeq++}`, canonical: pickCanonical([variant]), variants: [variant] });
    } else {
        to.variants.push(variant);
    }

    if (fromGroup && fromGroup.variants.length === 0) {
        state.groups = state.groups.filter(g => g !== fromGroup);
    }

    closeChipMenu();
    persist();
    renderBody();
}

/** In-modal confirmation overlay (self-contained, no popup.js dependency). */
function confirmDialog({ title, bodyHtml, confirmLabel = 'Confirm', confirmIcon = 'fa-check' }) {
    return new Promise(resolve => {
        const confirm = el(`
            <div class="ctm-confirm">
                <div class="ctm-confirm-box">
                    <h4>${title}</h4>
                    ${bodyHtml}
                    <div class="ctm-confirm-actions">
                        <div class="menu_button ctm-confirm-yes"><i class="fa-solid ${confirmIcon}"></i>&nbsp;&nbsp;${confirmLabel}</div>
                        <div class="menu_button ctm-confirm-no"><i class="fa-solid fa-xmark"></i>&nbsp;&nbsp;Cancel</div>
                    </div>
                </div>
            </div>
        `);
        confirm.querySelector('.ctm-confirm-yes').addEventListener('click', () => { confirm.remove(); resolve(true); });
        confirm.querySelector('.ctm-confirm-no').addEventListener('click', () => { confirm.remove(); resolve(false); });
        overlayEl.querySelector('.ctm-modal').appendChild(confirm);
    });
}

/** Discard the user's edits and restore the shipped base dictionary. */
async function onResetTags() {
    closeChipMenu();
    const base = await loadBaseDictionary();
    if (!base || Object.keys(base.mapping).length === 0) {
        toastr.error('Could not load the base dictionary.', 'Character Tools');
        return;
    }
    const confirmed = await confirmDialog({
        title: 'Reset to the shipped mapping?',
        bodyHtml: `<p class="ctm-warn"><i class="fa-solid fa-triangle-exclamation"></i> This discards <b>all your edits</b> and restores the shipped default mapping. It does <b>not</b> change any cards.</p>`,
        confirmLabel: 'Reset Tags',
        confirmIcon: 'fa-rotate-left',
    });
    if (!confirmed) return;

    loadState(base.mapping, base.removedTags);
    saveDictionary(base.mapping, base.removedTags);
    selectionBucket = null;
    selected.clear();
    bucketFilter = { unassigned: '', removed: '' };
    renderBody();
    updateResetBtn();
    toastr.success('Dictionary reset to the shipped default.', 'Character Tools');
}
