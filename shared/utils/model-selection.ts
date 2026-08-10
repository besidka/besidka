/**
 * Reads the `'model'` preference, which holds a bare model id. A `{`-prefixed
 * value is a JSON selection written by a removed build; it names no real model,
 * so it degrades to `fallbackModelId` rather than leaking the raw JSON onward
 * as a literal model id and breaking the next send.
 */
export function parseModelSelection(
  raw: string | null,
  fallbackModelId: string,
): string {
  if (!raw || raw.startsWith('{')) {
    return fallbackModelId
  }

  return raw
}
