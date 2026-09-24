import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import bcrypt from 'bcryptjs'

test('upgrades original SQLite schema without losing users or legacy password hashes', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'classroom-migration-'))
  process.env.DATABASE_PATH = join(folder, 'legacy.db')
  delete process.env.DB_DRIVER
  const old = new Database(process.env.DATABASE_PATH)
  old.exec("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'student', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)")
  const hash = bcrypt.hashSync('ExistingPassword123', 4)
  old.prepare('INSERT INTO users(username,password,role) VALUES (?,?,?)').run('old_student', hash, 'student')
  old.prepare('INSERT INTO users(username,password,role) VALUES (?,?,?)').run('old_teacher', hash, 'teacher')
  old.close()
  const { default: db } = await import('../server/db/db.js')
  try {
    assert.equal((await db.get('SELECT password_hash FROM users WHERE id=1')).password_hash, hash)
    assert.equal((await db.get('SELECT student_no FROM students WHERE user_id=1')).student_no, 'old_student')
    assert.equal((await db.get('SELECT teacher_no FROM teachers WHERE user_id=2')).teacher_no, 'old_teacher')
    assert.equal((await db.get('SELECT status FROM users WHERE id=1')).status, 'active')
    assert.equal(db.legacyPassword, true)
    process.env.ADMIN_PASSWORD = 'Migration-admin123'
    const { createUser } = await import('../server/auth.js')
    const created = await createUser('new_student', 'NewPassword123', 'student')
    const user = await db.get('SELECT password,password_hash FROM users WHERE id=?', [created])
    assert.equal(user.password, user.password_hash)
    assert.ok(await bcrypt.compare('NewPassword123', user.password_hash))
    await assert.rejects(db.run("INSERT INTO enrollments(teaching_class_id,student_id) VALUES (12345,1)"), { code: 'SQLITE_CONSTRAINT_FOREIGNKEY' })
  } finally { await db.close(); rmSync(folder, { recursive: true }) }
})
