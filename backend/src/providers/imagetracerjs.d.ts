// imagetracerjs ships no type declarations and there's no @types package —
// this declares only the surface PlaceholderProvider actually uses.
declare module 'imagetracerjs' {
  interface ImageTracerOptions {
    ltres?: number
    qtres?: number
    pathomit?: number
    rightangleenhance?: boolean
    colorsampling?: number
    numberofcolors?: number
    mincolorratio?: number
    colorquantcycles?: number
    scale?: number
    roundcoords?: number
    [key: string]: unknown
  }

  interface ImageTracerImageData {
    width: number
    height: number
    data: Uint8ClampedArray
  }

  interface ImageTracer {
    imagedataToSVG(imageData: ImageTracerImageData, options?: ImageTracerOptions): string
  }

  const tracer: ImageTracer
  export default tracer
}
