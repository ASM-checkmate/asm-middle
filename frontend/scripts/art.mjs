// 그림 레시피 — 캐릭터 프레임과 방 그림의 **프롬프트·참고 그림 순서**를 한 군데에 모아 두고, art/gen/manifest.json 을 찍어낸다.
// 사용자가 방 사진을 주면 여기 규칙대로 화풍을 바꾸고 장면까지 같은 순서로 받으면 된다.
//
//   node scripts/art.mjs plan                 매니페스트만 다시 찍는다 (무엇이 있고 무엇이 없는지 같이 보여 준다)
//   node scripts/art.mjs char                 캐릭터 프레임 받기 (방과 무관 — 한 번만)
//   node scripts/art.mjs room <방>            그 방의 그림 다 받기
//   node scripts/art.mjs room <방> --step style   화풍 바꾼 방 한 장만 (먼저 보고 판단하려고)
//   node scripts/art.mjs room <방> --force     이미 있어도 다시 받기
//
// 새 방을 더하는 순서
//   1. 사진을 art/in/<방>.png 로 두고 art/rooms.json 에 방을 적는다 (photo·names·walk·zones·home)
//   2. node scripts/art.mjs room <방> --step style   → 화풍 바꾼 방을 보고, 마음에 들 때까지 --force 로 다시
//   3. node scripts/art.mjs room <방>                 → 장면 그림까지 다 받는다
//   4. python3 scripts/room-build.py <방>             → public/rooms/<방> 로 굽는다
//   5. 방 랩(`?lab=room`)에서 "디버그"를 켜고 walk·zones 좌표를 맞춘 뒤 3~4 를 다시
//
// ── 여기까지 오며 배운 것 (프롬프트에 그대로 박혀 있다) ──────────────────────────────────
// · 바꿀 곳을 좁힐수록 나머지가 안 흔들린다. "방만 참고로 주고 자세를 글로 이르면" 모델이 얼굴·몸을 제 나름대로 다시 그린다.
// · 그래서 참고 그림은 **가장 가까운 좋은 장**을 준다. 예: 이불 당기는 칸은 방이 아니라 '이불 덮고 눈 뜬 칸'에서 손만 바꾼다.
// · 사람이 나오는 칸엔 늘 char-front 를 같이 줘서 얼굴이 안 바뀌게 한다 (눈 모양·눈동자 자리·하이라이트까지 짚어 준다).
// · 바깥에서 받은 사진을 직접 "침대만 빼" 로 고치면 구도를 다시 잡아 버린다 — 화풍만 바꿔 **모델이 그린 방**을 만든 뒤 그걸 고친다.
// · 몸이 침대 밖으로 나가거나 이불이 바닥까지 흐르는 사고가 잦아 "침대 위에 머물 것"을 늘 조건으로 붙인다.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOMS = JSON.parse(readFileSync('art/rooms.json', 'utf8')).rooms;
const OUT = 'art/gen';
const has = n => ['png', 'jpg'].some(e => existsSync(`${OUT}/${n}.${e}`));

// ── 캐릭터: 초록 배경에 같은 프레이밍으로. 방과 무관해 한 번만 받으면 모든 방이 같이 쓴다 ──────────────
const GREEN = 'Flat solid pure green background (#00FF00), no ground shadow, no text, no labels, no watermark.';
const CLAY = 'Rendered in exactly the same 3D clay / claymation style as the reference character (soft matte clay textures, rounded shapes, soft even studio lighting).';
const KEEP_CHAR = 'Keep everything exactly identical to the reference image — same character, face, hair, clothes, body proportions, camera distance, framing, lighting and the flat pure green background. Only change: ';

const CHAR = [
  { name: 'char-front', refs: ['art/character/base.png'],
    prompt: `Full-body front view of exactly this character, standing straight in a relaxed A-pose with arms slightly away from the body, head to toe fully visible, centered. She wears a cream short-sleeve V-neck shirt, loose gray wide-leg drawstring pants and gray strap sandals. No bag. ${GREEN} ${CLAY}` },
  // 서 있기: 눈 깜빡임·고개 갸웃 (RoomLab 의 IDLE 이 이 두 장을 아주 잠깐만 쓴다)
  { name: 'idle-2', refs: ['char-front'], prompt: KEEP_CHAR + 'her eyes are closed as if blinking, everything else the same.' },
  { name: 'idle-3', refs: ['char-front'], prompt: KEEP_CHAR + 'her head is tilted slightly to one side with a small smile, everything else the same.' },
  // 앞으로 걷기 다섯 칸 — 뒷반쪽은 밀기·뻗기를 좌우 뒤집어 쓴다 (Sprite 의 FRONT_WALK)
  { name: 'walk-front-1', refs: ['char-front'], prompt: KEEP_CHAR + 'she is walking straight toward the camera, mid-stride with her LEFT foot forward and planted, right foot behind lifting off the ground, arms swinging naturally (right arm forward, left arm back).' },
  { name: 'walk-front-push', refs: ['walk-front-1'], prompt: KEEP_CHAR + 'she is walking toward the camera: her weight is fully on her planted LEFT foot, her right foot is behind her with only the toes touching, heel lifted, about to push off; arms mid-swing.' },
  { name: 'walk-front-2', refs: ['walk-front-1'], prompt: KEEP_CHAR + 'she is walking toward the camera, in the passing pose: feet close together under her body, one knee slightly bent, arms near her sides.' },
  { name: 'walk-front-reach', refs: ['walk-front-1'], prompt: KEEP_CHAR + 'she is walking toward the camera: her RIGHT foot is swinging forward in the air just before landing, knee slightly bent, left foot planted behind; arms mid-swing.' },
  { name: 'walk-front-3', refs: ['walk-front-1'], prompt: KEEP_CHAR + 'she is walking toward the camera, mid-stride with her RIGHT foot forward and planted, left foot behind lifting off the ground, arms swinging naturally (left arm forward, right arm back).' },
  // 뒤로 걷기 (카메라에서 멀어지는 뒷모습)
  { name: 'pose-back', refs: ['char-front'], prompt: `Exactly this character seen from directly behind (back view), standing straight in the same relaxed A-pose, head to toe, centered, showing the back of her head with the two hair buns and the back of the same clothes. ${GREEN} ${CLAY}` },
  { name: 'walk-back-1', refs: ['pose-back'], prompt: KEEP_CHAR + 'seen from behind, she is walking away from the camera, mid-stride with her LEFT foot forward, right foot behind lifting, arms swinging naturally.' },
  { name: 'walk-back-2', refs: ['walk-back-1'], prompt: KEEP_CHAR + 'seen from behind, she is walking away from the camera, in the passing pose: feet close together under her body, arms near her sides.' },
  { name: 'walk-back-3', refs: ['walk-back-1'], prompt: KEEP_CHAR + 'seen from behind, she is walking away from the camera, mid-stride with her RIGHT foot forward, left foot behind lifting, arms swinging naturally.' },
];

// ── 방: 사진 → 화풍 바꾼 방 → 그 방 안의 장면들 ──────────────────────────────────────────
/** 방은 그대로 두고 사람만 바꾸라고 이를 때. 얼굴은 늘 짚어 준다 — 안 그러면 모델이 다시 그린다 */
const SAME_ROOM = 'Keep everything exactly identical to the first reference image — same room, camera, furniture, bedding, lighting and style. ';
const SAME_FACE = 'The character must look EXACTLY like the last reference image: identical face, eye shape and size, pupil position and the white highlight in each eye, identical eyebrows, nose and mouth, identical two hair buns and bangs, identical cream V-neck shirt and proportions. Do not redraw or restyle her face. ';
const ON_BED = ' Her legs and feet stay on the mattress and the blanket stays neatly on the bed — nothing hangs off the side or spills onto the floor.';

/** 장면 하나 = job 몇 개. 첫 칸만 방을 참고로 하고, 나머지는 **가장 가까운 좋은 칸**에서 조금만 바꾼다 */
const SCENE = {
  sleep: ({ room, scene, bed }) => [
    { name: `${room}-sleeping`, refs: [room, 'char-front'],
      prompt: SAME_ROOM + SAME_FACE + 'Only change: she is lying in the bed asleep on her back, head on the pillow, eyes closed, covered by the blanket up to her chest, her arms resting on top of the blanket. Nothing else in the room changes.' },
    { name: `${scene}-sleep-2`, refs: [`${room}-sleeping`],
      prompt: SAME_ROOM + 'Only change: she has rolled her head slightly to her right on the pillow and her mouth is slightly open, still asleep; the blanket rises a little over her chest as she breathes in.' },
    // 눕는 길 — 뒤에서 앞으로 거슬러 만든다: 눈 뜬 칸을 먼저 받고, 당기는 칸과 앉은 칸은 그 칸에서 손·이불만 바꾼다 (얼굴이 안 흔들리게)
    { name: `${bed}-awake`, refs: [`${room}-sleeping`, 'char-front'],
      prompt: SAME_ROOM + SAME_FACE + 'Only change: she is lying on her back under the blanket, the blanket pulled up to her chest, EYES OPEN looking up at the ceiling, both arms resting on top of the blanket, settled and still.' + ON_BED },
    { name: `${bed}-pull`, refs: [`${bed}-awake`, 'char-front'],
      prompt: SAME_ROOM + SAME_FACE + 'Keep her lying flat on her back with her head on the pillow exactly as in the first reference. Only change this: the blanket is not yet up to her chest — it is only partway up around her waist, and both of her hands grip its top edge, caught mid-motion as she pulls it upward.' + ON_BED },
    { name: `${bed}-sit`, refs: [`${bed}-awake`, 'char-front'],
      prompt: SAME_ROOM + SAME_FACE + 'Only change: she is SITTING UP in the bed with her back against the headboard and pillows, facing the camera, legs stretched out along the bed. The blanket covers ONLY her legs from the waist down — her upper body and shirt are fully visible above it. Both hands grip the top edge of the blanket at her waist, just beginning to pull it up toward her neck. Eyes open and awake. Her legs and feet are COMPLETELY hidden under the blanket — no feet or toes poking out.' + ON_BED },
  ],
  makeup: ({ room, scene }) => [
    { name: `${scene}-makeup-1`, refs: [room, 'char-front'],
      prompt: SAME_ROOM + SAME_FACE + 'Only change: she is sitting on a small wooden stool in front of the dresser, turned toward the mirror so we see her from behind at a three-quarter angle, one hand raised holding a makeup brush to her cheek. Nothing else changes.' },
    { name: `${scene}-makeup-2`, refs: [`${scene}-makeup-1`],
      prompt: SAME_ROOM + 'Only change: she is now holding a small lipstick to her lips instead of the brush, the other hand resting on the dresser.' },
    { name: `${scene}-makeup-3`, refs: [`${scene}-makeup-1`],
      prompt: SAME_ROOM + 'Only change: both her hands are lowered onto the dresser and she leans slightly toward the mirror, looking at her reflection.' },
  ],
};

/** 사용자가 준 사진 → 캐릭터 화풍의 방. 사진을 직접 고치면 구도를 다시 잡아 버리니, 먼저 모델이 그린 방을 만든다 */
function styleJob(id, r) {
  return {
    name: r.names.room, refs: [r.photo, 'char-front'],
    prompt: 'Redraw this room in exactly the same art style, colors, line work and soft lighting as the SECOND reference image (the character). '
      + 'Keep the first reference image\'s layout and camera: same one-point perspective from a standing person\'s eye level, the same furniture in the same places '
      + '(bed against the back wall under the window, nightstands beside it, dresser with mirror on one side, door on the other, rug on the floor). '
      + 'The bottom third of the image must be empty floor where a character could stand. No people, no text, no watermark.',
  };
}

function roomJobs(id) {
  const r = ROOMS[id];
  if (!r) throw new Error(`art/rooms.json 에 '${id}' 방이 없다 (있는 것: ${Object.keys(ROOMS).join(', ')})`);
  const jobs = [];
  if (r.photo) jobs.push(styleJob(id, r));
  for (const s of r.scenes ?? []) jobs.push(...SCENE[s](r.names));
  return jobs;
}

// ── 매니페스트 찍기 ───────────────────────────────────────────────────────────────────
function plan() {
  const jobs = [...CHAR];
  for (const id of Object.keys(ROOMS)) if (!ROOMS[id].frozen) jobs.push(...roomJobs(id));
  const m = { out: OUT, model: 'gemini-3.1-flash-image', aspect: '2:3', size: '1K', jobs };
  writeFileSync(`${OUT}/manifest.json`, JSON.stringify(m, null, 2));
  return m;
}

const [cmd, arg] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flag = k => process.argv.includes(`--${k}`);
const opt = k => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : undefined; };

const m = plan();
const fetch = names => {
  const want = names.filter(n => flag('force') || !has(n));
  if (!want.length) return console.log('받을 게 없다 (다시 받으려면 --force)');
  console.log(`받을 것 ${want.length}장: ${want.join(', ')}`);
  execFileSync('node', ['scripts/nano-banana.mjs', `${OUT}/manifest.json`, '--only', want.join(','), ...(flag('force') ? ['--force'] : [])], { stdio: 'inherit' });
};

if (cmd === 'char') fetch(CHAR.map(j => j.name));
else if (cmd === 'room') {
  const jobs = roomJobs(arg);
  const step = opt('step');
  fetch(step === 'style' ? [jobs[0].name] : jobs.map(j => j.name));
} else {
  console.log(`매니페스트 ${m.jobs.length}개 → ${OUT}/manifest.json\n`);
  console.log('캐릭터', CHAR.map(j => (has(j.name) ? j.name : `${j.name}(없음)`)).join(' '));
  for (const id of Object.keys(ROOMS)) {
    const r = ROOMS[id];
    if (r.frozen) { console.log(`\n[${id}] ${r.ko} — 굳혀 둠: ${r.frozen}`); continue; }
    console.log(`\n[${id}] ${r.ko}`, roomJobs(id).map(j => (has(j.name) ? j.name : `${j.name}(없음)`)).join(' '));
  }
  console.log('\nnode scripts/art.mjs char | room <방> [--step style] [--force]');
}
