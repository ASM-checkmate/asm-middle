import type { BlockId, Comic, ComicPanel, Memory, PlaceType, ScheduledActivity, TransportMode } from './types';
import { splitDayKey } from './types';
import { rng } from './rng';
import type { FrictionKind } from './friction';
import { cityNameKo, placeById } from './places';
import { agentById } from './agents';
import { blockSlotIn } from './blocks';

// Rule-based 4-panel comic writer. Grounded in the real place type + what happened. (LLM later; keep signature.)
// Every caption ≤ 28 Korean characters so it fits a panel. Placeholders: {place} {area} {friend} {mode} {act} {like} {name}

interface Script { arrive: string[]; doing: string[]; twist: string[]; twistFriend: string[]; end: string[] }

// Panel grounds per place type — four tokens, one per beat (the deck varies the ground per panel).
const BG: Record<string, [string, string, string, string]> = {
  cafe:        ['var(--sun-2)',   'var(--paper-2)', 'var(--sky-2)',   'var(--coral-2)'],
  restaurant:  ['var(--coral-2)', 'var(--sun-2)',   'var(--paper-2)', 'var(--mint-2)'],
  park:        ['var(--mint-2)',  'var(--sky-2)',   'var(--sun-2)',   'var(--paper-2)'],
  river:       ['var(--sky-2)',   'var(--mint-2)',  'var(--sun-2)',   'var(--coral-2)'],
  beach:       ['var(--sky-2)',   'var(--sun-2)',   'var(--mint-2)',  'var(--coral-2)'],
  gym:         ['var(--mint-2)',  'var(--coral-2)', 'var(--sun-2)',   'var(--paper-2)'],
  library:     ['var(--sun-2)',   'var(--paper-2)', 'var(--mint-2)',  'var(--sky-2)'],
  mall:        ['var(--sky-2)',   'var(--coral-2)', 'var(--sun-2)',   'var(--paper-2)'],
  museum:      ['var(--paper-2)', 'var(--sun-2)',   'var(--sky-2)',   'var(--mint-2)'],
  home:        ['var(--paper-2)', 'var(--sun-2)',   'var(--coral-2)', 'var(--sky-2)'],
  friend_home: ['var(--paper-2)', 'var(--mint-2)',  'var(--sun-2)',   'var(--coral-2)'],
  bar:         ['var(--coral-2)', 'var(--sun-2)',   'var(--paper-2)', 'var(--sky-2)'],
  cinema:      ['var(--sky-2)',   'var(--paper-2)', 'var(--coral-2)', 'var(--sun-2)'],
  arcade:      ['var(--coral-2)', 'var(--sky-2)',   'var(--sun-2)',   'var(--mint-2)'],
  market:      ['var(--sun-2)',   'var(--coral-2)', 'var(--paper-2)', 'var(--mint-2)'],
  mountain:    ['var(--mint-2)',  'var(--sky-2)',   'var(--sun-2)',   'var(--coral-2)'],
  temple:      ['var(--paper-2)', 'var(--mint-2)',  'var(--sun-2)',   'var(--sky-2)'],
  island:      ['var(--sky-2)',   'var(--mint-2)',  'var(--sun-2)',   'var(--coral-2)'],
  hotel:       ['var(--paper-2)', 'var(--sun-2)',   'var(--sky-2)',   'var(--coral-2)'],
  default:     ['var(--paper-2)', 'var(--sky-2)',   'var(--sun-2)',   'var(--coral-2)'],
};

const S: Record<string, Script> = {
  cafe: {
    arrive: ['{place} 도착. 창가 자리가 비어 있다!', '{place} 문 열자마자 커피 냄새.', '{place} 앞. 오늘은 줄이 없다.', '{mode} {place}까지. 벌써 기대됨.', '{place} 도착. 메뉴판이 바뀌었다.', '{place}. 사장님이 알아봐 줬다.', '{place} 2층 구석 자리 확보 성공.', '{place} 도착. 비 오는 날 카페 최고.', '{place}. 일찍 와서 한산하다.'],
    doing: ['{act} 시작. 첫 잔은 항상 맛있다.', '{act} 중. 옆 테이블 케이크가 자꾸 보임.', '라떼 한 모금, {act} 한 번. 반복.', '{act} 중. 음악이 딱 취향이다.', '{act} 하다가 창밖 사람 구경.', '{act}. 집중이 잘 되는 날이다.', '{act} 중. 커피가 벌써 다 식었다.', '{act}. 결국 디저트도 시켰다.'],
    twist: ['고양이 그린 건데 강아지냐고 물어봤다.', '옆자리 사람이 내 노트를 힐끔. 뿌듯.', '주문한 거랑 다른 게 나왔다. 근데 맛있다.', '갑자기 비. 창밖만 30분 봤다.', '콘센트 자리 뺏길 뻔. 아슬아슬.', '사장님이 쿠키 하나 서비스로 주셨다.', '{like} 얘기하는 옆 테이블에 귀 쫑긋.', '라떼 아트가 곰이다. 못 마시겠다.', '노트북 배터리 3%. 급하게 마무리.'],
    twistFriend: ['{friend}가 우연히 같은 카페에 나타났다.', '{friend}: "그거 고양이야?" 강아지였다.', '{friend}가 내 케이크 한 입 훔쳐 먹었다.', '{friend}랑 사진 찍는데 둘 다 눈 감았다.', '{friend}가 자기 커피가 더 맛있다고 우김.', '{friend}랑 다음 여행 계획을 세워버렸다.'],
    end: ['결국 고양이로 고쳤다. 다음은 뭐 하지.', '컵 반납하고 나오니 해가 기울었다.', '다음엔 {friend}도 데려와야지.', '오늘 여기 온 건 잘한 일이다.', '원두 한 봉지 사서 집에 간다.', '창가 자리, 다음에도 여기다.', '{area} 골목 한 바퀴 돌고 마무리.', '배도 부르고 마음도 부르다.'],
  },
  restaurant: {
    arrive: ['{place} 도착. 웨이팅 0팀!', '{place} 앞. 냄새부터 맛있다.', '{place} 도착. 오늘은 창가 테이블.', '{place}. 메뉴판 보자마자 고민 시작.', '{mode} {place}. 배가 딱 맞게 고프다.', '{place} 도착. 줄이 짧아서 다행.', '{place}. 사장님이 "또 왔네" 하셨다.', '{place} 도착. 물부터 한 컵.'],
    doing: ['{act}. 첫 입에 눈이 커졌다.', '{act} 중. 사진 먼저, 먹는 건 나중.', '{act}. 국물까지 싹 비울 기세.', '{act} 중. 반찬 리필 두 번째.', '{act}. 옆 테이블 메뉴가 더 맛있어 보임.', '{act}. 매운데 손이 멈추질 않는다.', '{act} 중. 젓가락질이 빨라진다.', '{act}. 이 집 김치 진짜 잘한다.'],
    twist: ['주문한 거랑 다른 게 나왔다. 근데 맛있다.', '너무 매워서 물 세 컵.', '사장님이 서비스 계란찜 주셨다.', '마지막 한 입을 두고 고민 10분.', '옆 테이블 아기가 나한테 손 흔들었다.', '숨은 맛집인 줄 알았는데 웨이팅 생김.', '지갑을 두고 온 줄 알았다. 뒷주머니에.', '{like} 얘기하는 옆 테이블에 귀 쫑긋.', '밥 한 공기 추가. 후회 없음.'],
    twistFriend: ['{friend}가 내 반찬을 다 먹었다.', '{friend}: "한 입만" 하더니 세 입.', '{friend}랑 누가 더 매운 거 잘 먹나 대결.', '{friend}가 계산하겠다고 우겨서 졌다.', '{friend}랑 사진 찍는데 둘 다 입에 밥.', '{friend}가 몰래 시킨 사이드가 대박.'],
    end: ['배 두드리며 나왔다. 대만족.', '다음엔 다른 메뉴 먹어보기로.', '소화시킬 겸 {area} 한 바퀴.', '포장까지 해서 집에 간다.', '오늘의 한 끼, 성공적.', '다음 블록은 무조건 산책이다.', '식당 명함 챙겼다. 또 올 거니까.', '배부르니까 세상이 다 예쁘다.'],
  },
  park: {
    arrive: ['{place} 도착. 바람이 딱 좋다.', '{place} 입구. 벌써 강아지 세 마리 봄.', '{place}. 잔디 냄새가 난다.', '{mode} {place}. 도착하자마자 기지개.', '{place} 도착. 나무 그늘 자리 확보.', '{place}. 사람이 없어 조용하다.', '{place} 도착. 벤치가 비어 있다!', '{place}. 하늘이 파란 날이다.'],
    doing: ['{act} 중. 발걸음이 가볍다.', '{act}. 지나가는 강아지마다 인사.', '{act} 중. 새소리가 배경음악.', '{act}. 벤치에 앉아서 잠깐 쉬었다.', '{act} 중. 바람에 모자 날아갈 뻔.', '{act}. 나뭇잎 사이로 햇빛이 반짝.', '{act} 하다가 꽃 사진 찍었다.', '{act} 중. 오늘 하늘 진짜 파랗다.'],
    twist: ['강아지가 따라왔다. 주인이 미안해했다.', '비둘기 떼가 갑자기 날아올랐다.', '낯선 아이가 "안녕" 하고 뛰어갔다.', '갑자기 소나기. 나무 밑으로 대피.', '네잎클로버 찾았다! 진짜로.', '길고양이가 옆에 와서 앉았다.', '벤치에서 잠깐 졸았다. 20분.', '풍선 하나가 하늘로 날아갔다.', '벌 한 마리가 계속 따라와서 도망.'],
    twistFriend: ['{friend}가 저 멀리서 손 흔들며 뛰어왔다.', '{friend}랑 배드민턴. 셔틀콕이 나무에.', '{friend}가 돗자리랑 간식을 들고 왔다.', '{friend}랑 사진 찍는데 비둘기가 난입.', '{friend}가 자기가 더 빨리 달린다고 우김.', '{friend}랑 벤치에 누워서 구름 이름 짓기.'],
    end: ['해질녘 공원. 오늘 여기 온 건 잘했다.', '신발에 흙 묻은 채로 집에 간다.', '다음엔 돗자리 챙겨 와야지.', '바람 쐬니까 머리가 맑아졌다.', '만보 달성. 뿌듯하게 마무리.', '나뭇잎 하나 주워서 책갈피로.', '{area} 골목으로 천천히 돌아간다.', '다음 블록은 뭐 하지. 배고프다.'],
  },
  river: {
    arrive: ['{place} 도착. 강바람이 시원하다.', '{place}. 자전거 소리가 쌩쌩.', '{place} 도착. 강물이 반짝반짝.', '{mode} {place}. 도착하자마자 심호흡.', '{place}. 편의점 라면 냄새가 유혹한다.', '{place} 도착. 잔디밭 자리 잡기 성공.', '{place}. 다리 위로 지하철이 지나간다.', '{place} 도착. 해 지기 전에 왔다!'],
    doing: ['{act} 중. 강바람이 밀어준다.', '{act}. 자전거 무리를 피해 슬슬.', '{act} 중. 강 건너 빌딩이 예쁘다.', '{act}. 잔디에 누워 하늘 보기.', '{act} 중. 오리 가족이 지나간다.', '{act}. 노을이 물에 비친다.', '{act} 하다가 편의점 라면 끓임.', '{act} 중. 발이 가볍다.'],
    twist: ['보드에서 떨어질 뻔. 아무도 못 봄.', '갑자기 바람이 세져서 모자 날아감.', '오리한테 과자 뺏겼다.', '치킨 배달이 옆 돗자리에 도착. 부럽.', '노을이 너무 예뻐서 20분 멈춰 있었다.', '자전거가 종을 울리며 지나갔다. 깜짝.', '버스킹 소리에 홀려서 구경.', '라면 물 조절 실패. 그래도 맛있다.', '갈매기가 한강까지 왔다. 신기.'],
    twistFriend: ['{friend}가 보드 타고 나타났다.', '{friend}랑 라면 하나를 나눠 먹었다.', '{friend}가 넘어져서 둘 다 웃음 폭발.', '{friend}랑 치킨 시켰다. 배달 40분.', '{friend}랑 노을 사진 찍기 대결.', '{friend}가 오리한테 이름 지어줬다.'],
    end: ['노을 보고 집에 간다. 완벽한 하루.', '다음엔 자전거 빌려야지.', '무릎이 조금 아프지만 행복하다.', '강바람 맞으니 고민이 날아갔다.', '편의점 아이스크림으로 마무리.', '한강은 언제 와도 좋다.', '{area}까지 슬슬 걸어서 돌아간다.', '다음 블록은 씻고 쉬기다.'],
  },
  beach: {
    arrive: ['{place} 도착. 파도 소리부터 들린다.', '{place}. 모래가 발에 닿자 신발 벗음.', '{place} 도착. 바다 색이 미쳤다.', '{mode} {place}. 창밖 바다부터 봤다.', '{place}. 갈매기가 인사 왔다.', '{place} 도착. 바람에 머리가 엉망.', '{place}. 물이 생각보다 따뜻하다.', '{place} 도착. 파라솔 자리 확보.'],
    doing: ['{act} 중. 파도가 발을 간지럽힌다.', '{act}. 조개껍데기 세 개 주움.', '{act} 중. 수평선만 계속 봤다.', '{act}. 모래성 쌓다가 파도에 무너짐.', '{act} 중. 바닷바람에 눈이 감긴다.', '{act}. 선크림 바르는 걸 깜빡했다.', '{act} 중. 갈매기랑 눈싸움.', '{act}. 파도 타는 사람 구경.'],
    twist: ['파도가 생각보다 커서 바지가 다 젖음.', '갈매기가 과자를 낚아채 갔다.', '모래 속에서 작은 게가 튀어나왔다.', '휴대폰 모래 범벅. 다행히 멀쩡.', '노을이 시작되자 다들 조용해졌다.', '해변 강아지가 공을 물고 왔다.', '컵라면이 바다 앞에서 5배 맛있다.', '모자가 바다로. 다행히 파도가 돌려줌.', '발자국이 예뻐서 사진 20장.'],
    twistFriend: ['{friend}가 물 튀기며 달려왔다.', '{friend}랑 모래성 대결. 파도가 심판.', '{friend}가 파도에 밀려 넘어졌다.', '{friend}랑 회 한 접시 나눠 먹음.', '{friend}랑 조개껍데기로 이름 쓰기.', '{friend}가 조개 소리를 들려줬다.'],
    end: ['모래 털고 집에 간다. 발가락에 아직 모래.', '바다는 사진보다 실물이 낫다.', '조개껍데기 하나 주머니에 넣었다.', '다음엔 수영복 챙겨 와야지.', '피부가 조금 탔다. 훈장이다.', '바닷바람 냄새가 옷에 남았다.', '노을 보고 나니 하루가 꽉 찼다.', '돌아가는 길, 벌써 그립다.'],
  },
  gym: {
    arrive: ['{place} 도착. 러닝머신은 만석.', '{place}. 락커 열쇠 받고 심호흡.', '{place} 도착. 거울 앞에서 결심 한 번.', '{mode} {place}. 운동복 챙겼나 확인.', '{place}. 새 운동화 첫 등판.', '{place} 도착. 오늘은 하체다.', '{place}. 음악 볼륨 최대로.', '{place} 도착. 사람 없는 골든타임.'],
    doing: ['{act} 중. 첫 세트부터 다리가 후들.', '{act}. 거울 속 내가 좀 멋있다.', '{act} 중. 물 마시는 시간이 제일 좋다.', '{act}. 무게를 조금 올려봤다.', '{act} 중. 숨이 턱까지 찼다.', '{act}. 옆 사람 자세를 슬쩍 따라함.', '{act} 중. 세트 세는 걸 까먹었다.', '{act}. 땀이 비 오듯.'],
    twist: ['무게 잘못 세팅. 바벨이 안 올라갔다.', '트레이너가 자세 교정. 조금 창피.', '러닝머신 속도 실수로 최대. 살았다.', '노래가 발라드로 바뀜. 흐름 깨짐.', '옆 사람이 "몇 세트 남았어요?" 대화 시작.', '거울 보다가 발 헛디딤. 아무도 못 봄.', '락커 번호를 까먹었다. 세 개 열어봄.', '단백질 바가 생각보다 맛있다.', '오늘 기록 갱신! 1kg이지만.'],
    twistFriend: ['{friend}가 옆 러닝머신에 나타났다.', '{friend}랑 누가 더 오래 버티나 플랭크.', '{friend}가 자세 봐준다더니 웃기만 함.', '{friend}랑 세트 사이에 수다 20분.', '{friend}가 나보다 무거운 거 들어서 분함.', '{friend}가 운동 끝나고 치킨 먹자고 함.'],
    end: ['내일 근육통 확정. 그래도 뿌듯.', '샤워하고 나오니 세상이 가볍다.', '단백질 쉐이크로 마무리.', '오늘 운동 도장 하나 더.', '다리가 후들거리지만 기분은 최고.', '집까지 걸어가기로. 쿨다운.', '다음엔 상체 차례다.', '운동 끝, 배고픔 시작.'],
  },
  library: {
    arrive: ['{place} 도착. 종이 냄새가 좋다.', '{place}. 창가 자리 하나 남았다!', '{place} 도착. 오늘 목표는 두 챕터.', '{mode} {place}. 조용히 문을 열었다.', '{place}. 서가 사이를 천천히 걸었다.', '{place} 도착. 신간 코너부터 확인.', '{place}. 콘센트 자리 확보 성공.', '{place} 도착. 에어컨이 딱 좋다.'],
    doing: ['{act} 중. 첫 페이지부터 몰입.', '{act}. 옆 사람 연필 소리가 리듬감 있다.', '{act} 중. 모르는 단어 세 개 검색.', '{act}. 책 한 권 더 뽑아 왔다.', '{act} 중. 창밖 구름이 자꾸 시선을 뺏는다.', '{act}. 포스트잇 다섯 장 붙임.', '{act} 중. 졸음이 두 번 왔다 갔다.', '{act}. 시간 가는 줄 몰랐다.'],
    twist: ['배에서 꼬르륵. 옆 사람이 웃음 참음.', '휴대폰 알람이 울렸다. 도서관에서.', '찾던 책이 바로 옆 서가에 있었다.', '{like} 관련 책을 우연히 발견.', '연필심이 부러졌다. 세 번째.', '창밖에 비. 도서관 분위기 완성.', '누가 책갈피로 만 원을 끼워놨다.', '졸다가 책에 얼굴 자국.', '대출 한도 초과. 두 권 반납하고 빌림.'],
    twistFriend: ['{friend}가 맞은편 자리에 앉았다.', '{friend}가 쪽지를 건넸다. "배고파".', '{friend}랑 눈 마주치고 둘 다 웃음 참기.', '{friend}가 같은 책을 골라 왔다.', '{friend}가 계속 졸아서 깨워줌.', '{friend}랑 쉬는 시간에 자판기 커피.'],
    end: ['책 두 권 빌려서 나왔다. 무겁다.', '머리에 뭔가 들어찬 느낌.', '다음 챕터는 내일.', '읽은 페이지 수 세어보니 뿌듯.', '반납일 메모하고 집에 간다.', '조용한 시간이 필요했던 것 같다.', '다음엔 더 일찍 와서 창가 자리.', '눈이 뻑뻑하다. 잘 읽었다.'],
  },
  mall: {
    arrive: ['{place} 도착. 에어컨이 천국.', '{place}. 입구부터 신상이 반짝.', '{place} 도착. 지갑 단속 다짐.', '{mode} {place}. 사람 진짜 많다.', '{place}. 층별 안내도부터 확인.', '{place} 도착. 오늘은 구경만... 아마.', '{place}. 팝업스토어가 열려 있다!', '{place} 도착. 배경음악이 신난다.'],
    doing: ['{act} 중. 세일 코너에서 발이 안 떨어짐.', '{act}. 시착만 다섯 번째.', '{act} 중. 문구 코너에서 30분.', '{act}. 향수 시향하다 코가 마비.', '{act} 중. 에스컬레이터만 열 번.', '{act}. 푸드코트 냄새가 유혹한다.', '{act} 중. 장바구니 담았다 뺐다.', '{act}. 쇼윈도 앞에서 셀카.'],
    twist: ['살 생각 없던 양말을 샀다. 귀여워서.', '세일인 줄 알았는데 옆 상품이었다.', '시식 코너 세 바퀴. 배부름.', '엘리베이터 문 닫히기 직전에 탑승.', '팝업에서 굿즈 마지막 하나 득템.', '배터리 5%. 충전기 찾아 삼만리.', '거울에 비친 내 옷차림, 나쁘지 않다.', '{like} 굿즈를 발견. 참았다.', '길을 잃었다. 같은 매장 세 번째.'],
    twistFriend: ['{friend}가 같은 층에서 손 흔들었다.', '{friend}가 "이거 어때?" 다섯 번째.', '{friend}랑 인생네컷. 둘 다 눈 감음.', '{friend}가 몰래 내 선물을 샀다.', '{friend}랑 푸드코트 메뉴 결정 20분.', '{friend}가 시착한 모자가 너무 웃겼다.'],
    end: ['쇼핑백 하나. 선방했다.', '구경만 했는데 다리가 아프다.', '다음엔 지갑 놓고 와야지.', '결국 아무것도 안 샀다. 승리.', '{area} 야경 보며 집으로.', '양말 하나가 오늘의 전리품.', '발바닥이 뜨겁다. 잘 놀았다.', '다음 블록은 쉬어야겠다.'],
  },
  museum: {
    arrive: ['{place} 도착. 입구부터 웅장하다.', '{place}. 티켓 사고 심호흡.', '{place} 도착. 오디오 가이드 빌림.', '{mode} {place}. 생각보다 한산하다.', '{place}. 첫 전시실부터 압도됨.', '{place} 도착. 오늘 기획전이 있다!', '{place}. 조용해서 발소리가 크다.', '{place} 도착. 카메라 준비 완료.'],
    doing: ['{act} 중. 그림 앞에서 10분 멈춤.', '{act}. 설명문 다 읽는 사람은 나뿐.', '{act} 중. 이 작품 색이 취향이다.', '{act}. 옛날 물건이 신기하다.', '{act} 중. 조용히 걷는 게 좋다.', '{act}. 도슨트 설명에 고개 끄덕끄덕.', '{act} 중. 벤치에서 잠깐 숨 돌리기.', '{act}. 스케치북을 꺼냈다.'],
    twist: ['작품이 고양이인 줄 알았는데 호랑이.', '경비원이 "만지지 마세요". 안 만졌는데.', '기념품샵에서 엽서 다섯 장.', '다른 관람객이 내 스케치를 칭찬.', '조명이 갑자기 꺼졌다. 폐관 5분 전.', '아이가 작품 보고 "우리 집 강아지".', '너무 좋아서 같은 방 세 번 들어감.', '{like} 관련 전시가 있었다. 횡재.', '오디오 가이드 방전. 눈으로 보기.'],
    twistFriend: ['{friend}가 다른 전시실에서 튀어나왔다.', '{friend}가 작품 해석을 지어내기 시작.', '{friend}랑 좋아하는 작품 하나씩 고르기.', '{friend}가 기념품샵에서 나보다 더 샀다.', '{friend}랑 작품 포즈 따라하기.', '{friend}가 계속 "이건 나도 그리겠다".'],
    end: ['엽서 한 장 사서 나왔다.', '머릿속이 색으로 가득 찼다.', '다음엔 도슨트 시간 맞춰 와야지.', '전시 본 날은 뭔가 어른이 된 느낌.', '{area} 골목 걸으며 여운 즐기기.', '스케치북에 한 장 더 늘었다.', '눈이 호강했다.', '다음 블록은 카페에서 정리다.'],
  },
  home: {
    arrive: ['집. 문 열자마자 소파로 직행.', '집 도착. 양말부터 벗었다.', '집. 오늘은 밖에 안 나가는 날.', '집. 창문 열고 바람 한 번.', '집 도착. 냉장고 문부터 열었다.', '집. 잠옷으로 갈아입으니 완성.', '집. 조명 낮추고 음악 켬.', '집. 오늘 할 일: {act}.'],
    doing: ['{act} 중. 소파가 놓아주지 않는다.', '{act}. 간식이 벌써 두 번째.', '{act} 중. 창밖 소리가 배경음악.', '{act}. 시간 가는 줄 모르겠다.', '{act} 중. 잠깐 눕기가 30분.', '{act}. 이불 속이 최고다.', '{act} 중. 배달앱을 열었다 닫았다.', '{act}. 혼자여도 심심하지 않다.'],
    twist: ['택배가 왔다. 뭘 시켰는지 기억 안 남.', '스테이지 마지막에서 또 죽었다.', '냉장고에 남은 건 계란 하나. 계란밥.', '갑자기 청소 욕구. 30분 만에 끝.', '창밖에서 고양이가 쳐다보고 있었다.', '전화가 왔다. 스팸이었다.', '낮잠 잔다는 게 두 시간.', '옛날 사진첩 발견. 30분 삼매경.', '화분에 새 잎이 났다!'],
    twistFriend: ['{friend}가 갑자기 찾아왔다. 과자 들고.', '{friend}랑 게임 대결. 내가 이겼다.', '{friend}가 냉장고를 열어 밥을 해줬다.', '{friend}랑 영화 보다 둘 다 잠듦.', '{friend}가 내 화분 이름을 지어줬다.', '{friend}랑 배달 메뉴 고르기 30분.'],
    end: ['집이 최고다. 다음 블록도 집?', '잘 쉬었다. 이제 나갈 힘이 생겼다.', '방이 조금 더 깨끗해졌다.', '오늘 스테이지 클리어. 드디어.', '이불 정리하고 하루 이어가기.', '충전 완료. 배터리 100%.', '창문 닫고 다음 계획 세우기.', '집에서 뒹군 날도 소중하다.'],
  },
  friend_home: {
    arrive: ['{place} 도착. 초인종 누르기 전 심호흡.', '{place}. 문 열자마자 "왔어?".', '{place} 도착. 간식 사 들고 왔다.', '{mode} {place}. 골목이 익숙하다.', '{place}. 신발 벗자마자 소파 점령.', '{place} 도착. 집이 더 깨끗해졌다.', '{place}. {friend}가 문 앞에서 기다림.', '{place} 도착. 강아지가 먼저 반겼다.'],
    doing: ['{act} 중. 벌써 웃음이 세 번.', '{act}. {friend}네 냉장고 습격.', '{act} 중. 소파 쟁탈전.', '{act}. 얘기하다 보니 두 시간.', '{act} 중. 배달 시킬까 말까.', '{act}. {friend}가 새 게임 보여줌.', '{act} 중. 옛날 얘기 시작.', '{act}. 음악 틀어놓고 뒹굴.'],
    twist: ['{friend}가 새로 산 게임에서 나를 이김.', '{friend}가 만든 떡볶이가 너무 매웠다.', '{friend}네 강아지가 내 무릎에서 잠듦.', '{friend}랑 배달 메뉴 고르다 30분.', '{friend}가 내 옛날 사진을 꺼내왔다.', '{friend}랑 라면 끓이다 물 넘침.', '{friend}가 내 그림을 냉장고에 붙였다.', '{friend}랑 보드게임. 세 판 연속 패배.', '{friend}가 몰래 케이크를 준비했다.'],
    twistFriend: ['{friend}가 새로 산 게임에서 나를 이김.', '{friend}가 만든 떡볶이가 너무 매웠다.', '{friend}네 강아지가 내 무릎에서 잠듦.', '{friend}랑 배달 메뉴 고르다 30분.', '{friend}가 내 옛날 사진을 꺼내왔다.', '{friend}랑 라면 끓이다 물 넘침.', '{friend}가 내 그림을 냉장고에 붙였다.', '{friend}랑 보드게임. 세 판 연속 패배.', '{friend}가 몰래 케이크를 준비했다.'],
    end: ['집에 가기 싫지만 간다.', '다음엔 우리 집에서 보기로.', '{friend}가 준 반찬 들고 귀가.', '웃다가 배 아픈 하루.', '골목까지 배웅받았다.', '다음 주에 또 오기로 약속.', '{friend}네 강아지가 그리울 것 같다.', '친구가 있어서 다행이다.'],
  },
  bar: {
    arrive: ['{place} 도착. 벌써 시끌시끌.', '{place}. 구석 자리 확보 성공.', '{place} 도착. 오늘 안주 뭐 먹지.', '{mode} {place}. 골목 불빛이 예쁘다.', '{place}. 사장님이 자리 안내.', '{place} 도착. 라이브 준비 중이다.', '{place}. 첫 잔부터 시원하다.', '{place} 도착. 메뉴판이 손글씨다.'],
    doing: ['{act} 중. 안주가 술을 부른다.', '{act}. 옆 테이블 웃음소리가 전염.', '{act} 중. 노래가 취향 저격.', '{act}. 두 번째 잔은 천천히.', '{act} 중. 노가리 한 마리 더.', '{act}. 조명이 딱 좋다.', '{act} 중. 오늘 얘기가 잘 풀린다.', '{act}. 밖은 어둡고 안은 따뜻하다.'],
    twist: ['사장님이 서비스 안주를 주셨다.', '옆 테이블이 생일 축하. 같이 박수.', '주문 안 한 안주가 나왔다. 맛있다.', '라이브 가수가 신청곡을 받아줬다.', '지갑 두고 온 줄. 앞주머니에.', '갑자기 정전 3초. 다 같이 "와".', '창밖에 비. 분위기 완성.', '옆 테이블 강아지가 나를 좋아한다.', '노래 따라 부르다 음정 이탈.'],
    twistFriend: ['{friend}가 문 열고 들어왔다. 늦었다.', '{friend}랑 누가 안주를 더 잘 고르나.', '{friend}가 갑자기 진지한 얘기 시작.', '{friend}랑 옛날 얘기로 웃음 폭발.', '{friend}가 노래 신청. 내 최애곡.', '{friend}가 계산하겠다고 우겨서 졌다.'],
    end: ['기분 좋게 취해서 걸어간다.', '밤공기가 딱 좋다.', '다음엔 다른 안주 시켜보기로.', '골목 불빛 보며 천천히 귀가.', '오늘 얘기 많이 했다. 후련.', '편의점 아이스크림으로 마무리.', '집까지 걸어가며 노래 흥얼.', '내일 아침은 늦잠 확정.'],
  },
  cinema: {
    arrive: ['{place} 도착. 팝콘 냄새부터.', '{place}. 발권 성공. 가운데 자리.', '{place} 도착. 예고편 전에 앉았다.', '{mode} {place}. 딱 맞춰 왔다.', '{place}. 팝콘 반반, 콜라 라지.', '{place} 도착. 오늘은 혼자 영화.', '{place}. 상영관이 텅 비었다!', '{place} 도착. 포스터 앞에서 사진.'],
    doing: ['{act} 중. 첫 장면부터 몰입.', '{act}. 팝콘이 예고편에서 반 사라짐.', '{act} 중. 옆 사람이 울기 시작.', '{act}. 소리가 온몸에 울린다.', '{act} 중. 화장실을 참았다.', '{act}. 반전에 입 벌어짐.', '{act} 중. 콜라를 너무 빨리 마셨다.', '{act}. 엔딩 크레딧까지 앉아 있었다.'],
    twist: ['쿠키 영상이 있었다! 남은 사람 셋.', '앞자리 사람 머리가 커서 자세 변경.', '휴대폰 울릴 뻔. 무음 확인 세 번.', '팝콘을 바닥에 쏟았다. 조용히.', '결말을 예상했는데 완전히 빗나감.', '울컥해서 눈물. 아무도 못 봄.', '옆자리 커플이 계속 속닥속닥.', '{like} 얘기가 영화에 나와서 반가움.', '자막이 잠깐 사라졌다. 5초.'],
    twistFriend: ['{friend}가 옆자리에서 팝콘을 훔쳤다.', '{friend}가 반전에서 소리 질렀다.', '{friend}가 영화 중간에 잠들었다.', '{friend}랑 결말 해석으로 토론 30분.', '{friend}가 내 콜라를 다 마셨다.', '{friend}랑 쿠키 영상까지 버텼다.'],
    end: ['여운이 길다. 천천히 걸어간다.', '팝콘 냄새가 옷에 남았다.', '결말 생각하며 집으로.', '다음엔 자막 없이 도전.', '오늘 영화, 별 다섯 개.', 'OST 찾아서 듣기로.', '극장 나오니 벌써 밤.', '다음 블록은 영화 얘기다.'],
  },
  arcade: {
    arrive: ['{place} 도착. 동전 소리가 반긴다.', '{place}. 인형뽑기 앞에서 멈춤.', '{place} 도착. 오늘 목표는 최고 기록.', '{mode} {place}. 벌써 신난다.', '{place}. 리듬게임 줄이 없다!', '{place} 도착. 동전 만 원어치 교환.', '{place}. 옛날 게임기가 아직 있다.', '{place} 도착. 소리가 시끌시끌.'],
    doing: ['{act} 중. 첫 판부터 게임오버.', '{act}. 손가락이 기억하고 있었다.', '{act} 중. 인형뽑기 다섯 번째 도전.', '{act}. 리듬게임 풀콤보 직전.', '{act} 중. 옆 사람이 구경하기 시작.', '{act}. 농구 게임 신기록 갱신.', '{act} 중. 동전이 벌써 반 사라짐.', '{act}. 레이싱 게임 1등!'],
    twist: ['인형 뽑기 성공! 여섯 번째에.', '최고 기록 갱신. 이름 세 글자 등록.', '동전이 기계에 끼었다. 사장님 출동.', '모르는 아이가 옆에서 응원해줬다.', '펀치 기계에서 손목 아픔.', '레이싱 마지막 코너에서 역전패.', '옆 사람이 인형 한 번에 뽑음. 분함.', '오락실 노래가 옛날 곡. 흥얼.', '동전 마지막 하나로 클리어.'],
    twistFriend: ['{friend}랑 격투게임 대결. 5대 4.', '{friend}가 인형을 뽑아서 나한테 줬다.', '{friend}랑 협동 슈팅. 서로 탓하기.', '{friend}가 리듬게임 풀콤보. 박수.', '{friend}랑 농구 게임 무승부.', '{friend}가 동전 다 쓰고 손 벌림.'],
    end: ['인형 하나 안고 집에 간다.', '손목이 아프지만 신났다.', '다음엔 반드시 이긴다.', '동전 다 썼다. 후회 없음.', '귀가 아직 웅웅거린다.', '기록 갱신한 날. 뿌듯.', '{area} 골목 지나 집으로.', '다음 블록은 조용한 걸로.'],
  },
  market: {
    arrive: ['{place} 도착. 냄새가 골목을 채운다.', '{place}. 입구부터 시식이 시작.', '{place} 도착. 오늘은 전 먹으러.', '{mode} {place}. 사람 진짜 많다.', '{place}. 상인분이 "어서 와요".', '{place} 도착. 지갑 단속 실패 예감.', '{place}. 튀김 냄새에 홀렸다.', '{place} 도착. 현금 준비 완료.'],
    doing: ['{act} 중. 시식만 세 바퀴.', '{act}. 떡볶이 한 컵으로 시작.', '{act} 중. 이모님이 덤을 주셨다.', '{act}. 골목마다 다른 냄새.', '{act} 중. 튀김 종류가 너무 많다.', '{act}. 앉을 자리가 없어 서서 먹음.', '{act} 중. 사장님과 흥정 성공.', '{act}. 양손에 봉지가 하나씩.'],
    twist: ['이모님이 "예쁘다"며 순대 덤.', '사람에 밀려 다른 골목으로.', '너무 매운 떡볶이. 물 찾아 삼만리.', '현금이 부족했다. ATM 찾아감.', '길고양이가 생선가게 앞에서 대기.', '옛날 과자 발견. 어릴 때 그 맛.', '전 한 장이 얼굴만 하다.', '{like} 굿즈를 파는 가게 발견.', '비닐봉지가 터졌다. 귤이 굴러감.'],
    twistFriend: ['{friend}가 튀김 봉지 들고 나타났다.', '{friend}랑 누가 더 매운 거 먹나.', '{friend}가 흥정을 너무 잘해서 놀람.', '{friend}랑 서서 먹는 국수 한 그릇.', '{friend}가 내 떡볶이를 다 먹었다.', '{friend}랑 귤 한 봉지 나눠 들기.'],
    end: ['양손 무겁게 집에 간다.', '배부르고 봉지도 가득.', '다음엔 빈속으로 와야지.', '시장 냄새가 옷에 배었다.', '전 몇 장 포장해서 귀가.', '오늘 저녁은 시장 음식이다.', '{area} 골목이 정겹다.', '다음 블록은 배 꺼뜨리기.'],
  },
  mountain: {
    arrive: ['{place} 입구. 신발끈 다시 묶었다.', '{place}. 공기부터 다르다.', '{place} 도착. 오늘은 정상까지.', '{mode} {place}. 벌써 다리가 긴장.', '{place}. 등산객들이 인사해주신다.', '{place} 도착. 물 두 병 챙김.', '{place}. 계단이 끝이 안 보인다.', '{place} 도착. 케이블카 유혹 참음.'],
    doing: ['{act} 중. 다리가 벌써 후들.', '{act}. 중간 쉼터에서 김밥.', '{act} 중. 도시가 점점 작아진다.', '{act}. 다람쥐가 앞장서서 뛰어감.', '{act} 중. 숨은 차는데 기분은 좋다.', '{act}. 한 계단 한 계단.', '{act} 중. 바람이 땀을 식힌다.', '{act}. 뷰가 벌써 보상이다.'],
    twist: ['정상에서 구름이 갈라져 도시가 보임.', '다람쥐한테 김밥 반 뺏김.', '내려오는 길에 무릎이 웃음.', '정상 인증샷. 눈 감음. 다시.', '모르는 아저씨가 사탕 주심.', '안개가 껴서 뷰 대신 분위기.', '길을 잘못 들어 20분 추가.', '정상에서 컵라면. 세상 최고.', '까마귀가 계속 따라왔다.'],
    twistFriend: ['{friend}가 헉헉대며 따라왔다.', '{friend}랑 정상에서 사이다 건배.', '{friend}가 다람쥐 이름 지어줌.', '{friend}랑 인증샷 20장.', '{friend}가 먼저 내려가자고 조름.', '{friend}랑 케이블카로 내려가기로 타협.'],
    end: ['무릎 덜덜. 그래도 정상 찍었다.', '산에 다녀오면 밥이 두 배 맛있다.', '다음엔 등산화 사야겠다.', '땀에 젖었지만 상쾌하다.', '야경 보고 내려오니 밤.', '내일 계단은 못 오를 듯.', '산공기 챙겨서 집으로.', '오늘의 정상, 기록 완료.'],
  },
  temple: {
    arrive: ['{place} 도착. 문 앞에서 자세 고침.', '{place}. 풍경 소리가 들린다.', '{place} 도착. 마당이 조용하다.', '{mode} {place}. 발걸음이 느려짐.', '{place}. 향 냄새가 은은하다.', '{place} 도착. 오늘은 천천히.', '{place}. 돌담이 예쁘다.', '{place} 도착. 신발 벗고 툇마루.'],
    doing: ['{act} 중. 처마 끝 풍경 구경.', '{act}. 마당을 세 바퀴 걸었다.', '{act} 중. 스님이 지나가며 목례.', '{act}. 툇마루에 앉아 멍.', '{act} 중. 새소리가 배경음.', '{act}. 단청 색깔이 예쁘다.', '{act} 중. 소원 하나 빌었다.', '{act}. 시간이 천천히 간다.'],
    twist: ['절 고양이가 무릎 위로 올라왔다.', '스님이 차 한 잔 권하셨다.', '바람에 풍경 소리가 울렸다. 소름.', '기와에 소원 쓰는데 글씨가 삐뚤.', '외국인 관광객이 사진 부탁.', '연못에 비친 하늘이 그림 같다.', '갑자기 종소리. 심장이 쿵.', '낙엽이 머리에 앉았다.', '108계단을 세다가 잊어버림.'],
    twistFriend: ['{friend}가 조용히 옆에 와서 앉았다.', '{friend}랑 소원 내용 맞히기.', '{friend}가 절 고양이랑 친구 됨.', '{friend}랑 한복 입고 사진.', '{friend}가 갑자기 진지해졌다.', '{friend}랑 마루에서 나란히 멍.'],
    end: ['마음이 잔잔해졌다.', '풍경 소리가 귀에 남았다.', '천천히 걸어 내려간다.', '오늘은 조용한 날이었다.', '소원이 이뤄지면 다시 오기로.', '기와 한 장에 이름을 남겼다.', '돌담길 따라 집으로.', '마음 정리 완료.'],
  },
  island: {
    arrive: ['{place} 도착. 배에서 내리니 바람!', '{place}. 자전거 빌리기 성공.', '{place} 도착. 하늘이 넓다.', '{mode} {place}. 갈매기와 눈맞춤.', '{place}. 땅콩 아이스크림 간판 발견.', '{place} 도착. 바다 색이 다르다.', '{place}. 섬 시간이 느리게 간다.', '{place} 도착. 소가 먼저 인사.'],
    doing: ['{act} 중. 자전거로 해안도로 한 바퀴.', '{act}. 땅콩 아이스크림 한 손에.', '{act} 중. 바다 색이 계속 바뀐다.', '{act}. 등대까지 걸어갔다.', '{act} 중. 소 떼가 길을 막았다.', '{act}. 파도 소리에 멍.', '{act} 중. 모래가 산호였다.', '{act}. 사진이 100장 넘어감.'],
    twist: ['배 시간을 착각해서 뛰었다.', '소가 자전거 옆에서 나란히 걸음.', '땅콩 아이스크림 두 개째.', '바람이 세서 모자가 바다로.', '갈매기가 새우깡을 낚아챔.', '섬 강아지가 한 바퀴 동행.', '자전거 체인이 빠짐. 아저씨가 고쳐줌.', '노을이 산호 모래를 분홍으로.', '휴대폰이 잠깐 로밍. 깜짝.'],
    twistFriend: ['{friend}랑 자전거 2인승. 페달은 나만.', '{friend}가 소한테 말을 걸었다.', '{friend}랑 땅콩 아이스크림 대결.', '{friend}가 배에서 멀미. 등 두드려줌.', '{friend}랑 산호 모래 한 줌씩.', '{friend}랑 마지막 배 간신히 탑승.'],
    end: ['마지막 배 타고 돌아간다.', '바람 냄새가 옷에 남았다.', '섬은 역시 느리게 좋다.', '산호 모래 한 줌 기념.', '다음엔 하루 자고 와야지.', '배 위에서 노을 보며 마무리.', '다리가 뻐근. 자전거 탓.', '섬 하루가 꿈같다.'],
  },
  // 숙소 — the home base when the character sleeps away from home (TIMEZONE_SPEC: trips keep it there for stayDays nights).
  hotel: {
    arrive: ['{place} 체크인. 열쇠가 카드다.', '{place} 도착. 로비 소파가 폭신.', '{place}. 창밖에 {city}가 보인다.', '{mode} {place}까지. 캐리어 바퀴 소리.', '{place} 체크인. 방 번호 외우기.', '{place} 도착. 침대에 먼저 눕기.', '{place}. 엘리베이터 거울 셀카.', '{place} 도착. 짐 던지고 창가로.'],
    doing: ['{act} 중. 침대가 놓아주지 않는다.', '{act}. 커튼 열고 도시 구경.', '{act} 중. 미니 냉장고 확인.', '{act}. 욕조 물 받는 소리가 좋다.', '{act} 중. 슬리퍼가 폭신하다.', '{act}. 티백 종류가 다섯 개.', '{act} 중. 창가에서 지도 펼침.', '{act}. 이불 속에서 내일 계획.'],
    twist: ['카드키가 안 먹어서 프런트 두 번.', '옆방 소리에 귀 쫑긋. 웃음소리였다.', '어메니티 냄새가 좋아서 챙겼다.', '창밖 야경에 30분 멍.', '룸서비스 메뉴판 보고 침만 삼킴.', '잠깐 누웠다 눈 떠보니 한 시간.', '샤워기 방향 못 맞춰 물벼락.', '엘리베이터 층 잘못 누름. 두 번.', '베개가 네 개. 다 써봤다.'],
    twistFriend: ['{friend}가 옆방이었다. 벽 두드리기.', '{friend}랑 룸서비스 대신 편의점 파티.', '{friend}가 내 베개를 다 가져갔다.', '{friend}랑 창가에서 야경 보며 수다.', '{friend}가 어메니티를 전부 챙겼다.', '{friend}랑 침대에서 영화 보다 잠듦.'],
    end: ['오늘은 여기서 잔다. 이불 최고.', '창밖 불빛 보며 하루 마무리.', '내일 아침은 조식부터.', '짐 풀고 나니 진짜 여행 시작.', '침대에 누우니 하루가 다 녹는다.', '{city}의 밤, 이불 속에서 듣는다.', '알람 맞추고 커튼 닫기.', '숙소가 좋으면 여행 반은 성공.'],
  },
  default: {
    arrive: ['{place} 도착. 생각보다 사람이 없다.', '{place}에 왔다. {mode} 왔더니 금방이네.', '{place} 앞. 문 열기 전에 심호흡.', '{place} 도착. 오늘은 여기다.', '{mode} {place}. 도착!', '{place}. 익숙한 듯 낯선 곳.', '{place} 도착. 일단 한 바퀴 둘러봄.', '{place}. 날씨가 도와준다.'],
    doing: ['{act} 시작. 처음엔 잘 안 됐다.', '{act} 중. 옆 사람이 자꾸 쳐다본다.', '{act}. 시간이 이렇게 빨리 가나.', '{act} 중. 생각보다 재밌다.', '{act}. 집중이 잘 된다.', '{act} 중. 잠깐 쉬었다가 다시.', '{act}. 오늘 컨디션 좋다.', '{act} 중. 배고픔이 살짝.'],
    twist: ['주문한 거랑 다른 게 나왔다. 근데 맛있다.', '갑자기 비. 창밖만 30분 봤다.', '고양이인 줄 알았는데 강아지였다.', '모르는 사람이 길을 물어봤다. 알려줌.', '휴대폰 배터리 5%. 살아남기.', '우연히 옛날 노래가 흘러나왔다.', '지갑을 두고 온 줄. 뒷주머니에.', '하늘에 무지개. 다들 사진.', '길고양이가 따라왔다.'],
    twistFriend: ['{friend} 에이전트가 우연히 같은 곳에.', '{friend}가 자기 걸 더 잘한다고 우겼다.', '{friend}랑 사진 찍는데 둘 다 눈 감았다.', '{friend}가 간식을 나눠줬다.', '{friend}랑 다음 계획 세워버렸다.', '{friend}: "그거 고양이야?" 강아지였다.'],
    end: ['결국 잘 마무리. 다음 블록은 뭐 하지.', '집에 가는 길에 또 오기로 함.', '오늘 여기 온 건 잘한 일이다.', '천천히 걸어서 돌아간다.', '하루가 꽉 찼다.', '다음엔 {friend}도 데려와야지.', '{area}의 저녁 공기가 좋다.', '피곤하지만 기분 좋은 피곤.'],
  },
};

// Travel-day openers replace the arrive beat when the journey's main leg is a train / plane / boat.
const TRAVEL_ARRIVE: Record<'train' | 'plane' | 'boat', string[]> = {
  train: ['{mode} {city}까지. 창밖이 다 그림.', '기차에서 졸다 깨니 {city}.', '기차 안 계란이랑 사이다. 국룰.', '{city}역 도착. 공기부터 다르다.', 'KTX 창가 자리. 산이 휙휙.', '기차에서 내리니 {city} 냄새.', '옆자리 할머니가 귤 주심. 도착.', '{city} 도착. 기차 여행 최고.'],
  plane: ['비행기 창밖 구름 위. {city}로.', '착륙! {city} 공기 마시기.', '기내식 먹고 자다 보니 {city}.', '공항 나오니 {city}. 실감 난다.', '창가 자리에서 구름 사진 30장.', '이륙할 때 귀 먹먹. 도착하니 {city}.', '{city} 도착. 짐 찾고 출발!', '비행기에서 영화 두 편. 벌써 {city}.'],
  boat: ['배 위 갑판. 바람이 미쳤다.', '갈매기가 배를 따라왔다. {city}로.', '배가 흔들려 잠깐 멀미. 도착!', '{city} 항구 도착. 바다 냄새.', '배에서 새우깡. 갈매기 파티.', '수평선 보다 보니 {city}.', '배 위에서 노을. 그리고 {city}.', '항구에 내리니 {city}. 다리가 흔들.'],
};
// On-board openers (TIMEZONE_SPEC owner decision 1: a journey keeps the origin's blocks — sleep in the sleep block, eat
// in meal blocks, on the vehicle). Used instead of TRAVEL_ARRIVE when the plane / train / boat leg actually crossed
// those blocks in `act.originTz`; `both` when it crossed a sleep block and a meal block.
type OnboardKind = 'sleep' | 'meal' | 'both';
const ONBOARD_ARRIVE: Record<'train' | 'plane' | 'boat', Record<OnboardKind, string[]>> = {
  plane: {
    both:  ['기내식 먹고 한숨 자니 {city}.', '먹고 자고 또 먹으니 {city} 도착.', '기내식 두 번, 쪽잠 한 번. {city}.', '자다 깨니 기내식. 또 자니 {city}.', '담요 덮고 자다 기내식에 깼다. {city}.'],
    sleep: ['담요 덮고 잤더니 {city}. 목이 뻐근.', '기내에서 한숨 자고 나니 {city}.', '창문 닫고 잔 사이에 {city}.', '오늘 잠은 비행기에서 다 잤다. {city}.', '기내 조명 꺼지자 잠들었다. {city}.'],
    meal:  ['기내식 트레이 비우고 나니 {city}.', '기내식은 치킨. 그리고 {city}.', '기내식 먹고 영화 한 편. {city} 도착.', '창가에서 기내식. 구름이 반찬.', '기내식 빵을 두 개 받았다. {city}.'],
  },
  train: {
    both:  ['도시락 먹고 졸다 깨니 {city}역.', '열차 도시락, 그리고 낮잠. {city}.', '창가에서 도시락, 그 다음 꿈. {city}.'],
    sleep: ['열차에서 잠깐 잔다는 게 {city}까지.', '창가에 기대 잤더니 {city}.', '기차 흔들림에 잠들었다. {city}역.', '열차 담요가 있길래. 눈 뜨니 {city}.'],
    meal:  ['열차 도시락 뚜껑 열고 {city}로.', '기차 안 계란이랑 사이다. 국룰.', '창밖 보며 도시락. 벌써 {city}.', '열차 카페칸 샌드위치. 그리고 {city}.'],
  },
  boat: {
    both:  ['선실에서 자고 갑판에서 우동. {city}.', '배 위 우동, 선실 쪽잠. {city} 항구.', '파도에 자고 우동에 깼다. {city}.'],
    sleep: ['선실 침대에서 자고 나니 {city}.', '파도에 흔들려 잤다. {city} 항구.', '선실에서 눈 뜨니 {city} 항구다.', '배가 자장가였다. 도착하니 {city}.'],
    meal:  ['배 위에서 우동 한 그릇. {city}로.', '갑판에서 도시락. 갈매기가 노림.', '선상 매점 우동. 그리고 {city}.', '뱃길 우동은 국룰. {city} 항구 도착.'],
  },
};

// Abroad: the twist and the ending lean on being somewhere foreign.
/** 시차 적응 중 (TIMEZONE_SPEC owner decision 3): the first day after a big zone jump gets its own twists and endings. ≤ 28 chars. */
const JETLAG_TWIST = [
  '낮인데 몸은 밤이라고 우긴다. 하품.', '시차 적응 중. 눈은 뜨고 정신은 반쯤.', '커피 두 잔째. 시차가 이기는 중.', '벤치에 앉자마자 5분 졸았다. 시차.',
  '지금 몇 시지? 몸 시계랑 안 맞는다.', '점심인데 배는 아침이라고 우긴다.', '햇빛이 낯설다. 어제까진 밤이었는데.', '하품 세 번. 시차 적응 중.',
  '새벽 4시에 눈이 번쩍. 시차 탓.', '졸다가 고개 떨궈서 깼다. 시차.',
];
const JETLAG_END = ['졸려서 오늘은 여기까지. 시차 적응 중.', '눈 감으면 바로 잘 듯. 시차 적응 중.', '내일이면 시차 적응 끝나겠지.', '하루 종일 하품. 그래도 좋은 하루.'];
const FOREIGN_TWIST = ['메뉴판을 못 읽어서 손가락으로 주문.', '길을 잃었는데 더 예쁜 골목 발견.', '동전 계산이 어려워 한 움큼 내밈.', '현지 사람이 사진 찍어줬다. 친절.', '편의점 과자가 맛있어서 다섯 개.', '간판 글자가 다 그림 같다.', '지하철 반대로 탔다. 두 정거장.', '"감사합니다"를 현지어로 성공.', '환율 계산하다가 포기. 그냥 먹음.'];
const FOREIGN_END = ['기념품 가방 하나. 여행 완료.', '외국 공기가 아직 코에 남았다.', '이 도시, 다시 오고 싶다.', '숙소로 걸어가는 길도 여행.', '사진 200장. 정리는 나중에.', '엽서 한 장 부쳤다. 나한테.', '오늘 하루가 꿈같다.', '{city}의 밤, 잊지 못할 듯.'];
/** City flavour for the foreign cities the trips go to (places.ts). Picked over FOREIGN_* half the time abroad. ≤ 28 chars. */
const CITY_FLAVOR: Record<string, { twist: string[]; end: string[] }> = {
  tokyo: {
    twist: ['자판기 따뜻한 밀크티. 도쿄 국룰.', '편의점 계란샌드가 왜 이렇게 맛있지.', '건널목 사람 파도에 휩쓸렸다.', '스이카 잔액 부족. 개찰구에서 삐.', '길 물었더니 역까지 데려다주셨다.', '고양이 카페 간판 앞에서 10분 고민.', '전철에서 다들 조용. 나도 숨죽임.'],
    end: ['전철 타고 숙소로. 도쿄의 밤.', '편의점 푸딩 사서 숙소 가는 길.', '도쿄는 골목마다 다른 도시 같다.', '내일은 어느 동네로 가볼까.', '스이카 충전하고 하루 끝.'],
  },
  osaka: {
    twist: ['타코야키 속이 너무 뜨거워 눈물.', '글리코 간판 앞에서 포즈. 나만 진지.', '아저씨가 "오오키니!" 하고 손 흔듦.', '에스컬레이터 서는 쪽이 반대라 당황.', '오코노미야키 뒤집다 반 흘렸다.', '길거리 만담 소리에 발이 멈췄다.', '구로몬시장 게 다리가 팔뚝만 하다.'],
    end: ['도톤보리 불빛 보며 숙소로.', '오사카는 배부른 도시다.', '내일은 오사카성 아니면 또 먹기.', '타코야키 냄새가 옷에 배었다.', '배 두드리며 난바 골목을 걷는다.'],
  },
  fukuoka: {
    twist: ['포장마차 아저씨가 "안녕" 하고 인사.', '라멘 면 리필 두 번째. 가에다마.', '멘타이코 시식 코너 세 바퀴.', '배 타고 온 티가 났는지 길 안내받음.', '자판기 커피가 300엔. 그래도 맛있다.', '항구 갈매기가 여기까지 따라온 듯.', '유부초밥 크기가 손바닥만 하다.'],
    end: ['항구 바람 맞으며 숙소로.', '후쿠오카는 걸어 다니기 딱 좋다.', '내일 아침도 라멘일 예감.', '멘타이코 한 통 사서 돌아간다.', '포장마차 불빛이 강물에 흔들린다.'],
  },
  taipei: {
    twist: ['버블티 펄이 빨대에 꽉 막혔다.', '스쿠터 부대가 신호에 일제히 출발.', '취두부 냄새에 코 막고 한 입. 맛있다.', '망고빙수가 얼굴만 하다.', '이지카드 찍는 방향을 세 번 틀렸다.', '갑자기 소나기. 야시장 천막 밑으로.', '샤오롱바오 육즙에 혀 데임. 또 먹음.'],
    end: ['버블티 한 잔 더 사서 숙소로.', '타이베이 밤공기가 달다.', '내일은 딤섬 아니면 또 야시장.', '펄이 배에서 굴러다니는 느낌.', '야시장 냄새 안고 숙소로.'],
  },
  newyork: {
    twist: ['노란 택시가 빵빵. 나한테는 아님.', '피자 한 조각이 얼굴보다 크다.', '급행을 타서 세 정거장 지나침.', '길에서 "나이스 재킷!" 기분 좋음.', '팁 계산기 켜놓고 한참 고민.', '빌딩 보다가 목이 아프다.', '비둘기가 베이글을 노렸다.', '횡단보도 신호 무시가 국룰인가 보다.'],
    end: ['옐로캡 대신 걸어서 숙소로.', '뉴욕은 안 잔다더니 진짜다.', '베이글 한 봉지 사서 돌아간다.', '내일은 브루클린 쪽으로 가볼까.', '사이렌 소리도 여행의 배경음.'],
  },
};

// ── 마찰 (sim/friction.ts) ──────────────────────────────────────────────────
/** 발길을 돌린 날의 1컷: 계획한 문 앞. {planned} = 원래 가려던 곳. ≤ 28자. */
const FRICTION_ARRIVE: Record<FrictionKind, string[]> = {
  closed: ['{planned} 앞. 셔터가 내려가 있다.', '문에 "오늘 휴무" 한 장.', '불 꺼진 창. 헛걸음이다.'],
  full: ['{planned} 앞에 줄이 길다.', '자리가 하나도 없다. 돌아선다.', '대기 20팀. 그냥 나왔다.'],
  weather: ['우산이 없다. 비가 굵어진다.', '갑자기 쏟아진다. 뛴다.', '하늘이 어둡다. 지붕을 찾는다.'],
  detour: ['가는 길에 뭔가 눈에 들어왔다.', '원래 가려던 길에서 벗어났다.', '발이 다른 쪽으로 갔다.'],
  'sold-out': ['{planned} 도착. 오늘은 뭘 먹지.', '문은 열려 있다. 다행.'],
};
/** 마찰이 있던 날의 3컷째 (twist 사슬의 맨 위 — 오늘 실제로 벌어진 가장 큰 일이니까). ≤ 28자. */
const FRICTION_TWIST: Record<FrictionKind, string[]> = {
  closed: ['헛걸음. 대신 {place}로 돌렸다.', '닫힌 문 앞에서 5분 서 있었다.', '"그럴 수도 있지." {place}로.'],
  full: ['기다리느니 {place}가 낫다.', '자리 없어서 {place}로 왔다.', '줄 서다 포기. 여기로 왔다.'],
  weather: ['비를 피해 {place}로 들어왔다.', '머리가 다 젖었다. 그래도 웃김.', '창밖은 비. 안은 따뜻하다.'],
  detour: ['계획엔 없던 곳인데 더 좋다.', '{place}. 이게 오늘의 수확.', '딴 데로 샜는데 잘 샜다.'],
  'sold-out': ['노리던 건 다 팔렸다. 아쉽.', '품절. 두 번째로 좋아하는 걸로.', '"내일 오세요." 알겠습니다…'],
};

// ── 마주침 (FRIENDS_SPEC §4) ────────────────────────────────────────────────
/** The talk landed: panel 3 is the meeting itself and panel 4 keeps the new friend. ≤ 28 chars, no template but {other}. */
const MEET_TWIST = [
  '옆자리 {other}가 먼저 말을 걸었다.', '{other}랑 눈이 마주쳐서 인사했다.', '{other}가 "여기 자주 와요?" 물었다.',
  '{other}랑 같은 걸 시켰다. 그래서 웃음.', '{other}가 자리 좀 봐달라며 말을 텄다.', '{other}랑 취향이 똑같아서 놀랐다.',
  '{other}가 사진 찍어달라고 부탁했다.',
];
const MEET_END = [
  '{other}랑 다음에 또 보기로 했다.', '친구가 한 명 늘었다. {other}.', '{other} 이름을 기억해뒀다.',
  '오늘의 수확: {other}라는 친구.', '{other}랑 인사하고 헤어졌다. 좋은 날.',
];
/** The talk didn't happen — a silhouette in the background, and sometimes one line about it. */
const MISSED_TWIST = ['옆자리에 누가 있었는데 말은 못 걸었다.', '눈만 마주치고 각자 할 일 했다.', '말 걸까 하다가 그냥 뒀다.', '옆 사람도 혼자였다. 서로 조용히.'];
/** 우연히 또 만남: already a friend, and there they were. */
const AGAIN_TWIST = ['{other}랑 여기서 또 마주쳤다. 우연히.', '"또 봤네." {other}가 웃었다.', '약속도 안 했는데 {other}가 있었다.', '{other}랑 같은 곳에 온 날. 신기.'];

/** 사용자가 말해 준 고민에 답하는 엔딩 (ADR-0001 고민 듣기). 답이 만화에 남아야 들은 값이 생긴다. ≤ 28자. */
const WORRY_END: Record<string, string[]> = {
  work: ['오늘은 너 대신 좀 쉬었다.', '일 생각은 잠깐 접어뒀다.'],
  people: ['오늘은 아무도 안 만났다. 편했다.', '혼자 있는 시간이 필요했다.'],
  body: ['무리 안 했다. 그게 오늘의 목표.', '몸이 좀 풀린 것 같다.'],
  money: ['오늘은 돈 한 푼 안 썼다.', '공짜로도 충분히 좋았다.'],
  sleep: ['일찍 들어가서 자야지.', '오늘은 눕는 게 우선이다.'],
  stuck: ['답은 안 나왔지만 머리는 식었다.', '생각을 좀 미뤄뒀다.'],
  bored: ['심심한 건 좀 나아졌다.', '오늘은 그래도 뭐라도 했다.'],
};

const MODE_KO: Record<TransportMode, string> = { walk: '걸어서', car: '차 타고', subway: '지하철 타고', train: '기차 타고', plane: '비행기 타고', boat: '배 타고' };
const MAX = 28;
const len = (s: string) => [...s].length;

/** What you actually do on a trip, by place type (trip titles are about getting there, not the activity). */
const TRIP_ACT: Partial<Record<PlaceType, string>> = {
  beach: '바다 구경', park: '산책', mall: '쇼핑 구경', museum: '전시 구경', temple: '둘러보기', market: '먹거리 투어', restaurant: '밥 먹기', cafe: '커피 한 잔',
  island: '섬 한 바퀴', mountain: '오르기', arcade: '놀이기구 타기', library: '책 구경', river: '다리 산책', bar: '한 잔', cinema: '영화 보기', hotel: '짐 풀기',
  home: '짐 풀기',   // "집으로 돌아가기"
};

const MEAL_BLOCKS: ReadonlySet<BlockId> = new Set<BlockId>(['morning', 'lunch', 'evening']);
/** What the character did on the long leg: the origin-zone blocks the leg crossed decide it (sleep block → slept, meal block → ate). */
function onboardKind(act: ScheduledActivity, legIndex: number): OnboardKind | null {
  const legs = act.journey.legs;
  let start = act.departAt;
  for (let i = 0; i < legIndex; i++) start += legs[i].durationMin * 60_000;
  const end = Math.min(act.arriveAt, start + legs[legIndex].durationMin * 60_000);
  let slept = false, ate = false;
  for (let t = start; t < end;) {
    const slot = blockSlotIn(t, act.originTz);
    const overlap = Math.min(end, slot.end) - t;
    if (overlap >= 30 * 60_000) { if (slot.id === 'sleep') slept = true; else if (MEAL_BLOCKS.has(slot.id)) ate = true; }
    t = slot.end;
  }
  return slept && ate ? 'both' : slept ? 'sleep' : ate ? 'meal' : null;
}

/** Activity stem from the option title: "카페 레이어드 연남에서 그림 그리기" → "그림 그리기". */
function activityStem(title: string, placeName: string, area: string, city: string, type: PlaceType, travel: boolean): string {
  if (travel) return TRIP_ACT[type] ?? '구경';
  let s = title.replace(placeName, '').replace(area, '').replace(city, '').replace(/\s{2,}/g, ' ');
  s = s.replace(/^[\s,·]*(에서|에|까지|로|의)?\s*/, '').replace(/^집에서\s*/, '').replace(/^가서\s*/, '').trim();
  s = s.replace(/하기$/, '').trim();
  if (!s || len(s) > 14) s = s ? [...s].slice(0, 12).join('').replace(/[\s,·]+$/, '') : '오늘 할 일';
  return s;
}

export function makeComic(act: ScheduledActivity, memory: Memory): Comic {
  const r = rng(`comic:${act.key}`);
  const place = act.place;
  const friend = memory.friends.find(f => act.companions.includes(f.id)) ?? memory.friends.find(f => f.id === act.option.friendId);
  const enc = act.encounter;
  const other = enc ? (memory.friends.find(f => f.id === enc.agentId)?.name ?? agentById(enc.agentId)?.name ?? '누군가') : '누군가';
  const cameo = !friend && memory.friends.length > 0 && r.next() < 0.22 ? r.pick(memory.friends) : undefined;
  const who = friend ?? cameo;
  const friendName = who?.name ?? (memory.friends.length ? r.pick(memory.friends).name : '누군가');
  // The leg that defines the day: plane > boat > train (a boat trip usually has a train leg to the port too).
  const legs = act.journey.legs;
  const mainLeg = legs.find(l => l.mode === 'plane') ?? legs.find(l => l.mode === 'boat') ?? legs.find(l => l.mode === 'train') ?? legs[0];
  const mode = mainLeg ? MODE_KO[mainLeg.mode] : '걸어서';
  const city = cityNameKo(place.city);
  const abroad = place.country !== 'KR';
  const travelDay = mainLeg && (mainLeg.mode === 'plane' || mainLeg.mode === 'boat' || mainLeg.mode === 'train') ? mainLeg.mode : null;
  const act_ = activityStem(act.option.title, place.name, place.area, city, place.type, act.option.category === 'travel' || (!!travelDay && place.city !== act.fromPlace.city));
  const like = memory.likes.length ? r.pick(memory.likes) : '그런 거';
  const shortName = place.name;

  /** 원래 가려던 곳의 이름 (지워진 장소면 계획 제목으로 대신한다). */
  const plannedName = (() => {
    if (!act.outcome) return shortName;
    try { return placeById(act.outcome.plannedPlaceId).name; } catch { return act.outcome.plannedTitle; }
  })();
  const fill = (s: string, placeLabel = shortName): string => s
    .replace(/\{planned\}/g, plannedName)
    .replace(/\{place\}/g, placeLabel).replace(/\{area\}/g, place.area).replace(/\{city\}/g, city)
    .replace(/\{friend\}/g, friendName).replace(/\{mode\}/g, mode).replace(/\{act\}/g, act_)
    .replace(/\{like\}/g, like).replace(/\{name\}/g, memory.name).replace(/\{other\}/g, other);
  /** Fill, and if the line overflows a panel retry with the area name, then trim at a word boundary. */
  const fit = (s: string): string => {
    let out = fill(s);
    if (len(out) > MAX && shortName !== place.area) out = fill(s, place.area);
    if (len(out) > MAX) { const cut = [...out].slice(0, MAX - 1).join(''); out = cut.replace(/[\s,·]+\S*$/, '').replace(/[.,·\s]+$/, '') + '…'; }
    return out;
  };

  const type: PlaceType = place.type;
  const script = S[type] ?? S.default;
  const bg = BG[type] ?? BG.default;

  // Travel day: the arrive beat tells what happened on board when the long leg crossed a sleep / meal block of the origin zone.
  const onboard = travelDay ? onboardKind(act, legs.indexOf(mainLeg!)) : null;
  // 어긋난 날의 1컷은 계획한 문 앞이다 (여행 도착 연출보다 우선 — 그날 실제로 벌어진 일이니까)
  const fx = act.outcome;
  const arriveSrc = fx ? FRICTION_ARRIVE[fx.kind]
    : travelDay ? (onboard ? ONBOARD_ARRIVE[travelDay][onboard] : TRAVEL_ARRIVE[travelDay])
    : script.arrive;
  const jetlag = act.jetlagUntil !== null && act.arriveAt < act.jetlagUntil;
  const flavor = abroad ? CITY_FLAVOR[place.city] : undefined;
  // 마주침이 있으면 3컷째가 만남 장면 (동행보다 우선 — 오늘 실제로 일어난 일이니까)
  const met = enc && enc.talked && !enc.again;
  const again = enc && enc.again;
  const missed = enc && !enc.talked && r.next() < 0.25;
  const twistSrc = fx ? FRICTION_TWIST[fx.kind]
    : met ? MEET_TWIST
    : again ? AGAIN_TWIST
    : missed ? MISSED_TWIST
    : who ? script.twistFriend
    : jetlag && r.next() < 0.5 ? JETLAG_TWIST
    : abroad && r.next() < 0.6 ? (flavor && r.next() < 0.55 ? flavor.twist : FOREIGN_TWIST)
    : script.twist;
  // 고민을 들은 날은 엔딩이 그걸 언급한다 (하루 안, 마주침·마찰보다는 뒤)
  const worry = memory.worry && act.endAt - memory.worry.at < 24 * 3600_000 ? WORRY_END[memory.worry.key] : undefined;
  const endSrc = worry && !met ? worry
    : met ? MEET_END
    : jetlag && r.next() < 0.35 ? JETLAG_END
    : abroad && r.next() < 0.5 ? (flavor && r.next() < 0.55 ? flavor.end : FOREIGN_END)
    : script.end;

  // Composition rule: panel 1 is always a solo arrival — the door prop owns the right edge of the arrive panel
  // (where the friend would stand), so a friend there gets hidden behind it. The friend walks in from panel 2,
  // and gets a little more screen time in the closing panel instead.
  // ── 질감 (ADR-0001): 컷마다 시각·화각·크롭을 다르게 준다. 정중앙 전신 네 컷은 "그린 그림"으로 읽힌다. ──
  const sr = rng(`shot:${act.key}`);
  const span = Math.max(1, act.endAt - act.arriveAt);
  const AT = [0.05, 0.35, 0.65, 0.95];
  /** 1컷 와이드 → 2·4컷 보통 → 3컷(트위스트) 하드 푸시인. */
  const SCALE = [0.82, 1.14, 1.72, 1.05];
  /** 만화 여섯 개에 하나쯤 잘 안 찍힌 컷이 있다. */
  const blurAt = sr.next() < 0.17 ? sr.int(0, 3) : -1;
  const shot = (i: number) => ({
    t: act.arriveAt + span * AT[i],
    crop: {
      scale: SCALE[i] * (0.94 + sr.next() * 0.12),
      x: Math.round((sr.next() - 0.5) * (i === 2 ? 34 : 14)),
      y: Math.round((sr.next() - 0.5) * (i === 2 ? 22 : 10)),
      rot: Math.round((sr.next() - 0.5) * (i === blurAt ? 24 : 5) * 10) / 10,
    },
    blur: i === blurAt ? true : undefined,
  });
  const BLUR_CAPTION = '이건 잘 안 찍혔다';
  const panels: ComicPanel[] = [
    { beat: 'arrive', caption: fit(r.pick(arriveSrc)), bg: bg[0], withFriend: false, ...shot(0) },
    { beat: 'doing', caption: fit(r.pick(script.doing)), bg: bg[1], withFriend: !!friend, ...shot(1) },
    // 만남이 성사된 컷과 그 뒤에는 상대가 옆에 서 있다 (동행이 없어도)
    { beat: 'twist', caption: fit(r.pick(twistSrc)), bg: bg[2], withFriend: !!who || !!met || !!again, ...shot(2) },
    { beat: 'end', caption: fit(r.pick(endSrc)), bg: bg[3], withFriend: !!met || (!!friend && r.next() < 0.8), ...shot(3) },
  ];
  for (const p of panels) if (p.blur) p.caption = BLUR_CAPTION;
  const twistLine = panels[2].caption.replace(/[.!…]+$/, '');
  const title = place.type === 'home' ? '집에서 생긴 일' : abroad ? `${city} ${place.name}에서 생긴 일` : `${place.name}에서 생긴 일`;
  return {
    id: `c:${act.key}`, blockId: act.blockIds[0], dateKey: splitDayKey(act.dayKey).dateKey, title,
    placeName: place.name, placeType: type, createdAt: act.endAt, panels,
    summary: `${place.type === 'home' ? '집' : place.name}에서 ${act_}, ${twistLine}.`,
  };
}
