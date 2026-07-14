// Validates the shipped tag-dictionary.json for internal consistency. These
// invariants are what a contradictory entry violates — e.g. a canonical that is
// ALSO in removedTags, which makes the merge non-idempotent (it deletes a
// canonical it just produced). Catching that here is far cheaper than noticing a
// card lose a tag on a re-run.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { norm } from '../tag-analysis.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(fs.readFileSync(path.join(dir, '..', 'tag-dictionary.json'), 'utf8'));

// Flatten { category: { canonical: [alias…] } } -> { canonical: [alias…] }, exactly
// like index.js's loadBaseDictionary(), so we validate the shape the server runs.
const mapping = {};
for (const canonicals of Object.values(raw.mapping ?? {})) {
    for (const [canonical, aliases] of Object.entries(canonicals)) {
        mapping[canonical] = Array.isArray(aliases) ? aliases : [];
    }
}
const removedTags = Array.isArray(raw.removedTags) ? raw.removedTags : [];

// norm(tag) -> the set of canonicals that claim it (as their own key or a variant).
function buildClaims() {
    const claims = new Map();
    const add = (nrm, canonical) => {
        if (!claims.has(nrm)) claims.set(nrm, new Set());
        claims.get(nrm).add(canonical);
    };
    for (const [canonical, variants] of Object.entries(mapping)) {
        add(norm(canonical), canonical);
        for (const v of variants) add(norm(v), canonical);
    }
    return claims;
}

describe('shipped tag-dictionary.json', () => {
    const claims = buildClaims();

    it('never claims one tag under more than one canonical', () => {
        const clashes = [];
        for (const [nrm, canonicals] of claims) {
            if (canonicals.size > 1) clashes.push(`"${nrm}" -> ${JSON.stringify([...canonicals])}`);
        }
        expect(clashes, `A tag must belong to exactly one canonical bucket:\n  ${clashes.join('\n  ')}`).toEqual([]);
    });

    it('never lists a removed tag that a canonical also claims', () => {
        const contradictions = [];
        for (const t of removedTags) {
            const nrm = norm(t);
            if (claims.has(nrm)) contradictions.push(`"${t}" is also mapped to ${JSON.stringify([...claims.get(nrm)])}`);
        }
        expect(contradictions, `removedTags must not overlap the mapping (a tag can't be both merged and deleted):\n  ${contradictions.join('\n  ')}`).toEqual([]);
    });

    it('has no duplicate removed tags (by normalized form)', () => {
        const counts = new Map();
        for (const t of removedTags) counts.set(norm(t), (counts.get(norm(t)) ?? 0) + 1);
        const dupes = [...counts.entries()].filter(([, c]) => c > 1).map(([n, c]) => `"${n}" x${c}`);
        expect(dupes, `removedTags has duplicates:\n  ${dupes.join('\n  ')}`).toEqual([]);
    });
});
