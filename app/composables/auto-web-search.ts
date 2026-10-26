import type { Tools } from '#shared/types/chats.d'
import {
  AUTO_WEB_SEARCH_PREFERENCE_KEY,
  AUTO_WEB_SEARCH_PREFERENCE_OFF,
  AUTO_WEB_SEARCH_PREFERENCE_ON,
} from '#shared/utils/auto-web-search'
import type { WebSearchMode } from '#shared/utils/auto-web-search'
import { isJevRoleSwitchedOn } from '#shared/utils/jev-policy'
import { isWebSearchTool } from '#shared/utils/message-metadata'

const TYPESAFE_KEY_PROVIDER_ID = 'typesafe'
const AUTO_WEB_SEARCH_ROLE = 'autoWebSearch'

/**
 * The Auto web search mode: a per-browser preference that rides on the
 * chosen search provider. The menu offers it only with a saved TypeSafe AI
 * key and the `autoWebSearch` role on; the role settings are fetched only
 * once the key is known to be saved. A send asks for `auto` unless the key
 * or the role is known to be missing, so a send fired while those are still
 * loading keeps Auto; the server re-checks both and searches as usual
 * without them.
 */
export function useAutoWebSearch() {
  const prefStorage = usePreferenceStorage()
  const { keyStatusForProvider } = useUserKeys()
  const {
    data: settings,
    status,
    execute,
  } = useLazyFetch('/api/v1/profiles/settings', {
    key: 'auto-web-search-roles',
    server: false,
    immediate: false,
    dedupe: 'defer',
    pick: ['typesafeRoles'],
  })

  const hasTypesafeKey = computed<boolean>(() => {
    return keyStatusForProvider(TYPESAFE_KEY_PROVIDER_ID) === 'saved'
  })

  watch(hasTypesafeKey, async (hasKey) => {
    if (hasKey && status.value === 'idle') {
      await execute()
    }
  }, { immediate: true })

  const isAvailable = computed<boolean>(() => {
    return hasTypesafeKey.value
      && status.value === 'success'
      && isJevRoleSwitchedOn(
        settings.value?.typesafeRoles,
        AUTO_WEB_SEARCH_ROLE,
      )
  })

  const isPreferred = computed<boolean>(() => {
    return prefStorage.getItem(AUTO_WEB_SEARCH_PREFERENCE_KEY)
      === AUTO_WEB_SEARCH_PREFERENCE_ON
  })

  const isActive = computed<boolean>(() => {
    return isAvailable.value && isPreferred.value
  })

  const isKnownUnavailable = computed<boolean>(() => {
    if (keyStatusForProvider(TYPESAFE_KEY_PROVIDER_ID) === 'missing') {
      return true
    }

    return status.value === 'success'
      && !isJevRoleSwitchedOn(
        settings.value?.typesafeRoles,
        AUTO_WEB_SEARCH_ROLE,
      )
  })

  function setPreferred(isOn: boolean) {
    prefStorage.setItem(
      AUTO_WEB_SEARCH_PREFERENCE_KEY,
      isOn ? AUTO_WEB_SEARCH_PREFERENCE_ON : AUTO_WEB_SEARCH_PREFERENCE_OFF,
    )
    requestPersistence()
  }

  function resolveWebSearchMode(tools: Tools): WebSearchMode {
    if (!isPreferred.value || isKnownUnavailable.value) {
      return 'always'
    }

    return tools.some(isWebSearchTool) ? 'auto' : 'always'
  }

  return {
    isAvailable,
    isPreferred,
    isActive,
    setPreferred,
    resolveWebSearchMode,
  }
}
