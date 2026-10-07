// Day 15|第一个云函数:健康检查(health)
// 它只做一件事——被访问时回答"我还在线",不做任何业务。
// 作用:后面每加一个接口,都能用它先确认"云端通了没有",把"网络问题"和
//       "我代码写错了"这两件事分开排查。
//
// Day 20 改动:加上 CORS 白名单。
//   为什么健康检查也需要 CORS?
//   前端 Day 20 起接了公网接口,页面加载时会先打/api/health 判断"云端通没通"。
//   页面在*.tcloudbaseapp.com,接口在 *.service.tcloudbase.com,域名不同,
//   浏览器不拿到 CORS 响应头就会拦掉这个响应 —— 于是前端永远看到"不在线",
//   而其实是好的。所以这里也要按白名单回响应头。
//   ⚠️ 三个云函数目录各有一份 cors.js 副本(CloudBase 只打包各自目录),
//      改白名单时记得三处同步。

const { corsHeaders } = require('./cors.js')

exports.main = async (event, context) => {
  // origin 从请求头里取(浏览器发跨域请求时才会带上)。
  const origin = event?.headers?.origin ?? event?.headers?.Origin ?? undefined

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(origin),
    },
    body: JSON.stringify({
      ok: true,
      service: 'xinghe-helper',
    }),
  }
}