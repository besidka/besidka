/**
 * The apply-due route exists for the e2e suite only. It is open when
 * `NUXT_FEATURES_SCHEDULE_TEST_HOOK` is `true`, a value only the Playwright
 * web server sets; every other environment answers it with a 404.
 */
export function isFeatureScheduleTestHookEnabled(): boolean {
  return String(useRuntimeConfig().featuresScheduleTestHook) === 'true'
}
