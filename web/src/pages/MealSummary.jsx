import { useEffect, useState } from 'react'
import { fetchMealDates, fetchMealSummary } from '../api/meals.js'

// 订餐汇总页(组织者):按天显示学生 15 个班 + 工作人员 3 个部门的订餐人数。
// 学生和工作人员分两大块,绝不混在一个总数里(这是本功能的底线,见方案文档 0 节)。
//
// 交互状态(checklist):
//   有结果   表格按两大块渲染,合计行加粗
//   无结果   a) 还没有任何订餐记录(dates 空) → 指路去生成二维码
//            b) 选中的这天没人填 → 「这一天还没有人提交订餐」
//   加载中   顶部「正在读取…」文字提示
//   失败     红条人话报错 + 「重试」按钮,已显示的数据不清空
//   恢复     切日期即重查,打印走浏览器打印(样式见 global.css 的 @media print)

const TEACHERS = ['Mona', 'Kiven', 'Selena', 'Betty', 'Priya']
const CLASSES = ['星一', '星二', '星三']
const DEPARTMENTS = ['教学部', '市场部', '其他部门']

// 把接口的 classes 数组(可能缺班)补齐成 15 行固定顺序 ——
//   缺的班显示 0,让「没人订」和「班不存在」在页面上有区别(方案文档 5.2 统计口径)
function fillClasses(classes) {
  const map = new Map(classes.map((c) => [`${c.teacher}|${c.class_level}`, c]))
  return TEACHERS.flatMap((t) =>
    CLASSES.map((c) => {
      const hit = map.get(`${t}|${c}`) || {}
      return { teacher: t, class_level: c, lunch: hit.lunch ?? 0, dinner: hit.dinner ?? 0 }
    }),
  )
}

function fillDepartments(departments) {
  const map = new Map(departments.map((d) => [d.department, d]))
  return DEPARTMENTS.map((d) => ({
    department: d,
    lunch: map.get(d)?.lunch ?? 0,
    dinner: map.get(d)?.dinner ?? 0,
  }))
}

function humanDate(iso) {
  const [, m, d] = iso.split('-')
  return `${Number(m)}月${Number(d)}日`
}

export default function MealSummary() {
  const [dates, setDates] = useState(null) // null = 还没拉到;[] = 拉到了但没记录
  const [date, setDate] = useState('')
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [errMsg, setErrMsg] = useState('')

  // 首次进入:拉日期列表,默认选中最近的一天(列表按升序返回,取最后一个)
  useEffect(() => {
    let alive = true
    setLoading(true)
    setErrMsg('')
    fetchMealDates()
      .then((d) => {
        if (!alive) return
        const list = d?.dates || []
        setDates(list)
        setDate(list[list.length - 1] || '')
      })
      .catch((err) => {
        if (!alive) return
        setDates([])
        setErrMsg(err.message)
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  // 日期变化:拉当天汇总
  useEffect(() => {
    if (!date) return
    let alive = true
    setLoading(true)
    setErrMsg('')
    fetchMealSummary(date)
      .then((s) => alive && setSummary(s))
      .catch((err) => {
        if (!alive) return
        setSummary(null)
        setErrMsg(err.message)
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [date])

  const hasData = !!summary
  const emptyDay = hasData && (summary.student?.total?.people ?? 0) + (summary.staff?.total?.people ?? 0) === 0

  return (
    <section className="page ov-page meal-summary-page">
      <header className="ov-head">
        <h1>订餐汇总</h1>
      </header>

      <div className="ov-actions no-print meal-date-row">
        <label htmlFor="meal-day">日期</label>
        <select
          id="meal-day"
          className="q-input meal-date-input"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          disabled={!dates || dates.length === 0}
        >
          {(dates || []).map((d) => (
            <option key={d} value={d}>
              {humanDate(d)}
            </option>
          ))}
        </select>
        <button type="button" className="btn-plain" onClick={() => window.print()}>
          打印
        </button>
      </div>

      {errMsg && (
        <div className="form-alert" role="alert">
          {errMsg}
          <button type="button" className="btn-plain no-print" onClick={() => setDate((v) => v)}>
            重试
          </button>
        </div>
      )}

      {/* 无结果态 a:一条记录都没有 —— 指路去生成二维码,不白屏 */}
      {dates && dates.length === 0 && !errMsg && (
        <div className="done-card">
          <div className="done-icon">?</div>
          <h1>还没有任何订餐记录</h1>
          <p>
            先去<b>「订餐码」</b>页面生成今天的二维码发给大家扫,这里就会有数了。
          </p>
        </div>
      )}

      {/* 无结果态 b:这天没人填 */}
      {hasData && emptyDay && !errMsg && (
        <div className="done-card">
          <div className="done-icon">?</div>
          <h1>这一天还没有人提交订餐</h1>
          <p>检查一下二维码是不是发对了日期,或者等大家填完再看。</p>
        </div>
      )}

      {hasData && !emptyDay && (
        <table className="roster-table meal-table">
          <caption>{humanDate(summary.meal_date)} 订餐汇总</caption>
          <thead>
            <tr>
              <th scope="col">分组</th>
              <th scope="col" className="num">
                午餐
              </th>
              <th scope="col" className="num">
                晚餐
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="meal-grp">
              <td colSpan={3}>学生</td>
            </tr>
            {fillClasses(summary.student?.classes || []).map((c) => (
              <tr key={`${c.teacher}|${c.class_level}`}>
                <td className="meal-sub">{c.teacher} {c.class_level}</td>
                <td className={`num ${c.lunch === 0 ? 'meal-zero' : ''}`}>{c.lunch}</td>
                <td className={`num ${c.dinner === 0 ? 'meal-zero' : ''}`}>{c.dinner}</td>
              </tr>
            ))}
            <tr className="meal-grp">
              <td>学生小计</td>
              <td className="num">{summary.student?.total?.lunch ?? 0}</td>
              <td className="num">{summary.student?.total?.dinner ?? 0}</td>
            </tr>

            <tr className="meal-grp">
              <td colSpan={3}>老师与创客</td>
            </tr>
            {fillDepartments(summary.staff?.departments || []).map((d) => (
              <tr key={d.department}>
                <td className="meal-sub">{d.department}</td>
                <td className={`num ${d.lunch === 0 ? 'meal-zero' : ''}`}>{d.lunch}</td>
                <td className={`num ${d.dinner === 0 ? 'meal-zero' : ''}`}>{d.dinner}</td>
              </tr>
            ))}
            <tr className="meal-grp">
              <td>工作人员小计</td>
              <td className="num">{summary.staff?.total?.lunch ?? 0}</td>
              <td className="num">{summary.staff?.total?.dinner ?? 0}</td>
            </tr>

            <tr className="meal-tot">
              <td>合计</td>
              <td className="num">{summary.grand?.lunch ?? 0}</td>
              <td className="num">{summary.grand?.dinner ?? 0}</td>
            </tr>
          </tbody>
        </table>
      )}

      {loading && <p className="q-hint">正在读取…</p>}
    </section>
  )
}
