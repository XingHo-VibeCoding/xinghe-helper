import { useEffect, useState } from 'react'
import { fetchCampName, submitStudent } from '../api/students.js'
import AsyncButton from '../components/AsyncButton.jsx'

const TEACHERS = ['Mona', 'Kiven', 'Selena', 'Betty', 'Priya']
const CLASSES = ['星一', '星二', '星三']

// 必填项定义:key → 表单里的中文叫法(用于"还差 N 项没填"提示)
// Day 27 修正：这三个原来写的是代码字段名的直译（classLevel → "班级"没错但"期望拼房人数"
// 完全是 room_pref 的翻译），跟表单上用户实际看到的问法对不上，第三方看到会一脸茫然。
// 现在统一成表单上的原话，提示里出现的字就是页面上能找到的字。
const REQUIRED = [
  ['name', '姓名'],
  ['phone', '手机号'],
  ['gender', '性别'],
  ['teacher', '带班老师'],
  ['classLevel', '班级'],
  ['checkInDate', '你哪天到营入住'],
  ['roomPref', '你想几人一间'],
]

const EMPTY_FORM = {
  name: '',
  phone: '',
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
    // 去掉空格和横线再发：服务端也会做一次，这里先洗干净让用户看到的就是最终值。
    // 为什么手机号要归一化：用户可能打成「139 1234 5678」，
    // 去掉分隔符后手机号才能作为「同一个人的标识」稳定匹配。
    phone: f.phone.trim().replace(/[\s-]/g, ''),
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

// 手机号是否合格：非空 + 只剩数字 + 6–20 位
// 为什么不在这里校验「1 开头的中式手机号」：
//   营地里可能有座机、家长号码、海外号码。规则越窄越容易把真实数据挡在门外。
//   这里要的不是「电信能识别的号码」，只是一个稳定唯一的标识。
// 为什么 trim/replace 要重复服务端那一份：
//   服务端 readPhone() 也会做同样的事。两边都做不冲突 ——
//   前端做是为了即时提示，服务端做是为了防绕过。
function isPhoneOk(v) {
  const s = String(v || '').trim().replace(/[\s-]/g, '')
  return s.length >= 6 && s.length <= 20 && /^\d+$/.test(s)
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
      // Day 27 第三方试用发现：原文案直接漏内部字段名（「期望拼房人数」是room_pref
      // 的代码叫法），而且不说这些题在页面更下面，用户以为填完了却又报错，挫败感很强。
      // 改成：说清填哪几题（用表单上的原话）+ 告诉他往下滚。
      setErrMsg(`还差 ${lack.length} 项没填（往下滚，题都在页面下面）：${lack.map(([, label]) => label).join('、')}`)
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

        {/* Day 28 新增：手机号。
            为什么排在姓名后面 —— 它现在也是「同一个人」的判据，
            填表的人会下意识把「谁」和「他的号码」连着填。
            放在性别/班级这些选项之前，保持前两栏都是手写、后面都是点选。 */}
        <div
          className={`q ${missing.includes('phone') ? 'q-missing' : ''} ${
            form.phone && isPhoneOk(form.phone) ? 'q-done' : ''
          }`}
        >
          <div className="q-title">
            你的手机号? <span className="q-required">*</span>
            {form.phone && isPhoneOk(form.phone) && <span className="q-check">✓</span>}
          </div>
          <input
            className="q-input"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={form.phone}
            onChange={(e) => set('phone')(e.target.value)}
            placeholder="11 位手机号,方便组织者有急事找到你"
            maxLength={20}
          />
          {/* 填了但不合格时给一句说明 —— 不写"格式错误"这种话，
              直接告诉用户应该长什么样。type="tel" + inputMode="numeric"
              让手机弹出数字键盘，省掉切键盘这一步。 */}
          {form.phone && !isPhoneOk(form.phone) && (
            <p className="q-hint">请填一串数字,6–20 位。空格和横线可以不管。</p>
          )}
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
          {/* Day 27 第三方试用发现的卡点：<input type="date"> 渲染出来是个空白框，
              新手不知道那是日期选择器，会当成文本框手打，结果浏览器判定非法日期、
              值为空、提交被拦。原实现没有任何提示，第三方直接卡死在这一题。
              下面这行提示 + 日期框内的占位符就是修复。 */}
          <p className="q-hint-inline">点这里会弹出日历，选一个日期（不要手动打字）</p>
          <input
            className="q-input"
            type="date"
            placeholder="点击选择日期"
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
