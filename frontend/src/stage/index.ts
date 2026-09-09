// 카메라가 동적으로 불러오는 3D 무대 (ADR-0014 개정). three.js는 이 모듈 뒤에 있다 — 메인 번들엔 안 들어간다.
export { StageView, CharacterView, stage3dSupported, getRenderer, ensureSize } from './render';
export { RiderView } from './rider3d';
export type { StageSpec } from './render';

// dev QA 훅: 구운 텍스처를 콘솔·스크린샷 스크립트에서 꺼내 본다 (`window.__stage.sceneSet('beach')`)
// `window.__stage.propShot('cafe', 4, { yaw: 35 })`는 코드 소품의 3/4 렌더 — 이미지→3D 생성 입력 (propshot.ts)
import { castSprite, sceneSet } from './textures';
import { propShot } from './propshot';
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __stage: unknown }).__stage = { sceneSet, castSprite, propShot };
