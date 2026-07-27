import { describe, it, expect } from 'vitest';
import { diffDictionary, applyDelta } from '../tag-delta.js';

// Sort a dictionary's keys and array contents so structurally-equal dictionaries
// compare equal regardless of insertion order (applyDelta doesn't promise order).
function normalize({ mapping, removedTags }) {
    const m = {};
    for (const key of Object.keys(mapping).sort()) m[key] = [...mapping[key]].sort();
    return { mapping: m, removedTags: [...removedTags].sort() };
}

function roundTrip(base, current) {
    const delta = diffDictionary(base, current);
    return { delta, result: applyDelta(base, delta) };
}

function omit(obj, key) {
    const copy = { ...obj };
    delete copy[key];
    return copy;
}

const BASE = {
    mapping: {
        Female: ['female', '#Female'],
        Male: ['male'],
        NSFW: [],
    },
    removedTags: ['spam', 'test'],
};

describe('diffDictionary / applyDelta', () => {
    it('produces an empty delta for an untouched dictionary', () => {
        const delta = diffDictionary(BASE, BASE);
        expect(delta).toEqual({ overrides: {}, blanks: {} });
    });

    it('round-trips an untouched dictionary back to the base', () => {
        const { result } = roundTrip(BASE, BASE);
        expect(normalize(result)).toEqual(normalize(BASE));
    });

    it('records a single override when a variant moves to a different canonical', () => {
        const current = {
            mapping: { ...BASE.mapping, Female: ['#Female'], Male: ['male', 'female'] },
            removedTags: BASE.removedTags,
        };
        const delta = diffDictionary(BASE, current);
        expect(delta.overrides).toEqual({ female: { canonical: 'Male' } });
        expect(delta.blanks).toEqual({});
        expect(normalize(applyDelta(BASE, delta))).toEqual(normalize(current));
    });

    it('records an override when a tag is removed', () => {
        const current = {
            mapping: { ...BASE.mapping, Female: ['#Female'] },
            removedTags: [...BASE.removedTags, 'female'],
        };
        const delta = diffDictionary(BASE, current);
        expect(delta.overrides).toEqual({ female: { removed: true } });
        expect(normalize(applyDelta(BASE, delta))).toEqual(normalize(current));
    });

    it('records an override when a removed tag is restored to unassigned', () => {
        const current = { mapping: BASE.mapping, removedTags: ['test'] };
        const delta = diffDictionary(BASE, current);
        expect(delta.overrides).toEqual({ spam: { unassigned: true } });
        expect(normalize(applyDelta(BASE, delta))).toEqual(normalize(current));
    });

    it('implies a brand-new non-empty canonical purely through overrides (no blanks entry)', () => {
        const current = {
            mapping: { ...BASE.mapping, Robot: ['android', 'cyborg'] },
            removedTags: BASE.removedTags,
        };
        const delta = diffDictionary(BASE, current);
        expect(delta.overrides).toEqual({
            android: { canonical: 'Robot' },
            cyborg: { canonical: 'Robot' },
        });
        expect(delta.blanks).toEqual({});
        expect(normalize(applyDelta(BASE, delta))).toEqual(normalize(current));
    });

    it('tracks a brand-new empty canonical as a blank', () => {
        const current = { mapping: { ...BASE.mapping, 'New Tag': [] }, removedTags: BASE.removedTags };
        const delta = diffDictionary(BASE, current);
        expect(delta.overrides).toEqual({});
        expect(delta.blanks).toEqual({ 'New Tag': true });
        expect(normalize(applyDelta(BASE, delta))).toEqual(normalize(current));
    });

    it('tracks deletion of a base canonical that shipped with zero aliases', () => {
        const current = { mapping: omit(BASE.mapping, 'NSFW'), removedTags: BASE.removedTags };
        const delta = diffDictionary(BASE, current);
        expect(delta.blanks).toEqual({ NSFW: false });
        expect(normalize(applyDelta(BASE, delta))).toEqual(normalize(current));
    });

    it('deleting a populated canonical clears it via per-variant overrides, no blanks entry', () => {
        const current = { mapping: omit(BASE.mapping, 'Male'), removedTags: BASE.removedTags };
        const delta = diffDictionary(BASE, current);
        expect(delta.overrides).toEqual({ male: { unassigned: true } });
        expect(delta.blanks).toEqual({});
        const result = applyDelta(BASE, delta);
        expect(result.mapping.Male).toBeUndefined();
        expect(normalize(result)).toEqual(normalize(current));
    });

    it('renaming a canonical is a bulk per-variant override, and round-trips', () => {
        const current = {
            mapping: { ...omit(BASE.mapping, 'Female'), Girl: ['female', '#Female'] },
            removedTags: BASE.removedTags,
        };
        const delta = diffDictionary(BASE, current);
        expect(delta.overrides).toEqual({
            female: { canonical: 'Girl' },
            '#Female': { canonical: 'Girl' },
        });
        const result = applyDelta(BASE, delta);
        expect(result.mapping.Female).toBeUndefined();
        expect(normalize(result)).toEqual(normalize(current));
    });

    it('a variant added to a previously-blank canonical clears its blanks entry', () => {
        const current = { mapping: { ...BASE.mapping, NSFW: ['gore'] }, removedTags: BASE.removedTags };
        const delta = diffDictionary(BASE, current);
        expect(delta.overrides).toEqual({ gore: { canonical: 'NSFW' } });
        expect(delta.blanks).toEqual({});
        expect(normalize(applyDelta(BASE, delta))).toEqual(normalize(current));
    });

    it('composes multiple simultaneous edits into one small delta that still round-trips', () => {
        const current = {
            mapping: {
                Female: ['#Female'],           // 'female' moved out
                Male: ['male', 'female'],       // 'female' moved in
                Robot: ['android'],              // brand new canonical
                'Empty Bucket': [],              // brand new blank canonical
                NSFW: [],
            },
            removedTags: ['test', 'spam-extra'], // 'spam' restored, 'spam-extra' newly removed
        };
        const { delta, result } = roundTrip(BASE, current);
        expect(normalize(result)).toEqual(normalize(current));
        // Sanity: the delta only mentions what actually changed, not the whole dictionary.
        expect(Object.keys(delta.overrides).sort()).toEqual(['android', 'female', 'spam', 'spam-extra'].sort());
        expect(delta.blanks).toEqual({ 'Empty Bucket': true });
    });

    it('produces a delta far smaller than the full dictionary for a small edit against a large base', () => {
        const bigMapping = {};
        for (let i = 0; i < 200; i++) bigMapping[`Canonical${i}`] = [`alias${i}a`, `alias${i}b`, `alias${i}c`];
        const bigBase = { mapping: bigMapping, removedTags: [] };
        const current = {
            mapping: { ...bigMapping, Canonical0: ['alias0a', 'alias0c'] }, // dropped one alias
            removedTags: ['alias0b'],
        };
        const delta = diffDictionary(bigBase, current);
        expect(JSON.stringify(delta).length).toBeLessThan(JSON.stringify(bigBase).length / 10);
        expect(normalize(applyDelta(bigBase, delta))).toEqual(normalize(current));
    });
});
