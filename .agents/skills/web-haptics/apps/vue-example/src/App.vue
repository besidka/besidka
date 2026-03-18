<template>
  <div class="container">
    <button @click="trigger()">Tap me</button>
  </div>
</template>

<script setup lang="ts">
import { useWebHaptics } from "web-haptics/vue";

const { trigger } = useWebHaptics();
</script>

<style>
.container {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  font-size: 2rem;
}
</style>
