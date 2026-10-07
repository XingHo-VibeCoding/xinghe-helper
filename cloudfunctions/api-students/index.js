// Day 17|GET /api/students —— 学生列表读取(契约 2.4)
//
// 这个接口做什么?
//   把当前营期的「有效」学生记录读出来,给工作台(左侧未分配名单、房间成员)
//   和总览页渲染用。
//
// 数据从哪来?
//   从我们自己数据库的 public.students 表读 —— 这是学生在表单页提交的真实数据。
//
// 契约要求:
//   · Query 参数 camp_id 必填(MVP 恒为 1)
//   · 只返回 is_latest = true 的记录(同一人重复提交时,旧记录不算数)
//   · 按 id 升序
//   · 错误:400 MISSING_CAMP_ID
//
// 为什么只取 is_latest?
//   学生在表单页可能重复提交(比如改错了信息再交一次)。我们保留全部提交痕迹,
//   但「当前有效」的只有最新那条。工作台只该看最新的。

const { db } = require('./db.js')
const { ok, fail } = require('./response.js')

exports.main = async (event) => {
  // ---- 1. 取参数,做校验 ----
  const rawCampId =
    event?.queryStringParameters?.camp_id ??
    event?.camp_id ??
    undefined

  const campId = Number(rawCampId)

  if (!rawCampId || !Number.isInteger(campId) || campId <= 0) {
    return fail(400, 'MISSING_CAMP_ID', '缺少必填参数 camp_id(必须是正整数)')
  }

  // ---- 2. 查数据库 ----
  // SQL 参数化:campId 和 is_latest 都用 .eq() 交给 SDK 作为参数绑定,
  // 不手工拼 SQL 字符串,避免 SQL 注入。
  try {
    const { data, error } = await db
      .from('students')
      .select('*')
      .eq('camp_id', campId)
      .eq('is_latest', true)
      .order('id', { ascending: true })

    if (error) {
      console.error('[api-students] 查询失败:', error)
      return fail(500, 'DB_ERROR', '读取学生失败:' + (error.message || '数据库返回错误'))
    }

    // ---- 3. 返回统一形状 ----
    return ok(data ?? [])
  } catch (err) {
    console.error('[api-students] 异常:', err)
    return fail(500, 'INTERNAL_ERROR', '服务器内部错误:' + (err.message || '未知异常'))
  }
}
