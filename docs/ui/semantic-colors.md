# Semantic colors and contrast

The two daisyUI themes in `app/assets/css/main.css` define every semantic pair
(`--color-<name>` fill and `--color-<name>-content` text). Solid elements
(`btn-success`, `badge-success`, `alert-success`, the checked state of
`toggle-success`) read these two tokens and nothing else.

## Never patch a pair per component

When a solid element looks wrong, fix the pair in the theme. Do not add
`text-white`, `!text-*`, a custom class or an inline color to the one component
that showed the problem: every other solid element with that modifier stays
broken, and the patch hides the cause.

## The success pair (fixed 2026-11-16)

Light `success-content` was `emerald-950` on an `emerald-700` fill: 2.8:1, below
the 4.5:1 text minimum (WCAG 1.4.3), so every solid success element looked dark
on dark. It is now `emerald-50`, the same shape as info (`sky-700` / `sky-100`).

| Theme | Fill | Content | Contrast |
| --- | --- | --- | --- |
| light | emerald-700 | emerald-50 | 5.1:1 |
| dark | emerald-200 | emerald-950 | 11.8:1 |

Ratios are the WCAG formula over Tailwind's OKLCH values, the same computation
`tests/unit/workers/artifacts-runtime/design.spec.ts` runs for every semantic
pair in both themes (content at 4.5:1 on its fill, fill at 3:1 against
`base-100`). The artifacts runtime no longer overrides this token.

## Soft variants for state, and why `btn-soft` alone failed on a radio

A selected or active state that must not shout uses the soft variants
(`btn-soft btn-success`, `btn-soft btn-warning`, `btn-soft btn-error`,
`badge-soft badge-success`). Badges use daisyUI modifiers only, never `text-*`
overrides.

daisyUI treats `[aria-checked="true"]`, `[aria-pressed="true"]` and a valid
`[aria-current]` on a `.btn` like `.btn-active`: a solid fill of the color
modifier, darkened by 5%, with its content color. That rule has higher
specificity than `.btn-soft`, so a `role="radio"` button with
`btn-soft btn-success` renders solid. The shared permission control
(`app/components/ui/ToolPermissions/ModeControl.vue`) needs `aria-checked`, so
its checked mode adds `btn-soft-selected` (a utility in `main.css` that
restates the soft background, border and text color at a 16% and 28% tint) next
to `btn-soft` and the color modifier: Always allow `btn-success`, Needs
approval `btn-warning`, Blocked `btn-error`. Use the same pair for any other
toggle that carries an ARIA checked or pressed state and should look soft.
