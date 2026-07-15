# How it works

## Fix Characters

For every card in `data/{user}/characters/`, the server does two things in a single decode/write:

1. **Repair the card** — a lightweight, conservative upgrade: V2→V3, backfill required V3 fields, and fix malformed template tokens (`{char}` → `{{char}}`, broken pronoun aliases → `{{user}}`). It never rewrites prose or clears prompts.
2. **Compress the image** — quantized with pngquant, oversized cards downscaled, with the embedded card JSON preserved (character cards are never converted to WEBP, which can't carry the metadata).

Fix Characters deliberately **leaves tags alone** — merging tags is a separate, opt-in step (see below). A card is rewritten whenever it was repaired or the image shrank, so nothing is ever lost. Files already processed are skipped on repeat runs.

The extension is the driver: it decides *what* to do and hands the work to the server plugin, which does all the file surgery. See the server's [Architecture](https://github.com/EnchantedRobot/SillyTavern-Character-Tools-Server/blob/main/docs/architecture.md) doc for the exact repair rules.

## The tag dictionary & Apply Tags

Tags are driven by a **persistent dictionary** that maps each messy variant onto one clean canonical tag, plus a list of junk tags to remove. You curate it in **Edit Tag Dictionary** — a three-list editor (canonical + merged variants, unassigned, removed) where clicking a tag moves it between buckets. Every edit saves automatically.

The editor's tag counts and its "unassigned" discovery are surveyed from the **user selected in the panel**: opening the editor asks the server to scan that user's `characters/` (via `/character-tags`), so what you curate matches the user Apply Tags will run against. (SillyTavern's in-browser character list only ever holds the *logged-in* user, so the editor asks the server instead of reading it.) The dictionary itself is global — the selected user only scopes the counts and the apply.

Curating never touches your cards. When you're ready, hit **Apply Tags** in the editor's footer: the dictionary goes to the server, which rewrites each card's tags (each messy variant → its clean canonical, junk deleted, duplicates collapsed).

**Apply Tags rewrites tags and nothing else.** It doesn't repair cards and it doesn't touch images — the card's image data is carried across byte-for-byte, so there's no re-compression. That's what makes it cheap enough to re-run whenever you like; repair and compression live behind **Fix Characters**, which in turn never touches tags. The two passes are fully independent, and neither can undo or slow the other.

The dictionary is owned entirely by the extension (stored in your extension settings, seeded from the shipped `tag-dictionary.json`) and handed to the server only on an **Apply Tags** run. That means **curating tags never requires restarting the server**. There's no skip-state to manage and no Reprocess button: the server checks each card against the dictionary and rewrites only the ones that actually change. So an apply is always complete (an edited dictionary re-tags every card that needs it) *and* idempotent (re-applying an unchanged dictionary writes nothing at all).

Once your dictionary has settled, a typical apply leaves the overwhelming majority of cards untouched — only the handful that actually had a messy tag get rewritten.

**Tip:** on a fresh library, run **Apply Tags** *before* **Fix Characters**. Retagging a card changes it, so Fix Characters will pick it up on its next run either way; doing tags first means those cards are compressed once, in the pass that was going to run anyway.

## Compress Images (sidecar)

**Compress Images** compresses `data/{user}/user/images/` (your chat gallery): PNG/JPG are re-encoded, and where it helps, converted to WEBP and downscaled. This is independent of the character pass.

## Stats & Reprocess

- **Stats** — file counts and sizes for both directories, without changing anything.
- **Reprocess Characters / Images** — clears the skip-state and re-runs from scratch. Apply Tags has no equivalent because it keeps no skip-state.

## Example run summaries

**Fix Characters** — repair + compression, no tags:

```
Scanned:    1,842
Skipped:    1,204
Compressed: 638
Repaired:   57
Saved:      312.4 MB
```

**Apply Tags** — tags only, so there are no bytes to report. "Unchanged" is the cards the dictionary had nothing to do to:

```
Scanned:    1,842
Unchanged:  1,411
Tags fixed: 431
```
