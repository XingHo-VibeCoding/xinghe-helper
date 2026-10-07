// Day 15|第一个云函数:健康检查(health)
// 它只做一件事——被访问时回答"我还在线",不做任何业务。
// 作用:后面每加一个接口,都能用它先确认"云端通了没有",把"网络问题"和
//       "我代码写错了"这两件事分开排查。
//
// 为什么返回这么个奇怪的对象?
// CloudBase 的规则:返回值里只要带 statusCode 字段,就按"集成响应"处理,
// 我们就能精确控制 HTTP 状态码和响应头(这里告诉浏览器返回的是 JSON)。
// 注意 body 必须是「字符串」,所以要 JSON.stringify 一下。

exports.main = async (event, context) => {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      ok: true,
      service: 'xinghe-helper',
    }),
  }
}
