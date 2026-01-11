<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from "vue";
import "~/assets/css/main.css";

useHead({
  title: "ILIDJ",
});

const webglContainer = ref<HTMLElement | null>(null);
const sketch = ref<any>(null);
const isInitializing = ref(false);

onMounted(async () => {
  if (typeof window === "undefined") return;
  if (isInitializing.value || sketch.value) return;

  isInitializing.value = true;
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 100));

  if (webglContainer.value) {
    try {
      // @ts-ignore
      const SketchModule = await import("~/assets/threejs/three");
      const Sketch = SketchModule?.default || SketchModule;

      sketch.value = new Sketch({
        dom: webglContainer.value,
        imageUrl: "/soon_to_be_portfolio.png",
      });
    } catch (error) {
      console.error("Failed to initialize Three.js:", error);
    } finally {
      isInitializing.value = false;
    }
  } else {
    isInitializing.value = false;
  }
});

onUnmounted(() => {
  if (sketch.value) {
    try {
      sketch.value.dispose();
    } catch (error) {
      console.error("Error disposing Three.js:", error);
    }
    sketch.value = null;
  }
  isInitializing.value = false;
});
</script>

<template>
  <div ref="webglContainer" class="webgl"></div>
</template>
