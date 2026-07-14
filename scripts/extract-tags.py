#!/usr/bin/env python3
"""
Scan a folder of SillyTavern character-card PNGs and dump every tag found into a
single JSON file under "allTags".

Character cards embed their JSON in a PNG tEXt/zTXt chunk keyed "chara" (base64).
Tags live at data.tags (Card V2/V3) or tags (V1). Stdlib only - no Pillow.

Usage:
    python3 scripts/extract-tags.py [CARDS_DIR] [-o OUTPUT.json]
Defaults: CARDS_DIR=~/Downloads/characters, OUTPUT=card-tags.json
"""
import argparse, base64, binascii, json, struct, sys, zlib
from pathlib import Path

PNG_SIG = b'\x89PNG\r\n\x1a\n'


def iter_text_chunks(data):
    """Yield (keyword, text) for every tEXt and zTXt chunk in PNG bytes."""
    if not data.startswith(PNG_SIG):
        return
    pos = len(PNG_SIG)
    while pos + 8 <= len(data):
        (length,) = struct.unpack('>I', data[pos:pos + 4])
        ctype = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        pos += 12 + length  # 4 len + 4 type + body + 4 crc
        if ctype == b'tEXt':
            kw, _, text = body.partition(b'\x00')
            yield kw.decode('latin-1'), text.decode('latin-1')
        elif ctype == b'zTXt':
            kw, _, rest = body.partition(b'\x00')
            if rest:  # rest = 1-byte compression method + compressed text
                try:
                    yield kw.decode('latin-1'), zlib.decompress(rest[1:]).decode('latin-1')
                except zlib.error:
                    pass
        elif ctype == b'IEND':
            break


def card_tags(png_path):
    """Return the list of tags embedded in one card PNG (empty if none/unreadable)."""
    raw = png_path.read_bytes()
    for kw, text in iter_text_chunks(raw):
        if kw.lower() != 'chara':
            continue
        try:
            decoded = base64.b64decode(text)
            card = json.loads(decoded)
        except (binascii.Error, json.JSONDecodeError, UnicodeDecodeError):
            continue
        tags = card.get('data', {}).get('tags') or card.get('tags') or []
        return [t for t in tags if isinstance(t, str)]
    return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cards_dir', nargs='?', default='~/Downloads/characters')
    ap.add_argument('-o', '--output', default='card-tags.json')
    ap.add_argument('--unique', action='store_true',
                    help='deduplicate allTags (default keeps every occurrence)')
    args = ap.parse_args()

    cards_dir = Path(args.cards_dir).expanduser()
    if not cards_dir.is_dir():
        sys.exit(f'not a directory: {cards_dir}')

    pngs = sorted(cards_dir.glob('*.png'))
    all_tags, with_tags, failed = [], 0, 0
    for p in pngs:
        try:
            tags = card_tags(p)
        except Exception as e:  # corrupt file shouldn't abort the whole run
            print(f'  ! {p.name}: {e}', file=sys.stderr)
            failed += 1
            continue
        if tags:
            with_tags += 1
            all_tags.extend(tags)

    if args.unique:
        seen, deduped = set(), []
        for t in all_tags:
            if t not in seen:
                seen.add(t)
                deduped.append(t)
        all_tags = deduped

    out = {
        'cardCount': len(pngs),
        'cardsWithTags': with_tags,
        'tagCount': len(all_tags),
        'allTags': all_tags,
    }
    Path(args.output).write_text(json.dumps(out, indent=2, ensure_ascii=False))
    print(f'scanned {len(pngs)} PNGs ({with_tags} had tags, {failed} unreadable)')
    print(f'wrote {len(all_tags)} tags -> {args.output}')


if __name__ == '__main__':
    main()
