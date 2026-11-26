<script setup>
import { computed, ref } from 'vue'
import { Download } from '@element-plus/icons-vue'
import SiteHeader from '@/components/SiteHeader.vue'
import HomeFeatureDemo from '@/components/HomeFeatureDemo.vue'
import { user } from '@/auth.js'
import heroArt from '@/assets/home/classroom-material-hero.svg'
import showcaseArt from '@/assets/home/classroom-material-showcase.svg'
import checkinArt from '@/assets/home/classroom-material-checkin-steps.svg'
import rolesArt from '@/assets/home/classroom-material-roles.svg'

const androidDownloadUrl = import.meta.env.VITE_ANDROID_DOWNLOAD_URL?.trim()
const showDownloadInfo = ref(false)
const role = ref('student')
const guides = {
  student: {
    label: '学生',
    title: '从注册到查询结果',
    steps: [
      ['注册并加入教学班', '使用学生身份注册并登录。加入教学班后，在「课程列表」查看课程和课次。'],
      ['上传头像并查看审核', '在「设置」提交本人照片，在「我的申请」查看审核结果。被拒绝时，按审核说明修改后重新提交。'],
      ['在安卓 App 签到', '使用同一账号登录安卓 App。教师开放签到后，打开任务并按提示现场拍照。照片会与审核通过的头像比对。'],
      ['核对考勤结果', '在「考勤记录」查看个人结果。识别异常或漏签时，联系任课教师复核。'],
    ],
  },
  teacher: {
    label: '教师',
    title: '管理教学班与考勤',
    steps: [
      ['注册并等待审核', '选择教师身份注册。管理员批准后，登录网页版查看自己负责的教学班。'],
      ['查看教学安排', '在「课程列表」查看教学班、课次和学生名单。需要变更时，按页面提示提交申请。'],
      ['发起签到并查看名单', '在「控制面板」选择「发起人脸考勤」，设置班级和签到时段。在「考勤记录」查看学生的签到状态。'],
      ['结束、复核和导出', '正常结束时系统将未签到学生记为缺勤。可人工登记或复核，导出本次考勤 HTML 或本班历次考勤 CSV。'],
    ],
  },
  admin: {
    label: '管理员',
    title: '处理申请与查看记录',
    steps: [
      ['管理账号和课程', '从「用户管理」查看账号和状态，从「课程管理」查看教学班、课次和学生名单。'],
      ['处理教师和课程申请', '进入「申请审核」，查看教师注册和课程调整等申请，填写审核说明后批准或拒绝。'],
      ['审核学生头像', '找到「更换头像」申请，点「查看详情」预览完整照片，填写说明并作出审核决定。'],
      ['查看已结束的考勤', '在「考勤记录」查看各班情况。正常结束的任务可导出 HTML，归档中止的任务保留已有记录。'],
    ],
  },
}
const selectedGuide = computed(() => guides[role.value])

const checkinSteps = [
  ['提交头像', '登录网页，在「设置」上传本人照片。'],
  ['等待审核', '在「我的申请」查看审核结果。通过后即可用于签到比对。'],
  ['手机签到', '教师发起任务后，用安卓 App 打开任务并现场拍照。'],
]
</script>

<template>
  <el-container class="app-layout home-layout" direction="vertical">
    <SiteHeader :show-guest-actions="false" />
    <main>
      <section class="home-hero" aria-labelledby="home-title">
        <div class="hero-inner">
          <div>
            <h1 id="home-title">查看课程，<br />完成课堂签到。</h1>
            <p>学生在安卓 App 签到，教师和管理员在网页上管理考勤。</p>
            <div class="hero-actions">
              <template v-if="!user">
                <el-button tag="router-link" to="/login" type="primary" size="large">登录</el-button>
                <el-button tag="router-link" to="/register" size="large">注册</el-button>
              </template>
              <el-button
                v-if="androidDownloadUrl"
                tag="a"
                :href="androidDownloadUrl"
                :icon="Download"
                size="large"
              >下载 Android 版</el-button>
              <el-button v-else :icon="Download" size="large" @click="showDownloadInfo = true">
                下载 Android 版
              </el-button>
            </div>
          </div>
          <img class="hero-art" :src="heroArt" width="480" height="286" alt="" />
        </div>
      </section>

      <section class="showcase home-section" aria-labelledby="home-demo-title">
        <div class="section-inner">
          <img class="section-art" :src="showcaseArt" loading="lazy" alt="" />
          <h2 id="home-demo-title">考勤与头像审核</h2>
          <p class="demo-caption">以下使用示例数据。</p>
          <HomeFeatureDemo />
        </div>
      </section>

      <section class="home-section" aria-labelledby="home-checkin-title">
        <div class="section-inner checkin-section">
          <img class="section-art checkin-art" :src="checkinArt" loading="lazy" alt="" />
          <h2 id="home-checkin-title">学生第一次签到</h2>
          <ol class="checkin-steps">
            <li v-for="[title, detail] in checkinSteps" :key="title">
              <h3>{{ title }}</h3>
              <p>{{ detail }}</p>
            </li>
          </ol>
        </div>
      </section>

      <section class="home-section" aria-labelledby="home-guide-title">
        <div class="section-inner">
          <img class="section-art" :src="rolesArt" loading="lazy" alt="" />
          <h2 id="home-guide-title">各角色操作指引</h2>
          <el-radio-group v-model="role" aria-label="选择角色">
            <el-radio-button v-for="(guide, key) in guides" :key="key" :value="key">
              {{ guide.label }}
            </el-radio-button>
          </el-radio-group>
          <div class="role-guide" aria-live="polite">
            <h3>{{ selectedGuide.title }}</h3>
            <ol class="role-steps">
              <li v-for="[title, detail] in selectedGuide.steps" :key="title">
                <strong>{{ title }}</strong>
                <p>{{ detail }}</p>
              </li>
            </ol>
          </div>
        </div>
      </section>
    </main>

    <el-dialog v-model="showDownloadInfo" title="下载 Android 版" width="min(420px, 92vw)">
      <p>目前暂无公开的 Android 安装包。发布后可在项目的 Releases 页面查看。</p>
      <template #footer>
        <el-button
          tag="a"
          type="primary"
          href="https://github.com/sam28403/classroom-android/releases"
          target="_blank"
          rel="noopener noreferrer"
        >查看 Android 发布页</el-button>
      </template>
    </el-dialog>
  </el-container>
</template>

<style scoped>
.home-layout {
  background: var(--app-page);
  color: var(--el-text-color-primary);
  line-height: 1.55;
}

.home-hero {
  background: linear-gradient(225deg, #e7f1ff, #f3f8ff 52%, #fff);
}

.hero-inner {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  align-items: center;
  gap: clamp(16px, 4vw, 54px);
  width: min(100%, 1280px);
  min-height: calc(100vh - 50px);
  min-height: calc(100svh - 50px);
  margin: 0 auto;
  padding: clamp(28px, 5vw, 70px) clamp(20px, 6vw, 84px);
}

.home-hero h1 {
  margin: 0 0 16px;
  font-size: clamp(32px, 5vw, 64px);
  line-height: 1.13;
  font-weight: 650;
  letter-spacing: -.035em;
}

.home-hero p {
  max-width: 30em;
  margin: 0 0 24px;
  color: var(--el-text-color-regular);
  font-size: clamp(15px, 1.65vw, 19px);
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.hero-actions .el-button {
  min-height: 44px;
  margin: 0;
  padding-inline: 15px;
  text-decoration: none;
}

.hero-art {
  display: block;
  width: 100%;
  height: auto;
  pointer-events: none;
}

.home-section { border-top: 1px solid var(--el-border-color-lighter); }
.showcase { background: var(--el-fill-color-light); }

.section-inner {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  width: min(100%, 1140px);
  margin: 0 auto;
  padding: clamp(42px, 5.4vw, 72px) clamp(20px, 6vw, 64px);
}

.section-inner h2 {
  margin: 0 0 16px;
  font-size: clamp(23px, 3.3vw, 36px);
  line-height: 1.2;
}

.section-art {
  position: absolute;
  z-index: -1;
  top: 8px;
  right: clamp(5px, 4vw, 48px);
  width: clamp(150px, 31%, 310px);
  height: auto;
  opacity: .8;
  pointer-events: none;
}

.demo-caption {
  margin: -4px 0 17px;
  color: var(--el-text-color-regular);
}

.checkin-art { top: 50%; transform: translateY(-50%); }

.checkin-steps,
.role-steps {
  display: grid;
  gap: 16px 24px;
  margin: 0;
  padding-left: 23px;
}

.checkin-steps {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-right: 32%;
}

.checkin-steps li { padding-top: 9px; border-top: 1px solid var(--el-border-color); }
.checkin-steps li::marker { color: var(--el-color-primary); font-weight: 650; }
.checkin-steps h3, .role-guide h3 { margin: 0 0 5px; font-size: 16px; }

.role-guide {
  margin-top: 14px;
  padding: clamp(16px, 3vw, 26px);
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-bg-color);
}

.role-guide h3 { margin-bottom: 12px; font-size: 18px; }
.role-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.checkin-steps p, .role-steps p { margin: 2px 0 0; color: var(--el-text-color-regular); }

@media (max-width: 760px) {
  .hero-inner {
    grid-template-columns: minmax(0, 1fr);
    align-content: center;
    min-height: calc(100svh - 60px);
    gap: clamp(20px, 4vh, 36px);
  }

  .hero-art {
    justify-self: center;
    width: auto;
    max-width: 100%;
    height: min(32svh, 255px);
    object-fit: contain;
  }

  .section-art { opacity: .47; }
  .checkin-art { top: 6px; transform: none; opacity: .32; }
  .checkin-steps { margin-right: 0; }
}

@media (max-width: 520px) {
  .checkin-steps, .role-steps { grid-template-columns: minmax(0, 1fr); }
}
</style>
