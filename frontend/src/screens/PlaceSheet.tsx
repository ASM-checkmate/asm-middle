// ─── 장소 시트 (ADR-0031): 그 가게를 지도로 본다 ─────────────────────────────
// 활동 화면의 장소 태그를 누르면 뜬다. 작은 maplibre 지도(같은 OpenFreeMap 스타일)에 핀 하나, 아래에 네이버 지도·구글 맵 링크.
// 장소엔 주소·지도 id가 없어(Place) 링크는 이름·동네·좌표로만 만든다. 목록 화면이 아니라 오버레이다 (SPEC "목록형 화면을 만들지 않는다").
import { useEffect, useRef } from 'react';
import { AttributionControl, Map as MLMap } from 'maplibre-gl';
import { placeById, cityNameKo } from '../sim/places';
import { buildStyle } from '../map/style';
import { createPinDom, createPinMarker } from '../map/marker';
import { Button } from '../ui';
import './place-sheet.css';

/** 네이버 지도 검색 — 이름 + 동네 */
export const naverMapUrl = (p: { name: string; area: string }) => `https://map.naver.com/p/search/${encodeURIComponent(`${p.name} ${p.area}`)}`;
/** 구글 맵 검색 — 국내는 이름, 해외는 좌표 (한글 이름으로는 못 찾는다) */
export const googleMapUrl = (p: { name: string; lat: number; lng: number; country: string }) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.country === 'KR' ? p.name : `${p.lat},${p.lng}`)}`;

export function PlaceSheet({ placeId, onClose }: { placeId: string; onClose: () => void }) {
  const place = (() => { try { return placeById(placeId); } catch { return null; } })();
  const box = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!place || !box.current) return;
    const map = new MLMap({
      container: box.current, style: buildStyle(), center: [place.lng, place.lat], zoom: 16, pitch: 0, bearing: 0,
      attributionControl: false, interactive: false, pixelRatio: Math.min(2, window.devicePixelRatio || 1), renderWorldCopies: false,
    });
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    // 접힌 채로 둔다 — MapLibre는 첫 소스 attribution이 오면 펼친다 (map/index.tsx와 같은 처리). ⓘ를 누르면 그때부터 펼쳐진다
    const attribEl = box.current.querySelector<HTMLElement>('.maplibregl-ctrl-attrib');
    const collapse = () => { if (attribEl?.classList.contains('maplibregl-compact-show')) { attribEl.classList.remove('maplibregl-compact-show'); attribEl.removeAttribute('open'); } };
    const mo = new MutationObserver(collapse);
    if (attribEl) { collapse(); mo.observe(attribEl, { attributes: true, attributeFilter: ['class'] }); attribEl.querySelector('.maplibregl-ctrl-attrib-button')?.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); mo.disconnect(); }, { once: true }); }
    const marker = createPinMarker(createPinDom(place.name, place.emoji)).setLngLat([place.lng, place.lat]).addTo(map);
    return () => { mo.disconnect(); marker.remove(); map.remove(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeId]);

  if (!place) return null;
  const where = `${place.area} · ${cityNameKo(place.city)}`;
  return (
    <>
      <div className="sheet-dim" onClick={onClose} />
      <div className="sheet ps" role="dialog" aria-label={`${place.name} 위치`}>
        <div className="sheet-hd">
          <span className="ps-emoji" aria-hidden="true">{place.emoji}</span>
          <div>
            <h3>{place.name}</h3>
            <p>{where}</p>
          </div>
          <button type="button" className="ps-x" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        {/* 가로 지도 + 옆에 링크 둘 — 시트를 낮게 (오너 2026-09-15: 세로로 긴 지도는 별로) */}
        <div className="ps-body">
          <a className="ps-map" ref={box} href={naverMapUrl(place)} target="_blank" rel="noopener" aria-label={`${place.name} 지도 — 네이버 지도에서 열기`} />
          <div className="ps-links">
            <Button tone="coral" small onClick={() => window.open(naverMapUrl(place), '_blank', 'noopener')}>네이버 지도</Button>
            <Button small onClick={() => window.open(googleMapUrl(place), '_blank', 'noopener')}>구글 맵</Button>
          </div>
        </div>
        <p className="ps-note">실제 가게예요. 링크는 이름과 동네로 찾아요 — 같은 이름이 여럿이면 동네를 확인해 주세요.</p>
      </div>
    </>
  );
}
