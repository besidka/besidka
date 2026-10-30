<template>
  <div
    class="grid gap-4 rounded-box bg-base-200/60 p-4"
    :data-testid="`connected-apps-editor-${app.clientId}`"
  >
    <p class="font-medium">
      Permissions for {{ app.name }}
    </p>
    <OAuthScopePicker
      v-model="selected"
      :scopes="editableScopes"
      :disabled="isSaving"
      mode="edit"
    />
    <p
      class="text-sm text-base-content/70"
      data-testid="connected-apps-add-hint"
    >
      To add permissions, reconnect this app from the app itself.
    </p>
    <div class="flex flex-wrap justify-end gap-2">
      <UiButton
        text="Cancel"
        mode="neutral"
        outline
        size="sm"
        :disabled="isSaving"
        data-testid="connected-apps-editor-cancel"
        @click="emit('cancel')"
      />
      <UiButton
        text="Save permissions"
        size="sm"
        normal-case
        :disabled="isSaving || !hasChanges"
        data-testid="connected-apps-editor-save"
        @click="save"
      />
    </div>
  </div>
</template>
<script setup lang="ts">
import { parseError } from 'evlog'
import type { ConnectedApp } from '~/utils/connected-apps'

const props = defineProps<{
  app: ConnectedApp
}>()

const emit = defineEmits<{
  saved: []
  cancel: []
}>()

const selected = shallowRef<string[]>([])
const isSaving = shallowRef<boolean>(false)

const editableScopes = computed<string[]>(() => {
  return filterEditableScopes(props.app.scopes)
})

const hasChanges = computed<boolean>(() => {
  return selected.value.length !== editableScopes.value.length
})

async function save() {
  if (!hasChanges.value) {
    return
  }

  if (selected.value.length === 0) {
    const result = await useConfirm({
      text: `Remove every permission from ${props.app.name}?`,
      subtitle: 'The app stays connected but can no longer read or change '
        + 'anything in your account. To end the connection, disconnect it '
        + 'instead.',
      actions: ['Remove all'],
      labelDecline: 'Cancel',
    })

    if (!result) {
      return
    }
  }

  isSaving.value = true

  try {
    await $fetch(
      `/api/v1/profiles/connected-apps/${encodeURIComponent(props.app.clientId)}/scopes`,
      {
        method: 'PATCH',
        body: { scopes: selected.value },
      },
    )
    useSuccessMessage(`${props.app.name} permissions updated`)
    emit('saved')
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to update the permissions',
      parsedException.why || parsedException.fix,
    )
  } finally {
    isSaving.value = false
  }
}
</script>
