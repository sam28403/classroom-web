import { test } from 'node:test'
import assert from 'node:assert/strict'
import { demoOrigins } from '../scripts/demo-origins.js'
import { isAllowedOrigin } from '../server/origin.js'

test('demo allows both Vite and backend-served pages for LAN and loopback', () => {
  const env = { APP_ORIGINS: demoOrigins(['10.104.164.179']) }
  for (const host of ['10.104.164.179', 'localhost', '127.0.0.1', '[::1]']) {
    for (const port of [5173, 3001]) {
      assert.equal(isAllowedOrigin(`http://${host}:${port}`, 'http://10.104.164.179:3001', env), true)
    }
  }
  for (const origin of ['https://evil.example', 'null', 'http://10.104.164.179:5174']) {
    assert.equal(isAllowedOrigin(origin, 'http://10.104.164.179:3001', env), false)
  }
})

test('demo respects custom API port and existing exact origins without duplicates', () => {
  const origins = demoOrigins(['10.104.164.179', '10.104.164.179'], 3012,
    ' https://classroom.example, http://10.104.164.179:5173 ')
  const env = { APP_ORIGINS: origins }
  assert.equal(isAllowedOrigin('http://10.104.164.179:3012', 'http://127.0.0.1:3012', env), true)
  assert.equal(isAllowedOrigin('https://classroom.example', 'http://127.0.0.1:3012', env), true)
  assert.equal(origins.split(',').filter(value => value === 'http://10.104.164.179:5173').length, 1)
})
