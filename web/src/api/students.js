// F1 学生提交的数据层 —— Day 20 起走公网接口
//
// 最大的变化在这三步的归属:
//   以前(浏览器里做):
//     1. supabase.insert(form)          插一条新记录
//     2. supabase.update(is_latest=false) 把同名旧记录标失效
//     3. supabase.count()              数一下有几条历史,决定文案
//     —— 三次独立请求。中间断网,第2 步没做成,就会留下一条「两条 is_latest=true」
//        的脏数据:工作台会把这个学生显示两次,而且没法判断哪条是对的。
//   现在(后端一次做完):
//     POST /api/students → 云函数里依次完成这三步,一次返回。
//
// 这就是「把多步写操作搬到后端」最实在的理由:不是为了让代码好看,
// 是为了让这几步不会只做一半。
import { CAMP_ID, apiGet, apiPost, useMockData } from './client.js'

// 契约 2.2 GET /api/students?action=camp —— 营期信息
// 查不到时返回 null(而不是抛错):表单页只是拿它显示个标题,
//   显示不了标题不该拦住学生填表。
export async function fetchCampName() {
  if (useMockData) return { name: '星禾 2027 冬令营(演示数据)', org_name: '星禾创客' }
  try {
    return await apiGet('/api/students', { action: 'camp', camp_id: CAMP_ID })
  } catch (err) {
    console.warn('[xinghe-helper] 读取营期信息失败(不阻断填表):', err.message)
    return null
  }
}

// 契约 2.3 POST /api/students —— 学生报名
// form 的字段与 StudentForm.jsx 的 collect() 输出一致:
//   name / gender / teacher / classLevel / checkInDate / roomPref(数字) /
//   snore(布尔或null) / sleepQuality / note
//   ← 注意 classLevel 在前端是驼峰,这里要转成后端契约的 class_level。
export async function submitStudent(form) {
  if (useMockData) throw new Error('现在是演示数据模式(mock),提交功能需要配置 VITE_API_BASE_URL 连上公网接口后开放')

  // 返回 { id, updated }
  //   updated = true 说明这是重复提交(之前有过同名记录),页面文案要说"已更新"
  return apiPost('/api/students', {
    camp_id: CAMP_ID,
    name: form.name,
    gender: form.gender,
    teacher: form.teacher,
    class_level: form.classLevel,
    check_in_date: form.checkInDate,
    room_pref: Number(form.roomPref),
    snore: form.snore === '' ? null : Boolean(form.snore),
    sleep_quality: form.sleepQuality || null,
    note: form.note || null,
  })
}