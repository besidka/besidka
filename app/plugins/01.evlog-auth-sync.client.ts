import { clearIdentity, setIdentity } from 'evlog/client'

export default defineNuxtPlugin({
  name: 'evlog-auth-sync',
  dependsOn: ['evlog-client-init'],
  setup() {
    const { user } = useAuth()

    watch(
      () => user.value,
      (current) => {
        if (current) {
          setIdentity({
            userId: String(current.id),
            userName: current.name,
          })

          return
        }

        clearIdentity()
      },
      { immediate: true },
    )
  },
})
