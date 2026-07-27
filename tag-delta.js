// tag-delta.js
// Pure diff/reconstruct helpers for the persisted tag dictionary. No DOM, no
// SillyTavern globals — safe to import in a browser or run under Node.
//
// index.js persists only the delta between the shipped base dictionary and the
// user's working copy, not the whole expanded dictionary: the base can run to
// hundreds of canonicals, but a session's edits are almost always a handful of
// moves. Storing the full copy also froze a user's dictionary at whatever the
// base looked like when first seeded, since nothing distinguished "the base"
// from "what the user changed" after that. Diffing against the base at save
// time and replaying the diff over the (always-current) base at load time
// fixes both: settings stay small, and updates to the shipped dictionary keep
// flowing through for anything the user hasn't touched.

/**
 * Build a tag -> placement lookup ({canonical} | {removed:true}) from a full
 * dictionary, plus the set of canonicals with zero aliases. A canonical with
 * no aliases has no tag to hang a placement off, so its bare existence has to
 * be tracked separately.
 * @param {{mapping: Object<string,string[]>, removedTags: string[]}} dict
 * @returns {{placements: Map<string, {canonical:string}|{removed:true}>, blanks: Set<string>}}
 */
function placementsOf({ mapping, removedTags }) {
    const placements = new Map();
    const blanks = new Set();
    for (const [canonical, aliases] of Object.entries(mapping ?? {})) {
        if (!aliases || aliases.length === 0) { blanks.add(canonical); continue; }
        for (const a of aliases) placements.set(a, { canonical });
    }
    for (const t of removedTags ?? []) placements.set(t, { removed: true });
    return { placements, blanks };
}

const samePlacement = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Diff a full working dictionary against the shipped base. Returns the minimal
 * delta needed to reconstruct `current` from `base` via {@link applyDelta}:
 * `overrides` holds only the tags whose placement differs from the base
 * (moved to a different canonical, removed, or un-removed/unassigned), and
 * `blanks` holds only the canonical names whose "has zero aliases" state
 * differs from the base (a brand-new empty canonical, or a base one the user
 * deleted while it had none).
 * @param {{mapping: Object<string,string[]>, removedTags: string[]}} base
 * @param {{mapping: Object<string,string[]>, removedTags: string[]}} current
 * @returns {{overrides: Object<string, {canonical:string}|{removed:true}|{unassigned:true}>, blanks: Object<string,boolean>}}
 */
export function diffDictionary(base, current) {
    const b = placementsOf(base);
    const c = placementsOf(current);

    const overrides = {};
    for (const tag of new Set([...b.placements.keys(), ...c.placements.keys()])) {
        const bp = b.placements.get(tag) ?? null;
        const cp = c.placements.get(tag) ?? null;
        if (!samePlacement(bp, cp)) overrides[tag] = cp ?? { unassigned: true };
    }

    // A canonical with ≥1 alias in `current` already exists via its alias
    // overrides above, so it never needs a blanks entry — only record one when
    // adding a genuinely blank canonical, or canceling a base blank that
    // `current` doesn't merely repopulate but drops outright.
    const blanks = {};
    for (const name of new Set([...b.blanks, ...c.blanks])) {
        const inBase = b.blanks.has(name);
        const inCurrent = c.blanks.has(name);
        if (inBase === inCurrent) continue;
        if (inCurrent) { blanks[name] = true; continue; }
        const stillPopulated = (current.mapping?.[name]?.length ?? 0) > 0;
        if (!stillPopulated) blanks[name] = false;
    }

    return { overrides, blanks };
}

/**
 * Reconstruct the full working dictionary by layering a delta (as produced by
 * {@link diffDictionary}) over the shipped base.
 * @param {{mapping: Object<string,string[]>, removedTags: string[]}} base
 * @param {{overrides?: Object<string, object>, blanks?: Object<string,boolean>}} delta
 * @returns {{mapping: Object<string,string[]>, removedTags: string[]}}
 */
export function applyDelta(base, delta) {
    const { placements, blanks } = placementsOf(base);
    for (const [tag, placement] of Object.entries(delta?.overrides ?? {})) {
        if (placement.unassigned) placements.delete(tag);
        else placements.set(tag, placement);
    }
    for (const [name, present] of Object.entries(delta?.blanks ?? {})) {
        if (present) blanks.add(name);
        else blanks.delete(name);
    }

    const mapping = {};
    for (const name of blanks) mapping[name] = [];
    const removedTags = [];
    for (const [tag, placement] of placements) {
        if (placement.canonical) (mapping[placement.canonical] ??= []).push(tag);
        else removedTags.push(tag);
    }
    return { mapping, removedTags };
}
