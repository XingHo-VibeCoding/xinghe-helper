import { useSearchParams } from 'react-router-dom'
import MealOrderForm from '../components/MealOrderForm.jsx'

// 学生订餐页(公开页,不在导航里)。链接来自组织者生成的学生二维码:
//   /meal?date=2027-01-20
// 日期只从链接取,页面上没有日期选择器 —— 学生填错日期比填错名字更难补救。
//
// 日期非法/缺失时的指引页属于 checklist 的「无结果」态:
//   不白屏,一句话说清发生了什么 + 下一步找谁。
export default function MealForm() {
  const [params] = useSearchParams()
  const date = params.get('date') || ''
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date)

  if (!dateOk) {
    return (
      <section className="page form-page">
        <div className="meal-whoami meal-whoami-student">
          <span className="meal-whoami-tag">学生</span>
          <div>
            <h1>学生订餐登记</h1>
          </div>
        </div>
        <div className="done-card">
          <div className="done-icon">?</div>
          <h1>这个二维码不对</h1>
          <p>没认出它是哪一天的订餐码。请找组织者拿<b>今天</b>的二维码再扫一次。</p>
        </div>
      </section>
    )
  }

  const [, m, d] = date.split('-')

  return (
    <MealOrderForm
      role="student"
      date={date}
      tone="student"
      whoTag="学生"
      headTitle="学生订餐登记"
      headSub={`${Number(m)} 月 ${Number(d)} 日 · 一分钟填完`}
    />
  )
}
