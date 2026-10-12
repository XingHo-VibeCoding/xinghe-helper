// Day 20|/api/students —— 学生相关接口全集合(契约 2.2 / 2.3 / 2.4 / 2.9 / 2.10 / 2.11 / 2.12)
//
// Day 17 这里只有 GET(读学生列表)。Day 20 前端要从mock 数据切到公网接口,
//   必须把前端要用的写接口全部补齐,否则前端只能靠云函数里循环发几十个
//   PATCH 请求来"一键分房" —— 慢、易中途失败、也拿不到契约规定的响应。
//
// 为什么这些接口都挤在一个云函数里,而不是一个接口一个函数?
//   控制台的「HTTP 访问路径 → 云函数」映射是手动配的,不是写在代码里。
//   能在控制台配的路径只有 3 条:
//     /api/health   → health
//     /api/rooms    → api-rooms
//     /api/students → api-students
//   想新增 /api/assignments/apply 这种路径,得去控制台加映射。
//   与其赌平台对"同路径多函数按方法分发"的行为,不如在一个函数内部按
//   httpMethod + 一个 action 参数自己分流:路径不变,不用动控制台。
//
//分流规则(看 event.httpMethod 和 query 里的 action):
//   GET    /api/students?camp_id=1                 → 2.4 学生列表
//   POST   /api/students?action=submit&camp_id=1→ 2.3 学生报名(表单提交)
//   POST   /api/students?action=apply              → 2.10 批量应用分配
//   POST   /api/students?action=history            → 2.11 保存 AI 分房快照
//   GET    /api/students?action=history&camp_id=1 → 2.12 读最近一次 AI 快照
//   PATCH  /api/students?id=12                     → 2.9 单人分配/取消分配
//   DELETE /api/students?id=&camp_id=              → 2.13 删除学生(Day 28 新增)
//   GET    /api/students?action=camp&camp_id=1     → 2.2 营期信息
//
// ⚠️ 2.13 与整个接口族的分歧(必须知道):
//   2.3 重复提交时旧记录只标 is_latest=false,不物理删除 —— 那是**留痕**。
//   2.13 是工作台上的「删除」,是**真删**,行从表里消失。
//   两者并存不矛盾:2.3 管的是「学生自己改了信息,旧的那份留个记录」,
//   2.13 管的是「工作台上的这份名单不该有这个人」(填错、重复提交、退营了)。
//   代价是 2.13 删掉就找不回来了,前端必须二次确认(见 Workbench.jsx)。
//
// Day 19 立下的分层规矩在这里同样生效:index.js 里不出现 db.from(...)。
//   所有查询都在 students.repo.js 里。
//
// Day 20 新增的两件事:
//   1. CORS 改成白名单(见 cors.js),不再对所有人放开*。
//   2. 每个响应都带上 origin,让浏览器判断自己能不能读这个响应。

const studentsRepo = require('./students.repo.js')
const { ok, fail, failServer, originOf } = require('./response.js')
const { handlePreflight } = require('./cors.js')
const { logRequest } = require('./requestLog.js')

// ============================================================
// 入口:按方法 + action 分流
// ============================================================
exports.main = async (event) => {
  // httpMethod 只在「HTTP 访问」触发时才有;控制台里点「云端测试」直接传 JSON
  // 时它是 undefined —— 这种情况下默认按 GET 处理(读接口不会误写数据)。
  const method = String(event?.httpMethod || 'GET').toUpperCase()
  const origin = originOf(event)
  const action = String(event?.queryStringParameters?.action || event?.action || '').trim()

  // 预检请求:浏览器发正式请求前会先问「我能不能访问」,必须直接回「可以」,
  // 不能落到下面的业务分支(否则会被当成查学生)。
  if (method === 'OPTIONS') return handlePreflight(event)

  // Day 23 余力加练:整个业务部分包在请求日志里。
  //   为什么包在这里而不是在每个业务函数里写 console.log ——
  //   接口各写一遍就是多个可能忘的地方;包在 main 上是一处覆盖全部,
  //   以后新增接口自动有日志。理由同 Day 23 改裸报错:修在源头,不逐处打补丁。
  return logRequest(event, async () => {
    // ---- POST:全是写操作 ----
    if (method === 'POST') {
      if (action === 'apply') return applyAssignments(event, origin)
      if (action === 'history') return saveHistory(event, origin)
      // 不写 action 时默认就是「学生报名」—— 表单页是最主要的调用方,
      // 让它不用多记一个 action 参数。
      return submitStudent(event, origin)
    }

    // ---- PATCH:改单个学生的分配 ----
    if (method === 'PATCH') return assignStudent(event, origin)

    // ---- DELETE:删一个学生(Day 28 新增,契约 2.13) ----
    if (method === 'DELETE') return deleteStudent(event, origin)

    // ---- GET:全是读操作 ----
    if (action === 'camp') return getCamp(event, origin)
    if (action === 'history') return getLatestHistory(event, origin)
    return listStudents(event, origin)
  })
}

// ============================================================
// 2.4 GET /api/students —— 学生列表(Day 17 已实现,Day 20 只把查询搬去 repo)
// ============================================================
async function listStudents(event, origin) {
  const { value: campId, error: campIdErr } = readCampId(event)
  if (campIdErr) return fail(400, 'MISSING_CAMP_ID', campIdErr, origin)

  try {
    const { data, error } = await studentsRepo.findLatestByCamp(campId)

    if (error) {
      console.error('[api-students] 查询失败:', error)
      return failServer('读取学生失败', 'DB_ERROR', origin)
    }

    return ok(data ?? [], origin)
  } catch (err) {
    console.error('[api-students] 异常:', err)
    return failServer('服务器内部错误', 'INTERNAL_ERROR', origin)
  }
}

// ============================================================
// 2.2 GET /api/students?action=camp&camp_id=1 —— 营期信息
// ============================================================
// 前端首页和学生填写页都要显示"当前是哪个营期"。
// 为什么查数据库而不是让前端写死 camp_id=1?
//   现在 MVP 确实只有 1 个营期,但写死意味着开第二个营期时前端要改代码。
//   走数据库,前端不用改。
async function getCamp(event, origin) {
  const { value: campId, error: campIdErr } = readCampId(event)
  if (campIdErr) return fail(400, 'MISSING_CAMP_ID', campIdErr, origin)

  try {
    const { data, error } = await studentsRepo.findCampById(campId)
    if (error) {
      console.error('[api-students] 查询营期失败:', error)
      return failServer('读取营期失败', 'DB_ERROR', origin)
    }
    if (!data) {
      return fail(404, 'CAMP_NOT_FOUND', `营期不存在(camp_id=${campId})`, origin)
    }
    return ok(data, origin)
  } catch (err) {
    console.error('[api-students] 异常:', err)
    return failServer('服务器内部错误', 'INTERNAL_ERROR', origin)
  }
}

// ============================================================
// 2.3 POST /api/students —— 学生报名(学生扫码填写后提交)
// ============================================================
// 这一步是 Day 20 权限上最敏感的地方:students 表的 anon 写权限是开着的,
//   意味着任何拿到链接的人都能提交。示例数据阶段可接受,接入真实学生前
//   必须加登录态校验并收回 anon 写权限。详见 db/grant-write.sql。
async function submitStudent(event, origin) {
  const body = parseBody(event?.body)
  if (body === null) {
    return fail(400, 'INVALID_JSON', '请求体不是合法的 JSON(请确认 body 是 application/json 格式的字符串)', origin)
  }

  const campIdRaw = body?.camp_id ?? event?.queryStringParameters?.camp_id ?? event?.camp_id
  const { value: campId, error: campIdErr } = validateCampId(campIdRaw)
  if (campIdErr) return fail(400, 'VALIDATION_ERROR', campIdErr, origin)

  // ---- 逐字段校验:把"缺了什么"讲清楚再返回 ----
  // 学生是照着表单一栏栏填的,告诉他"姓名不能为空"他立刻知道要改哪一栏;
  // 只说"参数错误"他得自己猜是哪一栏错了。
  //
  // ⚠️ 校验规则必须和 db/schema.sql 里的约束一一对齐:
  //   not null 的列(teacher/class_level/check_in_date/room_pref)不能当可空处理;
  //   CHECK 约束的列(teacher/class_level/sleep_quality/gender/room_pref)
  //   在这里先校验,就不必等数据库抛一句英文的 check violation。
  const errors = []
  const name = readRequiredText(body?.name, '姓名', 50, errors)
  // 手机号：Day 28 新增，同时是「同一个人」的判重依据（原来只看姓名，同名会互相顶替）
  const phone = readPhone(body?.phone, errors)
  const gender = readRequiredText(body?.gender, '性别', 2, errors)
  const teacher = readRequiredText(body?.teacher, '带班老师', 20, errors)
  const classLevel = readRequiredText(body?.class_level, '年级/班级', 10, errors)
  const checkInDate = readRequiredText(body?.check_in_date, '入住日期', 20, errors)
  const roomPref = readRoomPref(body?.room_pref, errors)
  const sleepQuality = readOptionalEnum(
    body?.sleep_quality,
    '睡眠质量',
    ['好', '一般', '差'],
    errors,
  )
  const note = readOptionalText(body?.note, '备注', 200, errors)

  // 枚举校验:teacher / class_level 在数据库有 CHECK 约束,
  //   与其让数据库报英文错误码,不如在这里说人话。
  if (teacher && !['Mona', 'Kiven', 'Selena', 'Betty', 'Priya'].includes(teacher)) {
    errors.push(`带班老师只能是 Mona / Kiven / Selena / Betty / Priya,当前收到:${JSON.stringify(body?.teacher)}`)
  }
  if (classLevel && !['星一', '星二', '星三'].includes(classLevel)) {
    errors.push(`年级/班级只能是 星一 / 星二 / 星三,当前收到:${JSON.stringify(body?.class_level)}`)
  }

  // snore 是 boolean 且可空:true / false / null 都合法。
  //   前端没填时传null(见 StudentForm.jsx: f.snore === '' ? null : ...)。
  //   这里只挡「明显不是布尔」的值,比如误传了字符串 "yes"。
  const snore = readOptionalBool(body?.snore, '是否打鼾', errors)

  if (errors.length > 0) {
    return fail(400, 'VALIDATION_ERROR', errors.join(';'), origin)
  }

  try {
    // 先确认营期存在 —— students.camp_id 是外键,营期不存在时直接插入
    //   会报一句没人看得懂的 "insert failed ... foreign key violation"。
    const { data: camp, error: campErr } = await studentsRepo.findCampById(campId)
    if (campErr) {
      console.error('[api-students] 查营期失败:', campErr)
      return failServer('校验营期失败', 'DB_ERROR', origin)
    }
    if (!camp) {
      return fail(400, 'CAMP_NOT_FOUND', `营期不存在(camp_id=${campId}),请先创建营期`, origin)
    }

    const { data: created, error: insertErr } = await studentsRepo.insertOne({
      camp_id: campId,
      name,
      phone,
      gender,
      teacher,
      class_level: classLevel,
      check_in_date: checkInDate,
      room_pref: roomPref,
      snore,
      sleep_quality: sleepQuality,
      note,
    })

    if (insertErr) {
      console.error('[api-students] 写入失败:', insertErr)
      if (insertErr.code === '23503') {
        return fail(400, 'CAMP_NOT_FOUND', `营期不存在(camp_id=${campId}),请先创建营期`, origin)
      }
      return failServer('提交失败', 'DB_ERROR', origin)
    }

    // 重复提交:保留全部提交痕迹,但把旧的标成 is_latest=false,
    //   工作台只认最新那条。superseded_by 记下"这条被哪条取代了",形成可追溯链条。
    // ⚠️ Day 28：判重依据从「姓名」改成「手机号」。
    //   原来同名就会被判成同一个人，第二个同名学生一提交，
    //   第一个就从工作台消失（静默丢数据）。现在同名但号码不同 = 两个人，互不影响。
    const { error: supErr } = await studentsRepo.supersedeSamePhone(campId, phone, created.id)
    if (supErr) {
      // 这一步失败不阻断本次提交 —— 学生已经报上名了,让页面显示"提交成功"
      //   比让它转圈等下去更实际。错误留在日志里,后续可人工核对。
      console.error('[api-students] 标记旧提交失效失败(不影响本次提交):', supErr)
    }

    // 告诉前端这是"新增"还是"更新":查一下这个手机号有没有历史提交(被取代的)。
    const { count: historyCount, error: cntErr } = await studentsRepo.countSuperseded(campId, phone)
    if (cntErr) {
      console.error('[api-students] 统计历史提交失败:', cntErr)
    }

    return ok({ id: created.id, updated: (historyCount ?? 0) > 0 }, origin)
  } catch (err) {
    console.error('[api-students] 异常:', err)
    return failServer('服务器内部错误', 'INTERNAL_ERROR', origin)
  }
}

// ============================================================
// 2.9 PATCH /api/students?id=12 —— 单个学生分配 / 取消分配
// ============================================================
// 前端在拖拽松手时立刻调它(即时保存)。契约原本写的是
//   PATCH /api/students/:id/room,这里改成查询参数 id —— 原因同 api-rooms:
//   控制台路径 passthrough = Disable,带 /:id 的路径传不进来。
//
// room_id 传 null 表示"放回未分配"。这必须和 assign_status 一起改,
//   不能只改其一,否则会出现"有 room_id 却写着未分配"的矛盾数据。
async function assignStudent(event, origin) {
  const q = event?.queryStringParameters || {}
  const rawStudentId = q.id ?? event?.id

  const { value: studentId, error: idErr } = validateCampId(rawStudentId)
  if (idErr) return fail(400, 'VALIDATION_ERROR', '缺少必填参数 id(学生 id):' + idErr, origin)

  const body = parseBody(event?.body)
  if (body === null) {
    return fail(400, 'INVALID_JSON', '请求体不是合法的 JSON(请确认 body 是 application/json 格式的字符串)', origin)
  }

  // room_id 允许为 null(取消分配),但"字段没传"和"传了 null"是两回事:
  //   前端要能表达"取消分配",所以这里只判断字段在不在,不管值是不是 null。
  if (body?.room_id === undefined) {
    return fail(400, 'VALIDATION_ERROR', '缺少必填字段 room_id(要取消分配请显式传 null)', origin)
  }

  let roomId = null
  if (body.room_id !== null) {
    const { value, error } = validateCampId(body.room_id)
    if (error) return fail(400, 'VALIDATION_ERROR', 'room_id(房间 id)错误:' + error, origin)
    roomId = value
  }

  try {
    const { data, error } = await studentsRepo.setRoom(studentId, roomId)
    if (error) {
      console.error('[api-students] 分配学生失败:', error)
      return failServer('保存分配结果失败', 'DB_ERROR', origin)
    }
    // maybeSingle 会返回 null(学生不存在),single() 则报错。
    //   这里用 .single(),不存在时会抛错落到 catch,所以再补一层判断更稳。
    if (!data) {
      return fail(404, 'STUDENT_NOT_FOUND', `学生不存在(id=${studentId}),请刷新页面`, origin)
    }
    return ok(data, origin)
  } catch (err) {
    console.error('[api-students] 异常:', err)
    return failServer('服务器内部错误', 'INTERNAL_ERROR', origin)
  }
}

// ============================================================
// 2.13 DELETE /api/students?id=&camp_id= —— 删除学生(Day 28 新增)
//
// 形态与 2.8 删房间完全一致(id 走查询参数而非路径),
//   原因同 main 入口的注释:控制台路径 passthrough = Disable,/:id 传不进来。
//
// ⚠️ 这一条与 2.3 的分工(别搞混):
//   2.3 重复提交 → 旧行 is_latest=false,**留痕不删**。
//   2.13 工作台删除 → **真删**,行消失。
//
// 为什么要单独开一个接口,而不是复用 PATCH 加个 action?
//   语义不同就不能复用:PATCH 改的是学生记录的一部分字段,
//   DELETE 是整行消失。混在一个接口里,以后看日志时分不清
//   「谁把赵子昂改了」和「谁把赵子昂删了」。
//
// 返回 { id, name } —— 把姓名带回去,前端可以直接说
// 「已删除 赵子昂」,不用自己再去列表里找名字(可能已经不在了)。
async function deleteStudent(event, origin) {
  const q = event?.queryStringParameters || {}
  const rawStudentId = q.id ?? event?.id
  const rawCampId = q.camp_id ?? event?.camp_id

  // id 和 camp_id 都要:只凭 id 定位的话,操作 A 营期的人能删掉 B 营期的学生。
  const { value: studentId, error: idErr } = validateCampId(rawStudentId)
  if (idErr) return fail(400, 'VALIDATION_ERROR', '缺少必填参数 id(学生 id):' + idErr, origin)

  const { value: campId, error: campIdErr } = validateCampId(rawCampId)
  if (campIdErr) return fail(400, 'VALIDATION_ERROR', campIdErr, origin)

  try {
    // ---- 1. 先确认这个人存在,且属于本次操作的营期 ----
    const { data: student, error: findErr } = await studentsRepo.findById(studentId, campId)
    if (findErr) {
      console.error('[api-students] 查询待删学生失败:', findErr)
      return failServer('读取学生失败', 'DB_ERROR', origin)
    }
    if (!student) {
      return fail(404, 'STUDENT_NOT_FOUND', `学生不存在(id=${studentId}, camp_id=${campId}),可能已被删除,请刷新页面`, origin)
    }

    // ---- 2. 已经入房的人不许在这儿删 ----
    //   前端只在「未分配」名单里放删除按钮,理论上不会传已分配的人上来。
    //   但这一道不能省:页面可能开着、分配可能刚变,只要有一个窗口过期,
    //   就会出现「人在 305 房住着、名字却从名单里被抹掉」的情况。
    //   那时 room_members 查不到他,房间显示的入住人数和实际对不上,更难查。
    if (student.assigned_room_id) {
      return fail(400, 'STUDENT_ASSIGNED', `${student.name} 已经分配到房间,先把ta移回未分配再删除`, origin)
    }

    // ---- 3. 真删 ----
    //   内部两步(清 superseded_by 引用 → 删本体),理由见 students.repo.remove 的注释。
    const { error: delErr, phase } = await studentsRepo.remove(studentId, campId)
    if (delErr) {
      console.error(`[api-students] 删除学生失败(${phase}):`, delErr)
      return failServer('删除学生失败', 'DB_ERROR', origin)
    }

    return ok({ id: studentId, name: student.name }, origin)
  } catch (err) {
    console.error('[api-students] 异常:', err)
    return failServer('服务器内部错误', 'INTERNAL_ERROR', origin)
  }
}

// ============================================================
// 2.10 POST /api/students?action=apply —— 批量应用分配方案(一键分房)
// ============================================================
// 为什么不让前端循环调 2.9?
//   一键分房可能要更新几十个学生。逐条走 HTTP 会有几十次往返,慢,
//   而且中途失败会留下"一半已分一半没分"的半套数据。这里在云函数内一次
//   循环处理完,前端只发一个请求。
//
// body 形状:
//   {
//     "assignments": [ { "student_id": 12, "room_id": 101 }, ... ],
//     "clear_student_ids": [ 20, 21 ]// 可选:这些人放回未分配
//   }
async function applyAssignments(event, origin) {
  const body = parseBody(event?.body)
  if (body === null) {
    return fail(400, 'INVALID_JSON', '请求体不是合法的 JSON(请确认 body 是 application/json 格式的字符串)', origin)
  }

  const raw = body?.assignments
  if (!Array.isArray(raw)) {
    return fail(400, 'VALIDATION_ERROR', 'assignments 必须是数组(每个元素形如 { student_id, room_id })', origin)
  }

  // 逐条校验后再入库 —— 不能把前端传来的东西直接写进数据库。
  const errors = []
  const assignments = raw.map((item, i) => {
    const { value: sid, error: sidErr } = validateCampId(item?.student_id)
    if (sidErr) errors.push(`第 ${i + 1} 条:student_id 错误(${sidErr})`)
    const { value: rid, error: ridErr } = validateCampId(item?.room_id)
    if (ridErr) errors.push(`第 ${i + 1} 条:room_id 错误(${ridErr})`)
    return { student_id: sid, room_id: rid }
  })

  const clearRaw = body?.clear_student_ids ?? []
  if (!Array.isArray(clearRaw)) {
    return fail(400, 'VALIDATION_ERROR', 'clear_student_ids 必须是数组(没有要清空的人就传空数组或不传)', origin)
  }
  const clearStudentIds = clearRaw.map((v, i) => {
    const { value, error } = validateCampId(v)
    if (error) errors.push(`clear_student_ids 第 ${i + 1} 个: ${error}`)
    return value
  })

  if (errors.length > 0) {
    return fail(400, 'VALIDATION_ERROR', errors.join(';'), origin)
  }

  try {
    const { error, appliedCount } = await studentsRepo.applyAssignments(assignments, clearStudentIds)
    if (error) {
      console.error('[api-students] 批量分配失败:', error)
      return failServer('批量分配失败', 'DB_ERROR', origin)
    }
    return ok({ applied_count: appliedCount }, origin)
  } catch (err) {
    console.error('[api-students] 异常:', err)
    return failServer('服务器内部错误', 'INTERNAL_ERROR', origin)
  }
}

// ============================================================
// 2.11 POST /api/students?action=history —— 保存一次 AI 分房快照
// ============================================================
// 用途:用户在总览页点"AI 分房"后,结果可以撤销/回看,靠的就是这份快照。
async function saveHistory(event, origin) {
  const body = parseBody(event?.body)
  if (body === null) {
    return fail(400, 'INVALID_JSON', '请求体不是合法的 JSON(请确认 body 是 application/json 格式的字符串)', origin)
  }

  const campIdRaw = body?.camp_id ?? event?.queryStringParameters?.camp_id ?? event?.camp_id
  const { value: campId, error: campIdErr } = validateCampId(campIdRaw)
  if (campIdErr) return fail(400, 'VALIDATION_ERROR', campIdErr, origin)

  // snapshot 必须是对象:它会以 jsonb 存进 assignment_history。
  //   这里挡住非对象,免得存进去一个字符串,回看时前端 JSON.parse 炸掉。
  if (!body?.snapshot || typeof body.snapshot !== 'object' || Array.isArray(body.snapshot)) {
    return fail(400, 'VALIDATION_ERROR', 'snapshot 必须是对象(分房方案的 JSON)', origin)
  }

  try {
    const { data, error } = await studentsRepo.saveHistory(campId, body.snapshot)
    if (error) {
      console.error('[api-students] 保存快照失败:', error)
      return failServer('保存分房快照失败', 'DB_ERROR', origin)
    }
    return ok({ id: data.id }, origin)
  } catch (err) {
    console.error('[api-students] 异常:', err)
    return failServer('服务器内部错误', 'INTERNAL_ERROR', origin)
  }
}

// ============================================================
// 2.12 GET /api/students?action=history&camp_id=1 —— 读最近一次 AI 快照
// ============================================================
async function getLatestHistory(event, origin) {
  const { value: campId, error: campIdErr } = readCampId(event)
  if (campIdErr) return fail(400, 'MISSING_CAMP_ID', campIdErr, origin)

  try {
    const { data, error } = await studentsRepo.latestHistory(campId)
    if (error) {
      console.error('[api-students] 读取快照失败:', error)
      return failServer('读取分房快照失败', 'DB_ERROR', origin)
    }

    // 没找到 = 从没点过"AI 分房",这不是错误。
    //   回null 让前端判断"要不要提示可以撤销",而不是弹一个报错。
    const row = (data ?? [])[0]
    if (!row) return ok(null, origin)

    return ok({ snapshot: row.snapshot, created_at: row.created_at }, origin)
  } catch (err) {
    console.error('[api-students] 异常:', err)
    return failServer('服务器内部错误', 'INTERNAL_ERROR', origin)
  }
}

// ============================================================
// 校验小工具:每个都返回 { value, error }
//   value 是校验通过后可直接写库的值(error 为 null)
//   error 是给人看的中文说明(error 非 null 就不要再往下走)
// 单独拆出来是为了让上面的主流程只管"顺序",不夹着"细节"。
// ============================================================

// 从 event 里读 camp_id(GET 用 query,POST 用 body,两处都找一下)
function readCampId(event) {
  const raw =
    event?.queryStringParameters?.camp_id ??
    event?.camp_id ??
    undefined
  return validateCampId(raw)
}

// camp_id / id 通用:必填正整数
function validateCampId(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { value: null, error: '缺少必填参数(必须是正整数)' }
  }
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    return { value: null, error: `必须是正整数,当前收到:${JSON.stringify(raw)}` }
  }
  return { value: n, error: null }
}

// 必填文本:trim 后非空、不超长度
//   为什么每个字段都要 trim:姓名前后多个空格在界面上看不出区别,
//   却会存成两个人 —— 后面"同名旧提交标记失效"就找不到该标谁了。
function readRequiredText(raw, label, maxLen, errors) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    errors.push(`${label}不能为空`)
    return null
  }
  const s = String(raw).trim()
  if (s.length > maxLen) {
    errors.push(`${label}最多 ${maxLen} 个字符,当前 ${s.length} 个`)
    return null
  }
  return s
}

// 可选文本:不传就是 null(不是空字符串 —— 空字符串会在页面上显示成"填了个空")
function readOptionalText(raw, label, maxLen, errors) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null
  const s = String(raw).trim()
  if (s.length > maxLen) {
    errors.push(`${label}最多 ${maxLen} 个字符,当前 ${s.length} 个`)
    return null
  }
  return s
}

// room_pref:必填正整数 1~6(schema 里是 int not null + check between 1 and 6)
function readRoomPref(raw, errors) {
  if (raw === undefined || raw === null || raw === '') {
    errors.push('期望拼房人数不能为空')
    return null
  }
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 6) {
    errors.push(`期望拼房人数必须是 1~6 之间的整数,当前收到:${JSON.stringify(raw)}`)
    return null
  }
  return n
}

// 可选枚举:不传 = null;传了必须落在允许值里
function readOptionalEnum(raw, label, allowed, errors) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null
  const s = String(raw).trim()
  if (!allowed.includes(s)) {
    errors.push(`${label}只能是 ${allowed.join(' / ')},当前收到:${JSON.stringify(raw)}`)
    return null
  }
  return s
}

// 手机号:必填 + 只收数字(Day 28)
//
// 为什么服务端也要校验，不能只靠前端:
//   前端校验是为了给用户即时反馈，但页面可以被绕过（直接调接口）。
//   而且「手机号是判重依据」—— 如果这里放过去一个乱填的值，
//   会把两个不同的人判成同一个人，正是 Day 28 要修的那个 bug。
//   所以数据库 NOT NULL 之外，这里再挡一道。
//
// 为什么不校验成「合法手机号」（1[3-9] 开头等）：
//   营地里可能有座机、家长号码、海外号码。规则越窄越容易把真实数据挡在门外，
//   而这里只是要一个「稳定且唯一」的标识，不是在做电信实名。
//   只要求：非空、全数字、长度 6–20（够用且能容纳带区号的座机）。
function readPhone(raw, errors) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    errors.push('手机号不能为空')
    return null
  }
  // 先去掉用户可能输入的空格和横线:139 1234 5678 也是常见写法。
  const s = String(raw).trim().replace(/[\s-]/g, '')
  if (!/^\d+$/.test(s)) {
    errors.push('手机号只能填数字(空格和横线会自动去掉)')
    return null
  }
  if (s.length < 6 || s.length > 20) {
    errors.push(`手机号位数不对,当前 ${s.length} 位`)
    return null
  }
  return s
}

// 可选布尔:true / false / null 都合法;其他值说明前端传错了
function readOptionalBool(raw, label, errors) {
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw === 'boolean') return raw
  errors.push(`${label}只能是 true 或 false,当前收到:${JSON.stringify(raw)}`)
  return null
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