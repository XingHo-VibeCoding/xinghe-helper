# Day 16 · 在 CloudBase 控制台建表 + 塞数据（照着做）

> 目标：把 `db/schema.sql`（建 4 张表）和 `db/seed.sql`（塞入 1 营期 + 4 房 + 12 学生）在你的云数据库里跑一遍。
> 预计耗时：5~8 分钟。全程只用点鼠标 + 复制粘贴。
> 做完你会得到：数据库里真实存在的 4 张表 + 13 行可查的数据。

---

## 一、准备工作（2 分钟）

### 1. 进入控制台

浏览器打开：

```
https://tcb.cloud.tencent.com
```

用你今天登录过的腾讯云账号进入（应该还是登录状态，不用再登）。

### 2. 确认环境选对

页面左上角 / 顶部的**环境切换器**里，选到：

> **xinghe-helper**（环境 ID：`xinghe-helper-d5g92pis442fd9947`）

⚠️ 选错环境的话，表会建到别的环境去。

### 3. 找到数据库入口

左侧菜单点「**数据库**」。

进去后找「**SQL 编辑器**」（有的版本叫「SQL 查询」「SQL 控制台」，一般在「数据表」标签页旁边）。

> 🔎 找不到 SQL 编辑器？**先截图发我**，我看你那边实际的界面再告诉你点哪里，别乱点。

### 4. 把脚本内容复制到剪贴板

用 VSCode 或记事本打开项目里的文件（地址栏粘贴这个路径回车）：

```
C:\Users\Zhang\Desktop\xinghe-helper\db
```

- 打开 **`schema.sql`**
- 按 **Ctrl+A**（全选）→ **Ctrl+C**（复制）

---

## 二、步骤 1：执行建表脚本（schema.sql）

1. 把上一步复制的内容，**粘贴到 SQL 编辑器里**（Ctrl+V）
2. 点「**执行 / 运行**」按钮
3. 等 1~3 秒

### 成功的标志（三个都要看）

| 检查点 | 预期 |
|---|---|
| 执行结果 | 提示成功，没有红色报错 |
| 左侧表列表 | 刷新后出现 **4 张表**：`camps`、`rooms`、`students`、`assignment_history` |
| 报错信息 | 无 |

> ⚠️ 这一步会**先删掉这 4 张表再重建**（这是为了让脚本可以反复跑）。现在库里没有任何真实数据，所以删了没有损失。等以后有真实报名数据了，别再随手跑这个脚本——到时我给你"不删表"的版本。

### 如果报错

| 报错信息 | 原因 | 怎么办 |
|---|---|---|
| `permission denied` / `must be owner` | 当前账号权限不足 | 截图发我 |
| `syntax error at or near ...` | 粘贴时内容被截断或混入了乱码 | 重新全选复制，一次性粘贴 |
| 只执行了最后一条语句 | SQL 编辑器一次只跑一条 | 见下面「逐条执行」 |

**逐条执行的办法**：把光标准确放在某一条语句里（末尾分号之后），点执行按钮，这一条就会单独跑。四张表按顺序：`camps` → `rooms` → `students` → `assignment_history`（顺序不能反，学生要引用房间）。

---

## 三、步骤 2：执行数据脚本（seed.sql）

1. 回到文件管理器，打开 **`seed.sql`**
2. **Ctrl+A** → **Ctrl+C**
3. 回到控制台 SQL 编辑器，**先清空编辑器**（Ctrl+A → Delete），再 **Ctrl+V**
4. 点「执行」

### 成功的标志

| 检查点 | 预期 |
|---|---|
| 执行结果 | 成功，无红色报错 |
| 最后 4 行 | 有 4 条 `setval` 的执行结果（用来校正自增编号） |

### 如果报错

| 报错信息 | 原因 | 怎么办 |
|---|---|---|
| `relation "public.students" does not exist` | 前一步建表没成功 | 回去重做步骤 1 |
| `duplicate key value violates unique constraint` | 上次跑过、数据没清干净 | 把开头 `truncate` 那一段单独选中执行一遍，再整体跑 |

---

## 四、步骤 3：验证（三条 SQL，直接在编辑器里跑）

把下面每一条**分别粘贴执行**，对照预期结果。

### 验证 1：四张表各有多少行

```sql
select 'camps' as 表名, count(*) from public.camps
union all select 'rooms', count(*) from public.rooms
union all select 'students', count(*) from public.students
union all select 'assignment_history', count(*) from public.assignment_history;
```

**预期**：camps = 1，rooms = 4，students = 12，assignment_history = 1

### 验证 2：每间房住了几个人

```sql
select r.room_no, r.capacity, count(s.id) as 已住人数
from public.rooms r
left join public.students s
  on s.assigned_room_id = r.id and s.is_latest = true
group by r.room_no, r.capacity
order by r.room_no;
```

**预期**：301 → 3/4，302 → 3/4，303 → 3/3，304 → 0/6

### 验证 3：未分配名单

```sql
select id, name, gender, teacher, class_level
from public.students
where is_latest = true and assigned_room_id is null
order by id;
```

**预期**：3 行 —— 郑楚、高远、沈知意

---

## 五、最后一步：截图给我

请截 **2 张**图（`Win + Shift + S` 框选）：

1. **左侧表列表**：能看清 4 张表的名字（这是"表建出来了"的证据）
2. **验证 1 的结果表**：能看到 `camps 1 / rooms 4 / students 12 / assignment_history 1`

发我之后我帮你核对对不对，然后回写 `api-contract.md`（把实际字段和约束同步进契约）。

---

## 附：本次到底建了什么（心里有数）

| 表 | 存什么 | 大概几行 |
|---|---|---|
| `camps` | 营期信息 | 1 |
| `rooms` | 房间（房号、可住人数） | 4 |
| `students` | 学生报名（含分配结果） | 12 |
| `assignment_history` | 每次一键分房的快照 | 1 |

> 权限（GRANT / RLS）**今天不配**。CloudBase 默认开启行级安全，前端要能读到数据还需要配权限，那是第 3 周写接口时才做的事，到时我会提醒你。
