# Vectorla redesign concepts (round 1)

Three design directions for the landing page and the signed-in workspace,
built as standalone prototypes. They are not part of the app build and are
not deployed; the live and staging sites are unchanged.

| File | Concept |
|---|---|
| `contour.html` | A · Contour: precision light, three-pane workspace, Outlines view |
| `nightshift.html` | B · Nightshift: dark studio, loupe, floating tools, ⌘K palette |
| `naqsh.html` | C · Naqsh: porcelain and cobalt, girih geometry, guided three-step workspace |
| `index.html` | Overview, screenshots, comparison and recommendation |

View them over HTTP (the outline views fetch the SVGs):

```bash
cd design/concepts && python3 -m http.server 8765
# open http://127.0.0.1:8765/
```

Every page has Landing, Workspace (`#app`) and History (`#history`) views,
EN/UZ/RU and light/dark. Query parameters for screenshots: `?lang=uz`,
`?theme=dark`, `?shot=1` (hides the prototype bar, no animation).

- `samples/`: real Vectorla traces (Quick and Professional) of nine sample
  images, with measured stats in `samples.json`. Regenerate from `backend/`:
  `npx tsx ../design/concepts/tools/trace-samples.ts ../design/concepts/samples`,
  then rebuild `shared/samples.js` from `samples/samples.json`.
  Sample sources: Vectorla benchmark test designs; Microsoft Fluent Emoji
  (MIT, `backend/src/benchmark/assets/fluent/LICENSE`); scikit-image sample
  photos (CC0).
- `shared/`: product strings (EN/UZ/RU), sample metadata, example account
  data (marked as example data in the UI), icons, and the prototype runtime
  (routing, compare slider, synchronized zoom and pan, file drop validation).
- `shots/`: screenshots of each concept (desktop and phone, both themes,
  all three languages).
