-- 유사문제 생성기 데이터베이스 표 (Supabase / Postgres)
-- Supabase 왼쪽 메뉴 SQL Editor에 이 파일 전체를 붙여넣고 Run을 누르면 됩니다.
-- 여러 번 실행해도 안전합니다(이미 있는 것은 건너뜀). 표를 지우거나 데이터를 바꾸지 않습니다.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------
-- 학생 계정
-- ---------------------------------------------------------------
create table if not exists students (
  student_id    text primary key,
  password_hash text not null,
  class_id      text not null default '미배정',
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- 유형표: 학년 › 단원 › 유형 › 문제틀 (한 줄이 한 문제틀)
-- ---------------------------------------------------------------
create table if not exists taxonomy (
  id          bigint generated always as identity primary key,
  grade       text not null,
  unit        text not null,
  type        text not null,
  frame       text not null,
  description text not null default '',
  created_at  timestamptz not null default now(),
  unique (grade, unit, type, frame)
);

-- 단원별 학기
create table if not exists units (
  grade      text not null,
  unit       text not null,
  semester   text not null,
  updated_at timestamptz not null default now(),
  primary key (grade, unit)
);

-- ---------------------------------------------------------------
-- 문제를 한 번 저장할 때 올린 원본 묶음 (사진, 인식된 글자, 날짜)
-- ---------------------------------------------------------------
create table if not exists problem_sets (
  id          text primary key,
  made_on     date not null,
  class_id    text not null default '',
  grade       text not null default '',
  unit        text not null default '',
  subtype     text not null default '',
  source_text text not null default '',
  image_ref   text not null default '',
  memo        text not null default '',
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- 문제: 은행과 학생 보관함이 같은 곳을 본다 (문제 내용은 여기에만 저장)
-- position: 0 = 원본, 1 = 유사문제 1번, 2 = 유사문제 2번 (묶음에 속하지 않으면 비움)
-- ---------------------------------------------------------------
create table if not exists problems (
  id          text primary key,
  set_id      text references problem_sets (id) on delete set null,
  position    smallint check (position in (0, 1, 2)),
  taxonomy_id bigint references taxonomy (id) on update cascade on delete set null,
  grade       text not null default '',
  unit        text not null default '',
  type        text not null default '',
  frame       text not null default '',
  difficulty  text not null default '' check (difficulty in ('', '하', '중', '상')),
  source      text not null default '',
  origin_id   text references problems (id) on delete set null,
  question    text not null default '',
  answer      text not null default '',
  solution    text not null default '',
  image_ref   text not null default '',
  verified    boolean not null default false,
  memo        text not null default '',
  model       text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists problems_set_idx      on problems (set_id);
create index if not exists problems_taxonomy_idx on problems (taxonomy_id);
create index if not exists problems_filter_idx   on problems (grade, unit, type, frame);
create index if not exists problems_created_idx  on problems (created_at desc);
create index if not exists problems_text_idx
  on problems using gin ((question || ' ' || answer || ' ' || solution) extensions.gin_trgm_ops);

-- ---------------------------------------------------------------
-- 학생에게 배정한 문제 (학생 × 문제 한 줄). tags: 중요 / 틀림 / 어려워함 (여러 개 가능)
-- ---------------------------------------------------------------
create table if not exists assignments (
  student_id  text not null references students (student_id) on update cascade on delete cascade,
  problem_id  text not null references problems (id) on delete cascade,
  assigned_on date not null,
  tags        text[] not null default '{}'
              check (tags <@ array['중요', '틀림', '어려워함']),
  created_at  timestamptz not null default now(),
  primary key (student_id, problem_id)
);
create index if not exists assignments_problem_idx on assignments (problem_id);
create index if not exists assignments_date_idx    on assignments (student_id, assigned_on desc);

-- 학생이 직접 체크한 중요 문제
create table if not exists stars (
  student_id text not null references students (student_id) on update cascade on delete cascade,
  problem_id text not null references problems (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (student_id, problem_id)
);

-- ---------------------------------------------------------------
-- 숙제
-- ---------------------------------------------------------------
create table if not exists homework (
  hw_id      text primary key,
  title      text not null,
  due_date   date,
  class_id   text not null default '',
  memo       text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists homework_students (
  hw_id      text not null references homework (hw_id) on delete cascade,
  student_id text not null references students (student_id) on update cascade on delete cascade,
  primary key (hw_id, student_id)
);

create table if not exists homework_problems (
  hw_id      text not null references homework (hw_id) on delete cascade,
  problem_id text not null references problems (id) on delete cascade,
  position   integer not null,
  primary key (hw_id, problem_id)
);

-- 숙제 결과: (숙제, 학생, 문제)마다 한 줄만 들어갈 수 있다 → 같은 제출이 두 번 와도 겹치지 않음
-- correct: Y(맞음) / N(틀림) / ?(자동 채점 불가), graded_by: auto 또는 teacher
create table if not exists hw_results (
  hw_id      text not null references homework (hw_id) on delete cascade,
  student_id text not null references students (student_id) on update cascade on delete cascade,
  problem_id text not null references problems (id) on delete cascade,
  answer     text not null default '',
  correct    text not null default '' check (correct in ('', 'Y', 'N', '?')),
  graded_by  text not null default '',
  tags       text[] not null default '{}'
             check (tags <@ array['중요', '틀림', '어려워함']),
  updated_at timestamptz not null default now(),
  primary key (hw_id, student_id, problem_id)
);
create index if not exists hw_results_student_idx on hw_results (student_id, updated_at desc);

-- ---------------------------------------------------------------
-- 시험 점수와 시험지 분석 (analysis는 길이 제한이 없는 JSON)
-- ---------------------------------------------------------------
create table if not exists exams (
  id         text primary key,
  student_id text not null references students (student_id) on update cascade on delete cascade,
  taken_on   date not null,
  kind       text not null default '',
  name       text not null default '',
  score      numeric,
  max_score  numeric,
  memo       text not null default '',
  analysis   jsonb,
  created_at timestamptz not null default now()
);
create index if not exists exams_student_idx on exams (student_id, taken_on desc);

-- ---------------------------------------------------------------
-- 앱 설정 (예: 앱 켜짐/꺼짐 상태)
-- ---------------------------------------------------------------
create table if not exists app_settings (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- 접근 제한: 모든 표에서 Row Level Security를 켜고 정책을 만들지 않는다.
-- → Supabase의 공개 주소(anon 키)로는 아무것도 읽거나 쓸 수 없고,
--   앱 서버가 비밀 연결 주소로만 접근한다.
-- ---------------------------------------------------------------
alter table students          enable row level security;
alter table taxonomy          enable row level security;
alter table units             enable row level security;
alter table problem_sets      enable row level security;
alter table problems          enable row level security;
alter table assignments       enable row level security;
alter table stars             enable row level security;
alter table homework          enable row level security;
alter table homework_students enable row level security;
alter table homework_problems enable row level security;
alter table hw_results        enable row level security;
alter table exams             enable row level security;
alter table app_settings      enable row level security;
