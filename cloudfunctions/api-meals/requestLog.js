// Day 23 余力加练|请求日志(requestLog.js) —— 每个云函数各一份副本
//
// 清单要求：「加一条简单的请求日志(时间、路径、结果)」。
//
// 为什么单独一个文件、而不是在 main() 里手写 console.log?
//   因为要在**两个云函数**里都加(api-rooms / api-students),
//   而 CloudBase 只打包函数自己的目录 —— 跨目录 require('../shared/xxx.js')
//   在云端拿不到。所以逻辑写在这里,两份副本保持一致(同cors.js 的约束)。
//
// 记什么、不记什么(这是这个模块唯一需要想清楚的事):
//   记:时间 · 方法+路径 · 状态码 · 成功还是失败 · 失败时的错误码 · 耗时
//   不记:请求 body、请求头、Origin、任何用户数据
//
//   ⚠️ 为什么 body 不能记 —— body 里有学生的姓名、性别、老师、备注。
//     Day 20 刚把 anon 写权限打开(见 db/grant-write.sql),
//     日志能看到的东西比接口返回的还多。把 body 写进日志等于开一个
//     「绕过接口、直接读学生信息」的通道 —— 那今天的密钥排查就白做了。
//   ⚠️ Origin 也不记 —— 它是浏览器带来的域名,记它没有排查价值,
//     却会多存一份「谁访问过」的记录。同样的道理。
//
// 时间用东八区(北京/深圳)而不是 UTC:
//   CloudBase 日志默认按 UTC 显示,但你看日志时是本地时间,
//   对不上时间会让人怀疑「这请求是什么时候发的」。写本地时间省事。
//
// 耗时为什么值得记:
//   Day 20 卡在「部署没生效」那次,真正花时间的是「猜哪一步慢了」。
//   有耗时数据,下次一眼能看出是数据库慢还是网络慢。

// 把 Date 对象格式化成 '2026-10-09 11:23:45'
// 注意 month 要 +1 —— JavaScript 的月份从 0 开始,而 0 月不存在,极易写错。
function formatTime(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// 从 event 里拼出「方法 路径?查询串」
// 注意:这里只取 path 和 query,**不碰 body 和 headers** —— 理由见文件顶部注释。
function lineOf(event, method) {
  const path = event?.path || event?.requestContext?.http?.path || '(unknown)'
  const qs = event?.queryStringParameters
  const query = qs && Object.keys(qs).length
    ? '?' + Object.entries(qs).map(([k, v]) => `${k}=${v}`).join('&')
    : ''
  return `${method} ${path}${query}`
}

// 主函数:包住 handler,自动记一条日志
//
// 用法(在 main() 里):
//   return logRequest(event, async () => {
//     if (method === 'POST') return createRoom(event, origin)
//     ...
//   })
//
// 为什么用「包一层」而不是在每个业务函数里手写 console.log:
//   12 个接口各写一遍 = 12 个可能忘的地方,漏一个就少一条日志。
//   在 main() 包一层 = **一处覆盖全部接口**,以后新增接口自动有日志。
//   这个思路和 Day 23 改裸报错时一样:修在源头,不逐处打补丁。
async function logRequest(event, handler) {
  const method = String(event?.httpMethod || 'GET').toUpperCase()
  const startedAt = Date.now()
  const line = lineOf(event, method)

  try {
    const res = await handler()
    const ms = Date.now() - startedAt

    // 从统一信封里读 ok 和 error.code —— Day 17 起所有接口都返回这个形状,
    // 所以日志格式天然统一,不用给每个接口单独传「成功还是失败」。
    let okFlag = '?'
    let errCode = ''
    try {
      const payload = JSON.parse(res?.body || '{}')
      okFlag = payload.ok ? 'OK' : 'FAIL'
      errCode = payload.error?.code ? ` code=${payload.error.code}` : ''
    } catch {
      // 预检响应(204)的 body 是空字符串,JSON.parse 会失败 —— 这不是错误,
      // 留 '?' 表示「不适用」。catch 里不做别的,因为这里没有任何可恢复的余地。
    }

    console.log(`[${formatTime(new Date())}] ${line} -> ${res?.statusCode ?? '-'} ${okFlag}${errCode} ${ms}ms`)
    return res
  } catch (err) {
    // 走到这里说明业务函数自己抛了异常(没被fail()接住)。
    //   这种错误通常就是 Day 23 上午排查的那类问题,必须记下来,
    //   否则它只在浏览器里显示一句「服务器内部错误」,云端没有任何线索。
    const ms = Date.now() - startedAt
    console.error(`[${formatTime(new Date())}] ${line} -> 抛异常 ${ms}ms : ${err?.message || err}`)
    throw err
  }
}

module.exports = { logRequest, formatTime, lineOf }
