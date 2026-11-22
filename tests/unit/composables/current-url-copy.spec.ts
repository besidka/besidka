import { reactive, ref } from 'vue'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import { useCurrentUrlCopy } from '../../../app/composables/current-url-copy'

const copied = ref<boolean>(false)
const copy = vi.fn(async () => {})
const route = reactive({ fullPath: '/chats/01JABCDEFGHJKMNPQRSTVWXYZ0?a=1' })

mockNuxtImport('useRoute', () => {
  return () => route
})

mockNuxtImport('useClipboard', () => {
  return () => ({ copy, copied })
})

describe('useCurrentUrlCopy', () => {
  it('exposes the path and the full URL of the route', () => {
    const { displayPath, currentUrl } = useCurrentUrlCopy()

    expect(displayPath.value).toBe('/chats/01JABCDEFGHJKMNPQRSTVWXYZ0?a=1')
    expect(currentUrl.value).toBe(
      `${window.location.origin}/chats/01JABCDEFGHJKMNPQRSTVWXYZ0?a=1`,
    )
  })

  it('copies the full URL and follows route changes', async () => {
    const { copyUrl } = useCurrentUrlCopy()

    route.fullPath = '/profile/keys'
    await copyUrl()

    expect(copy).toHaveBeenCalledWith(`${window.location.origin}/profile/keys`)
  })
})
