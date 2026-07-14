# SillyTavern Character Tools

**Requires the companion server plugin: [SillyTavern-Character-Tools-Server](https://github.com/EnchantedRobot/SillyTavern-Character-Tools-Server)**

A SillyTavern extension that cleans up and slims down your character library in a **single pass** — merging messy tags onto clean canonical ones, repairing/upgrading each character card, and compressing the card image, all in one run per card — plus a sidecar that compresses your gallery images.

It consolidates three former projects (Image Compressor, its server plugin, and the Tag Merger) into one suite, so the workflow is one button instead of "run A, run B, re-run A."

## Installation

1. Install and enable the companion **server plugin** first (see its README).
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

## Usage

Open the **Extensions** panel → **Character Tools**, pick a user from the dropdown (populated from your `data/` directory), then use any of:

- **Fix Characters** — the main action. For every card, the server merges tags, repairs/upgrades the card, and compresses the image in a single pass. A progress bar and log show the run and summarise tags fixed, cards repaired, and space saved.
- **Edit Tag Dictionary** — curate what merges. A three-list editor (canonical + merged variants, unassigned, removed) where clicking a tag moves it between buckets. Every edit saves automatically; no server restart needed.
- **Compress Images** — sidecar that compresses your chat gallery (`user/images/`), independent of the character pass.
- **Stats** — file counts and sizes for both directories, without changing anything.
- **Reprocess Characters / Images** — clear the skip-state and re-run from scratch.

> **No undo.** Fixing rewrites the card files on disk. Back up your `characters/` folder first if unsure.

## Docs

- [How it works](docs/how-it-works.md) — the single-pass fix in depth, plus how the tag dictionary is stored and applied.
- [Development](docs/development.md) — file layout, internals, and maintaining the shipped dictionary.

## License

MIT
