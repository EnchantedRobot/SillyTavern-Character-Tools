#!/usr/bin/env python3
"""
Verify the Character Tools extension applied its dictionary correctly.

For every card present in both characters_orig/ (before) and characters/ (after),
recompute what the tag merge SHOULD have produced from the original tags using the
exact mergeTags logic + the dictionary the extension actually used
(extensionSettings.CharacterTools in settings.json), and compare to the tags
now embedded in the updated card. Reports any card whose result doesn't match.

Usage:
    python3 scripts/verify-apply.py [DATA_DIR]
DATA_DIR defaults to ~/workspaces/SillyTavern/data/default-user and must contain
characters/ (after), characters_orig/ (before), and settings.json.
"""
import base64, json, struct, sys, zlib
from pathlib import Path

ROOT = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 \
    else Path.home() / 'workspaces/SillyTavern/data/default-user'
ORIG = ROOT / 'characters_orig'
NEW = ROOT / 'characters'
SETTINGS = ROOT / 'settings.json'

PNG_SIG = b'\x89PNG\r\n\x1a\n'


def iter_text_chunks(data):
    if not data.startswith(PNG_SIG):
        return
    pos = len(PNG_SIG)
    while pos + 8 <= len(data):
        (length,) = struct.unpack('>I', data[pos:pos + 4])
        ctype = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if ctype == b'tEXt':
            kw, _, text = body.partition(b'\x00')
            yield kw.decode('latin-1'), text
        elif ctype == b'zTXt':
            kw, _, rest = body.partition(b'\x00')
            try:
                yield kw.decode('latin-1'), zlib.decompress(rest[1:])
            except zlib.error:
                pass
        if ctype == b'IEND':
            break


def card_tags(png_path):
    """Return the embedded tag list (data.tags or tags), or None if unreadable."""
    try:
        data = png_path.read_bytes()
    except OSError:
        return None
    for kw, text in iter_text_chunks(data):
        if kw not in ('chara', 'ccv3'):
            continue
        try:
            raw = base64.b64decode(text)
            card = json.loads(raw)
        except (ValueError, json.JSONDecodeError):
            continue
        tags = card.get('data', {}).get('tags', None)
        if tags is None:
            tags = card.get('tags', [])
        return [t for t in tags if isinstance(t, str) and t.strip() != '']
    return None


def find_key(obj, key):
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        for v in obj.values():
            r = find_key(v, key)
            if r is not None:
                return r
    return None


# ---- load the dictionary the extension actually used -----------------------
settings = json.load(open(SETTINGS))
ctm = find_key(settings, 'CharacterTools') or {}
mapping = ctm.get('mapping', {})
removed_tags = ctm.get('removedTags', [])

variant_to_canon = {}
for canon, variants in mapping.items():
    variant_to_canon[canon.lower()] = canon
    for v in variants:
        variant_to_canon[v.lower()] = canon
removed_set = {t.lower() for t in removed_tags}

overlap = sorted(set(variant_to_canon) & removed_set)
if overlap:
    print(f'WARNING: {len(overlap)} tag(s) are in BOTH a group and removedTags '
          f'(extension drops these): {overlap[:10]}')


def apply_rows(tags):
    """Mirror tag-analysis.js applyRowsToTags: drop removed, rename to canonical,
    dedupe case-insensitively (first wins), preserve order."""
    out, seen = [], set()
    for t in tags:
        low = t.lower()
        if low in removed_set:
            continue
        tag = variant_to_canon.get(low, t)
        l2 = tag.lower()
        if l2 in seen:
            continue
        seen.add(l2)
        out.append(tag)
    return out


# ---- compare every card ----------------------------------------------------
mismatches = []
changed = unchanged = skipped = 0
total = 0

for orig_png in sorted(ORIG.glob('*.png')):
    new_png = NEW / orig_png.name
    if not new_png.exists():
        skipped += 1
        continue
    orig = card_tags(orig_png)
    new = card_tags(new_png)
    if orig is None or new is None:
        skipped += 1
        continue
    total += 1
    expected = apply_rows(orig)
    if expected != new:
        mismatches.append((orig_png.name, orig, expected, new))
    if orig != new:
        changed += 1
    else:
        unchanged += 1

print(f'\nDictionary: {len(mapping)} canonicals, {len(removed_tags)} removed tags')
print(f'Cards compared : {total}')
print(f'  changed      : {changed}')
print(f'  unchanged    : {unchanged}')
print(f'  skipped      : {skipped} (missing pair or unreadable)')
print(f'Mismatches     : {len(mismatches)}')

for name, orig, expected, new in mismatches[:15]:
    print(f'\n  ✗ {name}')
    print(f'      original : {orig}')
    print(f'      expected : {expected}')
    print(f'      actual   : {new}')
    exp_set, new_set = set(expected), set(new)
    if exp_set - new_set:
        print(f'      missing from card : {sorted(exp_set - new_set)}')
    if new_set - exp_set:
        print(f'      extra on card     : {sorted(new_set - exp_set)}')

if not mismatches:
    print('\n✓ All cards match the expected transform — extension applied correctly.')
else:
    print(f'\n✗ {len(mismatches)} card(s) differ from the expected transform.')
    sys.exit(1)
