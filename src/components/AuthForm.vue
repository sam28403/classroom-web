<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import api from '@/api.js'
import { setUser } from '@/auth.js'

const props = defineProps({
  mode: { type: String, required: true, validator: (value) => ['login', 'register'].includes(value) },
})

const router = useRouter()
const busy = ref(false)
const refreshing = ref(false)
const captchaImage = ref('')
const form = reactive({ username: '', password: '', confirmPassword: '', role: 'student', code: '' })
const isRegister = props.mode === 'register'

async function refreshCaptcha(force = false) {
  if (refreshing.value || (busy.value && !force)) return
  refreshing.value = true
  captchaImage.value = ''
  form.code = ''
  try {
    captchaImage.value = (await api('/captcha')).image
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    refreshing.value = false
  }
}

async function submit() {
  if (busy.value || refreshing.value || !captchaImage.value) return
  const username = form.username.trim()
  if (!username || !form.password || !form.code.trim()) {
    ElMessage.error('请输入账号、密码和验证码')
    return
  }
  if (isRegister) {
    if (!/^[\p{L}\p{N}_-]{3,24}$/u.test(username)) {
      ElMessage.error('账号须为 3–24 位文字、数字、下划线或短横线')
      return
    }
    if (form.password.length < 8 || !/\d/.test(form.password) || !/[^0-9]/.test(form.password)) {
      ElMessage.error('密码须至少 8 位，并包含数字和非数字字符')
      return
    }
    if (form.password !== form.confirmPassword) {
      ElMessage.error('两次密码不一致！')
      return
    }
  }

  busy.value = true
  try {
    const result = await api(`/auth/${isRegister ? 'register' : 'login'}`, {
      method: 'POST',
      body: JSON.stringify({ username, password: form.password, code: form.code, role: form.role }),
    })
    if (isRegister) {
      ElMessage.success(result.requiresApproval ? '注册成功，教师账号需管理员审核后登录。' : '注册成功，请登录。')
      await router.replace('/login')
    } else {
      setUser(result.user)
      ElMessage.success('登录成功！')
      await router.replace('/')
    }
  } catch (error) {
    ElMessage.error(error.message)
    await refreshCaptcha(true)
  } finally {
    busy.value = false
  }
}

onMounted(refreshCaptcha)
</script>

<template>
  <section class="auth-section">
    <div class="auth-container">
      <h2>{{ isRegister ? '用户注册' : '用户登录' }}</h2>
        <el-form label-position="top" class="profile-form" @submit.prevent="submit">
          <el-form-item label="账号">
            <el-input v-model="form.username" :placeholder="isRegister ? '设置用户名' : '输入用户名'" size="large" clearable autocomplete="username" />
          </el-form-item>
          <el-form-item label="密码">
            <el-input v-model="form.password" type="password" show-password :placeholder="isRegister ? '至少 8 位，包含数字和非数字字符' : '输入密码'" size="large" clearable :autocomplete="isRegister ? 'new-password' : 'current-password'" />
          </el-form-item>
          <el-form-item v-if="isRegister" label="确认密码">
            <el-input v-model="form.confirmPassword" type="password" show-password placeholder="确认密码" size="large" clearable autocomplete="new-password" />
          </el-form-item>
          <el-form-item v-if="isRegister" label="身份">
            <el-radio-group v-model="form.role" class="role-group">
              <el-radio-button value="teacher">教师</el-radio-button>
              <el-radio-button value="student">学生</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="验证码">
            <div class="captcha-group">
              <el-input v-model="form.code" maxlength="5" placeholder="输入图中字符" aria-label="验证码" size="large" :disabled="busy || refreshing" autocomplete="off" />
              <div class="captcha-art">
                <img v-if="captchaImage" :src="captchaImage" alt="登录注册验证码" />
                <span v-else>正在加载验证码…</span>
                <el-button link class="captcha-refresh" :loading="refreshing" :disabled="busy" @click="refreshCaptcha()">刷新验证码</el-button>
              </div>
            </div>
            <div class="captcha-hint">5 分钟内有效，不区分大小写</div>
          </el-form-item>
        <div class="button-group">
          <el-button class="auth-submit" type="primary" native-type="submit" :loading="busy">{{ isRegister ? '注册' : '登录' }}</el-button>
          <el-button class="auth-switch" @click="router.push(isRegister ? '/login' : '/register')">{{ isRegister ? '返回登录界面' : '没有账号？去注册' }}</el-button>
        </div>
        </el-form>
    </div>
  </section>
</template>
