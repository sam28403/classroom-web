import { Router } from 'express'
import bcrypt from 'bcryptjs'
import svgCaptcha from 'svg-captcha'
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import db from './db/db.js'
import { authenticate, audit, fail, string, roles, choice, id } from './http.js'

const scrypt = promisify(scryptCallback)
export const cookieOptions = { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production' }
const publicUser = ({ id, username, role, avatar }) => ({ id, username, role, avatar })
async function revokeUserSessions(userId) {
  for (const row of await db.all('SELECT sid,data FROM sessions')) {
    if (JSON.parse(row.data).userId === userId) {
      await db.run('DELETE FROM sessions WHERE sid=?', [row.sid])
      if (!await db.get('SELECT sid FROM revoked_sessions WHERE sid=?', [row.sid])) {
        await db.run('INSERT INTO revoked_sessions(sid,expires) VALUES (?,?)', [row.sid, Date.now() + 604800000])
      }
    }
  }
}
function validatePassword(password, min = 8) {
  if (typeof password !== 'string' || password.length < min || Buffer.byteLength(password) > 72 || !/\d/.test(password) || !/[^0-9]/.test(password)) {
    fail(400, `密码须至少 ${min} 位，最多 72 字节，并包含数字和非数字字符`)
  }
}
export async function createUser(username, password, role, status = 'active') {
  const hash = await bcrypt.hash(password, 12)
  return db.transaction(async () => {
    const result = db.legacyPassword
      ? await db.run('INSERT INTO users(username,password,password_hash,role,status) VALUES (?,?,?,?,?)', [username, hash, hash, role, status])
      : await db.run('INSERT INTO users(username,password_hash,role,status) VALUES (?,?,?,?)', [username, hash, role, status])
    if (role === 'student') await db.run('INSERT INTO students(user_id,student_no,name) VALUES (?,?,?)', [result.insertId, username, username])
    if (role === 'teacher') await db.run('INSERT INTO teachers(user_id,teacher_no,name) VALUES (?,?,?)', [result.insertId, username, username])
    return result.insertId
  })
}
if (!await db.get("SELECT id FROM users WHERE role='admin' LIMIT 1")) {
  const password = process.env.ADMIN_PASSWORD || `${randomBytes(24).toString('base64url')}1a`
  validatePassword(password, 12)
  if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_PASSWORD) throw new Error('首次部署须设置 ADMIN_PASSWORD')
  await createUser('admin', password, 'admin')
  if (!process.env.ADMIN_PASSWORD) {
    mkdirSync(dirname(db.name), { recursive: true })
    writeFileSync(resolve(dirname(db.name), 'admin-credentials.txt'), `Username: admin\nPassword: ${password}\n`, { mode: 0o600 })
    console.log('初始管理员凭据已保存至数据库目录的 admin-credentials.txt')
  }
}

export const auth = Router()
const attempts = new Map()
auth.use(['/captcha', '/auth/login', '/auth/register', '/user/login', '/user/register'], (req, _res, next) => {
  const time = Date.now()
  for (const [key, value] of attempts) if (value.expires < time) attempts.delete(key)
  const key = req.ip
  const attempt = attempts.get(key) || { count: 0, expires: time + 60_000 }
  attempts.set(key, attempt)
  if (++attempt.count > 60) fail(429, '操作频繁，请一分钟后重试')
  next()
})
auth.get('/captcha', async (req, res) => {
  const captcha = svgCaptcha.create({ size: 5, noise: 3, color: true, background: '#eef2f6', ignoreChars: '0oO1ilI' })
  req.session.captchaExpires = Date.now() + 300_000
  await db.transaction(async () => {
    await db.run('DELETE FROM sessions WHERE expires<?', [Date.now()])
    await db.run('DELETE FROM revoked_sessions WHERE expires<?', [Date.now()])
    await db.run('DELETE FROM captchas WHERE expires < ? OR session_id=?', [Date.now(), req.sessionID])
    await db.run('INSERT INTO captchas(session_id,text,expires) VALUES (?,?,?)', [req.sessionID, captcha.text.toUpperCase(), req.session.captchaExpires])
  })
  await promisify(req.session.save).call(req.session)
  res.json({ image: `data:image/svg+xml;base64,${Buffer.from(captcha.data).toString('base64')}` })
})
auth.post(['/auth/register', '/auth/login', '/user/register', '/user/login'], async (req, res) => {
  const captcha = await db.transaction(async () => {
    const row = await db.get('SELECT text,expires FROM captchas WHERE session_id=?' + db.lock, [req.sessionID])
    await db.run('DELETE FROM captchas WHERE session_id=?', [req.sessionID])
    return row
  })
  const { password, code, role } = req.body
  const expires = req.session.captchaExpires
  delete req.session.captchaExpires
  if (!captcha || captcha.expires < Date.now() || !(expires >= Date.now()) || typeof code !== 'string' || captcha.text !== code.trim().toUpperCase()) {
    fail(400, '验证码错误或已过期，请刷新后重试', 'CAPTCHA_INVALID')
  }
  const username = string(req.body.username, '账号', 24)
  if (!/^[\p{L}\p{N}_-]{3,24}$/u.test(username)) fail(400, '账号须为 3–24 位文字、数字、下划线或短横线')
  if (typeof password !== 'string' || Buffer.byteLength(password) > 72) fail(400, '密码长度不合法')
  if (req.path.endsWith('register')) {
    validatePassword(password)
    choice(role, ['teacher', 'student'], '身份')
    // Teachers require approval; public registration must not grant staff privileges.
    const userId = await createUser(username, password, role, role === 'teacher' ? 'pending' : 'active')
    await audit(req, 'register', 'users', userId)
    return res.status(201).json({ success: true, requiresApproval: role === 'teacher' })
  }
  const user = await db.get('SELECT * FROM users WHERE username=?', [username])
  let valid = false
  if (user?.password_hash.startsWith('legacy-scrypt$')) {
    const [, salt, oldHash] = user.password_hash.split('$')
    const actual = await scrypt(password, salt, 64)
    const expected = Buffer.from(oldHash, 'hex')
    valid = actual.length === expected.length && timingSafeEqual(actual, expected)
    if (valid) {
      const hash = await bcrypt.hash(password, 12)
      await db.run('UPDATE users SET password_hash=? WHERE id=?', [hash, user.id])
      if (db.legacyPassword) await db.run('UPDATE users SET password=? WHERE id=?', [hash, user.id])
    }
  } else if (user) valid = await bcrypt.compare(password, user.password_hash)
  if (!valid || !user) fail(401, '账号或密码错误')
  if (user.status !== 'active') fail(403, user.status === 'pending' ? '教师账号等待管理员审核' : '账号已停用')
  await promisify(req.session.regenerate).call(req.session)
  req.session.userId = user.id
  await promisify(req.session.save).call(req.session)
  req.user = user
  await audit(req, 'login', 'users', user.id)
  res.json({ success: true, user: publicUser(user) })
})
auth.get(['/auth/me', '/user/me'], authenticate, (req, res) => res.json({ user: publicUser(req.user) }))
auth.post(['/auth/logout', '/user/logout'], async (req, res) => {
  if (req.session.userId) req.user = await db.get('SELECT id FROM users WHERE id=?', [req.session.userId])
  await promisify(req.session.destroy).call(req.session)
  res.clearCookie('connect.sid', cookieOptions)
  await audit(req, 'logout', 'users', req.user?.id)
  res.json({ success: true })
})
auth.post('/auth/refresh', authenticate, async (req, res) => {
  await promisify(req.session.regenerate).call(req.session)
  req.session.userId = req.user.id
  await promisify(req.session.save).call(req.session)
  res.json({ success: true, user: publicUser(req.user) })
})
auth.patch('/auth/password', authenticate, async (req, res) => {
  validatePassword(req.body.password)
  const row = await db.get('SELECT password_hash FROM users WHERE id=?', [req.user.id])
  if (typeof req.body.currentPassword !== 'string' || !await bcrypt.compare(req.body.currentPassword, row.password_hash)) fail(400, '原密码错误')
  const hash = await bcrypt.hash(req.body.password, 12)
  await db.transaction(async () => {
    await db.run('UPDATE users SET password_hash=? WHERE id=?', [hash, req.user.id])
    if (db.legacyPassword) await db.run('UPDATE users SET password=? WHERE id=?', [hash, req.user.id])
    await revokeUserSessions(req.user.id)
    await audit(req, 'password.change', 'users', req.user.id)
  })
  await promisify(req.session.destroy).call(req.session)
  res.clearCookie('connect.sid', cookieOptions).json({ success: true })
})
auth.get('/users', authenticate, roles('admin'), async (_req, res) => {
  res.json({ items: await db.all('SELECT id,username,role,status,created_at FROM users ORDER BY id') })
})
auth.patch('/users/:id', authenticate, roles('admin'), async (req, res) => {
  const userId = id(req.params.id)
  const status = choice(req.body.status, ['active', 'disabled'])
  const target = await db.get('SELECT id,role FROM users WHERE id=?', [userId])
  if (!target) fail(404, '账号不存在')
  if (target.role === 'admin') fail(403, '此接口不能停用管理员')
  await db.transaction(async () => {
    await db.run('UPDATE users SET status=? WHERE id=?', [status, userId])
    if (status === 'disabled') await revokeUserSessions(userId)
    await audit(req, 'user.status', 'users', userId)
  })
  res.json({ success: true })
})
