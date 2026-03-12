import { useState } from '#app'
import { ref, type Ref } from 'vue'
import { vi } from 'vitest'

type StateFactory<T> = () => T

const stateStore = new Map<string, Ref<unknown>>()

export function resetMockNuxtState() {
  stateStore.clear()
}

export function installMockNuxtState() {
  ;(useState as unknown as ReturnType<typeof vi.fn>).mockImplementation((
    key: string,
    init?: StateFactory<unknown>,
  ) => {
    if (!stateStore.has(key)) {
      stateStore.set(key, ref(init ? init() : null))
    }

    return stateStore.get(key)!
  })
}
