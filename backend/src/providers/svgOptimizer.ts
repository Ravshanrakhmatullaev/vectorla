/**
 * Post-processes ImageTracer.js's raw SVG output: strips degenerate/empty
 * paths and groups it can leave behind, and normalizes the root <svg>'s
 * width/height/viewBox to the real source dimensions. String/regex-based
 * on purpose — Workers has no DOM/XML-parser API, and this output is
 * simple/flat enough (no nested transforms, no namespaces beyond the
 * default) that a full XML parser would be overkill.
 */
export function optimizeSvg(svg: string, dimensions: { width: number; height: number }): string {
  let result = svg

  // Remove paths with no actual drawing commands (empty or whitespace-only `d`).
  result = result.replace(/<path\b[^>]*\sd="\s*"[^>]*\/>/g, '')

  // Remove empty groups — repeat until stable, since removing an inner empty
  // group can leave its parent group empty too.
  let previous: string
  do {
    previous = result
    result = result.replace(/<g\b[^>]*>\s*<\/g>/g, '')
  } while (result !== previous)

  // Normalize dimensions: one authoritative width/height/viewBox on the root
  // element, matching the actual decoded image size (not whatever scale
  // option produced).
  result = result.replace(/<svg\b([^>]*)>/, (_match, attrs: string) => {
    const cleanedAttrs = attrs
      .replace(/\s(width|height|viewBox)="[^"]*"/g, '')
      .trim()
    const prefix = cleanedAttrs.length > 0 ? ` ${cleanedAttrs}` : ''
    return `<svg${prefix} width="${dimensions.width}" height="${dimensions.height}" viewBox="0 0 ${dimensions.width} ${dimensions.height}">`
  })

  return result.trim()
}

/** Counts `<path` elements — used to report path-count metrics (see smoke tests), not part of the stored output. */
export function countPaths(svg: string): number {
  return (svg.match(/<path\b/g) ?? []).length
}
