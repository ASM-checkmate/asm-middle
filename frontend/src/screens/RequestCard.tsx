import { useWorld } from '../sim/store';
import { useSns } from '../sim/sns';
import type { AgentRequest } from '../sim/requests';
import { hhmmIn } from '../sim/tz';
import { Character } from '../character';
import { PhotoImg } from '../photo/PhotoImg';
import { Bubble, Button } from '../ui';

/** 글 초안 쪽지의 컷 썸네일 (SNS_SPEC §8 "이유 + 초안(컷 썸네일·캡션) + 버튼") — 초안이 아직 쥐어져 있을 때만 (useSns.draft가 그 쪽지의 것) */
export function DraftCuts({ req, className = '' }: { req: AgentRequest; className?: string }) {
  const draft = useSns(s => s.draft);
  if (req.kind !== 'post' || !draft || draft.id !== req.refId) return null;
  return (
    <div className={`sns-thumbs ${className}`} aria-label="초안 컷">
      {draft.cuts.map((c, i) => (
        <span key={`${c.shotId}:${i}`} className="sns-thumb">
          <PhotoImg shotId={c.shotId}><span className="sns-cut-empty" /></PhotoImg>
          <i className="num">{i + 1}</i>
        </span>
      ))}
    </div>
  );
}

/**
 * 쪽지 — 에이전트가 말을 거는 두 번째 단계 (docs/adr/0001-agentness.md §1).
 * 진행을 막지는 않지만 마감이 있고, 답이 없으면 에이전트가 혼자 정하고 나중에 통보한다.
 * 화면 아래에 붙는 카드 하나. 시트도 오버레이도 아니다 — 무시하고 지나칠 수 있어야 한다.
 * 글 초안 확인(kind 'post', SNS_SPEC §8)은 이유 + 캡션 한 줄 + 컷 썸네일에 `그대로 올려`(기본, 코랄) / `컷 고치기` 둘 — 답이 없으면 15분 뒤 그냥 올린다.
 */
export function RequestCard({ req, tz }: { req: AgentRequest; tz: string }) {
  const answer = useWorld(s => s.answerRequest);
  const post = req.kind === 'post';
  return (
    <div className={`req ${req.kind === 'worry' ? 'is-worry' : post ? 'is-post' : ''}`} role="group" aria-label={post ? '에이전트의 글 초안' : '에이전트의 부탁'}>
      <Character className="req-me" pose={post ? 'wave' : 'think'} size={64} />
      <Bubble className="req-say">{req.line}</Bubble>
      {post && <DraftCuts req={req} className="req-cuts" />}
      <div className="req-btns">
        {req.choices.map(c => (
          // 고민 칩은 선택지가 아니라 **대답**이다 — 코랄로 다 칠하면 알람 목록처럼 읽힌다. 글 초안은 기본(그대로 올려)만 코랄
          <Button key={c.id} small tone={req.kind === 'worry' ? 'paper' : post ? (c.isDefault ? 'coral' : 'paper') : c.isDefault ? 'paper' : 'coral'} onClick={() => answer(req.id, c.id)}>
            {c.label}
          </Button>
        ))}
      </div>
      <span className="req-due num">{hhmmIn(req.dueAt, tz)}까지 답 없으면 {post ? '그냥 올릴게' : '내가 정할게'}</span>
    </div>
  );
}
