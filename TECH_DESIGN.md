# xinghe-helper 技术设计文档（TECH_DESIGN）

> 版本：v1.1（MVP）｜更新日期：2026-09-21
> 配套文档：《PRD.md》v1.2、《research.md》
> 读者：零基础开发者（你自己）+ 未来协作者。只讲"怎么搭、怎么连、数据怎么走"，**不写业务代码**，给足结构、字段、接口与边界，照着 vibe coding 即可落地。
> 相对 v1.0 的变更：v1.0 默认推荐 CloudBase（方案 A），基于"假设有腾讯云账号"。经确认你**仅拥有 GitHub 账号、无腾讯云**，故 v1.1 改为推荐 **方案 B（Supabase + Vercel）**，并在第一节给出 A/B 四维对比与理由。

---

## 〇、你的约束与临时假设（review 后改）

**已确认约束（来自你的回复）**
- 账号：只有 **GitHub**，没有腾讯云 / CloudBase 账号
- 时间：28 天里**适中**，能接受少量配置
- 电脑：Windows 笔记本，**能装 Node**，可本地开发调试

**临时假设（A 类，待你确认）**

| # | 假设 | 依据 |
|---|---|---|
| A1 | MVP 只服务一个当前营期，`camp_id=1` | PRD"工作台只服务一个当前营期" |
| A2 | 学生重复提交以「姓名 + 性别 + 营期」判同一人，旧记录 `is_latest=false` | PRD 无登录、无手机号，姓名是仅有的稳定标识（撞名风险已标注） |
| A3 | "AI 分房"= 规则驱动的贪心算法（确定性、免费、可复现），**不调外部大模型** | 约束是确定优先级，贪心即满足；P5 再考虑 LLM |
| A4 | 推荐路线 = **方案 B（Supabase + Vercel）**，因你仅 GitHub 账号 | 见第一节对比与推荐 |
| A5 | 组织者写接口用环境变量 `ADMIN_TOKEN` 做简单头校验 | PRD 学生端零注册，组织者动作应防误触 |
| A6 | 房间由组织者在工作台手动录入（无批量导入） | PRD 未提导入 |
| A7 | 名单导出 = 浏览器打印（`window.print()`）+ 可选 CSV | 零基础、够用、对接酒店只需一张纸 |

---

## 一、方案对比与推荐

### 1.1 两套方案定义

- **方案 A（CloudBase 全家桶）**：React/Vite + 腾讯云开发 Node.js 云函数 + CloudBase PostgreSQL + CloudBase 静态托管
- **方案 B（Supabase + Vercel）**：React/Vite + Supabase（托管 PostgreSQL + Edge Functions）+ Vercel 静态托管

### 1.2 四维对比

| 维度 | 方案 A · CloudBase | 方案 B · Supabase+Vercel |
|---|---|---|
| **学习成本** | 单一控制台（云开发），中文文档好；概念少（环境/云函数/库）；但需学 `tcb` CLI 与腾讯云控制台 | 需懂 Supabase（Project/Postgres/Edge Functions）+ Vercel（git 部署/环境变量）两个平台；概念略多，但文档极好、社区大、GitHub 一键登录；"适中"时间可 cover |
| **线上持久化** | CloudBase PostgreSQL 托管，自动备份，同环境内网，可靠 | Supabase 真实托管 PostgreSQL，自动备份 + 标准 PG 可导出；Vercel 无状态函数 + Supabase 持久层分离清晰；持久化同样可靠且不被锁定 |
| **费用** | 按量，有免费额度，但 PostgreSQL 实例可能收费 / 需**实名 + 可能预付** | Supabase Free（500MB 库，够 MVP）+ Vercel Hobby（个人免费）全程免费，**无实名预付压力** |
| **排错难度** | 日志在云开发控制台，跨地域/控制台跳转，新手找日志稍绕 | Vercel + Supabase 均有清晰 Dashboard 与函数日志；你 Windows+Node 可本地 `supabase start` 完整复现，**排错链路最短**，社区答案多 |

### 1.3 推荐：方案 B（Supabase + Vercel）

**原因（紧扣你的约束）**：
1. **账号门槛最低**：你只有 GitHub。Supabase 与 Vercel 都支持 **GitHub 一键登录**，无需新开腾讯云账号、无需实名/预付；方案 A 必须先注册腾讯云（实名 + 可能预付），与"只有 GitHub"直接冲突。
2. **费用最友好**：B 全程免费额度覆盖 MVP，无预付；A 有实例费用/实名门槛。
3. **排错最顺**：你 Windows+Node 能本地跑 Supabase（`supabase start` 起本地 PG+函数），排错链路短；A 依赖云端控制台，本地还原难。
4. **时间可接受**：你时间"适中、能接受少量配置"，B 的"git push 即部署 + Supabase 自动 REST"反而省事。
5. **持久化不妥协**：两者都稳；B 用标准 PostgreSQL，数据易导出、易迁移、不被厂商绑定。

**取舍（你要接受的代价）**：B 需学两个平台（Supabase + Vercel）概念，略多于 A 的单一控制台；但 GitHub 登录 + 免费 + 本地可跑，综合对你最稳。若你之后愿意开腾讯云，方案 A 仍可行——**数据库 schema 完全通用，迁移成本很低**（见第八节）。

> 备注：若连 Supabase 也不想用，可作"方案 C"——React/Vite + 自建 Express + PostgreSQL + 轻量服务器，但需自己运维（装环境/库/HTTPS/备份），零基础 + 28 天风险高，不推荐。

---

## 二、项目结构（方案 B）

```
xinghe-helper/
├── web/                          # 前端（React + Vite）
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   ├── .env.example              # 前端环境变量模板（仅 anon key，可提交）
│   └── src/
│       ├── main.jsx
│       ├── App.jsx               # 路由：/form  /workbench  /overview
│       ├── pages/
│       │   ├── StudentForm.jsx   # F1 学生填写页（移动优先）
│       │   ├── Workbench.jsx     # F2 分房工作台（桌面优先，左右分栏）
│       │   └── Overview.jsx      # F3 名单总览与导出（打印友好）
│       ├── components/
│       │   ├── RoomCard.jsx      # 房间卡片（房号/容量/成员/警告）
│       │   ├── StudentRow.jsx    # 未分配学生行（按性别分组）
│       │   ├── CopyLink.jsx      # F4 复制填写链接
│       │   └── ConfirmDialog.jsx # 删除/清空二次确认
│       ├── api/client.js         # 封装 Supabase SDK + Edge Function 请求
│       └── styles/               # 仅用颜色做约束警告（红=红线/超员，黄=睡眠冲突）
├── supabase/                     # Supabase 配置（B 路线核心）
│   ├── migrations/
│   │   └── 0001_init.sql         # PostgreSQL 建表（等价于 db/schema.sql）
│   ├── functions/                # Edge Functions（Deno/TS）
│   │   ├── students/index.ts     # 学生提交 / 查询未分配
│   │   ├── rooms/index.ts        # 房间 CRUD
│   │   ├── assign/index.ts       # 一键分房 / 恢复 / 手动调整
│   │   └── export/index.ts       # 名单分组数据
│   └── config.toml
├── shared/                       # 前后端共享（纯逻辑，无框架依赖）
│   ├── assignEngine.js           # 规则驱动贪心分房引擎（A3）
│   └── constants.js             # 老师/班级/选项枚举、约束优先级常量
├── docs/
│   ├── PRD.md
│   ├── research.md
│   └── TECH_DESIGN.md
├── AGENTS.md
├── .gitignore                    # 已拦截 .env / 密钥 / node_modules
└── README.md
```

> 说明：`shared/assignEngine.js` 是分房核心，放在共享层，Edge Function `assign/index.ts` 直接引用；前端不做分房计算（只发请求），保证"规则唯一来源"。Supabase 自动 REST（PostgREST）可承担 students/rooms 的简单 CRUD，复杂逻辑（分房、去重、校验）走 Edge Function。

---

## 三、数据对象及字段（PostgreSQL）

> 单一数据源：`students.assigned_room_id` 是分配唯一真相；房间"成员列表"由 `SELECT ... WHERE assigned_room_id = 房间.id` 实时得出，不另存副本。`gender_label` 为派生缓存，用于混房警告。

### 3.1 建表（`supabase/migrations/0001_init.sql` 摘要）

```sql
-- 营期（MVP 仅 seed 一行 id=1；P2 多营期启用）
CREATE TABLE camps (
  id       BIGSERIAL PRIMARY KEY,
  name     VARCHAR(100) NOT NULL,
  org_name VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 学生（数据对象）
CREATE TABLE students (
  id               BIGSERIAL PRIMARY KEY,
  camp_id          BIGINT NOT NULL DEFAULT 1 REFERENCES camps(id),
  name             VARCHAR(50)  NOT NULL,
  gender           VARCHAR(2)   NOT NULL CHECK (gender IN ('男','女')),
  teacher          VARCHAR(20)  NOT NULL
                     CHECK (teacher IN ('Mona','Kiven','Selena','Betty','Priya')),
  class_level      VARCHAR(10)  NOT NULL CHECK (class_level IN ('星一','星二','星三')),
  check_in_date    DATE         NOT NULL,                 -- 信息性，非约束
  room_pref        INT          NOT NULL CHECK (room_pref BETWEEN 1 AND 6),
  snore            BOOLEAN,                            -- 可选
  sleep_quality    VARCHAR(10)  CHECK (sleep_quality IN ('好','一般','差')), -- 可选
  note             TEXT,                               -- 可选
  is_latest        BOOLEAN     NOT NULL DEFAULT TRUE, -- 重复提交保留最新(A2)
  superseded_by    BIGINT,                            -- 指向更新后的记录
  assigned_room_id BIGINT       REFERENCES rooms(id), -- 分配真相，NULL=未分配
  assign_status     VARCHAR(10) NOT NULL DEFAULT '未分配'
                     CHECK (assign_status IN ('未分配','已分配')),
  created_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_students_unassigned ON students(camp_id, assign_status, gender)
  WHERE assigned_room_id IS NULL;

-- 房间（数据对象）
CREATE TABLE rooms (
  id          BIGSERIAL PRIMARY KEY,
  camp_id     BIGINT NOT NULL DEFAULT 1 REFERENCES camps(id),
  room_no     VARCHAR(20) NOT NULL,
  capacity    INT         NOT NULL CHECK (capacity > 0),
  gender_label VARCHAR(2) CHECK (gender_label IN ('男','女')), -- 派生缓存
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (camp_id, room_no)
);

-- 分房历史快照（支持"恢复 AI 方案"）
CREATE TABLE assignment_history (
  id         BIGSERIAL PRIMARY KEY,
  camp_id    BIGINT NOT NULL DEFAULT 1,
  run_type   VARCHAR(10) NOT NULL CHECK (run_type IN ('ai','manual')),
  snapshot   JSONB NOT NULL,   -- { room_no: [student_id,...], unassigned: [{id, reason}] }
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 3.2 字段与 PRD 对应

| PRD 字段 | 数据对象字段 | 说明 |
|---|---|---|
| 姓名 / 性别 / 带班老师 / 班级 | name / gender / teacher / class_level | 必填，CHECK 兜底 |
| 入住日期 | check_in_date | 必填但**非约束**，仅用于名单标注 |
| 期望拼房人数 | room_pref | 1~6，CHECK 兜底 |
| 打呼噜 / 睡眠质量 / 备注 | snore / sleep_quality / note | 可选 |
| 分配状态 | assign_status + assigned_room_id | 系统维护 |
| 房号 / 可住人数 | room_no / capacity | 组织者录入 |
| 成员列表 | 由 assigned_room_id 反查 | 不冗余存储 |
| 性别标签 | gender_label | 首个成员决定，混房警告用 |

> **重复提交处理（A2）**：收到新提交时，对同 `(name, gender, camp_id)` 的旧记录置 `is_latest=false` 且 `superseded_by=新id`；查询/分房只认 `is_latest=true`。旧记录留痕便于核查，不物理删除（PRD 第六节存储要求）。

---

## 四、API 列表（Supabase Edge Functions）

> 路径约定：简单 CRUD 走 Supabase 自动 REST（`/rest/v1/students`、`/rest/v1/rooms`）；复杂逻辑走 Edge Function。写接口建议带 `x-admin-token` 头（A5）。

| 方法 | 路径 | 功能（对应 PRD） | 请求体 / 参数 | 返回 |
|---|---|---|---|---|
| POST | `/rest/v1/students` 或 Edge `students` | F1 学生提交（去重逻辑在 Edge 内） | 全部学生字段 | 201 + id；重复提交 200 + "已更新" |
| GET | `/rest/v1/students?assign_status=eq.未分配` | F2 左栏未分配 | 查询参数 | 未分配学生数组 |
| GET | `/rest/v1/rooms?select=*` | F2 右栏 / F3 | — | 房间数组（成员联查） |
| POST | `/rest/v1/rooms` | 组织者建房间 | room_no, capacity | 201 + 房间 |
| PATCH | `/rest/v1/rooms?id=eq.:id` | 改房号/容量 | 部分字段 | 200 |
| DELETE | `/rest/v1/rooms?id=eq.:id` | 删房间（二次确认后） | — | 200，成员回未分配 |
| POST | `Edge /assign/run` | F2 一键 AI 分房 | — | 200 + {assigned, unassigned:[{id,reason}]}，写 assignment_history |
| POST | `Edge /assign/restore` | F2 恢复上次 AI 方案 | — | 200，应用最新 `run_type='ai'` 快照 |
| PATCH | `Edge /students/:id/assign` | F2 手动拖拽调整 | {room_id\|null} | 200；性别不符/超员 422 + 原因 |
| GET | `Edge /export?view=room\|teacher` | F3 名单数据 | view 参数 | 分组名单 JSON（当刻快照） |
| GET | `Edge /meta` | F4 填写链接/营期信息 | — | {form_link, camp_name, org_name} |

**分房引擎接口（内部）**：`shared/assignEngine.js` 导出 `runAssignment(students, rooms)` → `{assignments, unassigned}`，被 `assign/index.ts` 调用，不单独暴露 HTTP。

---

## 五、数据流

### 5.1 F1 学生填表
```
学生手机打开 /form（Vercel 静态托管）
  → 填完点提交
  → POST students（前端必填校验 + 后端 CHECK 兜底；Edge 内处理 is_latest 去重）
  → 返回成功 → 确认页"你的住宿需求已收到"
```
无登录、无验证码（PRD 全局规则）。

### 5.2 F2 分房工作台
```
组织者打开 /workbench
  → 并行 GET rooms + GET students?assign_status=eq.未分配
  → 左栏未分配（按性别分组）/ 右栏房间卡片
  → 点"一键 AI 分房"
      → POST Edge /assign/run
      → 调用 assignEngine.runAssignment(students, rooms)
          · 按约束优先级填充 → 写 students.assigned_room_id
          · 溢出留未分配并附 reason
      → 返回结果 → 前端重渲染
  → 手动拖拽某生到别房
      → PATCH Edge /students/:id/assign {room_id}
      → 校验（性别一致 + 不超员）通过才写，否则 422
      → 即时保存，无"保存按钮"
  → "重新分房"= POST /assign/run（二次确认清空）
  → "恢复 AI 方案"= POST /assign/restore（应用历史快照）
```

### 5.3 分房引擎算法（`assignEngine.runAssignment`）
确定性贪心，严格按 PRD 优先级：
1. **红线**：按 `gender` 分男/女两组，房间按 `gender_label` 隔离，绝不分跨性别。
2. **同老师同班优先**：组内再按 `(teacher, class_level)` 聚合，尽量同师同班塞同间。
3. **拼房意愿**：在上条前提下让房间人数 ≈ `room_pref` 且 ≤ `capacity`。
4. **睡眠相容**：避免「睡眠差」与「打呼噜」同住；打呼噜者之间优先同住。
5. **兜底**：装不下留 `unassigned` 并标 reason（如"需增加男生房间"）；因性别被拆开属正常。

> 房间是物理空间（A3/PRD 时间变更）：**不同 `check_in_date` 的人可同住**，引擎完全不比较入住日期。

### 5.4 F3 名单总览与导出
```
组织者打开 /overview
  → GET rooms（含成员）→ 渲染打印友好表格
  → 顶部统计：总数 / 已分配 / 未分配
  → 有未分配时点"导出" → 二次确认 → GET Edge /export?view=teacher
  → 前端 window.print() 打印；可选 CSV 下载
  → 空数据 → 引导文案 + 复制链接
```
导出是**当刻快照**（实时读 DB），之后改分配不影响已打印的纸。

### 5.5 F4 填写链接
`/form` 是固定公开路由，F4 顶部 `CopyLink` 复制当前域名 + `/form`；`/meta` 提供营期名/机构名。

---

## 六、错误处理

映射到 PRD 第七节，HTTP 状态与用户提示：

| 场景（PRD） | 前端行为 | 后端/HTTP |
|---|---|---|
| 必填漏填就提交 | 提交按钮拦截，高亮缺项"还差 N 项：…" | 后端 CHECK 兜底，400 + 缺项列表 |
| 重复提交 | 确认页"已更新你的信息" | 200，翻转 is_latest |
| 手动分到满员/性别不符房 | 红色警告，分配不生效 | 422 + 原因（不写库） |
| 某性别凑不进现有房间 | 留未分配 + "需增加 X 房间" | AI 结果含 unassigned[reason] |
| 误删房间 | 二次确认弹窗 | DELETE 成功，成员回归未分配 |
| 有未分配就导出 | 提示人数 + 确认 | GET /export 照常返回 |
| 无数据打开总览 | 引导文案 + 复制链接 | 200 空列表 |
| 网络/服务异常 | "保存失败，请重试"，**绝不白屏/假成功** | 前端重试 + 超时文案 |

**全局规则（来自 PRD）**：所有等待有文字说明；删除/清空类全二次确认；`.env`/密钥不进仓库与页面（`.gitignore` 已配）；颜色仅用于约束警告（红/黄）。

---

## 七、环境变量

**前端 `web/.env.example`**（仅 anon key，可提交模板，无密钥）：
```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=public-anon-key      # 公开安全，前端可用
VITE_API_BASE=https://xxxx.supabase.co/functions/v1   # Edge Function 基址
```

**Supabase / Vercel（不进仓库，控制台或 Secrets 配置）**：
```
# ⚠️ Day 23 改动：下面三行原来是 postgresql://... / xxx / xxxx 这种「长得像真密钥」的占位符。
#   问题是它们和真实连接串长得一模一样 —— 容易被误抄进代码或误当成真的配置值。
#   现在改成明显不是密钥的写法。记住这个原则：
#   **占位符要一眼看出它是占位符**，否则它就是一颗定时炸弹。
SUPABASE_DB_URL=<平台提供，本地 supabase start 自动注入>   # 不用时留空
SUPABASE_SERVICE_ROLE_KEY=<仅服务端用，绝不进前端>
ADMIN_TOKEN=<组织者写接口头校验，建议设>
```
> 规则：Service Role Key 与 token 只存 Supabase Secrets / Vercel 环境变量，代码里 `Deno.env.get(...)` 读取，**绝不硬编码、绝不提交**。anon key 可放前端（Supabase 设计如此，靠 RLS 策略限制写权限）。

---

## 八、部署与迁移注意事项

### 8.1 部署（方案 B）
1. **建库**：`supabase link --project-ref xxx` → `supabase db push`（执行 `0001_init.sql`）；`camps` 先 seed 一行 `id=1`。
2. **函数**：`supabase functions deploy assign`（逐个部署 Edge Functions）。
3. **前端**：`web/` 跑 `vite build` → 静态产物推 Vercel（`vercel` 命令或 git push 自动部署）。
4. **本地联调**（你 Windows+Node 可完整跑）：`supabase start` 起本地 PG+函数，`vite dev` 起前端，排错链路最短。
5. **RLS**：Supabase 默认开启行级安全，需为 students 写、rooms/assign 写配置策略（或暂用 Service Role Key + ADMIN_TOKEN 护住组织者接口）。

### 8.2 迁移注意事项
- **schema 版本化**：建表脚本在 `supabase/migrations/`，可重放、可回滚；备份整表（含 `is_latest` 软失效痕迹）别只导最新。
- **导出快照无额外表**：实时读 DB，天然当刻一致；要历史归档可另存 `assignment_history.snapshot`。
- **方案 A（CloudBase）迁移**：PostgreSQL schema **完全通用**，仅把 Edge Function 改写为 CloudBase 云函数、前端 env 改 `CLOUDBASE_ENV_ID`、静态托管改 CloudBase——业务逻辑不动。
- **方案 C（自建）迁移**：同 schema，Edge Function → Express 路由，Vercel → Nginx，连接串走环境变量。
- **数据导出**：Supabase 是标准 PostgreSQL，`pg_dump` 即可拿走，不被锁定。
- **CRLF / `.gitignore`**：Day 0 已配置，Windows 换行符警告可忽略；密钥/依赖已被拦截。
- **上线前检查**（对应 PRD 验收"全局"）：`.env` 不在仓库；所有删除/清空二次确认；无白屏/无限转圈；RLS/ADMIN_TOKEN 已护住写接口。

---

## 九、后续演进（对应 PRD 第四节 P1–P5）

| 编号 | 功能 | 技术影响 |
|---|---|---|
| P1 学生查结果 | 加 `/result?name=` 页 + 查询接口 | 复用 students 表 |
| P2 多营期 | 启用 `camps` + 切换 UI + 数据隔离 | `camp_id` 已预留 |
| P3 多人协作 | 加组织者账号/权限 | Supabase Auth 现成，A5 升级 |
| P4 改动通知 | 分房变动触发通知 | 加消息通道（邮件/企微） |
| P5 分房智能优化 | 在贪心之上接 LLM 微调排序 | `assignEngine` 可插拔，A3 预留 |

---

> 本文档因你"仅 GitHub 账号"的约束，将推荐从 v1.0 的方案 A 改为 **方案 B（Supabase + Vercel）**；若日后开通腾讯云，schema 通用、迁移成本低（见第八节）。落地时建议按 PRD 的 Day 拆分逐个功能 vibe coding，每完成一个功能即本地验证 + 提交。
