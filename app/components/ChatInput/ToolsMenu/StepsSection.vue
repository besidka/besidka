<template>
  <ChatInputToolsMenuToggleRow
    label="Show steps expanded"
    :icon="STEPS_EXPANDED_ICON"
    test-id="steps-expanded-toggle"
    :model-value="stepsExpanded"
    @update:model-value="setStepsExpanded"
  />
  <ChatInputToolsMenuReveal :is-open="stepsExpanded">
    <ChatInputToolsMenuToggleRow
      label="Auto-hide when done"
      :icon="STEPS_AUTO_HIDE_ICON"
      test-id="steps-auto-hide-toggle"
      :model-value="stepsAutoHide"
      @update:model-value="setStepsAutoHide"
    />
  </ChatInputToolsMenuReveal>
</template>

<script setup lang="ts">
const {
  stepsExpanded,
  stepsAutoHide,
  setStepsExpanded,
  setStepsAutoHide,
} = useUserSetting()
</script>
