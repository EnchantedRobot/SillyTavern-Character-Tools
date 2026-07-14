# How it works

## Fix Characters

For every card in `data/{user}/characters/`, the server does two things in a single decode/write:

1. **Repair the card** — a lightweight, conservative upgrade: V2→V3, backfill required V3 fields, and fix malformed template tokens (`{char}` → `{{char}}`, broken pronoun aliases → `{{user}}`). It never rewrites prose or clears prompts.
2. **Compress the image** — quantized with pngquant, oversized cards downscaled, with the embedded card JSON preserved (character cards are never converted to WEBP, which can't carry the metadata).

Fix Characters deliberately **leaves tags alone** — merging tags is a separate, opt-in step (see below). A card is rewritten whenever it was repaired or the image shrank, so nothing is ever lost. Files already processed are skipped on repeat runs.

The extension is the driver: it decides *what* to do and hands the work to the server plugin, which does all the file surgery. See the server's [Architecture](https://github.com/EnchantedRobot/SillyTavern-Character-Tools-Server/blob/main/docs/architecture.md) doc for the exact repair rules.

## The tag dictionary & Apply Tags

Tags are driven by a **persistent dictionary** that maps each messy variant onto one clean canonical tag, plus a list of junk tags to remove. You curate it in **Edit Tag Dictionary** — a three-list editor (canonical + merged variants, unassigned, removed) where clicking a tag moves it between buckets. Every edit saves automatically.

Curating never touches your cards. When you're ready, hit **Apply Tags** in the editor's footer: that runs the same character pass as Fix Characters but **with your dictionary attached**, so each card's tags are rewritten (each messy variant → its clean canonical, junk deleted, duplicates collapsed) *and* the card is repaired and compressed — all in one pass per card.

The dictionary is owned entirely by the extension (stored in your extension settings, seeded from the shipped `tag-dictionary.json`) and handed to the server only on an **Apply Tags** run. That means **curating tags never requires restarting the server**. Applying is idempotent — re-running Apply Tags on already-clean cards changes nothing — and because the server records which dictionary a card was last processed under, **editing the dictionary automatically re-runs every card** on the next apply.

## Compress Images (sidecar)

**Compress Images** compresses `data/{user}/user/images/` (your chat gallery): PNG/JPG are re-encoded, and where it helps, converted to WEBP and downscaled. This is independent of the character pass.

## Stats & Reprocess

- **Stats** — file counts and sizes for both directories, without changing anything.
- **Reprocess Characters / Images** — clears the skip-state and re-runs from scratch.

## Example Apply Tags run summary

```
Scanned:    1,842
Skipped:    1,204
Compressed: 638
Repaired:   57
Tags fixed: 431
Saved:      312.4 MB
```

A plain **Fix Characters** run looks the same without the **Tags fixed** line.
