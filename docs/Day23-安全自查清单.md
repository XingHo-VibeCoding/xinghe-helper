# Day 23｜安全自查清单

> 日期：2026-10-09
> 范围：硬编码密钥 ·裸报错 · 非法输入 · `.gitignore` 完整性
> 结论：**红线全部通过**，发现并修复裸报错 **31 处**。
> 用法：每条都给了**可复制的验证命令**，随时能自己重跑一遍。

---

## 0. 怎么用这份清单

每项写成三段：**查什么→ 怎么查（复制就能跑）→ 期望结果**。

命令里那个长正则可以存成变量反复用：

```bash
# Git Bash / Bash
SECRET_RE='(postgres://[a-zA-Z0-9_]+:[^@[:space:]]+@|postgresql://[a-zA-Z0-9_]+:[^@[:space:]]+@|AKID[A-Za-z0-9]{10,}|sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{25,}|BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY|eyJhbGciOiJ[A-Za-z0-9_-]{10,})'
```

---

## 1. 硬编码密钥（🔴 上线红线）

### 1.1 当前文件里有没有密钥

```bash
git ls-files -z | xargs -0 grep -nIE "$SECRET_RE"
```

**期望：0 条命中。**

实测结果：只有 `TECH_DESIGN.md:295` 一处 `SUPABASE_DB_URL=postgresql://...`——
那是文档里的**占位符**（末尾三个点是省略号），不是真密钥。Day 23 已把它改成
`<平台提供>` 写法，避免被误抄。

### 1.2 Git 全历史里有没有密钥⚠️ 最重要的一条

```bash
git log --all -p --full-history | grep -nIE "$SECRET_RE"
```

**期望：0 条命中。**

> **为什么必须查历史**：密钥可能提交过、后来又被删掉。
> `git log` 能看到所有 commit 的全部 diff，包括「后来删掉了的文件」里曾经的内容。
> **代码删干净 ≠ 密钥没泄漏过** —— 只要进过 git 历史，就可能被 clone 下来的人看到。

实测：**0 条**。这个项目从第一天起就没踩过这个坑。

### 1.3 历史上有没有提交过 .env

```bash
git log --all --diff-filter=A --name-only --format="" | sort -u | grep -iE '(^|/)\.env'
```

**期望：只出现 `.env.example`，不出现 `.env`。**

`.env.example` 是**模板**，必须进仓库（别人要知道该配哪些变量）；
`.env` 是**真值**，永远不能进。

### 1.4 历史上有没有私钥文件

```bash
git log --all --diff-filter=A --name-only --format="" | sort -u | \
  grep -iE '\.(pem|key|p12|pfx|keystore)$|id_rsa|id_dsa'
```

**期望：0 条。**

### 1.5 代码里密钥是否走环境变量

```bash
grep -rn "process.env" cloudfunctions/ --include=*.js | grep -v node_modules
```

**期望：环境变量一律用 `process.env.X` 读取。**

实测三个函数都是这样：

| 文件 | 读取的环境变量 |
|---|---|
| `cloudfunctions/api-rooms/db.js` | `PG_SCHEMA` |
| `cloudfunctions/api-rooms/cors.js` | `ALLOWED_ORIGINS` |
| `cloudfunctions/api-students/db.js` | `PG_SCHEMA` |
| `cloudfunctions/api-students/cors.js` | `ALLOWED_ORIGINS` |
| `cloudfunctions/health/cors.js` | `ALLOWED_ORIGINS` |

### 1.6 数据库连接方式：确认没有连接串

```bash
grep -rn "app.rdb\|DB_URL\|PGPASSWORD\|DATABASE_URL" cloudfunctions/ --include=*.js
```

**期望：只有 `app.rdb()`，没有任何连接串、没有密码环境变量。**

本项目走`cloudbase.init()` + `app.rdb()` 的平台网关，
**不需要**账号密码连接串，所以也就没有密码可泄漏。这是体验版共享集群的硬性约束
（详见 `docs/api-contract.md` 第 4.2 节），但从安全角度看反而是优势。

### 1.7 前端产物里有没有密钥 ⚠️ 每次重新构建后都要跑

```bash
# 先构建
cd web && npm run build
# 再查产物
grep -rc "supabase\|anon\|eyJ" web/dist/assets/*.js
```

**期望：0。**

> **为什么 Vite 项目要单独查产物**：`VITE_` 开头的环境变量会被**打进前端产物**。
> 所以 `VITE_` 后面只能放公开的东西（如接口地址），
> **绝对不能放密钥**。这条规则 Day 20 就定下了，今天再验一次。

实测：`web/dist` 里只有 `.service.tcloudbase.com`，Supabase 地址 0 处。

### 1.8 cloudbaserc.json 有没有泄密

```bash
cat cloudbaserc.json | grep -A5 envVariables
```

**期望：只有 `PG_SCHEMA` 和 `ALLOWED_ORIGINS`（都是公开值）。**

实测符合预期：域名白名单不算敏感——它是"允许谁来调我"，不是"我怎么证明自己"。

---

## 2. 裸报错（今天修的主体）

### 2.1 查法

```bash
# 服务端：还有没有把 error.message 拼进响应
grep -rn "fail(500\|\.message ||" cloudfunctions/*/index.js

# 前端：还有没有直接展示 err.message
grep -rn "err.message\|error.message" web/src/
```

**期望（Day 23 修复后）：**

- 服务端 `fail(500` → **0 处**
- 服务端 `.message ||` → **0 处**
- 前端 `err.message` → 允许存在，但**它们拿到的已经是中文了**

### 2.2 改前vs 改后（Day 23 核心）

**改前**（把数据库原文拼给人看）：

```js
return fail(500, 'DB_ERROR', '读取房间失败:' + (error.message || '数据库返回错误'), origin)
```

数据库返回 `{ message: 'relation "rooms" does not exist' }` 时，
用户看到的是：

> 读取房间失败:relation "rooms" does not exist

**改后**（只给人话）：

```js
return failServer('读取房间失败', 'DB_ERROR', origin)
```

用户看到：

> 读取房间失败

**本地对照验证**（可以自己跑）：

```js
// 在 cloudfunctions/api-rooms/ 目录下临时建一个 js，跑完删掉
const { failServer, fail } = require('./response.js')
const o = 'https://xinghe-helper-d5g92pis442fd9947-1499825718.tcloudbaseapp.com'
const leak = /relation|select |insert |table|column|password/i

console.log('改后:', failServer('读取房间失败', 'DB_ERROR', o).body)
console.log('改前:', fail(500, 'DB_ERROR',
  '读取房间失败:' + 'relation "rooms" does not exist', o).body)
console.log('改后泄漏吗:', leak.test(failServer('读取房间失败', 'DB_ERROR', o).body))
console.log('改前泄漏吗:', leak.test(fail(500, 'DB_ERROR',
  '读取房间失败:relation "rooms" does not exist', o).body))
```

**期望输出：**

```
改后: {"ok":false,"data":null,"error":{"code":"DB_ERROR","message":"读取房间失败"}}
改前: {"ok":false,"data":null,"error":{"code":"DB_ERROR","message":"读取房间失败:relation \"rooms\" does not exist"}}
改后泄漏吗: false
改前泄漏吗: true
```

### 2.3 为什么这是安全问题

那句英文原文可能包含：数据库表名、SQL 语句片段、字段名、约束名、
甚至连接串里的主机名。

**拿到接口链接的人不需要绕过任何权限，只要随便调一次接口就能看到。**
这和 Day 20 收紧 CORS、收回 anon 写权限是同一类问题——
**别把不该给外人看的东西给出去**。

信息泄漏的通道往往不是权限绕过，而是「错误处理」这种看起来无害的地方。

### 2.4 真实错误信息没丢

**每个调用点上面的 `console.error` 都还在**，云函数日志里能查完整堆栈：

```bash
tcb fn logs api-rooms -e xinghe-helper-d5g92pis442fd9947
```

所以「用户只看到人话」≠「错误信息丢了」，只是不给他看了。

---

## 3. 非法输入的处理

### 3.1 服务端校验层（第一道门）

```bash
grep -rn "validate\|VALIDATION_ERROR" cloudfunctions/*/index.js | head -20
```

现状：**每个写接口都有逐字段校验**，且提示是中文。

| 错误码 | HTTP | 提示（实测） |
|---|---|---|
| `MISSING_CAMP_ID` | 400 | 缺少必填参数 camp_id(必须是正整数) |
| `INVALID_JSON` | 400 | 请求体不是合法的 JSON(请确认 body 是 application/json 格式的字符串) |
| `VALIDATION_ERROR` | 400 | capacity(可住人数)必须是正整数,当前收到:0 |
| `NOTHING_TO_UPDATE` | 400 | 没有要修改的字段(可改: room_no / capacity / gender_label) |
| `ROOM_NOT_FOUND` | 404 | 房间不存在(id=9999, camp_id=1),可能已被删除,请刷新页面 |
| `ROOM_NO_DUPLICATED` | 409 | 房号 301 已存在(房间 id=101,容量 4),请换一个房号 |
| `ROOM_CAPACITY_CONFLICT` | 409 | 房内现有 3 人,不能把容量改成 1;请先移出一部分人 |

### 3.2 数据库约束（第二道门）

`db/schema.sql` 里有对应约束，**校验层是第一道、数据库是第二道，两层都要有**：

| 约束 | 防什么 |
|---|---|
| `check (capacity > 0)` | 容量为 0或负数 |
| `unique (camp_id, room_no)` | 同营期房号重复 |
| `check (gender in ('男','女'))` | 非法性别值 |
| `students_assign_consistent` | 分配状态自洽（有房号 ⟺ 已分配） |

**为什么两层都要**：校验层能给中文提示、拦得早；数据库层是**最后一道防线**——
即使有人绕过接口直接写库（比如用 SQL 编辑器），也写不进脏数据。

### 3.3 前端兜底（第三道门）

`web/src/api/client.js → toFriendlyMessage()`

翻译浏览器原生报错；已经是中文的原样透传；不认识的不编假话、原样返回。

**为什么不改页面里那 11 处 `flash(err.message)`**：
页面直接显示数据层传来的提示是**对的写法**，问题在数据层可能传英文。
修源头比贴 11 处补丁可靠——**贴了 11 处就会漏第 12 处**。

---

## 4. .gitignore 完整性

### 4.1 查法

```bash
cat .gitignore
# 逐条验证是否真的生效
git check-ignore -v web/.env
```

### 4.2 关键规则与验证结果

| 规则 | 作用 | 验证命令 | 实测 |
|---|---|---|---|
| `.env` | 忽略所有 `.env` | `git check-ignore -v web/.env` | 命中 `.gitignore:2` ✅ |
| `.env.*` | 忽略 `.env.local` 等变体 | `git check-ignore -v web/.env.local` | ✅ |
| `!.env.example` | **例外**：模板要进仓库 | `git ls-files web/ \| grep env` | ✅ 已跟踪 |
| `*.pem` `*.key` `*.p12` | 私钥文件 | `git check-ignore -v test.pem` | ✅ |
| `secrets.*` | 密钥文件 | `git check-ignore -v secrets.json` | ✅ |
| `node_modules/` | 依赖目录 | — | ✅ |
| `dist/` | 构建产物 | — | ✅ |
| `.workbuddy/` | WorkBuddy 本地数据 | — | ✅ |

### 4.3 ⚠️ `.env.*` 与 `!.env.example` 的顺序陷阱

```
.env        ← 命中，忽略
.env.*      ← 命中，忽略
!.env.example ← 例外，取消忽略，让模板进仓库
```

**顺序不能反**。如果 `!.env.example` 写在 `.env.*` **前面**，
后面的 `.env.*` 会把它重新忽略掉——模板就进不了仓库，别人不知道该配哪些变量。

---

## 5. 今天的自查结果汇总

| # | 检查项 | 结果 |
|---|---|---|
| 1.1 | 当前文件密钥 | ✅ 0 条 |
| 1.2 | **Git 全历史密钥** | ✅ 0 条 |
| 1.3 | 历史提交过 .env | ✅ 从未 |
| 1.4 | 历史私钥文件 | ✅ 0 条 |
| 1.5 | 密钥走环境变量 | ✅ 全走process.env |
| 1.6 | 无数据库连接串 | ✅ 走 app.rdb() 网关 |
| 1.7 | 前端产物无密钥 | ✅ 0 处 |
| 1.8 | cloudbaserc.json | ✅ 只有公开值 |
| 2.1 | 服务端裸报错 | ✅ **已修复 31 处**（改前 0 处残留） |
| 3.1 | 服务端非法输入 | ✅ 7 类错误码全中文 |
| 3.2 | 数据库约束 | ✅ 第二道门齐全 |
| 3.3 | 前端兜底 | ✅ toFriendlyMessage() |
| 4.2 | .gitignore | ✅ 规则完整且生效 |

---

## 6. 还没做的（留待后续）

诚实记录，今天没做但知道的：

1. **anon 写权限仍然开着**（Day 20 就记在 `db/grant-write.sql` 顶部）。
   任何拿到链接的人都能往 `students` 表塞数据。
   **接入真实学生数据前必须**先加登录态校验 + 收回 GRANT。
2. **CORS 白名单里有 `localhost`**。开发方便，但生产也留着它。
3. **批量分配不是真事务**。逐条 update，中途失败会留下部分成功（Day 20 记录）。
4. **没有登录态**，任何人调接口都能改数据。这是当前最大的风险点。

---

## 7. 一句话总结

> **密钥这块比想象中干净**——全历史 0 条命中，从没提交过 .env。
>
> 真正的洞在**错误处理**：31 处把数据库原文拼给了用户。
> 修法不是逐个改文案，而是**在响应层加一个 `failServer()` 让它变成默认安全**——
> 以后新增接口天然就不会写出裸报错，靠的不是每次记得写对。
