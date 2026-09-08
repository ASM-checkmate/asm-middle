// 부팅 harness (ADR-0013 결정 4) — 앱을 꺼 둔 사이 시각이 지난 약속 전화는 켤 때 부재중으로 접힌다 (내용 없음),
// 잠깐 껐다 켠 것이면 첫 tick이 그대로 울린다, 다른 기기에서 받아 온 저장본(마지막으로 본 시각 없음)도 접힌다.
// 스토어는 import 때 한 번 만들어지므로 경우마다 프로세스 하나다.
// Usage: node scripts/sim-boot.test.mjs   (exit 1 on any failed check)
import './ts-hooks.mjs';
import { execFileSync } from 'node:child_process';

const mode = process.argv[2] ?? 'away';
const storage = new Map();
globalThis.localStorage = {
  getItem: k => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k),
  clear: () => storage.clear(),
};

const KST = (y, m, d, h, mi = 0) => Date.UTC(y, m - 1, d, h - 9, mi);
const T0 = KST(2026, 9, 8, 16, 0);
storage.set('theworld.clock.v1', JSON.stringify({ anchorReal: Date.now(), anchorSim: T0, scale: 0 }));
// 마지막으로 본 시각: 3시간 전(away) / 3분 전(quick) / 없음(noseen — 로그인·새 기기로 받아 온 저장본)
if (mode !== 'noseen') storage.set('theworld.seen.v3', JSON.stringify(mode === 'away' ? T0 - 3 * 3600_000 : T0 - 3 * 60_000));
storage.set('theworld.world.v5', JSON.stringify({
  v: 5,
  // 받은 채로 앱이 꺼진 통화 — 끊은 것으로 접혀야 한다
  calls: [{ id: 'out:hung', at: T0 - 2 * 3600_000, dir: 'out', result: 'answered', startedAt: T0 - 2 * 3600_000, lines: ['야'] }],
  dueCalls: [
    // 비운 사이 지났다 — quick은 2분 전(잠깐 비운 사이라 첫 tick이 울린다), 나머지는 1시간 전(약속 자체가 오래돼 접힌다)
    { id: 'worry:old', at: mode === 'quick' ? T0 - 2 * 60_000 : T0 - 60 * 60_000, why: 'worry', worry: 'work' },
    { id: 'ask:soon', at: T0 + 60_000, why: 'ask' },                          // 아직 안 왔다
  ],
}));

const fails = [];
let n = 0;
const check = (name, ok, detail = '') => { n++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };

const { useWorld } = await import('../src/sim/store.ts');
const S = () => useWorld.getState();

if (mode === 'away' || mode === 'noseen') {
  console.log(mode === 'away' ? '\n── 오래 비운 뒤 켬 ──' : '\n── 마지막으로 본 시각이 없는 저장본 (다른 기기·재로그인) ──');
  const missed = S().calls.find(c => c.id === 'in:worry:old');
  check('지난 약속 전화는 부재중으로 접힌다', !!missed && missed.dir === 'in' && missed.result === 'missed' && missed.why === 'worry', JSON.stringify(S().calls));
  check('부재중에는 내용이 없다', missed?.lines === undefined, JSON.stringify(missed));
  check('기록 시각은 약속한 시각이다', missed?.at === T0 - 60 * 60_000, String(missed?.at));
  check('켜자마자 벨은 안 울린다', S().activeCall === null, JSON.stringify(S().activeCall));
  check('아직 안 온 약속은 남는다', S().dueCalls.length === 1 && S().dueCalls[0].id === 'ask:soon', JSON.stringify(S().dueCalls));
  S().tick();
  check('첫 tick에도 지난 약속이 되살아나지 않는다', S().activeCall === null && S().calls.filter(c => c.id === 'in:worry:old').length === 1, JSON.stringify(S().calls));
  check('저장본에도 접힌 채 남는다', JSON.parse(storage.get('theworld.world.v5')).dueCalls.length === 1, storage.get('theworld.world.v5'));
  const hung = S().calls.find(c => c.id === 'out:hung');
  check('받은 채로 꺼진 통화는 끊은 것으로 접힌다', typeof hung?.durSec === 'number' && hung.durSec >= 1 && hung.durSec <= 3600, JSON.stringify(hung));
} else {
  console.log('\n── 잠깐 껐다 켬 ──');
  check('접지 않는다', !S().calls.some(c => c.id === 'in:worry:old') && S().dueCalls.length === 2, JSON.stringify(S().dueCalls));
  S().tick();
  check('첫 tick에 그대로 울린다', S().activeCall?.id === 'in:worry:old' && Array.isArray(S().activeCall.lines), JSON.stringify(S().activeCall));
}

if (mode === 'away') {
  // 나머지 경우는 자식 프로세스로 — 종료 코드가 신호다 (실패하면 throw). 출력은 그대로 이어 붙인다
  for (const child of ['quick', 'noseen']) {
    let out = '';
    try { out = execFileSync(process.execPath, [process.argv[1], child], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'inherit'] }); }
    catch (e) { out = e.stdout ?? ''; fails.push(child); }
    process.stdout.write(out);
  }
}

console.log(`\n${n - fails.length}/${n} checks passed${mode === 'away' ? ' (+ quick, noseen)' : ''}`);
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
