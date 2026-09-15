import { Component, Suspense, lazy, useEffect, type ComponentType, type ReactNode } from 'react';
import { useWorld } from './sim/store';
import { putLocal } from './sim/media';
import { PLACES } from './sim/places';
import { Character, CharacterDefs, OwnerLookContext, type Pose } from './character';
import { DEFAULT_LOOK } from './sim/types';
import { SCENARIOS, markScenarioSeeded, scenarioParam, scenarioPlans, scenarioSeeded } from './dev/scenario';
import { Home } from './screens/Home';
import { DevPanel } from './dev/DevPanel';

const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const DEV = params.get('dev') === '1';
const LAB = params.get('lab');
// Dev/QA hook: drive the sim from scripts (jumpToHour, setScale, chooseOption…)
if (import.meta.env.DEV) {
  const w = window as unknown as { __world?: typeof useWorld; __places?: typeof PLACES; __media?: { putLocal: typeof putLocal } };
  w.__world = useWorld;
  w.__places = PLACES;   // place catalogue for headless assertions (which city a chosen placeId lives in)
  w.__media = { putLocal };   // 데모 녹화(scripts/record.mjs)가 '생성된 사진'을 끼워 넣는다
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
    return (
      <OwnerLookContext.Provider value={ownerLook ?? DEFAULT_LOOK}>
        <CharacterDefs />
        <div style={{ background: 'transparent', width: 800, height: 800 }}>
          <Character pose={pose} size={800} variant={variant} color={color} food={food} paused />
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
