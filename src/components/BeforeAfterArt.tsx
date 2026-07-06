import { useState } from 'react'
import { useDemoAsset } from '@/lib/demoAsset'
import { cn } from '@/utils/cn'

const noiseSvg =
  "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>" +
  "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter>" +
  "<rect width='100%' height='100%' filter='url(#n)'/></svg>"

const noiseBackgroundImage = `url("data:image/svg+xml,${encodeURIComponent(noiseSvg)}")`

// TODO(backend): once real demo asset files exist at the paths declared in
// src/data/demoAssets.ts, this component needs no changes — it already reads
// the shared random pick from useDemoAsset() and renders it via <img>.
/**
 * Renders the same shared demo asset image twice — once with a "raster"
 * filter (blur, lower contrast, desaturation, grain) and once crisp/vibrant —
 * so the before/after slider reveals one continuous image instead of two.
 */
export function BeforeAfterArt({ crisp }: { crisp: boolean }) {
  const { asset } = useDemoAsset()
  const [failedToLoad, setFailedToLoad] = useState(false)

  return (
    <div className="relative h-full w-full">
      <img
        src={asset.file}
        alt={asset.alt}
        onError={() => setFailedToLoad(true)}
        className={cn('h-full w-full object-contain transition-opacity', failedToLoad && 'opacity-0')}
        style={{
          filter: crisp
            ? 'saturate(1.35) contrast(1.08)'
            : 'blur(1.6px) saturate(0.4) contrast(0.8) brightness(0.97)',
        }}
      />

      {!crisp && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.08] mix-blend-overlay"
          style={{ backgroundImage: noiseBackgroundImage, backgroundSize: '160px 160px' }}
        />
      )}
    </div>
  )
}
