<script setup>
import { onMounted, onUnmounted } from 'vue'
import { ElNotification, ElMessage } from 'element-plus'
import api from '@/api.js'
const emit = defineEmits(['changed'])
const shown = new Map()
let timer, disposed = false, loading = false
async function poll() {
  if (disposed || loading) return
  loading = true
  try {
    const { items } = await api('/notifications')
    if (disposed) return
    for (const item of items) {
      if (shown.has(item.id)) continue
      // Bound the visible stack; older unread notifications remain persisted.
      if (shown.size >= 3) break
      const handle = ElNotification({ title: '课程变更通知', message: item.message, position: 'bottom-right', duration: 0, showClose: true,
        onClose: async () => {
          if (disposed) return
          try { await api(`/notifications/${item.id}/close`, { method: 'PATCH' }) } catch (e) { ElMessage.error(`通知关闭未保存：${e.message}`) }
          shown.delete(item.id)
          poll()
        },
      })
      shown.set(item.id, handle)
      emit('changed')
    }
  } catch (e) { if (e.status === 401) clearInterval(timer) } finally { loading = false }
}
onMounted(() => { poll(); timer = setInterval(poll, 15000) })
onUnmounted(() => { disposed = true; clearInterval(timer); for (const h of shown.values()) h.close(); shown.clear() })
</script>
<template><span hidden /></template>
