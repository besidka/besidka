/**
 * The apply-due route exists for the e2e suite only. It is open when
 * `NUXT_PUBLIC_E2E_TEST_HOOKS_ENABLED` is `true`, the flag the Playwright
 * web server and the CI `.dev.vars` already set; every other environment
 * answers it with a 404.
 */
export function isFeatureScheduleTestHookEnabled(): boolean {
  return String(useRuntimeConfig().public.e2eTestHooksEnabled) === 'true'
}
