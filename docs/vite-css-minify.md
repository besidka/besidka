# Vite CSS minifier: why we pin `esbuild` instead of Vite 8's new default

`nuxt.config.ts` sets:

```ts
vite: {
  build: {
    cssMinify: 'esbuild',
  },
},
```

This pins Vite's CSS minifier back to `esbuild` (Vite 7's own default).
Without it, Vite 8 silently breaks this app's light theme in production
builds only — dev, typecheck, unit tests, and Playwright's dev-server e2e
suite all stay green, because the bug only manifests in the minified
production CSS bundle.

## What actually broke

Nuxt 4.5.0 pulled Vite 8.1.5 (up from 7.3.6) as a transitive dependency.
Vite 8 changed its **default** `build.cssMinify` for client production
builds from `'esbuild'` to `'lightningcss'`. Everything else in the CSS
pipeline — `tailwindcss`, `daisyui`, `@tailwindcss/vite`, and even
`lightningcss` itself — stayed at the exact same pinned versions across
the upgrade. Only Vite's own default changed.

DaisyUI defines this project's custom `light` theme by reusing DaisyUI's
own built-in theme name (the documented way to override a stock theme):

```css
@plugin "daisyui/theme" {
  name: "light";
  default: true;
  --color-primary: var(--color-stone-800);
  /* ... */
}
```

DaisyUI's generated stock rule for `light` includes a
`:root:has(input.theme-controller[value="light"]:checked)` selector
branch (for its checkbox-based theme switcher, unused by this app but
still emitted by DaisyUI) alongside the plain `[data-theme="light"]`
branch this app actually relies on. On Vite 7 / esbuild, these stayed a
plain comma-separated selector list — each branch keeps its own
specificity when matching, so our later, same-specificity custom
override correctly won the cascade.

Lightning CSS's minifier merges adjacent rules that share identical
declarations into one, joining their selectors with `:is()`. Per the CSS
Selectors spec, `:is()`'s specificity is the **maximum specificity across
all its branches**, not the specificity of whichever branch actually
matched. That inflated the merged stock rule's effective specificity for
`[data-theme="light"]` far above our custom override's plain selector —
so DaisyUI's stock (indigo) colors won outright, regardless of source
order, even though our override was declared later. `dark` was unaffected
because both its stock and custom rule get the identical `:is()`
treatment and still tie normally.

Confirmed via a matching, still-open upstream report:
[daisyui#4488](https://github.com/saadeghi/daisyui/issues/4488), and the
underlying Lightning CSS specificity behavior:
[lightningcss#1159](https://github.com/parcel-bundler/lightningcss/issues/1159),
[lightningcss#891](https://github.com/parcel-bundler/lightningcss/issues/891).
Neither is fixed upstream as of this writing — there is no version bump
that resolves it.

## When to prefer `lightningcss` over `esbuild`

Lightning CSS is a legitimately better minifier in most projects: it's
Rust-based (faster), and produces smaller output than esbuild's simpler
CSS minifier via more aggressive optimizations (shorthand property
merging, tighter color minification, and the same-declaration rule
merging that caused this bug). Prefer `lightningcss` when:

- Your CSS is hand-authored or comes from a single tool whose selector
  shapes you fully control, so you can audit whether any two rules with
  identical declarations differ in cascade-sensitive ways.
- CSS payload size is a real, measured bottleneck for the app.
- The upstream issues above are fixed (check both changelogs before
  reconsidering).

Prefer `esbuild` (this project's current pin) whenever the CSS pipeline
combines multiple independently-generated selector sets you don't fully
control — e.g. a component-library plugin (DaisyUI) layered under a
utility framework (Tailwind) — since you can't audit every selector shape
those tools might emit, and Lightning CSS's rule-merge optimization is
provably not cascade-neutral in that situation. esbuild's minifier does
not perform this optimization, so it can't reintroduce the bug; the cost
is marginally larger (not less correct) minified CSS.

This pin is scoped to Vite's final minification pass only. Tailwind's own
`@tailwindcss/vite` transform still uses Lightning CSS internally for
nesting/vendor-prefixing/`@import` resolution — that's a separate stage,
untouched by this setting, and not implicated in this bug.

## Should this be reverted later?

Revisit this pin whenever bumping `daisyui`, `lightningcss`, `tailwindcss`,
or Vite itself — don't let it ride silently. Safe to switch back to
`lightningcss` once **either**:

1. `lightningcss` fixes the `:is()`-max-specificity rule-merge behavior
   (issues #1159 / #891 above), or
2. `daisyui` changes how it generates the theme-controller selector
   variant (issue #4488) so it no longer produces a mixed-specificity
   rule shape Lightning CSS can merge unsafely.

Whichever happens first, don't just flip the config back — this bug was
invisible to `typecheck`/`build`/the full test suite; it was only caught
by a human eyeballing a PR preview against production. After any revert
attempt, manually verify computed theme tokens
(`getComputedStyle(document.documentElement).getPropertyValue('--color-primary')`,
etc.) in both themes against a production build, not just a dev server.
