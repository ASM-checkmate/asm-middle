import { useEffect } from 'react';
import { Character } from '../character';
import { Bubble } from '../ui';

/** 혼잣말이 화면에 머무는 시간 (wall ms). 지나가면 사라진다 — 답할 자리가 없다. */
const STAY_MS = 6_000;

/**
 * 혼잣말 — 에이전트가 말을 거는 세 단계 중 **가장 약한 단계** (docs/adr/0001-agentness.md §1).
 * 무시해도 대가가 없고, 몇 초 뒤 사라진다. 남는 곳은 대화 실 하나뿐이다 (ADR-0002).
 *
 * 지금 이걸 쓰는 자리: 고민을 듣고 바로 하는 말 ("헉 왜, 무슨 일이야? 이따가 전화할게!").
 */
export function SayBubble({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const id = window.setTimeout(onDone, STAY_MS);
    return () => window.clearTimeout(id);
  }, [text, onDone]);
  return (
    <div className="say" role="status">
      <Character className="say-me" pose="think" size={56} />
      <Bubble className="say-tx">{text}</Bubble>
    </div>
  );
}
