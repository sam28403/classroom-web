function parseOrigin(value) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
    return url
  } catch { return null }
}

const isLoopback = (hostname) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname)

export function isAllowedOrigin(origin, requestOrigin, env = process.env) {
  const source = parseOrigin(origin)
  const target = parseOrigin(requestOrigin)
  if (!source || !target) return false
  const configured = (env.APP_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean)
  const allowed = configured.length ? configured : [target.origin]
  if (allowed.some((value) => parseOrigin(value)?.origin === source.origin)) return true
  // Vite may use another port or localhost alias. Only relax loopback-to-loopback
  // requests during local development; production keeps the exact origin policy.
  return env.NODE_ENV !== 'production' && isLoopback(source.hostname) && isLoopback(target.hostname)
}
