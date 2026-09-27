import { useEffect, useState } from 'react'
import { fetchCampName, submitStudent } from '../api/students.js'
import AsyncButton from '../components/AsyncButton.jsx'

const TEACHERS = ['Mona', 'Kiven', 'Selena', 'Betty', 'Priya']
const CLASSES = ['星一', '星二', '星三']

// 必填项定义:key → 表单里的中文叫法(用于"还差 N 项没填"提示)
const REQUIRED = [
  ['name', '姓名'],
  ['gender', '性别'],
  ['teacher', '带班老师'],
  ['classLevel', '班级'],
  ['checkInDate', '入住日期'],
  ['roomPref', '期望拼房人数'],
]

const EMPTY_FORM = {
  name: '',
  gender: '',
  teacher: '',
  classLevel: '',
  checkInDate: '',
  roomPref: '',
  snore: '',
  sleepQuality: '',
  note: '',
}

function toRow(f) {
  return {
    camp_id: 1,
    name: f.name.trim(),
    gender: f.gender,
    teacher: f.teacher,
    class_level: f.classLevel,
    check_in_date: f.checkInDate,
    room_pref: Number(f.roomPref),
    snore: f.snore === '' ? null : f.snore === '是',
    sleep_quality: f.sleepQuality || null,
    note: f.note.trim() || null,
  }
}

// 单选按钮组:大按钮、口语化,选中即"填过";missing=true 时整块高亮提示漏填
// hint 必须渲染在 .q 内部,否则会脱离题目的缩进,与同组题目错位
function Choice({ question, options, value, onChange, optional = false, missing = false, hint }) {
  return (
    <div className={`q ${value ? 'q-done' : ''} ${missing ? 'q-missing' : ''}`}>
      <div className="q-title">
        {question}
        {optional && <span className="q-optional">(选填)</span>}
        {value && <span className="q-check">✓</span>}
      </div>
      <div className="q-options">
        {options.map((opt) => (
          <button
            type="button"
            key={String(opt.value ?? opt)}
            className={`chip ${value === (opt.value ?? opt) ? 'chip-on' : ''}`}
            onClick={() => onChange(opt.value ?? opt)}
          >
            {opt.label ?? opt}
          </button>
        ))}
      </div>
      {hint && <p className="q-hint">{hint}</p>}
    </div>
  )
}

export default function StudentForm() {
  const [form, setForm] = useState(EMPTY_FORM)
  const [missing, setMissing] = useState([])
  const [camp, setCamp] = useState({ name: '第一期口语拉练营', org_name: null })
  const [status, setStatus] = useState('editing') // editing | submitting | done | error
  const [result, setResult] = useState(null)
  const [errMsg, setErrMsg] = useState('')

  useEffect(() => {
    fetchCampName().then((c) => c && setCamp(c))
  }, [])

  const set = (key) => (v) => {
    setForm((f) => ({ ...f, [key]: v }))
    setMissing((m) => m.filter((x) => x !== key))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    // 必填校验:空着就列出差哪几项(对应 PRD 异常场景"还差 2 项没填")
    const lack = REQUIRED.filter(([k]) => !form[k])
    if (lack.length > 0) {
      setMissing(lack.map(([k]) => k))
      setErrMsg(`还差 ${lack.length} 项没填:${lack.map(([, label]) => label).join('、')}`)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setErrMsg('')
    setStatus('submitting')
    try {
      const r = await submitStudent(toRow(form))
      setResult(r)
      setStatus('done')
      window.scrollTo({ top: 0 })
    } catch (err) {
      setErrMsg(err.message)
      setStatus('error')
    }
  }

  // ===== 确认页(PRD:F3 提交后给"接下来会发生什么"的预期)=====
  if (status === 'done') {
    return (
      <section className="page form-page">
        <div className="done-card">
          <div className="done-icon">✓</div>
          <h1>{result?.updated ? '已更新你的信息' : '提交成功'}</h1>
          <p>
            你的住宿需求已收到,开营前等通知分房结果。
            {result?.updated && '系统按你最新一次填写为准。'}
          </p>
          <p className="done-sub">填错了想改?点下面按钮重新填一遍就行。</p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setForm(EMPTY_FORM)
              setResult(null)
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
      <header className="form-head">
        {camp.org_name && <div className="form-org">{camp.org_name}</div>}
        <h1>{camp.name}</h1>
        <p className="form-lead">住宿安排登记:3 分钟填完,开营前等分房通知。带 <b>*</b> 的为必填。</p>
      </header>

      {errMsg && (
        <div className="form-alert" role="alert">
          {errMsg}
        </div>
      )}
      {status === 'error' && (
        <div className="form-alert" role="alert">
          提交没成功,检查网络后再试一次;还不行把这段话发给组织者:{errMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className={`q ${missing.includes('name') ? 'q-missing' : ''} ${form.name ? 'q-done' : ''}`}>
          <div className="q-title">
            你的名字是? <span className="q-required">*</span>
            {form.name && <span className="q-check">✓</span>}
          </div>
          <input
            className="q-input"
            type="text"
            value={form.name}
            onChange={(e) => set('name')(e.target.value)}
            placeholder="请填写真实姓名"
            maxLength={50}
          />
        </div>

        <Choice
          question={<span>你的性别? <span className="q-required">*</span></span>}
          options={['男', '女']}
          value={form.gender}
          onChange={set('gender')}
          missing={missing.includes('gender')}
        />

        <Choice
          question={<span>你是哪位老师带的? <span className="q-required">*</span></span>}
          options={TEACHERS}
          value={form.teacher}
          onChange={set('teacher')}
          missing={missing.includes('teacher')}
        />

        <Choice
          question={<span>你在哪个班? <span className="q-required">*</span></span>}
          options={CLASSES}
          value={form.classLevel}
          onChange={set('classLevel')}
          missing={missing.includes('classLevel')}
        />

        <div className={`q ${missing.includes('checkInDate') ? 'q-missing' : ''} ${form.checkInDate ? 'q-done' : ''}`}>
          <div className="q-title">
            你哪天到营入住? <span className="q-required">*</span>
            {form.checkInDate && <span className="q-check">✓</span>}
          </div>
          <input
            className="q-input"
            type="date"
            value={form.checkInDate}
            onChange={(e) => set('checkInDate')(e.target.value)}
          />
        </div>

        <Choice
          question={<span>你想几人一间? <span className="q-required">*</span></span>}
          options={[1, 2, 3, 4, 5, 6].map((n) => ({
            value: String(n),
            label: `${n} 人间`,
          }))}
          value={form.roomPref}
          onChange={set('roomPref')}
          missing={missing.includes('roomPref')}
          hint="人数越多,人均房费越便宜;只记录意愿,具体由组织者安排。"
        />

        <Choice
          question="你打呼噜吗?"
          options={['是', '否']}
          value={form.snore}
          onChange={set('snore')}
          optional
        />
        <Choice
          question="你平时睡得怎么样?"
          options={['好', '一般', '差']}
          value={form.sleepQuality}
          onChange={set('sleepQuality')}
          optional
        />

        <div className={`q ${form.note ? 'q-done' : ''}`}>
          <div className="q-title">
            还有什么要交代的? <span className="q-optional">(选填)</span>
            {form.note && <span className="q-check">✓</span>}
          </div>
          <textarea
            className="q-input"
            rows={3}
            value={form.note}
            onChange={(e) => set('note')(e.target.value)}
            placeholder='比如"对空调过敏""想和某某同班的一起住"'
            maxLength={500}
          />
        </div>

        <AsyncButton
          type="submit"
          className="btn-primary btn-submit"
          status={status === 'submitting' ? 'loading' : 'idle'}
          idle="提交"
          loading="提交中…"
        />
        <p className="q-hint">填错了没关系,重新打开链接再提交一次,系统按最新一次为准。</p>
      </form>
    </section>
  )
}
