<script lang="ts">
  import { onDestroy } from 'svelte';
  import { createWebHaptics } from 'web-haptics/svelte';

  const { trigger, destroy } = createWebHaptics();
  onDestroy(destroy);
</script>

<div class="container">
  <button on:click={() => trigger()}>Tap me</button>
</div>

<style>
  .container {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100vh;
    font-size: 2rem;
  }
</style>
