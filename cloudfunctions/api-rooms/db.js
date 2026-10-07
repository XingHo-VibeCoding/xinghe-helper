// Day 17|数据库连接模块(db.js)——本函数的私有副本
//
// 为什么要有这个文件?
//   说明:这份文件在两个函数目录下各有一份副本(api-rooms/db.js 与 api-students/db.js)。
//   为什么不放一个公共目录共享?因为 CloudBase 部署时只打包「函数自己的目录」,
//   目录外的文件不会被上传。所以宁可复制两份,保证每个函数都能独立部署。
//   改动时记得两边同步。
//
// 为什么用 app.rdb() 而不是 pg 包直连?
//   我们的环境是「体验版 + 共享型集群」,直连数据库的两条路(内网/外网)都被
//   套餐限制堵死了。app.rdb() 走的是 CloudBase 平台内部网关(/v1/rdb/rest):
//     · 不需要连接串、账号密码
//     · 不需要配安全组 / VPC
//   这是官方在体验版下的推荐做法。
//
// ⚠️ 关于 database 参数(踩过的坑,记下来):
//   SDK 源码里 rdb() 的默认值是 `database = envId`,也就是把「环境 ID」当成库名用。
//   但我们的真实库名不是环境 ID,而是 postgres-fnv0lCw —— 所以必须显式传进来,
//   否则接口会报 "Invalid schema: xinghe-helper-d5g92pis442fd9947"。
//   库名从「控制台 SQL 编辑器 → select current_database()」可以查到。
//   这里用环境变量 PG_DATABASE 承载,不硬编码在代码里(换环境时只改配置)。

const cloudbase = require('@cloudbase/node-sdk')

// cloudbase.init 不传 env 时,默认用「当前云函数所在的环境」。
// 这正好是我们想要的——不用把环境 ID 硬编码进代码。
const app = cloudbase.init({
  env: cloudbase.SYMBOL_CURRENT_ENV,
})

// app.rdb() 取到 PostgreSQL 数据库的查询入口。
// 它的用法和前端用的 Supabase 几乎一样(from / select / eq / order)。
//
// ⚠️ 又一个坑(第二个):options 里的 database 实际会被 SDK 塞进
//   Accept-Profile / Content-Profile 请求头,而这两个头在 PostgREST 体系里
//   指的是「schema 名」,不是「数据库名」。
//   我们的表建在 public schema 下(见 db/schema.sql),所以这里要传 public。
//   报错特征:若填成别的,会看到 "Invalid schema: xxx"。
const database = process.env.PG_SCHEMA || 'public'

const db = app.rdb({ instance: 'default', database })

module.exports = { app, db }
