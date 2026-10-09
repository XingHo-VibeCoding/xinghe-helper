// Day 20|公网接口客户端(client.js) —— 前端所有数据都从这里出去
//
// Day 20 最大的变化就在这个文件:
//   以前:前端直接 import supabase-js,用 anon key 直连数据库(PostgREST)。
//   现在:前端只调我们自己的云函数 HTTP 接口,数据库的访问权全部收在后端。
//
// 为什么不再直连数据库?
//   ① 权限边界:直连意味着 anon key 要暴露在浏览器里,任何人拿到就能直连库。
//     改成只调接口后,能做什么完全由后端接口决定 —— 前端拿 anon key 也写不了库。
//   ② 校验位置:像"男女混住""超员"这类业务规则,放在浏览器里可以被绕过
//     (改一下 JS 就能跳过去)。放后端才是真的拦得住。
//   ③ 一致性:「重复提交保留最新」这类需要多条写操作的逻辑,必须在一个地方
//     原子地做完,前端做一半失败就会留下脏数据。
//
// 环境变量(参考 .env.example 创建 web/.env):
//   VITE_API_BASE_URL —— 公网接口根地址,没有末尾斜杠。
//     注意 VITE_ 开头的变量会被打进前端产物,所以这里放的是「公开的接口地址」,
//     不是密钥。接口本身靠 CORS 白名单限制谁能调(见云函数 cors.js)。
//
// ⚠️ 如果没配 VITE_API_BASE_URL 会怎样?
//   这里不直接报错,而是自动退回 mock 数据 —— 页面能正常渲染,
//   只是数据是假的,并在页面上显示"演示数据"角标。
//   好处:配置没写好时不会白屏,你还能看到界面长什么样。

const MOCK_ROOMS = [
  { id: 101, camp_id: 1, room_no: '301', capacity: 4, gender_label: '女', created_at: null },
  { id: 102, camp_id: 1, room_no: '302', capacity: 4, gender_label: '男', created_at: null },
  { id: 103, camp_id: 1, room_no: '303', capacity: 3, gender_label: '女', created_at: null },
  { id: 104, camp_id: 1, room_no: '304', capacity: 6, gender_label: null, created_at: null },
]

const MOCK_STUDENTS = [
  { id: 1, camp_id: 1, name: '林小满', gender: '女', teacher: 'Mona', class_level: '星一', check_in_date: '2027-01-20', room_pref: 4, snore: false, sleep_quality: '好', note: null, is_latest: true, superseded_by: null, assigned_room_id: 101, assign_status: '已分配', created_at: null },
  { id: 2, camp_id: 1, name: '陈知夏', gender: '女', teacher: 'Mona', class_level: '星一', check_in_date: '2027-01-20', room_pref: 4, snore: true, sleep_quality: '一般', note: '轻度打呼,自己知道', is_latest: true, superseded_by: null, assigned_room_id: 101, assign_status: '已分配', created_at: null },
  { id: 3, camp_id: 1, name: '王一诺', gender: '女', teacher: 'Mona', class_level: '星二', check_in_date: '2027-01-21', room_pref: 4, snore: false, sleep_quality: '差', note: null, is_latest: true, superseded_by: null, assigned_room_id: 101, assign_status: '已分配', created_at: null },
  { id: 4, camp_id: 1, name: '苏晚晴', gender: '女', teacher: 'Selena', class_level: '星三', check_in_date: '2027-01-20', room_pref: 3, snore: false, sleep_quality: '好', note: null, is_latest: true, superseded_by: null, assigned_room_id: 103, assign_status: '已分配', created_at: null },
  { id: 5, camp_id: 1, name: '周砚', gender: '女', teacher: 'Selena', class_level: '星三', check_in_date: '2027-01-20', room_pref: 3, snore: false, sleep_quality: '一般', note: null, is_latest: true, superseded_by: null, assigned_room_id: 103, assign_status: '已分配', created_at: null },
  { id: 6, camp_id: 1, name: '赵子昂', gender: '男', teacher: 'Kiven', class_level: '星一', check_in_date: '2027-01-20', room_pref: 4, snore: true, sleep_quality: '好', note: null, is_latest: true, superseded_by: null, assigned_room_id: 102, assign_status: '已分配', created_at: null },
  { id: 7, camp_id: 1, name: '李昊然', gender: '男', teacher: 'Kiven', class_level: '星一', check_in_date: '2027-01-21', room_pref: 4, snore: false, sleep_quality: '一般', note: null, is_latest: true, superseded_by: null, assigned_room_id: 102, assign_status: '已分配', created_at: null },
  { id: 8, camp_id: 1, name: '孙一飞', gender: '男', teacher: 'Betty', class_level: '星二', check_in_date: '2027-01-20', room_pref: 6, snore: false, sleep_quality: '好', note: '想和赵子昂一间', is_latest: true, superseded_by: null, assigned_room_id: 102, assign_status: '已分配', created_at: null },
  { id: 9, camp_id: 1, name: '何静姝', gender: '女', teacher: 'Priya', class_level: '星二', check_in_date: '2027-01-21', room_pref: 2, snore: false, sleep_quality: '好', note: null, is_latest: true, superseded_by: null, assigned_room_id: 103, assign_status: '已分配', created_at: null },
  { id: 10, camp_id: 1, name: '郑楚', gender: '男', teacher: 'Betty', class_level: '星三', check_in_date: '2027-01-20', room_pref: 4, snore: false, sleep_quality: '好', note: null, is_latest: true, superseded_by: null, assigned_room_id: null, assign_status: '未分配', created_at: null },
  { id: 11, camp_id: 1, name: '高远', gender: '男', teacher: 'Kiven', class_level: '星二', check_in_date: '2027-01-21', room_pref: 2, snore: true, sleep_quality: '一般', note: null, is_latest: true, superseded_by: null, assigned_room_id: null, assign_status: '未分配', created_at: null },
  { id: 12, camp_id: 1, name: '沈知意', gender: '女', teacher: 'Priya', class_level: '星一', check_in_date: '2027-01-20', room_pref: 3, snore: false, sleep_quality: '差', note: '认床,怕吵', is_latest: true, superseded_by: null, assigned_room_id: null, assign_status: '未分配', created_at: null },
]

// 根地址:去掉末尾斜杠,避免拼出「//api/rooms」这种双斜杠路径
const rawBase = import.meta.env.VITE_API_BASE_URL || ''
export const API_BASE_URL = rawBase.replace(/\/+$/, '')

// 没配地址 → 退回 mock(演示数据模式)
export const useMockData = !API_BASE_URL

if (useMockData) {
  console.warn('[xinghe-helper] 没配 VITE_API_BASE_URL,页面会用演示数据(mock)。真实联调请复制 .env.example 为 .env 并填入接口地址')
}

// MVP只有一个营期。写在这里而不是散落在各处,是为了将来开第二个营期时只改一处。
export const CAMP_ID = Number(import.meta.env.VITE_CAMP_ID || 1)

// ============================================================
// Day 23 新增|toFriendlyMessage() —— 最后一道中文兜底
// ============================================================
// 今天的核心认识:错误提示要「说人话」,但人话不该散落在几十个页面里。
//
// 为什么服务端改完了还需要这个?
//   服务端把 500 类改成中文了(见云函数 response.js 的 failServer),
//   前端的网络错也改成了中文。但 request() 里能throw 的地方有四个,
//   谁能保证以后不新增第五个?所以在**出口**再设一道关:
//   所有抛出去的 Error,一律先过一遍这个函数。
//
// ⚠️ 一个真实的教训(今天踩到的):
//   这个函数第一版是「导出但没人调用」—— 因为页面那 11 处写的是
//   flash(err.message),而我判断「页面直接显示数据层的提示是对的写法」。
//   结果构建产物里 grep「连不上服务器」0 处,新函数被 Vite tree-shaking
//   掉了,等于白写。
//   **教训:验证「新代码生效」要看产物里有没有它,不能只看源文件改没改。**
//   「文件改了」和「代码起作用了」是两件事。
//
// 这个函数现在只做一件事:**拦住英文**。
// 原来这里有一张「英文报错 → 中文」的翻译表(Failed to fetch / timeout /
// ERR_CONNECTION_REFUSED / SSL……),Day 23 删掉了 ——
// 因为那四种情况**已经在 request() 里改掉了**:
//   · fetch 失败 → catch 分支已改成「连不上接口(方法 路径)。请检查①②③」
//   · 响应不是 JSON → 已改成「接口返回的不是合法 JSON(HTTP xxx),请稍后重试」
// 而浏览器抛出的英文报错,只要没进这两个分支,就说明是更底层的问题,
// 硬翻成「连不上服务器」反而可能把排查方向带偏。
// 所以规则只有一条:**没有中文就不编一句假话,原样返回(至少是真话)。**
export function toFriendlyMessage(err) {
  const raw = err?.message || '发生未知错误'

  // 已经是我们写过的人话(含中文)→ 原样返回,别二次加工。
  //   这条分支让函数「幂等」: 已经是中文的进来,出去还是它自己。
  if (/[\u4e00-\u9fa5]/.test(raw)) return raw

  // 没有中文 → 不编一句假提示,原样返回(至少是真话)
  return raw
}

// ============================================================
// 核心:发一个请求并拆统一信封
// ============================================================
// 后端所有接口都返回 { ok, data, error }。这里把「拆信封」这一步收在一处,
// 让上层业务代码只关心成功时的数据。
//
// 为什么失败时抛异常而不是返回 { error }?
//   因为调用点有十几处,每处都写 if (error) 迟早有一处忘了处理。
//   抛异常的话,漏处理会直接在控制台报错,比"页面悄悄显示空数据"更容易发现。
//   代价是调用方要用 try/catch —— 但页面里本来就已经在 try/catch 展示错误了。
//
// errorCode 挂在 Error 对象上:有些地方要按错误码做不同处理
//   (比如 409 房号重复要提示"换个房号")。
async function request(path, { method = 'GET', body, query } = {}) {
  let url = API_BASE_URL + path

  if (query && Object.keys(query).length > 0) {
    const qs = new URLSearchParams(
      Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    ).toString()
    if (qs) url += '?' + qs
  }

  let res
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    // fetch 本身失败 = 网络层问题(没网、地址写错、CORS 被拦、服务没起)
    //   这跟「接口回了 ok:false」是两回事,所以给一句能直接照着排查的话。
    //
    // ⚠️ Day 23 改动:不再把 err.message 拼进人话里。
    //   改前:「连不上接口(GET /api/rooms):Failed to fetch。请检查①②③」
    //   改后:「连不上接口(GET /api/rooms)。请检查①②③」
    //   原因:fetch 的原生报错是英文的(Failed to fetch / NetworkError /
    //   ERR_CONNECTION_REFUSED),对非技术用户没有任何信息量,还会让人以为是
    //   自己的电脑坏了。排查要用的信息一点没丢 —— 方法和路径都在,
    //   F12 的 Network 面板里能看到真实的浏览器报错,那才是给排查用的。
    throw new Error(
      `连不上接口(${method} ${path})。请检查 ①web/.env 里的 VITE_API_BASE_URL 是否正确 ②云函数是否已部署 ③浏览器控制台是否有 CORS 报错`,
    )
  }

  // CloudBase 的 OPTIONS 预检返回 204 且 body 为空,这里防御一下
  const text = await res.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    // 同样不把原始响应体贴出来 —— 它可能有几百字节 HTML 错误页,
    //   塞进提示里既难看又可能带内部信息。只说「格式不对」这个事实。
    throw new Error(`接口返回的不是合法 JSON(HTTP ${res.status}),请稍后重试`)
  }

  if (!payload) {
    throw new Error(`接口返回空响应(HTTP ${res.status}),请稍后重试`)
  }

  if (!payload.ok) {
    const e = new Error(payload.error?.message || `接口返回失败(HTTP ${res.status})`)
    e.code = payload.error?.code || 'UNKNOWN'
    e.httpStatus = res.status
    // Day 23:出口再过一道 toFriendlyMessage。
    //   后端今天起所有提示都是中文,所以这里通常是「原样返回」——
    //   但万一某个接口漏改了、或将来新接口忘了,至少不会把英文原样弹到页面上。
    e.message = toFriendlyMessage(e)
    throw e
  }

  return payload.data
}

export const apiGet = (path, query) => request(path, { method: 'GET', query })
export const apiPost = (path, body, query) => request(path, { method: 'POST', body, query })
export const apiPatch = (path, body, query) => request(path, { method: 'PATCH', body, query })
export const apiDelete = (path, query) => request(path, { method: 'DELETE', query })

// ============================================================
// 健康检查(契约 2.1)
// ============================================================
// 用途:打开页面时先探一次「云端通没通」。把「网络/部署问题」和
//   「数据本身有问题」分开 —— 前者显示"连不上服务",后者显示具体业务错误。
export async function pingHealth() {
  if (useMockData) return { ok: true, service: 'mock(演示数据,未连公网)' }
  const data = await apiGet('/api/health')
  return data
}

// mock 数据(演示模式专用):延迟 400ms,让 loading 状态在演示时也能被看到
export function fetchMockData() {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (window.location.search.includes('mockError')) {
        reject(new Error('演示用报错:读取学生失败(这只是模拟,别慌)'))
        return
      }
      resolve({ students: MOCK_STUDENTS, rooms: MOCK_ROOMS })
    }, 400)
  })
}