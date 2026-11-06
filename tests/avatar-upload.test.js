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
  async function upload({ cookie = learner.cookie, bytes = Buffer.from([255,216,255,1,2,3]), type = 'image/jpeg', extra = false } = {}) {
    const form = new FormData()
    form.append('file', new Blob([bytes], { type }), 'face.jpg')
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
