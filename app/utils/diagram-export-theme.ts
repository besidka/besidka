import type { ColorConverter } from '~/utils/diagram-export-color'

const OFFSCREEN_HOST_STYLE: string
  = 'position:fixed;left:-99999px;top:0;width:0;height:0;overflow:hidden;'
    + 'pointer-events:none;'

function toLiteralValue(
  rawValue: string,
  convertColor: ColorConverter,
): string {
  return convertColor(rawValue) ?? rawValue.replaceAll('"', '\'')
}

/**
 * Mounts a copy of the svg off-screen inside `themeElement`, so the theme's
 * `--pele-*` variables cascade into it, and reads the computed value of each
 * requested custom property. Colors become hex through `convertColor`,
 * everything else (`4px`, `bold`, font stacks) stays a literal. Names the
 * cascade leaves empty are omitted so their `var()` fallback applies.
 */
export function resolveThemeVariables(
  root: Element,
  themeElement: HTMLElement,
  names: string[],
  convertColor: ColorConverter,
): Map<string, string> {
  const resolved = new Map<string, string>()
  const host = document.createElement('div')
  const mounted = document.importNode(root, true)

  host.setAttribute('aria-hidden', 'true')
  host.setAttribute('style', OFFSCREEN_HOST_STYLE)
  host.appendChild(mounted)
  themeElement.appendChild(host)

  try {
    const computedStyle = getComputedStyle(mounted)

    for (const name of names) {
      const rawValue = computedStyle.getPropertyValue(name).trim()

      if (rawValue !== '') {
        resolved.set(name, toLiteralValue(rawValue, convertColor))
      }
    }
  } finally {
    host.remove()
  }

  return resolved
}
