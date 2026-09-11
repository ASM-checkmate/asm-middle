import { hhmmIn, offsetMinutes, ownerTz } from '../sim/tz';
import { cityNameKo, cityOfTz } from '../sim/places';
import { useWorld } from '../sim/store';
import { Glyph } from './Glyph';

export interface TopChromeProps {
  now: number;
  /** the character's zone (`phase.tz`) — the big clock reads in it */
  tz: string;
  /** Jua sub-line under the clock, e.g. "뉴욕 · 수요일 · 활동 중" */
  label: string;
  /** `paper` on dark backgrounds (sleep) */
  tone?: 'ink' | 'paper';
  onBook?: () => void;
  hideBook?: boolean;
  /** opens the timetable sheet from any state */
  onTimetable?: () => void;
  hideTimetable?: boolean;
  /** SNS를 연다 (ADR-0025) — 친구 목록은 그 안의 탭이다 */
  onSns?: () => void;
  /** 에이전트가 써 둔 초안이 있으면 SNS 버튼에 코랄 점 */
  snsBadge?: boolean;
  /** 대화 실을 연다 (ADR-0002) — 전화는 그 안에서 건다 */
  onChat?: () => void;
  /** 아직 안 본 줄의 개수 (배지) */
  unread?: number;
  /** dev time scale; shows a small "x10" pill when != 1 */
  scale?: number;
}

/** The owner's clock city: the first city living in the device zone ("서울"), else "내 시간". */
const ownerCityName = (() => { const c = cityOfTz(ownerTz); return c ? cityNameKo(c) : '내 시간'; })();

/** The only persistent UI: centre clock (DM Mono, the character's local time) + round timetable/book buttons (2px ink, hard
 *  shadow). When the character's clock differs from the owner's a small house pill left of the clock keeps the owner's own
 *  time ("서울 09:12"); zones on the same offset (Seoul/Tokyo) read the same, so nothing is shown (owner decision 4). */
export function TopChrome({ now, tz, label, tone = 'ink', onBook, hideBook, onTimetable, hideTimetable, onSns, snsBadge, onChat, unread = 0, scale }: TopChromeProps) {
  const away = tz !== ownerTz && offsetMinutes(tz, now) !== offsetMinutes(ownerTz, now);
  const showScale = scale !== undefined && scale !== 1;
  // 서버가 안 보일 때만 작은 회색 점 (BACKEND-CONTRACT §3.5) — 오류처럼 보이지 않게, ok면 아무것도 없다. 스토어에서 직접 읽는다 (Home은 모른다)
  const alone = useWorld(s => s.backend) === 'down';
  return (
    <div className={`chrome ${tone === 'paper' ? 'is-paper' : ''}`}>
      <div className="chrome-clock">
        <div className="chrome-row">
          <span className="num">{hhmmIn(now, tz)}</span>
          {away && (
            <span className="chrome-owner" role="img" aria-label={`${ownerCityName} 시간 ${hhmmIn(now, ownerTz)}`}>
              <Glyph name="home" size={13} />
              <em>{ownerCityName}</em>
              <span className="num">{hhmmIn(now, ownerTz)}</span>
            </span>
          )}
        </div>
        <small>{label}</small>
      </div>
      {(showScale || alone) && (
        <div className="chrome-side">
          {showScale && <span className="chrome-scale">x{scale}</span>}
          {alone && <span className="chrome-dot" role="img" aria-label="혼자 생각 중" title="혼자 생각 중" />}
        </div>
      )}
      <button type="button" className="chrome-book chrome-sns" onClick={onSns} aria-label="SNS 열기">
        <Glyph name="sns" size={24} />
        {snsBadge && <em className="chrome-badge chrome-badge--dot" aria-label="올릴 초안 있음" />}
      </button>
      <button type="button" className="chrome-book chrome-chat" onClick={onChat} aria-label="대화 열기">
        <Glyph name="chat" size={23} />
        {unread > 0 && <em className="chrome-badge num">{unread}</em>}
      </button>
      {!hideTimetable && (
        <button type="button" className="chrome-book chrome-tt" onClick={onTimetable} aria-label="생활계획표 열기">
          <Glyph name="ring" size={24} />
        </button>
      )}
      {!hideBook && (
        <button type="button" className="chrome-book" onClick={onBook} aria-label="book 열기">
          <Glyph name="book" size={24} />
        </button>
      )}
    </div>
  );
}
