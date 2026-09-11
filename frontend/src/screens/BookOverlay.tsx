import { useMemo, useState } from 'react';
import { useWorld } from '../sim/store';
import type { Category, Comic } from '../sim/types';
import { CATEGORIES, blockDef, categoryDef } from '../sim/blocks';
import { dateKeyIn } from '../sim/tz';
import { Character } from '../character';
import { Button, Chip, Glyph } from '../ui';
import { PLACES, cityNameKo } from '../sim/places';
import { companionsOf, encounterOf } from '../sim/timeline';
import { ComicPanels, ShotsLine } from './ComicScreen';
import { beatPose, bookIntent, castOf, shotCount } from './util';
import { PhotoImg } from '../photo/PhotoImg';
import type { PostCut } from '../sim/posts';
import { currentUser } from '../sim/api';
import { switchUser } from '../sim/sync';
import { cutOfPanel } from './sns/util';

type Group = 'day' | 'week';

/** 고르기 모드 (SNS_SPEC §7 글쓰기): 컷을 탭하면 번호가 붙는다. 순서 = 고른 순서. 구운 컷(shotId)만 고를 수 있다 */
export interface BookPick { selected: PostCut[]; onChange(next: PostCut[]): void; max: number }
const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

/** "2026-09-08" → 그 날 정오의 UTC ms. dateKey는 캐릭터가 산 날짜라 시간대 없이 날짜 산수만 한다 */
const dayMs = (dateKey: string) => { const [y, m, d] = dateKey.split('-').map(Number); return Date.UTC(y, m - 1, d, 12); };
const keyOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const mdKo = (dateKey: string) => { const d = new Date(dayMs(dateKey)); return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`; };
/** 월요일 시작 주의 첫 날 */
const weekStartOf = (dateKey: string) => { const ms = dayMs(dateKey); const wd = (new Date(ms).getUTCDay() + 6) % 7; return keyOf(ms - wd * 86_400_000); };

/** 검색은 띄어쓰기·대소문자를 무시한다 ("망원 한강" = "망원한강") */
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

/** The book: every comic, newest first. Search by place/activity/name, filter by category, grouped by day or week (ADR-0016).
 *  `pick`이 있으면 고르기 모드 — 상세는 안 열리고 컷 하나하나가 버튼이다 (SNS_SPEC §7). */
export function BookOverlay({ onClose, comics, pick }: { onClose: () => void; comics?: Comic[]; pick?: BookPick }) {
  const book = useWorld(s => s.book);
  const memory = useWorld(s => s.memory);
  const tz = useWorld(s => s.tz);
  const now = useWorld(s => s.now);
  const timeline = useWorld(s => s.timeline);
  const list = comics ?? [...book].reverse();
  const [openId, setOpenId] = useState<string | null>(() => {
    const id = bookIntent.comicId;
    bookIntent.comicId = null;
    return id && !pick && list.some(c => c.id === id) ? id : null;
  });
  /** 서버에 들어와 있는 아이디 — 없으면(오프라인) 로그아웃 줄을 그리지 않는다. 옛 친구 목록 맨 아래에서 옮겨 왔다 (SNS_SPEC §1) */
  const me = currentUser();
  const pickIndex = (shotId: string) => (pick ? pick.selected.findIndex(c => c.shotId === shotId) : -1);
  const togglePick = (c: Comic, i: number) => {
    if (!pick) return;
    const cut = cutOfPanel(c, i);
    if (!cut) return;
    const at = pickIndex(cut.shotId);
    if (at >= 0) pick.onChange(pick.selected.filter((_, k) => k !== at));
    else if (pick.selected.length < pick.max) pick.onChange([...pick.selected, cut]);
  };
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<Category | null>(null);
  const [group, setGroup] = useState<Group>('day');

  const cur = openId ? list.find(c => c.id === openId) ?? null : null;
  // 누가 찍었나 — 옛 만화(by 없음)는 전부 에이전트로 센다 (util.shotCount)
  const curShots = cur ? shotCount(cur) : null;
  // 사용자 컷을 찍었을 때의 옵션(포즈)·동행·마주침은 만화에 없다 — 타임라인의 그 활동에서 되찾아 ComicScreen과 같은 그림이 나오게 한다.
  // 지평선 밖으로 밀려난(KEEP_DAYS 지난) 옛 만화는 비트 포즈·컷의 withFriend로 대신한다
  const curAct = cur ? timeline.find(a => `c:${a.key}` === cur.id) : undefined;
  const cast = curAct ? castOf(companionsOf(curAct, memory), encounterOf(curAct, memory)) : undefined;
  /** "2026-09-03 · 오전 블록 · 연남동" — the real 동네 (the comic only carries the place name) */
  const meta = (c: Comic) => `${c.dateKey} · ${blockDef(c.blockId).label} 블록 · ${c.area ?? PLACES.find(p => p.name === c.placeName)?.area ?? c.placeName}`;

  /** 검색·필터가 보는 면 — 새 만화는 자기가 들고 있고, 옛 만화는 타임라인에 아직 있으면 거기서, 없으면 장소 표에서 되찾는다 */
  const facets = useMemo(() => {
    const m = new Map<string, { category: Category | null; hay: string }>();
    for (const c of list) {
      const act = c.category ? undefined : timeline.find(a => `c:${a.key}` === c.id);
      const place = PLACES.find(p => p.name === c.placeName);
      const category = c.category ?? act?.option.category ?? null;
      const names = c.withNames ?? (act ? [...companionsOf(act, memory).map(f => f.name), ...(encounterOf(act, memory)?.talked ? [encounterOf(act, memory)!.agent.name] : [])] : []);
      const city = c.city ?? place?.city;
      const hay = norm([
        c.title, c.summary, c.placeName, c.area ?? place?.area, city && cityNameKo(city), city,
        c.activity ?? act?.option.title, category && categoryDef(category).label, ...names, ...c.panels.map(p => p.caption),
      ].filter(Boolean).join(' '));
      m.set(c.id, { category, hay });
    }
    return m;
  }, [list, timeline, memory]);

  /** 칩은 책에 실제로 있는 범주만 */
  const cats = CATEGORIES.filter(k => list.some(c => facets.get(c.id)?.category === k.id));
  const q = norm(query);
  const shown = list.filter(c => {
    const f = facets.get(c.id)!;
    return (!cat || f.category === cat) && (!q || f.hay.includes(q));
  });

  /** 하루 / 주로 묶는다 — list가 최신순이라 묶음도 최신순 */
  const today = dateKeyIn(now, tz);
  const yesterday = keyOf(dayMs(today) - 86_400_000);
  const thisWeek = weekStartOf(today);
  const lastWeek = keyOf(dayMs(thisWeek) - 7 * 86_400_000);
  const labelOf = (key: string) => {
    if (group === 'day') {
      const d = new Date(dayMs(key));
      const md = `${mdKo(key)} ${WEEKDAY_KO[d.getUTCDay()]}요일`;
      return key === today ? `오늘 · ${md}` : key === yesterday ? `어제 · ${md}` : md;
    }
    const end = keyOf(dayMs(key) + 6 * 86_400_000);
    const range = `${mdKo(key)} ~ ${mdKo(end)}`;
    return key === thisWeek ? `이번 주 · ${range}` : key === lastWeek ? `지난주 · ${range}` : range;
  };
  const groups: { key: string; items: Comic[] }[] = [];
  for (const c of shown) {
    const key = group === 'day' ? c.dateKey : weekStartOf(c.dateKey);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(c);
    else groups.push({ key, items: [c] });
  }
  const filtering = !!q || !!cat;

  return (
    <div className="book" role="dialog" aria-label="book">
      <div className="book-hd">
        {cur && <Button round ariaLabel="목록으로" onClick={() => setOpenId(null)}><Glyph name="back" /></Button>}
        <h2>
          {cur ? cur.title : pick ? '컷 고르기' : 'book'}
          <small className="num">{cur ? meta(cur) : pick ? `${pick.selected.length} / ${pick.max}${filtering ? ` · ${shown.length}개 찾음` : ''}` : filtering ? `${shown.length}개 찾음 · 전체 ${list.length}개` : `${list.length}개의 이야기`}</small>
        </h2>
        {/* 아침에 그린 그림 (ADR-0004) — 상세 헤더에 40px 썸네일 */}
        {cur?.sketch && <img className="book-sketch" src={cur.sketch} alt="아침에 그린 그림" title="아침에 그린 것" draggable={false} />}
        <Button round ariaLabel="닫기" onClick={onClose}><Glyph name="close" /></Button>
      </div>
      {cur ? (
        <div className="book-view">
          <ComicPanels comic={cur} option={curAct?.option} friendColor={cast?.friendColor ?? memory.friends[0]?.color} tz={tz} cast={cast} />
          {curShots && <ShotsLine className="book-shots" shots={curShots} name={memory.name} />}
          <p className="book-sum">{cur.summary}</p>
        </div>
      ) : list.length === 0 ? (
        <div className="book-empty">
          <Character pose="think" size={170} />
          <span>아직 이야기가 없어요<br />캐릭터가 다녀오면 여기에 쌓여요</span>
        </div>
      ) : (
        <>
          <div className="book-tools">
            <div className="book-tools-row">
              <div className="book-search">
                <input
                  type="search"
                  className="book-q"
                  value={query}
                  placeholder="장소 · 활동 · 이름으로 찾기"
                  aria-label="이야기 찾기"
                  enterKeyHint="search"
                  onChange={e => setQuery(e.target.value)}
                />
                {query && <button type="button" className="book-q-x" aria-label="지우기" onClick={() => setQuery('')}><Glyph name="close" size={14} /></button>}
              </div>
              <div className="book-seg" role="group" aria-label="묶기">
                <button type="button" className={group === 'day' ? 'is-on' : ''} onClick={() => setGroup('day')} aria-pressed={group === 'day'}>일</button>
                <button type="button" className={group === 'week' ? 'is-on' : ''} onClick={() => setGroup('week')} aria-pressed={group === 'week'}>주</button>
              </div>
            </div>
            <div className="book-chips" role="group" aria-label="범주">
              <Chip tone={cat ? 'paper' : 'sun'} on={!cat} onClick={() => setCat(null)}>전체</Chip>
              {cats.map(k => (
                <Chip key={k.id} tone={cat === k.id ? 'sun' : 'paper'} on={cat === k.id} onClick={() => setCat(cat === k.id ? null : k.id)}>{k.emoji} {k.label}</Chip>
              ))}
            </div>
          </div>
          {shown.length === 0 ? (
            <div className="book-empty">
              <Character pose="think" size={140} />
              <span>{q ? `'${query.trim()}'에 맞는 이야기가 없어요` : '이 범주의 이야기가 없어요'}</span>
              <Button tone="paper" small onClick={() => { setQuery(''); setCat(null); }}>다 보기</Button>
            </div>
          ) : (
            <div className="book-list">
              {groups.map(g => (
                <section key={g.key} className="book-group">
                  <h3 className="book-group-hd"><span>{labelOf(g.key)}</span><small className="num">{g.items.length}개</small></h3>
                  {g.items.map(c => pick ? (
                    // 고르기 모드: 카드는 버튼이 아니고 컷 하나하나가 버튼 — 구운 컷만 (없는 컷은 흐리게), 고르면 번호 달린 코랄 테
                    <div key={c.id} className="book-item book-item--pick">
                      <span className="book-meta num">{meta(c)}</span>
                      <b>{c.title}</b>
                      <div className="book-thumbs book-thumbs--pick">
                        {c.panels.map((p, i) => {
                          const n = p.shotId ? pickIndex(p.shotId) : -1;
                          return (
                            <button key={i} type="button" className={`book-pick ${p.by === 'user' ? 'is-user' : ''} ${n >= 0 ? 'is-picked' : ''} ${p.shotId ? '' : 'is-dim'}`} style={{ background: p.bg }} disabled={!p.shotId} aria-pressed={n >= 0} aria-label={`${i + 1}번째 컷${p.shotId ? '' : ' (아직 안 구움)'}`} onClick={() => togglePick(c, i)}>
                              {p.shotId ? <PhotoImg shotId={p.shotId}><Character pose={beatPose(p.beat)} size={40} /></PhotoImg> : <Character pose={beatPose(p.beat)} size={40} />}
                              {n >= 0 && <i className="book-pick-n num">{n + 1}</i>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <button key={c.id} type="button" className="book-item" onClick={() => setOpenId(c.id)}>
                      <span className="book-meta num">{meta(c)}</span>
                      <b>{c.title}</b>
                      <span>{c.summary}</span>
                      <div className="book-thumbs" aria-hidden="true">
                        {/* 사용자 컷은 코랄 테두리 (ADR-0004). 구운 컷(shotId)은 사진 그대로, 아니면 옛 30px 캐릭터 (ADR-0024) */}
                        {c.panels.map((p, i) => (
                          <i key={i} className={p.by === 'user' ? 'is-user' : undefined} style={{ background: p.bg }}>
                            {p.shotId ? <PhotoImg shotId={p.shotId}><Character pose={beatPose(p.beat)} size={30} /></PhotoImg> : <Character pose={beatPose(p.beat)} size={30} />}
                          </i>
                        ))}
                      </div>
                    </button>
                  ))}
                </section>
              ))}
              {/* 로그아웃·계정 전환 (SNS_SPEC §1): 책의 맨 아래. 이 기기의 하루·앨범·기억이 비워지니 한 번 묻는다 */}
              {me && !pick && <MeRow name={me.name} userId={me.userId} />}
            </div>
          )}
        </>
      )}
      {list.length === 0 && me && !pick && <MeRow name={me.name} userId={me.userId} />}
    </div>
  );
}

function MeRow({ name, userId }: { name: string; userId: string }) {
  return (
    <div className="book-me">
      <span className="book-me-who"><b>{name}</b><small className="num">{userId}</small></span>
      <Button small onClick={() => { if (confirm('다른 아이디로 들어갈까요? 이 기기의 하루·앨범·기억은 비워져요.')) void switchUser(); }}>로그아웃</Button>
    </div>
  );
}
