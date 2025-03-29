<script setup>
import ExcelDomainViewer from './components/ExcelDomainViewer.vue'
</script>

<template>
  <div class="app-container">
    <ExcelDomainViewer />
  </div>
</template>

<style>
body {
  margin: 0;
  padding: 0;
  font-family: Arial, sans-serif;
}
</style>

<style scoped>
.app-container {
  width: 100%;
  min-height: 100vh;
  padding: 0;
  margin: 0;
  box-sizing: border-box;
  display: block;
  position: relative;
}
</style>