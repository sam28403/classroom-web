import { Router } from 'express'
import multer from 'multer'
import db from './db/db.js'
import { authenticate, roles, student, id, fail, now } from './http.js'
import { detectAvatar } from './compreface.js'
import { submitRequest } from './requests.js'

export const avatars = Router()
avatars.use(authenticate)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1, fieldSize: 16, parts: 2 } }).single('file')

avatars.post('/avatar-requests', roles('student'), upload, async (req, res) => {
  // A checkbox in the client is not authorization to process a photo.
  // Reject before calling CompreFace or writing any image to the database.
  if (req.body?.consent !== 'true') fail(400, '请明确同意照片用于人脸检测和头像审核', 'CONSENT_REQUIRED')
  const consentAt = now()
  await student(req)
  const file = req.file
  if (!file) fail(400, '请选择一张 JPEG 或 PNG 照片', 'INVALID_IMAGE')
  const png = file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const jpeg = file.buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
  if (!(png && file.mimetype === 'image/png') && !(jpeg && file.mimetype === 'image/jpeg')) {
    fail(400, '图片格式无效，请选择 JPEG 或 PNG', 'INVALID_IMAGE')
  }
  await detectAvatar(file)
  const result = await db.transaction(async () => {
    const user = await db.get('SELECT id,status FROM users WHERE id=?' + db.lock, [req.user.id])
    if (!user || user.status !== 'active') fail(403, '账号不可用')
    const image = await db.run('INSERT INTO avatar_images(user_id,mime_type,image_data) VALUES (?,?,?)', [user.id, file.mimetype, file.buffer])
    return submitRequest(req, 'avatar_change', user.id, { imageId: image.insertId, photoConsent: { version: 'avatar-v1', acceptedAt: consentAt } })
  })
  res.status(202).json(result)
})

avatars.get('/avatar-images/:id', async (req, res) => {
  const image = await db.get(`SELECT i.*,u.avatar FROM avatar_images i
    JOIN users u ON u.id=i.user_id WHERE i.id=? AND u.status='active'`, [id(req.params.id)])
  if (!image) fail(404, '图片不存在')
  if (req.user.role !== 'admin' && req.user.id !== image.user_id && image.avatar !== `/api/avatar-images/${image.id}`) {
    fail(403, '没有权限查看该图片', 'FORBIDDEN')
  }
  res.set('Content-Type', image.mime_type)
  res.set('Cache-Control', 'no-store')
  res.send(image.image_data)
})
