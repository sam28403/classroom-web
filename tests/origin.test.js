import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAllowedOrigin } from '../server/origin.js'

test('local debugging supports loopback aliases and changing Vite ports', () => {
  for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5174', 'http://[::1]:4173']) {
    assert.equal(isAllowedOrigin(origin, 'http://127.0.0.1:3001', {}), true)
    assert.equal(isAllowedOrigin(origin, 'http://localhost:3001', { APP_ORIGINS: 'http://localhost:5173' }), true)
  }
})
test('external, opaque and lookalike origins remain blocked locally', () => {
  for (const origin of ['https://evil.example', 'http://localhost.evil.example:5173', 'http://127.0.0.1.evil.example', 'null', 'invalid']) {
    assert.equal(isAllowedOrigin(origin, 'http://localhost:3001', {}), false)
  }
  assert.equal(isAllowedOrigin('http://localhost:5173', 'http://192.168.1.10:3001', {}), false)
})
test('production retains exact origin allowlist and tolerates whitespace', () => {
  const env = { NODE_ENV: 'production', APP_ORIGINS: ' https://classroom.example, https://admin.example/ ' }
  assert.equal(isAllowedOrigin('https://classroom.example', 'http://api:3001', env), true)
  assert.equal(isAllowedOrigin('https://admin.example', 'http://api:3001', env), true)
  assert.equal(isAllowedOrigin('http://localhost:5173', 'http://localhost:3001', env), false)
  assert.equal(isAllowedOrigin('http://localhost:5173', 'http://localhost:3001', { NODE_ENV: 'production' }), false)
  assert.equal(isAllowedOrigin('http://localhost:3001', 'http://localhost:3001', { NODE_ENV: 'production' }), true)
})
