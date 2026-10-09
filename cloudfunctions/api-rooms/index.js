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
const { ok, fail, failServer, originOf } = require('./response.js')
const { handlePreflight } = require('./cors.js')

// ============================================================
// 入口:按请求方法分流
// ============================================================
// 路由策略说明(为什么没有 PATCH /api/rooms/:id 这种路径):
//   控制台的「HTTP 路径 → 云函数」映射只配了 3 条(/api/health、/api/rooms、
//   /api/students),而且 Path passthrough = Disable —— 也就是路径后面的
//   /:id 不会传给函数。想加带 id 的路径,得去控制台新增路由,今天不做。
//   所以改/删房间改成用查询参数指明 id:
//     PATCH /api/rooms?id=105&camp_id=1     改房
//     DELETE /api/rooms?id=105&camp_id=1     删房
//   契约 2.7/ 2.8 写的是路径参数形式,形态不同但语义一致,
//   契约文档里已补注这一处差异。
exports.main = async (event) => {
  // CloudBase HTTP 触发的标准做法:返回值带 statusCode 就按「集成响应」处理,
  // 能自己控制 HTTP 状态码和响应头。
  //
  // httpMethod 只在「HTTP 访问」触发时才有;控制台里点「云端测试」直接传 JSON
  // 时它是 undefined —— 这种情况下默认按 GET 处理(读接口不会误写数据)。
  const method = String(event?.httpMethod || 'GET').toUpperCase()
  const origin = originOf(event)

  // Day 20 新增：预检请求。浏览器发正式请求前会先问「我能不能访问」,
  // 必须直接回「可以」,不能落到下面的业务分支(否则会被当成查房间)。
  if (method === 'OPTIONS') return handlePreflight(event)

  if (method === 'POST') return createRoom(event, origin)
  if (method === 'PATCH') return updateRoom(event, origin)
  if (method === 'DELETE') return deleteRoom(event, origin)
  return listRooms(event, origin)
}

// ============================================================
// 2.5 GET /api/rooms —— 读取房间列表(Day 17 已实现;Day 19 只把查询搬去 repo,逻辑未改动)
// ============================================================
async function listRooms(event, origin) {
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
    return fail(400, 'MISSING_CAMP_ID', '缺少必填参数 camp_id(必须是正整数)', origin)
  }

  // ---- 2. 查数据库 ----
  // Day 19:查询语句已搬进 rooms.repo.js,这里只负责调它、然后按契约把结果翻译成
  // 成功或失败。原来的 SQL 参数化处理( .eq() 把 campId 作为参数交给 SDK,
  // 不手拼字符串)现在在 rooms.repo.js 的 findByCamp 里,写法一字未改。
  try {
    const { data, error } = await roomsRepo.findByCamp(campId)

    if (error) {
      console.error('[api-rooms] 查询失败:', error)
      return failServer('读取房间失败', 'DB_ERROR', origin)
    }

    // ---- 3. 返回统一形状 ----
    return ok(data ?? [], origin)
  } catch (err) {
    console.error('[api-rooms] 异常:', err)
    return failServer('服务器内部错误', 'INTERNAL_ERROR', origin)
  }
}

// ============================================================
// 2.6 POST /api/rooms —— 新建房间
// ============================================================
async function createRoom(event, origin) {
  // ---- 1. 解析 body ----
  // HTTP 访问触发时,请求体在 event.body,通常是一个 JSON「字符串」,要 parse 一次。
  // 控制台「云端测试」直接传对象时,event.body 可能已经是对象 —— 两种都兼容。
  const body = parseBody(event?.body)

  if (body === null) {
    return fail(400, 'INVALID_JSON', '请求体不是合法的 JSON(请确认body 是 application/json 格式的字符串)', origin)
  }

  // ---- 2. 校验必填字段 ----
  // 逐个字段校验,目的是把"缺了什么"讲清楚再返回。
  // 不用笼统的一句"参数错误":用户是照着表单填的,告诉他"房号不能为空"
  // 他立刻知道要改哪一栏;只说"参数错误"他得自己猜。
  const { value: campId, error: campIdErr } = validateCampId(body?.camp_id)
  if (campIdErr) return fail(400, 'VALIDATION_ERROR', campIdErr, origin)

  const { value: roomNo, error: roomNoErr } = validateRoomNo(body?.room_no)
  if (roomNoErr) return fail(400, 'VALIDATION_ERROR', roomNoErr, origin)

  const { value: capacity, error: capacityErr } = validateCapacity(body?.capacity)
  if (capacityErr) return fail(400, 'VALIDATION_ERROR', capacityErr, origin)

  // gender_label 是可空字段:不传就是"尚未指定性别",和库里 seed 的 304 房一样。
  // 传了就必须严格是 男/女,否则数据库 CHECK 约束会拦下来 —— 与其让数据库
  // 报一句英文的 check violation,不如在这里先说人话。
  const genderLabel = normalizeGenderLabel(body?.gender_label)

  if (genderLabel.error) {
    return fail(400, 'VALIDATION_ERROR', genderLabel.error, origin)
  }

  // ---- 3. 防重复:同营期下房号是否已被占用 ----
  // 这里先查一次再插,而不是直接插了靠数据库报错来发现重复。
  // 原因:数据库 unique 违约时返回的是英文错误码(23505),对用户不友好;
  // 先查一次能给出明确的中文提示("301 房已存在"),还能顺带校验营期是否存在。
  try {
    const { data: camp, error: campErr } = await roomsRepo.findCampById(campId)

    if (campErr) {
      console.error('[api-rooms] 查营期失败:', campErr)
      return failServer('校验营期失败', 'DB_ERROR', origin)
    }

    // maybeSingle():查不到返回 { data: null } 而不是报错。
    // 营期不存在就别往下写了 —— 否则会撞 rooms 表的 foreign key,
    // 报出一句没人看得懂的 "insert failed ... foreign key violation"。
    if (!camp) {
      return fail(400, 'CAMP_NOT_FOUND', `营期不存在(camp_id=${campId}),请先创建营期`, origin)
    }

    const { data: existed, error: dupErr } = await roomsRepo.findByRoomNo(campId, roomNo)

    if (dupErr) {
      console.error('[api-rooms]查重复失败:', dupErr)
      return failServer('校验房号是否重复失败', 'DB_ERROR', origin)
    }

    // 命中 = 同营期已有这个房号 → 按契约 2.6 拒绝(409),不覆盖已有数据。
    if (existed) {
      return fail(
        409,
        'ROOM_NO_DUPLICATED',
        `房号 ${roomNo} 已存在(房间 id=${existed.id},容量 ${existed.capacity}),请换一个房号`,
        origin,
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
        return fail(409, 'ROOM_NO_DUPLICATED', `房号 ${roomNo} 已存在,请换一个房号`, origin)
      }

      // 23503 = foreign_key_violation:camp_id 指向的营期不存在。
      if (insertErr.code === '23503') {
        return fail(400, 'CAMP_NOT_FOUND', `营期不存在(camp_id=${campId}),请先创建营期`, origin)
      }

      return failServer('新建房间失败', 'DB_ERROR', origin)
    }

    // ---- 5. 返回统一形状 ----
    // 契约 2.6 写的是 { id: 105 },但契约第 0 节规定了统一信封,
    // 所以实际返回 { ok:true, data:{ id:105 }, error:null }。
    return ok({ id: created.id }, origin)
  } catch (err) {
    console.error('[api-rooms] 异常:', err)
    return failServer('服务器内部错误', 'INTERNAL_ERROR', origin)
  }
}

// ============================================================
// 2.7 PATCH /api/rooms?id=&camp_id= —— 修改房间(Day 20 新增)
// ============================================================
// 契约原本写的是 PATCH /api/rooms/:id(路径参数)。这里改成查询参数,原因在main
//   入口的注释里:控制台的路径映射只配了 3 条且 Path passthrough = Disable,
//   带 /:id 的路径传不进来。形态不同、语义一致,契约文档已补注。
//
// 「只改传了的字段」怎么实现?
//   前端可能只想改容量,那 gender_label 就必须原样留着。所以这里是 patch 语义,
//   不是「拿 body 整对象覆盖」。rooms.repo.update() 里只把明确传了的字段
//   组装成 allowed,没传的字段根本不进 UPDATE 语句。
async function updateRoom(event, origin) {
  // ---- 1. 定位这间房: id + camp_id 两个都要 ----
  // 为什么还要 camp_id?只凭 id 定位的话,操作 A 营期的人就能改到 B 营期的房。
  //   带上营期 = 只能动「本次打开的那个营期」里的房。
  const q = event?.queryStringParameters || {}
  const rawRoomId = q.id ?? event?.id
  const rawCampId = q.camp_id ?? event?.camp_id

  const { value: roomId, error: idErr } = validateCampId(rawRoomId)
  if (idErr) return fail(400, 'VALIDATION_ERROR', '缺少必填参数 id(房间 id):' + idErr, origin)

  const { value: campId, error: campIdErr } = validateCampId(rawCampId)
  if (campIdErr) return fail(400, 'VALIDATION_ERROR', campIdErr, origin)

  const body = parseBody(event?.body)
  if (body === null) {
    return fail(400, 'INVALID_JSON', '请求体不是合法的 JSON(请确认 body 是 application/json 格式的字符串)', origin)
  }

  // ---- 2. 逐字段校验: 只校验传了的字段,没传的不强求 ----
  // 和 POST 不同,这里不是「三个字段都必须有」,而是「改哪个就校验哪个」。
  const patch = {}
  const errors = []

  if (body?.room_no !== undefined) {
    const { value, error } = validateRoomNo(body.room_no)
    if (error) errors.push(error)
    else patch.room_no = value
  }
  if (body?.capacity !== undefined) {
    const { value, error } = validateCapacity(body.capacity)
    if (error) errors.push(error)
    else patch.capacity = value
  }
  if (body?.gender_label !== undefined) {
    const { value, error } = normalizeGenderLabel(body.gender_label)
    if (error) errors.push(error)
    else patch.gender_label = value
  }

  if (errors.length > 0) {
    return fail(400, 'VALIDATION_ERROR', errors.join(';'), origin)
  }

  // 一个字段都没传:不是错误,但也没必要白跑一趟数据库。
  //   直接回「没有要改的内容」,让人知道这次操作等于什么都没做。
  if (Object.keys(patch).length === 0) {
    return fail(400, 'NOTHING_TO_UPDATE', '没有要修改的字段(可改: room_no / capacity / gender_label)', origin)
  }

  try {
    const { data: room, error: findErr } = await roomsRepo.findById(roomId, campId)
    if (findErr) {
      console.error('[api-rooms] 查询待改房间失败:', findErr)
      return failServer('读取房间失败', 'DB_ERROR', origin)
    }
    if (!room) {
      return fail(404, 'ROOM_NOT_FOUND', `房间不存在(id=${roomId}, camp_id=${campId}),可能已被删除,请刷新页面`, origin)
    }

    // 改房号:要检查新房号有没有被别人占用(不能和自己撞,也不能和别人撞)。
    //   唯一约束只认「同营期 + 房号」,所以查重时必须带上camp_id。
    if (patch.room_no !== undefined && patch.room_no !== room.room_no) {
      const { data: existed, error: dupErr } = await roomsRepo.findByRoomNo(campId, patch.room_no)
      if (dupErr) {
        console.error('[api-rooms] 改房号时查重失败:', dupErr)
        return failServer('校验房号是否重复失败', 'DB_ERROR', origin)
      }
      if (existed) {
        return fail(409, 'ROOM_NO_DUPLICATED', `房号 ${patch.room_no} 已存在(房间 id=${existed.id}),请换一个房号`, origin)
      }
    }

    // 改容量: 调小容量可能让现在住着的人超员 —— 这是要拦下来问人的冲突。
    //   契约 2.7 登记的错误就是 ROOM_CAPACITY_CONFLICT。
    if (patch.capacity !== undefined && patch.capacity < room.capacity) {
      const { data: occupants, error: occErr } = await roomsRepo.findOccupants(roomId)
      if (occErr) {
        console.error('[api-rooms] 统计房间人数失败:', occErr)
        return failServer('读取房间人数失败', 'DB_ERROR', origin)
      }
      const current = (occupants || []).length
      if (current > patch.capacity) {
        return fail(
          409,
          'ROOM_CAPACITY_CONFLICT',
          `房内现有 ${current} 人,不能把容量改成 ${patch.capacity};请先移出一部分人`,
          origin,
        )
      }
    }

    const { data: updated, error: updErr } = await roomsRepo.update(roomId, campId, patch)
    if (updErr) {
      console.error('[api-rooms] 修改房间失败:', updErr)
      if (updErr.code === '23505') {
        return fail(409, 'ROOM_NO_DUPLICATED', `房号 ${patch.room_no} 已存在,请换一个房号`, origin)
      }
      return failServer('修改房间失败', 'DB_ERROR', origin)
    }

    return ok(updated, origin)
  } catch (err) {
    console.error('[api-rooms] 异常:', err)
    return failServer('服务器内部错误', 'INTERNAL_ERROR', origin)
  }
}

// ============================================================
// 2.8 DELETE /api/rooms?id=&camp_id= —— 删除房间(Day 20 新增)
// ============================================================
// 契约写得很明确:必须「先把人放回未分配,再删房」,而且两步在同一个函数里做完。
// 为什么不能在前端做这两步?
//   如果由前端先调「批量取消分配」再调「删房」,中间断网/关页面,房还在、人已经
//   被放回未分配 —— 或者更糟,房被删了但人还挂在那个不存在的房号上。
//   放在一个函数里一次完成,要么都成功,要么都不做。
async function deleteRoom(event, origin) {
  const q = event?.queryStringParameters || {}
  const rawRoomId = q.id ?? event?.id
  const rawCampId = q.camp_id ?? event?.camp_id

  const { value: roomId, error: idErr } = validateCampId(rawRoomId)
  if (idErr) return fail(400, 'VALIDATION_ERROR', '缺少必填参数 id(房间 id):' + idErr, origin)

  const { value: campId, error: campIdErr } = validateCampId(rawCampId)
  if (campIdErr) return fail(400, 'VALIDATION_ERROR', campIdErr, origin)

  try {
    const { data: room, error: findErr } = await roomsRepo.findById(roomId, campId)
    if (findErr) {
      console.error('[api-rooms] 查询待删房间失败:', findErr)
      return failServer('读取房间失败', 'DB_ERROR', origin)
    }
    if (!room) {
      return fail(404, 'ROOM_NOT_FOUND', `房间不存在(id=${roomId}, camp_id=${campId}),可能已被删除,请刷新页面`, origin)
    }

    // 第 1 步：先看清有多少人会被放回未分配(响应里要返回这个数,契约 2.8 要求)
    const { data: occupants, error: occErr } = await roomsRepo.findOccupants(roomId)
    if (occErr) {
      console.error('[api-rooms] 统计房间人数失败:', occErr)
      return failServer('读取房间人数失败', 'DB_ERROR', origin)
    }
    const count = (occupants || []).length

    // 第 2 步：真的放人(只在有人时写库,省掉一次无谓的 UPDATE)
    if (count > 0) {
      const { error: relErr } = await roomsRepo.releaseOccupants(roomId)
      if (relErr) {
        console.error('[api-rooms] 释放房间成员失败:', relErr)
        return failServer('移出房间内学生失败', 'DB_ERROR', origin)
      }
    }

    // 第 3 步：删房
    const { error: delErr } = await roomsRepo.remove(roomId, campId)
    if (delErr) {
      console.error('[api-rooms] 删除房间失败:', delErr)
      return failServer('删除房间失败', 'DB_ERROR', origin)
    }

    return ok({ id: roomId, unassigned_count: count }, origin)
  } catch (err) {
    console.error('[api-rooms] 异常:', err)
    return failServer('服务器内部错误', 'INTERNAL_ERROR', origin)
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