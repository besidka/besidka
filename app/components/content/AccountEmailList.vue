<template>
  <ol data-testid="account-email-list">
    <li v-for="item in items" :key="item.category">
      <strong>{{ item.label }}</strong>{{ item.lead }} {{ item.body }}
    </li>
  </ol>
</template>

<script setup lang="ts">
import { buildAccountEmailListItems } from '#shared/utils/account-emails'

const items = buildAccountEmailListItems()
</script>
