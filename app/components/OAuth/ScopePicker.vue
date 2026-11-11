<template>
  <div class="grid gap-4">
    <ul
      v-if="resourceScopes.length"
      class="grid gap-3"
      data-testid="oauth-scope-picker"
    >
      <li
        v-for="scope in resourceScopes"
        :key="scope"
      >
        <label class="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            name="scope"
            class="checkbox checkbox-sm mt-0.5"
            :class="{ 'checkbox-warning': isMcpWriteScope(scope) }"
            :value="scope"
            :checked="selected.includes(scope)"
            :disabled="disabled"
            :data-testid="`oauth-scope-${scope}`"
            @change="toggle(scope)"
          >
          <OAuthScopeLabel
            :scope="scope"
            with-description
          />
        </label>
      </li>
    </ul>
    <p
      v-if="hasWriteScopes && mode === 'grant'"
      role="note"
      class="alert alert-warning alert-soft text-sm"
      data-testid="oauth-write-warning"
    >
      <Icon
        name="lucide:triangle-alert"
        size="16"
        class="shrink-0"
        aria-hidden="true"
      />
      <span>
        Write access lets this app change your chats, projects, files, memory,
        settings and artifacts, publishing an artifact lets it create a public
        link anyone can open, and Delete your data lets it permanently delete
        them. Each one is off unless you turn it on.
      </span>
    </p>
    <div
      v-if="identityScopes.length"
      class="text-sm text-base-content/70"
      data-testid="oauth-identity-scopes"
    >
      <p class="mb-1">Always included:</p>
      <ul class="grid gap-1 list-disc pl-5">
        <li
          v-for="scope in identityScopes"
          :key="scope"
        >
          <OAuthScopeLabel :scope="scope" />
        </li>
      </ul>
    </div>
  </div>
</template>
<script setup lang="ts">
import {
  defaultSelectedMcpScopes,
  isMcpAdminScope,
  isMcpWriteScope,
  MCP_IDENTITY_SCOPES,
} from '#shared/utils/mcp-oauth-scopes'

const props = withDefaults(defineProps<{
  scopes: string[]
  disabled?: boolean
  mode?: 'grant' | 'edit'
}>(), {
  disabled: false,
  mode: 'grant',
})

const selected = defineModel<string[]>({ default: () => [] })

const isAdmin = useIsAdmin()

const identityScopeSet = new Set<string>(MCP_IDENTITY_SCOPES)

const identityScopes = computed<string[]>(() => {
  return props.scopes.filter((scope) => {
    return identityScopeSet.has(scope)
  })
})

const resourceScopes = computed<string[]>(() => {
  return props.scopes.filter((scope) => {
    if (identityScopeSet.has(scope)) {
      return false
    }

    return isAdmin.value || !isMcpAdminScope(scope)
  })
})

const hasWriteScopes = computed<boolean>(() => {
  return resourceScopes.value.some((scope) => {
    return isMcpWriteScope(scope)
  })
})

function initialSelection(scopes: string[]): string[] {
  return props.mode === 'edit' ? [...scopes] : defaultSelectedMcpScopes(scopes)
}

watch(resourceScopes, (scopes, previousScopes) => {
  if (!previousScopes) {
    selected.value = initialSelection(scopes)

    return
  }

  const addedScopes = scopes.filter((scope) => {
    return !previousScopes.includes(scope)
  })
  const keptSelection = selected.value.filter((scope) => {
    return scopes.includes(scope)
  })

  selected.value = [...keptSelection, ...initialSelection(addedScopes)]
}, { immediate: true })

function toggle(scope: string) {
  if (selected.value.includes(scope)) {
    selected.value = selected.value.filter((item) => {
      return item !== scope
    })

    return
  }

  selected.value = [...selected.value, scope]
}
</script>
