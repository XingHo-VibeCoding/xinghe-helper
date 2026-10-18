// Day 20|CORS 白名单(cors.js) —— 三个云函数共用的副本
//
// Day 17/18 时这里是 'Access-Control-Allow-Origin': '*'(通配符,谁都能调)。
// Day 20 起改成白名单:只允许「自己的静态托管域名」+ 本地开发地址。
//
// 为什么必须收紧?(这不是洁癖,是安全边界)
//   anon 身份的写权限是开着的(见 db/grant-write.sql)。如果 Origin 是通配符,
//   那么任何网站都能在用户浏览器里发请求打到我们的接口 —— 攻击者只要诱导学生
//   打开一个恶意页面,就能往 students 表塞假报名、往 rooms 表塞垃圾房间。
//   收紧成白名单后,浏览器只允许我们自己的页面发跨域请求,这条利用链就断了。
//
// 为什么还要保留 OPTIONS?
//   浏览器在真正发请求前会先发一个「预检」OPTIONS,问服务器「我能不能访问」。
//   云函数收到 OPTIONS 要直接回「可以」,不能走业务逻辑(否则会当成查数据)。
//   —— 少了这一句,所有 POST 都会在浏览器里报 CORS 错误。
//
// ⚠️ 三个函数目录各有一份副本(CloudBase 只打包函数自己的目录),改的时候记得同步。
//
// 环境变量:
//   ALLOWED_ORIGINS —— 允许的来源,逗号分隔。留空则回退到下面的默认值。
//   ⚠️ 默认值里的域名是「本项目静态托管域名」。换环境时要改这里或设环境变量。

// 默认白名单：
//   · https://xinghe-helper-...tcloudbaseapp.com            —— 静态托管站点
//   · https://xinghe-helper-...-1499825718.tcloudbaseapp.com —— 实际生效的托管域名
//   · http://localhost:5173 / http://127.0.0.1:5173           —— vite dev server
//
//⚠️ 两个实测踩到的平台行为（换环境时务必重新验证）：
//
//   1) 静态托管有两个域名，正式域名和带数字后缀的那个。
//      实测正式域名（…d5g92pis442fd9947.tcloudbaseapp.com）返回 HTTP 418，
//      真正能打开的是带后缀的（…-1499825718.tcloudbaseapp.com）。
//      CloudBase 会把托管域名自动加进 CORS 白名单，但**代码里也要显式写上**，
//      别依赖这个自动行为 —— 平台升级或换环境时它不一定还有效。
//
//   2) CloudBase 网关对 localhost / 127.0.0.1 的**任意端口**都会回显
//      Access-Control-Allow-Origin，白名单里没写的端口也一样有。
//      这不影响生产（生产站点不是本地主机），
//      但要知道：本地开发时「有 CORS 头」不能证明白名单配置正确了。
//      判断白名单是否真的生效，要用**非本地**的域名做对照测试。
const DEFAULT_ORIGINS = [
  'https://xinghe-helper-d5g92pis442fd9947.tcloudbaseapp.com',
  'https://xinghe-helper-d5g92pis442fd9947-1499825718.tcloudbaseapp.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]

function allowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS
  if (!raw || !raw.trim()) return DEFAULT_ORIGINS
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

// 判断某个来源是否在白名单里
function isAllowed(origin) {
  if (!origin) return false
  return allowedOrigins().some((o) => o.toLowerCase() === String(origin).toLowerCase())
}

// 拼 CORS 响应头：允许就回具体域名，不允许就一个都不回（浏览器自然拦掉）
function corsHeaders(origin) {
  if (!isAllowed(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    // 不加 * ：明确告诉浏览器「只认这一个来源」
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    // 预检结果缓存 1 小时，减少OPTIONS 次数
    'Access-Control-Max-Age': '3600',
  }
}

// 预检请求：直接回 204，不进业务逻辑
function handlePreflight(event) {
  return {
    statusCode: 204,
    headers: corsHeaders(event?.headers?.origin ?? event?.headers?.Origin),
    body: '',
  }
}

module.exports = { corsHeaders, handlePreflight, isAllowed, allowedOrigins }