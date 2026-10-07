// Day 19|rooms 数据访问层(rooms.repo.js) —— 房间表的所有数据库查询都住这里
//
// 这个文件在整个作品里是什么位置?
//   index.js 是「接口层」:接请求 → 校验参数 → 调数据 → 返响应。
//   rooms.repo.js 是「数据层」:只关心「rooms 这张表怎么查」,不认识 HTTP、不认识
//   错误码、也不知道前端要什么格式。
//   以前两类东西挤在 index.js 一个文件里,现在拆开。
//
// 为什么要拆?(不拆的代价)
//   · Day 20+ 还要加更多接口,查询语句会被复制粘贴到各个地方
//   · 想改「查房间的排序方式」,得在一堆校验代码里找,怕碰坏别的
//   拆开之后:查房间只有这一个地方,index.js 里看到 roomsRepo.xxx 就知道数据从哪来。
//
// ⚠️ 分层的规矩(这条是今天最重要的收获):
//   index.js 里**不允许再出现 db.from(...)**。以后所有查询都必须先加一个方法到
//   本文件,再从 index.js 调它。这样「数据从哪来」永远只有一个答案。
//
// 为什么方法都返回 { data, error } 而不是直接抛错?
//   因为数据库的错误要用「HTTP 状态码 + 人话提示」返回给前端(500 DB_ERROR),
//   这个「翻译成接口错误」的活儿属于接口层。repository 只负责如实报告
//   「成了还是败了、败的原因是什么」,不决定怎么告诉用户 —— 职责单一。
//
// 为什么 findCampById(查营期)也放在这里?
//   它查的是camps 表,严格说不属于「房间表」。但它只在「新建房间」这一个流程里用,
//   是写入房间前的必经校验。为它单独开一个 camps.repo.js 只为一个调用点,
//   属于过度拆分。所以放这儿,并在下面标注了来历。

const { db } = require('./db.js')

// ============================================================
// 查询:列出某个营期下的所有房间(契约 2.5)
// ============================================================
// 参数校验( camp_id 是不是正整数)放在 index.js,不在这里。
//   原因:那是「请求对不对」的问题,属于接口层;这里只负责「给定条件,去查」。
async function findByCamp(campId) {
  const { data, error } = await db
    .from('rooms')
    .select('*')
    .eq('camp_id', campId)
    .order('room_no', { ascending: true })

  return { data, error }
}

// ============================================================
// 查询:营期是否存在(新建房间前的外键预检)
// ============================================================
// 为什么要预检:camps.id 是 rooms.camp_id 的外键。营期不存在时直接插入,
//   数据库会报一句英文的 "insert failed ... foreign key violation",用户看不懂。
//   先查一次就能给出一句「营期不存在,请先创建营期」。
//
// maybeSingle() 的意思:查不到返回 { data: null },而不是像 single() 那样报错。
//   这里正好需要「查不到是正常情况」的语义。
async function findCampById(campId) {
  const { data, error } = await db
    .from('camps')
    .select('id')
    .eq('id', campId)
    .maybeSingle()

  return { data, error }
}

// ============================================================
// 查询:同营期下这个房号是否已被占用(防重复,契约 2.6)
// ============================================================
// 只取三个字段,不 select('*'):防重复只需要知道「有没有、是哪间、多大容量」,
//   拿整行是多余的。(顺带的好处:以后 rooms 表加了大字段,这里不会被拖慢。)
async function findByRoomNo(campId, roomNo) {
  const { data, error } = await db
    .from('rooms')
    .select('id, room_no, capacity')
    .eq('camp_id', campId)
    .eq('room_no', roomNo)
    .maybeSingle()

  return { data, error }
}

// ============================================================
// 写入:新建一个房间(契约 2.6)
// ============================================================
// 只写契约登记的四个字段,不把整个对象透传 —— 免得调用方 body 里混进什么
//   字段就往库里塞什么。gender_label 可空(不传 = 尚未指定性别)。
//
// .select('id').single():插入后拿回新记录的自增 id(契约 2.6 的响应就是它)。
//   注意这里**不处理** 23505(unique_violation)/ 23503(foreign_key_violation)
//   的翻译 —— 那是接口层的活。这里如实把 error 交上去,code 原样带出去。
async function create({ camp_id, room_no, capacity, gender_label }) {
  const { data, error } = await db
    .from('rooms')
    .insert({
      camp_id,
      room_no,
      capacity,
      gender_label,
    })
    .select('id')
    .single()

  return { data, error }
}

// ============================================================
// Day 20 新增：按 id 找房间 / 改房间 / 删房间
// ============================================================

// 查询：按 id 找一间房(改/删之前先确认它存在，且属于本次要操作的营期)
async function findById(roomId, campId) {
  const { data, error } = await db
    .from('rooms')
    .select('id, camp_id, room_no, capacity, gender_label')
    .eq('id', roomId)
    .eq('camp_id', campId)
    .maybeSingle()

  return { data, error }
}

// 查询：这间房里现在住着谁(删房前必须先把他们放回未分配)
//   ⚠️ 不能跳过这步直接删 —— 否则 students.assigned_room_id 会指向一间不存在的房,
//   页面再读就会出问题。这正是 Day 18 处理"房号重复"时用同一套思路的原因。
async function findOccupants(roomId) {
  const { data, error } = await db
    .from('students')
    .select('id, name, assign_status')
    .eq('assigned_room_id', roomId)
    .eq('is_latest', true)

  return { data, error }
}

// 写入：把某间房里的成员全部放回「未分配」
async function releaseOccupants(roomId) {
  const { error } = await db
    .from('students')
    .update({ assigned_room_id: null, assign_status: '未分配' })
    .eq('assigned_room_id', roomId)

  return { error }
}

// 写入：修改房间(只改调用方明确传了的字段，没传的字段保持原样)
//   用 patch 而不是整对象覆盖 —— 免得前端漏传某个字段就把已有数据抹成空。
async function update(roomId, campId, patch) {
  const allowed = {}
  if (patch.room_no !== undefined) allowed.room_no = patch.room_no
  if (patch.capacity !== undefined) allowed.capacity = patch.capacity
  if (patch.gender_label !== undefined) allowed.gender_label = patch.gender_label

  // 一个字段都没传：什么都不做，交给调用方返回「没有要改的内容」
  if (Object.keys(allowed).length === 0) {
    return { data: null, error: null, noop: true }
  }

  const { data, error } = await db
    .from('rooms')
    .update(allowed)
    .eq('id', roomId)
    .eq('camp_id', campId)
    .select('id, room_no, capacity, gender_label')
    .single()

  return { data, error }
}

// 写入：删除房间
async function remove(roomId, campId) {
  const { error } = await db
    .from('rooms')
    .delete()
    .eq('id', roomId)
    .eq('camp_id', campId)

  return { error }
}

module.exports = {
  findByCamp,
  findCampById,
  findByRoomNo,
  create,
  findById,
  findOccupants,
  releaseOccupants,
  update,
  remove,
}