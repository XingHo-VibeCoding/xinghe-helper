import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // host: true —— 监听所有网卡，同一 WiFi 下手机才能访问
    // （只写 host 不写 IP，是因为电脑 IP 换网络会变，写死会失效）
    host: true,
    port: 5173,
  },
})
