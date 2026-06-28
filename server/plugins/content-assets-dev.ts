// In local dev, wrangler's getPlatformProxy exposes an ASSETS binding from the
// top-level wrangler.jsonc "assets" config (directory: ".output/public"). The
// @nuxt/content cloudflare database-handler checks ASSETS first:
//
//   if (ASSETS) {
//     return await ASSETS.fetch(url).then(r => r.text())   // ← taken in dev
//   }
//   return await useStorage().getItem(...)
//
// Since .output/ does not exist in dev, ASSETS.fetch("/dump.landing.sql")
// returns an empty response. decompressSQLDump("") throws
// "TypeError: Failed to fetch" inside the Studio bundle, the draft DB never
// initialises, and isReady stays false — so the "Edit this page" toolbar
// remains hidden and the use-cases/testimonials section is not visible.
//
// Fix: remove the ASSETS key from the cloudflare proxy env before the
// database-handler runs. The handler then falls through to
// useStorage().getItem("build:content:raw:dump.landing.sql") which reads
// .nuxt/content/raw/dump.landing.sql (6 528 bytes, populated at build time).
//
// This plugin is a no-op in production (import.meta.dev is false).

export default defineNitroPlugin((nitroApp) => {
  if (!import.meta.dev) {
    return
  }

  nitroApp.hooks.hook('request', (event) => {
    const env = event.context.cloudflare?.env

    if (env && 'ASSETS' in env) {
      delete (env as Record<string, unknown>).ASSETS
    }
  })
})
