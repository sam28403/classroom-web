import session from 'express-session'
import db from './db/db.js'

export const sessionAge = 7 * 24 * 60 * 60 * 1000
export default class DatabaseSessionStore extends session.Store {
  get(sid, callback) {
    db.get('SELECT data FROM sessions WHERE sid=? AND expires>?', [sid, Date.now()])
      .then((row) => callback(null, row ? JSON.parse(row.data) : null), callback)
  }
  set(sid, value, callback = () => {}) {
    db.transaction(async () => {
      if (await db.get('SELECT sid FROM revoked_sessions WHERE sid=?' + db.lock, [sid])) return
      const expires = new Date(value.cookie.expires || Date.now() + sessionAge).getTime()
      await db.run('DELETE FROM sessions WHERE sid=?', [sid])
      await db.run('INSERT INTO sessions(sid,data,expires) VALUES (?,?,?)', [sid, JSON.stringify(value), expires])
    }).then(() => callback(), callback)
  }
  touch(sid, value, callback = () => {}) {
    db.run('UPDATE sessions SET expires=? WHERE sid=?', [new Date(value.cookie.expires).getTime(), sid]).then(() => callback(), callback)
  }
  destroy(sid, callback = () => {}) {
    db.transaction(async () => {
      await db.run('DELETE FROM sessions WHERE sid=?', [sid])
      if (!await db.get('SELECT sid FROM revoked_sessions WHERE sid=?', [sid])) {
        await db.run('INSERT INTO revoked_sessions(sid,expires) VALUES (?,?)', [sid, Date.now() + sessionAge])
      }
      await db.run('DELETE FROM captchas WHERE session_id=?', [sid])
    }).then(() => callback(), callback)
  }
}
