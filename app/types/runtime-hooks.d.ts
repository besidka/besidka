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
    'chat-input:visibility-changed': (visible: boolean) => void
    'chat-spacer:changed': (height: number) => void
    'device-keyboard:state-changed': (isOpen: boolean) => void
    'files:uploaded': () => void
    'files:deleted': (fileIds: string[]) => void
  }
}

export {}
