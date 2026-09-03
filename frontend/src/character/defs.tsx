// ─── Symbol set ──────────────────────────────────────────────────────────────
// Rendered once near the app root. Vehicles reference these with <use>; symbols only
// hold parts that move as ONE unit (MOVEMENT_SPEC §3.2). All face symbols share the
// same viewBox so a costume can swap them in place without re-sizing.
import { BodyStub, C, Head, INK } from './shapes';

const VB = '-70 -70 140 140';

export function CharacterDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <symbol id="chara-face" viewBox={VB} overflow="visible"><Head /></symbol>
        <symbol id="chara-face-3q" viewBox={VB} overflow="visible"><Head quarter /></symbol>
        <symbol id="chara-face-sleep" viewBox={VB} overflow="visible"><Head face="sleep" /></symbol>
        <symbol id="chara-face-happy" viewBox={VB} overflow="visible"><Head face="happy" /></symbol>
        <symbol id="chara-face-down" viewBox={VB} overflow="visible"><Head face="down" /></symbol>
        <symbol id="chara-face-friend" viewBox={VB} overflow="visible"><Head variant="friend" /></symbol>
        <symbol id="chara-face-friend-3q" viewBox={VB} overflow="visible"><Head variant="friend" quarter /></symbol>
        <symbol id="chara-face-friend-happy" viewBox={VB} overflow="visible"><Head variant="friend" face="happy" /></symbol>
        <symbol id="chara-body" viewBox="-50 -30 100 60" overflow="visible"><BodyStub /></symbol>
        {/* Static full character (kept for anything that still points at the stub's symbol). */}
        <symbol id="chara-idle" viewBox="0 0 200 200" overflow="visible">
          <ellipse cx="100" cy="190" rx="48" ry="7" fill={C.ink} opacity=".12" />
          <ellipse cx="60" cy="164" rx="8" ry="15" fill={C.skin} {...INK} transform="rotate(22 60 164)" />
          <ellipse cx="140" cy="164" rx="8" ry="15" fill={C.skin} {...INK} transform="rotate(-22 140 164)" />
          <path d="M68 156 a14 14 0 0 1 14 -14 h36 a14 14 0 0 1 14 14 v10 a14 14 0 0 1 -14 14 H82 a14 14 0 0 1 -14 -14z" fill={C.coral} {...INK} />
          <ellipse cx="86" cy="182" rx="13" ry="7" fill={C.skin} {...INK} />
          <ellipse cx="114" cy="182" rx="13" ry="7" fill={C.skin} {...INK} />
          <g transform="translate(100 96)"><Head /></g>
        </symbol>
      </defs>
    </svg>
  );
}
