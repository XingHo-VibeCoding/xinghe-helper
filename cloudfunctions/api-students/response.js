// Day 17|统一响应工具(_shared/response.js)
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

// 成功响应
function ok(data) {
  return respond(200, { ok: true, data, error: null })
}

// 失败响应:httpStatus 是 HTTP 状态码,code 是给程序看的错误码,message 是给人看的
function fail(httpStatus, code, message) {
  return respond(httpStatus, {
    ok: false,
    data: null,
    error: { code, message },
  })
}

// 两个函数共用的「拼装 HTTP 响应」动作
function respond(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // 跨域:前端部署在 *.tcloudbaseapp.com,接口在 *.service.tcloudbase.com,
      // 域名不同,浏览器会拦。这里放开,浏览器才允许页面读接口。
      // (契约第 4 节预告的问题,就在这里解决)
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
    body: JSON.stringify(payload),
  }
}

module.exports = { ok, fail }
