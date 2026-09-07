import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 백엔드(backend/, 기본 8787)로 /api를 넘긴다. 서버가 없으면 프록시 오류가 나고 앱은 규칙 기반 답장으로 돈다
  server: { proxy: { '/api': process.env.BACKEND_URL ?? 'http://localhost:8787' } },
})
