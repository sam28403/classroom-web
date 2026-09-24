// Scheduling uses the school's fixed Asia/Shanghai timezone, independent of the browser/server.
export function generateSessions(plan) {
  const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  if (!plan || !validDate(plan.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(plan.start || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(plan.end || '') || plan.start >= plan.end) throw new Error('请选择有效日期，且结束时间必须晚于开始时间（不支持跨日）')
  if (!['once', 'daily', 'weekly'].includes(plan.repeat)) throw new Error('请选择重复周期')
  if (typeof plan.location !== 'string' || !plan.location.trim() || plan.location.trim().length > 100) throw new Error('请填写上课地点（最多 100 字）')
  const until = plan.repeat === 'once' ? plan.date : plan.until
  if (!validDate(until) || until < plan.date) throw new Error('重复结束日期不能早于首次上课日期')
  const days = (Date.parse(until) - Date.parse(plan.date)) / 86400000
  if (days > 366) throw new Error('一次排课最多支持一年')
  if (plan.repeat !== 'once' && (!Number.isInteger(plan.interval) || plan.interval < 1 || plan.interval > 12)) throw new Error('重复间隔须为 1–12')
  if (plan.repeat === 'weekly' && (!Array.isArray(plan.weekdays) || !plan.weekdays.length || plan.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))) throw new Error('请至少选择一个上课星期')
  const startDate = new Date(`${plan.date}T00:00:00Z`)
  const weekOffset = (startDate.getUTCDay() + 6) % 7
  const sessions = []
  for (let day = 0; day <= days; day++) {
    const current = new Date(startDate.getTime() + day * 86400000)
    if (plan.repeat === 'daily' && day % plan.interval !== 0) continue
    if (plan.repeat === 'weekly' && (Math.floor((day + weekOffset) / 7) % plan.interval !== 0 || !plan.weekdays.includes(current.getUTCDay()))) continue
    const date = current.toISOString().slice(0, 10)
    sessions.push({ start_at: new Date(`${date}T${plan.start}:00+08:00`).toISOString(), end_at: new Date(`${date}T${plan.end}:00+08:00`).toISOString(), location: plan.location.trim() })
  }
  if (!sessions.length) throw new Error('所选日期范围内没有符合重复规则的课次')
  return sessions
}
