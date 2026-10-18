import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import App from './App.jsx'
import Home from './pages/Home.jsx'
import StudentForm from './pages/StudentForm.jsx'
import Workbench from './pages/Workbench.jsx'
import Overview from './pages/Overview.jsx'
import MealForm from './pages/MealForm.jsx'
import StaffMealForm from './pages/StaffMealForm.jsx'
import MealQr from './pages/MealQr.jsx'
import MealSummary from './pages/MealSummary.jsx'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          {/* 组织者视角:根网址直达组织者入口 */}
          <Route path="/" element={<Home />} />
          {/* 学生只通过二维码/完整链接落进填写页 */}
          <Route path="/form" element={<StudentForm />} />
          {/* 兼容旧书签:/home 仍可进入 */}
          <Route path="/home" element={<Home />} />
          <Route path="/workbench" element={<Workbench />} />
          <Route path="/overview" element={<Overview />} />
          {/* 订餐:学生与工作人员走各自二维码落进公开页,日期写在链接里 */}
          <Route path="/meal" element={<MealForm />} />
          <Route path="/staff-meal" element={<StaffMealForm />} />
          {/* 订餐:组织者两个页面,只从导航进入 */}
          <Route path="/meals/qr" element={<MealQr />} />
          <Route path="/meals/summary" element={<MealSummary />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
