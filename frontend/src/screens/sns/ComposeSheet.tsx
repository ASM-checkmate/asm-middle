import { useEffect, useMemo, useState } from 'react';
import { useSns } from '../../sim/sns';
import { useWorld } from '../../sim/store';
import { MAX_CAPTION, MAX_CUTS, type Post, type PostCut, type PostDraft, type PostIn } from '../../sim/posts';
import type { Comic } from '../../sim/types';
import { flushUploads, isUploaded } from '../../sim/media';
import { PLACES, placeById } from '../../sim/places';
import { PhotoImg } from '../../photo/PhotoImg';
import { Button, Glyph } from '../../ui';
import { BookOverlay } from '../BookOverlay';
import { comicOfCut, moveCut, withSubject } from './util';

type Step = 'pick' | 'caption';

/**
 * 글쓰기 = 책의 고르기 모드 (SNS_SPEC §7): 책 그대로(검색·칩·일/주)에 고르기만 얹고, 아래 트레이에 고른 컷이 번호 순으로 쌓인다(◀▶로 순서).
 * 다음 → 캡션(초안이 미리 들어옴) → 동행은 자동(첫 컷 활동의 companions, 뺄 수만 있음) → 올리기.
 * 서버가 받아 주는 컷은 올라간 것뿐(`cut not yours`) — 안 올라간 컷은 '업로드 중…'으로 두고 올리기를 막는다(빼는 버튼 있음).
 * 초안(draft)이 있으면 그 컷이 미리 골라진 채 열리고, 기존 글(edit)이면 그 글의 컷·캡션으로 열려 editPost.
 * 씨앗(초안·글)은 **열 때 한 번** 읽는다 — 고치는 사이 스토어가 초안을 비워도(엔진이 올림·버림) 손보던 것이 날아가지 않는다.
 * 기존 글의 컷은 서버가 이미 가진 것이라 업로드 여부를 묻지 않는다 (다른 기기에서 찍었거나 캐시에서 지워진 컷도 실을 수 있다).
 */
export function ComposeSheet({ draft: draftIn, edit, comics, uploadedTick, onClose, onDone }: {
  draft: PostDraft | null;
  edit: Post | null;
  /** 프리뷰가 주는 가짜 책 — 없으면 스토어의 책 */
  comics?: Comic[];
  uploadedTick: number;
  onClose: () => void;
  onDone: (p: Post) => void;
}) {
  const book = useWorld(s => s.book);
  const timeline = useWorld(s => s.timeline);
  const memory = useWorld(s => s.memory);
  const resolvePostDraft = useWorld(s => s.resolvePostDraft);
  const publishPost = useSns(s => s.publishPost);
  const editPost = useSns(s => s.editPost);
  const setDraft = useSns(s => s.setDraft);
  const list = useMemo(() => comics ?? [...book].reverse(), [comics, book]);

  // 초안은 열 때의 것 — 그 뒤 useSns.draft가 null이 돼도(엔진이 올렸거나 주인이 버림) 이 화면의 컷·캡션은 그대로다
  const [draft] = useState(draftIn);
  const seed = edit ?? draft;
  const [step, setStep] = useState<Step>(seed ? 'caption' : 'pick');
  const [cuts, setCuts] = useState<PostCut[]>(seed ? seed.cuts.slice(0, MAX_CUTS) : []);
  const [caption, setCaption] = useState(seed?.caption ?? '');
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // 열자마자 줄 선 사진을 올린다 — 서버가 받아 준 컷만 글에 실을 수 있다
  useEffect(() => { void flushUploads(); }, []);
  void uploadedTick;

  const first = cuts[0];
  const comic = comicOfCut(list, first);
  /** 동행은 첫 컷 활동의 companions에서만 (SNS_SPEC §3) — 그 활동이 지평선 밖이면 초안·글의 것 */
  const act = first ? timeline.find(a => a.key === first.actKey) : undefined;
  const auto = act?.companions ?? seed?.companions ?? [];
  const companions = auto.filter(id => !removed.has(id));
  const nameOf = (id: string) => memory.friends.find(f => f.id === id)?.name ?? id;

  /** 서버가 가진 컷인가 — 올라간 것, 또는 고치는 글에 이미 실려 있던 것 (그건 서버가 준 것이다) */
  const owned = (shotId: string) => isUploaded(shotId) || !!edit?.cuts.some(c => c.shotId === shotId);
  const waiting = cuts.filter(c => !owned(c.shotId));
  const canPost = cuts.length > 0 && waiting.length === 0 && !busy;

  const facets = (): Pick<PostIn, 'place' | 'area' | 'city' | 'category' | 'dateKey'> => {
    if (comic) {
      const p = PLACES.find(x => x.name === comic.placeName);
      return { place: comic.placeName, area: comic.area ?? p?.area ?? '어딘가', city: comic.city ?? p?.city ?? homeCity(), ...(comic.category ? { category: comic.category } : {}), dateKey: comic.dateKey };
    }
    if (seed) return { place: seed.place, area: seed.area, city: seed.city, ...(seed.category ? { category: seed.category } : {}), dateKey: seed.dateKey };
    let home = { name: '어딘가', area: '어딘가' };
    try { home = placeById(memory.homePlaceId); } catch { /* 집을 모르면 '어딘가' */ }
    return { place: home.name, area: home.area, city: homeCity(), dateKey: first?.actKey.split('@')[0] ?? '' };
  };
  const homeCity = () => { try { return placeById(memory.homePlaceId).city; } catch { return 'seoul'; } };

  const submit = async () => {
    if (!canPost) return;
    setBusy(true); setErr('');
    const cap = caption.slice(0, MAX_CAPTION);
    if (edit) {
      const p = await editPost(edit.id, { cuts, caption: cap });
      setBusy(false);
      if (!p) { setErr('고치지 못했어요. 잠시 뒤 다시 해 볼게요'); return; }
      onDone(p);
      return;
    }
    const changed = !draft || cap !== draft.caption || cuts.length !== draft.cuts.length || cuts.some((c, i) => c.shotId !== draft.cuts[i]?.shotId);
    const body: PostIn = { cuts, caption: cap, ...facets(), companions, editedByOwner: changed };
    const p = await publishPost(body);
    setBusy(false);
    if (!p) { setErr('올리지 못했어요. 서버가 안 보이거나 아직 안 올라간 컷이 있어요'); return; }
    if (draft) resolvePostDraft(draft.id, 'posted', p.id);
    setDraft(null);
    onDone(p);
  };

  return (
    <div className="sns-sheet sns-compose" role="dialog" aria-label={edit ? '글 고치기' : '글쓰기'}>
      {step === 'pick' ? (
        <>
          <BookOverlay onClose={onClose} comics={comics} pick={{ selected: cuts, onChange: setCuts, max: MAX_CUTS }} />
          <div className="sns-tray">
            <div className="sns-tray-list">
              {cuts.length === 0 && <span className="sns-tray-hint">컷을 탭하면 여기 쌓여요 · 최대 {MAX_CUTS}장</span>}
              {cuts.map((c, i) => (
                <span key={`${c.shotId}:${i}`} className={`sns-thumb ${owned(c.shotId) ? '' : 'is-wait'}`}>
                  <PhotoImg shotId={c.shotId}><span className="sns-cut-empty" /></PhotoImg>
                  <i className="num">{i + 1}</i>
                  <span className="sns-thumb-mv">
                    <button type="button" aria-label="앞으로" disabled={i === 0} onClick={() => setCuts(moveCut(cuts, i, -1))}>◀</button>
                    <button type="button" aria-label="빼기" onClick={() => setCuts(cuts.filter((_, k) => k !== i))}><Glyph name="close" size={11} /></button>
                    <button type="button" aria-label="뒤로" disabled={i === cuts.length - 1} onClick={() => setCuts(moveCut(cuts, i, 1))}>▶</button>
                  </span>
                </span>
              ))}
            </div>
            <Button tone="ink" small className="sns-tray-next" disabled={cuts.length === 0} onClick={() => setStep('caption')}>다음</Button>
          </div>
        </>
      ) : (
        <div className="book sns-cap-step">
          <div className="book-hd">
            {!edit && <Button round ariaLabel="컷 고르기로" onClick={() => setStep('pick')}><Glyph name="back" /></Button>}
            <h2>{edit ? '글 고치기' : '글쓰기'}<small className="num">{comic ? `${comic.dateKey} · ${comic.placeName}` : facets().place}</small></h2>
            <Button round ariaLabel="닫기" onClick={onClose}><Glyph name="close" /></Button>
          </div>
          <div className="sns-cap-body">
            <div className="sns-thumbs">
              {cuts.map((c, i) => (
                <button type="button" key={`${c.shotId}:${i}`} className={`sns-thumb ${owned(c.shotId) ? '' : 'is-wait'}`} onClick={() => setStep('pick')} aria-label={`${i + 1}번째 컷 (고르기로)`}>
                  <PhotoImg shotId={c.shotId}><span className="sns-cut-empty" /></PhotoImg>
                  <i className="num">{i + 1}</i>
                  {!owned(c.shotId) && <em>업로드 중…</em>}
                </button>
              ))}
              {!edit && <button type="button" className="sns-thumb sns-thumb--add" onClick={() => setStep('pick')} aria-label="컷 더 고르기">＋</button>}
            </div>
            {waiting.length > 0 && (
              <p className="sns-hint sns-hint--warn">
                아직 안 올라간 컷 {waiting.length}장 — 올라가면 바로 올릴 수 있어요.
                <button type="button" className="btn btn--text" onClick={() => setCuts(cuts.filter(c => owned(c.shotId)))}>그 컷 빼기</button>
              </p>
            )}
            <label className="sns-cap-field">
              <textarea value={caption} maxLength={MAX_CAPTION} rows={4} placeholder="한 줄 남겨요" aria-label="캡션" onChange={e => setCaption(e.target.value.slice(0, MAX_CAPTION))} />
              <small className="num">{caption.length} / {MAX_CAPTION}</small>
            </label>
            {!edit && (
              <div className="sns-tags">
                {companions.length === 0
                  ? <span className="sns-hint">같이 논 사람이 없어요 — 동행은 활동에서만 붙어요</span>
                  : companions.map(id => (
                    <span key={id} className="chip chip--paper2 chip--tiny sns-tag">
                      {withSubject(nameOf(id))} 태그됨
                      <button type="button" aria-label={`${nameOf(id)} 태그 빼기`} onClick={() => setRemoved(new Set([...removed, id]))}><Glyph name="close" size={11} /></button>
                    </span>
                  ))}
              </div>
            )}
            {err && <p className="sns-hint sns-hint--warn">{err}</p>}
          </div>
          <div className="sns-cap-ft">
            <Button tone="coral" disabled={!canPost} onClick={() => void submit()}>{busy ? '올리는 중…' : edit ? '고친 대로 올리기' : '올리기'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
