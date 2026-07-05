type ClassValue = string | number | null | undefined | false | ClassValue[]

function flatten(input: ClassValue[], out: string[]) {
  for (const value of input) {
    if (!value && value !== 0) continue
    if (Array.isArray(value)) {
      flatten(value, out)
    } else {
      out.push(String(value))
    }
  }
}

/** Lightweight className combiner — avoids pulling in clsx/tailwind-merge for a small project. */
export function cn(...inputs: ClassValue[]): string {
  const out: string[] = []
  flatten(inputs, out)
  return out.join(' ')
}
