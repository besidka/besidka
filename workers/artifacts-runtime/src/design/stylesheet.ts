import { BESIDKA_THEME_CSS } from './theme.generated.ts'

export interface DesignFontFace {
  weight: number
  unicodeRange: string
  url: string
}

export const DESIGN_FONT_FAMILY = 'Nunito'

export const BESIDKA_COMPONENT_OVERRIDES = `
@layer base {
  body {
    font: inherit;
  }
}

@layer utilities {
  .checkbox {
    --size-selector: .25rem;
    --radius-selector: .5rem;
  }

  .badge {
    --size-selector: 0.1875rem;
  }

  :where(.textarea) {
    border-radius: var(--radius-box);
  }

  .tooltip::before {
    --radius-field: .25rem;
  }

  .btn {
    font-weight: 400;
  }

  .btn {
    outline-color: var(--custom-outline-color, var(--btn-color));

    @variant dark {
      &.btn-neutral {
        --custom-outline-color: var(--color-neutral-content);
      }
    }
    &.btn-outline {
      &:not(:hover):not(:focus-visible):not(:active) {
        @variant dark {
          &.btn-neutral {
            --btn-color: var(--color-neutral-content);
          }
        }
      }

      @media (hover: none) {
        &:hover:not(:focus-visible):not(:active) {
          @variant dark {
            &.btn-neutral {
              --btn-color: var(--color-neutral-content);
            }
          }
        }
      }
    }
  }

  :where([data-theme="dark"]) .text-base-content\\/60 {
    color: color-mix(in oklab, var(--color-base-content) 75%, transparent);
  }

  :where([data-theme="dark"]) .text-base-content\\/70 {
    color: color-mix(in oklab, var(--color-base-content) 85%, transparent);
  }

  :where([data-theme="dark"]) :is(.label, .fieldset-label) {
    color: color-mix(in oklab, var(--color-base-content) 75%, transparent);
  }
}
`.trim()

const DESIGN_VARIANTS = `
@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));
@custom-variant light (&:where([data-theme=light], [data-theme=light] *));
`.trim()

function renderFontFaces(fontFaces: readonly DesignFontFace[]): string {
  return fontFaces.map((fontFace) => {
    return [
      '@font-face {',
      `  font-family: '${DESIGN_FONT_FAMILY}';`,
      '  font-style: normal;',
      '  font-display: swap;',
      `  font-weight: ${fontFace.weight};`,
      `  src: url('${fontFace.url}') format('woff2');`,
      `  unicode-range: ${fontFace.unicodeRange};`,
      '}',
    ].join('\n')
  }).join('\n')
}

/**
 * The Tailwind input for artifacts: Tailwind 4 (preflight, theme,
 * utilities), the daisyUI 5 plugin without its built-in themes, the Besidka
 * light and dark themes generated from main.css, `dark:`/`light:` variants
 * that follow the host theme on `<html data-theme>`, Nunito as the sans font
 * and the few component overrides main.css applies app-wide.
 */
export function createDesignInputCss(
  fontFaces: readonly DesignFontFace[],
): string {
  return [
    '@import "tailwindcss";',
    '@plugin "daisyui" {\n  themes: false;\n  logs: false;\n}',
    BESIDKA_THEME_CSS,
    DESIGN_VARIANTS,
    `@theme {\n  --font-sans: '${DESIGN_FONT_FAMILY}', ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji';\n}`,
    renderFontFaces(fontFaces),
    BESIDKA_COMPONENT_OVERRIDES,
  ].join('\n\n')
}
