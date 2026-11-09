export const DESIGN_STYLE_ATTRIBUTE = 'data-besidka-design'

export const LAYER_ORDER = '@layer properties, besidka-shell, theme, base, components, utilities;'

/**
 * Prefixes the compiled CSS with the layer order, so the runtime's own shell
 * styles (`besidka-shell`) rank below Tailwind and daisyUI wherever the
 * design `<style>` sits in the head. Artifact CSS is unlayered and always
 * wins over all of them.
 */
export function withLayerOrder(compiledCss: string): string {
  return `${LAYER_ORDER}\n${compiledCss}`
}
