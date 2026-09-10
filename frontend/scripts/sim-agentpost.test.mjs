// 에이전트 발행 엔진 harness (ADR-0021 결정 5·6 · SNS_SPEC §8·§9, sim/agentPosts.ts + store의 pumpAgentPost/pumpNpcPosts) — 얼린 시계,
// 가짜 서버(POST /api/posts · PUT /api/media · 문서), 가짜 굽기로: 여유 있는 창 표, 초안(사용자 컷 먼저 · ≤4 · 시각순 · 컷 없으면 null),
// 고민 우선순위와 주 2회 상한, 카페 창에서 묻기 → 16분 뒤 혼자 올림 → "올렸어 · 보러 가기", '컷 고치기'는 글쓰기 화면을 열고 올리지 않음,
// 버린 날은 건너뜀(자기 전에도), 자기 전엔 묻지 않고 올림, 다음 날은 다시, 안 올라간 컷은 기다렸다가 올림, 자기 전엔 올라간 컷만으로,
// 가상 친구 글은 하루 하나 · theworld.snslocal.v1에 남고 · 다시 떠도 있고 · 좋아요가 저장됨, postNow/askPostNow.
// Usage: node scripts/sim-agentpost.test.mjs   (exit 1 on any failed check)
import './ts-hooks.mjs';
import { execFileSync } from 'node:child_process';

const mode = process.argv[2] ?? 'main';
const storage = new Map();
globalThis.localStorage = {
  getItem: k => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k),
  clear: () => storage.clear(),
};
globalThis.location = { reload: () => {} };

const MIN = 60_000;
const KST = (y, m, d, h, mi = 0) => Date.UTC(y, m - 1, d, h - 9, mi);
const T0 = KST(2026, 9, 8, 6, 50);      // 수면 블록 — 아무 블록도 안 시작했다 (오늘 계획을 손으로 다 채운다)
const freezeClockAt = t => storage.set('theworld.clock.v1', JSON.stringify({ anchorReal: Date.now(), anchorSim: t, scale: 0 }));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 자식 프로세스: 저장된 가상 친구 글이 다시 떠도 있는지 (모듈은 프로세스에 한 번만 뜬다) ──
if (mode === 'reload') {
  storage.set('theworld.snslocal.v1', process.env.SNSLOCAL ?? '');
  const { useSns } = await import('../src/sim/sns.ts');
  console.log(JSON.stringify(useSns.getState().localPosts.map(i => [i.post.id, i.post.likedByMe, i.post.likes])));
  process.exit(0);
}

const fails = [];
let n = 0;
const check = (name, ok, detail = '') => { n++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => 'application/json' } });
console.warn = () => {};

// ── 가짜 서버 ────────────────────────────────────────────────────────────────────────
const ME = 'yoongwan';
const server = { log: [], mediaStatus: 201, postStatus: 201, mediaFail: new Set(), media: {} };
let postSeq = 0;
const hex32 = n => n.toString(16).padStart(32, '0');
globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? 'GET';
  const u = new URL(url, 'http://x');
  const entry = { method, url, path: u.pathname, headers: init.headers ?? {}, body: init.body && typeof init.body === 'string' ? JSON.parse(init.body) : init.body };
  server.log.push(entry);
  if (u.pathname === '/api/health') return json(200, { ok: true });
  if (u.pathname === '/api/me/docs' && method === 'GET') return json(200, { docs: {} });
  if (u.pathname.startsWith('/api/me/docs/') && method === 'PUT') return json(200, { version: 1 });
  let m;
  if ((m = u.pathname.match(/^\/api\/media\/([0-9a-f]{32})$/)) && method === 'PUT') {
    const status = server.mediaFail.has(m[1]) ? 500 : server.mediaStatus;
    if (status === 201) { server.media[m[1]] = u.searchParams.get('kind'); return json(201, { id: m[1], ownerId: ME, kind: u.searchParams.get('kind'), mime: 'image/webp', bytes: 10, createdAt: Date.now() }); }
    return json(status, { error: 'boom' });
  }
  if (u.pathname === '/api/posts' && method === 'POST') {
    if (server.postStatus !== 201) return json(server.postStatus, { error: 'boom' });
    const b = entry.body;
    return json(201, { id: hex32(++postSeq), authorId: ME, createdAt: Date.now(), cuts: b.cuts, caption: b.caption ?? '', place: b.place, area: b.area, city: b.city, category: b.category, dateKey: b.dateKey, companions: b.companions ?? [], editedByOwner: !!b.editedByOwner, likes: 0, likedByMe: false });
  }
  return json(404, { error: 'not found' });
};
const posts = () => server.log.filter(l => l.method === 'POST' && l.path === '/api/posts');
const puts = kind => server.log.filter(l => l.method === 'PUT' && l.path.startsWith('/api/media/') && (!kind || l.url.includes(`kind=${kind}`)));

freezeClockAt(T0);
storage.set('theworld.user.v1', JSON.stringify({ userId: ME, name: '윤관' }));
storage.set('theworld.sync.v1', JSON.stringify({ userId: ME, versions: {}, lastPushAt: {} }));
const { bootstrapSync, checkHealth } = await import('../src/sim/sync.ts');
await bootstrapSync();

const AP = await import('../src/sim/agentPosts.ts');
const { relaxedWindow, buildDraft, worryLine, underAskCap, weekKeyOf, captionOf, stripAgentNames, npcLook, emptyAgentPost, validAgentPost, ASK_DUE_MS } = AP;
const { placeById } = await import('../src/sim/places.ts');
const { dayKeyIn, dayStartIn, dayEndOfKey } = await import('../src/sim/tz.ts');
const { blockStartAt } = await import('../src/sim/blocks.ts');
const { unreadCount, buildThread } = await import('../src/sim/chat.ts');
const { pendingOf, toldLine } = await import('../src/sim/requests.ts');
const { AGENTS } = await import('../src/sim/agents.ts');
const M = await import('../src/sim/media.ts');

const TZ = 'Asia/Seoul';
const TODAY = dayKeyIn(T0, TZ);
const DATE = TODAY.slice(0, 10);
const home = placeById('home'), cafe0 = placeById('layered-yeonnam'), park = placeById('gyeongui-line-forest'), rest = placeById('tuktuk-noodle');
const hex = (c, len = 32) => c.repeat(len);
const webp = (seed, size = 32) => new Blob([Uint8Array.from({ length: size }, (_, i) => (i * 7 + seed) & 255)], { type: 'image/webp' });

// ── 순수: 여유 있는 창 ──────────────────────────────────────────────────────────────────
console.log('\n── relaxedWindow ──');
const actOf = (place, category, totalMin = 5) => ({ key: 'k', place, option: { id: 'o', title: 't', reason: '', emoji: '', placeId: place.id, category }, journey: { legs: [], totalMin } });
const active = (place, category) => ({ kind: 'active', act: actOf(place, category), remainingMin: 10, progress: 0.2, tz: TZ, jetlag: false, companions: [] });
const moving = totalMin => ({ kind: 'moving', act: actOf(cafe0, 'play', totalMin), legIndex: 0, legProgress: 0, position: [0, 0], heading: 0, remainingMin: 5, totalProgress: 0, tz: TZ, onboard: null, companions: [] });
const waiting = blockId => ({ kind: 'waiting', at: home, currentBlockId: blockId, nextBlockId: null, nextStartAt: null, tz: TZ, jetlag: false, companions: [] });
check('카페에서 활동 중 → cafe', relaxedWindow(active(cafe0, 'play')) === 'cafe', String(relaxedWindow(active(cafe0, 'play'))));
check('집에서 쉬는 중 → home-rest, 집에서 노는 중은 아님', relaxedWindow(active(home, 'rest')) === 'home-rest' && relaxedWindow(active(home, 'play')) === null, '');
check('숙소에서 쉬는 중 → home-rest', relaxedWindow(active({ ...home, type: 'hotel' }, 'rest')) === 'home-rest', '');
check('식당·공원은 아님', relaxedWindow(active(rest, 'meal')) === null && relaxedWindow(active(park, 'play')) === null, '');
check('20분 이상 이동 → transit, 짧은 이동은 아님', relaxedWindow(moving(25)) === 'transit' && relaxedWindow(moving(20)) === 'transit' && relaxedWindow(moving(10)) === null, '');
check('밤 블록 대기 → bedtime, 낮 대기는 아님', relaxedWindow(waiting('night')) === 'bedtime' && relaxedWindow(waiting('pm')) === null, '');
check('자는 중·만화 중은 아님', relaxedWindow({ kind: 'sleeping', until: 0, at: home, tz: TZ }) === null && relaxedWindow({ kind: 'comic', act: actOf(cafe0, 'play'), comic: {}, tz: TZ, jetlag: false, companions: [] }) === null, '');
check('weekKeyOf: 월요일 시작 (화 8일·일 13일 → 7일, 월 7일 → 그대로)', weekKeyOf('2026-09-08') === '2026-09-07' && weekKeyOf('2026-09-13') === '2026-09-07' && weekKeyOf('2026-09-07') === '2026-09-07' && weekKeyOf('2026-09-14') === '2026-09-14', [weekKeyOf('2026-09-08'), weekKeyOf('2026-09-13')].join());

// ── 순수: 초안·고민 ─────────────────────────────────────────────────────────────────────
console.log('\n── buildDraft · worryLine ──');
const H = h => KST(2026, 9, 8, h);
const mkAct = (blockId, place, endAt, companions = []) => ({ key: `${TODAY}:${blockId}`, dayKey: TODAY, blockIds: [blockId], option: { id: `o-${blockId}`, title: `${place.name}에서 산책`, reason: '', emoji: '', placeId: place.id, category: 'play' }, place, fromPlace: home, journey: { legs: [], totalMin: 5 }, departAt: endAt - 90 * MIN, arriveAt: endAt - 60 * MIN, endAt, comicUntil: endAt + 8 * MIN, originTz: TZ, tz: TZ, jetlagUntil: null, companions });
const panel = (t, by, shotId) => ({ caption: 'c', beat: 'doing', bg: '', t, crop: { scale: 1, x: 0, y: 0, rot: 0 }, by, ...(shotId ? { shotId } : {}) });
const mkComic = (act, panels, extra = {}) => ({ id: `c:${act.key}`, blockId: act.blockIds[0], dateKey: DATE, title: `${act.place.name}에서 생긴 일`, placeName: act.place.name, placeType: act.place.type, createdAt: act.endAt, panels, summary: `${act.place.name}에서 산책, 강아지가 따라왔다.`, category: 'play', area: act.place.area, city: act.place.city, ...extra });
const memory0 = { name: '모모', likes: ['카페'], dislikes: [], traits: [], homePlaceId: 'home', friends: [{ id: 'minsu', name: '민수', homePlaceId: 'minsu-home', color: '#5FC9A6', emoji: '🐥' }, { id: 'hana', name: '하나', homePlaceId: 'hana-home', color: '#A9DCF5', emoji: '🐰' }], visited: [] };
const A = hex('a'), B = hex('b'), C = hex('c'), D = hex('d'), E = hex('e'), F = hex('f'), G = hex('9');
const am = mkAct('am', park, H(11) + 30 * MIN, ['hana']);
const lunch = mkAct('lunch', rest, H(13) + 40 * MIN);
const pm = mkAct('pm', cafe0, H(17) + 30 * MIN);   // 아직 안 끝났다
const comicAm = mkComic(am, [panel(H(10), 'user', A), panel(H(10) + 20 * MIN, 'agent', B), panel(H(10) + 40 * MIN, 'agent'), panel(H(11), 'user', C)]);
const comicLunch = mkComic(lunch, [panel(H(12) + 30 * MIN, 'agent', D), panel(H(12) + 50 * MIN, 'agent', E), panel(H(13) + 10 * MIN, 'agent', F), panel(H(13) + 30 * MIN, 'agent', G)]);
const ctx0 = (over = {}) => ({ today: TODAY, now: H(14) + 20 * MIN, timeline: [am, lunch, pm], book: [comicAm, comicLunch], shots: [], memory: memory0, encounters: {}, isUploaded: () => true, agentPost: emptyAgentPost(), ...over });
const d1 = buildDraft(ctx0());
check('사용자 컷 먼저, 에이전트 컷으로 채워 4장, 찍힌 순서', d1 && d1.cuts.map(c => c.shotId).join() === [A, B, C, D].join() && d1.cuts.map(c => c.by).join() === 'user,agent,user,agent', JSON.stringify(d1?.cuts));
check('컷의 actKey·win은 책의 그 컷', d1?.cuts[0].actKey === am.key && d1.cuts[0].win === 0 && d1.cuts[1].win === 1 && d1.cuts[3].actKey === lunch.key && d1.cuts[3].win === 0, JSON.stringify(d1?.cuts));
check('면은 첫 컷의 만화에서, 동행은 활동들의 합집합', d1?.place === park.name && d1.area === park.area && d1.city === 'seoul' && d1.category === 'play' && d1.dateKey === DATE && d1.companions.join() === 'hana', JSON.stringify(d1));
check('캡션은 요약에서, 60자 이내', typeof d1?.caption === 'string' && d1.caption.length > 0 && d1.caption.length <= 60, d1?.caption);
check('고민: 동행이 있으면 "하나랑 같이 찍힌 건데 올려도 돼?"', d1?.reason === '하나랑 같이 찍힌 건데 올려도 돼?', d1?.reason);
check('픽셀 없는 컷은 안 들어간다 (shotId 없는 컷 제외)', d1 && !d1.cuts.some(c => c.actKey === am.key && c.win === 2), '');
check('shotId가 하나도 없으면 null', buildDraft(ctx0({ book: [mkComic(am, [panel(H(10), 'user'), panel(H(10) + 1, 'agent')])] })) === null, '');
check('마지막 글 뒤의 컷만 (lastPostAt 뒤에 끝난 활동)', buildDraft(ctx0({ agentPost: { ...emptyAgentPost(), lastPostAt: H(12) } }))?.cuts.map(c => c.shotId).join() === [D, E, F, G].join(), JSON.stringify(buildDraft(ctx0({ agentPost: { ...emptyAgentPost(), lastPostAt: H(12) } }))?.cuts));
check('아직 안 끝난 활동의 컷은 안 쓴다', buildDraft(ctx0({ book: [mkComic(pm, [panel(H(15), 'user', A)])] })) === null, '');
check('만화에 없어도 샷 목록의 사용자 컷 id를 쓴다', buildDraft(ctx0({ book: [mkComic(am, [panel(H(10), 'user')])], shots: [{ actKey: am.key, win: 0, at: H(10), crop: { scale: 1, x: 0, y: 0, rot: 0 }, shotId: E }] }))?.cuts[0].shotId === E, '');
// 고민 우선순위
const liked = { ...emptyAgentPost(), likedAuthors: { minsu: [H(14) - 24 * 3600_000, H(14) - 48 * 3600_000] } };
check('1. 관심 있는 사람 (7일 안 좋아요 2번)이 동행보다 먼저', buildDraft(ctx0({ agentPost: liked }))?.reason === '민수 이거 볼 텐데, 이 컷 괜찮아?', buildDraft(ctx0({ agentPost: liked }))?.reason);
check('좋아요가 한 번뿐이거나 8일 전이면 아니다', buildDraft(ctx0({ agentPost: { ...emptyAgentPost(), likedAuthors: { minsu: [H(14) - 3600_000] } } }))?.reason === '하나랑 같이 찍힌 건데 올려도 돼?' && buildDraft(ctx0({ agentPost: { ...emptyAgentPost(), likedAuthors: { minsu: [H(14) - 8 * 86400_000, H(14) - 9 * 86400_000] } } }))?.reason === '하나랑 같이 찍힌 건데 올려도 돼?', '');
const crushMem = { ...memory0, friends: memory0.friends.map(f => (f.id === 'hana' ? { ...f, crush: { v: 0.7, at: H(10) } } : f)) };
check('2. 설렘 0.5 이상이면 "하나한테 좀 멋있게…"', buildDraft(ctx0({ memory: crushMem }))?.reason === '하나한테 좀 멋있게 나온 걸로 올리고 싶은데 골라줄래?', buildDraft(ctx0({ memory: crushMem }))?.reason);
check('설렘이 0.5 아래면 동행 줄', buildDraft(ctx0({ memory: { ...memory0, friends: memory0.friends.map(f => ({ ...f, crush: { v: 0.3, at: 0 } })) } }))?.reason === '하나랑 같이 찍힌 건데 올려도 돼?', '');
const amAlone = { ...am, companions: [] };
const visitedMem = { ...memory0, visited: [{ placeId: park.id, at: H(9) - 86400_000 }, { placeId: rest.id, at: H(9) - 86400_000 }] };
check('4. 동행 없고 낙서가 있으면 "네가 그린 거 올려도 돼?"', worryLine(ctx0({ memory: visitedMem }), { ...d1, companions: [] }, [{ ...comicAm, sketch: 'data:image/png;base64,x' }], [amAlone]) === '네가 그린 거 올려도 돼?', '');
check('5a. 처음 간 곳이면 "오늘 처음 간 데인데 이거 올릴까?"', worryLine(ctx0(), { ...d1, companions: [] }, [comicAm], [amAlone]) === '오늘 처음 간 데인데 이거 올릴까?', worryLine(ctx0(), { ...d1, companions: [] }, [comicAm], [amAlone]));
const prior = cat => Array.from({ length: 5 }, (_, i) => ({ ...comicLunch, id: `c:old${cat}${i}`, dateKey: `2026-09-0${i + 2}`, category: cat }));
check('5b. 최근 14일 상위 3 범주에 오늘 범주가 없으면 "평소랑 다른 하루"', worryLine(ctx0({ memory: visitedMem, book: [comicAm, ...prior('meal'), ...prior('work'), ...prior('rest')] }), { ...d1, companions: [] }, [comicAm], [amAlone]) === '오늘은 평소랑 좀 다른 하루였는데, 올릴까?', '');
check('   오늘 범주가 평소 것이면 아니다 (역사가 4편 미만이어도 아니다)', worryLine(ctx0({ memory: visitedMem, book: [comicAm, ...prior('play')] }), { ...d1, companions: [] }, [comicAm], [amAlone]) === undefined && worryLine(ctx0({ memory: visitedMem, book: [comicAm, ...prior('meal').slice(0, 3)] }), { ...d1, companions: [] }, [comicAm], [amAlone]) === undefined, '');
const freshMem = { ...visitedMem, friends: visitedMem.friends.map(f => (f.id === 'hana' ? { ...f, metAt: H(13) } : f)) };
check('6. 막 친구 된 사람이 있으면 "하나가 처음 보는 글이야, 괜찮아?"', worryLine(ctx0({ memory: freshMem }), { ...d1, companions: [] }, [comicAm], [amAlone]) === '하나가 처음 보는 글이야, 괜찮아?', '');
check('   하루 넘게 지난 친구는 아니다', worryLine(ctx0({ memory: { ...visitedMem, friends: visitedMem.friends.map(f => ({ ...f, metAt: H(13) - 2 * 86400_000 })) } }), { ...d1, companions: [] }, [comicAm], [amAlone]) === undefined, '');
check('   친구 된 뒤 이미 한 번 올렸으면 아니다 (첫 글만), 그 전에 올린 건 상관없다', worryLine(ctx0({ memory: freshMem, agentPost: { ...emptyAgentPost(), lastPostAt: H(13) + 30 * MIN } }), { ...d1, companions: [] }, [comicAm], [amAlone]) === undefined && worryLine(ctx0({ memory: freshMem, agentPost: { ...emptyAgentPost(), lastPostAt: H(12) } }), { ...d1, companions: [] }, [comicAm], [amAlone]) === '하나가 처음 보는 글이야, 괜찮아?', '');
const capped = { ...emptyAgentPost(), asks: { week: weekKeyOf(DATE), count: 2 } };
check('주 2회 상한: 이번 주 2번 물었으면 고민이 있어도 reason 없음', !underAskCap(capped, TODAY) && buildDraft(ctx0({ agentPost: capped }))?.reason === undefined, '');
check('   1번이면 아직 묻는다, 지난주 것은 안 센다', underAskCap({ ...capped, asks: { week: weekKeyOf(DATE), count: 1 } }, TODAY) && underAskCap({ ...capped, asks: { week: '2026-08-31', count: 5 } }, TODAY), '');
check('캡션에 NPC·친구 이름이 없다', !/민수|하나/.test(captionOf({ ...comicAm, summary: '경의선숲길에서 산책, 민수가 내 반찬을 다 먹었다.' }, memory0)) && stripAgentNames('하나: "그거 고양이야?" 강아지였다', memory0) === '"그거 고양이야?" 강아지였다', captionOf({ ...comicAm, summary: '경의선숲길에서 산책, 민수가 내 반찬을 다 먹었다.' }, memory0));
check('낱말 "하나"는 살아남는다 (문장 중간·조사 없이·"가"만) — 같이 있던 사람의 이름일 때만 어디서든 지운다',
  stripAgentNames('사장님이 쿠키 하나 서비스로 주셨다', memory0) === '사장님이 쿠키 하나 서비스로 주셨다' && stripAgentNames('풍선 하나가 하늘로 날아갔다', memory0) === '풍선 하나가 하늘로 날아갔다'
  && stripAgentNames('냉장고에 남은 건 계란 하나. 계란밥', memory0) === '냉장고에 남은 건 계란 하나. 계란밥' && stripAgentNames('하나가 내 케이크 한 입 훔쳐 먹었다', memory0) === '내 케이크 한 입 훔쳐 먹었다'
  && stripAgentNames('옆자리에 하나랑 앉았다', memory0) === '옆자리에 앉았다' && stripAgentNames('옆에서 하나가 웃었다', memory0, ['하나']) === '옆에서 웃었다'
  && captionOf({ ...comicAm, summary: `${cafe0.name}에서 그림 그리기, 사장님이 쿠키 하나 서비스로 주셨다.` }, memory0).replace(/^.*그리기\. /, '') !== '사장님이 쿠키 서비스로 주셨다',
  JSON.stringify([stripAgentNames('사장님이 쿠키 하나 서비스로 주셨다', memory0), stripAgentNames('풍선 하나가 하늘로 날아갔다', memory0), stripAgentNames('하나가 내 케이크 한 입 훔쳐 먹었다', memory0), stripAgentNames('옆자리에 하나랑 앉았다', memory0), stripAgentNames('옆에서 하나가 웃었다', memory0, ['하나'])]));
check('npcLook: 풀의 머리 모양과 색(옷)만 얹는다', npcLook(AGENTS.find(a => a.id === 'hana')).hairStyle === 'bob' && npcLook(AGENTS.find(a => a.id === 'hana')).top === 'sky' && npcLook({ ...AGENTS[0], hairStyle: 'weird', color: '#000000' }).hairStyle === 'bowl', JSON.stringify(npcLook(AGENTS[1])));
check('validAgentPost: 틀린 모양은 빈 값, 초안은 컷이 맞을 때만', validAgentPost(null).asks.count === 0 && validAgentPost({ asks: { week: 'w', count: 2.7 }, likedAuthors: { x: [1, 'y'] }, pending: { draftId: 'd', dueAt: 1, asked: true, draft: { id: 'd', cuts: [{ shotId: 'zz' }] } } }).asks.count === 2 && validAgentPost({ likedAuthors: { x: [1, 'y'] }, pending: { draftId: 'd', dueAt: 1, asked: true, draft: { id: 'd', cuts: [{ shotId: 'zz' }] } } }).pending === undefined && validAgentPost({ likedAuthors: { x: [1, 'y'] } }).likedAuthors.x.join() === '1', '');

// ── 스토어: 하루를 손으로 채우고 창마다 굴린다 ──────────────────────────────────────────────
console.log('\n── 스토어: 카페 창에서 묻고, 답이 없으면 15분 뒤 올린다 ──');
const { useWorld, setNpcBaker } = await import('../src/sim/store.ts');
const { useSns } = await import('../src/sim/sns.ts');
const S = () => useWorld.getState();
const N = () => useSns.getState();
const opt = (id, place, category, title, extra = {}) => ({ id, title, reason: '검사용', emoji: '·', placeId: place.id, category, ...extra });
const confirmed = (blockId, o) => ({ blockId, category: o.category, options: [o], chosenId: o.id, chosenBy: 'user', status: 'confirmed' });
const fillDay = c => {
  const plans = {
    ...S().plans,
    morning: confirmed('morning', opt('mo', rest, 'meal', `${rest.name}에서 아침`)),
    am: confirmed('am', opt('am', park, 'play', `${park.name}에서 산책`, { friendId: 'hana' })),
    lunch: confirmed('lunch', opt('lu', rest, 'meal', `${rest.name}에서 점심`)),
    pm: confirmed('pm', opt('pm', c, 'play', `${c.name}에서 그림 그리기`)),
    evening: confirmed('evening', opt('ev', rest, 'meal', `${rest.name}에서 저녁`)),
    night: confirmed('night', opt('ni', home, 'rest', '집에서 뒹굴기')),
  };
  useWorld.setState({ plans, days: { ...S().days, [S().today]: plans } });
};
const dayStart = dayStartIn(T0, TZ);
const at = (h, m = 0) => dayStart + h * 3600_000 + m * MIN;
check('부팅: agentPost는 빈 값, 초안 없음', S().agentPost.asks.count === 0 && S().agentPost.pending === undefined && N().draft === null, JSON.stringify(S().agentPost));
// 마찰(sim/friction — 딴 데로 감)이 시드로 걸리는 카페가 있다 — 오후에 진짜로 카페에 있게 되는 것을 고른다
const { PLACES } = await import('../src/sim/places.ts');
let cafe = null;
for (const c of PLACES.filter(p => p.type === 'cafe' && p.city === 'seoul')) {
  fillDay(c); S().jumpTo(at(6, 55));
  const a = S().timeline.find(x => x.key === `${TODAY}:pm`);
  const b = S().timeline.find(x => x.key === `${TODAY}:am`);
  if (a?.place.type === 'cafe' && b?.place.id === park.id) { cafe = a.place; break; }
}
check('오후에 카페에 있는 하루를 골랐다', !!cafe, '');
S().jumpTo(at(9, 1));
const actAm = S().timeline.find(a => a.key === `${TODAY}:am`);
check('오전 활동이 공원에 있고 동행은 하나', !!actAm && actAm.place.id === park.id && actAm.companions.join() === 'hana', JSON.stringify(actAm && [actAm.place.id, actAm.companions]));
const crop = { scale: 1.1, x: 2, y: -3, rot: 4 };
S().addShot({ actKey: actAm.key, win: 0, at: at(9, 40), crop, shotId: A });
S().addShot({ actKey: actAm.key, win: 2, at: at(10, 50), crop, shotId: C });
await M.putLocal(A, webp(1), 'shot'); await M.putLocal(C, webp(3), 'shot');
await M.flushUploads(); await sleep(20);
check('사용자 컷 두 장이 서버에 올라갔다', M.isUploaded(A) && M.isUploaded(C) && puts('shot').length === 2, JSON.stringify([M.isUploaded(A), puts().length]));
const actMo = S().timeline.find(a => a.key === `${TODAY}:morning`);
S().jumpTo(actMo.endAt + 1000); S().jumpTo(actAm.endAt + 1000);   // 만화 구간을 지나야 책에 실린다 (jumpTo는 건너뛴 활동을 정산하지 않는다)
S().jumpTo(at(12, 30));
S().tick();
const comicAmS = S().book.find(c => c.id === `c:${actAm.key}`);
const comicMo = S().book.find(c => c.id === `c:${TODAY}:morning`);
check('점심에 오전·아침 만화가 있고 사용자 컷은 shotId를 들고 있다', !!comicAmS && !!comicMo && comicAmS.panels[0].shotId === A && comicAmS.panels[0].by === 'user' && comicAmS.panels[2].shotId === C, JSON.stringify(comicAmS?.panels.map(p => [p.by, p.shotId])));
const MO = hex('1');
S().patchPanelShot(comicAmS.id, 1, B); S().patchPanelShot(comicMo.id, 0, MO);
await M.putLocal(B, webp(2), 'shot'); await M.putLocal(MO, webp(4), 'shot');
await M.flushUploads(); await sleep(20);
check('식당에서는 창이 아니다 — 아무것도 안 한다', S().phase.kind === 'active' && S().phase.act.place.id === rest.id && S().agentPost.pending === undefined && S().requests.length === 0 && posts().length === 0, JSON.stringify([S().phase.kind, S().agentPost]));
S().noteLike('minsu'); S().noteLike('minsu');
check('noteLike: 좋아요 시각이 world.agentPost에 쌓이고 저장된다', S().agentPost.likedAuthors.minsu?.length === 2 && JSON.parse(storage.get('theworld.world.v5')).agentPost.likedAuthors.minsu.length === 2, JSON.stringify(S().agentPost.likedAuthors));
const actPm = S().timeline.find(a => a.key === `${TODAY}:pm`);
const T_PM = actPm.arriveAt + 5 * MIN;
S().jumpTo(T_PM);
check('오후: 카페에서 활동 중 = cafe 창', S().phase.kind === 'active' && S().phase.act.place.id === cafe.id && relaxedWindow(S().phase) === 'cafe', JSON.stringify([S().phase.kind, S().phase.act?.place.id]));
const seen0 = unreadCount(buildThread(S().messages, S().requests, S().calls, S().now), S().chatSeen);
S().tick();
const req = S().requests.find(r => r.kind === 'post');
const draft = N().draft;
check('고민(관심 있는 사람)이 있어 채팅으로 묻는다 — kind post, 이유 + 캡션', !!req && req.line.startsWith('민수 이거 볼 텐데, 이 컷 괜찮아? — "') && req.choices.map(c => c.id).join() === 'post,edit' && req.choices[0].isDefault === true, JSON.stringify(req));
check('마감은 15분 뒤, refId는 초안 id, 카드로 뜬다', req?.dueAt === T_PM + ASK_DUE_MS && req.refId === draft?.id && pendingOf(S().requests, S().now)[0]?.id === req.id, JSON.stringify([req?.dueAt - T_PM, req?.refId, draft?.id]));
check('useSns.draft가 채워졌다 — 사용자 컷 A·C 포함 4장, 동행 하나, dueAt', !!draft && draft.cuts.length === 4 && draft.cuts.some(c => c.shotId === A && c.by === 'user') && draft.cuts.some(c => c.shotId === C) && draft.companions.join() === 'hana' && draft.dueAt === req.dueAt, JSON.stringify(draft));
check('world.agentPost: pending(asked) · 이번 주 1번 · 저장됨', S().agentPost.pending?.asked === true && S().agentPost.pending.draftId === draft.id && S().agentPost.asks.count === 1 && S().agentPost.asks.week === weekKeyOf(DATE) && JSON.parse(storage.get('theworld.world.v5')).agentPost.pending.draft.id === draft.id, JSON.stringify(S().agentPost));
check('아직 올리지 않았다, 안 읽은 줄 +1 (쪽지)', posts().length === 0 && unreadCount(buildThread(S().messages, S().requests, S().calls, S().now), S().chatSeen) === seen0 + 1, '');
S().tick(); S().jumpBy(5 * MIN); S().tick();
check('답을 기다리는 동안 다시 묻지도 올리지도 않는다', S().requests.filter(r => r.kind === 'post').length === 1 && posts().length === 0, '');
S().jumpBy(11 * MIN); S().tick();
await sleep(30);
const posted = posts()[0];
const r2 = S().requests.find(r => r.kind === 'post');
check('16분 뒤: 혼자 정하고(decidedAlone) 그대로 올린다 — POST /api/posts에 초안의 컷·캡션·동행', r2?.decidedAlone === true && !!posted && posted.body.cuts.map(c => c.shotId).join() === draft.cuts.map(c => c.shotId).join() && posted.body.caption === draft.caption && posted.body.companions.join() === 'hana' && posted.body.editedByOwner === false && posted.headers['x-user-id'] === ME, JSON.stringify(posted?.body));
check('통보 문구는 올렸다고 하지 않는다 (올리기는 마감 뒤라) — "올렸어"는 따로 온다', toldLine(r2) === '답이 없어서 그냥 올릴게', toldLine(r2));
const line = S().messages.find(m => m.id === `post:${hex32(1)}`);
check('"올렸어 · 보러 가기" 한 줄 (링크 달림), 오늘 끝, 초안 비움', !!line && line.from === 'agent' && line.text === '올렸어' && line.link?.kind === 'post' && line.link.id === hex32(1) && line.link.label === '보러 가기' && S().agentPost.lastPostDay === TODAY && S().agentPost.lastPostAt === S().now && S().agentPost.pending === undefined && N().draft === null, JSON.stringify([line, S().agentPost]));
check('안 읽은 줄 +1 (올렸어), 내 글 맨 앞에 끼었다', unreadCount(buildThread(S().messages, S().requests, S().calls, S().now), S().chatSeen) === seen0 + 2 && N().myPosts[0]?.id === hex32(1), '');
S().tick(); S().jumpTo(at(23, 56)); S().tick(); await sleep(10);
check('같은 날엔 다시 올리지 않는다 (자기 전 창에서도)', relaxedWindow(S().phase) === 'bedtime' && posts().length === 1, JSON.stringify([S().phase.kind, S().phase.currentBlockId, posts().length]));

// ── 다음 날: 안 올라간 컷은 기다렸다가 올린다 (postNow) ───────────────────────────────────
console.log('\n── 다음 날: 안 올라간 컷은 기다린다 · postNow ──');
const day2 = dayStart + 86400_000;
const at2 = (h, m = 0) => day2 + h * 3600_000 + m * MIN;
S().jumpTo(at2(15, 0)); S().tick(); await sleep(10);
const DAY2 = S().today;
const done2 = S().timeline.filter(a => a.dayKey === DAY2 && a.endAt <= S().now);
S().jumpTo(done2[done2.length - 1].endAt + 1000); S().jumpTo(at2(15, 0));
const comic2 = S().book.find(c => c.id === `c:${done2[done2.length - 1].key}`);
check('날이 바뀌었고 끝난 활동의 만화가 있다', DAY2 !== TODAY && done2.length >= 2 && !!comic2, JSON.stringify([DAY2, done2.length]));
const X1 = hex('2'), X2 = hex('3');
S().patchPanelShot(comic2.id, 0, X1); S().patchPanelShot(comic2.id, 1, X2);
server.mediaStatus = 500;
await M.putLocal(X1, webp(5), 'shot'); await M.putLocal(X2, webp(6), 'shot');
await M.flushUploads(); await sleep(20);
check('서버가 500이면 컷이 안 올라간다', !M.isUploaded(X1) && !M.isUploaded(X2), '');
S().postNow(); await sleep(20);
check('postNow: 초안을 쥐지만(asked 아님) 컷이 안 올라가 올리지 않는다', S().agentPost.pending?.asked === false && S().agentPost.pending.draft.cuts.map(c => c.shotId).join() === [X1, X2].join() && posts().length === 1, JSON.stringify(S().agentPost.pending));
S().tick(); await sleep(10);
check('tick마다 다시 봐도 아직', posts().length === 1, '');
server.mediaStatus = 201;
await checkHealth(); await M.flushUploads(); await sleep(30);
check('서버가 살아나 컷이 올라갔다', M.isUploaded(X1) && M.isUploaded(X2), JSON.stringify(puts().map(p => p.path)));
S().tick(); await sleep(30);
check('그 다음 tick에 올린다 — 컷 두 장, 오늘 끝', posts().length === 2 && posts()[1].body.cuts.map(c => c.shotId).join() === [X1, X2].join() && S().agentPost.lastPostDay === DAY2 && S().agentPost.pending === undefined && S().messages.some(m => m.id === `post:${hex32(2)}`), JSON.stringify(S().agentPost));
check('postNow: 올릴 컷이 없으면 혼잣말만', (S().postNow(), S().say?.text === '아직 올릴 컷이 없어' && posts().length === 2), JSON.stringify(S().say));

// ── 그 다음 날: '컷 고치기' → 글쓰기 화면, 버리면 그날은 건너뛴다 (자기 전에도) ──────────────
console.log('\n── 컷 고치기 · 버린 날 ──');
const prepDay = async (h, m, ids, opts = {}) => {
  S().jumpTo(dayStart + opts.days * 86400_000 + h * 3600_000 + m * MIN); S().tick(); await sleep(10);
  const day = S().today;
  const done = S().timeline.filter(a => a.dayKey === day && a.endAt <= S().now);
  let comic = S().book.find(c => c.id === `c:${done[done.length - 1].key}`);
  if (!comic) {   // 창이 아니라 엔진이 정산하지 않았다 — 만화 구간을 지나 책에 싣는다
    const target = S().now;
    S().jumpTo(done[done.length - 1].endAt + 1000); S().jumpTo(target);
    comic = S().book.find(c => c.id === `c:${done[done.length - 1].key}`);
  }
  ids.forEach((id, i) => S().patchPanelShot(comic.id, i, id));
  for (const [i, id] of ids.entries()) await M.putLocal(id, webp(10 + i), 'shot');
  await checkHealth();   // 앞 검사에서 500을 받아 backend가 down일 수 있다 — 살려서 줄을 비운다
  await M.flushUploads(); await sleep(20);
  return day;
};
const Y1 = hex('4'), Y2 = hex('5');
const DAY3 = await prepDay(23, 56, [Y1, Y2], { days: 2 });
check('자기 전 창, 컷은 올라가 있다', relaxedWindow(S().phase) === 'bedtime' && M.isUploaded(Y1) && M.isUploaded(Y2) && posts().length === 2, JSON.stringify([S().phase.kind, S().phase.currentBlockId]));
S().askPostNow();
const req3 = S().requests.find(r => r.kind === 'post' && r.refId === N().draft?.id);
check('askPostNow: 고민·상한과 무관하게 묻는다 (세지 않는다)', !!req3 && req3.line.startsWith('지금 이거 올리려는데 봐줄래? — "') && S().agentPost.asks.count === 1 && S().agentPost.pending?.asked === true, JSON.stringify([req3?.line, S().agentPost.asks]));
S().setChatOpen(true);
S().answerRequest(req3.id, 'edit'); await sleep(10);
check("'컷 고치기': 글쓰기 화면·SNS가 열리고 대화창은 닫히고, 올리지 않는다", N().composeOpen === true && N().snsOpen === true && S().chatOpen === false && N().draft?.id === req3.refId && S().requests.find(r => r.id === req3.id).answered === 'edit' && posts().length === 2, JSON.stringify([N().composeOpen, N().snsOpen, S().chatOpen]));
S().tick(); await sleep(10);
check('고치는 동안 엔진은 기다린다', posts().length === 2 && S().agentPost.pending?.draftId === req3.refId, '');
S().resolvePostDraft(req3.refId, 'discarded');
check("버렸다: skippedDay = 오늘, 초안 비움, 쪽지는 답한 것", S().agentPost.skippedDay === DAY3 && S().agentPost.pending === undefined && N().draft === null && S().requests.find(r => r.id === req3.id).told === true, JSON.stringify(S().agentPost));
S().tick(); S().jumpBy(MIN); S().tick(); await sleep(20);
check('버린 날은 자기 전 창에서도 올리지 않는다', posts().length === 2 && S().requests.filter(r => r.kind === 'post').length === 2, String(posts().length));

// ── 그 다음 날: 자기 전엔 묻지 않고 올린다 (고민이 있어도) · 다음 날은 다시 ──────────────
console.log('\n── 자기 전엔 묻지 않고 올린다 ──');
const Z1 = hex('6'), Z2 = hex('7');
const DAY4 = await prepDay(23, 56, [Z1, Z2], { days: 3 });
S().noteLike('hana'); S().noteLike('hana');   // 고민거리가 있어도
const reqCount = S().requests.filter(r => r.kind === 'post').length;
S().tick(); await sleep(30);
check('자기 전 창: 쪽지 없이 바로 올린다 — 다음 날이라 다시 올린다', posts().length === 3 && S().requests.filter(r => r.kind === 'post').length === reqCount && S().agentPost.lastPostDay === DAY4 && posts()[2].body.cuts.map(c => c.shotId).join() === [Z1, Z2].join(), JSON.stringify([posts().length, S().agentPost]));

console.log('\n── 자기 전엔 올라간 컷만으로, 하나도 없으면 건너뛴다 ──');
const W1 = hex('8'), W2 = hex('0');
server.mediaFail.add(W2);
const DAY5 = await prepDay(23, 56, [W1, W2], { days: 4 });
check('한 장만 올라갔다', M.isUploaded(W1) && !M.isUploaded(W2), '');
S().tick(); await sleep(30);
check('자기 전 마지막 5분: 올라간 컷만으로 올린다', posts().length === 4 && posts()[3].body.cuts.map(c => c.shotId).join() === W1 && S().agentPost.lastPostDay === DAY5, JSON.stringify(posts()[3]?.body.cuts));
const V1 = hex('a').replace(/a/g, 'b').slice(0, 30) + 'cd';
server.mediaFail.add(V1);
const DAY6 = await prepDay(23, 56, [V1], { days: 5 });
S().tick(); await sleep(20);
check('하나도 안 올라갔으면 오늘은 건너뛴다', posts().length === 4 && S().agentPost.skippedDay === DAY6 && S().agentPost.pending === undefined, JSON.stringify(S().agentPost));
server.mediaFail.clear();   // 줄에 남은 실패 컷이 다음 검사의 업로드를 막지 않게

// ── resolvePostDraft('posted'): 글쓰기 화면이 올린 것 — 다시 올리지 않고 한 줄만 ───────────
console.log('\n── resolvePostDraft(posted) ──');
const DAY7 = await prepDay(15, 0, [hex('c').slice(0, 30) + 'ef'], { days: 6 });
S().askPostNow();
const req7 = S().requests.find(r => r.kind === 'post' && r.refId === N().draft?.id);
const before7 = posts().length;
S().resolvePostDraft(req7.refId, 'posted', hex32(77));
check('올렸다고 알려 오면: POST 없이 "올렸어 · 보러 가기", 오늘 끝, 쪽지는 답한 것', posts().length === before7 && S().messages.find(m => m.id === `post:${hex32(77)}`)?.link?.id === hex32(77) && S().agentPost.lastPostDay === DAY7 && S().agentPost.pending === undefined && N().draft === null && S().requests.find(r => r.id === req7.id).answered === 'edit', JSON.stringify(S().agentPost));
S().tick(); await sleep(10);
check('그 뒤 tick에도 올리지 않는다', posts().length === before7, '');
check('저장본의 agentPost가 검증을 그대로 지난다', JSON.stringify(validAgentPost(JSON.parse(storage.get('theworld.world.v5')).agentPost)) === JSON.stringify(S().agentPost), '');

// ── 가상 친구의 글 (ADR-0021 결정 6) ──────────────────────────────────────────────────
console.log('\n── 가상 친구의 글 ──');
const baked = [];
let failFor = null;
setNpcBaker(async input => { if (failFor && input.color === failFor) throw new Error('bake fail'); baked.push(input); return { blob: webp(baked.length), mime: 'image/webp' }; });
const DAY8 = await prepDay(23, 56, [], { days: 7 });
const DATE8 = DAY8.slice(0, 10);
S().tick(); await sleep(60);
const local = N().localPosts;
const npcFriends = S().memory.friends.filter(f => AGENTS.some(a => a.id === f.id));   // 며칠 사는 동안 마주쳐 친구가 더 생겼다
check('NPC 친구마다 글이 하루 하나씩 생겼다 — id l:<npc>:<date> (민수·하나 포함)', npcFriends.length >= 2 && local.length === npcFriends.length && npcFriends.every(f => local.some(i => i.post.id === `l:${f.id}:${DATE8}` && i.author.id === f.id)), JSON.stringify([local.map(i => i.post.id), npcFriends.map(f => f.id)]));
check('컷 2~3장, 32자 hex, by agent, kind npc로 올라갔다', local.every(i => i.post.cuts.length >= 2 && i.post.cuts.length <= 3 && i.post.cuts.every(c => /^[0-9a-f]{32}$/.test(c.shotId) && c.by === 'agent')) && puts('npc').length === local.reduce((s, i) => s + i.post.cuts.length, 0), JSON.stringify([local.map(i => i.post.cuts.length), puts('npc').length]));
check('작성자는 RemoteAgent 모양(home 동봉), 글의 면은 그 활동의 장소, 좋아요 0~12', local.every(i => i.author.home?.id === i.author.homePlaceId && i.post.place && i.post.area && i.post.city && i.post.dateKey === DATE8 && i.post.likes >= 0 && i.post.likes <= 12 && i.post.companions.length === 0), JSON.stringify(local[0]));
check('굽기는 NPC의 겉모습으로 (하나는 bob·sky, 민수는 short·mint)', baked.some(b => b.look.hairStyle === 'bob' && b.look.top === 'sky' && b.color === '#A9DCF5') && baked.some(b => b.look.hairStyle === 'short' && b.look.top === 'mint'), JSON.stringify(baked.map(b => [b.look.hairStyle, b.look.top, b.pose, b.placeType])));
check('캡션은 활동에서, 이름 없음', local.every(i => i.post.caption.length > 0 && i.post.caption.length <= 60), JSON.stringify(local.map(i => i.post.caption)));
S().tick(); await sleep(30);
check('같은 날 다시 만들지 않는다', N().localPosts.length === npcFriends.length && baked.length === local.reduce((s, i) => s + i.post.cuts.length, 0), String(N().localPosts.length));
const savedLocal = JSON.parse(storage.get('theworld.snslocal.v1'));
check('theworld.snslocal.v1에 남는다', savedLocal.v === 1 && savedLocal.items.length === npcFriends.length, storage.get('theworld.snslocal.v1')?.slice(0, 80));
const likeId = local[0].post.id;
const likes0 = local[0].post.likes;
N().likeLocalToggle(likeId);
check('likeLocalToggle: 화면과 저장본이 같이 바뀌고, 관심 기록에도 적힌다', N().localPosts.find(i => i.post.id === likeId).post.likedByMe === true && N().localPosts.find(i => i.post.id === likeId).post.likes === likes0 + 1 && JSON.parse(storage.get('theworld.snslocal.v1')).items.find(i => i.post.id === likeId).post.likedByMe === true && (S().agentPost.likedAuthors[local[0].author.id]?.length ?? 0) >= 1, '');
N().likeLocalToggle(likeId);
check('다시 누르면 꺼진다 (0 아래로 안 간다)', N().localPosts.find(i => i.post.id === likeId).post.likedByMe === false && N().localPosts.find(i => i.post.id === likeId).post.likes === likes0, '');
N().likeLocalToggle(likeId);
{
  let out = '';
  try { out = execFileSync(process.execPath, [process.argv[1], 'reload'], { encoding: 'utf-8', env: { ...process.env, SNSLOCAL: storage.get('theworld.snslocal.v1') }, stdio: ['ignore', 'pipe', 'inherit'] }); }
  catch (e) { out = e.stdout ?? ''; }
  const rows = out.trim() ? JSON.parse(out.trim().split('\n').pop()) : [];
  check('다시 떠도(새 프로세스) useSns.localPosts에 있고 좋아요도 그대로', rows.length === npcFriends.length && rows.some(r => r[0] === likeId && r[1] === true && r[2] === likes0 + 1), out.trim());
}
failFor = '#5FC9A6';   // 민수의 색 — 굽기 실패
const DAY9 = await prepDay(23, 56, [], { days: 8 });
S().tick(); await sleep(60);
const day9 = N().localPosts.filter(i => i.post.dateKey === DAY9.slice(0, 10));
const npc9 = S().memory.friends.filter(f => AGENTS.some(a => a.id === f.id));
check('굽기가 실패한 친구(민수)는 그날 건너뛴다, 나머지는 생기고, 다시 굽지 않는다', day9.length === npc9.length - 1 && !day9.some(i => i.author.id === 'minsu') && day9.some(i => i.author.id === 'hana') && (S().tick(), await sleep(30), N().localPosts.filter(i => i.post.dateKey === DAY9.slice(0, 10)).length === npc9.length - 1), JSON.stringify(day9.map(i => i.post.id)));
check('최신 순으로 쌓인다', N().localPosts[0].post.createdAt >= N().localPosts[1].post.createdAt, '');

// ── 글쓰기 화면이 열려 있는 동안은 올리지 않는다 · '컷 고치기' 뒤 닫고 나가면 자기 전에 그대로 올린다 (SNS_SPEC §8) ──
console.log('\n── 글쓰기 화면 열림 · 컷 고치기 뒤 방치 ──');
setNpcBaker(null);
const P1 = hex('d').slice(0, 30) + '01';
const DAY10 = await prepDay(21, 0, [P1], { days: 9 });
const before10 = posts().length;
S().askPostNow();
const req10 = S().requests.find(r => r.kind === 'post' && r.refId === N().draft?.id);
N().setSnsOpen(true); N().setComposeOpen(true);   // 주인이 초안을 열어 손보는 중 (답은 아직)
S().tick(); S().jumpBy(16 * MIN); S().tick(); await sleep(30);
const r10 = S().requests.find(r => r.id === req10.id);
check('마감이 지나 혼자 정했어도 글쓰기 화면이 열려 있으면 올리지 않는다', r10?.decidedAlone === true && posts().length === before10 && S().agentPost.pending?.draftId === req10.refId, JSON.stringify([r10?.decidedAlone, posts().length - before10]));
N().setSnsOpen(false);
check('SNS를 닫으면 글쓰기·프로필도 접힌다', N().composeOpen === false && N().profileOpen === null, JSON.stringify([N().composeOpen, N().profileOpen]));
S().tick(); await sleep(30);
check('닫고 나면 그 tick에 올린다', posts().length === before10 + 1 && posts()[before10].body.cuts.map(c => c.shotId).join() === P1 && S().agentPost.lastPostDay === DAY10, JSON.stringify([posts().length - before10, S().agentPost]));

const Q1 = hex('e').slice(0, 30) + '02';
const DAY11 = await prepDay(21, 0, [Q1], { days: 10 });
const before11 = posts().length;
S().askPostNow();
const req11 = S().requests.find(r => r.kind === 'post' && r.refId === N().draft?.id);
S().answerRequest(req11.id, 'edit'); await sleep(10);
N().setSnsOpen(false);   // 글쓰기 화면을 닫고 나갔다 — 올리지도 버리지도 않은 채
S().tick(); await sleep(30);
check("'컷 고치기'라 답하고 닫고 나가면 낮에는 기다린다", relaxedWindow(S().phase) !== 'bedtime' && posts().length === before11 && S().agentPost.pending?.draftId === req11.refId, JSON.stringify([relaxedWindow(S().phase), posts().length - before11]));
S().jumpTo(dayStart + 10 * 86400_000 + 23 * 3600_000 + 56 * MIN); S().tick(); await sleep(30);
check('자기 전 창이 오면 그대로 올린다 — 하루 1글', relaxedWindow(S().phase) === 'bedtime' && posts().length === before11 + 1 && posts()[before11].body.cuts.map(c => c.shotId).join() === Q1 && S().agentPost.lastPostDay === DAY11 && S().agentPost.pending === undefined && N().draft === null, JSON.stringify([relaxedWindow(S().phase), posts().length - before11, S().agentPost]));

// ── 사용자가 없으면 초안도 물음도 없다 · 자정 15분 전에 물은 초안은 날이 바뀌어도 그대로 올린다 (하루 1글은 그날 것이라 다음 날 몫은 그대로) ──
console.log('\n── 사용자 없음 · 자정을 넘긴 물음 ──');
const S1 = hex('f').slice(0, 30) + '03';
const DAY13 = await prepDay(23, 50, [S1], { days: 12 });
const before13 = posts().length;
const reqs13 = S().requests.filter(r => r.kind === 'post').length;
const savedUser = storage.get('theworld.user.v1');
storage.delete('theworld.user.v1');
S().tick(); await sleep(20);
check('사용자가 없으면(오프라인) 여유 있는 창이어도 초안·쪽지·글이 없다', !!relaxedWindow(S().phase) && S().agentPost.pending === undefined && S().requests.filter(r => r.kind === 'post').length === reqs13 && posts().length === before13, JSON.stringify([relaxedWindow(S().phase), S().agentPost.pending]));
storage.set('theworld.user.v1', savedUser);
S().askPostNow();
const req13 = S().requests.find(r => r.kind === 'post' && r.refId === N().draft?.id);
check('자정 15분 전에 물었다 — 마감은 자정 뒤', !!req13 && req13.dueAt > dayEndOfKey(DAY13), JSON.stringify([req13?.dueAt, dayEndOfKey(DAY13)]));
S().tick(); S().jumpBy(16 * MIN); S().tick(); await sleep(30);
const DAY14 = S().today;
const r13 = S().requests.find(r => r.id === req13.id);
check('날이 바뀌었고 마감을 넘겼다 — 초안을 버리지 않고 그대로 올린다 (어제 날짜로), "올렸어" 한 줄', DAY14 !== DAY13 && r13?.decidedAlone === true && posts().length === before13 + 1 && posts()[before13].body.dateKey === DAY13.slice(0, 10) && posts()[before13].body.cuts.map(c => c.shotId).join() === S1 && S().agentPost.pending === undefined && N().draft === null && S().messages.some(m => m.id === `post:${hex32(before13 + 1)}`), JSON.stringify([DAY14, r13?.decidedAlone, posts().length - before13, S().agentPost]));
check('어제 초안이라 오늘(새 날) 몫은 그대로 — lastPostDay는 오늘이 아니다', S().agentPost.lastPostDay !== DAY14 && S().agentPost.lastPostAt === S().now, JSON.stringify(S().agentPost));
const S2 = hex('f').slice(0, 30) + '04';
await prepDay(23, 56, [S2], { days: 13 });
S().tick(); await sleep(30);
check('그 날 자기 전 창에서 오늘 글을 또 올린다', posts().length === before13 + 2 && posts()[before13 + 1].body.cuts.map(c => c.shotId).join() === S2 && S().agentPost.lastPostDay === DAY14, JSON.stringify([posts().length - before13, S().agentPost.lastPostDay, DAY14]));

console.log(`\n${n - fails.length}/${n} checks passed`);
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
