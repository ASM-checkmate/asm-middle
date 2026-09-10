// ─── 굽기의 문자열 손질 (순수, node 검사): React가 낸 svg markup에서 CSS 변수·글꼴을 리터럴로 ─────────
// <img>로 그리는 svg는 바깥 문서의 tokens.css·@font-face·캐릭터 변수를 못 받는다. 그래서 `var(--x, 기본값)`은 값(모르면 기본값)으로,
// 무대 라벨의 Jua엔 일반 글꼴 폴백을 붙인다. 어느 변수를 무엇으로 바꾸는지는 부르는 쪽(bake.tsx)이 준다 — 여기는 문자열만 안다.
// 캐릭터·무대 쪽이 변수 이름을 바꾸면 여기 손질이 조용히 헛돈다: scripts/sim-bake.test.mjs가 원본 상수의 모양까지 같이 본다.

/** `var(--name)` · `var(--name, fallback)` — fallback에 괄호가 든 것(var 안의 var)은 안 잡고 그대로 둔다 */
const VAR = /var\(--([a-zA-Z0-9-]+)(?:\s*,\s*([^()]*))?\)/g;

/** var(--name[, fallback]) 전부 → vars[name] ?? fallback. 둘 다 없으면 그대로 둔다 (leftoverVars로 잡는다) */
export function inlineVars(markup: string, vars: Record<string, string | undefined>): string {
  return markup.replace(VAR, (m: string, name: string, fallback?: string) => vars[name] ?? fallback?.trim() ?? m);
}

/** 손질 뒤에도 남은 var() 이름들 — 새 변수를 놓쳤는지 검사용 */
export function leftoverVars(markup: string): string[] {
  const out = new Set<string>();
  for (const m of markup.matchAll(/var\(--([a-zA-Z0-9-]+)/g)) out.add(m[1]!);
  return [...out];
}

/**
 * 무대 본체: 임시 `<svg>` 껍데기를 벗기고(맨바깥이 svg가 아니면 React(dev)가 <linearGradient>를 HTML로 알고 경고한다),
 * 라벨 다섯의 Jua엔 폴백을, 소품의 인라인 토큰 변수(집 고양이 꼬리의 var(--ink-3))는 hex로.
 */
export function sceneMarkup(wrapped: string, tokens: Record<string, string>): string {
  const inner = wrapped.slice(wrapped.indexOf('>') + 1, wrapped.lastIndexOf('</svg>'));
  return inlineVars(inner.replace(/font-family="Jua"/g, 'font-family="Jua, sans-serif"'), tokens);
}

export interface CharacterColors { skin?: string; hair?: string; top?: string; color?: string }
/**
 * 캐릭터 한 명: 겉모습 변수(--ch-skin·--ch-hair·--ch-top, character/look.tsx)는 look의 색, --friend(shapes.tsx FRIEND)는 상대 색,
 * 잠꼬대 글자의 var(--mono)는 monospace. 안 준 색은 var()의 기본값(모모·민트)이 남는다 — Head/shapes가 하는 계산 그대로.
 */
export function characterMarkup(inner: string, c: CharacterColors): string {
  return inlineVars(inner, { 'ch-skin': c.skin, 'ch-hair': c.hair, 'ch-top': c.top, friend: c.color, mono: 'monospace' });
}
