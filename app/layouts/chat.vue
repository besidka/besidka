<template>
  <div class="contents">
    <LazyLegalChangeNotice />
    <NuxtPage/>
    <LazyChatSkillPreview
      v-if="previewSkillId"
      :key="previewSkillId"
      :skill-id="previewSkillId"
      @close="skillPreview.close()"
    />
  </div>
</template>

<script setup lang="ts">
const skillPreview = useSkillPreview()
const previewSkillId = skillPreview.skillId

onMounted(() => {
  useNotificationPrompt().maybeShowProactively()
})
</script>
