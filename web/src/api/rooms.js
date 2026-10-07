// F2 分房工作台的数据层 —— Day 20 起全部走公网接口
//
// Day 8~18 这里是用 supabase-js 直连数据库,今天改成调用自己的云函数接口。
//   改的是「怎么拿到数据」,不是「页面要什么数据」——
//   所以导出的函数名和参数一个都没变,页面(Workbench.jsx / Overview.jsx)一行没改。
//
// 每个函数对应契约里的哪一条,都写在注释上了。改之前先对一眼契约,
// 别凭印象改字段名。
//
// 形状对照(以前 vs 现在):
//   以前 supabase.from('rooms').select('*') → 直接拿到数组
//   现在 apiGet(...)解信封后返回 data     → 同样是数组
//   所以上层拿到的数据形状没变,页面不用改。
import {
  CAMP_ID,
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
  useMockData,
  fetchMockData,
} from './client.js'

// 工作台首屏:学生 + 房间一起拿
// 两个请求并发发(Promise.all),而不是一个完了再一个 —— 首屏时间从两次往返变成一次。
export async function loadWorkbenchData() {
  if (useMockData) {
    const { students, rooms } = await fetchMockData()
    return { students, rooms, isMock: true }
  }
  const [students, rooms] = await Promise.all([
    apiGet('/api/students', { camp_id: CAMP_ID }),
    apiGet('/api/rooms', { camp_id: CAMP_ID }),
  ])
  return { students, rooms, isMock: false }
}

// 写操作的 mock 防御:演示模式下明确说"不可用",不白屏也不假成功。
// 注意语序从「第 3 周接入」改成了「已接入」—— 今天是 Day 20,接口已经有了,
//   但没配 VITE_API_BASE_URL 时页面还在演示模式,这时候写操作理应被挡住。
function noWrite() {
  if (useMockData) throw new Error('现在是演示数据模式(mock),保存类操作需要配置 VITE_API_BASE_URL 连上公网接口后开放')
}

// 契约 2.6 POST /api/rooms —— 新建房间
export async function addRoom(roomNo, capacity) {
  noWrite()
  // 后端返回 { id },这里不回传(调用方原本也不需要 id,列表刷新即可)
  await apiPost('/api/rooms', { camp_id: CAMP_ID, room_no: roomNo, capacity })
}

// 契约 2.7 PATCH /api/rooms?id=&camp_id= —— 改房间
// 注意契约原本写的是 PATCH /api/rooms/:id,改成查询参数是因为控制台的
//   路径 passthrough 关着,/:id 传不进来。语义一致。
export async function updateRoom(roomId, patch) {
  noWrite()
  await apiPatch('/api/rooms', patch, { id: roomId, camp_id: CAMP_ID })
}

// 契约 2.8 DELETE /api/rooms?id=&camp_id= —— 删房间
//
// ⚠️ 这里和以前不一样,值得单独说明:
//   以前是两个函数:先 unassignStudentsOfRoom() 再 deleteRoom(),
//   由调用方在中间那步失败时自己处理。
//   现在删房是一个原子操作 —— 后端在同一个云函数里先把人放回未分配、再删房,
//   避免出现「房被删了但人还挂在那个不存在的房号上」。
//   所以 unassignStudentsOfRoom 保留下来只为兼容旧调用点,它会明确告诉调用方
//   「不用单独调了,删房已经包含这一步」。
export async function unassignStudentsOfRoom(roomId) {
  noWrite()
  console.warn(
    '[xinghe-helper] unassignStudentsOfRoom 已废弃:删房时后端会自动把成员放回未分配,无需单独调用',
  )
  return { roomId, deprecated: true }
}

export async function deleteRoom(roomId) {
  noWrite()
  // 返回 { id, unassigned_count },unassigned_count 是这次被放回未分配的人数,
  //   调用方可以用它告诉用户"有 N 人已放回未分配"。
  return apiDelete('/api/rooms', { id: roomId, camp_id: CAMP_ID })
}

// 契约 2.9 PATCH /api/students?id= —— 单个学生分配/取消分配(拖拽松手即时保存)
// roomId 传 null 表示放回未分配 —— 后端要求显式传 null,不能不传这个字段。
export async function setStudentRoom(studentId, roomId) {
  noWrite()
  await apiPatch('/api/students', { room_id: roomId }, { id: studentId })
}

// 契约 2.10 POST /api/students?action=apply —— 批量应用分配方案
//
// 这里最大的变化:以前是前端循环发几十次数据库写入,现在只发一个 HTTP 请求,
//   后端在云函数里一次处理完。理由在 students.repo.applyAssignments 的注释里:
//   前端循环慢,而且中途失败会留下半套数据。
export async function applyAssignments(assignments, clearStudentIds) {
  noWrite()
  return apiPost(
    '/api/students',
    { camp_id: CAMP_ID, assignments, clear_student_ids: clearStudentIds ?? [] },
    { action: 'apply' },
  )
}

// 契约 2.11 POST /api/students?action=history —— 保存 AI 分房快照(供"恢复 AI 方案")
export async function saveHistorySnapshot(snapshot) {
  noWrite()
  return apiPost('/api/students', { camp_id: CAMP_ID, snapshot }, { action: 'history' })
}

// 契约 2.12 GET /api/students?action=history —— 取最近一次 AI 快照
// 后端在没有快照时返回 data: null(而不是报错)—— 从没点过 AI 分房是正常状态,
//   不是错误。调用方拿到 null 就显示"还没有可恢复的方案"。
export async function latestAiSnapshot() {
  noWrite()
  return apiGet('/api/students', { action: 'history', camp_id: CAMP_ID })
}