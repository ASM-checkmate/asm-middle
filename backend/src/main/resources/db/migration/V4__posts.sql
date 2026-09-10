-- theworld 서버 스키마 v4 — SNS 글과 좋아요 (ADR-0021, CONTRACT §2.5). V1과 같은 규칙: text · bigint · varchar만, 불리언은 bigint 0/1.

-- 글 한 편 (§2.5 Post). id는 서버가 만든 32자 hex. cuts_json은 PostCut[](1~10, 순서 있음), companions_json은 친구 id[].
-- place·area·city·category·date_key는 추천·검색용 면(ADR-0021 결정 2). likes는 post_like 행 수의 비정규화 사본 — 같은 트랜잭션에서 함께 고친다.
-- edited_by_owner는 0/1 (V1에 불리언 컬럼이 없어 bigint로).
create table post (
  id              varchar(32)  primary key,
  author_id       varchar(40)  not null,
  created_at      bigint       not null,
  cuts_json       text         not null,
  caption         text         not null,
  place           varchar(120) not null,
  area            varchar(120) not null,
  city            varchar(120) not null,
  category        varchar(12),
  date_key        varchar(120) not null,
  companions_json text         not null,
  edited_by_owner bigint       not null default 0,
  likes           bigint       not null default 0
);
create index ix_post_author  on post (author_id, created_at);
create index ix_post_created on post (created_at);

-- 좋아요 한 번 (§2.5). 멱등 — (post_id, user_id)가 키다. 글을 지우면 같이 지운다.
create table post_like (
  post_id    varchar(32) not null,
  user_id    varchar(40) not null,
  created_at bigint      not null,
  primary key (post_id, user_id)
);
create index ix_post_like_user on post_like (user_id, created_at);
