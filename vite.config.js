import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Graffiti Studio 전용 포트. 기존 5173(novel-workstation), 5174(hbd-app)와 분리.
// strictPort:true 로 포트가 막혀도 자동 이동 금지 (다른 앱과 혼동 방지).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    // 나중에 novel-workstation API 호출할 때 프록시 설정 예시:
    // proxy: {
    //   '/api/nw': { target: 'http://localhost:5173', changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/nw/, '') },
    //   '/api/hbd': { target: 'http://localhost:5174', changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/hbd/, '') },
    // }
  }
})
