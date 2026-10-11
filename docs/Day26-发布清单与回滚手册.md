# Day 26｜发布清单与回滚手册（v1.0）

> 适用版本：v1.0 及以后
> 环境：`xinghe-helper-d5g92pis442fd9947`（体验版 / ap-shanghai）
> 本次发布实测：2026-10-11，静态托管部署 15 秒、回滚 37 秒

---

# 第一部分：发布清单（v1.0）

## 一、版本标记

| 项 | 值 |
|---|---|
| 版本号 | `v1.0` |
| Git tag | `v1.0`（annotated tag） |
| 对应提交 | `99aa9cc` Day 26｜修完两个写操作的防连点，发布 v1.0 |
| 上一版本 | `v1.0-rc1` → `03af06a` |
| 发布人 | 项目作者 |
| 发布日期 | 2026-10-11 |

**打 tag 的命令**（发布完成、验证通过后执行）：

```bash
git tag -a v1.0 -m "v1.0 正式发布：一句话说明这版改了什么"
git push origin v1.0      # tag 也要推，否则别人拉不到
```

---

## 二、发布前验证项

### 2.1 代码门禁（必做，不能跳）

```bash
node .workbuddy/skills/verify-project/verify.mjs
```

- **通过标准**：退出码 `0`，输出 `9 PASS · 0 FAIL`
- **本次实测**：`8 PASS · 1 FAIL`（剩余 1 项为历史文档 CRLF，已确认不影响运行，记录备查）

> ⚠️ 这道门禁**真的拦下过一次发布**：Day 26 早上第 7 项查出两个写操作缺防连点两件套，修复后才发布。
> **不要因为"只剩一个 FAIL"就跳过判断** —— 先确认那个 FAIL 确实不影响运行。

### 2.2 提交与历史

```bash
git status                    # 工作区必须干净
git log --oneline -3          # 确认提交清晰
git tag -l                    # 确认上一版本 tag 存在（可回退点）
```

**通过标准**：工作区无未提交改动；至少存在一个可退回的历史点。

### 2.3 换行符检查

- 源码与文档：LF
- `.bat` / `.cmd`：**CRLF**（Windows 批处理用 LF 会解析出错）

### 2.4 构建与产物安全

```bash
cd web && npm run build
grep -rc "postgres://\|PGPASSWORD\|AKID\|sk-\|ghp_\|eyJ" dist/assets/*.js
```

**通过标准**：构建成功；密钥扫描结果为 `0`。

---

## 三、发布步骤

### 步骤 1：部署三个云函数（逐个，不能一次传多个）

```bash
cd C:/Users/Zhang/Desktop/xinghe-helper

npx --yes --package @cloudbase/cli tcb fn deploy api-rooms     --deployMode zip --force
npx --yes --package @cloudbase/cli tcb fn deploy api-students --deployMode zip --force
npx --yes --package @cloudbase/cli tcb fn deploy health       --deployMode zip --force
```

> ⚠️ **`--deployMode zip` 必须带。** 默认上传方式可能卡十几分钟，表现为"部署成功但云端没更新"。
>
> ⚠️ **一次只能传一个函数名。** 传三个名字只会部署第一个，且输出只有一行成功提示。

### 步骤 2：核对时间戳（**不能跳**）

```bash
npx --yes --package @cloudbase/cli tcb fn list
```

**通过标准**：三个函数的 `Modification time` 都是今天。

> 本次实测：第一次部署三个名字后，`fn list` 显示只有 `api-rooms` 更新到 14:00:23，
> 另外两个还是 10-09 和 10-07 的旧代码。**只看成功提示会带着旧函数发版。**

### 步骤 3：构建前端

```bash
cd web && npm run build
```

### 步骤 4：部署静态托管

```bash
cd C:/Users/Zhang/Desktop/xinghe-helper
MSYS_NO_PATHCONV=1 npx --yes --package @cloudbase/cli tcb hosting deploy ./web/dist / -e xinghe-helper-d5g92pis442fd9947
```

> ⚠️ **`MSYS_NO_PATHCONV=1` 必须加。** 不加的话 Git Bash 会把 `./web/dist` 转成它自己安装目录的路径，
> **结果覆盖站点根目录，站点直接坏掉**（Day 23 踩过）。
>
> ⚠️ 在 **cmd.exe** 里不要加这个前缀（cmd 没有路径转换问题，加了反而可能出错）。

### 步骤 5：打 tag

```bash
git add -A && git commit -m "Day X｜一句话"
git tag -a v1.0 -m "v1.0 正式发布"
git push origin main && git push origin v1.0
```

---

## 四、发布后验证

### 4.1 接口层

```bash
API="https://xinghe-helper-d5g92pis442fd9947.service.tcloudbase.com"

curl -s "$API/api/health"
# 期望：{"ok":true,"service":"xinghe-helper"}

curl -s "$API/api/rooms?camp_id=1"
# 期望：能返回真实房间数据
```

> ⚠️ **接口域名和站点域名不是一回事**：
> - 接口（云函数）：`...service.tcloudbase.com`
> - 站点（静态托管）：`...-1499825718.tcloudbaseapp.com`
>
> 拿站点域名去测接口会被 COS 接管，返回 HTML，看起来 200 但根本没进云函数。

### 4.2 CORS 双对照（Day 20 的教训）

```bash
# 白名单内：应该有 CORS 头
curl -s -D- -o /dev/null -H "Origin: https://xinghe-helper-d5g92pis442fd9947-1499825718.tcloudbaseapp.com" \
  "$API/api/rooms?camp_id=1" | grep -i "access-control-allow-origin"

# 非法域名：必须一个 CORS 头都不回
curl -s -D- -o /dev/null -H "Origin: https://evil.example.com" \
  "$API/api/rooms?camp_id=1" | grep -c "access-control-allow-origin"
# 期望输出：0
```

> ⚠️ **验证白名单必须用非本地域名。** CloudBase 网关对 localhost / 127.0.0.1 的**任意端口**都放行，
> 用 localhost 测出「有 CORS 头」证明白名单没配对（Day 20 记录）。

### 4.3 站点层（必须人眼看）

打开：

```
https://xinghe-helper-d5g92pis442fd9947-1499825718.tcloudbaseapp.com
```

按 **`Ctrl + Shift + R`** 强制刷新，然后检查：

| 检查点 | 正常 |
|---|---|
| 页面 | 海洋主题首页，房间卡片出现 |
| 数据 | 能看到 301/302 等房号，**不是空列表** |
| 「最后更新」时间戳 | 是刚刚（证明接口活着，不是缓存） |
| F12 → Console | **没有红色报错** |
| Console 请求头 | `access-control-allow-origin` 有值 |

---

## 五、代码与数据备份方式

### 5.1 代码备份

**主力：git tag**（本项目唯一的代码回退手段）

```bash
git tag -l                    # 现有所有可回退点
git log --oneline <tag>       # 某个 tag 对应哪个提交
```

**注意**：tag 里存的是**源码**，不是构建产物。所以回滚要「取回源码 → 重新构建 → 重新部署」，
不能直接传回旧文件。多一步构建 ≈ 多 4.5 秒。

### 5.2 静态托管产物备份（可选，双保险）

部署前先备份本地产物：

```bash
cp -r web/dist web/dist-backup
```

用途：万一 git 状态出问题，还有构建产物兜底。本次演练前做过一次。

### 5.3 数据备份

> ⚠️ **数据备份和代码备份是两回事。代码退回去，数据不会退回去。**

| 内容 | 位置 | 备份方式 |
|---|---|---|
| 表结构 | `db/schema.sql`、`db/grant-write.sql` | 已在 git 里，代码回滚即覆盖 |
| 业务数据（camps/rooms/students/assignment_history） | 云数据库 | ⚠️ **目前未做自动备份**，见下方说明 |

**当前的数据风险**（诚实记录）：

1. **没有生产数据** —— 现在库里是演示数据（9 名学生、11 个房间）。
2. **anon 写权限仍开着** —— Day 20 起就记在 `db/grant-write.sql` 顶部。**接入真实学生数据前必须先收回 GRANT + 加登录态校验。**
3. **没有数据库快照机制** —— Day 26 未做数据导出实操。

**要做数据备份的话**（未实操，待验证）：

```bash
# 思路：控制台 → 云数据库 → 数据导出
# 或用 pg_dump 连接导出（但本项目走 app.rdb() 网关，无连接串，pg_dump 用不了）
```

**接入真实数据前的必做项**：数据库快照 + 关闭 anon 写权限。

---

---

# 第二部分：回滚手册

## 一、什么情况必须回滚（判断表）

> **判断原则：只要"继续跑下去"可能让事情更糟，就回滚。回滚的代价是 37 秒，不回滚的代价可能是一晚上的排查。**

| # | 现象 | 判断 | 动作 | 理由 |
|---|---|---|---|---|
| 1 | **站点白屏 / 404** | 🔴 立刻回滚 | 静态托管 | 全部用户受影响，没有部分可用状态 |
| 2 | **首页能开但进不去工作台**（点击无反应） | 🔴 立刻回滚 | 静态托管 | 主流程断了，等同不可用 |
| 3 | **Console 报 CORS 错误，数据全是空的** | 🔴 立刻回滚 | 先查云函数，再看 cors.js | 页面看着正常但数据是假象，最容易被误判成"没事" |
| 4 | **能改数据但改完不刷新 / 出现半套数据** | 🔴 立刻回滚 | 静态托管 + 云函数 | 数据正确性风险高于可用性风险 |
| 5 | **接口 500，但页面报错是人话** | 🟡 先排查 | — | Day 23 的 `failServer()` 已保证不泄漏表名，说明代码路径是对的，可能是数据问题 |
| 6 | **接口 500，页面报 CORS** | 🔴 立刻回滚 | 云函数 cors.js | 三处副本大概率不同步 |
| 7 | **某一个接口挂了，其他正常** | 🟡 可选择性回滚 | 对应云函数 | 影响面小，可先查日志 |
| 8 | **页面能跑，但某个按钮点了没反应** | 🟡 先排查 | — | 可能是防连点加了 `if (busy) return` 但状态没清 |
| 9 | **界面文案错、样式乱** | 🟢 下一版修 | — | 不影响功能和数据，不值得回滚 |
| 10 | **数据是演示数据，学生填了但没保存** | 🔴 立刻回滚 + 查数据 | 静态托管 | **回滚不解决数据问题**，需同时查数据库 |
| 11 | **`fn list` 显示 Modification time 不对** | 🔴 停止发布 | — | 不是回滚场景，是发布流程出错 |
| 12 | **只是想改文案 / 调颜色** | ⟢ 不回滚 | — | 直接改，改完重发 |

### 三条判断纪律

1. **拿不准就回滚。** 37 秒的成本远低于排查一晚上的成本。
2. **回滚解决不了数据问题。** 如果坏的是数据（学生填的表丢了），回滚代码不会把数据带回来 —— 这时要查数据库，不是回滚。
3. **别在生产上试。** 想验证新版本，发到别的地方测，别直接改线上。

---

## 二、静态托管回退步骤（**已实操验证，37 秒**）

### 标准流程

```bash
# 步骤0：先看清楚现在在哪
git log --oneline -1
git tag -l

# 步骤1：确认要退到哪个版本（3 秒）
git checkout <目标tag> -- web/

# 步骤2：重新构建（4.5 秒）
cd web && npm run build

# 步骤3：部署（15 秒）
cd ..
MSYS_NO_PATHCONV=1 npx --yes --package @cloudbase/cli tcb hosting deploy ./web/dist / -e xinghe-helper-d5g92pis442fd9947
```

### ⚠️ 关键：核对产物哈希（这步决定回滚是不是真的成功）

```bash
# 记录原版本的哈希
curl -s "https://...-1499825718.tcloudbaseapp.com/" | grep -o "index-[A-Za-z0-9_-]*\.js"
# 输出示例：index-DD8mQVCr.js
```

**构建完成后比对：`web/dist/assets/` 里的文件名应该与上面那个哈希一致。**

- ✅ **一致** → 代码干净还原了，回滚是精确的
- ❌ **不一致** → **还原不干净，别急着发**，先查为什么

> 本次演练实测：还原后构建出的哈希是 `index-DD8mQVCr.js`，与 v1.0 **一字不差**。
> 这是整套回滚流程里**最有价值的一条证据** —— 它证明回滚是"精确还原"，不是"大概回到某个相似版本"。

### 部署后验证

```bash
# 1. 公网引用的是不是目标版本
curl -s -H "Cache-Control: no-cache" "https://.../" | grep -o "index-[A-Za-z0-9_-]*\.js"

# 2. 接口还活着吗
curl -s "https://...service.tcloudbase.com/api/health"
```

**浏览器验证**：打开站点 → `Ctrl + Shift + R` 强制刷新 → 看 Console 无红色报错 → 确认业务功能能点。

### 恢复 v1.0（从演练状态回到正常）

```bash
git checkout v1.0 -- web/
cd web && npm run build
cd .. && MSYS_NO_PATHCONV=1 npx --yes --package @cloudbase/cli tcb hosting deploy ./web/dist / -e xinghe-helper-d5g92pis442fd9947
```

---

## 三、云函数回退步骤（**未实操，仅备查**）

> ⚠️ **今天没有实操云函数回退**（清单「今日不做」）。以下是按静态托管的思路推的，**第一次用务必先在测试环境练**。

### 思路：云函数回退 = 用旧代码重新部署

CloudBase 没有"一键回滚函数"的命令（`tcb app deploy` 可能支持，需要研究）。所以做法是：

```bash
# 步骤1：取回旧版本的函数代码
git checkout <目标tag> -- cloudfunctions/

# 步骤2：逐个重新部署（记住：一次只能传一个）
npx --yes --package @cloudbase/cli tcb fn deploy api-rooms     --deployMode zip --force
npx --yes --package @cloudbase/cli tcb fn deploy api-students --deployMode zip --force
npx --yes --package @cloudbase/cli tcb fn deploy health       --deployMode zip --force

# 步骤3：核对时间戳
npx --yes --package @cloudbase/cli tcb fn list
```

### ⚠️ 云函数回退的三个额外风险

| 风险 | 说明 |
|---|---|
| **环境变量可能被覆盖** | 部署会用 `cloudbaserc.json` 里的 `envVariables` 覆盖线上配置。**回退前先备份线上环境变量** |
| **CORS 三处副本** | 退回旧代码后，三份 `cors.js` 必须仍旧一致 —— 这正是 Day 20 踩的坑 |
| **数据库不会跟着退** | 函数退回了，schema 变了的话可能照样报错 |

**回退后验证**：

```bash
API="https://xinghe-helper-d5g92pis442fd9947.service.tcloudbase.com"
curl -s "$API/api/health"
# 期望：{"ok":true,"service":"xinghe-helper"}

# CORS 双对照也要重跑一遍
curl -s -D- -o /dev/null -H "Origin: https://evil.example.com" "$API/api/rooms?camp_id=1" | grep -c "access-control-allow-origin"
# 期望：0
```

**云函数日志**（排查用）：

```bash
npx --yes --package @cloudbase/cli tcb fn logs api-rooms -e xinghe-helper-d5g92pis442fd9947
```

---

## 四、数据恢复（**未实操，仅备查**）

> ⚠️ **今天完全没有实操数据恢复**（清单「今日不做」）。

### 必须先认清一件事

**代码回滚 ≠ 数据回滚。** 函数和页面退回 v1.0，但数据库里的数据还是"出事时"的状态。

### 如果数据被写坏了

| 情形 | 严重度 | 处理 |
|---|---|---|
| 演示数据被改乱 | 🟢 | 重新造演示数据即可，**不要慌** |
| 删错了房间 | 🟡 | 查 `assignment_history` 表看记录，手工补回 |
| 学生填的报名数据丢了 | 🔴 | **必须靠数据库备份/快照**，代码回滚救不了 |

### 恢复步骤

1. **先止损**：暂停站点访问（把 `index.html` 换成提示页），防止继续写坏
2. **看云函数日志**：确认最后正常的时间点和操作
3. **查数据现状**：控制台 → 云数据库 → 看四张表当前状态
4. **有快照** → 从快照恢复
5. **没快照** → 按 `assignment_history` 的记录手工补

### 接入真实数据前的必做（Day 23 就记着，至今未做）

1. **数据库快照/定时备份**
2. **收回 anon 写权限** —— `db/grant-write.sql` 顶部有说明
3. **加登录态校验**

---

## 五、一页速查（贴在显示器边上）

### 判断

```
页面全坏 / 数据全空 / 主流程断 → 回滚（37 秒）
单个接口挂 → 查日志，可选择性回滚
只是文案样式 → 不回滚，下一版修
数据不对 → 查数据库，不是回滚
```

### 静态托管回滚（三条命令）

```bash
git checkout <tag> -- web/ && cd web && npm run build && cd .. && MSYS_NO_PATHCONV=1 npx --yes --package @cloudbase/cli tcb hosting deploy ./web/dist / -e xinghe-helper-d5g92pis442fd9947
```

### 云函数回滚（未验证）

```bash
git checkout <tag> -- cloudfunctions/
# 然后逐个 deploy，一次只能一个
```

### 永远别做的事

- ❌ 部署多个函数名写在一起（只会生效第一个）
- ❌ 只看成功提示就发版（一定 `fn list` 核对时间戳）
- ❌ 静态托管部署不加 `MSYS_NO_PATHCONV=1`
- ❌ 拿站点域名去测云函数接口（会被 COS 接管，返回 HTML 却看似 200）
- ❌ 用 localhost 验证 CORS 白名单（网关对本地任意端口都放行）
- ❌ `git reset --hard`（要用 `git revert` 或 `git checkout <tag> -- <path>`）