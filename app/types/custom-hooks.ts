declare module '#app' {
  interface RuntimeNuxtHooks {
    'chat:submit': (payload: { text: string }) => void
  }
}

export {}
