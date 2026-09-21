/** `AD` 알약 (ADR-0031): 광고임을 밝히는 표기 하나 — 지도의 제휴 택시 카드, 시간표의 광고 가게 카드, 활동 화면의 장소 태그가 같은 것을 쓴다.
 *  모노 9px, 잉크 테두리. 브랜드 로고는 쓰지 않는다. */
export function AdTag({ className = '' }: { className?: string }) {
  return <i className={`ad-tag ${className}`.trim()} aria-label="광고">AD</i>;
}
