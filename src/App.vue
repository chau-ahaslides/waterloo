<script setup lang="ts">
import { RouterView } from 'vue-router'
import { ahaSlidesDefaultTheme } from '@/theme/antTheme'
</script>

<template>
  <!-- The AhaSlides design-token theme is applied app-wide here. Every
       Ant Design Vue component below inherits the brand tokens. -->
  <a-config-provider :theme="ahaSlidesDefaultTheme">
    <RouterView />
  </a-config-provider>
</template>
