import { useSearchParams } from 'react-router-dom'
import MealOrderForm from '../components/MealOrderForm.jsx'

// 工作人员(老师与创客)订餐页(公开页,不在导航里)。链接来自工作人员二维码:
//   /staff-meal?date=2027-01-20
// 与学生页共用 MealOrderForm,差异只在题目(少老师/年级、多部门)和 role='staff'。
export default function StaffMealForm() {
  const [params] = useSearchParams()
  const date = params.get('date') || ''
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date)

  if (!dateOk) {
    return (
      <section className="page form-page">
        <div className="meal-whoami meal-whoami-staff">
          <span className="meal-whoami-tag">工作人员</span>
          <div>
            <h1>老师与创客订餐</h1>
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
      role="staff"
      date={date}
      tone="staff"
      whoTag="工作人员"
      headTitle="老师与创客订餐"
      headSub={`${Number(m)} 月 ${Number(d)} 日 · 不用填老师和班级`}
    />
  )
}
