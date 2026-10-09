const UNSTUBBABLE_EXPORTS = new Set([
  'createError',
  'isNuxtError',
  'useRuntimeConfig',
  'useAppConfig',
])

type Callable = (...args: unknown[]) => unknown

/**
 * Wraps the real `nuxt/server` module so a spec can still replace a helper
 * with `vi.stubGlobal(name, ...)`. A stubbed global wins over the real
 * helper; otherwise the real one runs against the web-standard event.
 */
export function withGlobalStubOverrides(
  actual: Record<string, unknown>,
): Record<string, unknown> {
  const wrapped: Record<string, unknown> = {}

  for (const [name, value] of Object.entries(actual)) {
    if (typeof value !== 'function' || UNSTUBBABLE_EXPORTS.has(name)) {
      wrapped[name] = value

      continue
    }

    wrapped[name] = (...args: unknown[]) => {
      const stub = (globalThis as Record<string, unknown>)[name]
      const implementation = typeof stub === 'function' ? stub : value

      return (implementation as Callable)(...args)
    }
  }

  return wrapped
}
