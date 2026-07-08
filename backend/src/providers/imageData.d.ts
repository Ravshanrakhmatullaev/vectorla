// Our tsconfig deliberately doesn't include the "dom" lib (Workers isn't a
// browser — pulling in the whole DOM lib would conflict with
// @cloudflare/workers-types' own Request/Response/etc. declarations). jSquash's
// decoders return the browser ImageData shape, so this declares just that one
// type rather than the whole lib. jSquash itself polyfills the *runtime*
// global (see squoosh_png.js) when running in Node/Workers — this only
// satisfies the type checker.
declare global {
  interface ImageData {
    readonly width: number
    readonly height: number
    readonly data: Uint8ClampedArray
  }
}

export {}
