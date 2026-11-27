import "server-only";
import { createHmac } from "node:crypto";
import type postgres from "postgres";
import { db } from "./db";
import { geminiJson } from "./ai/clients";
import { bankFixInstruction, bankReviewPrompt, type ReviewInput } from "./ai/bankReviewPrompt";
import { editOne } from "./create";
import { outOfLevel } from "./levelCheck";
import { problemIssues, stripExamNumber, tidyProblem } from "./problemCheck";
import { reportError } from "./reportError";
import { sameSecret } from "./password";
import { autoVerdict, contentHash, DEFAULT_AUTO, DEFAULT_GUIDE, isKind, KINDS, parseFindings, type Content, type Kind } from "./bankReviewCore";

/*
 * 문제 은행 자동 점검.
 * 1) 선생님이 쓴 점검 기준(review_guidelines, 버전마다 한 줄)을 따른다.
 * 2) 점검 한 번(review_runs)은 시작할 때 볼 문제를 정해 두고(picked), CHUNK 문제씩 나눠 본다.
 *    Vercel 함수 시간 한도 때문에 한 번 부를 때 몇 묶음만 보고, 남으면 /api/bank-review/step 을 다시 불러 이어 간다.
 * 3) 문제마다: 코드 점검(tidyProblem·problemIssues·학년 범위) + Gemini 점검(기준 포함, 묶어서 한 번) → 고칠 것이 있으면 editOne 으로 고친 안.
 *    고친 안이 안전하면(autoVerdict) 바로 고치고 원래 내용을 review_items.before 에 둔다(되돌리기).
 *    아니면 확인함(review_items pending)에 넣어 선생님이 승인·고쳐서 승인·반려한다.
 */

/** 한 묶음 문제 수 (Gemini 점검 한 번에 보내는 문제 수) */
const CHUNK = 5;
/** 한 번 불렀을 때 새 묶음을 시작하는 시간 한도. 묶음 하나는 길면 4분쯤 걸려 maxDuration(300초) 안에 끝나게 한다 */
const START_LIMIT_MS = 50_000;
/** 이만큼 일하지 않은 점검은 멈춘 것으로 본다 (이어서 하기 가능) */
export const STALE_MS = 6 * 60_000;
export const RUN_SIZES = [30, 80, 150, 300] as const;
/** 매주 자동 점검에서 볼 문제 수 */
export const CRON_SIZE = 150;
/** 다시 점검하는 간격 (일) */
const RECHECK_DAYS = 30;

type Sql = postgres.Sql;
type Tx = postgres.TransactionSql;

const newId = (p: string) => `${p}${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

/* ---------------- 점검 기준 ---------------- */

export type Guide = { version: number; body: string; autoKinds: Kind[]; note: string; createdAt: Date | null };

const toGuide = (r: Record<string, unknown>): Guide => ({
  version: r.version as number,
  body: r.body as string,
  autoKinds: ((r.auto_kinds as string[]) ?? []).filter(isKind),
  note: r.note as string,
  createdAt: r.created_at as Date,
});
const DEFAULT: Guide = { version: 0, body: DEFAULT_GUIDE, autoKinds: DEFAULT_AUTO, note: "처음 기준", createdAt: null };

/** 지금 쓰는 기준 (아직 저장한 적 없으면 기본 기준, version 0) */
export async function currentGuide(): Promise<Guide> {
  const [r] = await db()`select * from review_guidelines order by version desc limit 1`;
  return r ? toGuide(r) : DEFAULT;
}

async function guideAt(version: number | null): Promise<Guide> {
  if (!version) return DEFAULT;
  const [r] = await db()`select * from review_guidelines where version = ${version}`;
  return r ? toGuide(r) : currentGuide();
}

export async function guideHistory(limit = 30): Promise<Guide[]> {
  const rows = await db()`select * from review_guidelines order by version desc limit ${limit}`;
  return rows.map(toGuide);
}

export async function saveGuide(body: string, autoKinds: Kind[], note: string): Promise<Guide> {
  const [r] = await db()`
    insert into review_guidelines (body, auto_kinds, note) values (${body}, ${autoKinds}, ${note}) returning *`;
  return toGuide(r);
}

/* ---------------- 점검 실행 ---------------- */

export type Run = {
  runId: string;
  trigger: "manual" | "cron";
  status: "running" | "done" | "stopped" | "failed";
  guidelineVersion: number;
  total: number;
  pos: number;
  checked: number;
  autoFixed: number;
  queued: number;
  failed: number;
  note: string;
  startedAt: Date;
  beatAt: Date;
  finishedAt: Date | null;
  stale: boolean;
};

const toRun = (r: Record<string, unknown>): Run => ({
  runId: r.run_id as string,
  trigger: r.trigger as Run["trigger"],
  status: r.status as Run["status"],
  guidelineVersion: (r.guideline_version as number) ?? 0,
  total: r.total as number,
  pos: r.pos as number,
  checked: r.checked as number,
  autoFixed: r.auto_fixed as number,
  queued: r.queued as number,
  failed: r.failed as number,
  note: r.note as string,
  startedAt: r.started_at as Date,
  beatAt: r.beat_at as Date,
  finishedAt: (r.finished_at as Date) ?? null,
  stale: r.status === "running" && Date.now() - (r.beat_at as Date).getTime() > STALE_MS,
});
const RUN_COLS = (sql: Sql) => sql`run_id, trigger, status, guideline_version, cardinality(picked) as total, pos, checked, auto_fixed, queued, failed, note, started_at, beat_at, finished_at`;

export async function listRuns(limit = 10): Promise<Run[]> {
  const sql = db();
  const rows = await sql`select ${RUN_COLS(sql)} from review_runs order by started_at desc limit ${limit}`;
  return rows.map(toRun);
}

async function getRun(runId: string): Promise<Run | null> {
  const sql = db();
  const [r] = await sql`select ${RUN_COLS(sql)} from review_runs where run_id = ${runId}`;
  return r ? toRun(r) : null;
}

/** 점검할 문제 고르기: 새 문제·고쳐진 문제 → 기준이 바뀐 뒤 아직 안 본 문제 → 오래전에 본 문제 순. 건너뛰기·확인 기다리는 문제는 뺀다 */
async function pickProblems(limit: number, version: number): Promise<string[]> {
  const rows = await db()`
    select p.id from problems p
    left join problem_reviews r on r.problem_id = p.id
    where coalesce(r.skip, false) = false
      and not exists (select 1 from review_items i where i.problem_id = p.id and i.status = 'pending')
      and (r.problem_id is null
        or r.hash <> md5(concat_ws(chr(1), p.question, p.answer, p.solution))
        or coalesce(r.guideline_version, 0) <> ${version}
        or r.reviewed_at < now() - make_interval(days => ${RECHECK_DAYS}))
    order by
      case when r.problem_id is null or r.hash <> md5(concat_ws(chr(1), p.question, p.answer, p.solution)) then 0
           when coalesce(r.guideline_version, 0) <> ${version} then 1 else 2 end,
      coalesce(r.reviewed_at, p.created_at), p.created_at
    limit ${limit}`;
  return rows.map((r) => r.id as string);
}

export type StartResult = { ok: true; runId: string; resumed: boolean; total: number } | { ok: false; error: string };

/** 점검 시작. 이미 도는 점검이 있으면 그것을 쓰고(멈춰 있으면 이어서), 없으면 새로 만든다. 일은 processRun 이 한다 */
export async function startRun(trigger: "manual" | "cron", size: number): Promise<StartResult> {
  const sql = db();
  const [running] = await sql`select ${RUN_COLS(sql)} from review_runs where status = 'running' order by started_at desc limit 1`;
  if (running) {
    const r = toRun(running);
    if (!r.stale) return { ok: false, error: "이미 점검 중이에요. 끝날 때까지 기다리거나 멈춘 뒤 다시 시작해 주세요." };
    await sql`update review_runs set beat_at = now() where run_id = ${r.runId}`;
    return { ok: true, runId: r.runId, resumed: true, total: r.total };
  }
  const guide = await currentGuide();
  const picked = await pickProblems(Math.max(1, Math.min(500, size)), guide.version);
  const runId = newId("rv");
  await sql`
    insert into review_runs (run_id, trigger, status, guideline_version, picked, note, finished_at)
    values (${runId}, ${trigger}, ${picked.length ? "running" : "done"}, ${guide.version}, ${picked},
      ${picked.length ? "" : "점검할 문제가 없어요 (모두 최근에 지금 기준으로 봤어요)."}, ${picked.length ? null : new Date()})`;
  return { ok: true, runId, resumed: false, total: picked.length };
}

export async function stopRun(runId: string) {
  await db()`update review_runs set status = 'stopped', finished_at = now(), note = '선생님이 멈췄어요.' where run_id = ${runId} and status = 'running'`;
}

/** 다음 묶음을 맡는다 (같은 묶음을 두 번 보지 않게 pos 를 먼저 옮긴다) */
async function claimChunk(runId: string): Promise<{ ids: string[]; last: boolean } | null> {
  const [r] = await db()`
    with cur as (
      select pos from review_runs where run_id = ${runId} and status = 'running' and pos < cardinality(picked) for update
    )
    update review_runs r set pos = least(r.pos + ${CHUNK}, cardinality(r.picked)), beat_at = now()
    from cur where r.run_id = ${runId}
    returning cur.pos as start, r.pos as stop, r.picked`;
  if (!r) return null;
  const picked = r.picked as string[];
  return { ids: picked.slice(r.start as number, r.stop as number), last: (r.stop as number) >= picked.length };
}

/** 점검을 이어 간다. 시간 한도 안에서 묶음을 몇 개 보고, 남으면 다음 호출을 부른다 (origin = 이 앱 주소) */
export async function processRun(runId: string, origin: string) {
  const t0 = Date.now();
  const run = await getRun(runId);
  if (!run || run.status !== "running") return;
  const guide = await guideAt(run.guidelineVersion);
  if (!process.env.GEMINI_API_KEY) {
    await db()`update review_runs set status = 'failed', finished_at = now(), note = 'Gemini 키(GEMINI_API_KEY)가 없어 점검하지 못했어요.' where run_id = ${runId}`;
    return;
  }
  let more = true;
  while (Date.now() - t0 < START_LIMIT_MS) {
    const chunk = await claimChunk(runId);
    if (!chunk) {
      // 볼 문제가 더 없다 (마지막 묶음 도중 멈췄던 점검도 여기서 끝낸다)
      await db()`update review_runs set status = 'done', finished_at = now() where run_id = ${runId} and status = 'running' and pos >= cardinality(picked)`;
      more = false;
      break;
    }
    let c = { auto: 0, queued: 0 };
    let failed = 0;
    try {
      c = await reviewChunk(runId, chunk.ids, guide);
    } catch (e) {
      failed = chunk.ids.length;
      await safeReport("문제 은행 자동 점검", e);
    }
    await db()`
      update review_runs set
        checked = checked + ${chunk.ids.length - failed}, failed = failed + ${failed},
        auto_fixed = auto_fixed + ${c.auto}, queued = queued + ${c.queued}, beat_at = now(),
        status = case when ${chunk.last} and status = 'running' then 'done' else status end,
        finished_at = case when ${chunk.last} and status = 'running' then now() else finished_at end
      where run_id = ${runId}`;
    if (chunk.last) {
      more = false;
      break;
    }
  }
  if (more) await kick(origin, runId);
}

async function safeReport(place: string, e: unknown) {
  try {
    await reportError(place, e);
  } catch {
    console.error(place, e);
  }
}

/* ---------------- 다음 호출 부르기 ---------------- */

/** 이어 가기 호출에 붙이는 표 (점검마다 다르고, SESSION_SECRET 이 있어야 만들 수 있다) */
export function stepToken(runId: string) {
  const secret = process.env.SESSION_SECRET ?? "";
  if (secret.length < 32) throw new Error("SESSION_SECRET 환경변수(32자 이상)가 필요합니다.");
  return createHmac("sha256", secret).update(`bank-review:${runId}`).digest("base64url");
}
export const validStepToken = (runId: string, token: string) => !!runId && sameSecret(token, stepToken(runId));

/** /api/bank-review/step 을 부른다. 그쪽은 바로 답하고 뒤에서 일하므로 오래 기다리지 않는다 */
export async function kick(origin: string, runId: string) {
  try {
    const res = await fetch(`${origin}/api/bank-review/step`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${stepToken(runId)}` },
      body: JSON.stringify({ runId }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`이어 가기 호출 실패 ${res.status}`);
  } catch (e) {
    // 못 부르면 점검이 멈춘 채로 남고, 화면의 '이어서 하기'나 다음 주 자동 점검이 이어 간다
    await safeReport("문제 은행 자동 점검 이어 가기", e);
  }
}

/* ---------------- 묶음 하나 점검 ---------------- */

type Row = Content & { id: string; grade: string; unit: string; type: string; difficulty: string; verified: boolean; createdAt: Date };

/** 코드 점검 결과를 종류로 나눈다 */
function codeKind(issue: string): Kind {
  if (issue.startsWith("풀이에")) return "solution";
  if (issue.includes("객관식")) return "format";
  return "figure";
}

async function reviewChunk(runId: string, ids: string[], guide: Guide): Promise<{ auto: number; queued: number }> {
  const sql = db();
  const rows = (
    await sql`select id, grade, unit, type, difficulty, verified, question, answer, solution, created_at from problems where id = any(${ids})`
  ).map(
    (r): Row => ({
      id: r.id,
      grade: r.grade,
      unit: r.unit,
      type: r.type,
      difficulty: r.difficulty,
      verified: r.verified,
      question: r.question,
      answer: r.answer,
      solution: r.solution,
      createdAt: r.created_at,
    }),
  );
  if (!rows.length) return { auto: 0, queued: 0 };

  // 1) 코드 점검 (시험지 번호·작은 글자는 코드로 바로 고침, 나머지는 고칠 것으로)
  const prep = rows.map((p) => {
    const before: Content = { question: p.question, answer: p.answer, solution: p.solution };
    const tidy = tidyProblem(before);
    const issues = problemIssues(tidy).map((s) => ({ kind: codeKind(s), what: s.split(".")[0], fix: s }));
    const level = outOfLevel(p.grade, tidy.solution);
    if (level.length)
      issues.push({
        kind: "grade",
        what: `풀이에 ${p.grade}에서 아직 배우지 않은 표현(${level.join(", ")})이 있어요`,
        fix: `풀이에 ${p.grade}에서 아직 배우지 않은 표현(${level.join(", ")})이 있다. 정답은 그대로 두고 ${p.grade}에서 배우는 방식으로 풀이를 다시 써라.`,
      });
    return { p, before, tidy, issues };
  });

  // 2) AI 점검 (묶음 한 번에)
  const inputs: ReviewInput[] = prep.map(({ p, tidy, issues }) => ({
    id: p.id,
    grade: p.grade,
    unit: p.unit,
    type: p.type,
    difficulty: p.difficulty,
    createdAt: p.createdAt.toISOString().slice(0, 10),
    ...tidy,
    known: issues.map((i) => i.what),
  }));
  const raw = await geminiJson(bankReviewPrompt(guide.body, inputs));
  if (!Array.isArray((raw as { results?: unknown }).results)) throw new Error("AI 점검 답을 읽지 못했어요");
  const found = new Map(parseFindings(raw, ids).map((f) => [f.id, f]));

  // 3) 문제마다 고친 안 → 바로 고치기 / 확인함
  const results = await Promise.all(
    prep.map(async ({ p, before, tidy, issues }) => {
      const ai = found.get(p.id);
      const kinds = [...new Set<Kind>([...issues.map((i) => i.kind), ...(ai?.kinds ?? [])])];
      const tidied = contentHash(tidy) !== contentHash(before);
      const stripped = stripExamNumber(before.question);
      const tidyNote = [
        stripped !== before.question && "문제 앞 시험지 번호를 지웠어요",
        (tidy.question !== stripped || tidy.solution !== before.solution) && "그림 글자 크기·길이 글자 테두리를 정리했어요",
      ].filter((x): x is string => !!x);
      const what = [...issues.map((i) => i.what), ...(ai ? [ai.what] : []), ...tidyNote].join(" / ");
      const fixes = [...issues.map((i) => i.fix), ...(ai ? [ai.fix] : [])].join("\n");
      let after: Content | null = null;
      let note = "";

      if (kinds.length && kinds.some((k) => k !== "class")) {
        try {
          const target = kinds.every((k) => k === "solution" || k === "grade" || k === "class") ? "solution" : "problem";
          after = await editOne(tidy, bankFixInstruction(guide.body, fixes), undefined, target, { grade: p.grade, unit: p.unit, type: p.type });
        } catch (e) {
          note = "AI가 고친 안을 만들지 못했어요. 직접 고쳐 주세요.";
          after = tidied ? tidy : null;
          console.error("자동 점검 고친 안 만들기 실패", p.id, e);
        }
      } else if (tidied) {
        after = tidy;
        if (!kinds.length) kinds.push("format");
      }
      if (after && contentHash(after) === contentHash(before)) after = null;

      let mode: "auto" | "queue" | null = null;
      if (after) {
        const v = autoVerdict(before, after, kinds, guide.autoKinds, p.verified);
        mode = v.auto ? "auto" : "queue";
        if (!v.auto) note = [note, v.why].filter(Boolean).join(" ");
      } else if (kinds.length && (note || kinds.some((k) => !guide.autoKinds.includes(k)))) mode = "queue"; // 고친 안 없이 알림만
      if (mode === "auto") {
        const done = await sql`
          update problems set question = ${after!.question}, answer = ${after!.answer}, solution = ${after!.solution}
          where id = ${p.id} and md5(concat_ws(chr(1), question, answer, solution)) = ${contentHash(before)} returning id`;
        if (!done.length) mode = null; // 점검하는 동안 선생님이 고쳤다
      }
      if (mode)
        await sql`
          insert into review_items (item_id, run_id, problem_id, mode, status, kinds, what, before, after)
          values (${newId("ri")}, ${runId}, ${p.id}, ${mode}, ${mode === "auto" ? "applied" : "pending"}, ${kinds},
            ${[what || kinds.map((k) => KINDS[k]).join(", "), note].filter(Boolean).join(" · ").slice(0, 3000)},
            ${sql.json(before)}, ${after ? sql.json(after) : null})`;
      const now = mode === "auto" ? after! : before;
      await sql`
        insert into problem_reviews (problem_id, hash, guideline_version, reviewed_at)
        values (${p.id}, ${contentHash(now)}, ${guide.version}, now())
        on conflict (problem_id) do update set hash = excluded.hash, guideline_version = excluded.guideline_version, reviewed_at = now()`;
      return mode;
    }),
  );
  return { auto: results.filter((m) => m === "auto").length, queued: results.filter((m) => m === "queue").length };
}

/* ---------------- 확인함·되돌리기 ---------------- */

export type Item = {
  itemId: string;
  runId: string | null;
  problemId: string;
  mode: "auto" | "queue";
  status: "applied" | "undone" | "pending" | "approved" | "rejected";
  kinds: Kind[];
  what: string;
  before: Content;
  after: Content | null;
  createdAt: Date;
  decidedAt: Date | null;
  grade: string;
  unit: string;
  type: string;
  /** 지금 문제가 점검 뒤에 다시 고쳐졌는지 */
  changedSince: boolean;
};

const toItem = (r: Record<string, unknown>): Item => {
  const before = r.before as Content;
  const after = (r.after as Content | null) ?? null;
  const expect = r.status === "applied" || r.status === "approved" ? after : before;
  return {
    itemId: r.item_id as string,
    runId: (r.run_id as string) ?? null,
    problemId: r.problem_id as string,
    mode: r.mode as Item["mode"],
    status: r.status as Item["status"],
    kinds: ((r.kinds as string[]) ?? []).filter(isKind),
    what: r.what as string,
    before,
    after,
    createdAt: r.created_at as Date,
    decidedAt: (r.decided_at as Date) ?? null,
    grade: (r.grade as string) ?? "",
    unit: (r.unit as string) ?? "",
    type: (r.type as string) ?? "",
    changedSince: !!expect && r.now_hash !== contentHash(expect),
  };
};

export async function listItems(which: "pending" | "auto", limit = 50): Promise<Item[]> {
  const sql = db();
  const rows = await sql`
    select i.*, p.grade, p.unit, p.type, md5(concat_ws(chr(1), p.question, p.answer, p.solution)) as now_hash
    from review_items i join problems p on p.id = i.problem_id
    where ${which === "pending" ? sql`i.status = 'pending'` : sql`i.mode = 'auto'`}
    order by ${which === "pending" ? sql`i.created_at` : sql`i.created_at desc`}
    limit ${limit}`;
  return rows.map(toItem);
}

export async function pendingCount(): Promise<number> {
  const [r] = await db()`select count(*)::int as n from review_items where status = 'pending'`;
  return r.n as number;
}

type Fail = { ok: false; error: string; changed?: boolean };

async function lockItem(sql: Tx, itemId: string) {
  const [r] = await sql`
    select i.*, md5(concat_ws(chr(1), p.question, p.answer, p.solution)) as now_hash
    from review_items i join problems p on p.id = i.problem_id where i.item_id = ${itemId} for update of i`;
  return r ? toItem(r) : null;
}

async function setProblem(sql: Tx, id: string, c: Content, skip?: boolean) {
  await sql`update problems set question = ${c.question}, answer = ${c.answer}, solution = ${c.solution} where id = ${id}`;
  await markReviewed(sql, id, c, skip);
}
async function markReviewed(sql: Tx, id: string, c: Content, skip?: boolean) {
  const guide = await currentGuide();
  await sql`
    insert into problem_reviews (problem_id, hash, guideline_version, reviewed_at, skip)
    values (${id}, ${contentHash(c)}, ${guide.version}, now(), ${!!skip})
    on conflict (problem_id) do update set hash = excluded.hash, guideline_version = excluded.guideline_version, reviewed_at = now(),
      skip = problem_reviews.skip or excluded.skip`;
}

/** 자동으로 고친 것을 원래대로. 그 뒤에 문제가 또 고쳐졌으면 force 일 때만 */
export async function undoItem(itemId: string, force: boolean): Promise<{ ok: true } | Fail> {
  return db().begin(async (sql) => {
    const it = await lockItem(sql, itemId);
    if (!it || it.status !== "applied") return { ok: false, error: "이미 되돌렸거나 없는 수정이에요." };
    if (it.changedSince && !force) return { ok: false, changed: true, error: "고친 뒤에 문제가 또 바뀌었어요. 그래도 되돌리면 그 뒤에 바꾼 것도 없어져요." };
    await setProblem(sql, it.problemId, it.before);
    await sql`update review_items set status = 'undone', decided_at = now() where item_id = ${itemId}`;
    return { ok: true };
  });
}

/** 확인함 승인 (edited = 선생님이 고친 안). 고친 안이 없는 알림은 '확인함'으로만 표시 */
export async function approveItem(itemId: string, edited: Content | null, force: boolean): Promise<{ ok: true } | Fail> {
  return db().begin(async (sql) => {
    const it = await lockItem(sql, itemId);
    if (!it || it.status !== "pending") return { ok: false, error: "이미 처리했거나 없는 항목이에요." };
    const content = edited ?? it.after;
    if (content) {
      if (!content.question.trim()) return { ok: false, error: "문제 내용이 비어 있어요." };
      if (it.changedSince && !force) return { ok: false, changed: true, error: "점검한 뒤에 문제가 이미 바뀌었어요. 그래도 고친 안으로 덮어쓸까요?" };
      await setProblem(sql, it.problemId, content);
    } else {
      const [p] = await sql`select question, answer, solution from problems where id = ${it.problemId}`;
      if (p) await markReviewed(sql, it.problemId, p as unknown as Content);
    }
    await sql`update review_items set status = 'approved', decided_at = now(), after = ${content ? sql.json(content) : null} where item_id = ${itemId}`;
    return { ok: true };
  });
}

/** 반려: 문제는 그대로. skip 이면 이 문제를 다음부터 자동 점검에서 뺀다 */
export async function rejectItem(itemId: string, skip: boolean): Promise<{ ok: true } | Fail> {
  return db().begin(async (sql) => {
    const it = await lockItem(sql, itemId);
    if (!it || it.status !== "pending") return { ok: false, error: "이미 처리했거나 없는 항목이에요." };
    const [p] = await sql`select question, answer, solution from problems where id = ${it.problemId}`;
    if (p) await markReviewed(sql, it.problemId, p as unknown as Content, skip);
    await sql`update review_items set status = 'rejected', decided_at = now() where item_id = ${itemId}`;
    return { ok: true };
  });
}

/** 건너뛰기로 뺀 문제 수, 다시 넣기 */
export async function skippedCount(): Promise<number> {
  const [r] = await db()`select count(*)::int as n from problem_reviews where skip`;
  return r.n as number;
}
export async function setSkip(problemId: string, skip: boolean) {
  await db()`
    insert into problem_reviews (problem_id, hash, skip) values (${problemId}, '', ${skip})
    on conflict (problem_id) do update set skip = excluded.skip, hash = case when excluded.skip then problem_reviews.hash else '' end`;
}

export async function listSkipped(limit = 50): Promise<{ id: string; grade: string; unit: string; type: string }[]> {
  const rows = await db()`
    select p.id, p.grade, p.unit, p.type from problem_reviews r join problems p on p.id = r.problem_id
    where r.skip order by p.grade, p.unit, p.type limit ${limit}`;
  return rows.map((r) => ({ id: r.id as string, grade: r.grade as string, unit: r.unit as string, type: r.type as string }));
}
