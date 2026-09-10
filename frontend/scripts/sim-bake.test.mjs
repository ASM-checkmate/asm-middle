// 굽기 harness (ADR-0020 스파이크, photo/geometry.ts·markup.ts) — React·DOM 없이 도는 부분만: 색표(color-mix), 프레임 크기, 인물 자리,
// 크롭 transform, 심도 반지름·필터, 조도 1차식, 정지 자세 CSS, markup 손질(변수·글꼴), id 모양, 크기 정책. 결정적이고 camera.css·character.css의 숫자와 맞는지.
// Usage: node scripts/sim-bake.test.mjs   (exit 1 on any failed check)
import './ts-hooks.mjs';
import { readFileSync } from 'node:fs';

const fails = [];
let n = 0;
const check = (name, ok, detail = '') => { n++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const G = await import('../src/photo/geometry.ts');
const M = await import('../src/photo/markup.ts');

// ── 색 ────────────────────────────────────────────────────────────────────────
console.log('\n── 색 ──');
check('mix: 50/50 흑백은 회색', G.mix('#000000', 50, '#FFFFFF') === '#808080', G.mix('#000000', 50, '#FFFFFF'));
check('mix: 100%는 첫 색', G.mix('#A08C76', 100, '#FFC64D') === '#A08C76', '');
check('mix: 0%는 둘째 색', G.mix('#A08C76', 0, '#FFC64D') === '#FFC64D', '');
// --sc-wood: color-mix(in srgb, ink-3 52%, sun) = (160·.52+255·.48, 140·.52+198·.48, 118·.52+77·.48) = (205.6, 167.8, 98.3)
check('--sc-wood 계산', G.SCENE_PALETTE.wood === '#CEA862', G.SCENE_PALETTE.wood);
check('--sc-water는 sky 그대로', G.SCENE_PALETTE.water === G.TOKEN.sky, G.SCENE_PALETTE.water);
check('팔레트 전부 hex', Object.values(G.SCENE_PALETTE).every(v => /^#[0-9A-F]{6}$/.test(v)), JSON.stringify(G.SCENE_PALETTE));
const cssClasses = ['f-paper', 'f-wood', 'f-grass2', 'f-rubber', 'f-none', 'st-sky', 'st-cream', 's-ink', 's-ink4', 's-water', 's-wood2', 's-none'];
check('SCENE_CSS에 scenes.css의 클래스가 있다', cssClasses.every(c => G.SCENE_CSS.includes(`.${c}{`)), cssClasses.filter(c => !G.SCENE_CSS.includes(`.${c}{`)).join());
check('SCENE_CSS에 var()가 남지 않았다', !G.SCENE_CSS.includes('var('), '');

// ── 프레임 ────────────────────────────────────────────────────────────────────
console.log('\n── 프레임 ──');
const S = G.frameSize(300);
check('300px: 278×300 (1/1.08)', S.w === 278 && S.h === 300, JSON.stringify(S));
check('260px: 241×260', G.frameSize(260).w === 241 && G.frameSize(260).h === 260, JSON.stringify(G.frameSize(260)));
check('기본은 300', G.frameSize().h === 300 && G.DEFAULT_LONG_EDGE === 300, '');
const tile = G.bgTile(S);
check('무대 한 장은 세로 2배, 위로 반 올라간다', tile.x === 0 && tile.y === -150 && tile.w === 278 && tile.h === 600, JSON.stringify(tile));
const bt = G.bgTransforms(S);
check('무대 셋: 왼쪽 거울 · 가운데 · 오른쪽 거울', bt.length === 3 && bt[0] === 'scale(-1 1)' && bt[1] === '' && bt[2] === 'translate(556 0) scale(-1 1)', JSON.stringify(bt));
check('패럴랙스: 각도 10° → -16.5px(300 기준 -0.55%/°)', near(G.bgParallax(10, S), -16.5), String(G.bgParallax(10, S)));

// ── 인물 자리 ─────────────────────────────────────────────────────────────────
console.log('\n── 인물 자리 ──');
const me = G.castLayout(S, {}).me;
check('나: 너비 84% (233.52), 가운데', near(me.w, 233.52) && near(me.x + me.w / 2, 139), JSON.stringify(me));
// 발(viewBox y 182/200)이 78% 높이 언저리: bottom = 300·.78 + .09·233.52 = 255.0 → 발 y = bottom − 233.52·(1 − .91) = 234 ≈ 78% (234)
check('나: 발이 78% 높이에 닿는다', near(me.y + me.h * 0.91, 234, 1), String(me.y + me.h * 0.91));
const wf = G.castLayout(S, { friend: true });
check('동행 있으면 나는 39%로', near(wf.me.x + wf.me.w / 2, 0.39 * 278) && !!wf.friend && !wf.met && !wf.ghost, JSON.stringify(wf));
check('동행: left 56%, 너비 62%', wf.friend && near(wf.friend.x, 0.56 * 278) && near(wf.friend.w, 0.62 * 278), JSON.stringify(wf.friend));
const wm = G.castLayout(S, { met: true });
check('상대만: 나 39%, 상대 left 60% 너비 53%', near(wm.me.x + wm.me.w / 2, 0.39 * 278) && wm.met && near(wm.met.x, 0.60 * 278) && near(wm.met.w, 0.53 * 278), JSON.stringify(wm));
const wb = G.castLayout(S, { friend: true, met: true });
check('둘 다: 나 44%, 상대는 right -6% (x = 1.06w − .53w)', near(wb.me.x + wb.me.w / 2, 0.44 * 278) && wb.met && near(wb.met.x, 0.53 * 278), JSON.stringify(wb));
check('둘 다: 상대 bottom 16% (동행 없을 때 18%)', wb.met && wm.met && wb.met.y + wb.met.h > wm.met.y + wm.met.h, '');
const wg = G.castLayout(S, { ghost: true });
check('실루엣: right -2%, bottom 30%, 나는 가운데 그대로', wg.ghost && near(wg.ghost.x + wg.ghost.w, 1.02 * 278) && near(wg.ghost.y + wg.ghost.h, 0.7 * 300) && near(wg.me.x, me.x), JSON.stringify(wg));
check('자리는 결정적', JSON.stringify(G.castLayout(S, { friend: true, met: true, ghost: true })) === JSON.stringify(G.castLayout(S, { friend: true, met: true, ghost: true })), '');

// ── 크롭 ──────────────────────────────────────────────────────────────────────
console.log('\n── 크롭 ──');
check('기본 구도는 원점 왕복뿐', G.cropTransform({ scale: 1, x: 0, y: 0, rot: 0 }, S) === 'translate(139 234) translate(-139 -234)', G.cropTransform({ scale: 1, x: 0, y: 0, rot: 0 }, S));
const t = G.cropTransform({ scale: 1.5, x: 10, y: -5, rot: 7, pitch: 12 }, S);
check('순서: origin · scaleY(cos pitch) · rotate · scale · translate(px) · -origin', t === 'translate(139 234) scale(1 0.978) rotate(7) scale(1.5) translate(27.8 -15) translate(-139 -234)', t);
check('x/y %는 프레임 크기 기준 px', t.includes('translate(27.8 -15)'), t);
check('각도 없으면 scaleY 없음', !G.cropTransform({ scale: 1, x: 0, y: 0, rot: 3 }, S).includes('scale(1 '), '');

// ── 심도·조도 ─────────────────────────────────────────────────────────────────
console.log('\n── 심도·조도 ──');
check('심도 0 → 흐림 없음', G.blurRadii({ scale: 1, x: 0, y: 0, rot: 0 }, S).bg === 0 && G.blurRadii({ scale: 1, x: 0, y: 0, rot: 0 }, S).fg === 0, '');
const bn = G.blurRadii({ scale: 1, x: 0, y: 0, rot: 0, dof: 1, focus: 'near' }, S);
const bf = G.blurRadii({ scale: 1, x: 0, y: 0, rot: 0, dof: 0.5, focus: 'far' }, S);
check('초점 캐릭터: 배경만 (dof 1 → 5px)', bn.bg === 5 && bn.fg === 0, JSON.stringify(bn));
check('초점 배경: 인물만 (dof .5 → 2px)', bf.bg === 0 && bf.fg === 2, JSON.stringify(bf));
check('세로가 다르면 비례한다', near(G.blurRadii({ scale: 1, x: 0, y: 0, rot: 0, dof: 1 }, G.frameSize(150)).bg, 2.5), '');
// 필터 색 공간: svg 기본 linearRGB가 아니라 CSS filter와 같은 sRGB — <filter마다 붙어 있어야 한다
const fdefs = [...G.blurFilterDefs(bn, true), ...G.blurFilterDefs(bf, false), G.lightFilterDef(G.lightTransfer(0.7), S)];
check('필터 셋(bg·ghost / fg / light)이 나온다', fdefs.length === 4 && fdefs.every(d => typeof d === 'string' && d.startsWith('<filter ')), JSON.stringify(fdefs.map(d => d.slice(0, 20))));
check('<filter 전부 color-interpolation-filters="sRGB"', fdefs.every(d => (d.match(/<filter /g) || []).length === 1 && d.includes(G.FILTER_COLOR_SPACE)), fdefs.filter(d => !d.includes(G.FILTER_COLOR_SPACE)).join('|'));
check('흐림 필터 id·반지름', fdefs[0].includes('id="bgblur"') && fdefs[0].includes('stdDeviation="5"') && fdefs[1].includes('id="ghost"') && fdefs[1].includes('feColorMatrix') && fdefs[2].includes('id="fgblur"') && fdefs[2].includes('stdDeviation="2"'), fdefs.join('\n'));
check('반지름 0이면 그 필터는 없다', G.blurFilterDefs({ bg: 0, fg: 0, ghost: 0.5 }, false).length === 0, '');
check('조도 항등이면 light 필터 없음', G.lightFilterDef(G.lightTransfer(1), S) === null, '');
const l1 = G.lightTransfer(1);
check('조도 1은 항등', G.isIdentityLight(l1), JSON.stringify(l1));
const ld = G.lightTransfer(0.7);
// a1 = .3·.42 = .126 → slope .7·(1−.126) = .6118, intercept R = .7·.126·38/255
check('어두우면 기울기 < light, 푸른 절편', near(ld.slope[0], 0.6118, 0.001) && ld.slope[0] === ld.slope[2] && ld.intercept[2] > ld.intercept[0] && ld.intercept[0] > 0, JSON.stringify(ld));
const lb = G.lightTransfer(1.3);
// a2 = .3·.34 = .102 → R: 1.3·(1 − .102·0) = 1.3, B: 1.3·(1 − .102·(1 − 120/255))
check('밝으면 절편 0, 빨강은 그대로 light, 파랑은 덜', lb.intercept.every(v => v === 0) && near(lb.slope[0], 1.3, 0.001) && lb.slope[2] < lb.slope[1] && lb.slope[1] < lb.slope[0], JSON.stringify(lb));

// ── 정지 자세 (character.css 0 % 키프레임) ────────────────────────────────────
console.log('\n── 정지 자세 ──');
const still = G.STILL_CSS;
check('관절 원점: fill-box, 팔 50% 50%, 몸 50% 100%, 머리 50% 62%', still.includes('.ch-arm,.ch-foot,.ch-z,.ch-spark{transform-box:fill-box}') && still.includes('.ch-root,.ch-body{transform-origin:50% 100%}') && still.includes('.ch-head{transform-origin:50% 62%}'), '');
check('기쁨: 반짝이는 둘째(오른쪽 위)만, 45°', still.includes('.ch[data-pose="happy"] .ch-spark{opacity:0}') && still.includes('.ch[data-pose="happy"] g:nth-of-type(2) > .ch-spark{transform:scale(1) rotate(45deg);opacity:1}'), '');
check('손 흔들기: 오른팔 −16° (ch-wave 0%)', still.includes('.ch[data-pose="wave"] .ch-arm-r{transform:rotate(-16deg)}'), '');
check('걷기: 오른발 들림, 팔 ∓16°, 뿌리 −2°', still.includes('.ch[data-pose="walk"] .ch-foot-r{transform:translateY(-9px)}') && still.includes('.ch-arm-l{transform:rotate(-16deg)}') && still.includes('.ch[data-pose="walk"] .ch-arm-r{transform:rotate(16deg)}') && still.includes('.ch[data-pose="walk"] .ch-root{transform:rotate(-2deg)}'), '');
check('먹기: 벌린 입은 숨김 / 읽기: 눈 −2.5px / 가만히: 팔 −2°', still.includes('.ch[data-pose="eat"] .ch-mouth-b{opacity:0}') && still.includes('.ch[data-pose="read"] .ch-eyes{transform:translateX(-2.5px)}') && still.includes('.ch[data-pose="idle"] .ch-arm{transform:rotate(-2deg)}'), '');
check('정지 자세 CSS에 animation·var()가 없다', !still.includes('animation') && !still.includes('var('), '');
// character.css의 원본 줄이 그대로인지 — 루프가 바뀌면 STILL_CSS도 같이 고쳐야 한다
const chCss = src('../src/character/character.css');
const loops = ['@keyframes ch-wave     { 0%, 100% { transform: rotate(-16deg); }', '@keyframes ch-spark    { 0%, 100% { transform: scale(0) rotate(0); opacity: 0; } 50% { transform: scale(1) rotate(45deg); opacity: 1; }',
  '@keyframes ch-step     { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-9px); }', '@keyframes ch-scan     { 0%, 100% { transform: translateX(-2.5px); }',
  '.ch[data-pose="happy"] g:nth-of-type(2) > .ch-spark { animation-delay: -700ms; }', '.ch[data-pose="walk"] .ch-foot-r { animation: ch-step 560ms ease-in-out infinite; animation-delay: -280ms; }',
  '.ch.is-paused * { animation-play-state: paused !important; }'];
check('character.css의 0 % 키프레임·delay 줄이 그대로다', loops.every(l => chCss.includes(l)), loops.filter(l => !chCss.includes(l)).join(' | '));

// ── markup 손질 (photo/markup.ts) ─────────────────────────────────────────────
console.log('\n── markup 손질 ──');
check('TOKEN_VARS: --ink-3 · --paper-2 · --coral', G.TOKEN_VARS['ink-3'] === G.TOKEN.ink3 && G.TOKEN_VARS['paper-2'] === G.TOKEN.paper2 && G.TOKEN_VARS.coral === G.TOKEN.coral && !('ink3' in G.TOKEN_VARS), JSON.stringify(G.TOKEN_VARS));
const sceneIn = '<svg><g><text font-family="Jua" class="f-ink">MENU</text><path style="fill:var(--ink-3);stroke:var(--paper-2)" d="M0 0"/><rect fill="var(--nope)"/></g></svg>';
const sceneOut = M.sceneMarkup(sceneIn, G.TOKEN_VARS);
check('무대: 껍데기 벗김 · Jua 폴백 · 토큰 변수 hex', sceneOut === `<g><text font-family="Jua, sans-serif" class="f-ink">MENU</text><path style="fill:${G.TOKEN.ink3};stroke:${G.TOKEN.paper2}" d="M0 0"/><rect fill="var(--nope)"/></g>`, sceneOut);
check('무대: 모르는 변수는 그대로 두고 leftoverVars가 잡는다', JSON.stringify(M.leftoverVars(sceneOut)) === '["nope"]', JSON.stringify(M.leftoverVars(sceneOut)));
check('무대: 껍데기에 속성이 있어도 벗긴다', M.sceneMarkup('<svg viewBox="0 0 1 1"><g/></svg>', {}) === '<g/>', M.sceneMarkup('<svg viewBox="0 0 1 1"><g/></svg>', {}));
const chIn = '<svg style="--friend:#123456"><ellipse fill="var(--ch-skin, #FFD9B8)"/><path fill="var(--ch-hair, #3A2A22)"/><path fill="var(--ch-top, #FF6A48)"/><path fill="var(--friend, #5FC9A6)"/><text style="font-family:var(--mono);font-weight:500">z</text></svg>';
const chLook = M.characterMarkup(chIn, { skin: '#B97D52', hair: '#1F1A17', top: '#1E2440', color: '#FFC64D' });
check('캐릭터: 겉모습·상대 색·monospace', chLook === '<svg style="--friend:#123456"><ellipse fill="#B97D52"/><path fill="#1F1A17"/><path fill="#1E2440"/><path fill="#FFC64D"/><text style="font-family:monospace;font-weight:500">z</text></svg>', chLook);
const chBare = M.characterMarkup(chIn, {});
check('캐릭터: 색을 안 주면 var()의 기본값(모모·민트)', chBare.includes('fill="#FFD9B8"') && chBare.includes('fill="#3A2A22"') && chBare.includes('fill="#FF6A48"') && chBare.includes('fill="#5FC9A6"') && M.leftoverVars(chBare).length === 0, chBare);
check('inlineVars: fallback 둘레 공백은 다듬고, 괄호 든 fallback은 건드리지 않는다', M.inlineVars('a:var(--x ,  #ABC );b:var(--y, calc(1px + 2px))', { x: '#000' }) === 'a:#000;b:var(--y, calc(1px + 2px))' && M.inlineVars('var(--z ,  #ABC )', {}) === '#ABC', M.inlineVars('a:var(--x ,  #ABC );b:var(--y, calc(1px + 2px))', { x: '#000' }));
// 원본 상수의 모양 — shapes.tsx·look.tsx·Character.tsx가 변수 이름을 바꾸면 위 손질이 조용히 헛돈다 (tsx라 node에서 못 읽으니 글자로 본다)
const shapes = src('../src/character/shapes.tsx'), lookTs = src('../src/character/look.tsx'), chTsx = src('../src/character/Character.tsx');
check('shapes.tsx C.skin/top/hair = var(--ch-*, #hex)', /skin: 'var\(--ch-skin, #[0-9A-F]{6}\)'/.test(shapes) && /top: 'var\(--ch-top, #[0-9A-F]{6}\)'/.test(shapes) && /hair: 'var\(--ch-hair, #[0-9A-F]{6}\)'/.test(shapes), '');
check("shapes.tsx FRIEND = var(--friend, #hex)", /export const FRIEND = 'var\(--friend, #[0-9A-F]{6}\)'/.test(shapes), '');
check('look.tsx lookVars가 --ch-skin·--ch-hair·--ch-top을 얹는다', ["'--ch-skin'", "'--ch-hair'", "'--ch-top'"].every(k => lookTs.includes(k)), '');
check("Character.tsx 잠꼬대 글꼴은 var(--mono)", chTsx.includes("fontFamily: 'var(--mono)'"), '');

// ── id · 크기 정책 ────────────────────────────────────────────────────────────
console.log('\n── id · 크기 정책 ──');
const ids = new Set(Array.from({ length: 200 }, () => G.newShotId()));
check('newShotId: 32자 hex', [...ids].every(G.isShotId), [...ids][0]);
check('newShotId: 200개가 다 다르다', ids.size === 200, String(ids.size));
check('isShotId는 대문자·짧은 것을 거른다', !G.isShotId('ABCDEF0123456789ABCDEF0123456789') && !G.isShotId('abc') && !G.isShotId(42), '');
const at = G.bakeAttempts();
check('시도: 300 q.82 → 300 q.62 → 260 q.62', at.length === 3 && at[0].longEdge === 300 && at[0].quality === 0.82 && at[1].quality === 0.62 && at[2].longEdge === 260 && at[2].quality === 0.62, JSON.stringify(at));
check('상한 60 KB', G.MAX_BYTES === 61440, String(G.MAX_BYTES));
// PNG 사다리: 품질 대신 긴 변만 — 첫 시도(300)에서 PNG로 떨어지면 260 → 220 → 180, 260에서 알았으면 220 → 180
const pa = G.pngAttempts(300);
check('PNG: 300에서 알면 260 → 220 → 180, 품질 1', JSON.stringify(pa) === JSON.stringify([260, 220, 180].map(e => ({ longEdge: e, quality: 1 }))), JSON.stringify(pa));
check('PNG: 이미 260이면 220 → 180 / 180이면 끝', G.pngAttempts(260).length === 2 && G.pngAttempts(260)[0].longEdge === 220 && G.pngAttempts(180).length === 0, JSON.stringify(G.pngAttempts(260)));
check('PNG 마지막 칸(180)은 흐린 인물 컷도 들어온다 (300px ≈ 102 KB 기준 면적 비례)', 101971 * (180 / 300) ** 2 < G.MAX_BYTES, String(101971 * (180 / 300) ** 2));

console.log(`\n${n - fails.length}/${n} checks passed`);
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
