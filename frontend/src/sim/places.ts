import { PLACE_TYPES, type CityHubs, type CityInfo, type Place } from './types';
import { onLocalSave } from './sync';

// Real places with real coordinates (≈3-decimal precision). Ids are stable — screens, memory and the
// book reference them. Seoul is dense around the home in 연남동 so morning/lunch blocks stay walkable;
// other cities exist so train / plane / boat journeys happen.
const P = (id: string, name: string, type: Place['type'], lng: number, lat: number, area: string, city: string, country: string, emoji: string, reachBy?: Place['reachBy']): Place =>
  reachBy ? { id, name, type, lng, lat, area, city, country, emoji, reachBy } : { id, name, type, lng, lat, area, city, country, emoji };
/** A friend's / another agent's home. Bound to its owner by `ownerFriendId` — it is only ever suggested through them. */
const FH = (id: string, name: string, lng: number, lat: number, area: string, ownerFriendId: string): Place =>
  ({ id, name, type: 'friend_home', lng, lat, area, city: 'seoul', country: 'KR', emoji: '\u{1F3E1}', ownerFriendId });

export const PLACES: Place[] = [
  // ── 집 & 친구 집 ─────────────────────────────────────────────────────────
  P('home', '우리 집', 'home', 126.9247, 37.5627, '연남동', 'seoul', 'KR', '🏠'),
  FH('minsu-home', '민수네 집', 126.9101, 37.5520, '망원동', 'minsu'),
  FH('hana-home', '하나네 집', 126.9302, 37.5689, '연희동', 'hana'),
  // 다른 사용자의 에이전트들 (NPC 풀, agents.ts) 의 집 — 친구가 되기 전엔 제안에 뜨지 않는다
  FH('jiwoo-home', '지우네 집', 126.9226, 37.5478, '상수동', 'jiwoo'),
  FH('taerin-home', '태린네 집', 127.0555, 37.5447, '성수동', 'taerin'),
  FH('doyun-home', '도윤네 집', 126.9042, 37.5567, '망원동', 'doyun'),
  FH('serin-home', '세린네 집', 126.9235, 37.5545, '서교동', 'serin'),
  FH('hyeon-home', '현이네 집', 126.9297, 37.5711, '연희동', 'hyeon'),
  FH('bomi-home', '보미네 집', 126.9134, 37.5497, '합정동', 'bomi'),

  // ── 연남동 (걸어서) ──────────────────────────────────────────────────────
  P('layered-yeonnam', '카페 레이어드 연남', 'cafe', 126.9229, 37.5622, '연남동', 'seoul', 'KR', '☕'),
  P('gyeongui-line-forest', '경의선숲길', 'park', 126.9226, 37.5605, '연남동', 'seoul', 'KR', '🌳'),
  P('oven-kettle', '오븐과주전자', 'cafe', 126.9221, 37.5626, '연남동', 'seoul', 'KR', '🥐'),
  P('tuktuk-noodle', '툭툭누들타이', 'restaurant', 126.9256, 37.5625, '연남동', 'seoul', 'KR', '🍜'),
  P('hakata-bunko', '하카타분코', 'restaurant', 126.9249, 37.5634, '연남동', 'seoul', 'KR', '🍥'),
  P('soi-yeonnam', '소이연남', 'restaurant', 126.9234, 37.5598, '동교동', 'seoul', 'KR', '🍛'),
  P('dongjin-market', '동진시장', 'market', 126.9236, 37.5636, '연남동', 'seoul', 'KR', '🧺'),
  P('the-climb-yeonnam', '더클라임 연남', 'gym', 126.9224, 37.5645, '연남동', 'seoul', 'KR', '🧗'),
  P('saruga-shopping', '사러가쇼핑센터', 'market', 126.9291, 37.5680, '연희동', 'seoul', 'KR', '🛒'),
  P('mapo-central-library', '마포중앙도서관', 'library', 126.9310, 37.5650, '성산동', 'seoul', 'KR', '📚'),

  // ── 홍대 · 합정 · 상수 ───────────────────────────────────────────────────
  P('hongdae-station', '홍대입구역', 'station', 126.9243, 37.5571, '동교동', 'seoul', 'KR', '🚇'),
  P('hongik-park', '홍익문화공원', 'park', 126.9227, 37.5549, '서교동', 'seoul', 'KR', '🎸'),
  P('jopok-tteokbokki', '조폭떡볶이', 'restaurant', 126.9246, 37.5555, '서교동', 'seoul', 'KR', '🌶️'),
  P('cgv-hongdae', 'CGV 홍대', 'cinema', 126.9217, 37.5556, '서교동', 'seoul', 'KR', '🎬'),
  P('funcity-hongdae', '펀시티 홍대점', 'arcade', 126.9243, 37.5563, '서교동', 'seoul', 'KR', '🕹️'),
  P('gymbox-hongdae', '짐박스 홍대점', 'gym', 126.9216, 37.5567, '서교동', 'seoul', 'KR', '🏋️'),
  P('hongik-univ', '홍익대학교', 'school', 126.9251, 37.5512, '상수동', 'seoul', 'KR', '🎓'),
  P('wework-hongdae', '위워크 홍대', 'office', 126.9186, 37.5534, '서교동', 'seoul', 'KR', '💼'),
  P('anthracite-hapjeong', '앤트러사이트 합정', 'cafe', 126.9105, 37.5480, '합정동', 'seoul', 'KR', '☕'),
  P('jebi-dabang', '제비다방', 'bar', 126.9228, 37.5484, '상수동', 'seoul', 'KR', '🎶'),

  // ── 망원 · 상암 · 여의도 ────────────────────────────────────────────────
  P('mangwon-hangang', '망원한강공원', 'river', 126.8962, 37.5528, '망원동', 'seoul', 'KR', '🌊'),
  P('mangwon-market', '망원시장', 'market', 126.9057, 37.5558, '망원동', 'seoul', 'KR', '🥟'),
  P('mangwon-tiramisu', '망원동 티라미수', 'cafe', 126.9046, 37.5563, '망원동', 'seoul', 'KR', '🍰'),
  P('seonyudo-park', '선유도공원', 'park', 126.8996, 37.5434, '양화동', 'seoul', 'KR', '🌿'),
  P('haneul-park', '하늘공원', 'park', 126.8843, 37.5673, '상암동', 'seoul', 'KR', '🌾'),
  P('worldcup-stadium', '서울월드컵경기장', 'stadium', 126.8972, 37.5683, '성산동', 'seoul', 'KR', '⚽'),
  P('yeouido-hangang', '여의도한강공원', 'river', 126.9330, 37.5286, '여의도동', 'seoul', 'KR', '🚲'),
  P('hyundai-seoul', '더현대 서울', 'mall', 126.9284, 37.5260, '여의도동', 'seoul', 'KR', '🛍️'),

  // ── 종로 · 을지로 · 익선동 ───────────────────────────────────────────────
  P('gyeongbokgung', '경복궁', 'museum', 126.9770, 37.5796, '세종로', 'seoul', 'KR', '🏯'),
  P('bukchon', '북촌한옥마을', 'museum', 126.9850, 37.5826, '계동', 'seoul', 'KR', '🏘️'),
  P('jogyesa', '조계사', 'temple', 126.9819, 37.5740, '견지동', 'seoul', 'KR', '🏮'),
  P('ikseon-hanok', '익선동 한옥거리', 'market', 126.9898, 37.5741, '익선동', 'seoul', 'KR', '🍡'),
  P('coffee-hanyakbang', '커피한약방', 'cafe', 126.9895, 37.5666, '을지로', 'seoul', 'KR', '🫖'),
  P('euljiro-nogari', '을지로 노가리골목', 'bar', 126.9917, 37.5667, '을지로', 'seoul', 'KR', '🍻'),
  P('gwangjang-market', '광장시장', 'market', 126.9997, 37.5701, '예지동', 'seoul', 'KR', '🥞'),
  P('seoul-station', '서울역', 'station', 126.9707, 37.5547, '봉래동', 'seoul', 'KR', '🚄'),

  // ── 남산 · 이태원 · 한남 · 용산 ─────────────────────────────────────────
  P('namsan-tower', '남산서울타워', 'mountain', 126.9882, 37.5512, '용산동', 'seoul', 'KR', '🗼'),
  P('kervan-itaewon', '케르반 이태원', 'restaurant', 126.9938, 37.5343, '이태원동', 'seoul', 'KR', '🥙'),
  P('leeum', '리움미술관', 'museum', 126.9994, 37.5385, '한남동', 'seoul', 'KR', '🎨'),
  P('passion5', '패션5', 'cafe', 127.0003, 37.5352, '한남동', 'seoul', 'KR', '🍞'),
  P('national-museum', '국립중앙박물관', 'museum', 126.9804, 37.5240, '용산동', 'seoul', 'KR', '🏛️'),

  // ── 성수 · 잠실 · 강남 ───────────────────────────────────────────────────
  P('seoul-forest', '서울숲', 'park', 127.0374, 37.5444, '성수동', 'seoul', 'KR', '🦌'),
  P('daelim-changgo', '대림창고', 'cafe', 127.0546, 37.5418, '성수동', 'seoul', 'KR', '🧱'),
  P('onion-seongsu', '어니언 성수', 'cafe', 127.0575, 37.5445, '성수동', 'seoul', 'KR', '🥯'),
  P('ttukseom-hangang', '뚝섬한강공원', 'river', 127.0692, 37.5306, '자양동', 'seoul', 'KR', '🛶'),
  P('coex', '코엑스', 'mall', 127.0590, 37.5116, '삼성동', 'seoul', 'KR', '🛍️'),
  P('starfield-library', '별마당도서관', 'library', 127.0596, 37.5107, '삼성동', 'seoul', 'KR', '📚'),
  P('megabox-coex', '메가박스 코엑스', 'cinema', 127.0592, 37.5124, '삼성동', 'seoul', 'KR', '🍿'),
  P('lotte-world', '롯데월드 어드벤처', 'arcade', 127.0982, 37.5111, '잠실동', 'seoul', 'KR', '🎡'),
  P('seokchon-lake', '석촌호수', 'park', 127.1003, 37.5085, '잠실동', 'seoul', 'KR', '🦆'),

  // ── 북한산 · 공항 ────────────────────────────────────────────────────────
  P('bukhansan', '북한산 (북한산성 입구)', 'mountain', 126.9634, 37.6549, '효자동', 'seoul', 'KR', '⛰️'),
  P('gimpo-airport', '김포공항', 'airport', 126.7936, 37.5585, '공항동', 'seoul', 'KR', '✈️'),
  P('incheon-airport', '인천국제공항', 'airport', 126.4506, 37.4602, '영종도', 'seoul', 'KR', '🛫'),

  // ── 부산 ──────────────────────────────────────────────────────────────────
  P('busan-station', '부산역', 'station', 129.0415, 35.1152, '초량동', 'busan', 'KR', '🚄'),
  P('busan-port', '부산항 국제여객터미널', 'port', 129.0447, 35.1163, '초량동', 'busan', 'KR', '⛴️'),
  P('gimhae-airport', '김해국제공항', 'airport', 128.9383, 35.1795, '대저동', 'busan', 'KR', '✈️'),
  P('haeundae', '해운대 해수욕장', 'beach', 129.1604, 35.1587, '해운대', 'busan', 'KR', '🏖️'),
  P('haeundae-market', '해운대시장', 'market', 129.1601, 35.1607, '해운대', 'busan', 'KR', '🐟'),
  P('dongbaek-island', '동백섬', 'park', 129.1552, 35.1524, '해운대', 'busan', 'KR', '🌺'),
  P('gwangalli', '광안리 해수욕장', 'beach', 129.1187, 35.1532, '광안동', 'busan', 'KR', '🌉'),
  P('gamcheon-village', '감천문화마을', 'museum', 129.0107, 35.0975, '감천동', 'busan', 'KR', '🎨'),
  P('jagalchi-market', '자갈치시장', 'market', 129.0308, 35.0966, '남포동', 'busan', 'KR', '🦑'),
  P('momos-coffee', '모모스커피', 'cafe', 129.0900, 35.2066, '온천동', 'busan', 'KR', '☕'),
  P('paradise-busan', '파라다이스 호텔 부산', 'hotel', 129.1655, 35.1592, '해운대', 'busan', 'KR', '🏨'),

  // ── 강릉 ──────────────────────────────────────────────────────────────────
  P('gangneung-station', '강릉역', 'station', 128.8990, 37.7640, '교동', 'gangneung', 'KR', '🚄'),
  P('anmok-beach', '안목해변', 'beach', 128.9460, 37.7726, '견소동', 'gangneung', 'KR', '☕'),
  P('gyeongpo-beach', '경포해변', 'beach', 128.9088, 37.8054, '안현동', 'gangneung', 'KR', '🏖️'),
  P('terarosa-factory', '테라로사 커피공장', 'cafe', 128.8862, 37.7073, '구정면', 'gangneung', 'KR', '☕'),
  P('gangneung-central-market', '강릉중앙시장', 'market', 128.8968, 37.7549, '성남동', 'gangneung', 'KR', '🥟'),
  P('st-johns-gangneung', '세인트존스 호텔', 'hotel', 128.9098, 37.8032, '강문동', 'gangneung', 'KR', '🏨'),

  // ── 경주 ──────────────────────────────────────────────────────────────────
  P('singyeongju-station', '경주역', 'station', 129.1400, 35.7967, '건천읍', 'gyeongju', 'KR', '🚄'),
  P('bulguksa', '불국사', 'temple', 129.3323, 35.7902, '진현동', 'gyeongju', 'KR', '🛕'),
  P('hwangnidan-gil', '황리단길', 'market', 129.2130, 35.8380, '황남동', 'gyeongju', 'KR', '🏮'),
  P('daereungwon', '대릉원', 'park', 129.2113, 35.8383, '황남동', 'gyeongju', 'KR', '🌿'),
  P('lahan-select-gyeongju', '라한셀렉트 경주', 'hotel', 129.2833, 35.8390, '보문', 'gyeongju', 'KR', '🏨'),

  // ── 전주 ──────────────────────────────────────────────────────────────────
  P('jeonju-station', '전주역', 'station', 127.1615, 35.8483, '우아동', 'jeonju', 'KR', '🚄'),
  P('jeonju-hanok', '전주 한옥마을', 'museum', 127.1530, 35.8150, '풍남동', 'jeonju', 'KR', '🏘️'),
  P('nambu-market', '전주 남부시장', 'market', 127.1467, 35.8118, '전동', 'jeonju', 'KR', '🍲'),
  P('lahan-jeonju', '라한호텔 전주', 'hotel', 127.1525, 35.8123, '풍남동', 'jeonju', 'KR', '🏨'),

  // ── 여수 ──────────────────────────────────────────────────────────────────
  P('yeosu-expo-station', '여수엑스포역', 'station', 127.7455, 34.7527, '덕충동', 'yeosu', 'KR', '🚄'),
  P('yeosu-pocha', '여수 낭만포차거리', 'bar', 127.7395, 34.7405, '중앙동', 'yeosu', 'KR', '🍢'),
  P('odongdo', '오동도', 'park', 127.7660, 34.7440, '수정동', 'yeosu', 'KR', '🌲'),
  P('sono-calm-yeosu', '소노캄 여수', 'hotel', 127.7473, 34.7518, '덕충동', 'yeosu', 'KR', '🏨'),

  // ── 제주 · 우도 ───────────────────────────────────────────────────────────
  P('jeju-airport', '제주국제공항', 'airport', 126.4930, 33.5104, '용담동', 'jeju', 'KR', '✈️'),
  P('hyeopjae', '협재해수욕장', 'beach', 126.2396, 33.3940, '한림읍', 'jeju', 'KR', '🏝️'),
  P('aewol-bomnal', '봄날카페 애월', 'cafe', 126.3180, 33.4636, '애월읍', 'jeju', 'KR', '🍊'),
  P('dongmun-market', '제주 동문시장', 'market', 126.5277, 33.5128, '일도일동', 'jeju', 'KR', '🍊'),
  P('seongsan-ilchulbong', '성산일출봉', 'mountain', 126.9425, 33.4589, '성산읍', 'jeju', 'KR', '🌄'),
  P('olle-guksu', '올래국수', 'restaurant', 126.5108, 33.4977, '연동', 'jeju', 'KR', '🍜'),
  P('shilla-jeju', '제주 신라호텔', 'hotel', 126.4103, 33.2472, '중문', 'jeju', 'KR', '🏨'),
  P('seongsan-port', '성산포항 여객터미널', 'port', 126.9339, 33.4732, '성산읍', 'jeju', 'KR', '⛴️'),
  P('udo-port', '우도 천진항', 'port', 126.9516, 33.4958, '우도면', 'udo', 'KR', '⛴️'),
  P('udo-seobin', '우도 서빈백사', 'beach', 126.9430, 33.5063, '우도면', 'udo', 'KR', '🐚', 'boat'),
  P('udo-peanut', '우도 땅콩아이스크림 거리', 'island', 126.9550, 33.5040, '우도면', 'udo', 'KR', '🥜', 'boat'),

  // ── 후쿠오카 (배로) ───────────────────────────────────────────────────────
  P('hakata-port', '하카타항', 'port', 130.4060, 33.6010, '하카타', 'fukuoka', 'JP', '⛴️'),
  P('fukuoka-airport', '후쿠오카공항', 'airport', 130.4510, 33.5859, '하카타', 'fukuoka', 'JP', '✈️'),
  P('canal-city', '캐널시티 하카타', 'mall', 130.4118, 33.5898, '하카타', 'fukuoka', 'JP', '🛍️', 'boat'),
  P('ohori-park', '오호리공원', 'park', 130.3762, 33.5862, '주오구', 'fukuoka', 'JP', '🌸', 'boat'),
  P('ichiran-honten', '이치란 본점', 'restaurant', 130.4046, 33.5934, '나카스', 'fukuoka', 'JP', '🍜', 'boat'),
  P('hakata-station', '하카타역', 'station', 130.4207, 33.5897, '하카타', 'fukuoka', 'JP', '🚄'),
  P('kushida-shrine', '쿠시다신사', 'temple', 130.4105, 33.5930, '하카타', 'fukuoka', 'JP', '⛩️', 'boat'),
  P('nakasu-yatai', '나카스 포장마차 거리', 'bar', 130.4077, 33.5924, '나카스', 'fukuoka', 'JP', '🏮', 'boat'),
  P('yanagibashi-market', '야나기바시 연합시장', 'market', 130.4045, 33.5826, '하루요시', 'fukuoka', 'JP', '🐟', 'boat'),
  P('rec-coffee-yakuin', '렉 커피 야쿠인', 'cafe', 130.4025, 33.5796, '야쿠인', 'fukuoka', 'JP', '☕', 'boat'),
  P('ippudo-daimyo', '잇푸도 다이묘 본점', 'restaurant', 130.3963, 33.5883, '다이묘', 'fukuoka', 'JP', '🍥', 'boat'),
  P('momochi-beach', '모모치해변', 'beach', 130.3508, 33.5932, '모모치', 'fukuoka', 'JP', '🏖️', 'boat'),
  P('fukuoka-art-museum', '후쿠오카시미술관', 'museum', 130.3767, 33.5834, '오호리', 'fukuoka', 'JP', '🖼️', 'boat'),
  P('dazaifu-tenmangu', '다자이후 텐만구', 'temple', 130.5348, 33.5215, '다자이후', 'fukuoka', 'JP', '🌸', 'boat'),
  P('hotel-nikko-fukuoka', '호텔 닛코 후쿠오카', 'hotel', 130.4185, 33.5904, '하카타', 'fukuoka', 'JP', '🏨'),

  // ── 도쿄 ──────────────────────────────────────────────────────────────────
  P('haneda', '하네다공항', 'airport', 139.7798, 35.5494, '오타구', 'tokyo', 'JP', '✈️'),
  P('shibuya', '시부야 스크램블', 'mall', 139.7016, 35.6595, '시부야', 'tokyo', 'JP', '🚦'),
  P('meiji-jingu', '메이지신궁', 'temple', 139.6993, 35.6764, '하라주쿠', 'tokyo', 'JP', '⛩️'),
  P('sensoji', '센소지', 'temple', 139.7967, 35.7148, '아사쿠사', 'tokyo', 'JP', '🏮'),
  P('tsutaya-daikanyama', '츠타야 다이칸야마', 'library', 139.6996, 35.6489, '다이칸야마', 'tokyo', 'JP', '📖'),
  P('teamlab-planets', '팀랩 플래닛', 'museum', 139.7890, 35.6494, '도요스', 'tokyo', 'JP', '✨'),
  P('tsukiji-market', '츠키지 장외시장', 'market', 139.7706, 35.6654, '츠키지', 'tokyo', 'JP', '🍣'),
  P('tokyo-station', '도쿄역', 'station', 139.7671, 35.6812, '마루노우치', 'tokyo', 'JP', '🚄'),
  P('shinjuku-gyoen', '신주쿠교엔', 'park', 139.7100, 35.6852, '신주쿠', 'tokyo', 'JP', '🌳'),
  P('ueno-park', '우에노공원', 'park', 139.7734, 35.7146, '우에노', 'tokyo', 'JP', '🦢'),
  P('tokyo-national-museum', '도쿄국립박물관', 'museum', 139.7765, 35.7188, '우에노', 'tokyo', 'JP', '🏛️'),
  P('ameyoko', '아메요코 시장', 'market', 139.7748, 35.7099, '우에노', 'tokyo', 'JP', '🍡'),
  P('takeshita-street', '다케시타 거리', 'market', 139.7036, 35.6716, '하라주쿠', 'tokyo', 'JP', '🍭'),
  P('ginza-six', '긴자 식스', 'mall', 139.7641, 35.6699, '긴자', 'tokyo', 'JP', '🛍️'),
  P('blue-bottle-kiyosumi', '블루보틀 기요스미시라카와', 'cafe', 139.8010, 35.6819, '기요스미', 'tokyo', 'JP', '☕'),
  P('fuglen-tokyo', '푸글렌 도쿄', 'cafe', 139.6908, 35.6701, '도미가야', 'tokyo', 'JP', '🫖'),
  P('ichiran-shibuya', '이치란 시부야', 'restaurant', 139.6998, 35.6620, '시부야', 'tokyo', 'JP', '🍜'),
  P('afuri-ebisu', '아후리 에비스', 'restaurant', 139.7118, 35.6474, '에비스', 'tokyo', 'JP', '🍋'),
  P('tokyo-skytree', '도쿄 스카이트리', 'mountain', 139.8107, 35.7101, '오시아게', 'tokyo', 'JP', '🗼'),
  P('hotel-gracery-shinjuku', '호텔 그레이서리 신주쿠', 'hotel', 139.7015, 35.6953, '신주쿠', 'tokyo', 'JP', '🏨'),

  // ── 오사카 ────────────────────────────────────────────────────────────────
  P('kansai-airport', '간사이국제공항', 'airport', 135.2440, 34.4347, '이즈미사노', 'osaka', 'JP', '✈️'),
  P('dotonbori', '도톤보리', 'market', 135.5017, 34.6687, '난바', 'osaka', 'JP', '🐙'),
  P('osaka-castle', '오사카성', 'museum', 135.5262, 34.6873, '주오구', 'osaka', 'JP', '🏯'),
  P('usj', '유니버설 스튜디오 재팬', 'arcade', 135.4323, 34.6654, '고노하나', 'osaka', 'JP', '🎢'),
  P('shin-osaka-station', '신오사카역', 'station', 135.5001, 34.7334, '요도가와', 'osaka', 'JP', '🚄'),
  P('kuromon-market', '구로몬시장', 'market', 135.5064, 34.6654, '니혼바시', 'osaka', 'JP', '🦀'),
  P('shinsaibashi-suji', '신사이바시스지', 'mall', 135.5013, 34.6740, '신사이바시', 'osaka', 'JP', '🛍️'),
  P('lilo-coffee', '리로 커피 로스터스', 'cafe', 135.4986, 34.6725, '신사이바시', 'osaka', 'JP', '☕'),
  P('mizuno-okonomiyaki', '미즈노 오코노미야키', 'restaurant', 135.5030, 34.6686, '도톤보리', 'osaka', 'JP', '🥞'),
  P('horai-551', '551 호라이 본점', 'restaurant', 135.5011, 34.6656, '난바', 'osaka', 'JP', '🥟'),
  P('nakanoshima-park', '나카노시마공원', 'park', 135.5088, 34.6935, '기타구', 'osaka', 'JP', '🌹'),
  P('kaiyukan', '카이유칸', 'museum', 135.4289, 34.6545, '미나토', 'osaka', 'JP', '🐋'),
  P('umeda-sky', '우메다 스카이빌딩', 'mountain', 135.4901, 34.7052, '우메다', 'osaka', 'JP', '🌆'),
  P('round1-namba', '라운드원 난바', 'arcade', 135.5043, 34.6672, '난바', 'osaka', 'JP', '🕹️'),
  P('swissotel-nankai', '스위소텔 난카이 오사카', 'hotel', 135.5022, 34.6628, '난바', 'osaka', 'JP', '🏨'),

  // ── 타이베이 ──────────────────────────────────────────────────────────────
  P('taoyuan-airport', '타오위안국제공항', 'airport', 121.2333, 25.0797, '타오위안', 'taipei', 'TW', '✈️'),
  P('shilin-night-market', '스린 야시장', 'market', 121.5240, 25.0880, '스린', 'taipei', 'TW', '🧋'),
  P('din-tai-fung', '딘타이펑 본점', 'restaurant', 121.5297, 25.0334, '융캉제', 'taipei', 'TW', '🥟'),
  P('taipei-101', '타이베이 101', 'mall', 121.5645, 25.0339, '신이', 'taipei', 'TW', '🏙️'),
  P('taipei-main-station', '타이베이역', 'station', 121.5170, 25.0478, '중정', 'taipei', 'TW', '🚄'),
  P('daan-park', '다안삼림공원', 'park', 121.5355, 25.0329, '다안', 'taipei', 'TW', '🌳'),
  P('national-palace-museum', '국립고궁박물원', 'museum', 121.5485, 25.1024, '스린', 'taipei', 'TW', '🏺'),
  P('huashan-1914', '화산1914 문화창의원구', 'museum', 121.5296, 25.0440, '중정', 'taipei', 'TW', '🎨'),
  P('longshan-temple', '룽산사', 'temple', 121.4999, 25.0372, '완화', 'taipei', 'TW', '🏮'),
  P('ximending', '시먼딩', 'mall', 121.5069, 25.0421, '완화', 'taipei', 'TW', '🎀'),
  P('fujin-tree-cafe', '푸진트리 353 카페', 'cafe', 121.5577, 25.0604, '쑹산', 'taipei', 'TW', '☕'),
  P('yongkang-beef-noodle', '융캉 우육면', 'restaurant', 121.5290, 25.0335, '융캉제', 'taipei', 'TW', '🍜'),
  P('raohe-night-market', '라오허제 야시장', 'market', 121.5774, 25.0510, '쑹산', 'taipei', 'TW', '🍢'),
  P('elephant-mountain', '샹산', 'mountain', 121.5713, 25.0274, '신이', 'taipei', 'TW', '🌄'),
  P('grand-hyatt-taipei', '그랜드 하얏트 타이베이', 'hotel', 121.5631, 25.0358, '신이', 'taipei', 'TW', '🏨'),

  // ── 뉴욕 ──────────────────────────────────────────────────────────────────
  P('jfk', 'JFK 국제공항', 'airport', -73.7781, 40.6413, '퀸스', 'newyork', 'US', '🛬'),
  P('central-park', '센트럴파크', 'park', -73.9654, 40.7829, '맨해튼', 'newyork', 'US', '🗽'),
  P('brooklyn-bridge', '브루클린 브릿지', 'river', -73.9969, 40.7061, '브루클린', 'newyork', 'US', '🌉'),
  P('moma', 'MoMA', 'museum', -73.9776, 40.7614, '미드타운', 'newyork', 'US', '🖼️'),
  P('ny-public-library', '뉴욕공립도서관', 'library', -73.9822, 40.7532, '미드타운', 'newyork', 'US', '📚'),
  P('stumptown-nomad', '스텀프타운 커피', 'cafe', -73.9878, 40.7455, '노매드', 'newyork', 'US', '☕'),
  P('chelsea-market', '첼시마켓', 'market', -74.0060, 40.7424, '첼시', 'newyork', 'US', '🧺'),
  P('joes-pizza', '조스 피자', 'restaurant', -74.0021, 40.7305, '그리니치빌리지', 'newyork', 'US', '🍕'),
  P('katz-deli', '카츠 델리', 'restaurant', -73.9874, 40.7223, '로어이스트사이드', 'newyork', 'US', '🥪'),
  P('washington-square', '워싱턴 스퀘어 파크', 'park', -73.9973, 40.7308, '그리니치빌리지', 'newyork', 'US', '⛲'),
  P('blue-bottle-bryant', '블루보틀 브라이언트파크', 'cafe', -73.9832, 40.7536, '미드타운', 'newyork', 'US', '🫖'),
  P('shake-shack-msp', '쉐이크쉑 매디슨스퀘어파크', 'restaurant', -73.9882, 40.7414, '플랫아이언', 'newyork', 'US', '🍔'),
  P('grand-central', '그랜드센트럴역', 'station', -73.9772, 40.7527, '미드타운', 'newyork', 'US', '🚉'),
  P('high-line', '하이라인', 'park', -74.0048, 40.7480, '첼시', 'newyork', 'US', '🌿'),
  P('the-met', '메트로폴리탄 미술관', 'museum', -73.9632, 40.7794, '어퍼이스트', 'newyork', 'US', '🏛️'),
  P('macys-herald-square', '메이시스 헤럴드스퀘어', 'mall', -73.9895, 40.7508, '미드타운', 'newyork', 'US', '🛍️'),
  P('times-square', '타임스 스퀘어', 'mall', -73.9855, 40.7580, '미드타운', 'newyork', 'US', '🎭'),
  P('brooklyn-bridge-park', '브루클린 브릿지 파크', 'river', -73.9967, 40.7020, '덤보', 'newyork', 'US', '🛶'),
  P('devocion-williamsburg', '데보시온 윌리엄스버그', 'cafe', -73.9598, 40.7163, '윌리엄스버그', 'newyork', 'US', '☕'),
  P('levain-bakery', '르뱅 베이커리', 'cafe', -73.9801, 40.7797, '어퍼웨스트', 'newyork', 'US', '🍪'),
  P('top-of-the-rock', '록펠러센터 전망대', 'mountain', -73.9787, 40.7587, '미드타운', 'newyork', 'US', '🌃'),
  P('standard-high-line', '더 스탠다드 하이라인', 'hotel', -74.0080, 40.7409, '미트패킹', 'newyork', 'US', '🏨'),
];

// ─── 도시 레지스트리 ──────────────────────────────────────────────────────────
// 아래 세 표(허브·이름·시간대)는 상수처럼 읽지만 **가변**이다. 웹에서 찾아 온 도시(ADR-0009)가
// `registerCity`로 들어오면 여기에 같이 적힌다 — 제안·이동·시간대 코드는 도시 키만 보므로 바꿀 것이 없다.

export const CITY_HUBS: Record<string, CityHubs & { intlAirport?: string; hasSubway?: boolean }> = {
  seoul: { station: 'seoul-station', airport: 'gimpo-airport', intlAirport: 'incheon-airport', hasSubway: true },
  busan: { station: 'busan-station', airport: 'gimhae-airport', intlAirport: 'gimhae-airport', port: 'busan-port', hasSubway: true },
  gangneung: { station: 'gangneung-station' },
  gyeongju: { station: 'singyeongju-station' },
  jeonju: { station: 'jeonju-station' },
  yeosu: { station: 'yeosu-expo-station' },
  jeju: { airport: 'jeju-airport', intlAirport: 'jeju-airport', port: 'seongsan-port' },
  udo: { port: 'udo-port' },
  fukuoka: { port: 'hakata-port', airport: 'fukuoka-airport', intlAirport: 'fukuoka-airport', hasSubway: true },
  tokyo: { airport: 'haneda', intlAirport: 'haneda', hasSubway: true },
  osaka: { airport: 'kansai-airport', intlAirport: 'kansai-airport', hasSubway: true },
  taipei: { airport: 'taoyuan-airport', intlAirport: 'taoyuan-airport', hasSubway: true },
  newyork: { airport: 'jfk', intlAirport: 'jfk', hasSubway: true },
};

/** Korean display names for city keys (titles, comic captions). */
export const CITY_NAME_KO: Record<string, string> = {
  seoul: '서울', busan: '부산', gangneung: '강릉', gyeongju: '경주', jeonju: '전주', yeosu: '여수', jeju: '제주', udo: '우도',
  fukuoka: '후쿠오카', tokyo: '도쿄', osaka: '오사카', taipei: '타이베이', newyork: '뉴욕',
};
export const cityNameKo = (city: string) => CITY_NAME_KO[city] ?? city;
/** "교토" → "kyoto". 붙박이든 찾아 온 도시든. 모르면 null. */
export const cityKeyOfName = (nameKo: string): string | null => {
  const q = nameKo.normalize('NFC').trim();
  return Object.keys(CITY_NAME_KO).find(k => CITY_NAME_KO[k] === q || k === q.toLowerCase()) ?? null;
};

/** Nights a trip keeps the character there before the agent books the way home (FRIENDS_SPEC §5). 당일치기 = 0. */
export const CITY_STAY: Record<string, number> = {
  busan: 1, gangneung: 1, gyeongju: 1, jeonju: 1, yeosu: 1, jeju: 2, udo: 2,
  fukuoka: 2, tokyo: 2, osaka: 2, taipei: 2, newyork: 3,
};
/** 그 도시의 기본 체류 박수. 표에 없으면 해외 2박, 국내 1박. */
export const stayNightsOf = (city: string, country: string): number => CITY_STAY[city] ?? (country !== 'KR' ? 2 : 1);

// ─── time zones (TIMEZONE_SPEC) ─────────────────────────────────────────────
/** IANA zone per city key — the character lives in the zone of the place it is at. */
export const CITY_TZ: Record<string, string> = {
  seoul: 'Asia/Seoul', busan: 'Asia/Seoul', gangneung: 'Asia/Seoul', gyeongju: 'Asia/Seoul', jeonju: 'Asia/Seoul', yeosu: 'Asia/Seoul', jeju: 'Asia/Seoul', udo: 'Asia/Seoul',
  fukuoka: 'Asia/Tokyo', tokyo: 'Asia/Tokyo', osaka: 'Asia/Tokyo', taipei: 'Asia/Taipei', newyork: 'America/New_York',
};
const COUNTRY_TZ: Record<string, string> = { KR: 'Asia/Seoul', JP: 'Asia/Tokyo', TW: 'Asia/Taipei', US: 'America/New_York' };
export const tzOf = (p: Pick<Place, 'city' | 'country'>): string => CITY_TZ[p.city] ?? COUNTRY_TZ[p.country] ?? 'Asia/Seoul';
/** The first city key in `tz` (for the owner-clock pill: "서울 09:12"), or null when no city lives there. */
export const cityOfTz = (tz: string): string | null => Object.keys(CITY_TZ).find(c => CITY_TZ[c] === tz) ?? null;

const byId = new Map(PLACES.map(p => [p.id, p]));
export const placeById = (id: string): Place => {
  const p = byId.get(id);
  if (!p) throw new Error(`unknown place ${id}`);
  return p;
};
export const hasPlace = (id: string): boolean => byId.has(id);
/** remote(진짜 사람)로 등록된 id들 — 아래 registerRemotePlaces가 채운다 */
const remoteIds = new Set<string>();
/**
 * 붙박이·찾아 온 도시의 장소를 등록한다. 이미 있는 id는 건드리지 않되, 숨은 remote 장소(친구의 활동 장소)와 겹치면 내 팩의 것이 이긴다 —
 * 그 장소가 제안 스캔(PLACES)에 보이도록 바꿔 끼운다 (아래 "붙박이·찾아 온 도시의 장소와 id가 겹치면 그쪽이 이긴다").
 */
export const registerPlaces = (extra: Place[]) => {
  for (const p of extra) {
    if (remoteIds.has(p.id)) {
      const i = PLACES.indexOf(byId.get(p.id)!);
      if (i >= 0) PLACES[i] = p; else PLACES.push(p);
      byId.set(p.id, p);
      remoteIds.delete(p.id);
      continue;
    }
    if (!byId.has(p.id)) { PLACES.push(p); byId.set(p.id, p); }
  }
};

// ─── 진짜 사람 에이전트의 장소 (BACKEND-CONTRACT §3.4) ─────────────────────────
// 다른 사용자의 집(`home:<userId>`)과 발행된 활동의 장소는 `placeById`가 throw하지 않게 표에 넣되, 제안·마찰·여행 카드가
// 훑는 PLACES 배열에는 **내 도시의 친구 집만** 보인다 — 다른 도시의 남의 집이 여행지 후보(suggest.ts travelOptions)로 새지
// 않게. 숨은 장소는 id로만 찾힌다. 붙박이·찾아 온 도시의 장소와 id가 겹치면 그쪽이 이긴다(덮지 않는다 — 나중에 와도 registerPlaces가 바꿔 끼운다).

/**
 * remote 장소를 등록·갱신한다 (같은 id는 새 값으로 바꾼다 — 사용자가 이사할 수 있다).
 *
 * @param extra 장소들
 * @param visible PLACES 배열(제안 스캔)에도 보일지. 기본은 숨김
 */
export function registerRemotePlaces(extra: Place[], visible: (p: Place) => boolean = () => false) {
  for (const p of extra) {
    const cur = byId.get(p.id);
    if (cur && !remoteIds.has(p.id)) continue;   // 내 카탈로그의 장소 — 건드리지 않는다
    remoteIds.add(p.id);
    byId.set(p.id, p);
    const i = cur ? PLACES.indexOf(cur) : -1;
    if (visible(p)) { if (i >= 0) PLACES[i] = p; else PLACES.push(p); }
    else if (i >= 0) PLACES.splice(i, 1);
  }
}

// ─── 찾아 온 도시 (ADR-0009) ───────────────────────────────────────────────────
// 백엔드가 웹에서 찾아 만든 "도시 팩"(도시 정보 + 장소들)은 브라우저에 남는다. 하루보다 오래 살아야
// 새로고침해도 같은 하루가 나온다 — 장소 id가 사라지면 그 도시에서의 활동이 통째로 없어진다.
// 이 모듈은 `./types`와 잎 모듈(`./sync` → api·clock)만 import하므로 store.ts가 뜨기 전에 아래 hydrate가 먼저 돈다.

const PLACES_KEY = 'theworld.places.v1';
interface CityPack { info: CityInfo; places: Place[]; at: number }
interface PersistedPacks { v: 1; cities: Record<string, CityPack> }
const BUILTIN_CITIES: ReadonlySet<string> = new Set(Object.keys(CITY_NAME_KO));
const dynamic = new Map<string, CityPack>();

const isTz = (tz: unknown): tz is string => { if (typeof tz !== 'string' || !tz) return false; try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * 저장본(또는 백엔드 응답)에서 도시 팩들을 검증해 꺼낸다. 순수 함수 — 검사에서 그대로 본다.
 * 틀린 팩은 통째로 버린다 (장소 하나만 빠져도 허브가 깨질 수 있다).
 *
 * @param raw JSON.parse한 값
 * @returns 도시 키 → 팩. 붙박이 도시 키와 겹치는 팩은 버린다.
 */
export function loadDynamic(raw: unknown): Record<string, CityPack> {
  const out: Record<string, CityPack> = {};
  if (!raw || typeof raw !== 'object') return out;
  const cities = (raw as { cities?: unknown }).cities;
  if (!cities || typeof cities !== 'object') return out;
  for (const [key, v] of Object.entries(cities as Record<string, unknown>)) {
    const pack = validPack(key, v);
    if (pack) out[key] = pack;
  }
  return out;
}

/** 팩 하나를 검증한다. 틀리면 null. */
export function validPack(key: string, v: unknown): CityPack | null {
  if (!v || typeof v !== 'object' || BUILTIN_CITIES.has(key) || !/^[a-z][a-z0-9-]{1,30}$/.test(key)) return null;
  const { info, places, at } = v as { info?: Partial<CityInfo>; places?: unknown; at?: unknown };
  if (!info || info.key !== key || typeof info.nameKo !== 'string' || !info.nameKo.trim()) return null;
  if (typeof info.country !== 'string' || !/^[A-Z]{2}$/.test(info.country) || !isTz(info.tz)) return null;
  if (!Array.isArray(places) || !places.length) return null;
  const ok: Place[] = [];
  for (const p of places as Partial<Place>[]) {
    if (!p || typeof p.id !== 'string' || !p.id || typeof p.name !== 'string' || !p.name.trim()) return null;
    if (!(PLACE_TYPES as readonly string[]).includes(p.type as string) || !finite(p.lng) || !finite(p.lat)) return null;
    if (p.city !== key || typeof p.area !== 'string' || typeof p.country !== 'string') return null;
    if (p.type === 'home' || p.type === 'friend_home') return null;
    const place: Place = { id: p.id, name: p.name.trim(), type: p.type as Place['type'], lng: p.lng, lat: p.lat, area: p.area, city: key, country: p.country, emoji: typeof p.emoji === 'string' && p.emoji ? p.emoji : '📍' };
    if (p.reachBy === 'boat' || p.reachBy === 'plane' || p.reachBy === 'train') place.reachBy = p.reachBy;
    ok.push(place);
  }
  if (new Set(ok.map(p => p.id)).size !== ok.length) return null;
  const hubs0 = info.hubs && typeof info.hubs === 'object' ? info.hubs : {};
  const hubs: CityInfo['hubs'] = {};
  for (const k of ['station', 'airport', 'port', 'intlAirport'] as const) {
    const id = hubs0[k];
    if (id === undefined) continue;
    if (typeof id !== 'string' || !ok.some(p => p.id === id)) return null;
    hubs[k] = id;
  }
  if (hubs0.hasSubway === true) hubs.hasSubway = true;
  const stayNights = finite(info.stayNights) ? Math.max(0, Math.min(5, Math.round(info.stayNights))) : (info.country !== 'KR' ? 2 : 1);
  return {
    info: { key, nameKo: info.nameKo.trim(), ...(typeof info.nameEn === 'string' ? { nameEn: info.nameEn } : {}), country: info.country, tz: info.tz, stayNights, hubs },
    places: ok,
    at: finite(at) ? at : 0,
  };
}

const saveDynamic = () => {
  const packs = { v: 1, cities: Object.fromEntries(dynamic) } satisfies PersistedPacks;
  try { localStorage.setItem(PLACES_KEY, JSON.stringify(packs)); } catch { /* ignore */ }
  onLocalSave('places', packs);   // 서버의 places 문서 (BACKEND-CONTRACT §3.3) — 다른 기기에서도 그 도시의 활동 id가 살아 있게
};

/** 팩 하나를 표들에 적는다 (저장은 호출자가). */
const apply = (pack: CityPack) => {
  const { info } = pack;
  dynamic.set(info.key, pack);
  registerPlaces(pack.places);
  CITY_HUBS[info.key] = { ...info.hubs };
  CITY_NAME_KO[info.key] = info.nameKo;
  CITY_TZ[info.key] = info.tz;
  CITY_STAY[info.key] = info.stayNights;
};

/**
 * 찾아 온 도시를 등록하고 저장한다. 같은 키가 이미 있으면 새 팩으로 바꾼다 (장소는 추가만 — 옛 id는 남겨
 * 이미 계획된 활동이 깨지지 않게 한다).
 *
 * @param info 도시 정보
 * @param places 그 도시의 장소들 (허브 포함, `city === info.key`)
 * @returns 등록됐으면 true. 검증에 걸리면 false — 아무것도 바뀌지 않는다.
 */
export function registerCity(info: CityInfo, places: Place[]): boolean {
  const pack = validPack(info.key, { info, places, at: Date.now() });
  if (!pack) return false;
  apply(pack);
  saveDynamic();
  return true;
}

/** 등록된(찾아 온) 도시들. 붙박이는 빼고. */
export const dynamicCities = (): CityInfo[] => [...dynamic.values()].map(p => p.info);

/** 찾아 온 도시를 전부 잊는다. 장소 표에서도 지우므로 **그 도시를 참조하는 하루는 함께 초기화해야 한다** (resetDay). */
export function forgetDynamicCities() {
  for (const [key, pack] of dynamic) {
    for (const p of pack.places) { byId.delete(p.id); const i = PLACES.indexOf(p); if (i >= 0) PLACES.splice(i, 1); }
    delete CITY_HUBS[key]; delete CITY_NAME_KO[key]; delete CITY_TZ[key]; delete CITY_STAY[key];
  }
  dynamic.clear();
  try { localStorage.removeItem(PLACES_KEY); } catch { /* ignore */ }
}

/** 저장된 팩을 표에 올린다. 모듈이 뜰 때 한 번. */
function hydrateDynamic() {
  let raw: unknown = null;
  try { const s = localStorage.getItem(PLACES_KEY); raw = s ? JSON.parse(s) : null; } catch { return; }
  for (const pack of Object.values(loadDynamic(raw))) apply(pack);
}
hydrateDynamic();
