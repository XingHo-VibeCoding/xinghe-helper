import { Link } from 'react-router-dom'
import FormQrCode from '../components/FormQrCode.jsx'
import Fish from '../components/Fish.jsx'
import logo from '../assets/logo.jpg'

// 组织者入口页(/):只有你自己通过书签/输网址进来,不出现在学生可见的任何地方
// 学生能接触到的只有 /form;这页放二维码生成器和三个入口,是组织者的"工作台面"
// 视觉主题:海洋科幻风(用户要求),装饰层纯 CSS/SVG,不携带任何信息,加 aria-hidden
const ENTRIES = [
  {
    to: '/form',
    title: '学生填写页',
    desc: '学生扫码/点链接后看到的就是这一页。想看学生视角可以点进去看看。',
    action: '预览 →',
  },
  {
    to: '/workbench',
    title: '分房工作台',
    desc: '录入房间、一键 AI 分房、手动微调。',
    action: '去分房 →',
  },
  {
    to: '/overview',
    title: '名单总览',
    desc: '查看分房名单,一键导出打印,拿去对接酒店。',
    action: '看名单 →',
  },
]

// 简笔小鱼已抽成共享组件 components/Fish.jsx,这里直接引用

export default function Home() {
  return (
    <section className="page home-page ocean">
      {/* 装饰层:游鱼与气泡,纯装饰 */}
      <div className="ocean-scene" aria-hidden="true">
        <span className="ray ray-1" />
        <span className="ray ray-2" />
        <Fish className="fish fish-1" color="#3fd0e8" />
        <Fish className="fish fish-2" color="#6ea8ff" />
        <Fish className="fish fish-3" color="#48e5c2" />
        <Fish className="fish fish-4" color="#3fd0e8" />
        <span className="bubble bu-1" />
        <span className="bubble bu-2" />
        <span className="bubble bu-3" />
        <span className="bubble bu-4" />
        <span className="bubble bu-5" />
        <span className="bubble bu-6" />
      </div>

      <header className="home-head">
        <img className="home-logo" src={logo} alt="星禾星穗" />
        <div className="home-brand">xinghe-helper</div>
        <h1>组织者入口</h1>
        <p className="home-lead">
          学生看到的只有填写页;这页是你自己的工作入口,不会出现在学生可见的任何地方。
        </p>
      </header>

      <div className="home-cards">
        {ENTRIES.map((e) => (
          <Link key={e.to} to={e.to} className="home-card">
            <h2>{e.title}</h2>
            <p>{e.desc}</p>
            <span className="home-card-action">{e.action}</span>
          </Link>
        ))}
      </div>

      <FormQrCode />
    </section>
  )
}
