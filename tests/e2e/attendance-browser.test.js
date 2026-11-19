import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { base, db, client, createUser } from '../helpers/account-api.js'

let browser
after(async () => { await browser?.close() })
test('teacher manages attendance and downloads reports, and admin downloads finalized HTML', { timeout: 60000 }, async () => {
  await createUser('browser_att_teacher', 'Password123', 'teacher')
  await createUser('browser_att_student1', 'Password123', 'student')
  await createUser('browser_att_student2', 'Password123', 'student')
  const admin = client(), teacher = client()
  await admin.login('admin', process.env.ADMIN_PASSWORD); await teacher.login('browser_att_teacher')
  const tid = (await db.get('SELECT id FROM teachers WHERE user_id=(SELECT id FROM users WHERE username=?)', ['browser_att_teacher'])).id
  const students = await db.all('SELECT id FROM students WHERE user_id IN (SELECT id FROM users WHERE username IN (?,?)) ORDER BY id', ['browser_att_student1','browser_att_student2'])
  const course = await admin.request('/courses', 'POST', { course_code: 'BROWSERFACE', course_name: '人脸签到联调课程' }, 201)
  const cls = await admin.request('/teaching-classes', 'POST', { course_id: course.id, teacher_id: tid, term: '2026秋', name: '软件工程班' }, 201)
  for (const s of students) await teacher.request(`/teaching-classes/${cls.id}/enrollments`, 'POST', { student_id: s.id }, 201)
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  const origin = base.replace(/\/api$/, '')
  await context.addCookies([{ name: 'connect.sid', value: teacher.cookie.slice('connect.sid='.length), url: origin }])
  const page = await context.newPage(); page.setDefaultTimeout(8000)
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  const student = client()
  await student.login('browser_att_student1')
  const studentId = (await db.get('SELECT user_id FROM students WHERE id=?', [students[0].id])).user_id
  for (let i = 1; i <= 3; i++) {
    await db.run('INSERT INTO notifications(user_id,message,created_at) VALUES (?,?,?)', [studentId, `已有课程通知 ${i}`, new Date().toISOString()])
  }
  const studentContext = await browser.newContext()
  await studentContext.addCookies([{ name: 'connect.sid', value: student.cookie.slice('connect.sid='.length), url: origin }])
  const studentPage = await studentContext.newPage()
  await studentPage.goto(origin + '/#/dashboard')
  await expect(studentPage.getByText(/^已有课程通知 [1-3]$/)).toHaveCount(3)
  await page.goto(origin + '/#/dashboard')
  await page.getByRole('button', { name: '发起人脸考勤', exact: true }).click()
  await page.getByRole('button', { name: '开始考勤', exact: true }).click()
  await expect(page.getByText('考勤已开始', { exact: true })).toBeVisible()
  await expect(studentPage.getByText('考勤通知', { exact: true })).toBeVisible({ timeout: 10000 })
  await expect(studentPage.getByText(/已发起人脸考勤.*截止时间/)).toBeVisible()
  const notices = (await student.request('/notifications')).items
  assert.equal(notices.filter(item => item.message.startsWith('已有课程通知')).length, 3)
  await studentContext.close()
  await page.goto(origin + '/#/dashboard/attendance')
  await expect(page.getByRole('button', { name: '导出 HTML', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '记录 / 复核', exact: true }).click()
  await expect(page.getByRole('cell', { name: '未签到', exact: true })).toHaveCount(2)
  await expect(page.getByText(/未签到不代表最终缺勤/)).toHaveCount(0)
  const task = (await teacher.request('/attendance-tasks')).items[0]
  await teacher.request(`/attendance-tasks/${task.id}/manual`, 'POST', { student_id: students[0].id, status: 'present', reason: '浏览器测试模拟已签到记录' }, 201)
  // No user refresh: exercise the polling path.
  await expect(page.getByRole('cell', { name: '未签到', exact: true })).toHaveCount(1, { timeout: 10000 })
  await expect(page.getByRole('cell', { name: '正常', exact: true })).toHaveCount(1)
  await page.getByRole('textbox', { name: '搜索学生' }).fill('browser_att_student2')
  await expect(page.getByRole('cell', { name: 'browser_att_student1', exact: true })).toHaveCount(0)
  await expect(page.getByRole('cell', { name: 'browser_att_student2', exact: true }).first()).toBeVisible()
  await page.getByRole('textbox', { name: '搜索学生' }).fill('')
  await page.locator('.record-filters .el-select__wrapper').click()
  await page.getByRole('option', { name: '未签到', exact: true }).click()
  await expect(page.getByRole('cell', { name: '正常', exact: true })).toHaveCount(0)
  await page.locator('.record-filters .el-select__wrapper').click()
  await page.getByRole('option', { name: '正常', exact: true }).click()
  await expect(page.getByRole('cell', { name: '正常', exact: true })).toHaveCount(1)
  await page.locator('.record-filters .el-select').hover()
  await page.locator('.record-filters .el-select .el-select__clear').click()
  await mkdir('test-results/attendance', { recursive: true })
  await page.screenshot({ path: 'test-results/attendance/teacher-roster.png', fullPage: true })
  await page.locator('.el-dialog__headerbtn').first().click()
  await page.getByRole('button', { name: '结束', exact: true }).click()
  await page.getByRole('button', { name: /确定|OK|Confirm/i }).click()
  await page.getByRole('button', { name: '记录 / 复核', exact: true }).click()
  await expect(page.getByRole('cell', { name: '缺勤', exact: true })).toHaveCount(1)
  await expect(page.getByRole('cell', { name: '未签到', exact: true })).toHaveCount(0)
  await page.getByRole('dialog', { name: '考勤记录与复核' }).locator('.el-dialog__headerbtn').click()
  async function downloadReport(attendancePage) {
    const [download] = await Promise.all([
      attendancePage.waitForEvent('download'),
      attendancePage.getByRole('button', { name: '导出 HTML', exact: true }).click(),
    ])
    assert.equal(download.suggestedFilename(), `attendance-${task.id}.html`)
    return readFile(await download.path(), 'utf8')
  }
  const teacherReport = await downloadReport(page)
  const adminContext = await browser.newContext()
  await adminContext.addCookies([{ name: 'connect.sid', value: admin.cookie.slice('connect.sid='.length), url: origin }])
  const adminPage = await adminContext.newPage()
  await adminPage.goto(origin + '/#/dashboard')
  await adminPage.getByRole('menuitem', { name: '考勤记录' }).click()
  await expect(adminPage.getByRole('heading', { name: '已结束考勤' })).toBeVisible()
  assert.equal(await downloadReport(adminPage), teacherReport)
  await adminPage.getByRole('button', { name: '查看记录' }).click()
  await expect(adminPage.getByRole('cell', { name: '缺勤', exact: true })).toHaveCount(1)
  await expect(adminPage.getByRole('button', { name: '人工登记 / 请假' })).toHaveCount(0)
  const reportPage = await adminContext.newPage()
  await reportPage.setContent(teacherReport)
  await expect(reportPage.getByRole('heading', { name: '学生考勤报告' })).toBeVisible()
  await expect(reportPage.getByRole('row').filter({ hasText: 'browser_att_student1' }).getByRole('cell', { name: '正常' })).toBeVisible()
  await expect(reportPage.getByRole('row').filter({ hasText: 'browser_att_student2' }).getByRole('cell', { name: '缺勤' })).toBeVisible()
  await expect(adminPage.getByRole('button', { name: '导出本班考勤 CSV' })).toHaveCount(0)
  const secondTask = await teacher.request('/attendance-tasks', 'POST', {
    teaching_class_id: cls.id, start_at: new Date(Date.now() - 1000).toISOString(),
    late_at: new Date(Date.now() + 300000).toISOString(), end_at: new Date(Date.now() + 600000).toISOString(),
  }, 201)
  await teacher.request(`/attendance-tasks/${secondTask.id}/manual`, 'POST', {
    student_id: students[0].id, status: 'late', reason: '验证 CSV 记录覆盖多次任务',
  }, 201)
  await page.getByRole('button', { name: '记录 / 复核', exact: true }).click()
  const csvPath = `**/api/reports/teaching-classes/${cls.id}?format=csv`
  let releaseFailure
  const gate = new Promise(resolve => { releaseFailure = resolve })
  await page.route(csvPath, async route => {
    await gate
    await route.fulfill({ status: 503, json: { message: '暂时无法下载' } })
  }, { times: 1 })
  const csvButton = page.getByRole('button', { name: '导出本班考勤 CSV', exact: true })
  await csvButton.click()
  try {
    await expect(page.getByRole('button', { name: '正在导出 CSV', exact: true })).toBeDisabled()
  } finally { releaseFailure() }
  await expect(page.getByText('导出 CSV 失败：暂时无法下载')).toBeVisible()
  await expect(csvButton).toBeEnabled()
  const [csvDownload] = await Promise.all([page.waitForEvent('download'), csvButton.click()])
  assert.equal(csvDownload.suggestedFilename(), `attendance-${cls.id}.csv`)
  const csv = await readFile(await csvDownload.path(), 'utf8')
  assert.ok(csv.includes(`"${task.id}","browser_att_student1","browser_att_student1","present"`))
  assert.ok(csv.includes(`"${secondTask.id}","browser_att_student1","browser_att_student1","late"`))
  if (errors.length) throw new Error(errors.join('\n'))
  await browser.close()
})

test('slow roster polling stays single-flight and stale manual dialogs cannot cross tasks', { timeout: 90000 }, async () => {
  const teacherName = 'browser_race_teacher'
  await createUser(teacherName, 'Password123', 'teacher')
  const uid = await createUser('browser_race_student', 'Password123', 'student')
  const teacher = client(), admin = client()
  await teacher.login(teacherName); await admin.login('admin', process.env.ADMIN_PASSWORD)
  const tid = (await db.get('SELECT id FROM teachers WHERE user_id=(SELECT id FROM users WHERE username=?)', [teacherName])).id
  const sid = (await db.get('SELECT id FROM students WHERE user_id=?', [uid])).id
  const course = await admin.request('/courses', 'POST', { course_code: 'POLL_RACE', course_name: '慢请求测试课程' }, 201)
  const cls = await admin.request('/teaching-classes', 'POST', { course_id: course.id, teacher_id: tid, term: '2026秋', name: '并发测试班' }, 201)
  await teacher.request(`/teaching-classes/${cls.id}/enrollments`, 'POST', { student_id: sid }, 201)
  const cls2 = await admin.request('/teaching-classes', 'POST', { course_id: course.id, teacher_id: tid, term: '2026秋', name: '另一个测试班' }, 201)
  await teacher.request(`/teaching-classes/${cls2.id}/enrollments`, 'POST', { student_id: sid }, 201)
  for (const classroom of [cls, cls2]) await teacher.request('/attendance-tasks', 'POST', {
    teaching_class_id: classroom.id, start_at: new Date(Date.now() - 1000).toISOString(),
    late_at: new Date(Date.now() + 300000).toISOString(), end_at: new Date(Date.now() + 600000).toISOString(),
  }, 201)
  const tasks = (await teacher.request('/attendance-tasks')).items
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  const origin = base.replace(/\/api$/, '')
  await context.addCookies([{ name: 'connect.sid', value: teacher.cookie.slice('connect.sid='.length), url: origin }])
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  await page.goto(origin + '/#/dashboard/attendance')
  await page.getByRole('button', { name: '记录 / 复核', exact: true }).nth(0).click()
  await expect(page.getByRole('cell', { name: '未签到', exact: true })).toHaveCount(1)

  let releaseMembers, membersStarted
  const membersGate = new Promise(resolve => { releaseMembers = resolve })
  const started = new Promise(resolve => { membersStarted = resolve })
  await page.route('**/api/teaching-classes/*/enrollments', async route => {
    membersStarted()
    await membersGate
    await route.continue()
  })
  await page.getByRole('button', { name: '人工登记 / 请假', exact: true }).click()
  await started
  await page.locator('.el-dialog__headerbtn').first().click()
  await page.getByRole('button', { name: '记录 / 复核', exact: true }).nth(1).click()
  await expect(page.getByRole('heading', { name: `任务 #${tasks[1].id}，考勤记录`, exact: true })).toBeVisible()
  const memberResponse = page.waitForResponse(response => response.url().endsWith('/enrollments'))
  releaseMembers()
  await memberResponse
  await page.waitForTimeout(250)
  await expect(page.getByRole('dialog', { name: '人工登记 / 请假' })).toHaveCount(0)
  await page.unroute('**/api/teaching-classes/*/enrollments')

  let active = 0, maxActive = 0
  await page.route('**/api/attendance-tasks/*/records', async route => {
    active++; maxActive = Math.max(maxActive, active)
    try {
      await new Promise(resolve => setTimeout(resolve, 6500))
      await route.continue()
    } finally { active-- }
  })
  await teacher.request(`/attendance-tasks/${tasks[1].id}/manual`, 'POST', {
    student_id: sid, status: 'present', reason: '验证慢网络下自动刷新',
  }, 201)
  await expect(page.getByRole('cell', { name: '正常', exact: true })).toHaveCount(1, { timeout: 18000 })
  if (maxActive !== 1) throw new Error('Roster polling overlapped: ' + maxActive)
  await page.unrouteAll({ behavior: 'wait' })
  await context.close()
})
