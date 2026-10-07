# Day 20|前端从mock 切换为调用公网接口

> 日期：2026-10-07
> 目标：把 `web/` 从「读本地假数据 + 直连 Supabase」改成「只调自己的云函数 HTTP 接口」，
> 收紧 CORS，重新构建并部署静态托管，同伴用浏览器就能打开真实数据。

---

## 1. 今天到底改了什么（一句话）

**前端不再直连数据库了。**以前页面用 anon key 直连 PostgREST，
今天起所有数据都走 `https://xinghe-helper-d5g92pis442fd9947.service.tcloudbase.com/api/*`，
数据库的访问权全部收在后端；同时把 CORS 从 `*` 改成白名单。

---

## 2. 为什么不直连数据库了（三条理由，按重要性排）

### ① 权限边界

直连意味着 Supabase anon key 要打进前端产物，任何人打开开发者工具都能拿到。
拿到 anon key 就能绕过我们所有的接口校验，直接读写数据库。

改成只调接口之后，能做什么**完全由后端接口决定**——
就算拿到 anon key，也写不了库。

### ② 校验位置

像「男女不能混住」「不能超员」这类业务规则，如果只在浏览器里判断，
改一下 JS 就能跳过去。放后端才是真的拦得住。

### ③ 一致性

「重复提交保留最新」需要连续做三步写操作：
插一条新的 → 把同名旧记录标失效 → 数一下有几条历史。

Day 8~19 这三步是**在浏览器里分三次请求做的**。
中间断网，第 2 步没做成，就会留下一条「同名两人都是 `is_latest=true`」的脏数据：
工作台会把这个学生显示两次，而且没法判断哪条是对的。

现在这三步在云函数里一次做完，要么都成功，要么都不做。

---

## 3. 目录结构变化

```
xinghe-helper/
├── cloudfunctions/
│   ├── api-rooms/                ← 房间 4 个接口
│   │   ├── index.js              接口层：分流 + 校验 + 返响应
│   │   ├── rooms.repo.js         数据层：9 个方法（Day 19 的 4 个 + 今天 5 个）
│   │   ├── response.js           响应层：统一信封 + CORS 头
│   │   ├── cors.js               ★新增：CORS 白名单
│   │   └── db.js                 连接层
│   ├── api-students/             ← 学生 7 个接口
│   │   ├── index.js              ★重写：Day 17 只有 1 个接口，现在 7 个
│   │   ├── students.repo.js      ★新增：10 个方法
│   │   ├── response.js           ★同步白名单版
│   │   ├── cors.js                ★新增
│   │   └── db.js
│   └── health/                   ← 健康检查
│       ├── index.js               ★加上 CORS 白名单
│       └── cors.js★新增
│
├── web/                          ← 前端
│   ├── src/api/
│   │   ├── client.js             ★重写：fetch + 拆信封 + 内置 mock 兜底
│   │   ├── rooms.js              ★重写：supabase 直连 → apiGet/apiPost/...
│   │   ├── students.js            ★重写
│   │   └── mockData.js            ★已删除（内容并入 client.js）
│   ├── src/pages/Workbench.jsx   ★只改一处：删房改成单次原子调用
│   ├── .env                      ★新增 VITE_API_BASE_URL，删掉 anon key
│   └── .env.example              ★重写
│
├── db/grant-write.sql            ★追加 Day 20 段（students / assignment_history 权限）
├── cloudbaserc.json              ★补 health 条目 + 两个接口的 ALLOWED_ORIGINS
└── docs/api-contract.md          （未改，语义保持一致）
```

**为什么每个函数目录都有一份 `cors.js` 副本？**
CloudBase 只打包函数自己的目录，跨目录 `require('../shared/cors.js')` 在云端拿不到。
改白名单时三处都要同步——这是平台限制带来的、必须记住的约束。

---

## 4. 接口清单（今天补齐的全部）

控制台的路径映射只配了 3 条（`/api/health`、`/api/rooms`、`/api/students`），
且Path passthrough = Disable（带 `/:id` 的路径传不进来）。
所以新增能力靠 **方法 + `action` 查询参数** 分流，不新增路径。

| 契约 | 实际调用 | 说明 |
|---|---|---|
| 2.1 | `GET /api/health` |健康检查 |
| 2.2 | `GET /api/students?action=camp&camp_id=1` | 营期信息 |
| 2.3 | `POST /api/students` | 学生报名 |
| 2.4 | `GET /api/students?camp_id=1` | 学生列表 |
| 2.5 | `GET /api/rooms?camp_id=1` | 房间列表 |
| 2.6 | `POST /api/rooms` | 新建房间 |
| 2.7 | `PATCH /api/rooms?id=&camp_id=` | 改房间（契约写的是 `/:id`） |
| 2.8 | `DELETE /api/rooms?id=&camp_id=` | 删房间（同上） |
| 2.9 | `PATCH /api/students?id=` | 单人分配（同上） |
| 2.10 | `POST /api/students?action=apply` | 批量分配 |
| 2.11 | `POST /api/students?action=history` | 存 AI 快照 |
| 2.12 | `GET /api/students?action=history` | 读最近快照 |

契约 2.7/2.8/2.9 原文写的是路径参数形式，这里是查询参数形式——
形态不同、语义一致，差异已在此表标注。

---

## 5. CORS 白名单

### 配置文件
`cloudbaserc.json` → `functions[].envVariables.ALLOWED_ORIGINS`（逗号分隔）

```
https://xinghe-helper-d5g92pis442fd9947.tcloudbaseapp.com   ← 静态托管（生产）
http://localhost:5173                                       ← vite dev（本地开发）
http://127.0.0.1:5173                                       ←同上
```

代码里 `cors.js` 也有一份 `DEFAULT_ORIGINS` 兜底，环境变量缺失时用默认值。

### 实测行为

| 请求 Origin |响应 | 浏览器能否读到 |
|---|---|---|
| `https://xinghe-helper-...tcloudbaseapp.com` | `access-control-allow-origin: <该域名>` | 能 |
| `http://localhost:5173` | `access-control-allow-origin: http://localhost:5173` | 能 |
| `https://evil.example.com` | **一个 CORS 头都不回** | 不能 |

「不回 CORS 头」而不是「回一个错误」是有意的：
浏览器看到没有 `Access-Control-Allow-Origin`，自己就会拦掉响应，
服务端不用替浏览器做判断，也不会泄露「这个接口存在」。

### 顺带修好的一件事

Day 20 之前 `health` 不返回 CORS 头。
前端加了「先探一次 `/api/health`」的逻辑之后，
页面在托管域名、接口在 `service` 域名，浏览器会把健康检查的响应拦掉——
于是页面永远显示「不在线」，而接口其实是好的。
今天给 `health` 也补上了白名单。

---

## 6. 环境变量与硬编码检查

### `web/.env`（本地，不进仓库）

```
VITE_API_BASE_URL=https://xinghe-helper-d5g92pis442fd9947.service.tcloudbase.com
VITE_CAMP_ID=1
```

### 检查结论

| 项 | 结论 |
|---|---|
| Supabase anon key |✅ 已从 `.env` 删除，不再进前端产物 |
| 数据库连接串 | ✅ 从来没进过前端 |
| `PG_SCHEMA` | ✅ 只在云函数环境变量里 |
| `ALLOWED_ORIGINS` | ✅ 只在云函数环境变量里 |
| API 地址 | 走 `VITE_API_BASE_URL`，代码里无硬编码 |
| `.env` 是否进仓库 | ✅ 已在 `.gitignore` |
| 构建产物里有无密钥 | ✅ 无（`dist/assets/index-*.js` 217KB / gzip 72KB） |

> 关于 `VITE_` 前缀：Vite 会把 `VITE_` 开头的变量打进前端产物。
> 所以这里**只能放公开的接口地址，不能放密钥**。
> 接口本身靠 CORS 白名单限制谁能调——这是本项目「谁能写库」的唯一防线，
> 而它的强度取决于第 5 节实测的那三行结果。

---

## 7. 逐项验证清单

### 7.1 已通过（20/20，本机实测）

**A. 健康检查**
- [x] `GET /api/health` → 200
- [x] 白名单 Origin → 带 `access-control-allow-origin`
- [x] 非法 Origin → 无 CORS 头

**B. 读接口**
- [x] `GET /api/rooms?camp_id=1` → 200，13 条真实房间
- [x] `GET /api/rooms`（缺参）→ 400 `MISSING_CAMP_ID`
- [x] `GET /api/students?camp_id=1` → 200，12 名真实学生
- [x] `GET /api/students?action=camp` → 「第一期口语拉练营」
- [x] `GET /api/students?action=history` → 返回已存在的历史快照

**C. 预检 OPTIONS**
- [x] 白名单 Origin → 204 + 完整 CORS 头
- [x] 非法 Origin → 204 但无 CORS 头（浏览器会拦）

**D. 校验层（不碰数据库就能拦住的）**
- [x] PATCH 缺 `id` → 400 `VALIDATION_ERROR`
- [x] PATCH 空 body → 400 `NOTHING_TO_UPDATE`
- [x] PATCH 非法 JSON → 400 `INVALID_JSON`
- [x] PATCH 不存在的房间 → 404 `ROOM_NOT_FOUND`
- [x] POST 房号重复 → 409 `ROOM_NO_DUPLICATED`
- [x] POST 缺字段 → 400 `VALIDATION_ERROR`
- [x] 学生老师不在枚举 → 400 `VALIDATION_ERROR`
- [x] 批量分配格式错 → 400 `VALIDATION_ERROR`
- [x] 快照格式错 → 400 `VALIDATION_ERROR`
- [x] DELETE 不存在的房间 → 404 `ROOM_NOT_FOUND`

**E. 写接口（rooms 表已有权限，实测通过）**
- [x] `PATCH /api/rooms` 改容量 4→5 → `{"ok":true}`
- [x] 改小容量导致超员 → 409 `ROOM_CAPACITY_CONFLICT`「房内现有 3 人,不能把容量改成 1」
- [x] 改成已存在的房号 → 409 `ROOM_NO_DUPLICATED`
- [x] 改不存在的房间 → 404 `ROOM_NOT_FOUND`

### 7.2 待权限开通后验证（students / assignment_history 写权限）

- [ ] `POST /api/students` 学生报名 → 返回 `{ id, updated:false }`
- [ ] 同名重复提交 → `{ updated:true }`，且工作台里该学生只出现一次
- [ ] `PATCH /api/students?id=` 单人分配
- [ ] `POST /api/students?action=apply` 批量分配 → `{ applied_count:N }`
- [ ] `POST /api/students?action=history` 存快照 → `{ id }`
- [ ] `DELETE /api/rooms` 删有人的房 → `{ unassigned_count:N }`

> 现在这6 项会被拦：`permission denied for table students`。
> 这是预期的——权限要手动开，见下节。

---

## 8. ⛔ 需要你手动做的一件事：开数据库写权限

### 为什么必须手动

`students` 表的 anon 写权限**目前只有 SELECT**，所以提交学生表单会被数据库拒绝。
这不是代码问题——读接口正常、写接口被拒，正是 Day 18 遇到过的同一件事，
契约第 1 节预留的那句「写接口若报权限错误，再按需补 GRANT」。

### 怎么跑

1. 打开 CloudBase 控制台 → 云开发 → 数据库 → **SQL 编辑器**
2. 确认左上角数据库是 `postgres-fnv0lCw`，schema 是 `public`
3. 执行：

```sql
grant insert, update on table public.students to anon;
grant select on table public.students to anon;
grant insert, select on table public.assignment_history to anon;
```

4. 验证：

```sql
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public'
  and table_name in ('rooms', 'students', 'assignment_history')
order by table_name, privilege_type;
```

预期 8 行：

| table_name | privilege_type |
|---|---|
| assignment_history | INSERT |
| assignment_history | SELECT |
| rooms | DELETE |
| rooms | INSERT |
| rooms | SELECT |
| rooms | UPDATE |
| students | INSERT |
| students | SELECT |
| students | UPDATE |

> 完整 SQL（含逐条说明、验证、回收语句）已在 `db/grant-write.sql` 的「Day 20 追加」段。

### ⚠️ 这次比Day 18 敏感，请认真读完

Day 18 给 `rooms` 开 anon 写，风险是「别人能塞垃圾房间」，影响有限。

**这次给 `students` 开 anon 写，风险完全不同：任何拿到接口链接的人，
都能往`students` 表塞假报名。**
如果将来这张表里是真实学生的姓名、性别、老师、入住日期，
那这不光是数据脏，而是**个人信息被公开写入、可被任意人读取**。

接入真实学生数据之前，必须做完这三件事：

1. 收回本段 GRANT（`db/grant-write.sql` 第 4 段有现成的 REVOKE）
2. 改成登录态校验：只有带合法 token 的请求才允许写
3. 表里只放示例数据，不放真实学生的个人信息

---

## 9. 同伴验证说明（发给对方的话）

> 麻烦帮我打开这个链接看一下：
>
> **https://xinghe-helper-d5g92pis442fd9947.tcloudbaseapp.com**
>
> 麻烦确认三件事：
>
> 1. **页面能正常打开**，能看到「分房工作台」
> 2. **能看到房间和学生名单**（不是空白页，也不是一片"加载中"）
>    —— 这些是真实数据库里的数据，不是假数据
> 3. **随便拖一个学生到某个房间**，松手后**刷新一下页面**，
>    看看这个分配还在不在
>
> 如果页面报错，麻烦按 F12 打开控制台，
> 把 Console 里**红色那几行**截图发我。

### 对方可能会遇到的情况

| 现象 | 原因 | 怎么办 |
|---|---|---|
| 页面空白 | 静态托管没更新 | 重新部署 |
|一直「加载中」 | 接口报错 | F12看 Console 红色行|
| CORS 报错 | 白名单没配这个域名 | 把域名加进 `ALLOWED_ORIGINS` |
| 数据是旧的 | 云函数没重新部署 | 重新部署三个云函数 |
| 拖拽保存失败 | 写权限没开 | 执行第 8 节的 GRANT |

### 自己验证时更快的方法

直接开浏览器控制台跑这两行，比点页面更快：

```js
// 1. 接口通不通
await (await fetch('https://xinghe-helper-d5g92pis442fd9947.service.tcloudbase.com/api/health')).json()

// 2. 数据是不是真的（不是 mock）
await (await fetch('https://xinghe-helper-d5g92pis442fd9947.service.tcloudbase.com/api/students?camp_id=1')).json()
```

---

## 10. 今天的卡点与解决（提前列的那几类）

### 卡点 1：health 部署一直卡住（13 分钟无输出）

**现象**：`tcb fn deploy health --force` 挂住不返回，换 `--deployMode zip` 也卡。
**根因**：`cloudbaserc.json` 的 `functions[]` 里**没有 `health` 的条目**。
前两个函数部署时 CLI 是「create」，所以成功；`health` 是已存在的旧函数，
CLI 在等一个不会完成的流程。
**解决**：往 `cloudbaserc.json` 补上 health 条目（含 runtime / handler / timeout），
再部署立刻成功（几秒）。
**教训**：部署卡住不一定是网络问题——**先看配置文件里有没有这个函数**。

### 卡点 2：跨域

**现象**：如果还留着 `'Access-Control-Allow-Origin': '*'`，浏览器其实不报错
（`*` 是允许的），但这是个安全洞。
**解决**：见第 5 节。关键是 `OPTIONS` 一定要单独回，
不能落进业务分支——否则浏览器会把它当成一次查数据，然后因为返回体格式不对而报错。

### 卡点 3：环境变量

**现象**：`.env` 改了但页面行为没变。
**原因**：Vite 只在**启动时**读 `.env`，改完必须重启 dev server。
**解决**：改完 `.env` 重启 `vite`，或者走重新构建。

### 卡点 4：构建报错

**现象**：`mockData.js` 删掉后如果还有别处import 它，就会报
`Failed to resolve import`。
**排查方式**：`grep -rn "mockData" src/`
**实际处理**：确认只有 `rooms.js` 引用，已一并改掉。构建通过（48 modules，5.15s）。

### 卡点 5：写权限

**现象**：`permission denied for table students`
**原因**：见第 8 节。
**注意**：这类报错**不是**CORS 问题，也**不是**代码问题——
读接口正常、写接口被拒，说明表上有 SELECT、缺 INSERT。
看到这句话就先去看 GRANT，不要怀疑刚改的前端。

---

## 11. 几个值得记住的设计决策

### ① 删房变成一个原子操作

契约 2.8 写的是「先把成员放回未分配，**再**删除房间，两步必须在一个函数里完成」。

前端原来是两个调用（`unassignStudentsOfRoom()` + `deleteRoom()`），
中间失败会留下「房还在但人被清空」或「房没了人还挂着」的半套数据。
现在后端一次做完，前端只调一次，返回里带 `unassigned_count` 告诉用户移走了几个人。

### ② 批量分配从前端的 N 次请求变成 1 次

以前一键分房要循环发几十次数据库写入。
现在一个HTTP 请求，云函数里循环处理完。
理由和①一样：中途失败会留下半套数据。

**⚠️ 但它仍然不是真事务**：逐条 update，中途失败会留下部分成功。
几十人规模可接受；要真事务得用 `rpc()` 写存储过程，留到需要时再做。

### ③ 校验规则必须和 schema 对齐

写 `submitStudent` 时我第一版把 `room_pref` 当文本、`teacher` 当可空，
结果和 `db/schema.sql` 完全对不上：
`room_pref` 是 `int not null check between 1 and 6`，
`teacher` 是 `not null` + CHECK 枚举。

**教训**：写校验前先读 schema。
在校验层用中文说清楚「带班老师只能是 Mona/Kiven/Selena/Betty/Priya」，
比让数据库抛一句英文的 `check violation` 对用户友好得多。

### ④ 前端导出的函数名一个都没改

`rooms.js` 里 `loadWorkbenchData`、`addRoom`、`updateRoom`、`deleteRoom`……
签名和导出名全部保持不变，所以 `Workbench.jsx` / `Overview.jsx` 一行都不用改
（除了删房那一处，因为语义从两步变一步了）。

**为什么重要**：接口换成公网的这一天，页面的diff 只有一处。
说明「数据层封装」这件事在 Day 8 就做到了。

---

## 12. 下一步

1. ⛔ **执行第 8 节的 GRANT**（否则学生提交功能一直不可用）
2. 跑完 7.2 的 6 项写路径验证
3. 重新构建并上传静态托管（同Day 15 流程）
4. 提交并推送今天的代码
5. 打卡截图：接口验证图 + 前端真实数据图