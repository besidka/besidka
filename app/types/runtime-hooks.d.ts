declare module '#app' {
  interface RuntimeNuxtHooks {
    'chat:rendered': (container: Ref<HTMLDivElement | null>) => void
    'chat:submit': (payload: { text: string }) => void
    'chat:stop': () => void
    'chat:regenerate': () => void
    'chat:scroll-to-user-message': () => void
    'chat:scroll-to-bottom': () => void
    'chat:init-captured-padding': () => void
    'chat-input:height': (height: number) => void
    'chat-input:metrics-changed': (payload: {
      fullHeight: number
      visibleHeight: number
      peekHeight: number
      isPeekMode: boolean
    }) => void
    'chat-input:visibility-changed': (visible: boolean) => void
    'chat-spacer:changed': (height: number) => void
    'device-keyboard:state-changed': (isOpen: boolean) => void
    'device-keyboard:viewport-changed': (payload: {
      isOpen: boolean
      keyboardHeight: number
      visualViewportHeight: number
      visualViewportOffsetTop: number
      layoutViewportHeight: number
      focusedElementTop: number | null
      focusedElementBottom: number | null
    }) => void
    'files:uploaded': () => void
    'files:deleted': (fileIds: string[]) => void
    'projects:context-updated': (payload: {
      projectIds: string[]
    }) => void
  }
}

export {}
