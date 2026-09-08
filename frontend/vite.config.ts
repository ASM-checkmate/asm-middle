import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 백엔드(backend/, Spring, 기본 8080 — BACKEND-CONTRACT §3.6)로 /api를 넘긴다. 서버가 없으면 프록시 오류가 나고 앱은 오프라인(규칙 기반 답장)으로 돈다
      '/api': process.env.BACKEND_URL ?? 'http://localhost:8080',
      // 음성 서비스(voice/, 기본 8790, ADR-0011). 없으면 통화는 글로만 된다
      '/voice': { target: process.env.VOICE_URL ?? 'http://localhost:8790', ws: true, rewrite: p => p.replace(/^\/voice/, '') },
    },
  },
})
