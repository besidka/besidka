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
      v-if="hasWriteScopes"
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
        Write access lets this app change your projects or memory. It is
        off unless you turn it on.
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
  isMcpWriteScope,
  MCP_IDENTITY_SCOPES,
} from '#shared/utils/mcp-oauth-scopes'

const props = withDefaults(defineProps<{
  scopes: string[]
  disabled?: boolean
}>(), {
  disabled: false,
})

const selected = defineModel<string[]>({ default: () => [] })

const identityScopeSet = new Set<string>(MCP_IDENTITY_SCOPES)

const identityScopes = computed<string[]>(() => {
  return props.scopes.filter((scope) => {
    return identityScopeSet.has(scope)
  })
})

const resourceScopes = computed<string[]>(() => {
  return props.scopes.filter((scope) => {
    return !identityScopeSet.has(scope)
  })
})

const hasWriteScopes = computed<boolean>(() => {
  return resourceScopes.value.some((scope) => {
    return isMcpWriteScope(scope)
  })
})

watch(resourceScopes, (scopes) => {
  selected.value = scopes.filter((scope) => {
    return !isMcpWriteScope(scope)
  })
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
