import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { currentUser, fetchUsers } from './sim/api';
import { bootstrapSync, clearLocalDocs } from './sim/sync';

// QA 훅(`?preview=`·`?lab=`)은 사용자 없이 돈다 — 스크린샷 스크립트가 로그인 화면에 막히지 않게
const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const SKIP_LOGIN = params.has('preview') || params.has('lab');

// 저장된 사용자가 있으면 서버 문서(places→memory→world→book)가 로컬보다 새것일 때 먼저 localStorage에 받아 둔다 (BACKEND-CONTRACT §3.3).
// 없으면(처음·로그아웃·401로 버려짐) 서버가 살아 있을 때만 로그인 화면을 먼저 그린다 (AUTH-ADDENDUM): 아이디를 고르면 login →
// 이 기기의 저장본 정리 → 그 아이디의 문서 받기 → App. 서버가 죽었거나 "오프라인으로 시작"이면 화면 없이 그대로 App(로컬만).
// 스토어는 모듈이 뜰 때 localStorage를 읽으므로 App(→ sim/store) import를 그 뒤로 미룬다. 서버가 없으면 3초 안에 그대로 뜬다.
async function boot() {
  const root = createRoot(document.getElementById('root')!);
  if (currentUser()) await bootstrapSync();   // 401이면 사용자를 버리고 돌아온다 → 아래서 다시 묻는다
  if (!currentUser() && !SKIP_LOGIN) {
    const users = await fetchUsers();   // 서버가 죽었으면(2초) null → 화면 없이 오프라인
    if (users?.length) {
      const { LoginScreen } = await import('./screens/LoginScreen');
      const entered = await new Promise<boolean>(resolve => {
        root.render(<StrictMode><LoginScreen users={users} onEnter={() => resolve(true)} onOffline={() => resolve(false)} /></StrictMode>);
      });
      if (entered) { clearLocalDocs(); await bootstrapSync(); }
    }
  }
  const { default: App } = await import('./App');
  root.render(<StrictMode><App /></StrictMode>);
}
void boot();
