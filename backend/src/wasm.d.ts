// Wrangler's bundler compiles a direct `.wasm` import to a WebAssembly.Module
// at build time (see src/index.ts) — this just satisfies the type checker.
declare module '*.wasm' {
  const module: WebAssembly.Module
  export default module
}
