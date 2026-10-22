import { useRef, useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'

// 组织者生成当天两张二维码(学生蓝 / 工作人员橙)。
//
// 防混码第一层就在这里:两张码不只是链接不同 —— 下载出来的 PNG 顶部带彩色标题栏,
//   打印出来贴在一起,扫之前就能看出哪张是学生的、哪张是工作人员的。
//   (光靠链接区分没用:没人会去读地址栏。)
//
// 生成是纯前端动作(不调接口),日期一选两张码实时更新,没有「生成」按钮,
//   也就没有连点问题;需要防连点的是下面的下载(1.2s 冷却,见 dlCool 状态)。
//
// 交互状态(checklist):
//   有结果   默认出今天两张码;换日期立刻换链接和码
//   失败     下载合成失败 → 红条人话提示,码还在,可重试
//   无结果   不适用(码永远能画出来)

const TEACHER_DATE_TIP = '两张码都只对所选日期有效,换一天要重新生成、重新打印。'

// 把当天日期格式化成给人看的「1月20日」
function humanDate(iso) {
  const [, m, d] = iso.split('-')
  return `${Number(m)}月${Number(d)}日`
}

// 合成「彩色标题栏 + 二维码」的 PNG 并触发下载。
// 为什么不直接下载 QRCodeCanvas 的画布:光秃秃一个码,两张纸放一起没人分得清。
// 标题画进图片里,是打印后唯一肉眼可辨的区分。
function downloadQr(qrCanvas, { title, sub, color, filename }) {
  const size = qrCanvas.width
  const pad = 24 // 从 16 加大到 24,给彩色边框留位置
  const headH = 56
  const footH = 40
  const frame = 8 // 彩色边框厚度
  const frameGap = 6 // 边框与二维码之间的白色内衬
  const out = document.createElement('canvas')
  out.width = size + pad * 2
  out.height = size + pad * 2 + headH + footH
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持画布')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, out.width, out.height)
  // 标题栏
  ctx.fillStyle = color
  ctx.fillRect(0, 0, out.width, headH)
  ctx.fillStyle = '#ffffff'
  ctx.font = '600 22px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(title, out.width / 2, headH / 2)
  // 彩色边框(2026-10-22 加):与标题栏同色 —— 标题是文字,离远了或没戴眼镜看不清;
  //   边框是大色块,两张纸并排贴着,扫之前一眼就能分出蓝=学生、橙=老师创客。
  //   这是防混码的强化层:标题栏(文字)+ 边框(颜色块) + 链接路径,三层冗余。
  ctx.fillStyle = color
  ctx.fillRect(
    pad - frame - frameGap,
    headH + pad - frame - frameGap,
    size + (frame + frameGap) * 2,
    size + (frame + frameGap) * 2,
  )
  // 白色内衬:彩色边框与二维码之间隔一段白 —— 二维码扫码要求四周留白(静区),
  //   直接贴着色块印可能扫不出来,所以先铺白再放码。
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(
    pad - frameGap,
    headH + pad - frameGap,
    size + frameGap * 2,
    size + frameGap * 2,
  )
  // 二维码
  ctx.drawImage(qrCanvas, pad, headH + pad)
  // 底部小字:链接与日期,便于核对
  ctx.fillStyle = '#6b6b6b'
  ctx.font = '400 13px system-ui, sans-serif'
  ctx.fillText(sub, out.width / 2, headH + pad + size + footH / 2)

  const a = document.createElement('a')
  a.href = out.toDataURL('image/png')
  a.download = filename
  a.click()
}

export default function MealQr() {
  // 默认今天(本地时区,不用 toISOString —— 那是 UTC,晚上会差一天)
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`

  const [date, setDate] = useState(today)
  const [dlErr, setDlErr] = useState('')
  const [dlCool, setDlCool] = useState('') // 正在冷却的下载按钮标识,防连点
  const studentQr = useRef(null)
  const staffQr = useRef(null)

  const origin = window.location.origin
  const studentUrl = `${origin}/meal?date=${date}`
  const staffUrl = `${origin}/staff-meal?date=${date}`
  const dateCn = humanDate(date)

  function handleDownload(which) {
    if (dlCool) return // 防连点:函数入口判断(回车/程序调用也挡得住)
    setDlErr('')
    setDlCool(which)
    try {
      if (which === 'student') {
        downloadQr(studentQr.current.querySelector('canvas'), {
          title: `学生订餐 · ${dateCn}`,
          sub: studentUrl,
          color: '#378add',
          filename: `学生订餐-${date}.png`,
        })
      } else {
        downloadQr(staffQr.current.querySelector('canvas'), {
          title: `老师与创客订餐 · ${dateCn}`,
          sub: staffUrl,
          color: '#ba7517',
          filename: `老师与创客订餐-${date}.png`,
        })
      }
    } catch (err) {
      setDlErr('图片没存下来,再点一次试试;还不行就换个浏览器。')
    } finally {
      // 1.2s 冷却,期间按钮置灰;跟 AsyncButton 的成功态节奏一致
      window.setTimeout(() => setDlCool(''), 1200)
    }
  }

  return (
    <section className="page meal-qr-page">
      <header className="ov-head">
        <h1>生成今天的订餐二维码</h1>
        <p className="placeholder-note">
          两张码长得完全不一样:颜色不同、顶部标题不同、下载文件名也不同。贴出去之前先对一眼。
        </p>
      </header>

      <div className="ov-actions meal-date-row">
        <label htmlFor="meal-date">日期</label>
        <input
          id="meal-date"
          type="date"
          className="q-input meal-date-input"
          value={date}
          onChange={(e) => {
            if (e.target.value) setDate(e.target.value)
          }}
        />
      </div>

      {dlErr && (
        <div className="form-alert" role="alert">
          {dlErr}
        </div>
      )}

      <div className="qr-duo">
        <div className="meal-qr-card meal-qr-card-student">
          <div className="meal-qr-cap">学生订餐 · {dateCn}</div>
          <div className="meal-qr-body" ref={studentQr}>
            <QRCodeCanvas value={studentUrl} size={160} marginSize={2} />
            <p className="meal-qr-url">{studentUrl}</p>
            <button
              type="button"
              className="btn-plain"
              disabled={!!dlCool}
              onClick={() => handleDownload('student')}
            >
              {dlCool === 'student' ? '保存中…' : '下载学生码 PNG'}
            </button>
          </div>
        </div>

        <div className="meal-qr-card meal-qr-card-staff">
          <div className="meal-qr-cap">老师与创客订餐 · {dateCn}</div>
          <div className="meal-qr-body" ref={staffQr}>
            <QRCodeCanvas value={staffUrl} size={160} marginSize={2} />
            <p className="meal-qr-url">{staffUrl}</p>
            <button
              type="button"
              className="btn-plain"
              disabled={!!dlCool}
              onClick={() => handleDownload('staff')}
            >
              {dlCool === 'staff' ? '保存中…' : '下载工作人员码 PNG'}
            </button>
          </div>
        </div>
      </div>

      <p className="q-hint">{TEACHER_DATE_TIP}</p>
      <p className="q-hint">
        打印出来贴在两个不同的地方:学生码贴学生活动区,工作人员码贴老师办公区 —— 物理上分开,从源头减少扫错的机会。
      </p>
    </section>
  )
}
