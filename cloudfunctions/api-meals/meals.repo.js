// 订餐数据访问层(meals.repo.js) —— api-meals 函数的私有副本
//
// 分层规矩同 students.repo.js:数据库查询集中在这里,index.js 里不出现 db.from(...)。
//
// ⚠️⚠️ 为什么判重不用数据库 on conflict,而是「先查后写 + 兜底」:
//   本环境的数据库访问走 app.rdb()(CloudBase 平台网关,PostgREST 风格),
//   它的 upsert(onConflict) 只支持「按列名」推断冲突目标。
//   而 meal_orders 的判重索引是**表达式索引**(coalesce 把 NULL 归一成空串,
//   见 db/meal_orders.sql)—— 工作人员的 teacher/class_level 是 NULL,
//   PostgREST 塞不了这种表达式,硬写会报「没有匹配的唯一约束」。
//
//   所以判重分两层:
//     第一层(应用层):先查有没有同一人的记录 → 有就 update,没有就 insert;
//     第二层(数据库):唯一索引是最终防线 —— 两个人同一毫秒提交,
//       都查到「没有」时,后到的 insert 会被索引拦下,此时走兜底:重查一次再 update。
//   这样并发下也不会出现重复记录(索引兜底),常规路径又是两次轻量请求(应用层)。
//
// ⚠️ 写权限说明:与 students 表同款风险 —— anon 写权限开着,拿到接口链接的人
//   都能提交订餐。当前阶段(演示数据)可接受;接真实数据前必须收权限+加校验。

const { db } = require('./db.js')

// ============================================================
// 读:某一天的全部订单(汇总页主查询)
// ============================================================
// 只选汇总需要的列,不把整个行搬回来。
// 汇总的「15 个班 / 3 个部门全列出、没人的显示 0」由 index.js 聚合时补齐
// (数据量一天几十条,拉回来在 JS 里数数比拼 SQL 聚合函数稳 ——
// 平台网关对 PostgREST 聚合语法的支持不完整,不赌)。
async function findByDate(campId, mealDate) {
  const { data, error } = await db
    .from('meal_orders')
    .select('role, name, teacher, class_level, department, lunch, dinner')
    .eq('camp_id', campId)
    .eq('meal_date', mealDate)
    .order('id', { ascending: true })

  return { data, error }
}

// ============================================================
// 读:有订餐记录的日期列表(汇总页切日期用)
// ============================================================
// PostgREST 风格不支持 select distinct —— 只把 meal_date 一列全拉回来,
// 在 JS 里去重 + 排序。订餐只发生在营期那十几天,行数很小,不值得为它赌平台行为。
async function listDates(campId) {
  const { data, error } = await db
    .from('meal_orders')
    .select('meal_date')
    .eq('camp_id', campId)

  return { data, error }
}

// ============================================================
// 读:找「同一个人同一天的同一条订单」(判重)
// ============================================================
// 学生按 姓名+老师+年级,工作人员按 姓名+部门(方案文档 4.2,用户拍板不加手机号)。
// 交叉约束(数据库 CHECK)保证 student 行的 department 必为 NULL、staff 行的
// teacher/class_level 必为 NULL,所以按角色过滤分组字段不会误配到另一拨人。
async function findSameOrder(row) {
  let q = db
    .from('meal_orders')
    .select('id, lunch, dinner')
    .eq('camp_id', row.camp_id)
    .eq('meal_date', row.meal_date)
    .eq('role', row.role)
    .eq('name', row.name)

  if (row.role === 'student') {
    q = q.eq('teacher', row.teacher).eq('class_level', row.class_level)
  } else {
    q = q.eq('department', row.department)
  }

  return q.maybeSingle()
}

// ============================================================
// 写:更新已有订单的两顿选择(重复提交 → 覆盖,与住宿页行为一致)
// ============================================================
async function updateChoice(id, lunch, dinner) {
  const { data, error } = await db
    .from('meal_orders')
    .update({ lunch, dinner })
    .eq('id', id)
    .select('id')
    .single()

  return { data, error }
}

// ============================================================
// 写:插入一条新订单
// ============================================================
// 只写调用方组装好的字段,不整对象透传 —— 免得 body 里混进什么就往库里塞什么。
// role/teacher/class_level/department 的组合合法性由两层保证:
//   index.js 提前校验(给人话报错) + 数据库 CHECK meal_role_fields_consistent(兜底)。
async function insertOne(row) {
  const { data, error } = await db
    .from('meal_orders')
    .insert({
      camp_id: row.camp_id,
      meal_date: row.meal_date,
      role: row.role,
      name: row.name,
      teacher: row.teacher ?? null,
      class_level: row.class_level ?? null,
      department: row.department ?? null,
      lunch: row.lunch,
      dinner: row.dinner,
    })
    .select('id')
    .single()

  return { data, error }
}

module.exports = { findByDate, listDates, findSameOrder, updateChoice, insertOne }
