import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promisify } from 'node:util'
import { client, db, createUser } from './helpers/account-api.js'
import Store from '../server/session-store.js'

const sid = browser => decodeURIComponent(browser.cookie.split('=')[1]).slice(2).split('.')[0]
const androidLogin = async (device, username, password = 'Password123', status = 200) =>
  device.request('/android/auth/login', 'POST', {
    username, password, code: await device.captcha(),
  }, status)

test('Android and Web can coexist; a new Android login replaces only Android', async () => {
  const userId = await createUser('android_slots', 'Password123', 'student')
  const web = client(), first = client(), second = client()
  await web.login('android_slots')
  const result = await androidLogin(first, 'android_slots')
  assert.equal(result.user.username, 'android_slots')
  assert.equal(result.user.password_hash, undefined)
  const oldSid = sid(first)
  const saved = JSON.parse((await db.get('SELECT data FROM sessions WHERE sid=?', [oldSid])).data)
  await androidLogin(second, 'android_slots')
  await first.request('/auth/me', 'GET', undefined, 401)
  await first.request('/auth/refresh', 'POST', {}, 401)
  await promisify(new Store().set).call(new Store(), oldSid, saved)
  assert.equal(await db.get('SELECT sid FROM sessions WHERE sid=?', [oldSid]), undefined)
  await web.request('/auth/me')
  await second.request('/auth/me')
  await second.request('/auth/refresh', 'POST', {})
  assert.deepEqual(
    (await db.all('SELECT client_type FROM sessions WHERE user_id=?', [userId]))
      .map(row => row.client_type).sort(),
    ['android', 'web'],
  )
  await second.request('/auth/logout', 'POST', {})
  await second.request('/auth/me', 'GET', undefined, 401)
  await web.request('/auth/me')
})

test('simultaneous Android logins leave one usable session', async () => {
  const userId = await createUser('android_parallel', 'Password123', 'student')
  const devices = [client(), client()]
  await Promise.all(devices.map(device => androidLogin(device, 'android_parallel')))
  const sessions = await db.all('SELECT sid,client_type FROM sessions WHERE user_id=?', [userId])
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].client_type, 'android')
  for (const device of devices) {
    await device.request('/auth/me', 'GET', undefined, sid(device) === sessions[0].sid ? 200 : 401)
  }
})

test('Android login requires a fresh captcha bound to the requesting cookie', async () => {
  await createUser('android_captcha', 'Password123', 'student')
  const device = client(), stranger = client()
  await device.request('/android/auth/login', 'POST', {
    username: 'android_captcha', password: 'Password123', code: 'ABCDE',
  }, 400)
  const code = await device.captcha()
  await stranger.request('/android/auth/login', 'POST', {
    username: 'android_captcha', password: 'Password123', code,
  }, 400)
  await device.request('/android/auth/login', 'POST', {
    username: 'android_captcha', password: 'wrong', code,
  }, 401)
  await device.request('/android/auth/login', 'POST', {
    username: 'android_captcha', password: 'Password123', code,
  }, 400)
  await androidLogin(device, 'android_captcha')
})

test('the route determines the platform and rejects mismatched or unknown client types', async () => {
  await createUser('android_platform', 'Password123', 'student')
  const device = client()
  for (const [path, clientType] of [
    ['/auth/login', 'android'], ['/user/login', 'android'],
    ['/android/auth/login', 'web'], ['/android/auth/login', 'unknown'],
  ]) {
    await device.request(path, 'POST', {
      username: 'android_platform', password: 'Password123',
      client_type: clientType, code: await device.captcha(),
    }, 400)
  }
  await device.request('/android/auth/login', 'POST', {
    username: 'android_platform', password: 'Password123',
    client_type: 'android', code: await device.captcha(),
  })
  for (const path of ['/android/auth/login/', '/ANDROID/AUTH/LOGIN']) {
    await device.request(path, 'POST', {
      username: 'android_platform', password: 'Password123',
      client_type: 'android', code: await device.captcha(),
    })
    const session = await db.get('SELECT client_type FROM sessions WHERE sid=?', [sid(device)])
    assert.equal(session.client_type, 'android')
  }
})

test('disabled accounts and pending resets block Android; password changes revoke both platforms', async () => {
  const userId = await createUser('android_status', 'Password123', 'student')
  const web = client(), device = client(), anonymous = client()
  await db.run("UPDATE users SET status='disabled' WHERE id=?", [userId])
  await androidLogin(device, 'android_status', 'Password123', 403)
  await db.run("UPDATE users SET status='active' WHERE id=?", [userId])
  await web.login('android_status')
  await androidLogin(device, 'android_status')
  await web.request('/auth/password', 'PATCH', {
    currentPassword: 'Password123', password: 'Changed-password123',
  })
  await device.request('/auth/me', 'GET', undefined, 401)
  await androidLogin(device, 'android_status', 'Changed-password123')
  await anonymous.request('/auth/reset-request', 'POST', {
    username: 'android_status', role: 'student', number: 'android_status',
    name: 'android_status', code: await anonymous.captcha(),
  }, 202)
  await device.request('/auth/me', 'GET', undefined, 401)
  await device.request('/auth/refresh', 'POST', {}, 401)
  const result = await androidLogin(device, 'android_status', 'Changed-password123', 403)
  assert.equal(result.code, 'PASSWORD_RESET_PENDING')
})

test('Web and Android share the account login rate limit', async () => {
  const device = client()
  for (let attempt = 0; attempt < 11; attempt++) {
    await device.request(attempt % 2 ? '/auth/login' : '/android/auth/login', 'POST', {
      username: 'shared_limit', password: 'bad', code: 'invalid',
    }, attempt < 10 ? 400 : 429)
  }
})
