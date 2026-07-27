import { describe, it, expect } from 'vitest';
import {
    norm,
    getCardTags,
    pickCanonical,
    buildBuckets,
} from '../tag-analysis.js';

// ── norm() ───────────────────────────────────────────────────────────────────
//
// CRITICAL INVARIANT: this normalization must stay byte-identical to the
// server's norm() (src/tagMerge.ts) and the categorize-tags skill. The golden
// table below is the shared contract — the same cases are pinned in the server's
// test suite. If you change one, change all three, or tags will merge
// differently on the client than the server applies them.
const NORM_GOLDEN = [
    ['#Female', 'female'],
    ['female', 'female'],
    ['FEMALE', 'female'],
    ['  Arranged   Marriage ', 'arranged marriage'],
    ['##FOO', 'foo'],
    ['#  Spaced', 'spaced'],
    ['Multi   Word', 'multi word'],
    ['a\tb  c', 'a b c'],
    ['  #  ', ''],
    ['AnyPOV', 'anypov'],
];

describe('norm', () => {
    it.each(NORM_GOLDEN)('normalizes %j -> %j (cross-repo invariant)', (input, expected) => {
        expect(norm(input)).toBe(expected);
    });

    it('coerces non-strings via String()', () => {
        expect(norm(123)).toBe('123');
    });
});

// ── getCardTags() ──────────────────────────────────────────────────────────────

describe('getCardTags', () => {
    it('prefers data.tags (the real V2/V3 field)', () => {
        expect(getCardTags({ data: { tags: ['a', 'b'] }, tags: ['x'] })).toEqual(['a', 'b']);
    });

    it('falls back to the root tags mirror', () => {
        expect(getCardTags({ tags: ['x', 'y'] })).toEqual(['x', 'y']);
    });

    it('drops non-strings and blank/whitespace entries', () => {
        expect(getCardTags({ data: { tags: ['a', '', '  ', 3, null, 'b'] } })).toEqual(['a', 'b']);
    });

    it('returns [] when there are no tags or the shape is odd', () => {
        expect(getCardTags({})).toEqual([]);
        expect(getCardTags(null)).toEqual([]);
        expect(getCardTags({ data: { tags: 'nope' } })).toEqual([]);
    });
});

// ── pickCanonical() ─────────────────────────────────────────────────────────────

describe('pickCanonical', () => {
    it('prefers a capitalized variant, most frequent wins', () => {
        expect(pickCanonical([
            { tag: 'female', count: 5 },
            { tag: 'Female', count: 2 },
        ])).toBe('Female');
    });

    it('strips a leading # from a #Capital variant', () => {
        expect(pickCanonical([{ tag: '#Female', count: 3 }])).toBe('Female');
    });

    it('preserves intentional mixed-case that leads with a capital', () => {
        expect(pickCanonical([{ tag: 'AnyPOV', count: 1 }])).toBe('AnyPOV');
    });

    it('synthesises Title Case from an all-lowercase separated variant', () => {
        expect(pickCanonical([{ tag: 'arranged_marriage', count: 3 }])).toBe('Arranged Marriage');
        expect(pickCanonical([{ tag: 'space opera', count: 1 }])).toBe('Space Opera');
    });
});

// ── buildBuckets() ──────────────────────────────────────────────────────────────

const mapping = {
    Female: ['female', 'woman', 'girl'],
    Romance: ['romance', 'romantic'],
};
const removedTags = ['junk'];

const characters = [
    { avatar: 'a.png', data: { tags: ['female', 'romance', 'junk', 'unmapped'] } },
    { avatar: 'b.png', tags: ['Female', 'Female'] }, // root fallback + intra-card dupe
    { avatar: 'c.png', data: { tags: ['ROMANTIC'] } },
];

/** canonical -> Map(exact tag string -> count) for easy assertions. */
function groupCounts(buckets, canonical) {
    const g = buckets.groups.find(x => x.canonical === canonical);
    return new Map((g?.variants ?? []).map(v => [v.tag, v.count]));
}

describe('buildBuckets', () => {
    it('makes a group for every canonical, seeding unseen variants at count 0', () => {
        const buckets = buildBuckets([], mapping, removedTags);
        expect(buckets.groups.map(g => g.canonical).sort()).toEqual(['Female', 'Romance']);
        const female = groupCounts(buckets, 'Female');
        expect(female.get('female')).toBe(0);
        expect(female.get('woman')).toBe(0);
        expect(female.get('girl')).toBe(0);
    });

    it('counts observed variants and keeps distinct case-strings separate', () => {
        const buckets = buildBuckets(characters, mapping, removedTags);
        const female = groupCounts(buckets, 'Female');
        // 'female' (card a) and 'Female' (card b) are distinct chips, each seen once.
        expect(female.get('female')).toBe(1);
        expect(female.get('Female')).toBe(1);
        expect(female.get('woman')).toBe(0); // declared but never observed
    });

    it('matches variants case-insensitively via norm', () => {
        const buckets = buildBuckets(characters, mapping, removedTags);
        const romance = groupCounts(buckets, 'Romance');
        expect(romance.get('romance')).toBe(1);
        expect(romance.get('ROMANTIC')).toBe(1); // norm('ROMANTIC') === 'romantic'
    });

    it('dedupes tags case-insensitively within a single card', () => {
        const buckets = buildBuckets(characters, mapping, removedTags);
        // card b lists 'Female' twice; it should count once.
        expect(groupCounts(buckets, 'Female').get('Female')).toBe(1);
    });

    it('routes junk to the removed bucket and out of unassigned', () => {
        const buckets = buildBuckets(characters, mapping, removedTags);
        expect(buckets.removed.find(r => r.tag === 'junk')?.count).toBe(1);
        expect(buckets.unassigned.find(u => u.tag === 'junk')).toBeUndefined();
    });

    it('puts unmatched observed tags in unassigned', () => {
        const buckets = buildBuckets(characters, mapping, removedTags);
        expect(buckets.unassigned.find(u => u.tag === 'unmapped')?.count).toBe(1);
    });

    it('lets a canonical claim a tag that is also in removedTags (mapping wins)', () => {
        // 'girl' is both a Female variant and flagged as removed.
        const buckets = buildBuckets(
            [{ avatar: 'z.png', data: { tags: ['girl'] } }],
            mapping,
            ['girl'],
        );
        // The observed occurrence (count 1) is attributed to the canonical group...
        expect(groupCounts(buckets, 'Female').get('girl')).toBe(1);
        // ...while the removed list still shows the declared entry, but only as a
        // count-0 seed (the observed hit did not land here).
        expect(buckets.removed.find(r => r.tag === 'girl')?.count).toBe(0);
    });

    it('aggregates avatars per variant', () => {
        const buckets = buildBuckets(characters, mapping, removedTags);
        const female = buckets.groups.find(g => g.canonical === 'Female');
        const femaleVariant = female.variants.find(v => v.tag === 'female');
        expect(femaleVariant.avatars).toEqual(['a.png']);
    });
});

// ── declared vs discovered ──────────────────────────────────────────────────
//
// A variant is `declared` only if its exact string is actually listed in
// mapping/removedTags; a card tag that merely normalizes to match one (a
// different casing, or the canonical's own bare name) is `discovered`, not
// declared. Callers persisting edits must save only declared variants —
// discovered ones reattach automatically via norm() on every load, so saving
// them too would re-declare every incidental spelling a card happens to use
// (this is what caused a flood of spurious dictionary "overrides" for
// same-spelling, different-casing tags that were never actually edited).

function variantIn(list, tag) {
    return list.find(v => v.tag === tag);
}

describe('buildBuckets — declared vs discovered', () => {
    const buckets = buildBuckets(characters, mapping, removedTags);

    it('flags an exact declared alias as declared, whether or not it is observed', () => {
        const female = buckets.groups.find(g => g.canonical === 'Female').variants;
        expect(variantIn(female, 'female').declared).toBe(true); // observed, exact declared match
        expect(variantIn(female, 'woman').declared).toBe(true);  // declared, unobserved (count 0)
    });

    it('flags an observed tag that only matches by normalizing as discovered', () => {
        const female = buckets.groups.find(g => g.canonical === 'Female').variants;
        // 'Female' is never itself a declared alias — it only matched by
        // normalizing to the same key as the declared 'female'.
        expect(variantIn(female, 'Female').declared).toBe(false);

        const romance = buckets.groups.find(g => g.canonical === 'Romance').variants;
        expect(variantIn(romance, 'ROMANTIC').declared).toBe(false); // declared alias is 'romantic'
    });

    it('applies the same declared/discovered split to the removed bucket', () => {
        expect(variantIn(buckets.removed, 'junk').declared).toBe(true); // exact declared junk
    });
});
