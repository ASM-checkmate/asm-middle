import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 백엔드(backend/, Spring, 기본 8080 — BACKEND-CONTRACT §3.6)로 /api를 넘긴다. 서버가 없으면 프록시 오류가 나고 앱은 오프라인(규칙 기반 답장)으로 돈다
  server: { proxy: { '/api': process.env.BACKEND_URL ?? 'http://localhost:8080' } },
})
