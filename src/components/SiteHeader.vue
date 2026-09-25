<script setup>
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { user, loggingOut, loadUser, logout as endSession } from '@/auth.js'

const route = useRoute()
const router = useRouter()

async function logout() {
  try {
    await endSession()
    ElMessage.success('已退出登录')
    if (route.path !== '/') await router.push('/')
  } catch (error) {
    ElMessage.error(error.message)
  }
}

onMounted(loadUser)
</script>

<template>
  <el-header class="top-header">
    <router-link class="home-link" to="/" aria-label="Sam-Lab Classroom 首页">
      <el-avatar class="brand-avatar" src="/classroom-mark.png" />
      <h2>Sam-Lab Classroom</h2>
    </router-link>
    <div class="page-header-actions">
      <template v-if="route.path === '/' && !user">
        <el-button @click="router.push('/login')">登录</el-button>
        <el-button type="primary" @click="router.push('/register')">注册</el-button>
      </template>
      <template v-else-if="user">
        <el-button v-if="!route.path.startsWith('/dashboard')" type="primary" @click="router.push('/dashboard')">控制面板</el-button>
        <el-button v-else @click="router.push('/')">返回首页</el-button>
        <el-button :loading="loggingOut" @click="logout">退出登录</el-button>
      </template>
      <el-button v-else @click="router.push('/')">返回首页</el-button>
    </div>
  </el-header>
</template>
