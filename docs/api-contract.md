# api-contract.md — xinghe-helper 前后端接口契约

> **状态：Day 15 登记接口 · Day 16 数据表建成 · Day 17 读接口已实现（2.4 / 2.5 ✅）· Day 18 首个写接口已实现（2.6 ✅）· Day 20 改删接口已实现（2.7 / 2.8 ✅）· Day 22 闭环验证通过（2.7 / 2.8 ✅✅）**
> 来源：从 `web/src/api/`（students.js / rooms.js / client.js / mockData.js）的现有调用推导，字段名与数据库表完全一致。
> 后端形态：CloudBase 云函数 + HTTP 访问路径，函数内用 `@cloudbase/node-sdk` 的 `app.rdb()` 读 PG
> （**注意**：不是连接串直连——本环境为体验版共享集群，直连通道被套餐限制，详见第 4 节）。

## 0. 通用约定

- **Base URL**：`https://xinghe-helper-d5g92pis442fd9947.service.tcloudbase.com`
- **请求格式**：`POST` / `PATCH` / `PUT` 的 body 一律为 `application/json`
- **响应信封（Day 17 起统一）**：所有接口的 body 一律是这个形状，前端只需一套解析逻辑：

```json
{
  "ok": true,
  "data": "<成功时是业务数据；失败时为 null>",
  "error": null
}
```

  失败时：

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "ROOM_NOT_FOUND",
    "message": "房间不存在或已被删除"
  }
}
```

  - `ok`：布尔，前端据此分流——`true` 读 `data`，`false` 读 `error.message` 展示给人看
  - `data`：成功时的业务数据（对象或数组）
  - `error`：`{ code, message }`；`code` 给程序判断用，`message` 是给人看的中文文案

- **常用 HTTP 状态码**：`200` 成功 · `400` 参数错误 · `404` 资源不存在 · `409` 业务冲突（如房间已满）· `500` 服务器内部错误
- **跨域**：云函数响应头已带 `Access-Control-Allow-Origin: *`（Day 17 起），前端可直接跨域调用


## 1. 涉及的数据表（✅ Day 16 已在 CloudBase 建成并验证）

> **建表脚本**：`db/schema.sql`（可重复执行：先删后建）· **示例数据**：`db/seed.sql`（1 营期 + 4 房 + 12 生 + 1 条 AI 快照，可重复执行）
> 数据库：CloudBase PostgreSQL（schema = `public`），已于 Day 16 执行完毕，select 验证通过（camps=1 / rooms=4 / students=12 / assignment_history=1）。
> ✅ **权限现状（Day 17 核实）**：表上已有 `anon`（SELECT）与 `authenticated`（增删改查）的角色授权，
> 读接口通过 `app.rdb()` 平台网关走 `anon` 身份 **可以正常读到数据**，无需额外配 GRANT。
> 写接口若报权限错误，再按需补 `GRANT`（届时处理）。

### 1.1 camps —— 营期

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | bigserial PK | |
| `name` | varchar(100) | NOT NULL |
| `org_name` | varchar(100) | 可空 |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |

### 1.2 rooms —— 房间

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | bigserial PK | |
| `camp_id` | bigint | NOT NULL，FK → camps(id) |
| `room_no` | varchar(20) | NOT NULL；**同营期内唯一** `unique(camp_id, room_no)`（对应 2.6 的 409） |
| `capacity` | int | NOT NULL，CHECK `capacity > 0` |
| `gender_label` | varchar(2) | 可空；非空时 CHECK `in ('男','女')` |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |

### 1.3 students —— 学生报名（一条记录 = 一次提交）

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | bigserial PK | |
| `camp_id` | bigint | NOT NULL，FK → camps(id) |
| `name` | varchar(50) | NOT NULL |
| `gender` | varchar(2) | NOT NULL，CHECK `in ('男','女')` |
| `teacher` | varchar(20) | NOT NULL，CHECK `in ('Mona','Kiven','Selena','Betty','Priya')` |
| `class_level` | varchar(10) | NOT NULL，CHECK `in ('星一','星二','星三')` |
| `check_in_date` | date | NOT NULL（信息性字段，不参与分房约束） |
| `room_pref` | int | NOT NULL，CHECK `between 1 and 6` |
| `snore` | boolean | 可空 |
| `sleep_quality` | varchar(10) | 可空，CHECK `in ('好','一般','差')` |
| `note` | text | 可空 |
| `is_latest` | boolean | NOT NULL DEFAULT true |
| `superseded_by` | bigint | 可空，FK → students(id)，CHECK 不能指向自己 |
| `assigned_room_id` | bigint | 可空，FK → rooms(id)，NULL = 未分配 |
| `assign_status` | varchar(10) | NOT NULL DEFAULT '未分配'，CHECK `in ('未分配','已分配')` |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |

**关键自洽约束**：`assigned_room_id` 为空 ⟺ `assign_status = '未分配'`（数据库层面强制，杜绝"挂着房间却显示未分配"的脏数据）。

**索引**：`(camp_id, is_latest, id)` 工作台主查询 · `(camp_id, gender) where assigned_room_id is null` 未分配名单 · `(assigned_room_id)` 按房查成员。

### 1.4 assignment_history —— 分房快照

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | bigserial PK | |
| `camp_id` | bigint | NOT NULL，FK → camps(id) |
| `run_type` | varchar(10) | NOT NULL，CHECK `in ('ai','manual')` |
| `snapshot` | jsonb | NOT NULL |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |

**索引**：`(camp_id, run_type, created_at desc)` 取最近一次快照（对应 2.12）。

---

## 2. 接口清单

### 2.1 GET /api/health —— 健康检查 ✅ 已上线

- **方法**：`GET`，无参数
- **响应**：`{ "ok": true, "service": "xinghe-helper" }`
- **用途**：部署验证、排查"网络通不通"

### 2.2 GET /api/camp —— 读取当前营期信息

- **对应前端**：`students.js → fetchCampName()`（表单页顶部展示营期名 / 机构名）
- **方法**：`GET`
- **请求参数**：无（MVP 固定读 `camp_id = 1`）
- **响应**：

```json
{ "id": 1, "name": "口语营", "org_name": "某某机构" }
```

- **错误**：`404 CAMP_NOT_FOUND`（营期不存在）→ 前端隐藏营期标题，不影响填表

### 2.3 POST /api/students —— 学生提交报名

- **对应前端**：`students.js → submitStudent(form)`（表单页提交）
- **方法**：`POST`
- **请求 body**：

```json
{
  "camp_id": 1,
  "name": "沈知意",
  "gender": "女",
  "teacher": "Priya",
  "class_level": "星一",
  "check_in_date": "2027-01-20",
  "room_pref": 3,
  "snore": false,
  "sleep_quality": "好",
  "note": "认床,怕吵"
}
```

- **后端必须完成的逻辑**（原浏览器端逻辑移到后端，保证原子性）：
  1. 插入新记录，`is_latest = true`
  2. 把**同营期 + 同姓名**的旧记录标记 `is_latest = false`、`superseded_by = 新记录id`（保留痕迹，不物理删除）
- **响应**：

```json
{ "id": 13, "updated": false }
```

  `updated = true` 表示该姓名此前已有记录、本次是"更新"（确认页据此显示"已更新"而非"已收到"）
- **错误**：`400 VALIDATION_ERROR`（必填字段缺失/格式错误）

### 2.4 GET /api/students —— 学生列表读取 ✅ 已实现（Day 17）

- **对应前端**：`rooms.js → loadWorkbenchData()`（工作台、总览页渲染）
- **云函数**：`cloudfunctions/api-students/`
- **方法**：`GET`
- **Query 参数**：`camp_id`（必填，MVP 恒为 1）
- **后端过滤**：只返回 `is_latest = true` 的记录，按 `id` 升序
- **响应**：`{ ok, data, error }`，`data` 是学生对象数组（字段见第 1 节 `students` 表）

```json
{
  "ok": true,
  "data": [
    { "id": 1, "camp_id": 1, "name": "林小满", "gender": "女", "assigned_room_id": 101, "assign_status": "已分配", "…": "…" }
  ],
  "error": null
}
```

- **错误**：`400 MISSING_CAMP_ID`（`camp_id` 缺失或非正整数）· `500 DB_ERROR`（数据库查询失败）

### 2.5 GET /api/rooms —— 房间列表读取 ✅ 已实现（Day 17）

- **对应前端**：`rooms.js → loadWorkbenchData()`
- **云函数**：`cloudfunctions/api-rooms/`
- **方法**：`GET`
- **Query 参数**：`camp_id`（必填）
- **排序**：按 `room_no` 升序
- **响应**：`{ ok, data, error }`，`data` 是房间对象数组（字段见第 1 节 `rooms` 表）

```json
{
  "ok": true,
  "data": [
    { "id": 101, "camp_id": 1, "room_no": "301", "capacity": 4, "gender_label": "女", "created_at": "…" }
  ],
  "error": null
}
```

- **错误**：`400 MISSING_CAMP_ID`（`camp_id` 缺失或非正整数）· `500 DB_ERROR`（数据库查询失败）

### 2.6 POST /api/rooms —— 新建房间 ✅ 已实现（Day 18）

- **对应前端**：`rooms.js → addRoom(roomNo, capacity)`
- **云函数**：`cloudfunctions/api-rooms/`（与 2.5 **同一个函数**，按 `event.httpMethod` 分流）
- **方法**：`POST`
- **请求 body**：`{ "camp_id": 1, "room_no": "305", "capacity": 4 }`
  - `gender_label` 可选，传了只能是 `"男"` / `"女"`，不传 = 尚未指定（存 `null`）
- **后端逻辑**：先查 `(camp_id, room_no)` 是否已存在 → 重复则 **409拒绝**（不覆盖已有数据）；同时校验 `camp_id` 对应的营期是否存在，不存在直接 400，避免撞外键报英文错
- **响应**：`{ ok, data, error }`，`data` 为 `{ "id": 105 }`（新房间 id）

  ```json
  { "ok": true, "data": { "id": 105 }, "error": null }
  ```

- **防重复约定**：契约第1.2 节 `rooms` 表上有 `unique (camp_id, room_no)`，因此「同营期同房号」为**拒绝（409）**语义而非覆盖。房号是房间的物理身份，重复意味着可能已有学生入住，不能悄悄覆盖。
  - 兜底：并发场景（两人同时点新建）即使前置查重漏过，插入撞`unique` 违约（SQLSTATE `23505`）也会翻译成同一个 409；`23503`（外键违约）翻译成 `400 CAMP_NOT_FOUND`
- **错误**：
  - `400 VALIDATION_ERROR` —— 逐字段校验，中文提示讲清缺什么：`camp_id` 必填正整数 · `room_no` 必填、trim 后非空、≤20 字符 · `capacity` 必填正整数 · `gender_label` 非空时须为 男/女
  - `400 CAMP_NOT_FOUND` —— 营期不存在
  - `400 INVALID_JSON` —— 请求体不是合法 JSON
  - `409 ROOM_NO_DUPLICATED` —— 同营期下房号重复
  - `500 DB_ERROR` / `500 INTERNAL_ERROR`

### 2.7 PATCH /api/rooms —— 修改房间 ✅ 已实现（Day 20 实现 · Day 22 闭环验证）

- **对应前端**：`rooms.js → updateRoom(roomId, patch)`
- **云函数**：`cloudfunctions/api-rooms/`（与 2.5 / 2.6 / 2.8 **同一个函数**，按 `event.httpMethod` 分流）
- **实际调用形态**：`PATCH /api/rooms?id=&camp_id=`

  > ⚠️ **与本文档最初登记的差异**：原文写的是 `PATCH /api/rooms/:id`（路径参数）。
  > 实际实现改用查询参数，原因是 CloudBase 控制台的「HTTP 路径 → 云函数」映射
  > 只配了 3 条且 **Path passthrough = Disable**，`/:id` 传不进函数。
  > **形态不同、语义一致**，已在Day 20 文档中补注。
- **Query 参数**：`id`（房间 id，必填）· `camp_id`（所属营期，必填）
  - **为什么 `id` 和 `camp_id` 都要**：只凭 `id` 定位的话，操作 A 营期的人就能改到 B 营期的房。带上营期 = 只能动「本次打开的那个营期」里的房。
- **请求 body**（只传要改的字段，patch 语义）：
  `{"room_no":"305"}` · `{"capacity":6}` · `{"gender_label":"女"}`
  - **可改字段仅三个**：`room_no` / `capacity` / `gender_label`（对齐 `rooms` 表实际存在的列）
  - 未传的字段**不进 UPDATE 语句**，原值保持不变（与 PUT 的区别）
- **响应**：`{ ok, data, error }`，`data` 为改后的房间对象
  ```json
  { "ok": true, "data": { "id": 123, "room_no": "999", "capacity": 6, "gender_label": null }, "error": null }
  ```
- **Day 22 实测结论**：
  | 验证项 | 结果 |
  |---|---|
  | 改容量 `4 → 6` | ✅ 接口返回、GET 回读、数据库 select 三处一致 |
  | 未传字段是否被保留 | ✅ `room_no=999`、`gender_label=null` 均原样保留 |
  | `created_at` 是否变化 | ✅ **未变**（08:12:55）⇒ 证明是 UPDATE 而非「删旧建新」 |
- **错误**：
  - `400 VALIDATION_ERROR` —— 逐字段校验，中文提示讲清缺什么：`id` / `camp_id` 必填正整数 · `room_no` trim 后非空且 ≤20 字符 · `capacity` 正整数 · `gender_label` 非空时须为 男/女
  - `400 NOTHING_TO_UPDATE` —— 一个字段都没传（如 `{}`）
  - `400 INVALID_JSON` —— 请求体不是合法 JSON
  - `404 ROOM_NOT_FOUND` —— `id` 不存在（含格式合法的正整数但查无此房）
  - `409 ROOM_NO_DUPLICATED` —— 改房号时与同营期其他房间冲突
  - `409 ROOM_CAPACITY_CONFLICT` —— 改小容量导致现有人数超员（会告诉用户当前住了几人）
  - `500 DB_ERROR` / `500 INTERNAL_ERROR`

### 2.8 DELETE /api/rooms —— 删除房间 ✅ 已实现（Day 20 实现 · Day 22 闭环验证）

- **对应前端**：`rooms.js → deleteRoom(roomId)`（`unassignStudentsOfRoom()` 已废弃，见下）
- **实际调用形态**：`DELETE /api/rooms?id=&camp_id=`（路径参数差异同2.7）
- **Query 参数**：`id`（必填）· `camp_id`（必填）
- **后端逻辑（契约硬性要求，两步必须在一个函数内完成）**：
  1. 先把该房间内所有学生置为 `assigned_room_id = null, assign_status = '未分配'`
  2. 再删除房间这一行
  3. 返回被放回未分配的人数 `unassigned_count`

  > **为什么不能拆成前端两次调用**：若由前端先调「批量取消分配」再调「删房」，
  > 中间断网或关页面，会留下「房还在、人已被清空」或「房没了、人还挂在不存在的房号上」的半套数据。
  > 放在一个云函数里一次完成，要么都成功，要么都不做。
- **响应**：
  ```json
  { "ok": true, "data": { "id": 123, "unassigned_count": 2 }, "error": null }
  ```
  - **`unassigned_count` 是本接口最重要的字段**：它告诉调用方「删这间房连带把 N 个人放回了未分配」。
    这个数字在页面上看不到，只有接口返回里有——也是前端二次确认要提前告知用户的内容。
- **Day 22 实测结论**：
  | 验证项 | 结果 |
  |---|---|
  | 删除住着 2 人的房 | ✅ `unassigned_count: 2` |
  | DELETE 后 GET 是否还返回它 | ✅ **不再返回**（房间总数 12 → 11） |
  | 成员是否自动回未分配 | ✅ 郑楚(id=10)、沈知意(id=12) 均 `assigned_room_id=NULL` / `未分配` |
  | 是否产生孤儿学生 | ✅ **0 人**（无人挂在不存在的房上） |
  | 学生总数是否变 | ✅ 14 → 14（**删房不删人**，一人不少） |
- **前端二次确认**（Day 20 已实现，Day 22 复核）：
  `Workbench.jsx → handleDeleteRoom()` 用 `window.confirm` 拦一道，
  且**提示文案会带出连带影响人数**：「里面的 N 人会回到未分配名单」，
  人数为 0 时不显示这句。后端保证原子性，前端保证用户不点错——两者职责不同，缺一不可。
- **错误**：
  - `400 VALIDATION_ERROR` —— `id` / `camp_id` 缺失或非正整数
  - `404 ROOM_NOT_FOUND` —— `id` 不存在
  - `500 DB_ERROR` / `500 INTERNAL_ERROR`
- **完整验证证据**：`docs/Day22-接口验证.html`（?only=patch / ?only=delete 可单节查看）
  ·截图 `docs/screenshots/Day22-PATCH前后对比.png`、`Day22-DELETE后GET不再返回.png`

### 2.9 PATCH /api/students —— 单个学生分配 / 取消分配

- **对应前端**：`rooms.js → setStudentRoom(studentId, roomId)`（拖拽即时保存）
- **实际调用形态**：`PATCH /api/students?id=`（路径参数差异同 2.7）
- **Query 参数**：`id`（学生 id，必填）
- **方法**：`PATCH`
- **请求 body**：

```json
{ "room_id": 101 }
```

  取消分配传 `{ "room_id": null }`
- **后端逻辑**：更新该学生的 `assigned_room_id` 与 `assign_status`（`roomId 非空 → '已分配'，null → '未分配'`）
- **响应**：`{ "ok": true }`
- **错误**：`404 STUDENT_NOT_FOUND` · `404 ROOM_NOT_FOUND`（room_id 非空但查无此房）· `409 ROOM_FULL`（房间人数已达 capacity）

### 2.10 POST /api/assignments/apply —— 批量应用分配方案

- **对应前端**：`rooms.js → applyAssignments(assignments, clearStudentIds)`（AI 一键分房 / 恢复快照共用）
- **方法**：`POST`
- **请求 body**：

```json
{
  "camp_id": 1,
  "assignments": [
    { "student_id": 10, "room_id": 102 },
    { "student_id": 11, "room_id": 102 }
  ],
  "clear_student_ids": [12]
}
```

- **后端逻辑**：
  1. `clear_student_ids` 中**不在** `assignments` 名单里的学生 → 置回未分配
  2. `assignments` 逐条写入 `assigned_room_id` + `assign_status = '已分配'`
  3. 全部在一个函数内完成（部分失败时返回明确报错，不留半套状态）
- **响应**：`{ "ok": true, "assigned_count": 2, "cleared_count": 1 }`
- **错误**：`400 VALIDATION_ERROR` · `409 ROOM_FULL`

### 2.11 POST /api/assignments/history —— 保存 AI 方案快照

- **对应前端**：`rooms.js → saveHistorySnapshot(snapshot)`
- **方法**：`POST`
- **请求 body**：`{ "camp_id": 1, "run_type": "ai", "snapshot": { …完整分配方案, jsonb… } }`
- **响应**：`{ "id": 7 }`
- **错误**：`400 VALIDATION_ERROR`（snapshot 缺失）

### 2.12 GET /api/assignments/history/latest —— 读取最近一次 AI 快照

- **对应前端**：`rooms.js → latestAiSnapshot()`（"恢复 AI 方案"按钮）
- **方法**：`GET`
- **Query 参数**：`camp_id`（必填）
- **响应**（无历史时返回 `null`，不算错误）：

```json
{ "snapshot": { "…": "…" }, "created_at": "2026-10-03T12:00:00Z" }
```

- **错误**：`400 MISSING_CAMP_ID`

---

## 3. 实现顺序建议（第 3 周）

1. ~~建表~~ ✅ **已完成（Day 16）**：`db/schema.sql` + `db/seed.sql` 已在 CloudBase 执行并验证
2. 先做**读**接口：~~2.4 / 2.5~~ ✅ **已完成（Day 17）** → 2.2（表单页）
3. 再做**写**接口：~~2.6~~ ✅ **已完成（Day 18）** → 2.9 → ~~2.7 / 2.8~~ ✅ **已完成（Day 20）** → 2.3 → 2.10 → 2.11 / 2.12
   - **路由约定**：同一资源路径的读写放在**同一个云函数**里，按 `event.httpMethod` 分流
     （如 2.5 GET 与 2.6 POST 都在 `api-rooms/`）。因为「HTTP 路径 → 函数」的映射在控制台配，
     同路径挂两个函数按方法分发并不确定，放一个函数里最稳，也不用动控制台。
   - **形态约定（Day 20 起）**：控制台 Path passthrough = Disable，`/:id` 传不进函数，
     所以 2.7 / 2.8 / 2.9 一律改用**查询参数**传 id（`?id=&camp_id=`）。语义与原契约一致。
4. 每接好一个，就把前端 `api/` 里对应函数从 Supabase 调用换成 `fetch(Base URL + 路径)`
   - ⚠️ 注意响应形状已变：前端要按 `{ ok, data, error }` 解析，例如
     `const { ok, data, error } = await res.json()`，而不是直接拿到数组。

### 3.1 改 / 删 / 查的闭环验证（Day 22）

2.7 / 2.8 在 Day 20 各自测通，Day 22 补做了**闭环验证**——
把增、改、查、删串成一条链，验证的不是「每个接口都返回 ok」，而是：

| 环节 | 验证内容 | 实测 |
|---|---|---|
| 改完再查 | GET 读到的是**新值**，不是旧值缓存 | capacity `4 → 6` 三处一致 |
| 删完再查 | GET **不再返回**该条| 房间 12 → 11，999 消失 |
| 删房的连带影响 | 房内成员自动回未分配，无孤儿 | `unassigned_count: 2`，孤儿 0 人 |
| 不存在的 id | 返回中文错误说明而非英文报错 | 404 +「房间不存在(id=9999…)」 |

证据：`docs/Day22-接口验证.html` · `docs/screenshots/Day22-*.png`

> **为什么闭环比逐个测试重要**：逐个测试只能证明「每个按钮按下去没报错」。
> 闭环证明的是「改完再查，查到的是新值；删完再查，查不到了」——
> 后者才能排除掉「接口返回 ok:true 但数据没真正落库」这类假成功。


## 4. 跨域与数据库连接方式（Day 17 已定案）

### 4.1 跨域 ✅ 已解决

前端部署在 `*.tcloudbaseapp.com`，云函数在 `*.service.tcloudbase.com`，域名不同会被浏览器拦截。
**做法**：云函数响应头已统一加 `Access-Control-Allow-Origin: *`（在 `response.js` 里，所有接口共用）。

### 4.2 数据库连接方式 ⚠️ 不是直连，而是 SDK 网关

**结论：云函数用 `@cloudbase/node-sdk` 的 `app.rdb()` 访问 PG，不使用连接串直连。**

原因（体验版 + 共享型集群的套餐限制，两条直连路都堵死）：

| 直连路径 | 状态 | 原因 |
|---|---|---|
| 内网地址（VPC 内网互联） | ❌ 不可用 | 体验版不支持内网互联；控制台「内网地址」显示为空 |
| 外网地址（公网直连） | ❌ 不可用 | 开启后必须配安全组，而安全组仅独享集群支持，共享集群无此功能 |

`app.rdb()` 走平台内部网关（`/v1/rdb/rest`），**不需要连接串、账号密码、安全组或 VPC**，是官方在体验版下的推荐路径。

**两个必须记住的实现细节**（写在 `cloudfunctions/*/db.js` 注释里）：

1. `rdb()` 的 `database` 参数实际被塞进 `Accept-Profile` / `Content-Profile` 请求头——
   在 PostgREST 体系里这两个头指的是 **schema 名**，不是数据库名。
   我们的表建在 `public` schema 下，所以要传 `public`。
   （若不传，SDK 会默认用环境 ID 当 schema，报 `Invalid schema: xinghe-helper-...`）
2. 必须让云端装依赖（`installDependency: true`，已写进 `cloudbaserc.json`）。
   若用 `--install-dependency false`，本地 `node_modules` 不会被正确打包，函数会直接崩溃
   （报 `0 code exit unexpected`）。

### 4.3 部署命令：必须加 `--deployMode zip` ⚠️ Day 18 踩过的坑

**症状**：Day 18 执行 `tcb fn deploy api-rooms` 后命令卡住十几分钟无输出，
被中断后**云端代码其实没更新**——`tcb fn detail` 显示 Modification time 还是昨天，
函数注释仍是旧版本，但 `Status` 却显示 `Deployment completed`。

**根因**：默认的上传方式要把本地 `node_modules`（约 24MB）打包走网络上传，
在这个网络环境下极慢甚至卡死。**注意**：`.gitignore` 里忽略了 `node_modules`，
所以云端代码**只能**来自本地打包上传——这意味着"本地改好了"不等于"云端更新了"。

**正确命令**：

```bash
tcb fn deploy api-rooms -e <envId> --force --deployMode zip
```

加上 `--deployMode zip` 后**34 秒**部署完成。`--force` 用于覆盖已存在的函数。

> ⚠️ **每次部署后必须核对云端代码是否真的更新了**，别信 `Status` 字段：
>
> ```bash
> tcb fn detail api-rooms -e <envId> | grep -iE "Modification time|Day 18"
> ```
>
> 看到当天的日期 + 新代码的注释头，才算部署成功。
> 否则会出现"改了没生效、接口返回旧逻辑"的情况，白排查很久。

### 4.4 写接口的权限：anon 只有读权限 ⚠️ Day 18踩过的坑

**症状**：POST 写入报
`{"code":"DB_ERROR","message":"新建房间失败:permission denied for table rooms"}`
（HTTP 500），但 GET 读取完全正常。

**根因**：云函数走 `app.rdb()` 访问数据库时用的是 **anon（匿名访客）身份**。
Day 16 建表时只给 anon 开了 `SELECT`，够读接口用，但写接口需要 `INSERT/UPDATE/DELETE`。

**解决**：控制台 → 数据库 → SQL 编辑器，执行 `db/grant-write.sql`。
脚本里写清了要跑哪几段、为什么、以及每条权限对应契约里的哪个接口。

> 🔐 **安全提醒**：给 anon 写权限 = 任何拿到链接的人都能往表里加数据。
> 当前是体验版 + 示例数据，可接受；**但接入真实学生数据前必须先加登录态校验**，
> 并把写权限收回去。详见 `db/grant-write.sql` 顶部的注释。

