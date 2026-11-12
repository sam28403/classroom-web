import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { base, client, createUser, db } from './helpers/account-api.js'

process.env.COMPREFACE_URL = 'http://face-service.test'
process.env.COMPREFACE_DETECTION_API_KEY = 'test-key'
const originalFetch = globalThis.fetch
let detection = []
let detectionStatus = 200
let detectionCalls = 0
globalThis.fetch = async (url, options) => {
  if (String(url).startsWith('http://face-service.test/')) {
    detectionCalls++
    assert.equal(options.headers['x-api-key'], 'test-key')
    const endpoint = new URL(url)
    assert.equal(endpoint.pathname, '/api/v1/detection/detect')
    assert.equal(endpoint.searchParams.get('limit'), '0')
    assert.equal(endpoint.searchParams.get('face_plugins'), 'pose')
    const file = options.body.get('file')
    assert.equal(file.name, file.type === 'image/png' ? 'avatar.png' : 'avatar.jpg')
    return Response.json({ result: detection }, { status: detectionStatus })
  }
  return originalFetch(url, options)
}
after(() => { globalThis.fetch = originalFetch })

test('only a detected single frontal face reaches admin review and changes the avatar after approval', async () => {
  const studentId = await createUser('avatar_student', 'Password123', 'student')
  const learner = client()
  const admin = client()
  await learner.login('avatar_student')
  await admin.login('admin', process.env.ADMIN_PASSWORD)
  async function upload({ cookie = learner.cookie, bytes = Buffer.from([255,216,255,1,2,3]), type = 'image/jpeg', extra = false, consent = 'true' } = {}) {
    const form = new FormData()
    form.append('file', new Blob([bytes], { type }), 'face.jpg')
    if (consent !== undefined && consent !== null) form.append('consent', consent)
    if (extra) form.append('file', new Blob([bytes], { type }), 'extra.jpg')
    return originalFetch(base + '/avatar-requests', { method: 'POST', headers: { Cookie: cookie }, body: form })
  }
  assert.equal((await upload({ cookie: '' })).status, 401)
  assert.equal((await upload({ cookie: admin.cookie })).status, 403)
  assert.equal((await upload({ bytes: Buffer.from('not an image') })).status, 400)
  assert.equal((await upload({ type: 'image/png' })).status, 400)
  assert.equal((await upload({ bytes: Buffer.alloc(5 * 1024 * 1024 + 1) })).status, 413)
  assert.equal((await upload({ extra: true })).status, 400)
  assert.equal(detectionCalls, 0)
  for (const consent of [null, '', 'false', '1', 'TRUE']) {
    const response = await upload({ consent })
    assert.equal(response.status, 400)
    assert.equal((await response.json()).code, 'CONSENT_REQUIRED')
  }
  assert.equal(detectionCalls, 0, 'no photo is sent to CompreFace without consent')
  assert.equal((await db.get('SELECT COUNT(*) AS total FROM avatar_images')).total, 0)
  assert.equal((await upload()).status, 422)
  const face = { box: { probability: 0.99 }, pose: { yaw: 0, pitch: 0, roll: 0 } }
  detection = [face, face]
  assert.equal((await upload()).status, 422)
  detection = [{ ...face, pose: { yaw: 30, pitch: 0, roll: 0 } }]
  assert.equal((await upload()).status, 422)
  detection = [null]
  assert.equal((await upload()).status, 503)
  detection = [{ box: { probability: 0.99 } }]
  assert.equal((await upload()).status, 503)
  detection = [{ ...face, box: { probability: 0.8 } }]
  assert.equal((await upload()).status, 422)
  detection = [face]
  detectionStatus = 503
  assert.equal((await upload()).status, 503)
  detectionStatus = 200
  assert.equal((await db.get('SELECT COUNT(*) AS total FROM avatar_images')).total, 0)
  const submitted = await upload()
  assert.equal(submitted.status, 202)
  const { requestId } = await submitted.json()
  assert.equal((await db.get('SELECT avatar FROM users WHERE id=?', [studentId])).avatar, null)
  assert.equal((await upload()).status, 409)
  const request = (await admin.request('/requests')).items.find(row => row.id === requestId)
  assert.equal(request.payload.photoConsent.version, 'avatar-v1')
  assert.ok(Number.isFinite(Date.parse(request.payload.photoConsent.acceptedAt)))
  const imagePath = '/avatar-images/' + request.payload.imageId
  const outsider = client()
  await createUser('avatar_outsider', 'Password123', 'student')
  await outsider.login('avatar_outsider')
  assert.equal((await originalFetch(base + imagePath, { headers: { Cookie: outsider.cookie } })).status, 403)
  assert.equal((await originalFetch(base + imagePath, { headers: { Cookie: admin.cookie } })).status, 200)
  await learner.request('/requests/' + requestId, 'PATCH', { status: 'approved', note: '自行审核' }, 403)
  await admin.request('/requests/' + requestId, 'PATCH', { status: 'approved', note: '已核对' })
  assert.equal((await db.get('SELECT avatar FROM users WHERE id=?', [studentId])).avatar, '/api' + imagePath)
  await admin.request('/requests/' + requestId, 'PATCH', { status: 'approved', note: '重复审核' }, 409)
  assert.equal((await originalFetch(base + imagePath, { headers: { Cookie: outsider.cookie } })).status, 200)
  const replacement = await upload()
  assert.equal(replacement.status, 202)
  const replacementId = (await replacement.json()).requestId
  const replacementRequest = (await admin.request('/requests')).items.find(row => row.id === replacementId)
  await admin.request('/requests/' + replacementId, 'PATCH', { status: 'rejected', note: '照片不符合要求' })
  assert.equal((await db.get('SELECT avatar FROM users WHERE id=?', [studentId])).avatar, '/api' + imagePath)
  assert.equal((await originalFetch(base + '/avatar-images/' + replacementRequest.payload.imageId, { headers: { Cookie: admin.cookie } })).status, 404)
  const concurrent = await Promise.all([upload(), upload()])
  assert.deepEqual(concurrent.map(response => response.status).sort(), [202, 409])
  assert.equal((await db.get('SELECT COUNT(*) AS total FROM avatar_images')).total, 2)
  const accepted = concurrent.find(response => response.status === 202)
  const nextId = (await accepted.json()).requestId
  await admin.request('/requests/' + nextId, 'PATCH', { status: 'approved', note: '更新头像' })
  assert.notEqual((await learner.request('/auth/me')).user.avatar, '/api' + imagePath)
  assert.equal((await originalFetch(base + imagePath, { headers: { Cookie: admin.cookie } })).status, 404)
  assert.equal((await db.get('SELECT COUNT(*) AS total FROM avatar_images')).total, 1)
  const png = await upload({ type: 'image/png', bytes: Buffer.from([137,80,78,71,13,10,26,10]) })
  assert.equal(png.status, 202)
  await admin.request('/requests/' + (await png.json()).requestId, 'PATCH', { status: 'rejected', note: '测试清理' })
  delete process.env.COMPREFACE_DETECTION_API_KEY
  assert.equal((await upload()).status, 503)
})

test('account removal atomically clears approved and pending photos, revokes access and preserves review history', async () => {
  process.env.COMPREFACE_DETECTION_API_KEY = 'test-key'
  const userId = await createUser('avatar_removed', 'Password123', 'student')
  const learner = client(), admin = client(), outsider = client()
  await learner.login('avatar_removed')
  await admin.login('admin', process.env.ADMIN_PASSWORD)
  await outsider.login('avatar_outsider')
  const approved = await db.run('INSERT INTO avatar_images(user_id,mime_type,image_data) VALUES (?,?,?)', [userId, 'image/jpeg', Buffer.from('approved')])
  const pending = await db.run('INSERT INTO avatar_images(user_id,mime_type,image_data) VALUES (?,?,?)', [userId, 'image/jpeg', Buffer.from('pending')])
  await db.run('UPDATE users SET avatar=? WHERE id=?', [`/api/avatar-images/${approved.insertId}`, userId])
  const request = await db.run('INSERT INTO change_requests(user_id,kind,target_id,payload,created_at) VALUES (?,?,?,?,?)', [userId, 'avatar_change', userId, JSON.stringify({ imageId: pending.insertId }), new Date().toISOString()])
  // A failure later in the same removal transaction must restore the images and account.
  await db.run("CREATE TRIGGER fail_avatar_removal BEFORE INSERT ON audit_logs WHEN NEW.action='user.remove' BEGIN SELECT RAISE(ABORT, 'test rollback'); END")
  await admin.request('/users/' + userId, 'DELETE', undefined, 500)
  assert.equal((await db.get('SELECT status FROM users WHERE id=?', [userId])).status, 'active')
  assert.equal((await db.get('SELECT COUNT(*) AS total FROM avatar_images WHERE user_id=?', [userId])).total, 2)
  assert.equal((await db.get('SELECT status FROM change_requests WHERE id=?', [request.insertId])).status, 'pending')
  await db.run('DROP TRIGGER fail_avatar_removal')
  await admin.request('/users/' + userId, 'DELETE')
  assert.deepEqual(await db.get('SELECT status,avatar FROM users WHERE id=?', [userId]), { status: 'deleted', avatar: null })
  assert.equal((await db.get('SELECT COUNT(*) AS total FROM avatar_images WHERE user_id=?', [userId])).total, 0)
  assert.equal((await db.get('SELECT status FROM change_requests WHERE id=?', [request.insertId])).status, 'rejected')
  for (const cookie of [admin.cookie, outsider.cookie]) for (const imageId of [approved.insertId, pending.insertId]) {
    assert.equal((await originalFetch(base + '/avatar-images/' + imageId, { headers: { Cookie: cookie } })).status, 404)
  }
  assert.equal((await originalFetch(base + '/avatar-images/' + approved.insertId, { headers: { Cookie: learner.cookie } })).status, 401)
  // Defence in depth for historical records left by older versions.
  const legacy = await db.run('INSERT INTO avatar_images(user_id,mime_type,image_data) VALUES (?,?,?)', [userId, 'image/jpeg', Buffer.from('legacy')])
  await db.run('UPDATE users SET avatar=? WHERE id=?', [`/api/avatar-images/${legacy.insertId}`, userId])
  for (const cookie of [admin.cookie, outsider.cookie]) {
    assert.equal((await originalFetch(base + '/avatar-images/' + legacy.insertId, { headers: { Cookie: cookie } })).status, 404)
  }
  await db.run('DELETE FROM avatar_images WHERE user_id=?', [userId])
})

test('deletion while CompreFace is processing cannot recreate a photo', async () => {
  const userId = await createUser('avatar_race', 'Password123', 'student')
  const learner = client(), admin = client()
  await learner.login('avatar_race'); await admin.login('admin', process.env.ADMIN_PASSWORD)
  const previous = globalThis.fetch
  let started, finish
  const inFlight = new Promise(resolve => { started = resolve })
  const gate = new Promise(resolve => { finish = resolve })
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('http://face-service.test/')) {
      started(); await gate
      return Response.json({ result: [{ box: { probability: .99 }, pose: { yaw: 0, pitch: 0, roll: 0 } }] })
    }
    return previous(url, options)
  }
  try {
    const form = new FormData()
    form.append('consent', 'true')
    form.append('file', new Blob([Buffer.from([255,216,255,1])], { type: 'image/jpeg' }), 'face.jpg')
    const upload = originalFetch(base + '/avatar-requests', { method: 'POST', headers: { Cookie: learner.cookie }, body: form })
    await inFlight
    await admin.request('/users/' + userId, 'DELETE')
    finish()
    assert.equal((await upload).status, 403)
    assert.equal((await db.get('SELECT COUNT(*) AS total FROM avatar_images WHERE user_id=?', [userId])).total, 0)
  } finally { finish(); globalThis.fetch = previous }
})
