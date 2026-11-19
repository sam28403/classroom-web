import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getMessaging } from 'firebase-admin/messaging'
import { base, db, client, createUser } from './helpers/account-api.js'
import { deliverAttendancePush } from '../server/push.js'

process.env.COMPREFACE_URL = 'http://attendance-face.test'
process.env.COMPREFACE_API_KEY = 'test'
const realFetch = globalThis.fetch
let subject, registeredBytes, mode = 'match', registrations = 0, changeDuringRecognition, sampleMissing = false, beforeSampleQuery
const jpeg = Buffer.from([255,216,255,3,4])
globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith(process.env.COMPREFACE_URL)) return realFetch(url, options)
  const u = new URL(url)
  if (mode === 'outage') return Response.json({}, { status: 503 })
  if (options.method === 'DELETE') return Response.json({})
  if (options.method === 'GET' && u.pathname.endsWith('/faces')) {
    if (beforeSampleQuery) await beforeSampleQuery()
    return Response.json({ faces: !sampleMissing && subject === u.searchParams.get('subject') ? [{ subject, image_id: 'registered' }] : [] })
  }
  if (u.pathname.endsWith('/faces')) {
    registrations++; subject = u.searchParams.get('subject')
    sampleMissing = false
    registeredBytes = Buffer.from(await options.body.get('file').arrayBuffer())
    return Response.json({ subject, image_id: 'registered' })
  }
  if (changeDuringRecognition) { const fn = changeDuringRecognition; changeDuringRecognition = null; await fn() }
  return Response.json({ result: [{ subjects: [{ subject: mode === 'other' ? 'someone-else' : subject, similarity: .99 }] }] })
}
after(() => { globalThis.fetch = realFetch })

test('Android-only attendance uses approved avatar, complete roster, updates, failures and finalization', async () => {
  const admin = client(), teacher = client(), web = client(), android = client(), otherTeacher = client()
  await admin.login('admin', process.env.ADMIN_PASSWORD)
  await createUser('attendance_teacher', 'Password123', 'teacher')
  await teacher.login('attendance_teacher')
  await createUser('other_attendance_teacher', 'Password123', 'teacher'); await otherTeacher.login('other_attendance_teacher')
  const uid = await createUser('attendance_student', 'Password123', 'student')
  await createUser('attendance_missing', 'Password123', 'student')
  await web.login('attendance_student')
  await android.request('/android/auth/login', 'POST', { username: 'attendance_student', password: 'Password123', code: await android.captcha() })
  await web.request('/android/push-token', 'POST', { token: 'not-an-android-session' }, 403)
  await android.request('/android/push-token', 'POST', { token: 'test-device-token' })
  const tid = (await db.get('SELECT id FROM teachers WHERE user_id=(SELECT id FROM users WHERE username=?)', ['attendance_teacher'])).id
  const sid = (await db.get('SELECT id FROM students WHERE user_id=?', [uid])).id
  const missing = (await db.get('SELECT id FROM students WHERE user_id=(SELECT id FROM users WHERE username=?)', ['attendance_missing'])).id
  const course = await admin.request('/courses', 'POST', { course_code: 'FACE1', course_name: '人脸签到课' }, 201)
  const cls = await admin.request('/teaching-classes', 'POST', { course_id: course.id, teacher_id: tid, term: '2026秋', name: '签到班' }, 201)
  for (const student_id of [sid, missing]) await teacher.request(`/teaching-classes/${cls.id}/enrollments`, 'POST', { student_id }, 201)
  let previousTask
  async function task() {
    if (previousTask) await teacher.request(`/attendance-tasks/${previousTask.id}/end`, 'POST', {})
    previousTask = await teacher.request('/attendance-tasks', 'POST', { teaching_class_id: cls.id, start_at: new Date(Date.now()-1000).toISOString(), late_at: new Date(Date.now()+30000).toISOString(), end_at: new Date(Date.now()+60000).toISOString() }, 201)
    return previousTask
  }
  async function check(c, taskId, expected) {
    const body = new FormData(); body.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'live.jpg')
    const response = await realFetch(`${base}/attendance-tasks/${taskId}/check-in`, { method: 'POST', headers: { Cookie: c.cookie, 'X-Client-Type': 'android' }, body })
    const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result
  }
  async function approve(bytes) {
    const img = await db.run('INSERT INTO avatar_images(user_id,mime_type,image_data) VALUES (?,?,?)', [uid, 'image/jpeg', bytes])
    const req = await db.run("INSERT INTO change_requests(user_id,kind,payload,created_at) VALUES (?,'avatar_change',?,?)", [uid, JSON.stringify({ imageId: img.insertId }), new Date().toISOString()])
    await admin.request(`/requests/${req.insertId}`, 'PATCH', { status: 'approved', note: '核对本人头像' })
    return img.insertId
  }
  const t = await task()
  assert.equal((await db.get('SELECT status FROM push_deliveries WHERE task_id=?', [t.id])).status, 'pending')
  const oldPushSession = (await db.get('SELECT session_id FROM push_devices WHERE user_id=?', [uid])).session_id
  await android.request('/auth/refresh', 'POST', {})
  const newPushSession = (await db.get('SELECT session_id FROM push_devices WHERE user_id=?', [uid])).session_id
  assert.notEqual(newPushSession, oldPushSession)
  assert.equal((await db.get('SELECT session_id FROM push_deliveries WHERE task_id=?', [t.id])).session_id, newPushSession)
  let roster = await teacher.request(`/attendance-tasks/${t.id}/records`)
  assert.equal(roster.total, 2); assert.equal(roster.counts.unrecorded, 2)
  await otherTeacher.request(`/attendance-tasks/${t.id}/records`, 'GET', undefined, 403)
  assert.equal((await check(web, t.id, 403)).code, 'ANDROID_REQUIRED')
  assert.equal((await check(android, t.id, 403)).code, 'CONSENT_REQUIRED')
  await android.request('/faces/consent', 'POST', { decision: 'agree', policy_version: 'face-v1' })
  assert.equal((await check(android, t.id, 409)).code, 'AVATAR_REQUIRED')
  const approved = Buffer.from([255,216,255,9,9]); await approve(approved)
  // A client-supplied registration file must not replace the approved reference.
  const malicious = new FormData(); malicious.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'another-face.jpg')
  const registration = await realFetch(base + '/faces/register', { method: 'POST', headers: { Cookie: android.cookie }, body: malicious })
  assert.equal(registration.status, 201)
  assert.ok(registeredBytes.equals(approved))
  assert.equal((await android.request('/faces/me')).ready, true)
  let sampleStarted, releaseSample
  const queried = new Promise(resolve => { sampleStarted = resolve })
  const holdSample = new Promise(resolve => { releaseSample = resolve })
  beforeSampleQuery = () => { sampleStarted(); return holdSample }
  const checking = check(android, t.id, 201)
  try {
    await Promise.race([queried, checking])
    const response = await realFetch(base + '/courses', { headers: { Cookie: teacher.cookie }, signal: AbortSignal.timeout(2000) })
    assert.equal(response.status, 200)
  } finally {
    beforeSampleQuery = null
    releaseSample()
    await checking
  }
  await check(android, t.id, 409)
  assert.equal((await android.request('/attendance-tasks/available')).items.length, 0)
  const notice = (await web.request('/notifications')).items.find(item => item.message.includes('已发起人脸考勤'))
  assert.ok(notice)
  assert.doesNotMatch(notice.message, /北京时间/)
  await teacher.request('/attendance-tasks', 'POST', { teaching_class_id: cls.id, start_at: new Date(Date.now()-1000).toISOString(), late_at: new Date(Date.now()+30000).toISOString(), end_at: new Date(Date.now()+60000).toISOString() }, 409)
  roster = await teacher.request(`/attendance-tasks/${t.id}/records`)
  assert.equal(roster.counts.present, 1); assert.equal(roster.counts.unrecorded, 1)
  const revised = await teacher.request(`/attendance-tasks/${t.id}/manual`, 'POST', { student_id: sid, status: 'late', reason: '教师核对' })
  assert.ok(revised.id)
  assert.equal((await db.get('SELECT after_status FROM review_records WHERE attendance_record_id=?', [revised.id])).after_status, 'late')
  const replacement = Buffer.from([255,216,255,8,8]); await approve(replacement)
  assert.equal((await android.request('/faces/me')).ready, false)
  const second = await task()
  await db.run("UPDATE push_deliveries SET status='sending', available_at=? WHERE task_id=?", [new Date(Date.now()-1000).toISOString(), second.id])
  await android.request('/auth/refresh', 'POST', {})
  const app = initializeApp({ projectId: 'classroom-test' })
  const messaging = getMessaging(app)
  const sent = []
  messaging.send = async message => { sent.push(message); return 'test-message-id' }
  const previousProjectId = process.env.FIREBASE_PROJECT_ID
  process.env.FIREBASE_PROJECT_ID = 'classroom-test'
  try {
    await deliverAttendancePush()
    assert.equal((await db.get('SELECT status FROM push_deliveries WHERE task_id=?', [second.id])).status, 'sent')
    assert.deepEqual(sent.map(message => [message.data.taskId, message.token]), [[String(second.id), 'test-device-token']])
  } finally {
    if (previousProjectId === undefined) delete process.env.FIREBASE_PROJECT_ID
    else process.env.FIREBASE_PROJECT_ID = previousProjectId
    await deleteApp(app)
  }
  await check(android, second.id, 201)
  assert.ok(registeredBytes.equals(replacement)); assert.equal(registrations, 2)
  sampleMissing = true
  assert.equal((await android.request('/faces/me')).ready, false)
  const recovered = await task()
  const beforeRecovery = registrations
  await check(android, recovered.id, 201)
  assert.equal(registrations, beforeRecovery + 1)
  mode = 'other'; const bad = await task(); assert.equal((await check(android, bad.id, 202)).status, 'exception')
  mode = 'outage'; const outage = await task(); await check(android, outage.id, 503)
  assert.equal(await db.get('SELECT id FROM attendance_records WHERE task_id=?', [outage.id]), undefined)
  mode = 'match'; await check(android, outage.id, 201)
  const race = await task(); changeDuringRecognition = () => approve(Buffer.from([255,216,255,7,7]))
  assert.equal((await check(android, race.id, 409)).code, 'AVATAR_CHANGED')
  assert.equal(await db.get('SELECT id FROM attendance_records WHERE task_id=?', [race.id]), undefined)
  await teacher.request(`/attendance-tasks/${t.id}/end`, 'POST', {})
  roster = await teacher.request(`/attendance-tasks/${t.id}/records`)
  assert.equal(roster.counts.absent, 1); assert.equal(roster.counts.late, 1)
  await check(android, t.id, 409)
  await android.request('/auth/logout', 'POST', {})
  assert.equal(await db.get('SELECT id FROM push_devices WHERE user_id=?', [uid]), undefined)
})
