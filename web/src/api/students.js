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
//入参直接是后端契约的行格式(下划线字段名),这里只补默认值,不再做驼峰→下划线的映射。
//
// Day 27 踩坑(第三方试用时暴露的真实 bug):
//   原来这里写 class_level: form.classLevel / check_in_date: form.checkInDate /
//   room_pref: Number(form.roomPref),而 StudentForm.jsx 的 toRow() **已经**转成下划线了。
//   等于把同一件事做了两遍、方向还相反 —— toRow 的输出里根本没有 classLevel 这个 key,
//   取出来全是 undefined,于是三个字段被发成 undefined,服务端一律报"不能为空"。
//   而前端必填校验查的是驼峰 form,所以校验全绿、提交必挂,用户完全看不懂。
//   教训:字段名转换只能有一个地方做,且调用方与被调用方必须说同一种语言。
//     修复方式:映射只在 toRow() 做一次(它离用户输入最近),本函数只做兜底。
export async function submitStudent(row) {
  if (useMockData) throw new Error('现在是演示数据模式(mock),提交功能需要配置 VITE_API_BASE_URL 连上公网接口后开放')

  // 返回 { id, updated }
  //   updated = true 说明这是重复提交(之前有过同名记录),页面文案要说"已更新"
  return apiPost('/api/students', {
    camp_id: CAMP_ID,
    name: row.name,
    gender: row.gender,
    teacher: row.teacher,
    class_level: row.class_level,
    check_in_date: row.check_in_date,
    room_pref: row.room_pref,
    snore: row.snore ?? null,
    sleep_quality: row.sleep_quality ?? null,
    note: row.note ?? null,
  })
}