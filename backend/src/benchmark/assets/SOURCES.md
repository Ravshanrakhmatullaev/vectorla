# Benchmark asset sources and licenses

These files are used only by the offline benchmark (`npm run bench -- --corpus=real`).
They are never served to users or bundled into the Worker.

| Files | Source | License |
|---|---|---|
| `fluent/*.svg` | [Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji) (Flat and Color styles) | MIT, see `fluent/LICENSE` |
| Lucide icons (inline in `../realWorldCorpus.ts`) | [Lucide](https://lucide.dev) | ISC, Copyright (c) Lucide Icons and Contributors |
| `photos/astronaut.jpg` | scikit-image sample data: NASA photo of Eileen Collins | Public domain |
| `photos/camera.jpg` | scikit-image sample data: photo by Lav Varshney | CC0 |
| `photos/chelsea.jpg` | scikit-image sample data: photo by Stefan van der Walt | CC0 |
| `photos/coffee.jpg` | scikit-image sample data: photo by Rachel Michetti | CC0 |
| `photos/coins.jpg` | scikit-image sample data: Greek coins, Brooklyn Museum | No known copyright restrictions |
| `photos/rocket.jpg` | scikit-image sample data: SpaceX launch of DSCOVR | Public domain (released by SpaceX) |
| `photos/horse.png` | scikit-image sample data: silhouette by Andreas Preuss | CC0 |
| `photos/text.png` | scikit-image sample data: scanned text | Public domain |

The photos were re-encoded (JPEG quality 90, or 8-bit grayscale PNG) to keep the repository small.
All other benchmark images are authored in `corpus.ts` and `realWorldCorpus.ts`.
