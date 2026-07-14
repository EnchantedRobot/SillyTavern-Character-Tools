// tag-analysis.js
// Pure tag logic — no DOM, no SillyTavern globals. Safe to import in a browser
// or run under Node.
//
// The live extension is mapping-driven: a persistent `{ canonical: [variant…] }`
// dictionary is the source of truth. This module turns the cards + that mapping
// into display buckets and applies the mapping to a card's tag list. The base
// dictionary lives in tag-dictionary.json (category → canonical → aliases)
// and is flattened to { canonical: [alias…] } on load.

/**
 * Normalize a tag to its match key: trim, strip leading '#', trim again,
 * collapse internal whitespace, lowercase. Applied to both the dictionary aliases
 * on load and to card tags at match time (so "#Female", "  female ", "FEMALE"
 * all resolve to the same entry).
 * @param {string} t
 * @returns {string}
 */
export function norm(t) {
    return String(t)
        .trim()
        .replace(/^#+/, '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

/**
 * Read the embedded card tags off a SillyTavern character object.
 * Prefers data.tags (the real V2/V3 field) and falls back to the root mirror.
 * @param {object} char
 * @returns {string[]}
 */
export function getCardTags(char) {
    const tags = char?.data?.tags ?? char?.tags ?? [];
    return Array.isArray(tags) ? tags.filter(t => typeof t === 'string' && t.trim() !== '') : [];
}

/**
 * Scan all characters and tally tag usage.
 * Tags are deduplicated per-card (case-insensitively) so a card that lists
 * "Female" twice only counts once.
 * @param {object[]} characters
 * @returns {Map<string, {count: number, avatars: Set<string>}>} keyed by the exact tag string
 */
function scanTags(characters) {
    const stats = new Map();
    for (const char of characters ?? []) {
        const avatar = char?.avatar ?? '';
        const seen = new Set(); // lowercase tags already counted for this card
        for (const tag of getCardTags(char)) {
            const lower = tag.toLowerCase();
            if (seen.has(lower)) continue;
            seen.add(lower);
            let entry = stats.get(tag);
            if (!entry) {
                entry = { count: 0, avatars: new Set() };
                stats.set(tag, entry);
            }
            entry.count++;
            if (avatar) entry.avatars.add(avatar);
        }
    }
    return stats;
}

/**
 * Pick a clean display tag for a freshly-created group (e.g. "New group from
 * this tag"). Not used for the persisted mapping's existing keys.
 *
 * Priority:
 *   1. A variant that starts with a capital letter (no #) — most frequent wins,
 *      returned verbatim ("Arranged Marriage", "AnyPOV").
 *   2. A variant that starts with # then a capital — leading # stripped.
 *   3. Otherwise synthesise from the most-frequent variant: strip #, collapse
 *      separators, Title Case (unless it's already intentional mixed-case).
 * @param {Array<{tag:string,count:number}>} variants
 * @returns {string}
 */
export function pickCanonical(variants) {
    const byFreq = (a, b) => b.count - a.count || a.tag.localeCompare(b.tag);

    const cleanCaps = variants.filter(v => /^[A-Z]/.test(v.tag));
    if (cleanCaps.length > 0) return [...cleanCaps].sort(byFreq)[0].tag;

    const hashCaps = variants.filter(v => /^#+[A-Z]/.test(v.tag));
    if (hashCaps.length > 0) return [...hashCaps].sort(byFreq)[0].tag.replace(/^#+/, '');

    const top = [...variants].sort(byFreq)[0];
    const stripped = top.tag.replace(/^#+/, '');
    const isAllLower = stripped === stripped.toLowerCase();
    const isAllUpper = stripped === stripped.toUpperCase();
    if (!isAllLower && !isAllUpper) return stripped;

    return stripped
        .replace(/[_\-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)
        .join(' ');
}

/**
 * Turn the cards + the persistent mapping into display buckets.
 *
 * Every canonical in the mapping becomes a group, even if none of its variants
 * appear on any card (the dictionary is shown in full). Declared variants that
 * aren't observed appear with count 0. Every observed tag that matches a
 * declared variant or canonical (case-insensitively) joins that group; every
 * other observed tag falls into `unassigned`.
 *
 * Tags listed in `removedTags` (junk to be deleted) form a third bucket and are
 * excluded from `unassigned`. A tag claimed by both a canonical and the removed
 * list stays with its canonical (mapping is the more specific intent).
 *
 * @param {object[]} characters
 * @param {Object<string,string[]>} mapping  canonical -> variant strings
 * @param {string[]} [removedTags]  tag strings flagged as junk
 * @returns {{groups: Array<{canonical:string, variants:Array<{tag:string,count:number,avatars:string[]}>}>, unassigned: Array<{tag:string,count:number,avatars:string[]}>, removed: Array<{tag:string,count:number,avatars:string[]}>}}
 */
export function buildBuckets(characters, mapping, removedTags) {
    const map = mapping || {};
    const stats = scanTags(characters);

    // Normalized variant/canonical -> canonical key.
    const lookup = new Map();
    for (const [canonical, variants] of Object.entries(map)) {
        lookup.set(norm(canonical), canonical);
        for (const v of variants ?? []) lookup.set(norm(v), canonical);
    }

    // Removed bucket, keyed by exact string. Seed declared junk at count 0 so the
    // full removal list shows even when none of it appears on a card.
    const removedMap = new Map();
    const removedLookup = new Set();
    for (const t of removedTags ?? []) {
        removedLookup.add(norm(t));
        if (!removedMap.has(String(t))) removedMap.set(String(t), { tag: String(t), count: 0, avatars: [] });
    }

    // canonical -> Map(exact tag string -> variant). Seed with declared variants
    // (count 0) so the full dictionary round-trips even when nothing on a card
    // uses it. Keying by the exact string keeps distinct case variants ("female"
    // and "Female") as separate chips instead of clobbering each other's counts.
    const groupMap = new Map();
    const ensure = (c) => { let g = groupMap.get(c); if (!g) { g = new Map(); groupMap.set(c, g); } return g; };
    for (const [canonical, variants] of Object.entries(map)) {
        const g = ensure(canonical);
        for (const v of variants ?? []) {
            if (!g.has(String(v))) g.set(String(v), { tag: String(v), count: 0, avatars: [] });
        }
    }

    const unassigned = [];
    for (const [tag, entry] of stats) {
        const variant = { tag, count: entry.count, avatars: [...entry.avatars] };
        const canonical = lookup.get(norm(tag));
        if (canonical) {
            ensure(canonical).set(tag, variant); // observed string wins over the count-0 seed
        } else if (removedLookup.has(norm(tag))) {
            removedMap.set(tag, variant); // observed string wins over the count-0 seed
        } else {
            unassigned.push(variant);
        }
    }

    const byCount = (a, b) => b.count - a.count || a.tag.localeCompare(b.tag);
    const groups = [...groupMap.entries()].map(([canonical, vmap]) => ({
        canonical,
        variants: [...vmap.values()].sort(byCount),
    }));
    return {
        groups,
        unassigned: unassigned.sort(byCount),
        removed: [...removedMap.values()].sort(byCount),
    };
}

/**
 * Apply approved rows to one card's tag list.
 * Renames any matched variant to its canonical, deletes any tag in `removedSet`
 * (case-insensitive), preserves unrelated tags and their order, and dedupes
 * case-insensitively.
 * @param {string[]} currentTags
 * @param {Array<{canonical:string, variants:Array<{tag:string}>}>} approvedRows
 * @param {Set<string>} [removedSet]  normalized tags to delete entirely
 * @returns {string[]|null} new tag array, or null if nothing changed
 */
export function applyRowsToTags(currentTags, approvedRows, removedSet) {
    // Map normalized variant -> canonical for every approved row.
    const variantToCanonical = new Map();
    for (const row of approvedRows) {
        for (const v of row.variants) variantToCanonical.set(norm(v.tag), row.canonical);
    }
    const removed = removedSet ?? new Set();

    const result = [];
    const seen = new Set();
    let changed = false;

    const push = (tag) => {
        const key = norm(tag);
        if (seen.has(key)) { changed = true; return; } // dropped a dupe
        seen.add(key);
        result.push(tag);
    };

    for (const tag of currentTags) {
        if (removed.has(norm(tag))) { changed = true; continue; } // junk — drop it
        const canonical = variantToCanonical.get(norm(tag));
        if (canonical === undefined) {
            push(tag);
        } else {
            if (canonical !== tag) changed = true;
            push(canonical);
        }
    }
    return changed ? result : null;
}
