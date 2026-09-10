-- theworld 서버 스키마 v3 — 미디어 저장소와 프로필의 SNS 칸 (ADR-0020·0021, CONTRACT §2.5). V1과 같은 규칙: text · bigint · varchar만.

-- 찍는 순간 구운 픽셀의 행 (ADR-0020 결정 3). id는 클라이언트가 만든 32자 hex, 바이트는 디스크(theworld.media.dir/<id>)에 있고 여기엔 소유자·종류·크기만.
-- kind = shot | sketch | npc, mime = image/webp | image/png. 지우지 않는다(결정 4).
create table media (
  id         varchar(32) primary key,
  owner_id   varchar(40) not null,
  kind       varchar(8)  not null,
  mime       varchar(16) not null,
  bytes      bigint      not null,
  created_at bigint      not null
);
create index ix_media_owner on media (owner_id, created_at);

-- 프로필의 세 칸 (§2.5 PUT /api/me/agent 개정): 성별(검증만, 추정 안 함), 공개 여부(기본 private), 대표컷 핀(내 media.id).
alter table agent_profile add column gender      varchar(8);
alter table agent_profile add column visibility  varchar(8) not null default 'private';
alter table agent_profile add column rep_shot_id varchar(32);
