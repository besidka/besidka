<template>
  <div
    v-if="isLoading"
    class="skeleton skeleton--default h-16"
  />
  <div
    v-else
    class="grid gap-4"
  >
    <p
      v-if="!passkeys.length"
      class="text-sm text-base-content/70"
    >
      No passkeys registered yet.
    </p>
    <ul
      v-else
      class="grid gap-2"
    >
      <li
        v-for="passkeyRow in passkeys"
        :key="passkeyRow.id"
        data-testid="passkey-row"
        class="flex items-center justify-between gap-4 py-2"
      >
        <div
          v-if="renamingId !== passkeyRow.id"
          class="min-w-0"
        >
          <p class="font-medium">
            {{ passkeyRow.name || 'Unnamed passkey' }}
            <span class="badge badge-sm badge-ghost ml-2">
              {{ passkeyRow.backedUp
                ? 'Synced across devices'
                : 'This device only' }}
            </span>
          </p>
          <p class="text-sm text-base-content/70">
            Added {{ formatCreatedAt(passkeyRow.createdAt) }}
          </p>
        </div>
        <UiForm
          v-else
          class="grow"
          @submit="submitRename(passkeyRow)"
        >
          <UiFormFieldset class="flex items-center gap-2">
            <UiFormInput
              v-model="renameValue"
              placeholder="Name this passkey"
              :rules="[Validation.required()]"
              :disabled="isProcessing"
            />
            <UiButton
              mode="neutral"
              ghost
              size="sm"
              text="Cancel"
              :disabled="isProcessing"
              data-testid="passkeys-rename-cancel"
              @click="cancelRename"
            />
            <UiButton
              type="submit"
              size="sm"
              :text="isProcessing ? 'Saving...' : 'Save'"
              :disabled="isProcessing"
              data-testid="passkeys-rename-submit"
            />
          </UiFormFieldset>
        </UiForm>
        <div
          v-if="renamingId !== passkeyRow.id"
          class="flex gap-2"
        >
          <UiButton
            text="Rename"
            size="sm"
            outline
            :disabled="isProcessing"
            :data-testid="`passkeys-rename-${passkeyRow.id}`"
            @click="startRename(passkeyRow)"
          />
          <UiButton
            text="Delete"
            mode="error"
            outline
            size="sm"
            :disabled="isProcessing"
            :data-testid="`passkeys-delete-${passkeyRow.id}`"
            @click="deletePasskeyRow(passkeyRow)"
          />
        </div>
      </li>
    </ul>

    <UiForm
      v-if="isAdding"
      @submit="submitAdd"
    >
      <UiFormFieldset>
        <UiFormInput
          v-model="newPasskeyName"
          placeholder="Name this passkey"
          :rules="[Validation.required()]"
          :disabled="isProcessing"
        />
      </UiFormFieldset>
      <UiFormFieldset
        :inputs="false"
        class="flex gap-2 justify-end mt-4"
      >
        <UiButton
          mode="neutral"
          ghost
          text="Cancel"
          :disabled="isProcessing"
          data-testid="passkeys-add-cancel"
          @click="cancelAdd"
        />
        <UiButton
          type="submit"
          :text="isProcessing ? 'Continuing...' : 'Continue'"
          :disabled="isProcessing"
          data-testid="passkeys-add-submit"
        />
      </UiFormFieldset>
    </UiForm>
    <div
      v-else
      class="flex flex-wrap items-center justify-between gap-4"
    >
      <p
        v-if="!supportsWebAuthn"
        class="text-sm text-base-content/70"
        data-testid="passkeys-unsupported"
      >
        Your browser doesn't support passkeys.
      </p>
      <UiButton
        v-else
        text="Add a passkey"
        size="sm"
        data-testid="passkeys-add"
        @click="startAdd"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
interface PasskeyRow {
  id: string
  name?: string | null
  createdAt: string | Date
  backedUp: boolean
}

const { Validation } = useValidation()
const { client } = useAuth()

const isLoading = shallowRef<boolean>(true)
const supportsWebAuthn = shallowRef<boolean>(false)
const passkeys = shallowRef<PasskeyRow[]>([])
const isProcessing = shallowRef<boolean>(false)

const isAdding = shallowRef<boolean>(false)
const newPasskeyName = shallowRef<string>('')

const renamingId = shallowRef<string | null>(null)
const renameValue = shallowRef<string>('')

function formatCreatedAt(createdAt: string | Date): string {
  return new Date(createdAt).toLocaleDateString()
}

async function loadPasskeys() {
  const { data, error } = await client.passkey.listUserPasskeys()

  if (!error && data) {
    passkeys.value = data
  }
}

onMounted(async () => {
  supportsWebAuthn.value = browserSupportsWebAuthn()

  await loadPasskeys()

  isLoading.value = false
})

function startAdd() {
  isAdding.value = true
  newPasskeyName.value = describeUserAgent(navigator.userAgent)
}

function cancelAdd() {
  isAdding.value = false
  newPasskeyName.value = ''
}

async function submitAdd() {
  isProcessing.value = true

  try {
    const { error } = await client.passkey.addPasskey({
      name: newPasskeyName.value,
    })

    if (error) {
      const errorCode = 'code' in error ? error.code : undefined

      if (isPasskeyCeremonyCancelled(errorCode)) {
        return
      }

      useErrorMessage(error.message || 'Failed to add passkey')

      return
    }

    isAdding.value = false
    newPasskeyName.value = ''
    useSuccessMessage('Passkey added')

    await loadPasskeys()
  } finally {
    isProcessing.value = false
  }
}

function startRename(passkeyRow: PasskeyRow) {
  renamingId.value = passkeyRow.id
  renameValue.value = passkeyRow.name || ''
}

function cancelRename() {
  renamingId.value = null
  renameValue.value = ''
}

async function submitRename(passkeyRow: PasskeyRow) {
  if (!renameValue.value.trim()) {
    return
  }

  isProcessing.value = true

  try {
    const { error } = await client.passkey.updatePasskey({
      id: String(passkeyRow.id),
      name: renameValue.value.trim(),
    })

    if (error) {
      useErrorMessage(error.message || 'Failed to rename passkey')

      return
    }

    renamingId.value = null
    renameValue.value = ''
    useSuccessMessage('Passkey renamed')

    await loadPasskeys()
  } finally {
    isProcessing.value = false
  }
}

async function deletePasskeyRow(passkeyRow: PasskeyRow) {
  const result = await useConfirm({
    text: `Delete "${passkeyRow.name || 'this passkey'}"?`,
    subtitle: 'You will no longer be able to sign in using this passkey.',
    actions: ['Delete'],
    labelDecline: 'Cancel',
  })

  if (!result) {
    return
  }

  isProcessing.value = true

  try {
    const { error } = await client.passkey.deletePasskey({
      id: String(passkeyRow.id),
    })

    if (error) {
      useErrorMessage(error.message || 'Failed to delete passkey')

      return
    }

    useSuccessMessage('Passkey deleted')

    await loadPasskeys()
  } finally {
    isProcessing.value = false
  }
}
</script>
