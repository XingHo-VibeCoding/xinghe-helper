import { useEffect, useMemo, useState } from 'react'
import { loadWorkbenchData } from '../api/rooms.js'

// 标记列:打呼 / 睡眠差(打印友好,用文字不用颜色)
function flags(s) {
  const f = []
  if (s.snore) f.push('打呼')
  if (s.sleep_quality) f.push(`睡眠${s.sleep_quality}`)
  return f.join(' / ')
}

function MemberTable({ students, showRoom }) {
  return (
    // 8 列表格在窄屏必然超宽,外面套一层横向滚动容器,页面本身不被撑破
    <div className="roster-scroll">
      <table className="roster-table">
        <thead>
          <tr>
            <th>姓名</th>
            <th>性别</th>
            <th>带班老师</th>
            <th>班级</th>
            <th>入住日期</th>
            <th>标记</th>
            {showRoom && <th>房间</th>}
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s) => (
            <tr key={s.id}>
              <td className="td-name">{s.name}</td>
              <td>{s.gender}</td>
              <td>{s.teacher}</td>
              <td>{s.class_level}</td>
              <td>{s.check_in_date}</td>
              <td className="td-flags">{flags(s) || '—'}</td>
              {showRoom && <td>{s.room_no ?? '未分配'}</td>}
              <td className="td-note">{s.note || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Overview() {
  const [students, setStudents] = useState([])
  const [rooms, setRooms] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState('room') // 'room' | 'teacher'
  const [copied, setCopied] = useState(false)

  async function load() {
    try {
      setError('')
      const d = await loadWorkbenchData()
      setStudents(d.students)
      setRooms(d.rooms)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }
  // 失败后点「重试」:回到加载态重新拉数据
  function retry() {
    setLoading(true)
    setError('')
    load()
  }
  useEffect(() => {
    load()
  }, [])

  const assigned = useMemo(() => students.filter((s) => s.assigned_room_id), [students])
  const unassigned = useMemo(() => students.filter((s) => !s.assigned_room_id), [students])
  const roomNoById = useMemo(
    () => Object.fromEntries(rooms.map((r) => [r.id, r.room_no])),
    [rooms],
  )
  const formUrl = `${window.location.origin}/form`

  // ===== 按房间视图 =====
  const roomsWithMembers = useMemo(
    () =>
      rooms.map((r) => ({
        ...r,
        members: assigned
          .filter((s) => s.assigned_room_id === r.id)
          .sort((a, b) => a.name.localeCompare(b.name, 'zh')),
      })),
    [rooms, assigned],
  )

  // ===== 按老师→班级视图(导出默认排序:老师 → 班级 → 姓名)=====
  const teacherGroups = useMemo(() => {
    const g = new Map()
    for (const s of assigned) {
      if (!g.has(s.teacher)) g.set(s.teacher, new Map())
      const byClass = g.get(s.teacher)
      if (!byClass.has(s.class_level)) byClass.set(s.class_level, [])
      byClass.get(s.class_level).push(s)
    }
    return [...g.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'zh'))
      .map(([teacher, byClass]) => ({
        teacher,
        classes: [...byClass.entries()]
          .sort(([a], [b]) => a.localeCompare(b, 'zh'))
          .map(([cls, list]) => ({
            cls,
            list: list
              .map((s) => ({ ...s, room_no: roomNoById[s.assigned_room_id] }))
              .sort((a, b) => a.name.localeCompare(b.name, 'zh')),
          })),
      }))
  }, [assigned, roomNoById])

  function handleExport() {
    if (unassigned.length > 0) {
      const go = window.confirm(
        `还有 ${unassigned.length} 人未分配,导出的名单不含他们。继续导出?`,
      )
      if (!go) return
    }
    window.print()
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(formUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // 剪贴板不可用(非 https 等):退化成选中提示
      window.prompt('复制下面的填写链接:', formUrl)
    }
  }

  if (loading) return <section className="page"><p className="placeholder-note">加载中…</p></section>
  if (error)
    return (
      <section className="page">
        <div className="wb-empty state-error" role="alert">
          <p>名单加载失败:可能是网络断开,或服务暂时不可用。</p>
          <p className="state-error-detail">{error}</p>
          <button className="btn-primary wb-btn" onClick={retry}>
            重试
          </button>
        </div>
      </section>
    )

  return (
    <section className="page ov-page">
      {/* 打印时的抬头(屏幕上隐藏) */}
      <div className="ov-print-head">
        <h1>口语拉练营 · 住宿分配名单</h1>
        <p>打印时间:{new Date().toLocaleString('zh-CN')}</p>
      </div>

      <header className="ov-head no-print">
        <h1>名单总览</h1>
        <div className="wb-stats">
          学生 {students.length} 人 · 已分配 {assigned.length} 人
          {unassigned.length > 0 && (
            <span className="wb-stats-warn">· 未分配 {unassigned.length} 人</span>
          )}
        </div>
        <div className="ov-actions">
          <div className="ov-view-toggle">
            <button className={`btn-plain ${view === 'room' ? 'toggle-on' : ''}`} onClick={() => setView('room')}>
              按房间
            </button>
            <button className={`btn-plain ${view === 'teacher' ? 'toggle-on' : ''}`} onClick={() => setView('teacher')}>
              按老师→班级
            </button>
          </div>
          <button className="btn-primary wb-btn" onClick={handleExport} disabled={students.length === 0}>
            导出 / 打印名单
          </button>
        </div>
      </header>

      {students.length === 0 ? (
        <div className="wb-empty">
          <p>还没有学生提交,把填写链接发到群里吧。</p>
          <div className="ov-link-row">
            <code className="ov-link">{formUrl}</code>
            <button className="btn-plain" onClick={copyLink}>
              {copied ? '已复制 ✓' : '复制链接'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ===== 按房间 ===== */}
          {view === 'room' && (
            <div className="ov-body">
              {roomsWithMembers.map((r) => (
                <div key={r.id} className="roster-block">
                  <h2 className="roster-title">
                    {r.room_no} 房
                    <span className="roster-cap">
                      {r.members.length}/{r.capacity} 人{r.gender_label ? ` · ${r.gender_label}生` : ''}
                    </span>
                  </h2>
                  {r.members.length === 0 ? (
                    <p className="roster-none">空房</p>
                  ) : (
                    <MemberTable students={r.members} showRoom={false} />
                  )}
                </div>
              ))}
              {unassigned.length > 0 && (
                <div className="roster-block roster-unassigned">
                  <h2 className="roster-title">
                    未分配
                    <span className="roster-cap">{unassigned.length} 人</span>
                  </h2>
                  <MemberTable students={unassigned} showRoom={false} />
                </div>
              )}
              {rooms.length === 0 && assigned.length === 0 && (
                <div className="wb-empty">
                  还没有房间或分配记录。去「分房工作台」添加房间并分房后,这里会生成名单。
                </div>
              )}
            </div>
          )}

          {/* ===== 按老师→班级 ===== */}
          {view === 'teacher' && (
            <div className="ov-body">
              {teacherGroups.map(({ teacher, classes }) => (
                <div key={teacher} className="roster-block">
                  <h2 className="roster-title">{teacher} 老师带的学生</h2>
                  {classes.map(({ cls, list }) => (
                    <div key={cls}>
                      <h3 className="roster-class">{cls} 班({list.length} 人)</h3>
                      <MemberTable students={list} showRoom />
                    </div>
                  ))}
                </div>
              ))}
              {unassigned.length > 0 && (
                <div className="roster-block roster-unassigned">
                  <h2 className="roster-title">
                    未分配
                    <span className="roster-cap">{unassigned.length} 人</span>
                  </h2>
                  <MemberTable students={unassigned} showRoom={false} />
                </div>
              )}
              {teacherGroups.length === 0 && unassigned.length === 0 && (
                <div className="wb-empty">还没有已分配的学生。先去「分房工作台」分房。</div>
              )}
            </div>
          )}

          <p className="ov-print-foot">
            共 {students.length} 人:已分配 {assigned.length},未分配 {unassigned.length}。
          </p>
        </>
      )}
    </section>
  )
}
