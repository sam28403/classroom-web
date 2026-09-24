import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { generateSessions } from '../shared/schedule.js'

process.env.DATABASE_PATH = ':memory:'
process.env.ADMIN_PASSWORD = 'Schedule-admin123'
process.env.SESSION_SECRET = 'schedule-test-session-secret-32-characters'
delete process.env.DB_DRIVER
delete process.env.NODE_ENV
delete process.env.COOKIE_SECURE
const { default: app } = await import('../server/app.js')
const { default: db } = await import('../server/db/db.js')
const { createUser } = await import('../server/auth.js')
const server = app.listen(0, '127.0.0.1')
await once(server, 'listening')
const base = `http://127.0.0.1:${server.address().port}/api`
after(async () => { await new Promise((r) => server.close(r)); await db.close() })
async function client(username, role) {
  await createUser(username, 'Schedule-test123', role)
  let cookie = ''
  const request = async (path, method = 'GET', body, status = 200) => {
    const response = await fetch(base + path, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    if (response.headers.getSetCookie().length) cookie = response.headers.getSetCookie()[0].split(';')[0]
    const result = await response.json()
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(result)}`)
    return result
  }
  await request('/captcha')
  const sid = decodeURIComponent(cookie.split('=')[1]).slice(2).split('.')[0]
  const code = (await db.get('SELECT text FROM captchas WHERE session_id=?', [sid])).text
  await request('/auth/login', 'POST', { username, password: 'Schedule-test123', code })
  return request
}
const schedule = { date: '2090-10-02', start: '13:30', end: '15:00', repeat: 'weekly', interval: 1, weekdays: [1, 3], until: '2090-10-30', location: '教学楼 1001' }
const body = { course_name: 'C 程序设计', english_name: 'C Programming', name: '计算机一班', term: '2090 秋', schedule }

test('recurrence calendar, timezone, bounds and empty rules', () => {
  const once = generateSessions({ ...schedule, repeat: 'once' })
  assert.equal(once[0].start_at, '2090-10-02T05:30:00.000Z')
  const weekly = generateSessions(schedule)
  assert.ok(weekly.length > 3)
  assert.ok(weekly.every((s) => [1, 3].includes(new Date(s.start_at).getUTCDay())))
  const alternate = generateSessions({ ...schedule, interval: 2 })
  assert.ok(alternate.length < weekly.length)
  assert.equal(generateSessions({ ...schedule, repeat: 'daily', interval: 2, until: '2090-10-06' }).length, 3)
  for (const changes of [{ date: '2090-02-30' }, { start: '15:30' }, { weekdays: [] }, { until: '2090-09-01' }, { until: '2092-10-01' }, { interval: 0 }, { start: '25:00' }]) assert.throws(() => generateSessions({ ...schedule, ...changes }))
})

test('persisted teacher scheduling, role isolation, collisions, rescheduling and rollback', async () => {
  const teacher = await client('schedule_teacher', 'teacher')
  const other = await client('schedule_other', 'teacher')
  const student = await client('schedule_student', 'student')
  await student('/scheduled-courses', 'POST', body, 403)
  await teacher('/scheduled-courses', 'POST', { ...body, english_name: '' }, 400)
  const created = await teacher('/scheduled-courses', 'POST', body, 201)
  const initial = await teacher('/schedule')
  assert.equal(initial.classes[0].english_name, 'C Programming')
  assert.equal(initial.sessions.length, generateSessions(schedule).length)
  assert.equal((await other('/schedule')).classes.length, 0)
  assert.equal((await student('/schedule')).sessions.length, 0)
  await teacher('/scheduled-courses', 'POST', body, 409)
  assert.equal((await teacher('/schedule')).classes.length, 1, 'conflicting creation rolls back the class too')
  await teacher(`/scheduled-courses/${created.id}/students`, 'POST', { student_no: 'schedule_student' }, 201)
  assert.equal((await student('/schedule')).sessions.length, initial.sessions.length)
  await teacher(`/scheduled-courses/${created.id}/students`, 'POST', { student_no: 'schedule_student' }, 409)
  await other(`/scheduled-courses/${created.id}/students`, 'POST', { student_no: 'schedule_student' }, 403)
  const first = initial.sessions[0]
  const single = { date: '2090-11-01', start: '10:00', end: '11:30', location: '实验楼 201', reason: '节假日调课' }
  await other(`/course-sessions/${first.id}`, 'PATCH', single, 403)
  await student(`/course-sessions/${first.id}`, 'PATCH', single, 403)
  await teacher(`/course-sessions/${first.id}`, 'PATCH', { ...single, reason: '' }, 400)
  await teacher(`/course-sessions/${first.id}`, 'PATCH', single)
  const updated = await student('/schedule')
  const moved = updated.sessions.find((s) => s.id === first.id)
  assert.equal(moved.original_start, first.start_at)
  assert.equal(moved.start_at, '2090-11-01T02:00:00.000Z')
  assert.equal(moved.change_reason, single.reason)
  assert.deepEqual(updated.sessions.filter((s) => s.id !== first.id), initial.sessions.filter((s) => s.id !== first.id))
  const next = initial.sessions[1]
  await teacher(`/course-sessions/${first.id}`, 'PATCH', { ...single, date: next.start_at.slice(0, 10), start: '13:45', end: '14:00' }, 409)
  assert.equal((await teacher('/schedule')).sessions.find((s) => s.id === first.id).start_at, moved.start_at)
  await other(`/scheduled-courses/${created.id}`, 'PUT', { ...body, reason: '改课' }, 403)
  await db.run('INSERT INTO course_sessions(teaching_class_id,start_at,end_at,location,original_start) VALUES (?,?,?,?,?)', [created.id, '2020-01-01T01:00:00.000Z', '2020-01-01T02:00:00.000Z', '旧教室', '2020-01-01T01:00:00.000Z'])
  const replacement = { ...body, reason: '新课表', schedule: { ...schedule, repeat: 'daily', interval: 1, date: '2090-12-01', until: '2090-12-03' } }
  await teacher(`/scheduled-courses/${created.id}`, 'PUT', replacement)
  const after = await teacher('/schedule')
  assert.equal(after.sessions.length, 4)
  assert.equal(after.sessions[0].location, '旧教室')
  await teacher(`/course-sessions/${after.sessions[0].id}`, 'PATCH', single, 409)
  assert.equal((await db.all("SELECT * FROM audit_logs WHERE action LIKE 'schedule.%'")).length, 3)
})
