# public/demo/

Placeholder folder for demo asset images referenced by `src/data/demoAssets.ts`.

No image files exist here yet — only file paths are declared in the data
file. When real assets are added, place them here using the exact
filenames referenced by each entry's `file` field (e.g. `parrot.webp`) and
remove this note.

## Asset requirements

Each image must meet all of the following before it's added:

- **Resolution:** 2000×2000px or larger
- **Format:** WebP
- **Background:** transparent, or a clean/flat background (no clutter)
- **Style:** premium vector illustration style — not a cartoon or icon
- **Composition:** one centered object per image, no secondary subjects
- **Purpose:** must work as a before/after slider source (see
  `src/components/BeforeAfterArt.tsx`) — a single subject with enough clean
  detail to read well both blurred/desaturated ("before") and sharp/vibrant
  ("after")
