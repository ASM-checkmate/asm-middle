import { Component, Suspense, lazy, useEffect, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { useWorld } from './sim/store';
import { putLocal } from './sim/media';
import { presentLook } from './screens/util';
import { PLACES } from './sim/places';
import { Character, CharacterDefs, OwnerLookContext, type Pose } from './character';
import { DEFAULT_LOOK, type Look } from './sim/types';
import { SCENARIOS, markScenarioSeeded, scenarioParam, scenarioPlans, scenarioSeeded } from './dev/scenario';
import { Home } from './screens/Home';
import { DevPanel } from './dev/DevPanel';

const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const DEV = params.get('dev') === '1';
const LAB = params.get('lab');
// Dev/QA hook: drive the sim from scripts (jumpToHour, setScale, chooseOption…)
if (import.meta.env.DEV) {
  const w = window as unknown as { __world?: typeof useWorld; __places?: typeof PLACES; __media?: { putLocal: typeof putLocal }; __demoCharacter?: (el: HTMLElement, pose?: Pose, size?: number) => void };
  w.__world = useWorld;
  w.__places = PLACES;   // place catalogue for headless assertions (which city a chosen placeId lives in)
  w.__media = { putLocal };   // 데모 녹화(scripts/record.mjs)가 '생성된 사진'을 끼워 넣는다
  // 데모 녹화 인트로: 빈 컨테이너에 주인 캐릭터 한 명을 포즈대로 그린다 (몸 전체, 기본은 손 흔들기). 심볼 defs는 앱 루트의 CharacterDefs를 쓴다
  w.__demoCharacter = (el, pose = 'wave', size = 340) => {
    createRoot(el).render(<OwnerLookContext.Provider value={useWorld.getState().memory.look}><Character pose={pose} size={size} /></OwnerLookContext.Provider>);
  };
  // 라이브 시연 단축키(demo-live, 시나리오 URL일 때만): 링크를 바꾸지 않고 한 화면에서 장면을 넘긴다 — 화면엔 아무것도 안 뜬다 (scripts/DEMO-LIVE.md)
  //   2 → 10:40 현이  3 → 20:01 코노 가는 길  4 → 20:20 코노  5 → 23:44 집 가는 길  6 → 23:57 잠   0 → x1  9 → x30
  if (params.get('scenario')) {
    const SCENES: Record<string, [number, number]> = { '2': [10, 40], '3': [20, 1], '4': [20, 20], '5': [23, 44], '6': [23, 57] };
    window.addEventListener('keydown', e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const st = useWorld.getState();
      if (SCENES[e.key]) { const [h, m] = SCENES[e.key]; if (st.now < new Date(st.now).setHours(h, m, 0, 0)) st.jumpToHour(h, m); }
      else if (e.key === '0') st.setScale(1);
      else if (e.key === '9') st.setScale(30);
    });
  }
}

// `?lab=character` → src/dev/CharacterLab.tsx (built concurrently). Loaded through a glob so a missing file
// neither breaks the import graph nor the app; a broken one is caught by the boundary below.
const labModules = import.meta.glob(['./dev/CharacterLab.tsx', './dev/BakeLab.tsx']);
const CharacterLab = lazy(async () => {
  const load = labModules['./dev/CharacterLab.tsx'];
  if (!load) throw new Error('CharacterLab not found');
  const m = (await load()) as { default?: ComponentType; CharacterLab?: ComponentType };
  const C = m.CharacterLab ?? m.default;
  if (!C) throw new Error('CharacterLab has no component export');
  return { default: C };
});
// `?lab=bake` → src/dev/BakeLab.tsx (ADR-0024 굽기 스파이크): 라이브 무대와 구운 픽셀을 나란히
const BakeLab = lazy(async () => {
  const load = labModules['./dev/BakeLab.tsx'];
  if (!load) throw new Error('BakeLab not found');
  const m = (await load()) as { default?: ComponentType; BakeLab?: ComponentType };
  const C = m.BakeLab ?? m.default;
  if (!C) throw new Error('BakeLab has no component export');
  return { default: C };
});

class Boundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export default function App() {
  const ownerLook = useWorld(s => s.memory.look);
  const tick = useWorld(s => s.tick);
  const planDay = useWorld(s => s.planDay);
  useEffect(() => {
    // `?scenario=busan` (dev/scenario.ts): 한 번만 오늘을 심는다. 다시 심으려면 개발 패널 reset 뒤 새로고침
    const sc = scenarioParam();
    const def = sc ? SCENARIOS[sc] : undefined;
    if (def && !scenarioSeeded(def.key)) {
      // 시계·집은 prepScenario(main.tsx)가 스토어 부팅 전에 놓았다 — 여기선 블록만 심는다
      useWorld.getState().seedPlans(scenarioPlans(def), def.home);
      markScenarioSeeded(def.key);
    }
    tick();
    void planDay();   // 오늘의 빈 블록을 모델이 미리 짓는다 (ADR-0010). tier가 off면 아무것도 안 한다
    const id = setInterval(tick, 1000);
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [tick, planDay]);

  if (LAB === 'character') {
    return (
      <OwnerLookContext.Provider value={ownerLook}>
        <CharacterDefs />
        <Boundary fallback={<div className="lab-note">캐릭터 랩을 열 수 없어요 — src/dev/CharacterLab.tsx 를 확인해 주세요.</div>}>
          <Suspense fallback={<div className="lab-note">캐릭터 랩 여는 중…</div>}>
            <CharacterLab />
          </Suspense>
        </Boundary>
      </OwnerLookContext.Provider>
    );
  }

  // `?lab=charpng&pose=idle[&variant=friend&color=%23…]` → 캐릭터 한 명만 투명 바탕에 크게 (scripts/char-png.mjs 가 찍어 간다 — 카메라 시험용, 임시)
  if (LAB === 'charpng') {
    const q = new URLSearchParams(window.location.search);
    const pose = (q.get('pose') ?? 'idle') as Pose;
    const variant = q.get('variant') === 'friend' ? 'friend' : 'me';
    const color = q.get('color') ?? undefined;
    const food = q.get('food') === 'scallop' ? 'scallop' : undefined;   // `&food=scallop` — 먹기 자세의 손에 든 것
    // `&hair=short` — 동행(NPC)의 머리 모양 (민수는 short). 생성 컷의 정체성 참고 PNG에 쓴다 (scripts/shot-gen.mjs)
    const hair = q.get('hair');
    const look = variant === 'friend' && hair ? presentLook(hair as Look['hairStyle']) : undefined;
    return (
      <OwnerLookContext.Provider value={ownerLook ?? DEFAULT_LOOK}>
        <CharacterDefs />
        <div style={{ background: 'transparent', width: 800, height: 800 }}>
          <Character pose={pose} size={800} variant={variant} color={color} food={food} look={look} paused />
        </div>
      </OwnerLookContext.Provider>
    );
  }

  if (LAB === 'bake') {
    return (
      <Boundary fallback={<div className="lab-note">굽기 랩을 열 수 없어요 — src/dev/BakeLab.tsx 를 확인해 주세요.</div>}>
        <Suspense fallback={<div className="lab-note">굽기 랩 여는 중…</div>}>
          <BakeLab />
        </Suspense>
      </Boundary>
    );
  }

  // 내 캐릭터의 겉모습 (ADR-0019): memory.look을 캐릭터·얼굴 심볼·탈것이 읽는다
  return (
    <OwnerLookContext.Provider value={ownerLook}>
      <CharacterDefs />
      <div className="stage">
        <Home />
        {DEV && <DevPanel />}
      </div>
    </OwnerLookContext.Provider>
  );
}
