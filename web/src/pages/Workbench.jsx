import { useEffect, useMemo, useState } from 'react'
import { runAssignment } from '../../../shared/assignEngine.js'
import AsyncButton from '../components/AsyncButton.jsx'
import {
  loadWorkbenchData,
  addRoom,
  updateRoom,
  deleteRoom,
  setStudentRoom,
  applyAssignments,
  saveHistorySnapshot,
  latestAiSnapshot,
} from '../api/rooms.js'

// 手动分配的合法性校验:红线(男女混住)与超员 → 拒绝;睡眠冲突 → 允许但黄标提示
function checkMove(student, room, members) {
  if (room.gender_label && room.gender_label !== student.gender)
    return `违反红线:${room.room_no} 已住${room.gender_label}生,不能混住`
  if (members.length >= room.capacity) return `超员:${room.room_no} 只能住 ${room.capacity} 人`
  return null
}

function roomMembers(students, roomId) {
  return students.filter((s) => s.assigned_room_id === roomId)
}

function sleepConflict(members) {
  const snorers = members.filter((m) => m.snore).length
  const light = members.filter((m) => m.sleep_quality === '差').length
  return snorers > 0 && light > 0
}

function StudentChip({ s, onDragStart }) {
  return (
    <div
      className="stu-chip"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/student-id', String(s.id))
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      <span className="stu-name">{s.name}</span>
      <span className="stu-meta">
        {s.teacher}·{s.class_level}·想{s.room_pref}人间
        {s.snore ? '·打呼' : ''}
        {s.sleep_quality === '差' ? '·睡眠差' : ''}
      </span>
    </div>
  )
}

export default function Workbench() {
  const [students, setStudents] = useState([])
  const [rooms, setRooms] = useState([])
  const [isMock, setIsMock] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('') // 首次加载失败:单独状态,不与操作警告混用
  const [alert, setAlert] = useState('') // 红色警告(违反红线/超员/操作失败)
  const [ok, setOk] = useState('') // 绿色反馈(操作成功的人话说明)
  const [busy, setBusy] = useState('') // 正在分房… / 保存中…
  const [aiStatus, setAiStatus] = useState('idle') // 一键分房按钮: idle | loading | success
  const [dropTarget, setDropTarget] = useState(null) // {roomId|null, ok:bool}
  const [newRoom, setNewRoom] = useState({ room_no: '', capacity: '' })
  const [addingRoom, setAddingRoom] = useState(false)
  const [editingRoomId, setEditingRoomId] = useState(null)
  const [editDraft, setEditDraft] = useState({})
  // Day 12: 未分配学生筛选(姓名/性别/班级)。规则依据 .workbuddy/skills/frontend-interaction-checklist
  const [filter, setFilter] = useState({ keyword: '', gender: '全部', classLevel: '全部' })

  async function load() {
    try {
      setLoadError('')
      const { students, rooms, isMock } = await loadWorkbenchData()
      setStudents(students)
      setRooms(rooms)
      setIsMock(!!isMock)
    } catch (err) {
      setLoadError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // 失败后点「重试」:回到加载态重新拉数据
  function retry() {
    setLoading(true)
    setLoadError('')
    load()
  }

  useEffect(() => {
    load()
  }, [])

  const unassigned = useMemo(
    () => students.filter((s) => !s.assigned_room_id),
    [students],
  )

  // ===== 筛选三态(有结果/无结果/清空恢复),对照 frontend-interaction-checklist 实现 =====
  const isFiltering =
    filter.keyword.trim() !== '' || filter.gender !== '全部' || filter.classLevel !== '全部'
  const filteredUnassigned = useMemo(() => {
    const kw = filter.keyword.trim().toLowerCase()
    return unassigned.filter(
      (s) =>
        (filter.gender === '全部' || s.gender === filter.gender) &&
        (filter.classLevel === '全部' || s.class_level === filter.classLevel) &&
        (kw === '' || s.name.toLowerCase().includes(kw)),
    )
  }, [unassigned, filter])
  const shownByGender = useMemo(
    () => ({
      男: filteredUnassigned.filter((s) => s.gender === '男'),
      女: filteredUnassigned.filter((s) => s.gender === '女'),
    }),
    [filteredUnassigned],
  )
  // 清空恢复:一键回到初始三项条件,列表随之回到全量
  function clearFilter() {
    setFilter({ keyword: '', gender: '全部', classLevel: '全部' })
  }
  const stats = {
    total: students.length,
    assigned: students.length - unassigned.length,
    unassigned: unassigned.length,
  }

  function flash(msg) {
    setAlert(msg)
    window.clearTimeout(flash._t)
    flash._t = window.setTimeout(() => setAlert(''), 4000)
  }

  // 绿色成功反馈:与红色警告同款节奏,3 秒后自动消失
  function okFlash(msg) {
    setOk(msg)
    window.clearTimeout(okFlash._t)
    okFlash._t = window.setTimeout(() => setOk(''), 3000)
  }

  // ===== AI 分房 =====
  async function runAI({ clearAll }) {
    if (rooms.length === 0) {
      // 失败路径:真实校验,人话提示,按钮回空闲可重试
      flash(clearAll ? '还没有房间:先在右侧「添加房间」,再重新分房' : '请先添加房间,再点一键 AI 分房')
      return
    }
    const pool = clearAll
      ? students
      : unassigned // 一键分房:只分未分配的;重新分房:全部推倒重算
    if (pool.length === 0) {
      flash(clearAll ? '没有学生数据,先等学生提交' : '没有未分配的学生')
      return
    }
    setBusy(clearAll ? '正在重新分房…' : '正在分房…')
    if (!clearAll) setAiStatus('loading') // 重新分房走 confirm 弹窗,不占用主按钮状态
    try {
      if (clearAll) {
        // 全部推倒:先清空所有人的分配
        await applyAssignments([], students.map((s) => s.id))
      }
      const { assignments, unassigned: failed } = runAssignment(pool, rooms)
      const clearIds = clearAll ? students.map((s) => s.id) : unassigned.map((s) => s.id)
      await applyAssignments(assignments, clearIds)
      await saveHistorySnapshot({ assignments, unassigned: failed, at: new Date().toISOString() })
      await load()
      setBusy('')
      if (!clearAll) {
        // 成功:按钮短暂显示「完成 ✓」,绿条给结果摘要,1.2s 后按钮回空闲
        setAiStatus('success')
        window.setTimeout(() => setAiStatus('idle'), 1200)
        okFlash(
          failed.length > 0
            ? `AI 分房完成:${assignments.length} 人已分配,${failed.length} 人分不进,名单见下方红条说明`
            : `AI 分房完成:${assignments.length} 人已全部入房`,
        )
      }
      if (failed.length > 0) {
        flash(`这 ${failed.length} 人分不进任何房间(${failed.map((f) => f.name).join('、')}),可手动拖拽安排`)
      }
    } catch (err) {
      setBusy('')
      setAiStatus('idle') // 失败:按钮回空闲,错误原因由 flash 红条说明
      flash(err.message)
    }
  }

  // ===== 恢复最近一次 AI 方案 =====
  async function restoreAI() {
    try {
      setBusy('正在恢复 AI 方案…')
      const snap = await latestAiSnapshot()
      if (!snap) {
        setBusy('')
        flash('还没有 AI 分房记录可恢复')
        return
      }
      const stillHere = students.filter((s) =>
        snap.snapshot.assignments.some((a) => a.student_id === s.id),
      )
      await applyAssignments(
        snap.snapshot.assignments.filter((a) => stillHere.some((s) => s.id === a.student_id)),
        students.map((s) => s.id),
      )
      await load()
      setBusy('')
    } catch (err) {
      setBusy('')
      flash(err.message)
    }
  }

  // ===== 拖拽 =====
  function dragOver(e, roomId) {
    e.preventDefault()
    if (dropTarget?.roomId === roomId) return
    const sid = Number(e.dataTransfer.getData('text/student-id') || e.dataTransfer.getData('text/plain'))
    const s = students.find((x) => x.id === sid)
    const room = rooms.find((r) => r.id === roomId)
    const ok =
      s && room ? !checkMove(s, room, roomMembers(students, roomId)) : false
    setDropTarget({ roomId, ok })
  }
  function dragLeaveRoom(roomId) {
    if (dropTarget?.roomId === roomId) setDropTarget(null)
  }
  async function dropToRoom(e, roomId) {
    e.preventDefault()
    setDropTarget(null)
    const sid = Number(e.dataTransfer.getData('text/student-id'))
    const s = students.find((x) => x.id === sid)
    const room = rooms.find((r) => r.id === roomId)
    if (!s || !room) return
    const problem = checkMove(s, room, roomMembers(students, roomId))
    if (problem) {
      flash(`分配不生效:${problem}。请换房间或先调整房间容量。`)
      return
    }
    try {
      await setStudentRoom(s.id, roomId)
      await load()
    } catch (err) {
      flash(err.message)
    }
  }
  async function dropToUnassigned(e) {
    e.preventDefault()
    setDropTarget(null)
    const sid = Number(e.dataTransfer.getData('text/student-id'))
    const s = students.find((x) => x.id === sid)
    if (!s || !s.assigned_room_id) return
    try {
      await setStudentRoom(s.id, null)
      await load()
    } catch (err) {
      flash(err.message)
    }
  }

  // ===== 房间管理 =====
  async function handleAddRoom(e) {
    e.preventDefault()
    const roomNo = newRoom.room_no.trim()
    const cap = Number(newRoom.capacity)
    if (!roomNo || !cap || cap < 1) {
      flash('房号和可住人数都要填(人数至少 1)')
      return
    }
    try {
      setBusy('保存中…')
      await addRoom(roomNo, cap)
      setNewRoom({ room_no: '', capacity: '' })
      setAddingRoom(false)
      await load()
      setBusy('')
    } catch (err) {
      setBusy('')
      flash(err.message.includes('duplicate') ? `房号 ${roomNo} 已经有了` : err.message)
    }
  }

  async function handleDeleteRoom(room) {
    const members = roomMembers(students, room.id)
    const ok = window.confirm(
      `确定删除 ${room.room_no} 房?` +
        (members.length ? `里面的 ${members.length} 人会回到未分配名单。` : ''),
    )
    if (!ok) return
    try {
      setBusy('删除中…')
      // Day 20：删房是一个原子操作 —— 后端在同一个云函数里先把成员放回未分配、
      // 再删房。以前这里是 unassignStudentsOfRoom() + deleteRoom() 两步，
      // 中间失败会留下「房还在但人被清空」或「房没了人还挂着」的半套数据。
      // 现在只调一次，unassigned_count 是这次被放回未分配的人数。
      const res = await deleteRoom(room.id)
      await load()
      setBusy('')
      flash(
        res?.unassigned_count
          ? `已删除 ${room.room_no} 房，${res.unassigned_count} 人已放回未分配`
          : `已删除 ${room.room_no} 房`,
      )
    } catch (err) {
      setBusy('')
      flash(err.message)
    }
  }

  function startEditRoom(room) {
    setEditingRoomId(room.id)
    setEditDraft({ room_no: room.room_no, capacity: String(room.capacity) })
  }
  async function saveEditRoom(room) {
    const roomNo = editDraft.room_no.trim()
    const cap = Number(editDraft.capacity)
    const members = roomMembers(students, room.id)
    if (!roomNo || !cap || cap < 1) {
      flash('房号和人数都要填好')
      return
    }
    if (cap < members.length) {
      flash(`容量不能小于已住人数(${members.length} 人)`)
      return
    }
    try {
      setBusy('保存中…')
      await updateRoom(room.id, { room_no: roomNo, capacity: cap })
      setEditingRoomId(null)
      await load()
      setBusy('')
    } catch (err) {
      setBusy('')
      flash(err.message)
    }
  }

  async function moveBack(student) {
    try {
      await setStudentRoom(student.id, null)
      await load()
    } catch (err) {
      flash(err.message)
    }
  }

  if (loading) return <section className="page"><p className="placeholder-note">加载中…</p></section>
  if (loadError)
    return (
      <section className="page">
        <div className="wb-empty state-error" role="alert">
          <p>工作台加载失败:可能是网络断开,或服务暂时不可用。</p>
          <p className="state-error-detail">{loadError}</p>
          <button className="btn-primary wb-btn" onClick={retry}>
            重试
          </button>
        </div>
      </section>
    )

  return (
    <section className="page wb-page">
      <header className="wb-head">
        <h1>分房工作台</h1>
        {isMock && <span className="mock-tag">演示数据(未接数据库)</span>}
        <div className="wb-stats">
          学生 {stats.total} 人 · 已分配 {stats.assigned} 人
          {stats.unassigned > 0 && (
            <span className="wb-stats-warn">· 未分配 {stats.unassigned} 人</span>
          )}
        </div>
        <div className="wb-actions">
          <AsyncButton
            className="btn-primary wb-btn"
            status={aiStatus}
            idle="一键 AI 分房"
            loading="分房中…"
            success="完成 ✓"
            onClick={() => runAI({ clearAll: false })}
            disabled={!!busy}
          />
          <button className="btn-plain" onClick={() => {
            if (window.confirm('将清空当前分配,用新方案替换。确定重新分房?')) runAI({ clearAll: true })
          }} disabled={!!busy || aiStatus !== 'idle'}>
            重新分房
          </button>
          <button className="btn-plain" onClick={restoreAI} disabled={!!busy || aiStatus !== 'idle'}>
            恢复 AI 方案
          </button>
        </div>
      </header>

      {busy && <div className="wb-busy">{busy}</div>}
      {ok && (
        <div className="ok-bar" role="status">
          {ok}
        </div>
      )}
      {alert && (
        <div className="form-alert" role="alert">
          {alert}
        </div>
      )}

      {stats.total === 0 && (
        <div className="wb-empty">
          还没有学生提交,把填写链接发到群里吧。左侧「填写页」顶部可以先体验提交。
        </div>
      )}

      <div className="wb-cols">
        {/* ===== 左栏:未分配学生 ===== */}
        <aside
          className={`wb-left ${dropTarget?.roomId === null ? (dropTarget.ok ? 'drop-ok' : 'drop-bad') : ''}`}
          onDragOver={(e) => dragOver(e, null)}
          onDragLeave={() => dragLeaveRoom(null)}
          onDrop={dropToUnassigned}
        >
          <h2 className="wb-sub">未分配学生</h2>
          {/* Day 12: 筛选条(姓名/性别/班级)。有结果→计数反馈;无结果→提示+清空入口;清空→一键恢复全量 */}
          <div className="wb-filter">
            <input
              className="q-input"
              placeholder="搜姓名…"
              value={filter.keyword}
              onChange={(e) => setFilter((f) => ({ ...f, keyword: e.target.value }))}
            />
            <select
              className="q-input"
              aria-label="按性别筛选"
              value={filter.gender}
              onChange={(e) => setFilter((f) => ({ ...f, gender: e.target.value }))}
            >
              <option>全部</option>
              <option>男</option>
              <option>女</option>
            </select>
            <select
              className="q-input"
              aria-label="按班级筛选"
              value={filter.classLevel}
              onChange={(e) => setFilter((f) => ({ ...f, classLevel: e.target.value }))}
            >
              <option>全部</option>
              <option>星一</option>
              <option>星二</option>
              <option>星三</option>
            </select>
            {isFiltering && (
              <button className="btn-mini" onClick={clearFilter}>
                清空
              </button>
            )}
          </div>
          {isFiltering && (
            <div className="wb-filter-count" role="status">
              筛出 {filteredUnassigned.length}/{unassigned.length} 人
            </div>
          )}
          {['男', '女']
            .filter((g) => filter.gender === '全部' || filter.gender === g)
            .map((g) => (
              <div className="wb-gender-group" key={g}>
                <div className="wb-gender-title">
                  {g}生 <span className="wb-count">{shownByGender[g].length} 人</span>
                </div>
                {shownByGender[g].length === 0 && <p className="wb-none">暂无</p>}
                {shownByGender[g].map((s) => (
                  <StudentChip key={s.id} s={s} />
                ))}
              </div>
            ))}
          {isFiltering && filteredUnassigned.length === 0 && (
            <div className="wb-filter-none">
              没有匹配的学生,换换条件,或者
              <button className="btn-mini" onClick={clearFilter}>
                清空筛选
              </button>
              回到全部
            </div>
          )}
          <p className="wb-hint">把学生拖到右边房间即可分配;拖回这里则移出房间。</p>
        </aside>

        {/* ===== 右栏:房间卡片 ===== */}
        <div className="wb-right">
          <div className="wb-right-head">
            <h2 className="wb-sub">房间({rooms.length})</h2>
            <button className="btn-plain" onClick={() => setAddingRoom((v) => !v)}>
              {addingRoom ? '收起' : '+ 添加房间'}
            </button>
          </div>

          {addingRoom && (
            <form className="room-add" onSubmit={handleAddRoom}>
              <input
                className="q-input room-add-input"
                placeholder="房号,如 305"
                value={newRoom.room_no}
                onChange={(e) => setNewRoom((r) => ({ ...r, room_no: e.target.value }))}
                maxLength={20}
              />
              <input
                className="q-input room-add-input"
                type="number"
                min="1"
                max="10"
                placeholder="可住人数"
                value={newRoom.capacity}
                onChange={(e) => setNewRoom((r) => ({ ...r, capacity: e.target.value }))}
              />
              <button className="btn-primary room-add-btn" type="submit">
                添加
              </button>
            </form>
          )}

          {rooms.length === 0 && (
            <div className="wb-empty">还没有房间。点右上「+ 添加房间」,按酒店给的房号和床位数录入。</div>
          )}

          <div className="room-list">
            {rooms.map((room) => {
              const members = roomMembers(students, room.id)
              const conflict = sleepConflict(members)
              const dropCls =
                dropTarget?.roomId === room.id ? (dropTarget.ok ? 'drop-ok' : 'drop-bad') : ''
              return (
                <div
                  key={room.id}
                  className={`room-card ${dropCls} ${conflict ? 'room-conflict' : ''}`}
                  onDragOver={(e) => dragOver(e, room.id)}
                  onDragLeave={() => dragLeaveRoom(room.id)}
                  onDrop={(e) => dropToRoom(e, room.id)}
                >
                  <div className="room-head">
                    {editingRoomId === room.id ? (
                      <div className="room-edit">
                        <input
                          className="q-input room-edit-input"
                          value={editDraft.room_no}
                          onChange={(e) => setEditDraft((d) => ({ ...d, room_no: e.target.value }))}
                        />
                        <input
                          className="q-input room-edit-input"
                          type="number"
                          min="1"
                          value={editDraft.capacity}
                          onChange={(e) => setEditDraft((d) => ({ ...d, capacity: e.target.value }))}
                        />
                        <button className="btn-plain" onClick={() => saveEditRoom(room)}>保存</button>
                        <button className="btn-plain" onClick={() => setEditingRoomId(null)}>取消</button>
                      </div>
                    ) : (
                      <>
                        <span className="room-no">{room.room_no}</span>
                        <span className="room-cap">
                          已住 {members.length}/{room.capacity}
                          {room.gender_label && ` · ${room.gender_label}生房`}
                        </span>
                        <span className="room-tools">
                          <button className="btn-mini" onClick={() => startEditRoom(room)}>编辑</button>
                          <button className="btn-mini btn-mini-danger" onClick={() => handleDeleteRoom(room)}>删除</button>
                        </span>
                      </>
                    )}
                  </div>

                  {conflict && (
                    <div className="room-warning">
                      ⚠ 睡眠冲突:同房既有打呼噜的,又有睡眠质量差的
                    </div>
                  )}

                  {members.length === 0 ? (
                    <p className="room-empty-hint">空房,拖学生进来</p>
                  ) : (
                    <div className="room-members">
                      {members.map((m) => (
                        <div key={m.id} className="stu-chip stu-chip-inroom" draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/student-id', String(m.id))
                            e.dataTransfer.effectAllowed = 'move'
                          }}>
                          <span className="stu-name">{m.name}</span>
                          <span className="stu-meta">
                            {m.teacher}·{m.class_level}·{m.check_in_date} 到
                            {m.snore ? '·打呼' : ''}
                            {m.sleep_quality === '差' ? '·睡眠差' : ''}
                          </span>
                          <button
                            className="btn-mini"
                            title="移回未分配"
                            onClick={() => moveBack(m)}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
