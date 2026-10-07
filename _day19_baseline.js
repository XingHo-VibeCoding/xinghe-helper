// Day 19 | 重构前基线抓取（只读，不改任何业务代码）
//
// 为什么要这个文件？
//   今天做的是「重构」——把数据库查询代码搬家。搬完之后必须能证明：
//   接口的返回和搬家之前**一模一样**。证明方式就是：搬家前存一份，搬家后再取一份，
//   逐字段对比。所以这份基线是Day 19 唯一的证据来源。
//
// 怎么做才算「抓到基线」？
//   把每个已上线接口都真实调一遍，把完整返回原样存下来。注意：
//   · GET 接口可以直接调（只读，安全）
//   · POST 接口不能随便调成功路径 —— 它会真的往数据库里插数据！
//     所以 POST 只抓「必定失败的路径」（缺字段/重复房号/非法性别），
//     这些返回是确定的，不污染数据。成功路径另用 D19 专用房号单独抓。
//
// 抓不到 / 抓错的后果：
//   没有基线，重构完只能说「看起来一样」——那不算验证，
//   万一哪里悄悄变了行为也发现不了。今天这张底牌必须先拿到。

const BASE = 'https://xinghe-helper-d5g92pis442fd9947.service.tcloudbase.com'

// 用一个当天专属的房号，避免撞上已有数据，也避免和重构后的测试房冲突
//
// ⚠️ 房号为什么要分 before / after 两个（D19 / D19B）：
//   重构前那份基线已经用 D19 成功插进数据库了（脚本第 9 条会真写）。
//   如果重构后还用 D19，第 9 条必定返回 409 房号重复 ——
//   那是数据已经在那儿，不是重构做坏了。用新房号才能对比成功路径。
const PROBE_ROOM_BEFORE = 'D19'
const PROBE_ROOM_AFTER = 'D19B'

async function call(label, url, options) {
  const started = Date.now()
  try {
    const res = await fetch(url, options)
    const text = await res.text()
    let parsed
    try { parsed = JSON.parse(text) } catch { parsed = { __rawText: text } }
    return {
      label,
      httpStatus: res.status,
      body: parsed,
      _ms: Date.now() - started,
    }
  } catch (err) {
    return { label, httpStatus: 0, body: { __error: String(err) }, _ms: Date.now() - started }
  }
}

// 重构后对比用：node _day19_baseline.js --after
//   不加 --after → 用 D19（抓重构前基线）
//   加了 --after → 用 D19B（抓重构后基线，不撞前一份已插入的数据）
const isAfter = process.argv.includes('--after')

async function main() {
  const out = {
    抓取时间: new Date().toISOString(),
    阶段: isAfter ? '重构后' : '重构前',
    环境: BASE,
    说明: isAfter
      ? 'Day 19 分层重构后的基线。与 day19-baseline-before.json 逐项对比 body 是否完全一致。'
      : 'Day 19 分层重构前的基线。重构后加 --after 重跑同一脚本，逐项对比 body 是否完全一致。',
    接口: [],
  }

  // ---- 1. GET /api/health（健康检查，最简单的对照）----
  out.接口.push(await call('GET /api/health', `${BASE}/api/health`))

  // ---- 2. GET /api/rooms（Day 17 读接口 + Day 18 写接口共用的那个）----
  out.接口.push(await call('GET /api/rooms?camp_id=1', `${BASE}/api/rooms?camp_id=1`))

  // ---- 3. GET /api/rooms 缺参数（错误路径，验证校验层没变）----
  out.接口.push(await call('GET /api/rooms（缺 camp_id，应 400）', `${BASE}/api/rooms`))

  // ---- 4. GET /api/students（另一个读接口）----
  out.接口.push(await call('GET /api/students?camp_id=1', `${BASE}/api/students?camp_id=1`))

  // ---- 5. GET /api/students 缺参数 ----
  out.接口.push(await call('GET /api/students（缺 camp_id，应 400）', `${BASE}/api/students`))

  // ---- 6. POST /api/rooms 缺 camp_id（必定失败，不污染数据）----
  out.接口.push(await call('POST /api/rooms 缺 camp_id（应 400）', `${BASE}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room_no: 'X1', capacity: 4 }),
  }))

  // ---- 7. POST /api/rooms 房号重复（用已存在的 301，必定409，不污染数据）----
  out.接口.push(await call('POST /api/rooms 房号重复 301（应 409）', `${BASE}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ camp_id: 1, room_no: '301', capacity: 9 }),
  }))

  // ---- 8. POST /api/rooms gender_label 非法（必定400，不污染数据）----
  out.接口.push(await call('POST /api/rooms 性别标签非法（应 400）', `${BASE}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ camp_id: 1, room_no: 'X2', capacity: 4, gender_label: '混合' }),
  }))

  // ---- 9. POST /api/rooms 成功路径（会真插数据）----
  //   房号从命令行参数拿：不传就用 PROBE_ROOM_BEFORE（重构前那份基线的值），
  //   重构后抓的时候传 --after，就会用 PROBE_ROOM_AFTER（D19B）。
  //   同一个房号只能成功一次，这是数据库 unique 约束决定的，不是 bug。
  const probeRoom = isAfter ? PROBE_ROOM_AFTER : PROBE_ROOM_BEFORE

  out.接口.push(await call(`POST /api/rooms 成功写入 ${probeRoom}（会插数据）`, `${BASE}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ camp_id: 1, room_no: probeRoom, capacity: 4 }),
  }))

  // ---- 汇总：把关键字段提出来，方便肉眼对比 ----
  out.摘要 = out.接口.map(r => ({
    接口: r.label,
    httpStatus: r.httpStatus,
    ok: r.body?.ok,
    errorCode: r.body?.error?.code ?? null,
    // GET 列表接口记条数，重构前后条数变了就说明有问题
    数据条数: Array.isArray(r.body?.data) ? r.body.data.length : (r.body?.data ? 1 : 0),
  }))

  console.log(JSON.stringify(out, null, 2))
}

main()