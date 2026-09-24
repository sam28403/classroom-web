import { fail } from './http.js'

export async function faceRequest(path, file, method = 'POST') {
  const base = process.env.COMPREFACE_URL
  const key = process.env.COMPREFACE_API_KEY
  if (!base || !key) fail(503, '人脸服务尚未配置', 'FACE_UNAVAILABLE')
  const form = file ? new FormData() : undefined
  if (file) form.append('file', new Blob([file.buffer], { type: file.mimetype }), 'face.' + (file.mimetype === 'image/png' ? 'png' : 'jpg'))
  let response
  try {
    response = await fetch(`${base.replace(/\/$/, '')}/api/v1/recognition${path}`, {
      method, headers: { 'x-api-key': key }, body: form, signal: AbortSignal.timeout(4500),
    })
  } catch { fail(503, '人脸服务不可用', 'FACE_UNAVAILABLE') }
  if (method === 'DELETE' && response.status === 404) return {}
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (data.code === 28) fail(422, '未检测到人脸', 'NO_FACE')
    if ([400, 422].includes(response.status)) fail(422, '图片无法用于识别，请确保清晰且只有一张人脸', 'INVALID_FACE')
    fail(503, '人脸服务不可用', 'FACE_UNAVAILABLE')
  }
  return data
}
export async function recognize(file, subject) {
  const data = await faceRequest('/recognize?limit=0&prediction_count=1', file)
  if (!Array.isArray(data.result)) fail(503, '识别服务响应格式错误', 'FACE_UNAVAILABLE')
  if (!data.result.length) fail(422, '未检测到人脸', 'NO_FACE')
  if (data.result.length !== 1) fail(422, '检测到多个人脸，请单人入镜', 'MULTIPLE_FACES')
  const candidate = data.result[0].subjects?.[0]
  const similarity = candidate?.subject === subject ? Number(candidate.similarity) : 0
  const threshold = Number(process.env.FACE_THRESHOLD || 0.85)
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) fail(503, '阈值配置错误', 'FACE_UNAVAILABLE')
  if (!Number.isFinite(similarity) || similarity < 0 || similarity > 1) fail(503, '相似度格式错误', 'FACE_UNAVAILABLE')
  return { similarity, matched: similarity >= threshold }
}
