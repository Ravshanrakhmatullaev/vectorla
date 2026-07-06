const noiseSvg =
  "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>" +
  "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter>" +
  "<rect width='100%' height='100%' filter='url(#n)'/></svg>"

const noiseBackgroundImage = `url("data:image/svg+xml,${encodeURIComponent(noiseSvg)}")`

/**
 * Single illustration (an original bird, facing right) rendered twice — once with a
 * "raster" filter (blur, lower contrast, desaturation, grain) and once crisp/vibrant —
 * so the before/after slider reveals one continuous artwork instead of two images.
 */
export function BeforeAfterArt({ crisp }: { crisp: boolean }) {
  return (
    <div className="relative h-full w-full">
      <svg
        viewBox="0 0 240 240"
        className="h-full w-full"
        style={{
          filter: crisp
            ? 'saturate(1.35) contrast(1.08)'
            : 'blur(1.6px) saturate(0.4) contrast(0.8) brightness(0.97)',
        }}
      >
        {/* branch */}
        <rect x="18" y="188" width="204" height="13" rx="6.5" fill="#8B5E3C" />

        {/* leaves */}
        <path d="M28 188 C 17 179, 12 166, 22 158 C 33 168, 32 180, 28 188 Z" fill="#4CAF6D" />
        <path d="M208 188 C 219 180, 223 167, 213 159 C 203 169, 203 181, 208 188 Z" fill="#3F9B5C" />

        {/* tail feathers (opposite the beak) */}
        <path
          d="M100 152 C 64 166, 34 189, 16 206 C 42 197, 74 178, 105 163 Z"
          fill="#0B7285"
        />
        <path
          d="M104 158 C 74 170, 52 187, 38 199 C 62 191, 88 176, 110 164 Z"
          fill="#12909D"
        />

        {/* body */}
        <ellipse cx="112" cy="140" rx="58" ry="55" fill="#0EA5A4" />

        {/* folded wing */}
        <path
          d="M88 108 C 58 119, 52 154, 78 176 C 99 165, 114 139, 108 113 Z"
          fill="#0B7285"
        />
        <path
          d="M93 119 C 76 128, 72 150, 88 165 C 99 155, 104 137, 99 121 Z"
          fill="#3FC1CD"
        />

        {/* belly */}
        <ellipse cx="126" cy="169" rx="31" ry="25" fill="#FFE8B8" />

        {/* feet hint */}
        <rect x="108" y="186" width="16" height="8" rx="3" fill="#12212B" opacity="0.85" />

        {/* head crest */}
        <path d="M158 76 L165 56 L172 78 Z" fill="#FF6B6B" />
        <path d="M170 78 L176 62 L182 80 Z" fill="#FF8C61" />

        {/* head */}
        <circle cx="172" cy="106" r="34" fill="#0B93A0" />

        {/* eye */}
        <circle cx="186" cy="96" r="10" fill="#FFFFFF" />
        <circle cx="189" cy="96" r="5" fill="#12212B" />
        <circle cx="191" cy="93" r="1.6" fill="#FFFFFF" opacity="0.9" />

        {/* beak */}
        <path
          d="M198 98 C 216 90, 233 94, 239 109 C 233 118, 216 122, 199 117 C 195 111, 195 103, 198 98 Z"
          fill="#FF9F1C"
        />
        <path
          d="M222 98 C 230 98, 236 102, 239 109 C 235 113, 227 116, 219 114 C 219 108, 220 102, 222 98 Z"
          fill="#FFD166"
        />
        <path
          d="M199 117 C 213 121, 227 118, 236 111"
          stroke="#C97514"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
      </svg>

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
