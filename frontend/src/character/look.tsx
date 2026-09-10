// ─── 겉모습 (ADR-0019): Look → 색 변수와 머리·안경·수염 조각 ────────────────────────
// 피부·머리·상의 색은 CSS 변수(--ch-skin·--ch-hair·--ch-top)로 캐릭터 svg 뿌리에 얹는다 — <use>로 그리는 얼굴 심볼(defs.tsx)과
// 탈것의 발·손까지 한 번에 물든다. 머리 모양·안경·수염은 Head가 look을 보고 그린다. 친구는 기본색 고정(FIXED)이라 내 변수를 안 받는다.
import { createContext, useContext } from 'react';
import type { CSSProperties } from 'react';
import type { Look } from '../sim/types';

export const SKIN: Record<Look['skin'], string> = { light: '#FFE7D6', fair: '#FFD9B8', tan: '#EDBB8E', brown: '#B97D52', dark: '#7A4B2E' };
export const HAIR: Record<Look['hairColor'], string> = { black: '#1F1A17', 'dark-brown': '#3A2A22', brown: '#6E4B2F', blond: '#E9C45C', red: '#B8512E', gray: '#8E8A86', white: '#EDE7DE' };
export const TOP: Record<Look['top'], string> = { coral: '#FF6A48', sun: '#FFC64D', mint: '#5FC9A6', sky: '#A9DCF5', night: '#1E2440', paper: '#FFF6E6', leaf: '#8FD37E' };

/** 캐릭터 svg 뿌리에 얹는 색 변수. look이 없으면 빈 객체 — shapes.tsx의 var() 기본값이 모모다 */
export const lookVars = (look?: Look): CSSProperties =>
  look ? ({ '--ch-skin': SKIN[look.skin], '--ch-hair': HAIR[look.hairColor], '--ch-top': TOP[look.top] } as CSSProperties) : {};

/** 내 캐릭터의 겉모습 — App이 memory.look을 넣고, Character·CharacterDefs·Rider가 읽는다 */
export const OwnerLookContext = createContext<Look | undefined>(undefined);
export const useOwnerLook = () => useContext(OwnerLookContext);
