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

module.exports = { ok, fail, respond, originOf }