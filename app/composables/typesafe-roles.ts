import { parseError } from 'evlog'
import { isJevRoleSwitchedOn } from '#shared/utils/jev-policy'
import type { JevRoleId, JevRoleSettings } from '#shared/utils/jev-policy'

/**
 * Per-role TypeSafe AI switches from `user_settings.typesafe_roles`. A role
 * flips optimistically and sends only its own key, which the server merges
 * into the stored object; a failed save rolls that role back unless a newer
 * flip of the same role is already in flight.
 */
export function useTypesafeRoles() {
  const { data, status } = useLazyFetch('/api/v1/profiles/settings', {
    key: 'typesafe-roles',
    server: false,
    pick: ['typesafeRoles'],
  })

  const localRoles = shallowRef<JevRoleSettings>({})
  const latestVersions: Partial<Record<JevRoleId, number>> = {}
  let versionCounter = 0

  const isLoaded = computed<boolean>(() => {
    return status.value === 'success'
  })

  const roles = computed<JevRoleSettings>(() => {
    return { ...data.value?.typesafeRoles, ...localRoles.value }
  })

  function isRoleOn(role: JevRoleId): boolean {
    return isJevRoleSwitchedOn(roles.value, role)
  }

  async function setRole(role: JevRoleId, isOn: boolean): Promise<void> {
    const previous = isRoleOn(role)

    versionCounter += 1

    const version = versionCounter

    latestVersions[role] = version
    localRoles.value = { ...localRoles.value, [role]: isOn }

    try {
      await $fetch('/api/v1/profiles/settings', {
        method: 'PATCH',
        body: { typesafeRoles: { [role]: isOn } },
      })
    } catch (exception) {
      if (latestVersions[role] === version) {
        localRoles.value = { ...localRoles.value, [role]: previous }
      }

      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Could not save the setting',
        parsedException.why,
      )
    }
  }

  return {
    isLoaded,
    isRoleOn,
    setRole,
  }
}
