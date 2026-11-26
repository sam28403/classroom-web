const statuses = {
  present: '正常', late: '迟到', absent: '缺勤', leave: '请假',
  exception: '待复核', manual: '正常',
}
const sources = { face: '人脸签到', manual: '人工登记', system: '系统归档' }
const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escape = value => String(value ?? '—').replace(/[&<>"']/g, char => entities[char])
const dateTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23',
})
function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? '—' : dateTime.format(date)
}

export function renderAttendanceReport(task, classroom, records) {
  const counts = { 正常: 0, 迟到: 0, 缺勤: 0, 请假: 0, 待复核: 0 }
  const rows = records.map(record => {
    const status = statuses[record.status] ?? '—'
    if (Object.hasOwn(counts, status)) counts[status]++
    const cells = [record.student_no, record.name, status, sources[record.source], formatTime(record.checked_at)]
    return `<tr>${cells.map(value => `<td>${escape(value)}</td>`).join('')}</tr>`
  }).join('\n')
  const summary = [['总记录', records.length], ...Object.entries(counts)]
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>考勤报告 #${escape(task.id)}</title>
<style>
  body { margin: 2rem auto; padding: 0 1rem; max-width: 60rem; font: 1rem/1.6 system-ui, sans-serif; color: #202833; }
  h1 { margin-bottom: .5rem; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: .25rem 1rem; }
  dd { margin: 0; overflow-wrap: anywhere; }
  .summary { display: flex; gap: .5rem 1rem; flex-wrap: wrap; padding: .75rem; background: #eef3f8; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: .5rem; border-bottom: 1px solid #d9e0e8; text-align: left; overflow-wrap: anywhere; }
  th { background: #eef3f8; }
  @media print { thead { display: table-header-group; } tr { break-inside: avoid; } }
</style>
</head>
<body>
<main>
<h1>学生考勤报告</h1>
<dl>
<dt>考勤任务</dt><dd>#${escape(task.id)}</dd>
<dt>课程</dt><dd>${escape(classroom.course_name)}</dd>
<dt>教学班</dt><dd>${escape(classroom.class_name)}</dd>
<dt>签到时段</dt><dd>${escape(formatTime(task.start_at))} — ${escape(formatTime(task.end_at))}（北京时间）</dd>
<dt>迟到时间</dt><dd>${escape(formatTime(task.late_at))}</dd>
</dl>
<h2>考勤统计</h2>
<p class="summary">${summary.map(([label, value]) => `<span>${label} <strong>${value}</strong></span>`).join('')}</p>
<h2>学生明细</h2>
<table>
<thead><tr><th scope="col">学号</th><th scope="col">姓名</th><th scope="col">考勤状态</th><th scope="col">记录来源</th><th scope="col">记录时间</th></tr></thead>
<tbody>
${rows || '<tr><td colspan="5">暂无考勤记录</td></tr>'}
</tbody>
</table>
</main>
</body>
</html>`
}
