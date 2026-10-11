// Day 25｜verify-project 技能的可执行脚本
//
// 用法：在项目根目录跑
//   node .workbuddy/skills/verify-project/verify.mjs
//
// 退出码：0 = 全通过；1 = 有 FAIL
//
// ⚠️ 设计纪律（Day 25 第一轮踩出来的血泪教训）：
//   1. 不调用外部 grep / git 管道命令。Node 在 Windows 上会走 cmd.exe，
//      shell 引号规则完全不同，命令可能根本没执行却被当成「命中」——
//      第一轮就因为这个产生了 5 个假 FAIL。全部改用Node 原生 API。
//   2. git 只用 execFileSync（不走 shell），绕开引号问题。
//   3. 每条证据必须带文件:行号，能直接点开核对；做不到就报 SKIP。
//   4. 环境缺失 / 读不到文件 → 报 SKIP，绝不报 PASS。虚报是这个技能最大的敌人。
//   5. 不联网、不部署，纯静态，任何时候都能跑。

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..', '..')

// ── 基础设施 ────────────────────────────────────────────────────
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.workbuddy', 'coverage', '.vite'])

function rel(abs) {
  return relative(ROOT, abs).split(sep).join('/')
}

/** 递归列出项目内文件（跳过依赖与产物）。ext=null 表示所有文件。 */
function walk(dir, out = [], ext = null) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const abs = join(dir, name)
    const st = statSync(abs)
    if (st.isDirectory()) walk(abs, out, ext)
    else if (!ext || name.endsWith(ext)) out.push(abs)
  }
  return out
}

/** 全项目源码文件（跳过依赖与产物）。Git 扫描与文本扫描都用它。 */
function sourceFiles(exts = ['.js', '.jsx', '.mjs', '.ts', '.tsx', '.json', '.md', '.html', '.css', '.sql', '.yml', '.yaml']) {
  const out = []
  const walkExt = (dir, acc = []) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue
      const abs = join(dir, name)
      const st = statSync(abs)
      if (st.isDirectory()) walkExt(abs, acc)
      else if (exts.some((e) => name.endsWith(e))) acc.push(abs)
    }
    return acc
  }
  walkExt(ROOT, out)
  return out
}

/** 在文件里按行找正则，返回 {file, line, text}。 */
function findLines(abs, re) {
  const src = readFileSync(abs, 'utf8')
  const out = []
  src.split('\n').forEach((line, i) => {
    if (re.test(line)) out.push({ file: rel(abs), line: i + 1, text: line.trim() })
  })
  return out
}

function git(args, opts = {}) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT, encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    })
  } catch (e) {
    return null // 调用失败返回 null，调用方一律报 SKIP，绝不当成「0 命中」
  }
}

function hasGit() {
  return existsSync(join(ROOT, '.git')) && git(['rev-parse', '--git-dir']) !== null
}

// ── 1. 密钥未进仓库（含 Git 全历史）───────────────────────────
const SECRET_RE = /(postgres(?:ql)?:\/\/[A-Za-z0-9_]+:[^@\s]+@|AKID[A-Za-z0-9]{10,}|sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{25,}|BEGIN (?:RSA|OPENSSH|EC|DSA) PRIVATE KEY|eyJhbGciOiJ[A-Za-z0-9_-]{10,})/

function check1() {
  const ev = []
  if (!hasGit()) return record(1, SECRET_NAME, 'SKIP', ['未检测到可用的 git 仓库，历史扫描跳过'])

  // 1a 当前工作区
  const cur = []
  for (const f of sourceFiles()) {
    let src
    try { src = readFileSync(f, 'utf8') } catch { continue }
    src.split('\n').forEach((line, i) => {
      if (SECRET_RE.test(line)) cur.push(`${rel(f)}:${i + 1} ${line.trim().slice(0, 100)}`)
    })
  }
  ev.push(cur.length === 0 ? '当前文件：0 条命中' : `❌ 当前文件 ${cur.length} 条：`)

  // 1b Git 全历史（含后来被删掉的）
  const diff = git(['log', '--all', '-p', '--full-history'])
  if (diff === null) {
    ev.push('Git 历史：读取失败，无法判定')
    return record(1, SECRET_NAME, 'SKIP', ev)
  }
  const hist = diff.split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, l]) => SECRET_RE.test(l))
  ev.push(hist.length === 0
    ? 'Git 全历史：0 条命中（git log --all -p --full-history）'
    : `❌ Git 全历史 ${hist.length} 条命中`)

  if (!cur.length && !hist.length) return record(1, SECRET_NAME, 'PASS', ev)
  ev.push(...cur.slice(0, 5), ...hist.slice(0, 5).map(([n, l]) => `history:${n} ${l.trim().slice(0, 100)}`))
  return record(1, SECRET_NAME, 'FAIL', ev)
}
const SECRET_NAME = '密钥未进仓库（含 Git 全历史）'

// ── 2. .env 未入库 / .env.example 已入库 ───────────────────────
function check2() {
  const name = '.env 未入库 / .env.example 已入库'
  const ev = []
  if (!hasGit()) return record(2, name, 'SKIP', ['未检测到 git 仓库，历史扫描跳过'])

  // 2a .gitignore 是否拦得住
  const ignoreSrc = existsSync(join(ROOT, '.gitignore')) ? readFileSync(join(ROOT, '.gitignore'), 'utf8') : ''
  const rules = ignoreSrc.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  const hit = (f) => git(['check-ignore', '-v', f])
  const envProbe = hit('web/.env')
  if (envProbe) ev.push(`.env 忽略规则：命中 ${envProbe.trim().split(':').slice(1).join(':').trim()}`)
  else {
    ev.push('❌ .gitignore 没拦住 web/.env')
    if (!rules.some((r) => r === '.env' || r === '.env*' || r === '**/.env')) ev.push('   （.gitignore 里也没找到 .env 规则）')
  }

  // 2b 历史里有没有提交过真 .env
  const added = git(['log', '--all', '--diff-filter=A', '--name-only', '--format='])
  if (added === null) return record(2, name, 'SKIP', [...ev, 'Git 历史：读取失败'])
  const envFiles = [...new Set(added.split('\n').map((s) => s.trim()).filter((s) => /(^|\/)\.env/i.test(s)))]
  const bad = envFiles.filter((s) => !/\.env\.example$/i.test(s))
  ev.push(`历史新增的 env 文件：${envFiles.length ? envFiles.join(', ') : '无'}`)
  ev.push(envFiles.some((s) => /\.env\.example$/i.test(s)) ? '模板 .env.example 已入库 ✅' : '（无.env.example 模板）')

  // 2c 工作区里现有 .env 是否被忽略
  const liveEnv = sourceFiles(['.env', '.local']).map(rel).filter((f) => /\.env/.test(f))
  const liveLeak = liveEnv.filter((f) => !hit(f))
  if (liveLeak.length) ev.push(`❌ 工作区存在未被忽略的环境文件：${liveLeak.join(', ')}`)

  if (!bad.length && !liveLeak.length && envProbe) return record(2, name, 'PASS', ev)
  if (bad.length) ev.push(`❌ 历史里进过真 .env：${bad.join(', ')}`)
  return record(2, name, 'FAIL', ev)
}

// ── 3 & 4. CORS 白名单 ─────────────────────────────────────────
const CORS_FILES = [
  'cloudfunctions/api-rooms/cors.js',
  'cloudfunctions/api-students/cors.js',
  'cloudfunctions/health/cors.js',
]

function corsOrigins(relPath) {
  const abs = join(ROOT, relPath)
  if (!existsSync(abs)) return { err: '文件不存在' }
  const src = readFileSync(abs, 'utf8')
  const m = src.match(/DEFAULT_ORIGINS\s*=\s*\[([\s\S]*?)\]/)
  if (!m) return { err: '读不出 DEFAULT_ORIGINS' }
  return { origins: [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) }
}

function check3() {
  const name = 'CORS 白名单含托管域名'
  const ev = []
  let bad = 0
  for (const f of CORS_FILES) {
    const r = corsOrigins(f)
    if (r.err) { ev.push(`${f}：❌ ${r.err}`); bad++; continue }
    const hosted = r.origins.filter((o) => o.includes('tcloudbaseapp.com'))
    if (!hosted.length) { ev.push(`${f}：❌ 白名单里没有托管域名`); bad++ }
    else ev.push(`${f}：${hosted.length} 个托管域名 → ${hosted.join(', ')}`)
  }
  return bad ? record(3, name, 'FAIL', ev) : record(3, name, 'PASS', ev)
}

function check4() {
  const name = 'CORS 三处副本同步'
  const ev = []
  const map = new Map()
  for (const f of CORS_FILES) {
    const r = corsOrigins(f)
    if (r.err) {
      ev.push(`${f}：❌ ${r.err}`)
      ev.push('CloudBase 只打包函数自己的目录 —— 缺一份就有一个接口没有 CORS 保护')
      return record(4, name, 'FAIL', ev)
    }
    map.set(f, r.origins)
  }
  for (const [f, o] of map) ev.push(`${f}：${o.join(', ')}`)

  const sig = (o) => o.join(',')
  const uniq = new Set([...map.values()].map(sig))
  if (uniq.size === 1) return record(4, name, 'PASS', ev)

  // 明确指出谁跟谁不一致
  const [refFile, refVal] = [...map.entries()][0]
  for (const [f, o] of map) {
    if (sig(o) !== sig(refVal)) {
      const only = o.filter((x) => !refVal.includes(x))
      const miss = refVal.filter((x) => !o.includes(x))
      ev.push(`❌ ${f} 与 ${refFile} 不一致 —— 模拟「只改了一处就部署」`)
      if (only.length) ev.push(`   ${f} 多出：${only.join(', ')}`)
      if (miss.length) ev.push(`   ${f} 缺少：${miss.join(', ')}`)
    }
  }
  ev.push('→ 改白名单必须三处同步，否则只有一个接口能用')
  return record(4, name, 'FAIL', ev)
}

// ── 5. 密钥走环境变量、无连接串 ────────────────────────────────
function check5() {
  const name = '密钥走环境变量、无连接串'
  const ev = []
  const ALLOWED = ['PG_SCHEMA', 'ALLOWED_ORIGINS']

  const envHits = walk(join(ROOT, 'cloudfunctions')).flatMap((f) =>
    findLines(f, /process\.env\.[A-Z_]+/).map((h) => h.text.match(/process\.env\.([A-Z_]+)/)[1]))
  const names = [...new Set(envHits)]
  const unexpected = names.filter((n) => !ALLOWED.includes(n))
  ev.push(`读取的环境变量：${names.length ? names.join(', ') : '无'}`)
  if (unexpected.length) ev.push(`❌ 预期外的环境变量：${unexpected.join(', ')}`)

  const connHits = walk(join(ROOT, 'cloudfunctions')).flatMap((f) =>
    findLines(f, /\bDB_URL\b|\bPGPASSWORD\b|\bDATABASE_URL\b|postgres(?:ql)?:\/\//))
  if (connHits.length) {
    ev.push(`❌ 发现连接串/密码 ${connHits.length} 处：`)
    ev.push(...connHits.slice(0, 3).map((h) => `${h.file}:${h.line} ${h.text.slice(0, 90)}`))
  } else {
    ev.push('数据库连接：仅 app.rdb() 平台网关，无连接串、无密码')
  }

  if (!unexpected.length && !connHits.length && names.length) return record(5, name, 'PASS', ev)
  if (!names.length) return record(5, name, 'SKIP', [...ev, '未找到 process.env 读取点，无法判定'])
  return record(5, name, 'FAIL', ev)
}

// ── 6. 服务端无裸报错 ─────────────────────────────────────────
// ⚠️ Day 25 第二轮修正（误报 1）：
//   初版扫整个 cloudfunctions/，把 response.js 里 fail() 的**函数定义本体**
//   当成了裸报错调用点，还把 requestLog.js 的 console.error 当成泄漏。
//   真相：fail() 本身就是拼响应的，它调 fail() 是应该的；
//        console.error 打的是云端日志、用户看不到，不是泄漏。
//   现在只扫业务调用点 index.js，且排除注释行与 console.error。
function check6() {
  const name = '服务端无裸报错'
  const ev = []

  // 业务入口文件（response.js 是响应层、requestLog.js 是日志层，都不算业务调用点）
  const entries = walk(join(ROOT, 'cloudfunctions')).filter(
    (f) => f.endsWith('index.js') && /cloudfunctions[/\\][^/\\]+[/\\]index\.js$/.test(rel(f)),
  )
  if (!entries.length) return record(6, name, 'SKIP', ['未找到云函数业务入口 index.js'])

  const fail500 = []
  const msgOr = []
  for (const f of entries) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      const t = line.trim()
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return // 注释里的对照代码不是真调用
      const hit = { file: rel(f), line: i + 1, text: t }
      if (/fail\(500/.test(line)) fail500.push(hit)
      // console.error 打的是云端日志，用户看不到，不算泄漏
      if (/\.message\s*\|\|/.test(line) && !/console\.error/.test(line)) msgOr.push(hit)
    })
  }

  ev.push(`扫描范围：${entries.length} 个业务入口（不含 response.js / requestLog.js）`)
  ev.push(`fail(500 裸报错：${fail500.length} 处`)
  if (fail500.length) ev.push(...fail500.slice(0, 4).map((h) => `${h.file}:${h.line} ${h.text.slice(0, 90)}`))
  ev.push(`.message || 拼进响应：${msgOr.length} 处（console.error 日志埋点已排除）`)
  if (msgOr.length) ev.push(...msgOr.slice(0, 4).map((h) => `${h.file}:${h.line} ${h.text.slice(0, 90)}`))

  // 反向确认：failServer 在用、console.error 埋点还在（真实堆栈没丢）
  const failServer = entries.flatMap((f) => findLines(f, /failServer\(/))
  const consoleErr = walk(join(ROOT, 'cloudfunctions')).flatMap((f) => findLines(f, /console\.error/))
  ev.push(`failServer() 调用点：${failServer.length} 处 ✅ Day 23 引入的安全默认值`)
  ev.push(`console.error 埋点：${consoleErr.length} 处（真实堆栈仍留在云函数日志，用户看不到）`)

  if (!fail500.length && !msgOr.length) return record(6, name, 'PASS', ev)
  ev.push('→ 会把表名 / SQL 片段 / 字段名拼给前端，改用 failServer(message, code, origin)')
  return record(6, name, 'FAIL', ev)
}

// ── 7. 写操作按钮防连点（两件套）─────────────────────────────
// ⚠️ Day 25 第二轮修正（误报 2 与 3）：
//   初版判据是「函数里调了 setBusy」—— 这把load()（刷新数据）、
//   runAI()（AI 识别，自己有 disabled）也算成了写操作，一次报 8 处，纯噪音。
//   现在改成**精确判据：函数体里调用了写接口（POST / PATCH / DELETE）**。
//   只有这类函数连点才会产生重复写入，才需要两件套。
//
//   7a 的判据也修了：AsyncButton 组件自己在 loading/成功时禁用按钮
//   （AsyncButton.jsx 第 32 行），所以用 AsyncButton 的 submit 不需要显式 disabled。
function check7() {
  const name = '写操作按钮防连点（两件套）'
  const ev = []
  const UI = ['web/src/pages/Workbench.jsx', 'web/src/pages/StudentForm.jsx', 'web/src/pages/Overview.jsx']
    .filter((f) => existsSync(join(ROOT, f)))

  if (!UI.length) return record(7, name, 'SKIP', ['未找到前端页面文件'])

  // ── 精确找出「写操作函数」：体��调了写接口 ──
  const WRITE_FN = /\b(addRoom|deleteRoom|updateRoom|patchRoom|addStudent|updateStudent|deleteStudent|assignStudents|unassign|batchAssign|apiPost|apiPatch|apiDelete)\s*\(/
  const writes = []
  for (const f of UI) {
    const src = readFileSync(join(ROOT, f), 'utf8')
    const fnRe = /async function (\w+)\s*\([^)]*\)\s*\{/g
    for (const m of src.matchAll(fnRe)) {
      const body = src.slice(m.index + m[0].length, m.index + m[0].length + 3000)
      if (!WRITE_FN.test(body)) continue
      writes.push({ file: rel(f), fn: m[1], line: src.slice(0, m.index).split('\n').length, body })
    }
  }

  if (!writes.length) {
    return record(7, name, 'SKIP', [
      '未匹配到调用写接口的函数',
      '⚠️ 可能是页面结构变了、判据过时了 —— 请人工确认，不要默认通过',
    ])
  }
  ev.push(`识别到写操作函数 ${writes.length} 个（判据：函数体调用写接口 POST/PATCH/DELETE）`)

  // ── 7a 按钮侧：裸<button type="submit"> 必须显式 disabled ──
  let missBtn = 0
  for (const f of UI) {
    const src = readFileSync(join(ROOT, f), 'utf8')
    const lines = src.split('\n')
    lines.forEach((line, i) => {
      if (!/type="submit"/.test(line)) return
      // 往上并 4 行：JSX 属性常跨行写，且要判断是 <AsyncButton> 还是裸 <button>
      const start = Math.max(0, i - 4)
      const ctx = lines.slice(start, i + 1).join(' ')
      const tagStart = ctx.lastIndexOf('<')
      const isAsyncButton = /<AsyncButton/.test(ctx.slice(tagStart))
      // AsyncButton 内部自带 disabled（AsyncButton.jsx:32），不需要显式传
      if (isAsyncButton) return
      if (!/<button/.test(ctx.slice(tagStart))) return
      if (!/disabled=/.test(ctx)) {
        ev.push(`❌ ${rel(f)}:${i + 1} 裸 <button type="submit"> 没有 disabled —— 鼠标连点会重复提交`)
        missBtn++
      }
    })
  }
  ev.push(missBtn ? '' : '裸 submit 按钮：全部带 disabled ✅（AsyncButton 自带禁用，不计入）')

  // ── 7b 函数侧：写操作函数开头必须有 if (busy) return ──
  //
  // 第三轮再收敛（去掉最后一批噪音）：先判断这个函数的**触发入口**能不能连点。
  //   ·拖拽触发（函数体读 e.dataTransfer / 名字以 drop 开头）→ 物理上无法连点，豁免
  //   · 触发它的按钮已带 disabled → 鼠标连点已被挡住，豁免
  //   · 其余（裸 button onClick 无 disabled、onSubmit 表单）→ 必须有 if (busy) return
  //
  //   理由：守卫的意义是「挡住 disabled 挡不住的路径」（回车 / 程序调用）。
  //   如果入口本来就点不动，加守卫是纯洁癖，报出来只会让人忽略真问题。
  const buttonDisabled = new Map() // 函数名 → 该按钮是否带 disabled
  for (const f of UI) {
    const src = readFileSync(join(ROOT, f), 'utf8')
    const lines = src.split('\n')
    lines.forEach((line, i) => {
      const m = line.match(/onClick=\{(\w+)\}/)
      if (!m) return
      const ctx = lines.slice(Math.max(0, i - 3), i + 1).join(' ')
      buttonDisabled.set(m[1], /disabled=/.test(ctx))
    })
  }

  const exempt = []
  let missGuard = 0
  let guarded = 0
  for (const w of writes) {
    const head = w.body.split('\n').slice(0, 12).join('\n')
    if (/if\s*\(\s*busy\s*\)\s*return/.test(head)) { guarded++; continue }

    const isDrop = /e\.dataTransfer/.test(w.body) || /^drop/.test(w.fn)
    const btnHas = buttonDisabled.get(w.fn) === true
    const btnOff = buttonDisabled.get(w.fn) === false // 有 onClick 但没 disabled
    const btnKnown = buttonDisabled.has(w.fn)

    if (isDrop) {
      exempt.push(`${w.fn}() —— 拖拽触发（读 e.dataTransfer），无法连点`)
      guarded++
      continue
    }
    if (btnHas) {
      exempt.push(`${w.fn}() —— 触发按钮已带 disabled，鼠标连点已被挡住`)
      guarded++
      continue
    }
    ev.push(`❌ ${w.file}:${w.line} ${w.fn}() 调写接口、入口也没禁用，但开头没有 if (busy) return`)
    if (btnOff) ev.push(`   （它的触发按钮 <button onClick={${w.fn}}> 连 disabled 都没写 —— 两件套全缺）`)
    else ev.push(`   （未找到它的触发按钮，可能由 onSubmit 触发 —— 回车键能绕过）`)
    missGuard++
  }
  ev.push(`写操作函数：${writes.length} 个 → ${guarded} 个已防连点 / ${missGuard} 个缺失`)
  if (exempt.length) ev.push(...exempt.map((e) => `   豁免：${e}`))

  if (!missBtn && !missGuard) return record(7, name, 'PASS', ev.filter(Boolean))
  ev.push('→ 两件套缺一不可：disabled 挡鼠标点击，if (busy) return 挡回车 / 程序调用')
  return record(7, name, 'FAIL', ev.filter(Boolean))
}

// ── 8. 仓库换行符为 LF ───────────────────────────────────────
// ⚠️ Day 25 第二轮修正（误报 3）：
//   初版把 停止小助手.bat / 启动小助手.bat 报成污染。
//   真相：Windows 批处理文件**必须**是 CRLF，LF 会导致解析出错——
//   这两个是 Day 25 真跑才学到的平台约束，不是污染源。
//   现在按扩展名区分：源码 / 文档必须 LF，.bat/.cmd 必须 CRLF。
const MUST_BE_CRLF = new Set(['.bat', '.cmd'])

function check8() {
  const name = '仓库换行符为 LF'
  const ev = []

  const files = hasGit()
    ? (git(['ls-files', '-z']) || '').split('\0').filter(Boolean)
    : sourceFiles(null).map(rel)

  if (!files.length) return record(8, name, 'SKIP', ['未找到可扫描的文件'])

  const shouldLF = []
  const shouldCRLF = []
  for (const f of files) {
    const abs = join(ROOT, f)
    if (!existsSync(abs) || statSync(abs).size > 4 * 1024 * 1024) continue
    const buf = readFileSync(abs)
    if (buf.includes(0)) continue // 二进制跳过
    const ext = f.slice(f.lastIndexOf('.')).toLowerCase()
    ;(MUST_BE_CRLF.has(ext) ? shouldCRLF : shouldLF).push([f, buf.includes(Buffer.from('\r\n'))])
  }

  const badLF = shouldLF.filter(([, has]) => has).map(([f]) => f)
  const badCRLF = shouldCRLF.filter(([, has]) => !has).map(([f]) => f)

  ev.push(`扫描范围：${hasGit() ? '已跟踪文件' : '项目源码文件（无 git，退化为全量）'}，共 ${files.length} 个`)
  ev.push(`应LF 的 ${shouldLF.length} 个 / 应 CRLF 的 ${shouldCRLF.length} 个（.bat .cmd：Windows 批处理必须 CRLF）`)

  if (badLF.length) {
    ev.push(`❌ ${badLF.length} 个源码/文档文件含 CRLF：`)
    ev.push(...badLF.slice(0, 10).map((f) => `   ${f}`))
    ev.push('→ 用 Python open(f,"w") 改文件会写成 CRLF，git diff 每行都算改动')
    return record(8, name, 'FAIL', ev)
  }
  if (badCRLF.length) {
    ev.push(`❌ ${badCRLF.length} 个批处理文件是 LF（应为 CRLF）：`)
    ev.push(...badCRLF.map((f) => `   ${f}`))
    ev.push('→ Windows 批处理用 LF 会解析出错')
    return record(8, name, 'FAIL', ev)
  }
  ev.push('源码/文档全部 LF ✅ 批处理全部 CRLF ✅')
  return record(8, name, 'PASS', ev)
}

// ── 9. 带 id 的接口用查询参数 ────────────────────────────────
function check9() {
  const name = '带 id 的接口用查询参数'
  const ev = []
  const FN = ['cloudfunctions/api-rooms/index.js', 'cloudfunctions/api-students/index.js', 'cloudfunctions/health/index.js']
    .filter((f) => existsSync(join(ROOT, f)))

  if (!FN.length) return record(9, name, 'SKIP', ['未找到云函数入口文件'])

  const pathParams = []
  for (const f of FN) {
    const src = readFileSync(join(ROOT, f), 'utf8')
    src.split('\n').forEach((line, i) => {
      const t = line.trim()
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return // 注释里解释 /:id 是正常的
      if (/['"`][^'"`]*\/api\/[a-z-]+\/:[a-zA-Z]/.test(line)) {
        pathParams.push(`${f}:${i + 1} ${t.slice(0, 90)}`)
      }
    })
  }

  const qHits = FN.flatMap((f) => findLines(join(ROOT, f), /[?&](id|camp_id)=|\?id=|\?camp_id=/))
  ev.push(`路径参数路由（代码行，已排除注释）：${pathParams.length} 处`)
  ev.push(`查询参数用法：${qHits.length} 处`)
  if (pathParams.length) {
    ev.push(...pathParams.slice(0, 4))
    ev.push('→ 控制台 Path passthrough = Disable，/:id 传不进云函数')
    return record(9, name, 'FAIL', ev)
  }
  if (!qHits.length) {
    ev.push('⚠️ 既没找到路径参数也没找到查询参数——本项可能已失效，建议人工确认')
    return record(9, name, 'SKIP', ev)
  }
  ev.push('全部走 ?id= &camp_id= ✅')
  return record(9, name, 'PASS', ev)
}

// ── 主流程 ─────────────────────────────────────────────────────
const results = []
function record(id, name, status, evidence) { results.push({ id, name, status, evidence }) }

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
}

console.log(`${C.bold}${C.cyan}xinghe-helper 发布前检查${C.reset}`)
console.log(`${C.dim}项目根：${ROOT}${C.reset}`)
console.log(`${C.dim}检查项来源：Day 19-24 真实踩坑记录${C.reset}\n`)

const checks = [check1, check2, check3, check4, check5, check6, check7, check8, check9]
for (const fn of checks) {
  try {
    fn()
  } catch (e) {
    record('?', '检查项自身异常', 'FAIL', [`未捕获异常：${e.message}`])
  }
}

const ICON = {
  PASS: `${C.green}PASS${C.reset}`,
  FAIL: `${C.red}FAIL${C.reset}`,
  SKIP: `${C.yellow}SKIP${C.reset}`,
}
for (const r of results) {
  console.log(`${ICON[r.status]}  ${r.id}. ${r.name}`)
  for (const e of r.evidence) console.log(`      ${C.dim}${e}${C.reset}`)
  console.log('')
}

const pass = results.filter((r) => r.status === 'PASS')
const fail = results.filter((r) => r.status === 'FAIL')
const skip = results.filter((r) => r.status === 'SKIP')

console.log(`${C.bold}汇总：${C.green}${pass.length} PASS${C.reset} · ${fail.length ? C.red : C.dim}${fail.length} FAIL${C.reset}${skip.length ? ` · ${C.yellow}${skip.length} SKIP${C.reset}` : ''}\n`)
if (fail.length) {
  console.log(`${C.red}有 FAIL 项，不要发布。先修再跑。${C.reset}`)
} else if (skip.length) {
  console.log(`${C.yellow}无 FAIL，但有 SKIP 项未验证——SKIP 不等于通过。${C.reset}`)
} else {
  console.log(`${C.green}全部通过，可以发布。${C.reset}`)
}
console.log(`${C.dim}提示：检查项本身也可能写错。跑出意料结果，先怀疑检查项，再怀疑项目。${C.reset}`)

process.exit(fail.length ? 1 : 0)