import { Router } from 'express'
import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app'
import { getMessaging } from 'firebase-admin/messaging'
import db from './db/db.js'
import { authenticate, roles, string, fail, now } from './http.js'

export const push = Router()
push.post('/android/push-token', authenticate, roles('student'), async (req, res) => {
  const token = string(req.body.token, '设备令牌', 512)
  const session = await db.get("SELECT sid FROM sessions WHERE sid=? AND user_id=? AND client_type='android' AND expires>?", [req.sessionID, req.user.id, Date.now()])
  if (!session) fail(403, '请在安卓客户端登录', 'ANDROID_REQUIRED')
  await db.transaction(async () => {
    await db.run('DELETE FROM push_devices WHERE token=? OR session_id=?', [token, req.sessionID])
    await db.run('INSERT INTO push_devices(user_id,session_id,token,updated_at) VALUES (?,?,?,?)', [req.user.id, req.sessionID, token, now()])
  })
  res.json({ success: true })
})

// Called inside the task creation transaction. A retry cannot create duplicate jobs.
export async function queueAttendancePush(taskId, classId) {
  const devices = await db.all(`SELECT d.user_id,d.session_id FROM push_devices d
    JOIN sessions se ON se.sid=d.session_id AND se.user_id=d.user_id AND se.client_type='android' AND se.expires>?
    JOIN users u ON u.id=d.user_id AND u.status='active'
    JOIN students s ON s.user_id=u.id JOIN enrollments e ON e.student_id=s.id
    WHERE e.teaching_class_id=? AND e.status='active'`, [Date.now(), classId])
  for (const device of devices) await db.run('INSERT INTO push_deliveries(task_id,user_id,session_id,available_at) VALUES (?,?,?,?)', [taskId, device.user_id, device.session_id, now()])
}

let working = false
export async function deliverAttendancePush() {
  if (working || !process.env.FIREBASE_PROJECT_ID) return
  working = true
  try {
    const jobs = await db.all("SELECT * FROM push_deliveries WHERE status IN ('pending','sending') AND available_at<=? ORDER BY id LIMIT 50", [now()])
    for (const job of jobs) {
      const lease = new Date(Date.now() + 60000).toISOString()
      const target = await db.transaction(async () => {
        const claimed = await db.run("UPDATE push_deliveries SET status='sending',available_at=? WHERE id=? AND status=? AND available_at=?", [lease, job.id, job.status, job.available_at])
        if (!claimed.affectedRows) return null
        // Resolve the session from the claimed row, which may have rotated
        // since the worker listed the due jobs.
        const device = await db.get(`SELECT d.token,t.end_at FROM push_deliveries p
        JOIN push_devices d ON d.session_id=p.session_id AND d.user_id=p.user_id
        JOIN sessions se ON se.sid=d.session_id AND se.user_id=d.user_id AND se.client_type='android' AND se.expires>?
        JOIN users u ON u.id=d.user_id AND u.status='active'
        JOIN students s ON s.user_id=u.id JOIN attendance_tasks t ON t.id=p.task_id AND t.status='active' AND t.end_at>?
        JOIN teaching_classes c ON c.id=t.teaching_class_id AND c.status='active'
        JOIN enrollments e ON e.teaching_class_id=c.id AND e.student_id=s.id AND e.status='active'
        WHERE p.id=?`, [Date.now(), now(), job.id])
        if (!device) await db.run("UPDATE push_deliveries SET status='cancelled' WHERE id=?", [job.id])
        return device
      })
      if (!target) continue
      try {
        const app = getApps()[0] || initializeApp({ credential: applicationDefault(), projectId: process.env.FIREBASE_PROJECT_ID })
        await getMessaging(app).send({ token: target.token,
          notification: { title: '考勤通知', body: '有新的考勤任务，请打开 Classroom 查看。' },
          data: { type: 'attendance', taskId: String(job.task_id) },
          android: { priority: 'high', ttl: Math.max(0, Date.parse(target.end_at) - Date.now()), notification: { channelId: 'attendance', tag: `attendance-${job.task_id}` } },
        })
        await db.run("UPDATE push_deliveries SET status='sent' WHERE id=?", [job.id])
      } catch (error) {
        if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(error.code)) {
          await db.run('DELETE FROM push_devices WHERE user_id=? AND token=?', [job.user_id, target.token])
          await db.run("UPDATE push_deliveries SET status='cancelled' WHERE id=?", [job.id])
        } else {
          const delay = Math.min(300000, 15000 * 2 ** Math.min(job.attempts, 4))
          await db.run("UPDATE push_deliveries SET status='pending',attempts=attempts+1,available_at=? WHERE id=?", [new Date(Date.now() + delay).toISOString(), job.id])
          console.error('Attendance push failed:', error.code || error.name)
        }
      }
    }
  } catch (error) { console.error('Attendance push worker failed:', error.code || error.name) }
  finally { working = false }
}
export function startPushWorker() {
  if (!process.env.FIREBASE_PROJECT_ID) return
  const timer = setInterval(deliverAttendancePush, 5000)
  timer.unref()
  void deliverAttendancePush()
}
