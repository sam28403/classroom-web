import { networkInterfaces } from 'node:os'
import { spawn } from 'node:child_process'

const port = 5173
const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((entry) => entry && !entry.internal && entry.family === 'IPv4')
  .map((entry) => entry.address)
const localAddresses = [...new Set(addresses)]
const origins = localAddresses.map((address) => `http://${address}:${port}`)
const configuredOrigins = (process.env.APP_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

if (process.env.NODE_ENV === 'production') {
  throw new Error('demo:full 用于开发演示，请移除 NODE_ENV=production 后重试')
}

console.log('局域网演示地址：')
for (const origin of origins) {
  console.log(`  ${origin}`)
}

const apiPort = Number(process.env.API_PORT || 3001)
console.log(`后端本机地址：http://127.0.0.1:${apiPort}`)
console.log('后端局域网地址：')
for (const address of localAddresses) {
  console.log(`  http://${address}:${apiPort}`)
}

const child = spawn(process.execPath, [process.env.npm_execpath, 'run', 'dev'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    CLASSROOM_DEMO: '1',
    API_HOST: '0.0.0.0',
    API_PROXY_TARGET: process.env.API_PROXY_TARGET || `http://127.0.0.1:${apiPort}`,
    APP_ORIGINS: [...new Set([
      ...configuredOrigins,
      `http://localhost:${port}`,
      ...origins,
    ])].join(','),
  },
})

child.on('error', (error) => {
  console.error('演示服务启动失败：', error.message)
  process.exitCode = 1
})
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
