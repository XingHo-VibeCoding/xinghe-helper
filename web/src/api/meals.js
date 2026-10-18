// 订餐模块数据层 —— /api/meals
//
// 结构沿用 students.js 的模式:页面不直接发请求,统一走这里的三个函数。
// 后端契约见 docs/订餐统计-方案文档.md 第 5 节:
//   POST /api/meals                          提交订单(学生与工作人员同一接口,靠 role 区分)
//   GET  /api/meals?action=summary&meal_date 按天汇总(15 个班 + 3 个部门两大块)
//   GET  /api/meals?action=dates             有订餐记录的日期列表(汇总页切日期用)
//
// ⚠️ 后端尚未实装(云函数还没加 meals 分流)。前端先就位,
//    调用时会收到「接口返回失败」的人话报错 —— 这是预期的失败态,不是 bug。

import { CAMP_ID, apiGet, apiPost, useMockData } from './client.js'

// 提交一条订餐记录。row 的字段名与数据库一致(下划线风格):
//   { meal_date, role, name, teacher?, class_level?, department?, lunch, dinner }
// role 由页面写死传入('student' | 'staff'),用户在表单里没有这个选项 ——
//   这是防「学生码和工作人员码搞混」的第一道闸,见方案文档 2.3 节。
// 返回 { id, updated }:updated=true 表示同一人同一天重复提交,已覆盖旧记录。
export async function submitMeal(row) {
  if (useMockData) {
    throw new Error('现在是演示数据模式(mock),订餐提交需要配置 VITE_API_BASE_URL 连上公网接口后开放')
  }
  return apiPost('/api/meals', { camp_id: CAMP_ID, ...row })
}

// 按天查汇总。返回:
//   { meal_date, student: { total, classes: [...] }, staff: { total, departments: [...] }, grand }
// 15 个班 / 3 个部门全部返回,没人的显示 0 —— 页面不用自己补空行。
export async function fetchMealSummary(mealDate) {
  if (useMockData) {
    return {
      meal_date: mealDate,
      student: {
        total: { lunch: 128, dinner: 126, people: 130 },
        classes: [
          { teacher: 'Mona', class_level: '星一', lunch: 15, dinner: 12 },
          { teacher: 'Mona', class_level: '星二', lunch: 11, dinner: 11 },
          { teacher: 'Mona', class_level: '星三', lunch: 8, dinner: 8 },
          { teacher: 'Kiven', class_level: '星一', lunch: 12, dinner: 11 },
          { teacher: 'Kiven', class_level: '星二', lunch: 9, dinner: 9 },
          { teacher: 'Kiven', class_level: '星三', lunch: 6, dinner: 0 },
          { teacher: 'Selena', class_level: '星一', lunch: 10, dinner: 10 },
          { teacher: 'Selena', class_level: '星二', lunch: 7, dinner: 7 },
          { teacher: 'Selena', class_level: '星三', lunch: 5, dinner: 5 },
          { teacher: 'Betty', class_level: '星一', lunch: 13, dinner: 13 },
          { teacher: 'Betty', class_level: '星二', lunch: 10, dinner: 9 },
          { teacher: 'Betty', class_level: '星三', lunch: 9, dinner: 9 },
          { teacher: 'Priya', class_level: '星一', lunch: 7, dinner: 7 },
          { teacher: 'Priya', class_level: '星二', lunch: 4, dinner: 5 },
          { teacher: 'Priya', class_level: '星三', lunch: 0, dinner: 0 },
        ],
      },
      staff: {
        total: { lunch: 8, dinner: 8, people: 9 },
        departments: [
          { department: '教学部', lunch: 5, dinner: 5 },
          { department: '市场部', lunch: 2, dinner: 2 },
          { department: '其他部门', lunch: 1, dinner: 1 },
        ],
      },
      grand: { lunch: 136, dinner: 134 },
    }
  }
  return apiGet('/api/meals', { action: 'summary', camp_id: CAMP_ID, meal_date: mealDate })
}

// 查有订餐记录的日期(升序)。没有任何记录时返回空数组 —— 不是错误。
export async function fetchMealDates() {
  if (useMockData) {
    return { dates: ['2027-01-20', '2027-01-21'] }
  }
  return apiGet('/api/meals', { action: 'dates', camp_id: CAMP_ID })
}
