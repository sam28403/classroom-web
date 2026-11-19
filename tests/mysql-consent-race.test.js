import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createConnection } from 'mysql2/promise'
import { captchaDigest } from '../server/captcha.js'

test('MySQL check-in observes consent withdrawn after its transaction snapshot', { skip: !process.env.TEST_MYSQL_URL, timeout: 30000 }, async () => {
  const url = new URL(process.env.TEST_MYSQL_URL)
  const root = await createConnection(process.env.TEST_MYSQL_URL)
  const database = `classroom_race_${randomUUID().replaceAll('-', '')}`
  await root.query(`CREATE DATABASE \`${database}\``)
  Object.assign(process.env, {
    DB_DRIVER: 'mysql', DB_HOST: url.hostname, DB_PORT: url.port || '3306', DB_USER: decodeURIComponent(url.username),
    DB_PASSWORD: decodeURIComponent(url.password), DB_NAME: database,
    ADMIN_PASSWORD: 'MysqlTest123', SESSION_SECRET: 'mysql-test-secret-at-least-32-characters',
    COMPREFACE_URL: 'http://mysql-face.test', COMPREFACE_API_KEY: 'test',
  })
  const originalFetch = globalThis.fetch
  let db, server, locker, subject, recognitionFinished = false, reachedLock
  const atStudentLock = new Promise(resolve => { reachedLock = resolve })
  try {
    const { default: app } = await import('../server/app.js')
    ;({ default: db } = await import('../server/db/db.js'))
    const { createUser } = await import('../server/auth.js')
    const uid = await createUser('mysql_student', 'Password123', 'student')
    const teacher = await createUser('mysql_teacher', 'Password123', 'teacher')
    const sid = (await db.get('SELECT id FROM students WHERE user_id=?', [uid])).id
    const tid = (await db.get('SELECT id FROM teachers WHERE user_id=?', [teacher])).id
    const image = await db.run('INSERT INTO avatar_images(user_id,mime_type,image_data) VALUES (?,?,?)', [uid, 'image/jpeg', Buffer.from([255, 216, 255, 1])])
    await db.run('UPDATE users SET avatar=? WHERE id=?', [`/api/avatar-images/${image.insertId}`, uid])
    await db.run("INSERT INTO consent_records(student_id,policy_version,consent_type,decision,decided_at) VALUES (?,'face-v1','face','agree',?)", [sid, new Date().toISOString()])
    const course = await db.run("INSERT INTO courses(course_code,course_name) VALUES ('RACE','并发测试')")
    const classroom = await db.run("INSERT INTO teaching_classes(course_id,teacher_id,term,name) VALUES (?,?,'2026','测试班')", [course.insertId, tid])
    await db.run('INSERT INTO enrollments(teaching_class_id,student_id) VALUES (?,?)', [classroom.insertId, sid])
    const task = await db.run('INSERT INTO attendance_tasks(teaching_class_id,start_at,late_at,end_at) VALUES (?,?,?,?)', [classroom.insertId,
      new Date(Date.now() - 1000).toISOString(), new Date(Date.now() + 30000).toISOString(), new Date(Date.now() + 60000).toISOString()])
    locker = await createConnection({ host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database })
    globalThis.fetch = async (address, options = {}) => {
      if (!String(address).startsWith(process.env.COMPREFACE_URL)) return originalFetch(address, options)
      const parsed = new URL(address)
      if (options.method === 'DELETE') return Response.json({})
      if (options.method === 'GET') return Response.json({ faces: subject ? [{ subject, image_id: 'image' }] : [] })
      if (parsed.pathname.endsWith('/faces')) { subject = parsed.searchParams.get('subject'); return Response.json({ subject, image_id: 'image' }) }
      await locker.beginTransaction()
      await locker.execute('SELECT id FROM students WHERE id=? FOR UPDATE', [sid])
      recognitionFinished = true
      return Response.json({ result: [{ subjects: [{ subject, similarity: 0.99 }] }] })
    }
    const get = db.get
    db.get = async (sql, params) => {
      if (recognitionFinished && sql === 'SELECT id FROM students WHERE id=? FOR UPDATE') reachedLock()
      return get(sql, params)
    }
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
    const base = `http://127.0.0.1:${server.address().port}/api`
    const captcha = await originalFetch(base + '/captcha')
    let cookie = captcha.headers.getSetCookie()[0].split(';')[0]
    const sidCookie = decodeURIComponent(cookie.split('=')[1]).slice(2).split('.')[0]
    await db.run('UPDATE captchas SET text=? WHERE session_id=?', [captchaDigest('ABCDE'), sidCookie])
    const login = await originalFetch(base + '/android/auth/login', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'mysql_student', password: 'Password123', code: 'ABCDE' }) })
    assert.equal(login.status, 200)
    cookie = login.headers.getSetCookie()[0].split(';')[0]
    const form = new FormData(); form.append('file', new Blob([Buffer.from([255, 216, 255, 2])], { type: 'image/jpeg' }), 'live.jpg')
    const pending = originalFetch(`${base}/attendance-tasks/${task.insertId}/check-in`, { method: 'POST', headers: { Cookie: cookie }, body: form })
    await Promise.race([atStudentLock, new Promise((_, reject) => setTimeout(() => reject(new Error('check-in did not reach the student lock')), 10000))])
    await locker.execute("INSERT INTO consent_records(student_id,policy_version,consent_type,decision,decided_at) VALUES (?,'face-v1','face','withdraw',?)", [sid, new Date().toISOString()])
    await locker.execute("UPDATE face_profiles SET status='pending_delete' WHERE student_id=?", [sid])
    await locker.commit()
    const response = await pending
    assert.equal(response.status, 409, JSON.stringify(await response.json()))
    assert.equal(await db.get('SELECT id FROM attendance_records WHERE task_id=?', [task.insertId]), undefined)
  } finally {
    globalThis.fetch = originalFetch
    if (locker) { await locker.rollback().catch(() => {}); await locker.end() }
    if (server) await new Promise(resolve => server.close(resolve))
    if (db) await db.close()
    await root.query(`DROP DATABASE \`${database}\``)
    await root.end()
  }
})
