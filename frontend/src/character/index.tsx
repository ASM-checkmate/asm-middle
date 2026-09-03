// ─── Character contract ──────────────────────────────────────────────────────
// Keep these exports and prop names: the map and screens import them.
import { useEffect, useId, useState } from 'react';
import type { CSSProperties } from 'react';
import type { TransportMode } from '../sim/types';
import { Character } from './Character';
import type { CharacterProps, Pose } from './Character';
import { CharacterDefs } from './defs';
import { Boat, Car, Plane, Subway, Train, Walk } from './costumes';
import type { CostumeProps } from './costumes';
import './character.css';

export { Character, CharacterDefs };
export type { CharacterProps, Pose };

export interface RiderProps {
  mode: TransportMode;
  size?: number;                 // px width of the marker (spec: ≥96; default = RIDER_SIZE[mode], i.e. 96–144 per MOVEMENT_SPEC §3.3)
  facing?: 'right' | 'left';     // side-view sprites flip with a squash, never rotate
  tilt?: number;                 // degrees, plane only (±35 max)
  moving?: boolean;              // false = paused loops (arrived / document hidden)
  boarding?: boolean;            // true for the 200ms boarding squash at leg boundaries
  friend?: boolean;              // friend rides along (second head)
  className?: string;
  style?: CSSProperties;
  // ── optional extras (the map may ignore them) ──
  friendColor?: string;          // friend accent (`--friend`), default mint
  night?: boolean;               // car headlight at 100 % (18:00–06:00)
  sleeping?: boolean;            // plane: #chara-face-sleep + a floating "z" (p 0.40–0.75)
  doors?: 'open' | 'closed';     // subway doors (information; survives reduced motion)
  altScale?: number;             // plane `--alt-scale` 0.55–1 (inherits from the marker root when omitted)
  lineColor?: string;            // subway stripe colour (`--line-color`), default coral
}

/** Default marker width per mode (MOVEMENT_SPEC §3.3) — uniform scale so the 4-unit ink stays 2 px. */
export const RIDER_SIZE: Record<TransportMode, number> = { walk: 96, car: 120, boat: 120, subway: 140, train: 144, plane: 128 };

/**
 * Box for a mode: `size` is the literal marker width in px (never below 96; default RIDER_SIZE[mode]),
 * the height follows the costume's viewBox. Defaults → walk 96×96, car/boat 120×100, subway 140×100,
 * train 144×100, plane 128×80.
 */
export function riderBox(mode: TransportMode, size = RIDER_SIZE[mode]): { width: number; height: number; viewBox: string } {
  const [vw, vh] = VIEWBOX[mode];
  const width = Math.round(Math.max(96, size));
  const height = Math.round(width * (vh / vw));
  return { width, height, viewBox: `0 0 ${vw} ${vh}` };
}
const VIEWBOX: Record<TransportMode, [number, number]> = {
  walk: [200, 200], car: [240, 200], boat: [240, 200], subway: [280, 200], train: [288, 200], plane: [256, 160],
};
const LABEL: Record<TransportMode, string> = { walk: '걷기', car: '자동차', plane: '비행기', boat: '배', train: '기차', subway: '지하철' };
const COSTUME: Record<TransportMode, (p: CostumeProps) => React.JSX.Element> = { walk: Walk, car: Car, plane: Plane, boat: Boat, train: Train, subway: Subway };

/**
 * Character riding/using a transport mode. Rendered INSIDE the MapLibre marker root (which the
 * map owns and never animates). DOM: .mv-flip > .mv-tilt > svg.mv-svg (shadow / ground / veh / chara / fx).
 */
export function Rider({
  mode, size, facing = 'right', tilt, moving = true, boarding = false, friend = false,
  className, style, friendColor, night = false, sleeping = false, doors = 'closed', altScale, lineColor,
}: RiderProps) {
  const box = riderBox(mode, size);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  // Squash-flip only on a facing CHANGE after mount (never on first render).
  const [prevFacing, setPrevFacing] = useState(facing);
  const [turn, setTurn] = useState<'' | 'turn-l' | 'turn-r'>('');
  if (prevFacing !== facing) {
    setPrevFacing(facing);
    setTurn(facing === 'left' ? 'turn-l' : 'turn-r');
  }

  // Train: one-shot hand wave when boarding / passing a station.
  const [waving, setWaving] = useState(false);
  useEffect(() => {
    if (!boarding) return;
    setWaving(true);
    const id = setTimeout(() => setWaving(false), 1400);
    return () => clearTimeout(id);
  }, [boarding]);

  const cls = [
    'mv-flip', 'rider', `rider--${mode}`,
    facing === 'left' ? 'face-left' : '', turn,
    moving ? '' : 'is-paused', boarding ? 'is-boarding' : '', doors === 'open' ? 'doors-open' : '',
    className ?? '',
  ].filter(Boolean).join(' ');

  const rootStyle = {
    width: box.width, height: box.height,
    '--face': facing === 'left' ? -1 : 1,
    '--friend': friendColor,
    '--tilt': tilt === undefined ? undefined : `${tilt}deg`,
    '--alt-scale': altScale,
    '--line-color': lineColor,
    ...style,
  } as CSSProperties;

  const Costume = COSTUME[mode];
  return (
    <div className={cls} style={rootStyle} data-mode={mode} data-facing={facing}>
      <div className="mv-tilt">
        <svg className="mv-svg" viewBox={box.viewBox} width={box.width} height={box.height} role="img" aria-label={`${LABEL[mode]} 타고 이동 중`}>
          <Costume friend={friend} night={night} sleeping={sleeping} waving={waving} uid={uid} />
        </svg>
      </div>
    </div>
  );
}
