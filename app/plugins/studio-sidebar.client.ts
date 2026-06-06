/**
 * Keeps the Nuxt Studio editor sidebar from breaking the app layout AND its
 * own property popovers.
 *
 * Studio's adjustFixedElements() writes `left: <sidebarWidth>px` onto every
 * position:fixed element — including our position:fixed <html>. Two problems:
 *   1. A non-zero <html> left is the reference frame floating-ui uses inside
 *      Studio's shadow-DOM popovers, so the section property popovers compute
 *      an off-screen-left position and get clipped (unusable for editing).
 *   2. The sidebar is resizable, so a hardcoded width drifts out of sync.
 *
 * Fix: mirror the live width into the `--studio-sidebar-width` CSS variable
 * (main.css offsets the app via body margin, which floating-ui ignores) and
 * clear `html.left` so popovers position correctly.
 *
 * The observer is only attached when this page load can become a Studio
 * session: nuxt-studio activates the editor only when the
 * `studio-session-check` cookie is `true` (or in `studio.dev` mode), so
 * regular visitors skip the observer entirely. Studio login is a full-page
 * navigation, so a fresh plugin run re-evaluates the cookie.
 */
export default defineNuxtPlugin(() => {
  const studioConfig = useRuntimeConfig().public.studio
  const studioSessionCheck = useCookie('studio-session-check')

  if (
    !studioConfig?.dev
    && String(studioSessionCheck.value) !== 'true'
  ) {
    return
  }

  const html = document.documentElement

  const sync = () => {
    if (!document.body.dataset.studioActive) {
      return
    }

    const { left } = html.style

    if (!left || left === '0px') {
      return
    }

    html.style.setProperty('--studio-sidebar-width', left)
    html.style.left = ''
  }

  const observer = new MutationObserver(sync)

  observer.observe(html, {
    attributes: true,
    attributeFilter: ['style'],
  })

  sync()
})
