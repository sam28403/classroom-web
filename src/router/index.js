import { createRouter, createWebHashHistory } from 'vue-router'
import { user, loadUser } from '@/auth.js'

const routes = [
  { path: '/', component: () => import('@/views/HomeView.vue') },
  { path: '/dashboard/:section?', component: () => import('@/views/DashboardView.vue'), meta: { requiresAuth: true } },
  { path: '/login', component: () => import('@/views/LoginView.vue') },
  { path: '/register', component: () => import('@/views/RegisterView.vue') },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

router.beforeEach(async (to) => {
  if (to.meta.requiresAuth) {
    await loadUser()
    if (!user.value) return '/login'
  }
})

export default router
