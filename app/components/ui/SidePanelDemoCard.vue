<template>
  <section
    class="w-80 max-w-full mx-auto mb-3 rounded-box border border-base-300 bg-base-200"
    data-testid="side-panel-demo-card"
  >
    <div class="flex items-center gap-3 p-3">
      <span class="grid size-9 shrink-0 place-items-center rounded-field bg-base-100 text-base-content/70">
        <Icon
          name="lucide:panel-right"
          size="18"
        />
      </span>
      <div class="min-w-0 grow">
        <p class="truncate text-sm font-medium">
          Side panel demo
        </p>
        <p class="text-xs text-base-content/60">
          Internal preview of the shared panel
        </p>
      </div>
      <button
        type="button"
        class="btn btn-sm btn-soft"
        data-testid="side-panel-demo-open"
        @click="openDemo"
      >
        Open
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import UiSidePanelDemoBody from '~/components/ui/SidePanel/DemoBody.vue'
import UiSidePanelDemoToolbar from '~/components/ui/SidePanel/DemoToolbar.vue'

const { open } = useSidePanel()

function openDemo() {
  open({
    viewKey: 'side-panel-demo',
    title: 'Side panel demo',
    component: UiSidePanelDemoBody,
    toolbar: UiSidePanelDemoToolbar,
  })
}
</script>
