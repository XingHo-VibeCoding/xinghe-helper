// Day 20|students 数据访问层(students.repo.js)
// api-students 函数的私有副本。
//
// 与 Day 19 的 rooms.repo.js 同一个思路:数据库查询集中在这里,
// index.js 只管接请求 / 校验 / 返响应。规矩同样是「index.js 里不出现 db.from(...)」。
//
// ⚠️ 写权限说明(重要):
//   students 表的 anon 写权限是 Day 20 开给「学生扫码填写」用的。
//   这意味着任何拿到接口链接的人都能提交表单。当前阶段(示例数据)可接受,
//   但接入真实学生数据前必须先加登录态校验并收回 anon 写权限。
//   详见 db/grant-write.sql 的分段说明。

const { db } = require('./db.js')

// ============================================================
// 查询:营期信息(契约 2.2 GET /api/camp)
// ============================================================
// 前端首页与学生填写页都要显示"当前营期是哪个"。
// MVP 恒为 camp_id=1,但仍然走数据库查(而不是前端写死)——
// 这样将来开第二个营期时,前端不用改代码。
async function findCampById(campId) {
  const { data, error } = await db
    .from('camps')
    .select('id, name, org_name')
    .eq('id', campId)
    .maybeSingle()

  return { data, error }
}

// ============================================================
// 查询:学生列表(契约 2.4 GET /api/students)
// ============================================================
// is_latest = true 的才算当前有效:学生可能重复提交,旧记录保留痕迹但不参与分房。
async function findLatestByCamp(campId) {
  const { data, error } = await db
    .from('students')
    .select('*')
    .eq('camp_id', campId)
    .eq('is_latest', true)
    .order('id', { ascending: true })

  return { data, error }
}

// ============================================================
// 写入:新增一条学生报名(契约 2.3 POST /api/students)
// ============================================================
// 只写表单里有的字段,不整对象透传 —— 免得body 里混进什么字段就往库里塞什么。
// is_latest 强制置 true:这是一条新提交,必然是最新记录。
// assigned_room_id / assign_status 留空 —— 学生提交时还没分房。
async function insertOne(row) {
  const { data, error } = await db
    .from('students')
    .insert({
      camp_id: row.camp_id,
      name: row.name,
      gender: row.gender,
      teacher: row.teacher,
      class_level: row.class_level,
      check_in_date: row.check_in_date,
      room_pref: row.room_pref,
      snore: row.snore,
      sleep_quality: row.sleep_quality,
      note: row.note ?? null,
      is_latest: true,
    })
    .select('id')
    .single()

  return { data, error }
}

// ============================================================
// 写入:把同名旧提交标记为失效(配合 insertOne 实现"重复提交保留最新")
// ============================================================
// 不用物理删除 —— 保留全部提交痕迹,只在 is_latest 上区分。
// superseded_by 记下"这条被哪条取代了",形成可追溯的链条。
// .neq('id', newId) 排除刚插入的那条自己(否则会把自己也标失效)。
async function supersedeSameName(campId, name, newId) {
  const { error } = await db
    .from('students')
    .update({ is_latest: false, superseded_by: newId })
    .eq('camp_id', campId)
    .eq('name', name)
    .eq('is_latest', true)
    .neq('id', newId)

  return { error }
}

// ============================================================
// 查询:该姓名是否有过历史提交(决定确认页说"已收到"还是"已更新")
// ============================================================
// 查 is_latest = false 的记录数:大于 0 说明是重复提交,页面应该显示"已更新"。
async function countSuperseded(campId, name) {
  const { count, error } = await db
    .from('students')
    .select('id', { count: 'exact', head: true })
    .eq('camp_id', campId)
    .eq('name', name)
    .eq('is_latest', false)

  return { count, error }
}

// ============================================================
// 写入:单个学生的分配 / 取消分配(契约 2.9)
// ============================================================
// roomId 为 null 表示"放回未分配"。assign_status 与 roomId 保持一致,
// 不要让这两个字段出现矛盾组合(有 room_id 却写着未分配)。
async function setRoom(studentId, roomId) {
  const { data, error } = await db
    .from('students')
    .update({
      assigned_room_id: roomId,
      assign_status: roomId ? '已分配' : '未分配',
    })
    .eq('id', studentId)
    .select('id, assigned_room_id, assign_status')
    .single()

  return { data, error }
}

// ============================================================
// 写入:批量应用分配方案(契约 2.10)
// ============================================================
// 为什么在服务端循环、而不是让前端发几十个请求?
//   一键分房可能要更新几十个学生。逐条走 HTTP 会有几十次往返,
//   慢且容易中途失败留下半套数据。这里在云函数内一次处理完,
//   响应形状仍是契约规定的 { ok, data, error },前端无感知。
//
// ⚠️ 不是真事务:逐条 update,中途失败会留下部分成功。
//   MVP 几十人规模可接受;要真事务得用 Supabase 的 rpc() 写存储过程,
//   留到需要时再做。详见 docs/api-contract.md 契约 2.10 的备注。
//
// clearStudentIds 里的学生会被清空分配(不在 assignments 里的),
// 这用于"一键分房只作用于未分配的人"这个场景。
async function applyAssignments(assignments, clearStudentIds) {
  const applied = assignments ?? []
  const toClear = clearStudentIds ?? []

  for (const id of toClear) {
    const inPlan = applied.some((a) => a.student_id === id)
    if (inPlan) continue // 这次方案里本来就要分配它,别清
    const { error } = await db
      .from('students')
      .update({ assigned_room_id: null, assign_status: '未分配' })
      .eq('id', id)
    if (error) return { error, appliedCount: null }
  }

  let appliedCount = 0
  for (const a of applied) {
    const { error } = await db
      .from('students')
      .update({ assigned_room_id: a.room_id, assign_status: '已分配' })
      .eq('id', a.student_id)
    if (error) return { error, appliedCount }
    appliedCount += 1
  }

  return { error: null, appliedCount }
}

// ============================================================
// 写入 / 读取:AI 分房快照(契约 2.11 与 2.12)
// ============================================================
async function saveHistory(campId, snapshot) {
  const { data, error } = await db
    .from('assignment_history')
    .insert({ camp_id: campId, run_type: 'ai', snapshot })
    .select('id')
    .single()

  return { data, error }
}

async function latestHistory(campId) {
  const { data, error } = await db
    .from('assignment_history')
    .select('snapshot, created_at')
    .eq('camp_id', campId)
    .eq('run_type', 'ai')
    .order('created_at', { ascending: false })
    .limit(1)

  return { data, error }
}

module.exports = {
  findCampById,
  findLatestByCamp,
  insertOne,
  supersedeSameName,
  countSuperseded,
  setRoom,
  applyAssignments,
  saveHistory,
  latestHistory,
}