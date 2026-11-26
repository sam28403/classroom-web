<script setup>
import { UserFilled } from '@element-plus/icons-vue'

const sampleRows = [
  { name: '学生甲', time: '08:55' },
  { name: '学生乙', time: '08:57' },
  { name: '学生丙', time: null },
]
</script>

<template>
  <div class="demo-grid">
    <article class="demo-card" aria-labelledby="attendance-example-title">
      <div class="demo-heading">
        <h3 id="attendance-example-title">教师考勤</h3>
        <el-tag type="info">已结束</el-tag>
      </div>
      <p class="demo-note">软件工程，示例教学班</p>
      <p class="demo-summary">应到 <strong>3</strong> 人，已签到 <strong>2</strong> 人，缺勤 <strong>1</strong> 人</p>
      <table class="demo-table" aria-label="学生考勤示例名单">
        <thead>
          <tr><th scope="col">学生</th><th scope="col">状态</th><th scope="col">签到时间</th></tr>
        </thead>
        <tbody>
          <tr v-for="row in sampleRows" :key="row.name">
            <th scope="row">{{ row.name }}</th>
            <td>
              <el-tag :type="row.time ? 'success' : 'danger'">{{ row.time ? '已签到' : '缺勤' }}</el-tag>
            </td>
            <td>{{ row.time ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </article>

    <article class="demo-card" aria-labelledby="avatar-example-title">
      <div class="demo-heading">
        <h3 id="avatar-example-title">管理员头像审核</h3>
        <el-tag type="warning">待审核</el-tag>
      </div>
      <p class="demo-note">申请人：学生甲</p>
      <figure class="demo-photo">
        <el-icon :size="48" aria-hidden="true"><UserFilled /></el-icon>
        <figcaption>示例头像</figcaption>
      </figure>
      <p class="demo-note avatar-note">管理员可预览学生提交的完整照片，再决定批准或拒绝。</p>
    </article>
  </div>
</template>

<style scoped>
.demo-grid {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: 16px;
}

.demo-card {
  padding: clamp(14px, 2.5vw, 26px);
  border: 1px solid var(--el-border-color);
  border-radius: 10px;
  background: var(--el-bg-color);
}

.demo-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.demo-heading h3 { margin: 0; font-size: 17px; }
.demo-note { margin: 8px 0 12px; color: var(--el-text-color-regular); }
.demo-summary { margin: 0 0 12px; font-size: 14px; }

.demo-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  text-align: left;
}

.demo-table th,
.demo-table td {
  padding: 8px 5px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.demo-table tbody th { font-weight: 400; }

.demo-photo {
  display: grid;
  place-items: center;
  place-content: center;
  gap: 8px;
  min-height: 134px;
  margin: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-size: 14px;
}

.avatar-note { margin: 12px 0 0; }

@media (max-width: 680px) {
  .demo-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
