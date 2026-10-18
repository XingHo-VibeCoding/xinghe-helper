import { useState } from 'react'
import AsyncButton from './AsyncButton.jsx'
import { submitMeal } from '../api/meals.js'

// 订餐填表(学生 / 工作人员共用):两边的题目和身份标不同,提交逻辑完全一样。
// 拆成共享组件的理由:两个表单 80% 代码相同,复制两份会让「防连点」「判重提示」
// 这些关键逻辑以后改一处漏一处。差异全部由页面通过 props 传入。
//
// 五态对照(frontend-interaction-checklist):
//   有结果  提交成功 → 确认页「已收到」
//   无结果  必填缺项 → 红条列出缺哪几题(用页面上的原话,不写代码字段名)
//   恢复    确认页「再填一次」→ 回到与首次打开完全一样的空表单
//   加载中  AsyncButton loading;防连点两件套:disabled + 函数入口 if(busy) return
//   失败    红条人话报错,已填内容原样保留,可直接再点提交
//
// 日期从二维码链接的 ?date= 来,页面不提供日期选择器 —— 防止填错日期。
// 日期非法时由外层页面拦截(渲染指引页),走不到本组件。

// 「不订」按钮的灰色样式标记:与「订」(选中绿勾/黑底白字)在视觉上区分开,
//   组织者扫一眼就知道这人订没订 —— 见方案文档 6.2 节
const YESNO = [
  { value: '1', label: '订' },
  { value: '0', label: '不订', tone: 'no' },
]

const TEACHERS = ['Mona', 'Kiven', 'Selena', 'Betty', 'Priya']
const CLASSES = ['星一', '星二', '星三']
const DEPARTMENTS = ['教学部', '市场部', '其他部门']

export default function MealOrderForm({ role, date, headTitle, headSub, whoTag, tone }) {
  // 题目定义:两份表单的差异全部收在这里
  const FIELDS =
    role === 'student'
      ? [
          { key: 'name', type: 'text', question: '你的名字是?', required: true, placeholder: '请填写真实姓名' },
          { key: 'teacher', type: 'choice', question: '你是哪位老师带的?', required: true, options: TEACHERS },
          { key: 'classLevel', type: 'choice', question: '你在哪个班?', required: true, options: CLASSES },
          { key: 'lunch', type: 'choice', question: '今天中午订吗?', required: true, options: YESNO },
          { key: 'dinner', type: 'choice', question: '今天晚上订吗?', required: true, options: YESNO },
        ]
      : [
          { key: 'name', type: 'text', question: '你的名字是?', required: true, placeholder: '请填写真实姓名' },
          { key: 'department', type: 'choice', question: '你在哪个部门?', required: true, options: DEPARTMENTS },
          { key: 'lunch', type: 'choice', question: '今天中午订吗?', required: true, options: YESNO },
          { key: 'dinner', type: 'choice', question: '今天晚上订吗?', required: true, options: YESNO },
        ]

  const REQUIRED = FIELDS.filter((f) => f.required)
  // 每道题在人话提示里的叫法 = 页面上的原话(不出现代码字段名,Day 27 的教训)
  const LABELS = Object.fromEntries(FIELDS.map((f) => [f.key, f.question.replace('?', '')]))

  const emptyForm = Object.fromEntries(FIELDS.map((f) => [f.key, '']))

  const [form, setForm] = useState(emptyForm)
  const [missing, setMissing] = useState([])
  const [status, setStatus] = useState('editing') // editing | submitting | done | error
  const [result, setResult] = useState(null)
  const [errMsg, setErrMsg] = useState('')

  const set = (key) => (value) => {
    setForm((f) => ({ ...f, [key]: value }))
    setMissing((m) => m.filter((x) => x !== key))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    // 防连点两件套之一:回车提交也会触发 onSubmit,必须在这里再挡一次
    // (按钮的 disabled 只挡得住鼠标,挡不住 <form> 里的回车)
    if (status === 'submitting') return

    const lack = REQUIRED.filter((f) => !form[f.key])
    if (lack.length > 0) {
      setMissing(lack.map((f) => f.key))
      setErrMsg(
        `还差 ${lack.length} 项没填(往下滚,题都在页面下面):${lack.map((f) => LABELS[f.key]).join('、')}`,
      )
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setErrMsg('')
    setStatus('submitting')
    try {
      // 组装成数据库行格式:lunch/dinner 转布尔;学生带老师+年级,工作人员带部门
      const row = {
        meal_date: date,
        role,
        name: form.name.trim(),
        lunch: form.lunch === '1',
        dinner: form.dinner === '1',
      }
      if (role === 'student') {
        row.teacher = form.teacher
        row.class_level = form.classLevel
      } else {
        row.department = form.department
      }
      const r = await submitMeal(row)
      setResult(r)
      setStatus('done')
      window.scrollTo({ top: 0 })
    } catch (err) {
      setErrMsg(err.message)
      setStatus('error') // 已填内容不动,红条提示后可直接再点提交
    }
  }

  // ===== 确认页:说清「接下来会发生什么」,并保留一条回到表单的路 =====
  if (status === 'done') {
    return (
      <section className="page form-page">
        <div className={`meal-whoami meal-whoami-${tone}`}>
          <span className="meal-whoami-tag">{whoTag}</span>
          <div>
            <h1>{headTitle}</h1>
            <p>{headSub}</p>
          </div>
        </div>
        <div className="done-card">
          <div className="done-icon">✓</div>
          <h1>{result?.updated ? '已更新你的订餐' : '提交成功'}</h1>
          <p>今天的订餐已收到,开饭前以这张表为准。</p>
          <p className="done-sub">填错了想改?点下面按钮重新填一遍就行,系统按最新一次为准。</p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setForm(emptyForm)
              setResult(null)
              setMissing([])
              setStatus('editing')
              window.scrollTo({ top: 0 })
            }}
          >
            再填一次
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="page form-page">
      <div className={`meal-whoami meal-whoami-${tone}`}>
        <span className="meal-whoami-tag">{whoTag}</span>
        <div>
          <h1>{headTitle}</h1>
          <p>{headSub}</p>
        </div>
      </div>

      {errMsg && (
        <div className="form-alert" role="alert">
          {errMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        {FIELDS.map((f) => {
          const isMissing = missing.includes(f.key)
          const isDone = form[f.key] !== ''
          return (
            <div key={f.key} className={`q ${isMissing ? 'q-missing' : ''} ${isDone ? 'q-done' : ''}`}>
              <div className="q-title">
                {f.question} {f.required && <span className="q-required">*</span>}
                {isDone && <span className="q-check">✓</span>}
              </div>
              {f.type === 'text' ? (
                <input
                  className="q-input"
                  type="text"
                  value={form[f.key]}
                  onChange={(e) => set(f.key)(e.target.value)}
                  placeholder={f.placeholder}
                  maxLength={50}
                />
              ) : (
                <div className="q-options">
                  {f.options.map((opt) => {
                    const value = typeof opt === 'string' ? opt : opt.value
                    const label = typeof opt === 'string' ? opt : opt.label
                    const no = typeof opt === 'object' && opt.tone === 'no'
                    return (
                      <button
                        type="button"
                        key={String(value)}
                        className={`chip ${form[f.key] === value ? 'chip-on' : ''} ${
                          no && form[f.key] !== value ? 'chip-no' : ''
                        }`}
                        onClick={() => set(f.key)(value)}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        <AsyncButton
          type="submit"
          className="btn-primary btn-submit"
          status={status === 'submitting' ? 'loading' : 'idle'}
          idle="提交"
          loading="提交中…"
        />
        <p className="q-hint">填错了没关系,重新打开链接再提交一次,系统按最新一次为准。</p>
      </form>

      {/* 身份反提示:防混码的第三道闸。即使扫错了码,打开页面立刻能发现 */}
      <div className="meal-footnote">
        {role === 'student'
          ? '如果你是老师或创客,请换一个二维码 —— 两边是分开统计的,混在一起人数会算不准。'
          : '如果你是学生,请换一个二维码 —— 学生和工作人员是分开统计的。'}
      </div>
    </section>
  )
}
