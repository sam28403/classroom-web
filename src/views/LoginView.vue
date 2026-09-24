<script setup>
import SiteHeader from '@/components/SiteHeader.vue'
import AuthForm from '@/components/AuthForm.vue'
</script>

<template>
  <el-container class="app-layout" direction="vertical">
    <SiteHeader />
    <el-main class="app-main"><AuthForm mode="login" /></el-main>
  </el-container>
</template>
