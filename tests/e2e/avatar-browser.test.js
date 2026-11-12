import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdir, readFile, access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { base, db, createUser } from '../helpers/account-api.js'
import { captchaDigest } from '../../server/captcha.js'

const real = process.env.npm_lifecycle_event === 'test:e2e:real' || process.env.AVATAR_E2E_REAL === 'true'
const fixtures = process.env.AVATAR_E2E_FIXTURES
if (real && (!process.env.COMPREFACE_URL || !process.env.COMPREFACE_DETECTION_API_KEY || !fixtures)) {
  throw new Error('真实 E2E 必须配置服务端 COMPREFACE_URL、COMPREFACE_DETECTION_API_KEY 和 AVATAR_E2E_FIXTURES；不允许退回模拟服务')
}
let mode = 'face', detectorCalls = 0, detectedImage
const face = { box: { probability: .99 }, pose: { yaw: 0, pitch: 0, roll: 0 } }
let detector
if (!real) {
  detector = createServer(async (req, res) => {
    detectorCalls++
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const url = new URL(req.url, 'http://localhost')
    assert.equal(url.pathname, '/api/v1/detection/detect')
    assert.equal(url.searchParams.get('face_plugins'), 'pose')
    assert.equal(url.searchParams.get('limit'), '0')
    assert.equal(req.headers['x-api-key'], 'browser-test-key')
    const form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': req.headers['content-type'] } }).formData()
    detectedImage = Buffer.from(await form.get('file').arrayBuffer())
    res.setHeader('Content-Type', 'application/json')
    res.statusCode = mode === 'unavailable' ? 503 : 200
    res.end(JSON.stringify({ result: mode === 'no-face' ? [] : mode === 'multiple' ? [face, face] : mode === 'side' ? [{ ...face, pose: { yaw: 35, pitch: 0, roll: 0 } }] : [face] }))
  }).listen(0, '127.0.0.1')
  await once(detector, 'listening')
  process.env.COMPREFACE_URL = `http://127.0.0.1:${detector.address().port}`
  process.env.COMPREFACE_DETECTION_API_KEY = 'browser-test-key'
}
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' })
const contexts = []
const origin = base.replace(/\/api$/, '')
await mkdir('test-results/avatar', { recursive: true })
after(async () => {
  await browser.close()
  if (detector) await new Promise(resolve => detector.close(resolve))
})
async function login(username, password = 'Password123', mobile = false) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } })
  contexts.push(context)
  const page = await context.newPage()
  await page.goto(origin + '/#/login')
  await expect(page.getByAltText('登录注册验证码')).toBeVisible()
  const session = (await context.cookies()).find(c => c.name === 'connect.sid')
  const sid = decodeURIComponent(session.value).slice(2).split('.')[0]
  await db.run('UPDATE captchas SET text=? WHERE session_id=?', [captchaDigest('ABCDE'), sid])
  await page.getByPlaceholder('输入用户名', { exact: true }).fill(username)
  await page.getByPlaceholder('请输入密码', { exact: true }).fill(password)
  await page.getByRole('textbox', { name: '验证码', exact: true }).fill('ABCDE')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(/dashboard/)
  return { page, context }
}
async function fixture(page, name = 'face.jpg') {
  if (real) return { name, mimeType: 'image/jpeg', buffer: await readFile(resolve(fixtures, name)) }
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600
    const c = canvas.getContext('2d'); c.fillStyle = '#cbdff4'; c.fillRect(0,0,800,600)
    c.fillStyle = '#224466'; c.fillRect(200,100,400,400)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  return { name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') }
}
async function selectAndCrop(page, file, screenshot = false) {
  await page.locator('input[type=file]').setInputFiles(file)
  const dialog = page.getByRole('dialog', { name: '裁剪头像' })
  await expect(dialog).toBeVisible()
  const zoom = dialog.getByRole('slider', { name: '缩放' })
  await zoom.focus(); await page.keyboard.press('ArrowRight')
  if (screenshot) await page.screenshot({ path: 'test-results/avatar/crop.png', fullPage: true })
  await dialog.getByRole('button', { name: '使用裁剪照片' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByAltText('裁剪后的待提交头像')).toBeVisible()
  await expect(page.getByRole('button', { name: '提交头像申请' })).toBeDisabled()
  await page.getByText('我同意使用该照片进行人脸检测和头像审核', { exact: true }).click()
  await expect(page.getByRole('checkbox')).toBeChecked()
}
async function submit(page, status) {
  const response = page.waitForResponse(r => r.url().endsWith('/api/avatar-requests') && r.request().method() === 'POST')
  await page.getByRole('button', { name: '提交头像申请' }).click()
  const r = await response
  assert.equal(r.status(), status, await r.text())
  return r.json()
}
async function review(page, user, decision) {
  await page.goto(origin + '/#/dashboard/requests')
  await page.getByRole('button', { name: '刷新申请' }).click()
  const row = page.getByRole('row').filter({ hasText: user }).filter({ hasText: '待审核' })
  await row.getByRole('button', { name: '查看详情' }).click()
  const photo = page.getByAltText('申请头像')
  await expect(photo).toBeVisible()
  await expect.poll(() => photo.evaluate(img => img.naturalWidth)).toBe(512)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '申请详情' })).not.toBeVisible()
  await row.getByRole('button', { name: decision, exact: true }).click()
  const prompt = page.getByRole('dialog', { name: decision === '批准' ? '批准申请' : '拒绝申请' })
  await prompt.getByRole('textbox').fill('浏览器测试核对结果')
  await prompt.getByRole('button', { name: /确定|OK|Confirm/i }).click()
  await expect(page.getByText('审核完成', { exact: true })).toBeVisible()
}

test(real ? '真实 CompreFace 浏览器端到端验收' : '浏览器流程测试（真实应用和数据库，CompreFace 使用 HTTP 测试替身）', { timeout: 180000 }, async () => {
  // Real acceptance uses your consented test set. Missing fixtures fail, never silently skip.
  if (real) for (const name of ['face.jpg','cat.jpg','dog.jpg','cartoon.jpg','landscape.jpg','side.jpg','multiple.jpg']) await access(resolve(fixtures, name))
  const userId = await createUser('browser_student', 'Password123', 'student')
  await createUser('browser_other', 'Password123', 'student')
  const student = await login('browser_student'), admin = await login('admin', process.env.ADMIN_PASSWORD), outsider = await login('browser_other', 'Password123', true)
  const page = student.page
  await page.goto(origin + '/#/dashboard/settings')
  await expect(page.locator('button').filter({ hasText: '选择照片' })).toBeVisible()
  await expect(page.locator('input[type=file]')).toBeHidden()
  const file = await fixture(page)
  // Cancel and reselect the same file. No request may leave the browser before consent.
  await page.locator('input[type=file]').setInputFiles(file)
  await page.getByRole('dialog', { name: '裁剪头像' }).getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('button', { name: '提交头像申请' })).toBeDisabled()
  await selectAndCrop(page, file, true)
  if (!real) assert.equal(detectorCalls, 0)
  const { requestId } = await submit(page, 202)
  assert.equal((await db.get('SELECT avatar FROM users WHERE id=?', [userId])).avatar, null)
  const row = await db.get('SELECT payload FROM change_requests WHERE id=?', [requestId])
  const imageId = JSON.parse(row.payload).imageId
  const stored = await db.get('SELECT image_data FROM avatar_images WHERE id=?', [imageId])
  // The reviewed image must be the exact bytes sent for detection.
  if (!real) assert.ok(stored.image_data.equals(detectedImage))
  const size = await page.evaluate(async bytes => {
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)]))
    const result = [image.width, image.height]; image.close(); return result
  }, [...stored.image_data])
  assert.deepEqual(size, [512,512])
  assert.equal((await outsider.context.request.get(base + '/avatar-images/' + imageId)).status(), 403)
  await review(admin.page, 'browser_student', '批准')
  assert.equal((await outsider.context.request.get(base + '/avatar-images/' + imageId)).status(), 200)
  await page.reload()
  const visibleAvatar = page.locator('.profile .el-avatar img')
  await expect(visibleAvatar).toHaveAttribute('src', '/api/avatar-images/' + imageId)
  await expect.poll(() => visibleAvatar.evaluate(img => img.naturalWidth)).toBe(512)
  await selectAndCrop(page, file)
  const replacement = await submit(page, 202)
  await review(admin.page, 'browser_student', '拒绝')
  assert.equal((await db.get('SELECT avatar FROM users WHERE id=?', [userId])).avatar, '/api/avatar-images/' + imageId)
  const rejected = JSON.parse((await db.get('SELECT payload FROM change_requests WHERE id=?', [replacement.requestId])).payload)
  assert.equal((await admin.context.request.get(base + '/avatar-images/' + rejected.imageId)).status(), 404)
  for (const name of real ? ['cat','dog','cartoon','landscape','side','multiple'] : ['no-face','side','multiple','unavailable']) {
    mode = name
    await selectAndCrop(page, await fixture(page, name + '.jpg'))
    await submit(page, name === 'unavailable' ? 503 : 422)
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM change_requests WHERE user_id=? AND status=\'pending\'', [userId])).n, 0)
  }
  mode = 'face'
  await selectAndCrop(page, file)
  await submit(page, 202)
  // UI request approval and deletion exercise real backend transactions.
  assert.equal((await admin.context.request.delete(base + '/users/' + userId, { headers: { Origin: origin } })).status(), 200)
  assert.equal((await outsider.context.request.get(base + '/avatar-images/' + imageId)).status(), 404)
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM avatar_images WHERE user_id=?', [userId])).n, 0)
  assert.equal((await student.context.request.get(base + '/auth/me')).status(), 401)
  await outsider.page.goto(origin + '/#/dashboard/settings')
  await selectAndCrop(outsider.page, await fixture(outsider.page), false)
  await outsider.page.screenshot({ path: 'test-results/avatar/mobile.png', fullPage: true })
})
