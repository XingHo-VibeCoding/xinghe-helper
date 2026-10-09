// Day 17|统一响应工具(response.js) —— 三个云函数各有一份副本
//
// 契约要求:所有接口的响应形状必须一致 —— { ok, data, error }
//   成功: { ok: true,  data: <数据>,  error: null }
//   失败: { ok: false, data: null,    error: { code, message } }
//
// 为什么统一?前端只需要写一套判断逻辑:
//   拿到响应先看 ok —— true 就用 data,false 就读 error.message 显示给人看。
//   不用每个接口各写一套解析。
//
// CloudBase 的规则(见 cloudfunctions/health/index.js 的注释):
//   返回值里带 statusCode 字段就按「集成响应」处理,能自己控制 HTTP 状态码和响应头;
//   body 必须是字符串,所以要 JSON.stringify。
//
// ⚠️ Day 20 改动:CORS 从通配符 '*' 收紧成白名单(见 cors.js)。
//   现在这里只负责「把 cors.js 算好的头拼上去」,不自己判断来源。

const { corsHeaders } = require('./cors.js')

// 成功响应
function ok(data, origin) {
  return respond(200, { ok: true, data, error: null }, origin)
}

// 失败响应:httpStatus 是 HTTP 状态码,code 是给程序看的错误码,message 是给人看的
function fail(httpStatus, code, message, origin) {
  return respond(httpStatus, {
    ok: false,
    data: null,
    error: { code, message },
  }, origin)
}

// ============================================================
// Day 23 新增|failServer() —— 服务端错误「对外只说人话」
// ============================================================
// 为什么要这个函数?改之前是这样写的:
//
//   return fail(500, 'DB_ERROR', '读取房间失败:' + error.message, origin)
//                        └──────────┬──────────┘
//                    把数据库的原始报错拼进了给人看的提示
//
// 问题在哪(这是今天真正要掌握的那道题):
//   数据库返回的原文可能是 { message: 'relation "rooms" does not exist' },
//   于是用户看到的就是:
//
//     读取房间失败:relation "rooms" does not exist
//
//   这句话把**内部实现细节**泄漏出去了 —— 表名、SQL 片段、字段名、约束名,
//   甚至连接串里的主机名可能也在里面。而拿到接口链接的人不需要绕过任何权限,
//   只要随便调一次接口就能看到。这和 Day 20 收紧 CORS、收回 anon 写权限
//   是同一类问题:别把不该给外人看的东西给出去。
//
// 改成什么:
//
//   failServer('读取房间失败', 'DB_ERROR', origin)   → 用户看到:「读取房间失败」
//   真实 error.message 照旧打进 console.error,只有云端日志能看见
//
// 为什么集中成一个函数、而不是 18 处逐个手改文案:
//   18 处散在两个文件里,手改容易漏、改得也不一致(有的加「请稍后重试」
//   有的没加)。收进响应层只有一处,以后新增接口天然就是安全的 ——
//   **默认安全,而不是靠每次记得写对。**
//
// ⚠️ 排查提示:真实报错去哪看?
//   每个调用点上面都有一行 console.error,云函数日志里能查到完整堆栈。
//   所以「用户只看到人话」不等于「错误信息丢了」,只是不给他看了。
function failServer(message, code = 'INTERNAL_ERROR', origin) {
  return fail(500, code, message, origin)
}

// 拼装 HTTP 响应
//   origin 是请求的来源(浏览器会带 Origin 头),交给 cors.js 判断能不能回。
function respond(statusCode, payload, origin) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // ⚠️ 不要再写 'Access-Control-Allow-Origin': '*' —— Day 20 已收紧为白名单,
      //    理由见 cors.js 顶部的安全说明。
      ...corsHeaders(origin),
    },
    body: JSON.stringify(payload),
  }
}

// 从 CloudBase 事件里取来源(不同触发方式字段位置不同,两处都找)
function originOf(event) {
  return event?.headers?.origin ?? event?.headers?.Origin ?? undefined
}

module.exports = { ok, fail, failServer, respond, originOf }