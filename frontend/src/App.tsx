import { Component, Suspense, lazy, useEffect, type ComponentType, type ReactNode } from 'react';
import { useWorld } from './sim/store';
import { PLACES } from './sim/places';
import { CharacterDefs } from './character';
import { Home } from './screens/Home';
import { DevPanel } from './dev/DevPanel';

const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const DEV = params.get('dev') === '1';
const LAB = params.get('lab');
// Dev/QA hook: drive the sim from scripts (jumpToHour, setScale, chooseOption…)
if (import.meta.env.DEV) {
  const w = window as unknown as { __world?: typeof useWorld; __places?: typeof PLACES };
  w.__world = useWorld;
  w.__places = PLACES;   // place catalogue for headless assertions (which city a chosen placeId lives in)
}

// `?lab=character` → src/dev/CharacterLab.tsx (built concurrently). Loaded through a glob so a missing file
// neither breaks the import graph nor the app; a broken one is caught by the boundary below.
const labModules = import.meta.glob('./dev/CharacterLab.tsx');
const CharacterLab = lazy(async () => {
  const load = labModules['./dev/CharacterLab.tsx'];
  if (!load) throw new Error('CharacterLab not found');
  const m = (await load()) as { default?: ComponentType; CharacterLab?: ComponentType };
  const C = m.CharacterLab ?? m.default;
  if (!C) throw new Error('CharacterLab has no component export');
  return { default: C };
});

class Boundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export default function App() {
  const tick = useWorld(s => s.tick);
  useEffect(() => {
    tick();
    const id = setInterval(tick, 1000);
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [tick]);

  if (LAB === 'character') {
    return (
      <>
        <CharacterDefs />
        <Boundary fallback={<div className="lab-note">캐릭터 랩을 열 수 없어요 — src/dev/CharacterLab.tsx 를 확인해 주세요.</div>}>
          <Suspense fallback={<div className="lab-note">캐릭터 랩 여는 중…</div>}>
            <CharacterLab />
          </Suspense>
        </Boundary>
      </>
    );
  }

  return (
    <>
      <CharacterDefs />
      <div className="stage">
        <Home />
        {DEV && <DevPanel />}
      </div>
    </>
  );
}
