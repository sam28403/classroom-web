const baseURL = import.meta.env.VITE_API_BASE_URL || '/api'
let unauthorizedHandler = () => () => {}

export function setUnauthorizedHandler(factory) {
  unauthorizedHandler = factory
}

async function request(path, options, downloadType) {
  const handleUnauthorized = unauthorizedHandler()
  const response = await fetch(`${baseURL}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  const contentType = response.headers.get('content-type')
  if (downloadType && response.ok && contentType?.split(';')[0] === downloadType) return response.blob()
  if (!contentType?.includes('application/json')) {
    throw new Error('后端未正确响应，请使用 npm run dev:full 启动完整服务')
  }
  const result = await response.json()
  if (!response.ok) {
    if (response.status === 401 && result.code === 'UNAUTHENTICATED') {
      handleUnauthorized()
    }
    const error = new Error(result.message || '请求失败')
    error.status = response.status
    throw error
  }
  if (downloadType) throw new Error('服务器未返回预期的考勤文件格式')
  return result
}

export function downloadFile(path, contentType) {
  return request(path, {}, contentType)
}

export default function api(path, options = {}) {
  return request(path, options)
}
