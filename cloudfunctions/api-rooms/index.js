// Day 18|/api/rooms —— 房间接口(契约 2.5 读取 + 2.6 新建)
//
// Day 17 只做了 GET(读房间列表)。Day 18 按契约 2.6 加上 POST(新建房间)。
//
// 为什么两个接口放在同一个云函数里,而不是各建一个?
//   CloudBase 的「HTTP 访问路径 → 云函数」映射是在控制台配的,不是写在代码里。
//   `/api/rooms` 这个路径已经指向 api-rooms 这个函数了,GET 就是走它。
//   如果为 POST 另建一个函数,就得多配一条路径映射,而同一个路径挂两个函数
//   按方法分发是否生效并不确定 —— 与其赌平台行为,不如在函数内部按
//   httpMethod 自己分流:同一个路径、同一个函数,GET 读 / POST 写。
//   好处:不用动控制台,也不会出现"读通了写不通"的路径歧义。
//
// 契约要求(2.6):
//   · body: { camp_id, room_no, capacity }
//   · 响应: { id }  ← 注意最终仍包在统一信封里,前端拿到的是 { ok, data:{id}, error:null }
//   · 错误:
//       400 VALIDATION_ERROR      (camp_id / room_no / capacity 缺失或格式不对)
//       409 ROOM_NO_DUPLICATED    (同营期下房号重复 → 拒绝写入)
//
// 防重复为什么是"拒绝"而不是"覆盖"?
//   契约第 1.2 节 rooms 表上写了 unique(camp_id, room_no),第 2.6 节也写明
//   重复时返回 409。房号是这间房的物理身份,重复就意味着"你要新建的这间房
//   和已有的某间房是同一间" —— 这是要停下来问人的冲突,不该悄悄覆盖掉人家
//   已经录入、并且可能已经住进去人的房间。所以按契约拒绝。

// Day 19|接口层不再直接碰数据库 —— 查询全部交给 rooms.repo.js
//
//   分层规矩(Day 19 立下的规矩):index.js 里不允许再出现 db.from(...)。
//   以后要查什么,先在 rooms.repo.js 里加一个方法,再从这里调它。
//   这样「数据从哪来」永远只有一个答案,改查询不会碰到校验和错误提示。
const roomsRepo = require('./rooms.repo.js')
const { ok, fail } = require('./response.js')

// ============================================================
// 入口:按请求方法分流
// ============================================================
exports.main = async (event) => {
  // CloudBase HTTP 触发的标准做法:返回值带 statusCode 就按「集成响应」处理,
  // 能自己控制 HTTP 状态码和响应头。
  //
  // httpMethod 只在「HTTP 访问」触发时才有;控制台里点「云端测试」直接传 JSON
  // 时它是 undefined —— 这种情况下默认按 GET 处理(读接口不会误写数据)。
  const method = String(event?.httpMethod || 'GET').toUpperCase()

  if (method === 'POST') return createRoom(event)
  return listRooms(event)
}

// ============================================================
// 2.5 GET /api/rooms —— 读取房间列表(Day 17 已实现;Day 19 只把查询搬去 repo,逻辑未改动)
// ============================================================
async function listRooms(event) {
  // ---- 1. 取参数,做校验 ----
  // 参数从哪来?GET 请求的 query 参数(如 ?camp_id=1)。
  // CloudBase 会把 query 参数放在 event.queryStringParameters 里;
  // 如果是通过函数测试直接传的,可能在 event 顶层,所以两处都找一下。
  const rawCampId =
    event?.queryStringParameters?.camp_id ??
    event?.camp_id ??
    undefined

  const campId = Number(rawCampId)

  if (!rawCampId || !Number.isInteger(campId) || campId <= 0) {
    return fail(400, 'MISSING_CAMP_ID', '缺少必填参数 camp_id(必须是正整数)')
  }

  // ---- 2. 查数据库 ----
  // Day 19:查询语句已搬进 rooms.repo.js,这里只负责调它、然后按契约把结果翻译成
  // 成功或失败。原来的 SQL 参数化处理( .eq() 把 campId 作为参数交给 SDK,
  // 不手拼字符串)现在在 rooms.repo.js 的 findByCamp 里,写法一字未改。
  try {
    const { data, error } = await roomsRepo.findByCamp(campId)

    if (error) {
      console.error('[api-rooms] 查询失败:', error)
      return fail(500, 'DB_ERROR', '读取房间失败:' + (error.message || '数据库返回错误'))
    }

    // ---- 3. 返回统一形状 ----
    return ok(data ?? [])
  } catch (err) {
    console.error('[api-rooms] 异常:', err)
    return fail(500, 'INTERNAL_ERROR', '服务器内部错误:' + (err.message || '未知异常'))
  }
}

// ============================================================
// 2.6 POST /api/rooms —— 新建房间
// ============================================================
async function createRoom(event) {
  // ---- 1. 解析 body ----
  // HTTP 访问触发时,请求体在 event.body,通常是一个 JSON「字符串」,要 parse 一次。
  // 控制台「云端测试」直接传对象时,event.body 可能已经是对象 —— 两种都兼容。
  const body = parseBody(event?.body)

  if (body === null) {
    return fail(400, 'INVALID_JSON', '请求体不是合法的 JSON(请确认body 是 application/json 格式的字符串)')
  }

  // ---- 2. 校验必填字段 ----
  // 逐个字段校验,目的是把"缺了什么"讲清楚再返回。
  // 不用笼统的一句"参数错误":用户是照着表单填的,告诉他"房号不能为空"
  // 他立刻知道要改哪一栏;只说"参数错误"他得自己猜。
  const { value: campId, error: campIdErr } = validateCampId(body?.camp_id)
  if (campIdErr) return fail(400, 'VALIDATION_ERROR', campIdErr)

  const { value: roomNo, error: roomNoErr } = validateRoomNo(body?.room_no)
  if (roomNoErr) return fail(400, 'VALIDATION_ERROR', roomNoErr)

  const { value: capacity, error: capacityErr } = validateCapacity(body?.capacity)
  if (capacityErr) return fail(400, 'VALIDATION_ERROR', capacityErr)

  // gender_label 是可空字段:不传就是"尚未指定性别",和库里 seed 的 304 房一样。
  // 传了就必须严格是 男/女,否则数据库 CHECK 约束会拦下来 —— 与其让数据库
  // 报一句英文的 check violation,不如在这里先说人话。
  const genderLabel = normalizeGenderLabel(body?.gender_label)

  if (genderLabel.error) {
    return fail(400, 'VALIDATION_ERROR', genderLabel.error)
  }

  // ---- 3. 防重复:同营期下房号是否已被占用 ----
  // 这里先查一次再插,而不是直接插了靠数据库报错来发现重复。
  // 原因:数据库 unique 违约时返回的是英文错误码(23505),对用户不友好;
  // 先查一次能给出明确的中文提示("301 房已存在"),还能顺带校验营期是否存在。
  try {
    const { data: camp, error: campErr } = await roomsRepo.findCampById(campId)

    if (campErr) {
      console.error('[api-rooms] 查营期失败:', campErr)
      return fail(500, 'DB_ERROR', '校验营期失败:' + (campErr.message || '数据库返回错误'))
    }

    // maybeSingle():查不到返回 { data: null } 而不是报错。
    // 营期不存在就别往下写了 —— 否则会撞 rooms 表的 foreign key,
    // 报出一句没人看得懂的 "insert failed ... foreign key violation"。
    if (!camp) {
      return fail(400, 'CAMP_NOT_FOUND', `营期不存在(camp_id=${campId}),请先创建营期`)
    }

    const { data: existed, error: dupErr } = await roomsRepo.findByRoomNo(campId, roomNo)

    if (dupErr) {
      console.error('[api-rooms]查重复失败:', dupErr)
      return fail(500, 'DB_ERROR', '校验房号是否重复失败:' + (dupErr.message || '数据库返回错误'))
    }

    // 命中 = 同营期已有这个房号 → 按契约 2.6 拒绝(409),不覆盖已有数据。
    if (existed) {
      return fail(
        409,
        'ROOM_NO_DUPLICATED',
        `房号 ${roomNo} 已存在(房间 id=${existed.id},容量 ${existed.capacity}),请换一个房号`
      )
    }

    // Day 19:插入语句已搬进 rooms.repo.js 的 create()。
    // 这里仍然只写契约登记的四个字段(不整对象透传),gender_label 可空。
    // select('id').single() 拿回新记录的自增 id(契约 2.6 的响应就是它)。
    const { data: created, error: insertErr } = await roomsRepo.create({
      camp_id: campId,
      room_no: roomNo,
      capacity,
      gender_label: genderLabel.value, // 可空
    })

    if (insertErr) {
      console.error('[api-rooms] 写入失败:', insertErr)

      // 兜底:万一上面的查重和插入之间有并发(两个人同时点"新建"),
      // 数据库的 unique 约束会挡住第二条 —— 这时报错信息要说人话。
      // 23505 = unique_violation(PostgreSQL 的 SQLSTATE)。
      if (insertErr.code === '23505') {
        return fail(409, 'ROOM_NO_DUPLICATED', `房号 ${roomNo} 已存在,请换一个房号`)
      }

      // 23503 = foreign_key_violation:camp_id 指向的营期不存在。
      if (insertErr.code === '23503') {
        return fail(400, 'CAMP_NOT_FOUND', `营期不存在(camp_id=${campId}),请先创建营期`)
      }

      return fail(500, 'DB_ERROR', '新建房间失败:' + (insertErr.message || '数据库返回错误'))
    }

    // ---- 5. 返回统一形状 ----
    // 契约 2.6 写的是 { id: 105 },但契约第 0 节规定了统一信封,
    // 所以实际返回 { ok:true, data:{ id:105 }, error:null }。
    return ok({ id: created.id })
  } catch (err) {
    console.error('[api-rooms] 异常:', err)
    return fail(500, 'INTERNAL_ERROR', '服务器内部错误:' + (err.message || '未知异常'))
  }
}

// ============================================================
// 校验小工具:每个都返回 { value, error }
//   value 是校验通过后可直接写库的值(error 为 null)
//   error 是给人看的中文说明(error 非 null 就不要再往下走)
// 单独拆出来是为了让上面的主流程只管"顺序",不夹着"细节"。
// ============================================================

// camp_id:必填正整数
function validateCampId(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { value: null, error: '缺少必填字段 camp_id(所属营期)' }
  }
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    return { value: null, error: `camp_id 必须是正整数,当前收到:${JSON.stringify(raw)}` }
  }
  return { value: n, error: null }
}

// room_no:必填非空字符串,且不超过 varchar(20)
// 去首尾空格:房号前后多个空格在界面上看不出区别,却会存成两个不同的房号,
//   "301 " 和 "301" 在 unique 约束里是两间不同的房 —— 这是个真实会踩的坑,所以统一 trim。
function validateRoomNo(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { value: null, error: '缺少必填字段 room_no(房号)' }
  }
  const s = String(raw).trim()
  if (s === '') {
    return { value: null, error: 'room_no(房号)不能为空,也不能只填空格' }
  }
  if (s.length > 20) {
    return { value: null, error: `room_no(房号)最多 20 个字符,当前 ${s.length} 个` }
  }
  return { value: s, error: null }
}

// capacity:必填正整数(数据库 CHECK capacity > 0,这里先挡一道给出人话)
function validateCapacity(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { value: null, error: '缺少必填字段 capacity(可住人数)' }
  }
  // 注意:Number('') === 0,Number('  ') === 0,所以先排掉空字符串,
  // 否则"只填了空格"会被当成 capacity=0 报"必须是正整数",提示会误导人。
  if (typeof raw === 'string' && raw.trim() === '') {
    return { value: null, error: 'capacity(可住人数)不能为空,也不能只填空格' }
  }
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    return { value: null, error: `capacity(可住人数)必须是正整数,当前收到:${JSON.stringify(raw)}` }
  }
  return { value: n, error: null }
}

// gender_label:可空;传了就只能是 男/女(对齐 rooms 表的 CHECK 约束)
function normalizeGenderLabel(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { value: null, error: null } // 不传 = 尚未指定,合法
  }
  const s = String(raw).trim()
  if (s === '') return { value: null, error: null } // 只填空格也当没填
  if (s !== '男' && s !== '女') {
    return { value: null, error: `gender_label 只能是"男"或"女",当前收到:${JSON.stringify(raw)}` }
  }
  return { value: s, error: null }
}

// parseBody:把 event.body 统一变成 JS 对象
//   · 是字符串 → JSON.parse(失败返回 null,由调用方返回 INVALID_JSON)
//   · 已经是对象(控制台云端测试直接传对象)→ 原样返回
//   · 空(比如调用方压根没传 body)→ 返回 {}
function parseBody(body) {
  if (body === undefined || body === null || body === '') {
    return {}
  }
  if (typeof body === 'object') {
    return body
  }
  try {
    const parsed = JSON.parse(String(body))
    // JSON.parse('"abc"') 能成功但结果是字符串,不是对象 —— 这种也要当非法处理
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}