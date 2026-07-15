# Development

## File layout

| File | Purpose |
|------|---------|
| `index.js` | Entry point; the panel, orchestration, and dictionary settings. |
| `api.js` | Thin client for the server plugin (`/api/plugins/character-tools/*`), incl. the SSE progress reader. |
| `ui-editor.js` | The tag dictionary editor modal (curation only; applying is the server's job). |
| `tag-analysis.js` | Pure tag logic (`norm`, `buildBuckets`) used by the editor. |
| `tag-dictionary.json` | Shipped base dictionary (categories → canonical → variants, plus `removedTags`); seed for new installs. |
| `style.css` | Editor modal styling (theme-aware). |
| `.claude/skills/categorize-tags/` | Skill for slotting newly-discovered tags into the dictionary. |

## Testing

```bash
npm install
npm test
```

## Maintaining the shipped dictionary

`tag-dictionary.json` is the hand-curated taxonomy (~350 canonicals across ~19 facets) that seeds new installs. New tags discovered from a corpus are slotted in with the `categorize-tags` skill; see `.claude/skills/categorize-tags/SKILL.md`.
