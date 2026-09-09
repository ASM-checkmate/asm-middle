// 카메라가 동적으로 불러오는 3D 무대 (ADR-0014 개정). three.js는 이 모듈 뒤에 있다 — 메인 번들엔 안 들어간다.
export { StageView, stage3dSupported } from './render';
export type { StageSpec } from './render';

// dev QA 훅: 구운 텍스처를 콘솔·스크린샷 스크립트에서 꺼내 본다 (`window.__stage.sceneLayers('beach')`)
import { castSprite, sceneLayers } from './textures';
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __stage: unknown }).__stage = { sceneLayers, castSprite };
