export const SIDE_PANEL_DEMO_QUERY_KEY = 'side-panel-demo'

/**
 * Typed hook point for the `ui.side-panel-demo` feature flag. Until P0-4's
 * `useFeature()` lands, the demo card shows only on local dev or e2e builds,
 * and only when the chat URL carries `?side-panel-demo`.
 */
export function isSidePanelDemoEnabled(
  query: Record<string, unknown>,
): boolean {
  const isTestBuild = import.meta.dev
    || !!useRuntimeConfig().public.e2eTestHooksEnabled

  return isTestBuild && SIDE_PANEL_DEMO_QUERY_KEY in query
}
