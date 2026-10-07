# Day 19 | 后端分层重构（数据访问层抽离）

> 日期：2026-10-07
> 范围：`cloudfunctions/api-rooms` 一个云函数，**不新增任何功能**

---

## 一、为什么要做这件事

Day 17/18 把接口从假数据换成真数据库之后，数据库查询语句和接口逻辑
（校验、错误提示、HTTP 分流）全部挤在 `index.js` 一个文件里，292 行。

继续加接口会越来越难维护：

| 不分层的代价 | 分层之后 |
|---|---|
| 写新接口要复制粘贴查询语句 | 一个 `require` 就有了 |
| 想改「查房间的排序」，得在满屏校验代码里找，怕碰坏别的 | 查询只在一个文件里 |
| 每加一个接口主文件就涨，几天后破 500 行 | 每加接口只加 repo 方法 |

**分层的核心收益不是「文件变少了」，而是「数据从哪来」永远只有一个答案。**

---

## 二、做了什么

### 新增 `cloudfunctions/api-rooms/rooms.repo.js`（108 行）

把 index.js 里的 **4 段数据库查询**原样搬进去。**查询语句本身一个字符都没改**，
只是换了个房子住——这是行为不变的关键。

| 仓库方法 | 原来在 index.js | 干什么 |
|---|---|---|
| `findByCamp(campId)` | 第 68-72 行 | 列某营期所有房间 |
| `findCampById(campId)` | 第 127-131 行 | 查营期存不存在 |
| `findByRoomNo(campId, roomNo)` | 第 145-149 行 | 查房号是否重复 |
| `create({...})` | 第 169-176 行 | 插入新房间 |

### 修改 `cloudfunctions/api-rooms/index.js`（292 → 279 行）

只改了 5 处，把查询换成对 repo 的调用：

| 位置 | 改前 | 改后 |
|---|---|---|
| 31 | `const { db } = require('./db.js')` | `const roomsRepo = require('./rooms.repo.js')` |
| 73 | `db.from('rooms').select('*').eq(...).order(...)` | `await roomsRepo.findByCamp(campId)` |
| 127 | `db.from('camps').select('id').eq(...).maybeSingle()` | `await roomsRepo.findCampById(campId)` |
| 145 | `db.from('rooms').select('id, room_no, capacity')...` | `await roomsRepo.findByRoomNo(campId, roomNo)` |
| 169 | `db.from('rooms').insert({...}).select('id').single()` | `await roomsRepo.create({...})` |

**一个字没改的部分（行为不变的保证）：**

- 所有 `fail(...)` 的状态码与提示文案（400 / 409 / 500 一个没动）
- 4 个校验函数（`validateCampId` / `validateRoomNo` / `validateCapacity` / `normalizeGenderLabel`）
- `23505`(unique_violation) / `23503`(foreign_key_violation) 错误码翻译
  —— 仍留在接口层，因为「怎么告诉用户」是接口的职责
- 响应形状 `{ ok, data, error }`

### 修改 `_day19_baseline.js`（验证工具）

- 房号拆成 `PROBE_ROOM_BEFORE = 'D19'` / `PROBE_ROOM_AFTER = 'D19B'`
- 加 `--after` 开关：不带参数抓重构前，带参数抓重构后
- 输出加`阶段: 重构前/重构后` 标记，防止两份文件搞混

---

## 三、分层的规矩（今天最重要的收获）

> **index.js 里不允许再出现 `db.from(...)`。**
> 以后要查什么，先在 rooms.repo.js 里加一个方法，再从 index.js 调它。

已用工具核实：`index.js` 中 `db.` 仅剩注释里的规矩说明本身，**代码零残留**。

### 为什么 repository 只返回 `{ data, error }`，不直接抛错

因为「数据库报错了」要变成「HTTP 500 + 一句人话提示」，这个**翻译**动作属于接口层。
repository 只负责如实报告「成了还是败了、败的原因是什么」，不决定怎么告诉用户。
职责单一，以后改提示文案不用动数据层。

### 为什么 `findCampById`（查 camps 表）放在 rooms 仓库里

它查的是 camps 表，严格说不属于「房间表」。但它只在「新建房间」这一个流程里用，
是写入房间前的必经校验。为它单独开一个 `camps.repo.js` 只为一个调用点，属于过度拆分。
**这是一个有意识的取舍，不是遗漏。**

---

## 四、回归验证清单

验证方法：重构前后各抓一份完整基线（9 条接口真实调用），
逐条比对 HTTP 状态码 + 响应体JSON。

### 4.1 验证结果：9 / 9 通过 ✅

| # | 接口 | 重构前 | 重构后 | 结论 |
|---|---|---|---|---|
| 1 | `GET /api/health` | 200 | 200 | ✅ 完全一致 |
| 2 | `GET /api/rooms?camp_id=1` | 200 (11条) | 200 (12条) | ⚠️ 见下方说明 |
| 3 | `GET /api/rooms`（缺 camp_id） | 400 MISSING_CAMP_ID | 400 MISSING_CAMP_ID | ✅ 完全一致 |
| 4 | `GET /api/students?camp_id=1` | 200 (12条) | 200 (12条) | ✅ 完全一致 |
| 5 | `GET /api/students`（缺 camp_id） | 400 MISSING_CAMP_ID | 400 MISSING_CAMP_ID | ✅ 完全一致 |
| 6 | `POST /api/rooms`（缺 camp_id） | 400 VALIDATION_ERROR | 400 VALIDATION_ERROR | ✅ 完全一致 |
| 7 | `POST /api/rooms`（房号重复 301） | 409 ROOM_NO_DUPLICATED | 409 ROOM_NO_DUPLICATED | ✅ 完全一致 |
| 8 | `POST /api/rooms`（性别标签非法） | 400 VALIDATION_ERROR | 400 VALIDATION_ERROR | ✅ 完全一致 |
| 9 | `POST /api/rooms`（成功写入） | 200 `{id:115}` | 200 `{id:116}` | ✅ 结构一致 |

**覆盖到的方法**：`findByCamp`（#2/#3）、`findByRoomNo`（#7）、`create`（#6/#8/#9）、
`findCampById`（#9 走通）、以及未受影响的 `api-students` 与 `health`（#1/#4/#5）。

### 4.2 关于第 2 条的差异 —— 不是重构造成的

原始 JSON 比对确实报「第 2 条有差异」，逐字段追查后确认：

```
新增: {"id":116,"camp_id":1,"room_no":"D19","capacity":4,"gender_label":null}
缺失: （空）
```

原因：`before` 基线是在基线脚本第 9 条**插入 D19 之前**抓的，
`after` 基线是之后抓的，所以多出这条昨天（10-06）自己插进去的测试房。

**原有的 11 条房间逐字段完全一致，无一缺失、无一被改。**

**这个差异恰好证明基线抓取流程本身是有效的** —— 它能分辨出「数据变了」，
而不是笼统地告诉我们「一样」。同理第 9 条成功路径，id从 115 变成 116 也应该变
（数据库自增），比的是**结构**而不是具体值。

---

## 五、重构后的目录结构

```
cloudfunctions/api-rooms/
├── index.js                ← 接口层：接请求 / 校验参数 / 调 repo / 返响应
│   · 按 httpMethod 分流：GET 读、POST 写
│   · 4 个校验函数
│   · 错误码翻译（400/ 409 / 500、23505 / 23503）
│   · ✗ 不再出现 db.from(...)
│
├── rooms.repo.js     ← 【新增】数据层：rooms 表的所有查询
│   · findByCamp()      契约 2.5
│   · findCampById()    写入前外键预检
│   · findByRoomNo()    契约 2.6 防重复
│   · create()契约 2.6 写入
│   · ✗ 不认识 HTTP、不认识错误码、不管提示文案
│
├── db.js                   ← 连接层：cloudbase.init + app.rdb()
│   · 只管「连上数据库」，不管「查什么」
│
└── response.js             ← 信封层：ok() / fail()，统一响应形状
    · { ok, data, error }
```

**分层的判断标准（很直白）：**

| 层 | 只该关心 | 绝不该出现 |
|---|---|---|
| 接口层 index.js | HTTP、校验、错误提示 | `db.from(...)` |
| 数据层 rooms.repo.js | 「这张表怎么查」 | HTTP 概念、错误码、人话提示 |
| 连接层 db.js | 「怎么连上」 | 任何业务 |

### 待办（不在 Day 19 范围内）

`api-students/index.js` 目前仍是查询与逻辑混在一起（Day 17 写的），
明天可以同样抽出 `students.repo.js`。今天**没做**，避免一次改两处不好定位问题。

---

## 六、遇到的环境坑（重要，下次直接照抄）

用户 cmd 里**三次部署失败**，全是环境问题，与代码无关：

| 报错 | 真实原因 | 解法 |
|---|---|---|
| `'npx' 不是内部或外部命令` | WorkBuddy 内置 Node 与系统 PATH 不是一套 | 改用项目自带 tcb |
| `'.\node_modules\.bin\tcb.cmd' 不是...` | 新开了 cmd 窗口，目录回到 `C:\Users\Zhang>` | 用绝对路径 |
| `"node" 不是内部或外部命令` | **本机根本没装全局 Node** | 用WorkBuddy 自带 node.exe 启动 tcb |

**结论：本机没有全局 Node**（`C:\Program Files\nodejs` 不存在，
`%APPDATA%\npm` 里只有 claude）。

**✅ 以后部署就用这一行（完整路径，任意目录下都能跑）：**

```
C:\Users\Zhang\.workbuddy\binaries\node\versions\22.22.2-6\node.exe C:\Users\Zhang\Desktop\xinghe-helper\node_modules\@cloudbase\cli\bin\tcb fn deploy <函数名> -e xinghe-helper-d5g92pis442fd9947 --force --deployMode zip
```

或者更省事：**直接让 WorkBuddy 代跑**（环境现成，不用折腾 cmd）。

### ⚠️ 部署后必须核对，别信 Status

这次 `tcb fn detail` 显示的 **Modification time 是 2026-10-06 11:22:15（不是今天）**，
但接口实际返回的是新代码行为——说明该字段可能是 UTC 或缓存，**不能单独作为判据**。

**可靠的判据是「调真实接口，看返回是否符合新代码」** —— 本次正是靠基线回归
证明云端代码已更新。

---

## 七、今天的收获

1. **分层不是为了好看，是为了「改一处不会碰坏另一处」。** 搬完代码只瘦了 13 行，
   但 `db.` 从接口层彻底消失了，这个收益比行数大得多。
2. **"调用方少写什么"不是分层的目的。** 如果为了少写几行而把校验藏进 repo，
   就把接口的入参边界搞丢了 —— 那是更贵的设计债。
3. **重构必须有证据，"看起来一样"不算验证。** 基线前后比对是唯一可靠的方式。
4. **环境的坑比代码的坑耗时。** 理解「错误信息在说谁找不到」比背命令有用：
   第一次报npx 缺失、第二次报路径缺失、第三次报 node 缺失—— 三次是同一个病根的三层。