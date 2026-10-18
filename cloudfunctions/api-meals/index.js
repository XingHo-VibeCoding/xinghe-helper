// /api/meals —— 订餐接口(契约见 docs/订餐统计-方案文档.md 第 5 节)
//
// 分流规则(看 event.httpMethod 和 query 里的 action):
//   POST /api/meals                                  → 提交订单(学生与工作人员同一接口,靠 role 区分)
//   GET  /api/meals?action=summary&meal_date=YYYY-MM-DD → 按天汇总
//   GET  /api/meals?action=dates                      → 有订餐记录的日期列表
//
// 【防混码的最后一道闸】
//   前端两张页面各自把 role 写死('student' / 'staff'),表单里没有这个选项。
//   但接口是公开的 —— 任何拿到链接的人都能直接 POST。
//   所以服务端必须自己校验 role 与字段组合的自洽性:
//     学生     → 必须带 teacher + class_level,且不带 department
//     工作人员 → 必须带 department,且不带 teacher / class_level
//   不满足直接 400,报错说人话(「学生订餐不用填部门」),不透数据库约束名。
//   数据库还有一层 CHECK(meal_role_fields_consistent)兜底,两层各管各的:
//   接口层管「报错好看」,数据库管「脏数据绝对进不来」。
//
// 【15 个班 / 3 个部门全列出】
//   汇总时按 TEACHERS × CLASSES / DEPARTMENTS 的固定顺序补零 ——
//   组织者要能分清「今天没人订」和「这个班不存在」,方案文档 5.2 的统计口径。
//
// 分层规矩同 api-students:index.js 不出现 db.from(...),查询全在 meals.repo.js。

const mealsRepo = require('./meals.repo.js')
const { ok, fail, failServer, originOf } = require('./response.js')
const { handlePreflight } = require('./cors.js')
const { logRequest } = require('./requestLog.js')

// 与前端 StudentForm.jsx / MealOrderForm.jsx、db/meal_orders.sql 三处对齐的固定选项。
// 三处口径不一致是这类功能最常见的 bug 来源:学生页改了选项、汇总页还按老选项分组,
// 于是某个班凭空消失。改任何一处,三处一起改。
const TEACHERS = ['Mona', 'Kiven', 'Selena', 'Betty', 'Priya']
const CLASSES = ['星一', '星二', '星三']
const DEPARTMENTS = ['教学部', '市场部', '其他部门']

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// CloudBase 不同触发方式下 body 可能是字符串也可能是对象
function parseBody(event) {
  const raw = event?.body
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function readPositiveInt(value) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

// 日期必须真实存在(2027-02-30 这种要拦下),不只看格式
function readValidDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return null
  const d = new Date(`${value}T00:00:00`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null
  return value
}

// ============================================================
// 入口:按方法 + action 分流
// ============================================================
exports.main = async (event) => {
  const method = String(event?.httpMethod || 'GET').toUpperCase()
  const origin = originOf(event)
  const action = String(event?.queryStringParameters?.action || event?.action || '').trim()

  // 预检:浏览器正式请求前会先发 OPTIONS,直接回,不进业务
  if (method === 'OPTIONS') return handlePreflight(event)

  return logRequest(event, async () => {
    try {
      if (method === 'POST') return await submitMeal(event, origin)

      if (method === 'GET') {
        if (action === 'summary') return await summary(event, origin)
        if (action === 'dates') return await dates(event, origin)
        return fail(400, 'BAD_ACTION', '缺少 action 参数,可用值:summary / dates', origin)
      }

      return fail(405, 'METHOD_NOT_ALLOWED', '这个接口只支持 GET 和 POST', origin)
    } catch (err) {
      // 兜底也走 failServer,不能把 err.message 拼给人看
      console.error('[meals] 未捕获异常:', err)
      return failServer('服务器开小差了,请稍后重试', 'INTERNAL_ERROR', origin)
    }
  })
}

// ============================================================
// POST:提交订单
// ============================================================
async function submitMeal(event, origin) {
  const body = parseBody(event)

  const campId = readPositiveInt(body.camp_id)
  if (!campId) return fail(400, 'MISSING_CAMP_ID', '缺少营期参数,请重新打开二维码进入', origin)

  const mealDate = readValidDate(body.meal_date)
  if (!mealDate) return fail(400, 'INVALID_MEAL_DATE', '日期不对,请重新扫今天的二维码', origin)

  const role = body.role
  if (role !== 'student' && role !== 'staff') {
    return fail(400, 'INVALID_ROLE', '身份不对,学生和工作人员要走各自那个二维码', origin)
  }

  const name = String(body.name ?? '').trim()
  if (!name) return fail(400, 'MISSING_NAME', '名字没填,请填上真实姓名再提交', origin)
  if (name.length > 50) return fail(400, 'NAME_TOO_LONG', '名字太长了,请填真实姓名', origin)

  if (typeof body.lunch !== 'boolean' || typeof body.dinner !== 'boolean') {
    return fail(400, 'INVALID_MEAL_CHOICE', '午饭晚饭必须明确选「订」或「不订」,不能空着', origin)
  }

  // ---- role 与字段组合的自洽校验(防混码核心,见文件头说明) ----
  let teacher = null
  let classLevel = null
  let department = null

  if (role === 'student') {
    teacher = body.teacher
    classLevel = body.class_level
    if (body.department !== undefined && body.department !== null && body.department !== '') {
      return fail(400, 'ROLE_FIELDS_MISMATCH', '学生订餐不用填部门,请用学生那个二维码', origin)
    }
    if (!TEACHERS.includes(teacher)) {
      return fail(400, 'INVALID_TEACHER', '老师选项不对,请重新选择', origin)
    }
    if (!CLASSES.includes(classLevel)) {
      return fail(400, 'INVALID_CLASS', '班级选项不对,请重新选择', origin)
    }
  } else {
    department = body.department
    if (
      (body.teacher !== undefined && body.teacher !== null && body.teacher !== '') ||
      (body.class_level !== undefined && body.class_level !== null && body.class_level !== '')
    ) {
      return fail(400, 'ROLE_FIELDS_MISMATCH', '工作人员订餐不用填老师和班级,请用工作人员那个二维码', origin)
    }
    if (!DEPARTMENTS.includes(department)) {
      return fail(400, 'INVALID_DEPARTMENT', '部门选项不对,请重新选择', origin)
    }
  }

  const row = {
    camp_id: campId,
    meal_date: mealDate,
    role,
    name,
    teacher,
    class_level: classLevel,
    department,
    lunch: body.lunch,
    dinner: body.dinner,
  }

  // ---- 判重:先查后写,insert 被索引拦下时走兜底(见 repo 顶部说明) ----
  const existing = await mealsRepo.findSameOrder(row)
  if (existing?.data?.id) {
    const upd = await mealsRepo.updateChoice(existing.data.id, row.lunch, row.dinner)
    if (upd.error) {
      console.error('[meals] 更新已有订单失败:', upd.error)
      return failServer('保存没成功,请再试一次', 'DB_ERROR', origin)
    }
    return ok({ id: upd.data.id, updated: true }, origin)
  }

  const ins = await mealsRepo.insertOne(row)
  if (ins.error) {
    // 并发兜底:两人同一毫秒提交同一人,后到的 insert 撞唯一索引。
    // 重查一次,查到就改成 update —— 数据库索引保证不会出现两条重复记录。
    const retry = await mealsRepo.findSameOrder(row)
    if (retry?.data?.id) {
      const upd = await mealsRepo.updateChoice(retry.data.id, row.lunch, row.dinner)
      if (upd.error) {
        console.error('[meals] 并发兜底更新失败:', upd.error)
        return failServer('保存没成功,请再试一次', 'DB_ERROR', origin)
      }
      return ok({ id: upd.data.id, updated: true }, origin)
    }
    console.error('[meals] 插入订单失败(非并发冲突):', ins.error)
    return failServer('保存没成功,请稍后再试', 'DB_ERROR', origin)
  }

  return ok({ id: ins.data.id, updated: false }, origin)
}

// ============================================================
// GET ?action=summary&meal_date= —— 按天汇总
// ============================================================
async function summary(event, origin) {
  const q = event?.queryStringParameters || {}
  const campId = readPositiveInt(q.camp_id ?? q.query?.camp_id)
  if (!campId) return fail(400, 'MISSING_CAMP_ID', '缺少必填参数(必须是正整数)', origin)

  const mealDate = readValidDate(q.meal_date)
  if (!mealDate) return fail(400, 'INVALID_MEAL_DATE', '日期格式不对,应为 YYYY-MM-DD', origin)

  const { data, error } = await mealsRepo.findByDate(campId, mealDate)
  if (error) {
    console.error('[meals] 读取订单失败:', error)
    return failServer('读取订餐汇总失败', 'DB_ERROR', origin)
  }

  // ---- 在 JS 里聚合(平台网关对 SQL 聚合支持不完整,数据量小,不赌) ----
  // 学生:按 老师+年级 分组;工作人员:按部门分组。
  // 班级/部门按固定顺序补零 —— 「没人订」和「班不存在」要在页面上分得清。
  const classMap = new Map()
  const deptMap = new Map()
  let sLunch = 0
  let sDinner = 0
  let sPeople = 0
  let tLunch = 0
  let tDinner = 0
  let tPeople = 0

  for (const r of data || []) {
    if (r.role === 'student') {
      sPeople += 1
      if (r.lunch) sLunch += 1
      if (r.dinner) sDinner += 1
      const key = `${r.teacher}|${r.class_level}`
      const item = classMap.get(key) || { teacher: r.teacher, class_level: r.class_level, lunch: 0, dinner: 0 }
      if (r.lunch) item.lunch += 1
      if (r.dinner) item.dinner += 1
      classMap.set(key, item)
    } else if (r.role === 'staff') {
      tPeople += 1
      if (r.lunch) tLunch += 1
      if (r.dinner) tDinner += 1
      const item = deptMap.get(r.department) || { department: r.department, lunch: 0, dinner: 0 }
      if (r.lunch) item.lunch += 1
      if (r.dinner) item.dinner += 1
      deptMap.set(r.department, item)
    }
  }

  // 固定顺序 + 补零(没出现的班/部门补 0)
  const classes = TEACHERS.flatMap((t) =>
    CLASSES.map((c) => {
      const hit = classMap.get(`${t}|${c}`)
      return { teacher: t, class_level: c, lunch: hit?.lunch ?? 0, dinner: hit?.dinner ?? 0 }
    }),
  )
  const departments = DEPARTMENTS.map((d) => {
    const hit = deptMap.get(d)
    return { department: d, lunch: hit?.lunch ?? 0, dinner: hit?.dinner ?? 0 }
  })

  return ok(
    {
      meal_date: mealDate,
      student: {
        total: { lunch: sLunch, dinner: sDinner, people: sPeople },
        classes,
      },
      staff: {
        total: { lunch: tLunch, dinner: tDinner, people: tPeople },
        departments,
      },
      grand: { lunch: sLunch + tLunch, dinner: sDinner + tDinner },
    },
    origin,
  )
}

// ============================================================
// GET ?action=dates —— 有订餐记录的日期(升序)
// ============================================================
async function dates(event, origin) {
  const q = event?.queryStringParameters || {}
  const campId = readPositiveInt(q.camp_id ?? q.query?.camp_id)
  if (!campId) return fail(400, 'MISSING_CAMP_ID', '缺少必填参数(必须是正整数)', origin)

  const { data, error } = await mealsRepo.listDates(campId)
  if (error) {
    console.error('[meals] 读取日期列表失败:', error)
    return failServer('读取订餐日期失败', 'DB_ERROR', origin)
  }

  // 去重 + 升序(PostgREST 风格没有 distinct,见 repo 说明)
  const set = new Set((data || []).map((r) => r.meal_date))
  const list = [...set].sort()

  return ok({ dates: list }, origin)
}
