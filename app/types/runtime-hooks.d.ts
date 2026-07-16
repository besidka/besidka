import type { FileMetadata } from '#shared/types/files.d'

declare module '#app' {
  interface RuntimeNuxtHooks {
    'chat:rendered': (container: Ref<HTMLDivElement | null>) => void
    'chat:submit': (payload: { text: string }) => void
    'chat:attach-file': (
      file: Pick<FileMetadata, 'id' | 'storageKey' | 'name' | 'size' | 'type'>,
    ) => void
    'chat:stop': () => void
    'chat:regenerate': () => void
    'chat:generation-ready-while-hidden': () => void
    'chat:message-selected': (messageId: string | null) => void
    'chat:scroll-to-user-message': () => void
    'chat:scroll-to-bottom': () => void
    'chat:init-captured-padding': () => void
    'chat-input:height': (height: number) => void
    'chat-input:visibility-changed': (visible: boolean) => void
    'chat-spacer:changed': (height: number) => void
    'device-keyboard:state-changed': (isOpen: boolean) => void
    'files:uploaded': () => void
    'files:deleted': (fileIds: string[]) => void
    'projects:context-updated': (payload: {
      projectIds: string[]
    }) => void
  }
}

export {}
