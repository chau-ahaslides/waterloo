<script setup lang="ts">
import { ahaSlidesDefaultTheme } from '@/theme/antTheme'
import PresentationList from '@/views/PresentationList.vue'
</script>

<template>
  <!-- The AhaSlides design-token theme is applied app-wide here. Every
       Ant Design Vue component below inherits the brand tokens. -->
  <a-config-provider :theme="ahaSlidesDefaultTheme">
    <PresentationList />
  </a-config-provider>
</template>
