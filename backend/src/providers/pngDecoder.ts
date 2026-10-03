/**
 * PNG decode with a fresh WebAssembly instance per call.
 *
 * @jsquash/png's wasm-bindgen glue keeps one module-level instance for the
 * life of the isolate, and a WebAssembly memory only ever grows: after one
 * 4 MP PNG it holds ~39 MB that is never released (re-calling its init()
 * is a no-op). This is the same glue reduced to what decode() needs, with
 * all state local to one call, so the instance and its memory become
 * garbage as soon as the decode returns.
 *
 * Derived from @jsquash/png 3.1.1 codec/pkg/squoosh_png.js (wasm-bindgen
 * output, Apache-2.0, Copyright 2020 Google Inc.). The import names are the
 * hashed symbols that exact build of squoosh_png_bg.wasm expects; a version
 * bump of @jsquash/png must re-check them (imageDecoder.smoke-test decodes
 * real PNGs through this path).
 */
export function decodePngFresh(module: WebAssembly.Module, bytes: ArrayBuffer): ImageData {
  // wasm-bindgen's JS-side object table for this instance only.
  const heap: unknown[] = new Array(128).fill(undefined)
  heap.push(undefined, null, true, false)
  let heapNext = heap.length
  const addHeapObject = (obj: unknown): number => {
    if (heapNext === heap.length) heap.push(heap.length + 1)
    const idx = heapNext
    heapNext = heap[idx] as number
    heap[idx] = obj
    return idx
  }
  const takeObject = (idx: number): unknown => {
    const ret = heap[idx]
    if (idx >= 132) {
      heap[idx] = heapNext
      heapNext = idx
    }
    return ret
  }

  let exports: {
    memory: WebAssembly.Memory
    __wbindgen_malloc(size: number, align: number): number
    __wbindgen_free(ptr: number, size: number, align: number): void
    decode(ptr: number, len: number): number
  }
  const bytesOf = () => new Uint8Array(exports.memory.buffer)
  const imports = {
    wbg: {
      __wbindgen_memory: () => addHeapObject(exports.memory),
      __wbg_buffer_a448f833075b71ba: (arg0: number) => addHeapObject((heap[arg0] as WebAssembly.Memory).buffer),
      __wbg_newwithbyteoffsetandlength_099217381c451830: (arg0: number, arg1: number, arg2: number) =>
        addHeapObject(new Uint16Array(heap[arg0] as ArrayBuffer, arg1 >>> 0, arg2 >>> 0)),
      __wbindgen_object_drop_ref: (arg0: number) => {
        takeObject(arg0)
      },
      __wbg_newwithownedu8clampedarrayandsh_91db5987993a08fb: (arg0: number, arg1: number, arg2: number, arg3: number) => {
        const ptr = arg0 >>> 0
        const pixels = new Uint8ClampedArray(exports.memory.buffer).slice(ptr, ptr + arg1)
        exports.__wbindgen_free(arg0, arg1, 1)
        return addHeapObject(makeImageData(pixels, arg2 >>> 0, arg3 >>> 0))
      },
      __wbindgen_throw: (arg0: number, arg1: number) => {
        const ptr = arg0 >>> 0
        throw new Error(new TextDecoder().decode(bytesOf().subarray(ptr, ptr + arg1)))
      },
    },
  }
  const instance = new WebAssembly.Instance(module, imports)
  exports = instance.exports as unknown as typeof exports

  const input = new Uint8Array(bytes)
  const ptr = exports.__wbindgen_malloc(input.length, 1) >>> 0
  bytesOf().set(input, ptr)
  const image = takeObject(exports.decode(ptr, input.length)) as ImageData | undefined
  if (!image) throw new Error('Decoding error.')
  return image
}

/** Workers has no ImageData; the jsquash glue polyfills it, but don't depend on import order. */
function makeImageData(data: Uint8ClampedArray, width: number, height: number): ImageData {
  const Ctor = (globalThis as { ImageData?: new (data: Uint8ClampedArray, width: number, height: number) => ImageData }).ImageData
  return Ctor ? new Ctor(data, width, height) : ({ data, width, height, colorSpace: 'srgb' } as ImageData)
}
