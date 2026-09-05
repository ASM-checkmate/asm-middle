import { useWorld } from '../sim/store';
import type { AgentRequest } from '../sim/requests';
import { hhmmIn } from '../sim/tz';
import { Character } from '../character';
import { Bubble, Button } from '../ui';

/**
 * 쪽지 — 에이전트가 말을 거는 두 번째 단계 (docs/adr/0001-agentness.md §1).
 * 진행을 막지는 않지만 마감이 있고, 답이 없으면 에이전트가 혼자 정하고 나중에 통보한다.
 * 화면 아래에 붙는 카드 하나. 시트도 오버레이도 아니다 — 무시하고 지나칠 수 있어야 한다.
 */
export function RequestCard({ req, tz }: { req: AgentRequest; tz: string }) {
  const answer = useWorld(s => s.answerRequest);
  return (
    <div className={`req ${req.kind === 'worry' ? 'is-worry' : ''}`} role="group" aria-label="에이전트의 부탁">
      <Character className="req-me" pose="think" size={64} />
      <Bubble className="req-say">{req.line}</Bubble>
      <div className="req-btns">
        {req.choices.map(c => (
          // 고민 칩은 선택지가 아니라 **대답**이다 — 코랄로 다 칠하면 알람 목록처럼 읽힌다
          <Button key={c.id} small tone={req.kind === 'worry' || c.isDefault ? 'paper' : 'coral'} onClick={() => answer(req.id, c.id)}>
            {c.label}
          </Button>
        ))}
      </div>
      <span className="req-due num">{hhmmIn(req.dueAt, tz)}까지 답 없으면 내가 정할게</span>
    </div>
  );
}
