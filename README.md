# Sam-Lab Classroom

Vue 3 + Vite + Element Plus 网页端，Express 业务后端。后端按 `Feasibility_analysis.md` 附录 A/B 实现用户、学生、教师、课程、教学班、选课、人脸映射、同意记录、考勤任务、考勤记录、复核和审计共 12 个业务表。

## 本地启动

需要 Node.js 22.18+（或 24.12+），推荐 Node 24 LTS。

```sh
npm install
npm run dev
```

`npm run dev` / `npm run dev:full` 同时启动 Vite（默认 5173）和 API（默认 3001），避免只启动前端导致验证码/API 不可用。单独启动前端用 `npm run dev:web`，单独 API 用 `npm run api`。默认地址：[首页](http://localhost:5173/)、[登录](http://localhost:5173/#/login)、[注册](http://localhost:5173/#/register)。

可复制 `.env.example` 为 `.env` 后配置。API 会自动读取 `.env`；不要把 `.env` 或数据库凭据提交到仓库。若改变 API_PORT，启动 Vite 时需同步设置 API_PROXY_TARGET（完整地址）。开发环境默认通过同源代理访问，不需要跨域 CORS。

本地调试（NODE_ENV 非 production）允许 localhost、127.0.0.1 和 [::1] 之间的来源及端口差异，兼容 Vite 自动换端口，避免登录被误判为跨站请求。局域网域名/IP 需通过 APP_ORIGINS 明确配置；生产环境仍严格匹配来源白名单。修改配置后请重启 API。

默认继续使用 `server/db/classroom.db`，启动时非破坏性补齐表、用户 password_hash/status 及学生/教师资料；已有 password 哈希保留，旧 scrypt 登录成功后升级为 bcrypt。首次运行前建议备份原数据库（停服后复制数据库及 WAL/SHM，或使用 SQLite backup）。SQLite 文件不会自动迁入 MySQL。

新数据库初次启动创建 admin。可通过 ADMIN_PASSWORD 指定初始密码（至少 12 位，最多 72 字节，包含数字和非数字）；未指定则仅在开发模式将随机密码写入数据库目录的 `admin-credentials.txt`。登录后可通过 `PATCH /api/auth/password` 改密，再删除该凭据文件。已有管理员不受 ADMIN_PASSWORD 变更影响。

公开注册的学生可直接登录；教师需管理员通过 `PATCH /api/users/{id}` 设置 `{"status":"active"}` 审核。当前网页只有首页、登录、注册，**管理和考勤接口已实现，业务管理页面尚未实现**；可先用 Postman/Android 联调。

## 生产构建与 MySQL 部署

```sh
npm run build
npm start
```

Express 同时提供 `dist` 和 `/api`。`npm run preview` 仅提供构建预览并代理到独立 API，仍需另开 `npm run api`。

生产建议使用 MySQL 8.4：设置 `DB_DRIVER=mysql`、DB_HOST、DB_PORT、DB_NAME、DB_USER、DB_PASSWORD。数据库须预先存在，服务启动时创建表；数据库账户需要建表/升级权限。`server/db/schema.js` 为两种数据库的统一建表定义，db.js 执行幂等升级；默认 SQLite 用于本地兼容与快速测试。

已提供 `Dockerfile`、`compose.yaml`，将前端和 API 打包为一个镜像，并依赖带持久卷和健康检查的 MySQL。准备 `.env` 中的 DB_PASSWORD、MYSQL_ROOT_PASSWORD、ADMIN_PASSWORD、至少 32 字符的 SESSION_SECRET，以及真实 HTTPS 域名 APP_ORIGINS，然后运行：

```sh
docker compose up --build -d
```

API 仅映射宿主机 `127.0.0.1:3001`；前置 Nginx/Caddy 提供 HTTPS，并覆盖设置 X-Forwarded-Proto/Host。生产 Cookie 强制 Secure，**直接 HTTP 访问生产容器不能正常保持登录**。只在可信单层反向代理后使用 TRUST_PROXY=1。数据库端口不映射到宿主机。稳定 SESSION_SECRET 使重启后会话继续有效；未设置时开发会话在 API 重启后失效。

CompreFace 是独立服务：按[官方部署说明](https://github.com/exadel-inc/CompreFace)部署，在管理界面创建 Recognition 服务，将它的 Key 写入服务端 COMPREFACE_API_KEY。COMPREFACE_URL 应指向其入口（容器内访问宿主机可用 `http://host.docker.internal:8000`），不能指向浏览器或 Android 客户端。Compose 不自动创建 CompreFace 的服务 Key，也不包含其整套模型容器。建议设置 `SAVE_IMAGES_TO_DB=false` 减少原图留存。

## 本次修复与业务行为

- 顶栏封装成 SiteHeader 后，Element Plus 无法通过直接子组件识别 ElHeader，原容器变成横排。三个页面显式使用纵向布局，表单区域恢复；删除嵌套 form，验证码支持字母输入。
- 原退出请求无 body，被全局 JSON 校验拒绝。现在允许空 body 的退出，销毁服务端会话、清 Cookie，并阻止已撤销会话被旧请求重新写回。前端用共享状态与请求版本号避免旧 `/me` 响应覆盖退出；多标签页同步退出，页面恢复可见时重新核实身份。
- 数据库会话代替 MemoryStore；刷新轮换 Session ID；改密/停用注销全部会话；不缓存身份接口。
- 后端 RBAC 和教学班归属检查；任务时段、有效选课、重复签到唯一约束；异常复核在事务中写前后状态与原因；提供教师人工登记和请假记录。
- 人脸登记需单独同意；只接收有限大小 JPEG/PNG。超时/服务未配置返回 503；撤回先禁止识别，远端删除失败保留 pending_delete 供重试。身份匹配不接受客户端传入 student_id 或相似度。
- 教师班级报表和 CSV 导出，管理员审计查询；业务实体归档代替级联删除。

详细字段、状态规则、错误码、联调步骤见 [docs/API.md](docs/API.md)。

## 验证

```sh
npm test
npm run build
```

测试使用独立内存数据库、临时旧结构数据库及本地 CompreFace 协议替身，不访问真实人脸或现有用户数据。覆盖注册审核、一次性验证码、权限/归属、上传限制、并发重复签到、低相似度/无人脸/多人脸、故障降级、撤回删除、复核、CSV、旧 Cookie 重放、退出后会话回写、账号停用和旧数据库兼容。

已验证：SQLite API 集成测试、旧数据结构升级、前端构建、浏览器登录/注册页显示。尚未实测：MySQL 容器运行、真实 CompreFace 模型识别、目标设备性能/活体能力。当前环境没有可用 Docker 命令；部署配置已提供，但不将协议替身测试视为真实识别验收。
