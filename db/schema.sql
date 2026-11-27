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
-- [예전 표] 학생에게 배정한 문제 (학생 × 문제 한 줄). 예전 Streamlit 앱이 쓰던 표로,
-- 웹앱은 더 읽거나 쓰지 않는다. 남아 있는 기록을 백업·되살리기에서 잃지 않도록 표는 그대로 둔다.
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

-- ---------------------------------------------------------------
-- 4단계에서 추가: 문제 은행 키워드 검색(문제·메모·문제틀 글자)을 빠르게 하는 색인
-- ---------------------------------------------------------------
create index if not exists problems_search_idx
  on problems using gin ((question || ' ' || memo || ' ' || frame) extensions.gin_trgm_ops);

-- ---------------------------------------------------------------
-- 웹앱 1단계에서 추가: 학생 이름(또는 별명). 예전 앱은 이 칸을 쓰지 않으므로 영향이 없다.
-- ---------------------------------------------------------------
alter table students add column if not exists name text not null default '';

-- ---------------------------------------------------------------
-- 웹앱에서 추가: 저장한 학부모 리포트 (학생·기간마다 하나).
-- share_token 이 있으면 /r/<token> 주소로 로그인 없이 그 리포트만 볼 수 있다. 끄면 null.
-- ---------------------------------------------------------------
create table if not exists reports (
  id          text primary key,
  student_id  text not null references students (student_id) on update cascade on delete cascade,
  from_date   date not null,
  to_date     date not null,
  analysis    text not null default '',
  comment     text not null default '',
  share_token text unique,
  shared_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (student_id, from_date, to_date)
);
alter table reports enable row level security;

-- ---------------------------------------------------------------
-- 로그인 막기(비밀번호를 계속 넣어 보는 것 방지)와 학생별 숙제 찾기 속도
-- key: 's:<학생 아이디>', 'ip:<주소>', 't:<주소>'(선생님)
-- ---------------------------------------------------------------
create table if not exists login_attempts (
  key          text primary key,
  fails        integer not null default 0,
  last_at      timestamptz not null default now(),
  locked_until timestamptz
);
alter table login_attempts enable row level security;

create index if not exists homework_students_student_idx on homework_students (student_id);
create index if not exists homework_problems_problem_idx on homework_problems (problem_id);

-- ---------------------------------------------------------------
-- 오류 기록: 서버·학생 화면에서 난 오류를 모아 선생님 화면(/teacher/errors)에 보여 준다.
-- source: server(화면 그리기·저장) / browser(학생·선생님 브라우저), who: 'teacher' 또는 학생 아이디
-- ---------------------------------------------------------------
create table if not exists error_logs (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  source     text not null default '',
  place      text not null default '',
  message    text not null default '',
  detail     text not null default '',
  who        text not null default '',
  user_agent text not null default '',
  seen       boolean not null default false
);
create index if not exists error_logs_at_idx on error_logs (at desc);
alter table error_logs enable row level security;

-- ---------------------------------------------------------------
-- 웹앱에서 추가: 틀린 이유. 선생님이 숙제 채점 표에서 틀렸거나 어려워한 칸에 고른다. '' = 안 고름
-- ---------------------------------------------------------------
alter table hw_results add column if not exists reason text not null default ''
  check (reason in ('', '계산 실수', '개념 부족', '문제 이해'));

-- ---------------------------------------------------------------
-- 웹앱에서 추가: 교재 PDF. 파일은 Supabase 저장소(Storage)의 비공개 'textbooks' 통에 두고, 여기엔 목록만 둔다.
-- page_offset: 책에 찍힌 쪽 번호 + page_offset = PDF 쪽 번호
-- ---------------------------------------------------------------
create table if not exists textbooks (
  id           text primary key,
  title        text not null default '',
  storage_path text not null,
  size_bytes   bigint not null default 0,
  pages        integer not null default 0,
  page_offset  integer not null default 0,
  created_at   timestamptz not null default now()
);
alter table textbooks enable row level security;

-- 교재에서 잘라 문제를 만든 자리. 같은 쪽을 다시 열면 전에 만든 문제를 보여 주고,
-- 다시 만들 때는 저장해 둔 글자(ocr_text)를 써서 글자 읽기(Mathpix)를 건너뛴다.
-- x, y, w, h: 쪽 전체를 1로 본 위치·크기 (0~1)
create table if not exists textbook_crops (
  id         bigint generated always as identity primary key,
  book_id    text not null references textbooks (id) on delete cascade,
  page       integer not null,
  x          real not null,
  y          real not null,
  w          real not null,
  h          real not null,
  ocr_text   text not null default '',
  set_id     text references problem_sets (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists textbook_crops_page_idx on textbook_crops (book_id, page);
alter table textbook_crops enable row level security;

-- 웹앱에서 추가: 숙제 초안. 선생님이 '초안 만들기'를 누르면 학생마다 약한 유형 문제로 초안을 만든다.
-- 학생에게는 보이지 않고, 선생님이 승인한 초안만 숙제(homework)로 나간다.
-- status: draft 검토 중 / approved 숙제로 냄(hw_id) / rejected 반려
-- short: 은행이 모자라 못 채운 유형 [{grade, unit, type, need, seed}] (seed = 학생이 틀린 문제, AI로 만들 때 바탕)
-- ---------------------------------------------------------------
create table if not exists hw_drafts (
  draft_id   text primary key,
  batch_id   text not null,
  student_id text not null references students (student_id) on update cascade on delete cascade,
  status     text not null default 'draft' check (status in ('draft', 'approved', 'rejected')),
  title      text not null default '',
  due_date   date,
  memo       text not null default '',
  short      jsonb not null default '[]',
  verified_only boolean not null default false,
  hw_id      text references homework (hw_id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists hw_drafts_status_idx on hw_drafts (status, created_at desc);

-- made_by_ai: 초안을 채우려고 AI로 새로 만든 문제 (선생님이 확인하기 전에는 승인할 수 없다)
create table if not exists hw_draft_problems (
  draft_id   text not null references hw_drafts (draft_id) on delete cascade,
  problem_id text not null references problems (id) on delete cascade,
  position   integer not null,
  made_by_ai boolean not null default false,
  primary key (draft_id, problem_id)
);

alter table hw_drafts         enable row level security;
alter table hw_draft_problems enable row level security;

-- ---------------------------------------------------------------
-- 문제 은행 자동 점검 (2026-11-27)
-- 선생님이 글로 적은 점검 기준(버전마다 한 줄)에 따라 AI가 문제 은행을 몇 문제씩 나눠 점검한다.
-- 확실한 수정(auto_kinds)은 바로 고치고 원래 내용을 review_items.before 에 남겨 되돌릴 수 있게 하고,
-- 애매한 수정은 review_items(status 'pending')로 쌓아 선생님이 승인·반려한다.
-- ---------------------------------------------------------------
create table if not exists review_guidelines (
  version    serial primary key,
  body       text not null default '',
  auto_kinds text[] not null default '{figure,notation,format}',
  note       text not null default '',
  created_at timestamptz not null default now()
);

-- status: running 점검 중 / done 끝 / stopped 선생님이 멈춤 / failed 오류
-- picked: 이번에 볼 문제 id (시작할 때 정함), pos: 다음에 볼 자리, beat_at: 마지막으로 일한 때 (오래 멈춰 있으면 '이어서 하기')
create table if not exists review_runs (
  run_id      text primary key,
  trigger     text not null default 'manual' check (trigger in ('manual', 'cron')),
  status      text not null default 'running' check (status in ('running', 'done', 'stopped', 'failed')),
  guideline_version integer,
  picked      text[] not null default '{}',
  pos         integer not null default 0,
  checked     integer not null default 0,
  auto_fixed  integer not null default 0,
  queued      integer not null default 0,
  failed      integer not null default 0,
  note        text not null default '',
  started_at  timestamptz not null default now(),
  beat_at     timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists review_runs_started_idx on review_runs (started_at desc);

-- mode: auto 바로 고침 / queue 선생님 확인
-- status: applied 고쳐 둠 / undone 되돌림 / pending 확인 기다림 / approved 승인해서 고침 / rejected 반려
-- before/after: {question, answer, solution}. after 가 null 이면 고친 안 없이 알림만 (분류 등)
create table if not exists review_items (
  item_id    text primary key,
  run_id     text references review_runs (run_id) on delete set null,
  problem_id text not null references problems (id) on delete cascade,
  mode       text not null check (mode in ('auto', 'queue')),
  status     text not null check (status in ('applied', 'undone', 'pending', 'approved', 'rejected')),
  kinds      text[] not null default '{}',
  what       text not null default '',
  before     jsonb not null,
  after      jsonb,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists review_items_status_idx on review_items (status, created_at desc);
create index if not exists review_items_problem_idx on review_items (problem_id);

-- 문제마다 마지막으로 점검한 때. hash 는 문제·정답·풀이 (바뀌면 다시 점검), skip 이면 자동 점검에서 뺀다
create table if not exists problem_reviews (
  problem_id text primary key references problems (id) on delete cascade,
  hash       text not null default '',
  guideline_version integer,
  reviewed_at timestamptz not null default now(),
  skip       boolean not null default false
);

alter table review_guidelines enable row level security;
alter table review_runs       enable row level security;
alter table review_items      enable row level security;
alter table problem_reviews   enable row level security;
