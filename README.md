# SillyTavern Character Tools

**Requires the companion server plugin: [SillyTavern-Character-Tools-Server](https://github.com/EnchantedRobot/SillyTavern-Character-Tools-Server)**

A SillyTavern extension that cleans up and slims down a user's character library in a **single pass**. It merges messy tags onto clean canonical ones, repairs/upgrades each character card, and compresses the card image — all in one run per card — plus a sidecar that compresses your gallery images.

This consolidates what used to be three separate projects (Image Compressor, its server plugin, and the Tag Merger) into one suite, so the workflow is one button instead of "run A, run B, re-run A."

## What it does

### Fix Characters (the main action)

For every card in `data/{user}/characters/`, the server does three things in a single decode/write:

1. **Merge tags** using your dictionary — each messy variant (`#Female`, `female`, `FEMALE`) becomes its clean canonical (`Female`); junk tags are deleted; duplicates collapse.
2. **Repair the card** — a lightweight, conservative upgrade: V2→V3, backfill required V3 fields, and fix malformed template tokens (`{char}` → `{{char}}`, broken pronoun aliases → `{{user}}`). It never rewrites prose or clears prompts.
3. **Compress the image** — quantized with pngquant, oversized cards downscaled, with the embedded card JSON preserved (character cards are never converted to WEBP, which can't carry the metadata).

A card is rewritten whenever its tags changed, it was repaired, or the image shrank — so nothing is ever lost. Files already processed are skipped on repeat runs; **editing the dictionary automatically re-runs every card** (the server tracks which dictionary a card was last processed under).

### The tag dictionary

Tags are driven by a **persistent dictionary** that maps each messy variant onto one clean canonical tag, plus a list of junk tags to remove. You curate it in **Edit Tag Dictionary** — a three-list editor (canonical + merged variants, unassigned, removed) where clicking a tag moves it between buckets. Every edit saves automatically.

The dictionary is owned entirely by the extension (stored in your extension settings, seeded from the shipped `tag-dictionary.json`) and handed to the server on each run. That means **curating tags never requires restarting the server** — only the actual apply does file work.

### Compress Images (sidecar)

**Compress Images** compresses `data/{user}/user/images/` (your chat gallery): PNG/JPG are re-encoded, and where it helps, converted to WEBP and downscaled. This is independent of the character pass.

### Stats & Reprocess

- **Stats** — file counts and sizes for both directories, without changing anything.
- **Reprocess Characters / Images** — clears the skip-state and re-runs from scratch.

## How to use

1. Install and enable the companion **server plugin** first (see its README).
2. Open the **Extensions** panel → **Character Tools**.
3. Pick a user from the dropdown (populated from your `data/` directory).
4. Optionally open **Edit Tag Dictionary** to curate what merges.
5. Click **Fix Characters**. A progress bar and log show the run; when it finishes, the log summarises tags fixed, cards repaired, and space saved:

```
Scanned:    1,842
Skipped:    1,204
Compressed: 638
Repaired:   57
Tags fixed: 431
Saved:      312.4 MB
```

> **No undo.** Fixing rewrites the card files on disk. Back up your `characters/` folder first if unsure.

## How to install

1. Install the companion server plugin first.
2. In SillyTavern, go to **Extensions → Install extension** and enter:

```
https://github.com/EnchantedRobot/SillyTavern-Character-Tools
```

Or clone it manually into your user extensions directory:

```bash
cd data/default-user/extensions
git clone https://github.com/EnchantedRobot/SillyTavern-Character-Tools
```

3. Reload SillyTavern. The panel appears under **Extensions**. If the server plugin isn't running, a warning toast appears on load.

## Files

| File | Purpose |
|------|---------|
| `index.js` | Entry point; the panel, orchestration, and dictionary settings. |
| `api.js` | Thin client for the server plugin (`/api/plugins/character-tools/*`), incl. the SSE progress reader. |
| `ui-editor.js` | The tag dictionary editor modal (curation only; applying is the server's job). |
| `tag-analysis.js` | Pure tag logic (`norm`, `buildBuckets`) used by the editor. |
| `tag-dictionary.json` | Shipped base dictionary (categories → canonical → variants, plus `removedTags`); seed for new installs. |
| `style.css` | Editor modal styling (theme-aware). |
| `scripts/` | `extract-tags.py` / `verify-apply.py` — corpus tooling for discovering and checking tags. |
| `.claude/skills/categorize-tags/` | Skill for slotting newly-discovered tags into the dictionary. |

## Maintaining the dictionary

`tag-dictionary.json` is the hand-curated taxonomy (~350 canonicals across ~19 facets). New tags discovered from a corpus are slotted in with the `categorize-tags` skill; see `.claude/skills/categorize-tags/SKILL.md`. `scripts/extract-tags.py` pulls every embedded tag out of a folder of card PNGs so you can find what isn't classified yet.

## License

MIT
