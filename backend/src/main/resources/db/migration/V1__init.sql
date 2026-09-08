-- theworld 서버 스키마 v1 (BACKEND-CONTRACT §1, 인증은 2026-09-08 오후 개정 AUTH-ADDENDUM).
-- H2(MODE=PostgreSQL, DATABASE_TO_LOWER=TRUE)와 PostgreSQL 양쪽에서 그대로 도는 SQL만: text · bigint · varchar.
-- 시각은 전부 epoch ms(bigint), id는 문자열. JSON 덩어리(문서 본문·취향·집·장소·동행)는 text에 불투명하게 둔다.

-- 고정 아이디 계정 (§2.1 개정). 토큰도 비밀번호도 없다 — id는 ^[a-z][a-z0-9_]{1,23}$, 행은 V2__seed_users.sql이 넣는다.
-- last_seen_at은 인증 필터가 성공한 요청에서 갱신하되 1분에 한 번만 쓴다.
create table app_user (
  id           varchar(24) primary key,
  display_name varchar(40) not null,
  created_at   bigint      not null,
  last_seen_at bigint      not null
);

-- 프런트 localStorage 저장본 4개(world|memory|book|places)를 불투명 JSON으로 (§2.2). version은 PUT마다 +1.
create table user_doc (
  user_id    varchar(40) not null,
  name       varchar(16) not null,
  version    bigint      not null,
  client_ts  bigint      not null,
  updated_at bigint      not null,
  body       text        not null,
  primary key (user_id, name)
);

-- 진짜 사람 에이전트의 프로필 (§2.3 RemoteAgent). home_json은 type 'friend_home', id 'home:<userId>'인 RemotePlace.
create table agent_profile (
  user_id       varchar(40) primary key,
  name          varchar(40) not null,
  color         varchar(16) not null,
  emoji         varchar(8)  not null,
  hair_style    varchar(24),
  likes_json    text        not null,
  traits_json   text        not null,
  home_json     text        not null,
  home_place_id varchar(80) not null,
  updated_at    bigint      not null
);

-- 발행된 확정 일정 (§2.3 PublishedActivity, FRIENDS_SPEC §4). act_key = dayKey + ":" + blockId (프런트 ScheduledActivity.key). 창 교체 단위는 arrive_at.
create table published_activity (
  user_id         varchar(40)  not null,
  act_key         varchar(120) not null,
  day_key         varchar(60)  not null,
  block_id        varchar(12)  not null,
  place_id        varchar(80)  not null,
  place_json      text,
  category        varchar(12)  not null,
  title           varchar(120) not null,
  emoji           varchar(8)   not null,
  arrive_at       bigint       not null,
  end_at          bigint       not null,
  tz              varchar(48)  not null,
  companions_json text         not null,
  published_at    bigint       not null,
  primary key (user_id, act_key)
);
create index ix_published_activity_place on published_activity (place_id, arrive_at);
create index ix_published_activity_user  on published_activity (user_id, arrive_at);

-- 친구 관계 (§2.3). 대칭 — user_a < user_b로 정렬해 한 줄만 둔다. met_*는 처음 말을 튼 마주침.
create table friendship (
  user_a       varchar(40) not null,
  user_b       varchar(40) not null,
  met_at       bigint,
  met_place_id varchar(80),
  created_at   bigint      not null,
  primary key (user_a, user_b)
);

-- 여행 팩 캐시 (ADR-0009 → trip 패키지, 모든 사용자 공유). alias = normCity(요청명) | normCity(nameKo) | key.
create table trip_pack (
  alias      varchar(80) primary key,
  city_key   varchar(40) not null,
  body       text        not null,
  created_at bigint      not null
);

-- 검색 결과 캐시 — 검색만 성공해도 남겨 뒤 단계가 실패해도 검색 한도를 지킨다.
create table trip_search (
  norm       varchar(80) primary key,
  body       text        not null,
  created_at bigint      not null
);
