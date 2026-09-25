<script setup>
import { reactive, ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/api.js'
const emit = defineEmits(['changed'])
const people = ref([]), selected = ref(null), busy = ref(false)
const form = reactive({ name: '', class_name: '' })
async function load() {
  try { const [students, teachers] = await Promise.all([api('/students'), api('/teachers')]); people.value = [...students.items.map(p => ({ ...p, type: 'students', number: p.student_no })), ...teachers.items.map(p => ({ ...p, type: 'teachers', number: p.teacher_no }))] } catch (e) { ElMessage.error(e.message) }
}
function edit(row) { selected.value = row; form.name = row.name; form.class_name = row.class_name || '' }
async function save() {
  busy.value = true
  try { await api(`/${selected.value.type}/${selected.value.id}`, { method: 'PATCH', body: JSON.stringify(selected.value.type === 'students' ? form : { name: form.name }) }); selected.value = null; await load(); emit('changed'); ElMessage.success('资料已更新') } catch (e) { ElMessage.error(e.message) } finally { busy.value = false }
}
async function reset(row) {
  let password
  try { password = (await ElMessageBox.prompt(`请先核实「${row.name} / ${row.number}」的身份。设置新密码后账号立即解禁，旧登录全部失效。请通过可信渠道告知用户。`, '重设密码并解禁', { inputType: 'password', inputValidator: v => (v?.length >= 8 && /\d/.test(v) && /[^0-9]/.test(v)) || '至少 8 位，包含数字和非数字字符' })).value } catch { return }
  busy.value = true
  try { await api(`/users/${row.user_id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) }); emit('changed'); ElMessage.success('已重设密码并解禁') } catch (e) { ElMessage.error(e.message) } finally { busy.value = false }
}
onMounted(load)
</script>
<template>
  <el-card shadow="never" class="section-gap"><template #header><h2>学生与教师资料</h2></template><el-table :data="people"><el-table-column prop="number" label="学号 / 工号" /><el-table-column prop="name" label="姓名" /><el-table-column label="身份"><template #default="{ row }">{{ row.type === 'students' ? '学生' : '教师' }}</template></el-table-column><el-table-column prop="class_name" label="班级" /><el-table-column label="操作" min-width="210"><template #default="{ row }"><el-button link @click="edit(row)">修改资料</el-button><el-button link type="primary" :disabled="busy" @click="reset(row)">重设密码并解禁</el-button></template></el-table-column></el-table></el-card>
  <el-dialog :model-value="!!selected" title="修改用户资料" width="min(480px, 94vw)" @close="selected = null"><el-form label-position="top"><el-form-item label="学号 / 工号（不可修改）"><el-input :model-value="selected?.number" disabled /></el-form-item><el-form-item label="姓名"><el-input v-model="form.name" maxlength="80" /></el-form-item><el-form-item v-if="selected?.type === 'students'" label="班级"><el-input v-model="form.class_name" maxlength="100" /></el-form-item></el-form><template #footer><el-button type="primary" :loading="busy" @click="save">保存资料</el-button></template></el-dialog>
</template>
