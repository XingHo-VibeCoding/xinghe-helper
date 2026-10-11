# xinghe-helper

> 口语拉练营住宿分房工具：学生扫码填表 → AI 自动分房 → 一键导出名单。
>
> 28 天打卡项目（Day 1-28）。线上部署在 CloudBase，云函数 + 静态托管。

---

## 一、快速开始

```bash
# 启动本地开发
双击 启动小助手.bat

# 或者手动
cd web
npm install      # 首次
npm run dev
```

浏览器打开终端里提示的地址（默认 `http://localhost:5173`）。

> 环境配置、数据库初始化见 [`运行说明.md`](./运行说明.md)。

---

## 二、项目自带技能

`.workbuddy/skills/` 下有两个技能，是这个项目**踩过的坑固化成的东西**。用 AI 助手时它会自动加载，也可以直接问「按 verify-project 检查一遍」。

### 1. `verify-project` —— 发布前自检（Day 25）

**什么时候用**：每次要部署上线、提交代码、或做阶段验收之前。

**怎么用**，在项目根目录执行：

```bash
node .workbuddy/skills/verify-project/verify.mjs
```

**输出长这样**：逐项 `PASS` / `FAIL` / `SKIP`，每条都带文件名和行号，可以直接点开核对。

```
FAIL  4. CORS 三处副本同步
      cloudfunctions/api-rooms/cors.js：https://xinghe-helper-...tcloudbaseapp.com, ...
      cloudfunctions/health/cors.js：http://localhost:5173, http://127.0.0.1:5173
      ❌ cloudfunctions/health/cors.js 与 cloudfunctions/api-rooms/cors.js 不一致
         cloudfunctions/health/cors.js 缺少：https://xinghe-helper-...tcloudbaseapp.com
```

**退出码**：`0` = 全通过，`1` = 有 FAIL。CI 里可以直接用它当门禁。

**九个检查项**，每一个都对应本项目真实踩过的坑：

| # | 检查项 | 坑来源 |
|---|---|---|
| 1 | 密钥未进仓库（含 Git 全历史） | Day 23 |
| 2 | `.env` 未入库 / `.env.example` 已入库 | Day 23 |
| 3 | CORS 白名单含托管域名 | Day 20 |
| 4 | CORS 三处副本同步 | Day 20 |
| 5 | 密钥走环境变量、无连接串 | Day 20 / 23 |
| 6 | 服务端无裸报错（不泄漏 error.message） | Day 23 |
| 7 | 写操作按钮防连点（两件套） | Day 24 |
| 8 | 仓库换行符（源码 LF、`.bat` 必须 CRLF） | Day 23 |
| 9 | 带 id 的接口用查询参数 | 契约约定 |

**当前状态**：`7 PASS · 2 FAIL` —— 第 7、8 项是真实待修的问题，不是误报。

### 2. `frontend-interaction-checklist` —— 前端交互清单（Day 12）

**什么时候用**：要给本项目新增或修改任何用户交互（筛选、表单、按钮、弹窗、空页面）时，**先读它再写代码**。

**核心原则：交互必须状态完备。** 每个交互都有五种结果状态，缺一不可：

1. **有结果** —— 数据变了用户能看出来
2. **无结果** —— 不能白屏，给一句人话提示告诉用户怎么办
3. **恢复 / 清空** —— 能一步回到初始状态，且和打开时看到的一样
4. **加载中** —— 按钮防连点、有加载提示
5. **失败** —— 报错说人话，原数据不丢、还能重试

---

## 三、修改完代码之后

```bash
node .workbuddy/skills/verify-project/verify.mjs   # 先自检
git add -A && git commit -m "Day X｜一句话"       # 再提交
```

**两条铁律**：

- **提交前先跑一遍检查。** 这个 Skill 存在的意义就是防止你（或 AI）觉得「应该没问题」就直接发出去。
- **`.bat` 文件必须是 CRLF**，源码和文档必须是 LF。写反了 Windows 批处理会解析出错、git diff 会满屏变色。

---

## 四、目录结构速览

```
cloudfunctions/          三个云函数（各带一份 cors.js 副本，改白名单要同步）
  ├─ api-rooms/          房间 CRUD + 批量分配
  ├─ api-students/       学生查询 + 分配状态变更
  └─ health/             健康检查
web/                     前端（React + Vite，海洋主题）
db/                      建表脚本与授权说明
docs/                    每天的验证页、Bug 记录、踩坑笔记
.workbuddy/skills/       项目自带技能（会进仓库）
```

---

## 五、给 AI 助手 / 协作者的约定

本项目在 [`AGENTS.md`](./AGENTS.md) 有一套协作规则（任务边界、一次只做一步、提交格式等）。
**用 AI 改这个项目之前，请先读它。**

---

## 六、技术备忘

- **CloudBase 控制台 Path passthrough = Disable** —— `/:id` 传不进云函数，带 id 的接口一律用查询参数 `?id=&camp_id=`
- **三个 `cors.js` 各有一份副本** —— CloudBase 只打包函数自己的目录，改一处不改另外两处 = 只有一个接口能用
- **验证 CORS 白名单要用非本地域名** —— CloudBase 网关对 localhost 任意端口都放行，用 localhost 测出来的「有 CORS 头」证明白名单没配对
- **服务端 500 类错误一律走 `failServer()`** —— 不要写 `fail(500, ..., x.message)`，那会把表名和 SQL 片段泄漏给前端
- **防连点是两件套** —— 按钮 `disabled={!!busy}` 挡鼠标点击，函数入口 `if (busy) return` 挡回车/程序调用，缺一不可