// ─── 로그인 화면 (AUTH-ADDENDUM) — "누구로 들어갈까?" ─────────────────────────────────────────────
// 비밀번호도 세션도 없다: 서버가 미리 가진 아이디(yoongwan·hojun·guest1…) 중 하나를 고르기만 한다. main.tsx가 App(→ 스토어)을
// import하기 전에, 저장된 사용자가 없고 서버가 살아 있을 때만 그린다. 덱 룩(design/home-deck.html): 종이 배경, 하늘·언덕,
// 캐릭터 큼(손 흔들기), 아래 흰 패널에 Jua 제목과 아이디 버튼들. 고르면 `login(id)` → onEnter, 실패는 말풍선으로 말한다.
// "오프라인으로 시작"은 사용자 없이 지금처럼 로컬만 (onOffline). 스토어를 모른다 — 아직 없다.
import { useState } from 'react';
import { Character, CharacterDefs } from '../character';
// ui/index는 TopChrome → sim/store를 끌어온다 — 스토어는 문서를 받은 뒤에 떠야 하므로 말풍선만 직접 가져온다
import { Bubble } from '../ui/Bubble';
import '../ui/ui.css';
import { ApiError, login, type User } from '../sim/api';
import { appearanceOf } from '../sim/remote';
import './login.css';

export interface LoginScreenProps {
  /** `GET /api/users`가 준 아이디들 (id 순) */
  users: User[];
  /** 서버가 확인해 줘 `theworld.user.v1`에 저장됐다 — 이제 저장본을 정리하고 문서를 받는다 */
  onEnter: () => void;
  /** 사용자 없이 로컬만으로 시작한다 */
  onOffline: () => void;
}

const HELLO = ['어서 와!', '안녕! 오늘은 누구야?', '기다리고 있었어'];
/** 실패를 말로 — 모르는 아이디(서버 시드가 바뀌었다)와 서버 없음을 구분한다 */
const oopsText = (e: unknown) => (e instanceof ApiError && e.status === 404 ? '음, 그 아이디는 모르겠어…' : '지금은 서버가 안 닿아. 한 번 더 눌러 볼래?');

export function LoginScreen({ users, onEnter, onOffline }: LoginScreenProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [oops, setOops] = useState<string | null>(null);
  const [hello] = useState(() => HELLO[Math.floor(Math.random() * HELLO.length)]);
  const pick = async (id: string) => {
    if (busy) return;
    setBusy(id);
    setOops(null);
    try {
      await login(id);
      onEnter();
    } catch (e) {
      setOops(oopsText(e));
      setBusy(null);
    }
  };
  return (
    <>
      <CharacterDefs />
      <div className="stage">
        <div className="login">
          <div className="login-sky" />
          <div className="login-sun" />
          <div className="login-cloud c1" />
          <div className="login-cloud c2" />
          <div className="login-hill" />
          <div className="login-hill2" />
          <Bubble className={`login-bubble ${oops ? 'is-oops' : ''}`}>{oops ?? hello}</Bubble>
          <Character className="login-chara" pose={busy ? 'happy' : 'wave'} size={300} />
          <div className="login-panel">
            <h1 className="login-ttl">누구로 들어갈까?</h1>
            <p className="login-sub">아이디 하나가 캐릭터 하나예요. 다른 아이디로 들어오면 이 기기의 하루는 비워져요.</p>
            <div className="login-list" role="list">
              {users.map(u => {
                const look = appearanceOf(u.userId);
                const on = busy === u.userId;
                return (
                  <button key={u.userId} type="button" role="listitem" className={`login-user ${on ? 'is-busy' : ''}`} disabled={!!busy} onClick={() => { void pick(u.userId); }} aria-label={`${u.name}(${u.userId})으로 들어가기`}>
                    <span className="login-face" style={{ background: look.color }} aria-hidden="true">{look.emoji}</span>
                    <b>{u.name}</b>
                    <small className="num">{on ? '들어가는 중…' : u.userId}</small>
                  </button>
                );
              })}
            </div>
            <button type="button" className="btn btn--text login-offline" disabled={!!busy} onClick={onOffline}>오프라인으로 시작</button>
          </div>
        </div>
      </div>
    </>
  );
}
