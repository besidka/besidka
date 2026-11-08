<template>
  <div class="relative grid gap-1">
    <label
      class="input w-full"
      :for="inputId"
    >
      <Icon
        name="lucide:search"
        size="16"
        class="opacity-60"
        aria-hidden="true"
      />
      <input
        :id="inputId"
        v-model="query"
        type="search"
        autocomplete="off"
        class="grow"
        :placeholder="placeholder"
        role="combobox"
        :aria-expanded="isOpen"
        :aria-controls="listId"
        data-testid="admin-user-search-input"
        @focus="isFocused = true"
        @blur="isFocused = false"
      >
      <span
        v-if="isSearching"
        class="loading loading-spinner loading-xs"
      />
    </label>
    <ul
      v-if="isOpen"
      :id="listId"
      role="listbox"
      class="menu bg-base-100 rounded-box shadow-lg absolute top-full z-20 mt-1 w-full border border-base-300"
      data-testid="admin-user-search-results"
    >
      <li
        v-if="!users.length"
        class="menu-disabled"
      >
        <span>No accounts match.</span>
      </li>
      <li
        v-for="user in users"
        :key="user.id"
        role="option"
        :aria-selected="false"
      >
        <button
          type="button"
          class="grid grid-flow-row justify-items-start gap-0"
          :data-testid="`admin-user-search-option-${user.id}`"
          @mousedown.prevent="select(user)"
        >
          <span class="font-medium">{{ user.name }}</span>
          <span class="text-xs opacity-70 break-all">{{ user.email }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>
<script setup lang="ts">
import { parseError } from 'evlog'
import { ADMIN_USER_SEARCH_MIN_LENGTH } from '#shared/utils/features/admin-schemas'
import type { AdminSearchUser } from '~/utils/admin-features'

withDefaults(defineProps<{
  placeholder?: string
}>(), {
  placeholder: 'Search by email or name',
})

const emit = defineEmits<{
  select: [user: AdminSearchUser]
}>()

const inputId = useId()
const listId = useId()
const query = shallowRef<string>('')
const users = shallowRef<AdminSearchUser[]>([])
const isSearching = shallowRef<boolean>(false)
const isFocused = shallowRef<boolean>(false)
const hasSearched = shallowRef<boolean>(false)
let latestSearchId = 0

const isOpen = computed<boolean>(() => {
  return isFocused.value
    && hasSearched.value
    && query.value.trim().length >= ADMIN_USER_SEARCH_MIN_LENGTH
})

const search = useDebounceFn(async (text: string) => {
  const searchId = ++latestSearchId

  isSearching.value = true

  try {
    const result = await $fetch('/api/v1/admin/users/search', {
      query: { q: text },
    })

    if (searchId === latestSearchId) {
      users.value = result.users
      hasSearched.value = true
    }
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Search failed',
      parsedException.why,
    )
  } finally {
    if (searchId === latestSearchId) {
      isSearching.value = false
    }
  }
}, 300)

watch(query, (value) => {
  const text = value.trim()

  if (text.length < ADMIN_USER_SEARCH_MIN_LENGTH) {
    latestSearchId++
    users.value = []
    hasSearched.value = false
    isSearching.value = false

    return
  }

  search(text)
})

function select(user: AdminSearchUser) {
  emit('select', user)
  query.value = ''
  isFocused.value = false
}
</script>
