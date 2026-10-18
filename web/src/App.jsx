import { NavLink, Outlet, useLocation } from 'react-router-dom'
import OceanScene from './components/OceanScene.jsx'

// 组织者页面路径:导航只在这些页面显示
// 学生能接触到的是 /form 与订餐的 /meal、/staff-meal(公开页,导航对它们完全隐藏)
const ORGANIZER_PATHS = ['/home', '/workbench', '/overview', '/meals/qr', '/meals/summary']

export default function App() {
  const { pathname } = useLocation()
  const isOrganizer = ORGANIZER_PATHS.includes(pathname)

  return (
    <div className="app">
      <OceanScene />
      <header className="app-header">
        <span className="brand">xinghe-helper</span>
        {isOrganizer && (
          <nav className="app-nav">
            <NavLink to="/home" className={({ isActive }) => (isActive ? 'active' : '')}>
              入口
            </NavLink>
            <NavLink to="/form" className={({ isActive }) => (isActive ? 'active' : '')}>
              填写页
            </NavLink>
            <NavLink to="/workbench" className={({ isActive }) => (isActive ? 'active' : '')}>
              分房工作台
            </NavLink>
            <NavLink to="/overview" className={({ isActive }) => (isActive ? 'active' : '')}>
              名单总览
            </NavLink>
            <NavLink to="/meals/qr" className={({ isActive }) => (isActive ? 'active' : '')}>
              订餐码
            </NavLink>
            <NavLink to="/meals/summary" className={({ isActive }) => (isActive ? 'active' : '')}>
              订餐汇总
            </NavLink>
          </nav>
        )}
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
