<script setup>
import { onMounted, onUnmounted } from 'vue'
import { ElNotification, ElMessage } from 'element-plus'
import api from '@/api.js'
const emit = defineEmits(['changed'])
const shown = new Map()
let timer, disposed = false, loading = false
const isAttendance = item => item.message.includes('已发起人脸考勤')
async function poll() {
  if (disposed || loading) return
  loading = true
  try {
    const { items } = await api('/notifications')
    if (disposed) return
    const visible = [...items.filter(isAttendance), ...items.filter(item => !isAttendance(item))].slice(0, 3)
    const visibleIds = new Set(visible.map(item => item.id))
    for (const [id, handle] of shown) {
      if (visibleIds.has(id)) continue
      // Hide displaced notices without marking them read.
      shown.delete(id)
      handle.close()
    }
    for (const item of visible) {
      if (shown.has(item.id)) continue
      const message = isAttendance(item)
        ? item.message.replace(/（北京时间）(?=。?$)/, '')
        : item.message.replace(/(课次已调整至 \d{4}-\d{2}-\d{2} \d{2}:\d{2})（北京时间）(?=，地点：)/, '$1')
      const handle = ElNotification({ title: isAttendance(item) ? '考勤通知' : '课程变更通知', message, position: 'bottom-right', duration: 0, showClose: true,
        onClose: async () => {
          if (disposed || shown.get(item.id) !== handle) return
          try { await api(`/notifications/${item.id}/close`, { method: 'PATCH' }) } catch (e) { ElMessage.error(`通知关闭未保存：${e.message}`) }
          if (shown.get(item.id) === handle) shown.delete(item.id)
          poll()
        },
      })
      shown.set(item.id, handle)
      emit('changed')
    }
  } catch (e) { if (e.status === 401) clearInterval(timer) } finally { loading = false }
}
onMounted(() => { poll(); timer = setInterval(poll, 5000) })
onUnmounted(() => { disposed = true; clearInterval(timer); for (const h of shown.values()) h.close(); shown.clear() })
</script>
<template><span hidden /></template>
