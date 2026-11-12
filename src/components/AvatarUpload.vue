<script setup>
import { ref, shallowRef, watch, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { Upload } from '@element-plus/icons-vue'
import api from '@/api.js'
import { drawAvatar } from '@/utils/avatar-crop.js'

const upload = ref(null), canvas = ref(null), image = shallowRef(null)
const dialog = ref(false), loading = ref(false), busy = ref(false), exporting = ref(false)
const zoom = ref(1), horizontal = ref(0), vertical = ref(0)
const consent = ref(false), cropped = shallowRef(null), preview = ref('')
let generation = 0
const objectUrls = new Set()
function objectUrl(blob) { const url = URL.createObjectURL(blob); objectUrls.add(url); return url }
function release(url) { if (url) { URL.revokeObjectURL(url); objectUrls.delete(url) } }
function clearPreview() {
  release(preview.value); preview.value = ''; cropped.value = null; consent.value = false
}
function renderPreview() {
  if (canvas.value && image.value) drawAvatar(canvas.value, image.value, zoom.value, horizontal.value, vertical.value)
}
watch([zoom, horizontal, vertical], renderPreview)
async function selectFile(item) {
  const current = ++generation
  upload.value?.clearFiles() // Allows selecting the same file again after cancelling.
  clearPreview()
  const file = item.raw
  if (!file || !['image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    return ElMessage.warning('请选择不超过 5MB 的 JPEG 或 PNG 照片')
  }
  loading.value = true
  const source = objectUrl(file)
  try {
    const decoded = new Image()
    decoded.src = source
    await decoded.decode()
    if (current !== generation) return
    if (!decoded.naturalWidth || !decoded.naturalHeight || decoded.naturalWidth * decoded.naturalHeight > 40_000_000) {
      throw new Error('图片尺寸过大，请使用不超过 4000 万像素的照片')
    }
    image.value = decoded
    zoom.value = 1; horizontal.value = 0; vertical.value = 0
    dialog.value = true
  } catch (error) {
    if (current === generation) ElMessage.error(error.message.includes('图片') ? error.message : '无法读取图片，请重新选择 JPEG 或 PNG 照片')
  } finally {
    release(source)
    if (current === generation) loading.value = false
  }
}
async function confirmCrop() {
  if (!image.value || exporting.value) return
  exporting.value = true
  const current = generation
  try {
    const output = document.createElement('canvas')
    output.width = output.height = 512
    drawAvatar(output, image.value, zoom.value, horizontal.value, vertical.value)
    const blob = await new Promise(resolve => output.toBlob(resolve, 'image/jpeg', 0.92))
    if (current !== generation) return
    if (!blob || blob.size > 5 * 1024 * 1024) throw new Error('裁剪失败，请重新选择照片')
    clearPreview()
    cropped.value = new File([blob], 'avatar.jpg', { type: 'image/jpeg' })
    preview.value = objectUrl(blob)
    dialog.value = false
  } catch (error) { ElMessage.error(error.message) }
  finally { exporting.value = false }
}
async function submit() {
  if (busy.value || !cropped.value || !consent.value) return
  busy.value = true
  try {
    const form = new FormData()
    form.append('consent', 'true')
    form.append('file', cropped.value)
    await api('/avatar-requests', { method: 'POST', body: form })
    clearPreview()
    ElMessage.success('照片已提交，请在我的申请中查看审核结果')
  } catch (error) { ElMessage.error(error.message) }
  finally { busy.value = false }
}
onBeforeUnmount(() => { generation++; for (const url of objectUrls) URL.revokeObjectURL(url); objectUrls.clear() })
</script>

<template>
  <section aria-label="申请更换头像">
    <h3>申请更换头像</h3>
    <p>请选择不超过 5MB 的 JPEG 或 PNG 本人正脸照片。裁剪后检测，通过后交由管理员审核。</p>
    <el-upload ref="upload" accept="image/jpeg,image/png" :auto-upload="false" :show-file-list="false"
      :disabled="busy || loading" :on-change="selectFile">
      <el-button type="primary" :icon="Upload" :disabled="busy" :loading="loading">选择照片</el-button>
    </el-upload>
    <div v-if="preview" class="cropped-preview">
      <el-image :src="preview" alt="裁剪后的待提交头像" fit="contain" class="avatar-preview" />
      <p>这张照片尚未提交，审核通过后才会替换当前头像。</p>
    </div>
    <p><el-checkbox v-model="consent" :disabled="busy || !cropped">我同意使用该照片进行人脸检测和头像审核</el-checkbox></p>
    <el-button type="primary" :loading="busy" :disabled="!cropped || !consent || loading" @click="submit">提交头像申请</el-button>
    <el-dialog v-model="dialog" title="裁剪头像" width="min(440px, 94vw)" :close-on-click-modal="false"
      :close-on-press-escape="!exporting" :show-close="!exporting" @opened="renderPreview" @closed="image = null">
      <p>请保留完整正脸，调整下方滑块选择裁剪区域。</p>
      <canvas ref="canvas" width="512" height="512" aria-label="头像裁剪预览" class="crop-canvas" />
      <el-form label-position="top">
        <el-form-item label="缩放"><el-slider v-model="zoom" :min="1" :max="3" :step="0.01" aria-label="缩放" :disabled="exporting" /></el-form-item>
        <el-form-item label="水平位置"><el-slider v-model="horizontal" :min="-100" :max="100" aria-label="水平位置" :disabled="exporting" /></el-form-item>
        <el-form-item label="垂直位置"><el-slider v-model="vertical" :min="-100" :max="100" aria-label="垂直位置" :disabled="exporting" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="exporting" @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="exporting" @click="confirmCrop">使用裁剪照片</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
h3 { margin-top: 28px; font-size: 16px; }
.crop-canvas { display: block; width: min(280px, 100%); height: auto; margin: 0 auto 20px; border: 1px solid var(--el-border-color); }
.cropped-preview { margin-top: 16px; }
.avatar-preview { width: 128px; height: 128px; border-radius: 8px; }
p { line-height: 1.6; }
</style>
