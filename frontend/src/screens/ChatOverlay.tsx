import { useEffect, useId, useRef, useState } from 'react';
import { useWorld } from '../sim/store';
import { buildThread, MAX_LEN, type ThreadItem } from '../sim/chat';
import { fmtDur, type CallEvent } from '../sim/call';
import { toldLine, type AgentRequest } from '../sim/requests';
import { hhmmIn } from '../sim/tz';
import { Button, Glyph } from '../ui';
import { dayStamp, phaseLabel } from './util';

/**
 * 대화 실 — 에이전트가 말을 거는 **하나의 통로**를 실물로 만든 화면 (docs/adr/0002-chat.md).
 *
 * 세 가지가 한 줄로 섞인다: 자유 대화 · 쪽지(칩으로 답하는 부탁) · 통화 기록.
 * 통화가 대화 안에 기록으로 남는 것이 핵심이다 — 카카오톡의 보이스톡 기록과 같은 자리에서,
 * "몇 시에 전화가 왔고 몇 분 통화했는가"가 대화의 시간 순서에 그대로 꽂힌다.
 * **부재중은 시각만 남는다** (ADR-0001) — 펼쳐도 나올 내용이 없다.
 */
export function ChatOverlay({ tz, onClose }: { tz: string; onClose: () => void }) {
  const now = useWorld(s => s.now);
  const phase = useWorld(s => s.phase);
  const memory = useWorld(s => s.memory);
  const messages = useWorld(s => s.messages);
  const requests = useWorld(s => s.requests);
  const calls = useWorld(s => s.calls);
  const send = useWorld(s => s.sendMessage);
  const callAgent = useWorld(s => s.callAgent);
  const answer = useWorld(s => s.answerRequest);

  const [draft, setDraft] = useState('');
  /** 펼쳐 본 통화 (받은 통화에만 내용이 있다) */
  const [open, setOpen] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  const items = buildThread(messages, requests, calls, now);
  // 날짜가 바뀌는 첫 줄에만 구분선을 단다
  const rows = items.map((it, i) => {
    const stamp = dayStamp(it.at, now, tz);
    return { it, sep: i && dayStamp(items[i - 1].at, now, tz) === stamp ? null : stamp };
  });

  // 새 줄이 오면 바닥으로 (대화창의 기본값)
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [items.length]);

  const submit = () => { if (!draft.trim()) return; send(draft); setDraft(''); };

  return (
    <div className="book chat" role="dialog" aria-label="대화">
      <div className="book-hd chat-hd">
        <MyHead />
        <h2>{memory.name}<small>{phaseLabel(phase)}</small></h2>
        <Button round ariaLabel="전화 걸기" onClick={callAgent}><Glyph name="phone" size={20} /></Button>
        <Button round ariaLabel="닫기" onClick={onClose}><Glyph name="close" /></Button>
      </div>

      <ol className="chat-list" ref={listRef}>
        {rows.map(({ it, sep }) => (
          <li key={it.id} className="chat-li">
            {sep && <div className="chat-day"><span>{sep}</span></div>}
            <Row item={it} tz={tz} open={open === it.id} onToggle={() => setOpen(open === it.id ? null : it.id)} onAnswer={answer} />
          </li>
        ))}
        {!items.length && <li className="chat-empty">아직 아무 말도 없어요.<br />먼저 말을 걸어 보세요.</li>}
      </ol>

      {/* 입력창: 자유 텍스트를 받는 유일한 자리 (sim/chat.ts의 replyTo가 알아듣는다) */}
      <div className="chat-bar">
        <input
          className="chat-in"
          value={draft}
          maxLength={MAX_LEN}
          placeholder="하고 싶은 말"
          aria-label="보낼 말"
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        />
        <Button round ariaLabel="보내기" tone="coral" disabled={!draft.trim()} onClick={submit}><Glyph name="send" size={20} color="#fff" /></Button>
      </div>
    </div>
  );
}

/** 대화방 제목 줄의 작은 얼굴 — 공유 심볼(`#chara-face-happy`)을 그대로 쓴다. 다시 그리지 않는다. */
function MyHead() {
  const clip = `ch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg className="chat-face" width={38} height={38} viewBox="0 0 100 100" aria-hidden="true">
      <defs><clipPath id={clip}><circle cx="50" cy="50" r="45" /></clipPath></defs>
      <circle cx="50" cy="50" r="45" fill="var(--paper-2)" />
      <g clipPath={`url(#${clip})`}><use href="#chara-face-happy" x="4" y="8" width="92" height="92" /></g>
      <circle cx="50" cy="50" r="45" fill="none" stroke="var(--ink)" strokeWidth="5" />
    </svg>
  );
}

/** 한 줄. 자유 대화 · 쪽지 · 통화 기록이 각각 다른 모양이다. */
function Row({ item, tz, open, onToggle, onAnswer }: {
  item: ThreadItem;
  tz: string;
  open: boolean;
  onToggle: () => void;
  onAnswer: (id: string, choiceId: string) => void;
}) {
  const t = <span className="chat-t num">{hhmmIn(item.at, tz)}</span>;

  if (item.kind === 'msg') {
    const mine = item.msg.from === 'me';
    return (
      <div className={`chat-row ${mine ? 'is-me' : ''}`}>
        <p className="chat-say">{item.msg.text}</p>
        {t}
      </div>
    );
  }

  if (item.kind === 'ask') return <Ask req={item.req} tz={tz} onAnswer={onAnswer} />;

  return <Call call={item.call} tz={tz} open={open} onToggle={onToggle} />;
}

/** 쪽지: 에이전트의 질문 + 내 대답. 아직 안 답했으면 여기서 바로 답할 수 있다. */
function Ask({ req, tz, onAnswer }: { req: AgentRequest; tz: string; onAnswer: (id: string, choiceId: string) => void }) {
  const chosen = req.choices.find(c => c.id === req.answered);
  const pending = !req.answered && !req.decidedAlone;
  return (
    <>
      <div className="chat-row">
        <p className="chat-say is-ask">{req.line}</p>
        <span className="chat-t num">{hhmmIn(req.at, tz)}</span>
      </div>
      {pending && (
        <div className="chat-chips">
          {req.choices.map(c => (
            <button key={c.id} type="button" className="chat-chip" onClick={() => onAnswer(req.id, c.id)}>{c.label}</button>
          ))}
        </div>
      )}
      {chosen && (
        <div className="chat-row is-me">
          <p className="chat-say">{chosen.label}</p>
          {req.answeredAt !== undefined && <span className="chat-t num">{hhmmIn(req.answeredAt, tz)}</span>}
        </div>
      )}
      {/* 답이 없어 혼자 정한 것도 여기 남는다 — 무시한 결과가 이야기로 돌아온다 (ADR-0001 §1) */}
      {req.decidedAlone && (
        <div className="chat-row">
          <p className="chat-say is-alone">{toldLine(req)}</p>
          <span className="chat-t num">{hhmmIn(req.dueAt, tz)}</span>
        </div>
      )}
    </>
  );
}

/** 통화 기록 한 줄. 받았으면 통화 시간이, 못 받았으면 시각만 남는다. */
function Call({ call, tz, open, onToggle }: { call: CallEvent; tz: string; open: boolean; onToggle: () => void }) {
  const mine = call.dir === 'out';
  const answered = call.result === 'answered';
  const label = answered
    ? `${mine ? '내가 건 통화' : '통화'} · ${call.durSec ? fmtDur(call.durSec) : '통화 중'}`
    : call.result === 'declined' ? '내가 안 받음'
    : call.result === 'refused' ? '안 받아서 못 함'
    : '부재중전화';
  const lines = answered ? call.lines : undefined;   // 부재중에는 펼칠 내용이 없다
  return (
    <div className={`chat-row is-call ${mine ? 'is-me' : ''} ${answered ? '' : 'is-missed'}`}>
      <button type="button" className="chat-call" onClick={lines ? onToggle : undefined} aria-expanded={lines ? open : undefined}>
        <Glyph name={answered ? 'phone' : 'phone-off'} size={17} />
        <b>{label}</b>
        {lines && <em className="chat-more">{open ? '접기' : '무슨 얘기'}</em>}
      </button>
      <span className="chat-t num">{hhmmIn(call.at, tz)}</span>
      {lines && open && (
        <ul className="chat-heard">
          {lines.map(l => <li key={l}>{l}</li>)}
        </ul>
      )}
      {/* 못 받은 발신에 늦게 온 문자 */}
      {call.text && <p className="chat-late">「{call.text}」</p>}
    </div>
  );
}
