import { useEffect } from 'react';
import { useSns } from '../../sim/sns';
import { useWorld } from '../../sim/store';
import type { Post } from '../../sim/posts';
import { isUploaded } from '../../sim/media';
import { PhotoImg } from '../../photo/PhotoImg';
import { Character } from '../../character';
import { Button, Chip } from '../../ui';
import { AuthorHead } from './AuthorHead';
import { PostGrid } from './PostGrid';
import { homeAreaOf } from './lines';
import { draftToPostIn, withSubject } from './util';

/**
 * 내 글 탭 (SNS_SPEC §6 내 프로필 + §8 초안): 맨 위 내 프로필 줄(대표컷 · 이름 · 동네 · 공개 토글 · 성별 칩) → 초안 카드(있을 때) → 내 글 격자.
 * 대표컷 핀은 글을 열어 컷을 크게 볼 때 건다.
 * 초안의 '고치기'는 채팅의 '컷 고치기'와 같은 길이다 — 열려 있는 물음(쪽지)을 그 답으로 접고 나서 글쓰기 화면을 연다. 안 그러면 마감에 엔진이 등 뒤에서 올린다.
 */
export function MineTab({ now, uploadedTick, onOpenPost, onCompose }: {
  now: number;
  /** 업로드가 하나 끝날 때마다 +1 — isUploaded를 다시 본다 */
  uploadedTick: number;
  onOpenPost: (p: Post) => void;
  /** 초안을 손보러 글쓰기 화면으로 */
  onCompose: () => void;
}) {
  const memory = useWorld(s => s.memory);
  const setSnsProfile = useWorld(s => s.setSnsProfile);
  const resolvePostDraft = useWorld(s => s.resolvePostDraft);
  const requests = useWorld(s => s.requests);
  const answerRequest = useWorld(s => s.answerRequest);
  const draft = useSns(s => s.draft);
  const setDraft = useSns(s => s.setDraft);
  const myPosts = useSns(s => s.myPosts);
  const myNext = useSns(s => s.myNext);
  const myLoading = useSns(s => s.myLoading);
  const loadMyPosts = useSns(s => s.loadMyPosts);
  const publishPost = useSns(s => s.publishPost);

  useEffect(() => { void loadMyPosts(); }, [loadMyPosts]);

  const vis = memory.visibility ?? 'private';
  const allUp = !!draft && draft.cuts.every(c => isUploaded(c.shotId));
  void uploadedTick;
  /** 이 초안을 물은 쪽지 — 아직 답이 없고 마감도 안 지났으면 카운트다운을 보인다 */
  const ask = draft ? requests.find(r => r.kind === 'post' && r.refId === draft.id) ?? null : null;
  const waitingAnswer = !!ask && !ask.answered && !ask.decidedAlone && draft?.dueAt !== undefined && now < draft.dueAt;

  /** 손보러 간다 — 열려 있는 물음은 '컷 고치기'로 답해 엔진이 기다리게 한 뒤 (answerRequest가 글쓰기 화면도 연다) */
  const startEdit = () => {
    if (ask && !ask.answered && !ask.decidedAlone) answerRequest(ask.id, 'edit');
    onCompose();
  };
  const publishDraft = async () => {
    if (!draft) return;
    if (!allUp) { startEdit(); return; }   // 아직 안 올라간 컷이 있으면 글쓰기 화면에서 기다리거나 뺀다
    const p = await publishPost(draftToPostIn(draft));
    if (!p) return;
    resolvePostDraft(draft.id, 'posted', p.id);
    setDraft(null);
  };
  const discardDraft = () => {
    if (!draft) return;
    if (!confirm('이 초안을 버릴까요? 오늘은 안 올려요.')) return;
    resolvePostDraft(draft.id, 'discarded');
    setDraft(null);
  };

  return (
    <div className="sns-mine">
      <div className="sns-me">
        <AuthorHead repShotId={memory.repShotId} emoji="🙂" size={56} />
        <div className="sns-me-tx">
          <b>{memory.name}</b>
          <span>{homeAreaOf(memory.homePlaceId)}</span>
        </div>
        <button type="button" className={`sns-vis ${vis === 'public' ? 'is-public' : ''}`} onClick={() => setSnsProfile({ visibility: vis === 'public' ? 'private' : 'public' })} aria-pressed={vis === 'public'} aria-label="계정 공개">
          <i /><span>{vis === 'public' ? '공개' : '비공개'}</span>
        </button>
      </div>
      <div className="sns-gender">
        <Chip tone={memory.gender === 'female' ? 'sun' : 'paper'} on={memory.gender === 'female'} tiny onClick={() => setSnsProfile({ gender: memory.gender === 'female' ? null : 'female' })}>여</Chip>
        <Chip tone={memory.gender === 'male' ? 'sun' : 'paper'} on={memory.gender === 'male'} tiny onClick={() => setSnsProfile({ gender: memory.gender === 'male' ? null : 'male' })}>남</Chip>
        <small>설렘은 이성에게만 생겨요</small>
      </div>

      {draft && (
        <section className="sns-draft" aria-label="초안">
          <div className="sns-draft-hd">
            <b>오늘의 초안</b>
            <small>{waitingAnswer && draft.dueAt ? `${Math.max(1, Math.ceil((draft.dueAt - now) / 60_000))}분 뒤엔 그냥 올려요` : `${draft.place} · ${draft.dateKey}`}</small>
          </div>
          {draft.reason && <p className="sns-draft-why">“{draft.reason}”</p>}
          <div className="sns-thumbs">
            {draft.cuts.map((c, i) => (
              <span key={`${c.shotId}:${i}`} className={`sns-thumb ${isUploaded(c.shotId) ? '' : 'is-wait'}`}>
                <PhotoImg shotId={c.shotId}><span className="sns-cut-empty" /></PhotoImg>
                <i className="num">{i + 1}</i>
                {!isUploaded(c.shotId) && <em>업로드 중…</em>}
              </span>
            ))}
          </div>
          {draft.caption && <p className="sns-cap">{draft.caption}</p>}
          <div className="sns-draft-btns">
            <Button small tone="coral" onClick={() => void publishDraft()}>올리기</Button>
            <Button small onClick={startEdit}>고치기</Button>
            <Button small tone="text" onClick={discardDraft}>버리기</Button>
          </div>
        </section>
      )}

      <h3 className="book-group-hd"><span>내 글</span><small className="num">{myPosts.length ? `${myPosts.length}개` : ''}</small></h3>
      {myPosts.length === 0 ? (
        <div className="book-empty sns-empty sns-empty--sm">
          {myLoading ? <span>받는 중…</span> : <><Character pose="think" size={120} /><span>아직 올린 글이 없어요<br />{withSubject(memory.name)} 하루에 하나씩 올려요</span></>}
        </div>
      ) : (
        <>
          <PostGrid posts={myPosts} emoji="🙂" onOpen={onOpenPost} />
          {myNext !== null && !myLoading && <button type="button" className="btn btn--text sns-more" onClick={() => void loadMyPosts(true)}>더 보기</button>}
        </>
      )}
    </div>
  );
}
