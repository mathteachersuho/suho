import "server-only";
import { db } from "./db";
import { insertHomework } from "./homework";
import { weakPlan, type TypeKey } from "./weak";
import { findSwap } from "./quick";
import { generateOne } from "./create";
import { figuresToBlocks } from "./figure";
import { brief, fingerprint, sameProblem } from "./similar";
import { sameTypeProblems } from "./problems";
import { reportError } from "./reportError";
import type { Generated } from "./ai/prompts";

/*
 * 숙제 초안: 선생님이 '초안 만들기'를 누르면 학생마다 약한 유형 문제로 초안을 만들어 저장한다 (lib/weak.ts 와 같은 고르기).
 * 초안은 학생에게 보이지 않는다. 선생님이 문제를 빼거나 같은 유형의 다른 문제로 바꾼 뒤 승인해야 숙제로 나간다.
 * 은행이 모자란 유형은 학생이 틀린 문제를 바탕으로 AI가 새 유사문제를 만들어 채울 수 있다.
 * AI가 만든 문제는 그림·정답이 틀릴 수 있으니 선생님이 '확인함'(= 검수)을 누르거나 빼야 승인할 수 있다.
 */

export type DraftShort = TypeKey & { need: number; seed: string | null };
export type DraftItem = {
  id: string;
  question: string;
  answer: string;
  solution: string;
  type: string;
  frame: string;
  difficulty: string;
  verified: boolean;
  madeByAi: boolean;
};
export type DraftStatus = "draft" | "approved" | "rejected";
export type Draft = {
  draftId: string;
  batchId: string;
  studentId: string;
  name: string;
  classId: string;
  status: DraftStatus;
  title: string;
  dueDate: string;
  memo: string;
  short: DraftShort[];
  verifiedOnly: boolean;
  hwId: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  items: DraftItem[];
};

/** 한 학생 초안의 문제 수는 많아야 이만큼 */
export const DRAFT_MAX = 30;
/** AI로 채우기 한 번에 만드는 문제 수 (기다리는 시간이 2분을 넘지 않게) */
export const FILL_PER_CALL = 4;

const newId = (p: string) => `${p}${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
/** 문제 묶음 번호: 문제 만들기 저장과 같은 모양 (13자리 시각 x 6자리 임의 숫자) */
const newSetId = () => `${Date.now()}x${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;

/** n 문제를 유형들에 돌아가며 나눌 때 유형마다 몇 문제 */
function share(n: number, types: number) {
  return Array.from({ length: types }, (_, i) => Math.floor(n / types) + (i < n % types ? 1 : 0));
}

export type MakeInput = {
  studentIds: string[];
  count: number;
  verifiedOnly: boolean;
  dueOnly: boolean;
  title: string;
  dueDate: string;
  memo: string;
};
export type MakeResult = { made: { studentId: string; problems: number; short: number }[]; skipped: { studentId: string; reason: string }[] };

/**
 * 학생마다 초안을 하나씩 만든다. 그 학생의 검토 중인 초안이 있으면 새 초안으로 바꾼다 (승인·반려한 초안은 그대로).
 * 약한 유형이 없는 학생은 만들지 않고 이유를 돌려준다.
 */
export async function makeDrafts(input: MakeInput): Promise<MakeResult> {
  const batchId = newId("b");
  const out: MakeResult = { made: [], skipped: [] };
  // DB 연결이 5개라 학생 셋씩 나눠서
  for (let i = 0; i < input.studentIds.length; i += 3) {
    const part = input.studentIds.slice(i, i + 3);
    const res = await Promise.all(part.map((sid) => makeOne(sid, batchId, input)));
    res.forEach((r, j) => {
      if ("reason" in r) out.skipped.push({ studentId: part[j], reason: r.reason });
      else out.made.push({ studentId: part[j], ...r });
    });
  }
  return out;
}

async function makeOne(studentId: string, batchId: string, input: MakeInput): Promise<{ problems: number; short: number } | { reason: string }> {
  const plan = await weakPlan(studentId, input.count, input.verifiedOnly, null, input.dueOnly, null);
  if (!plan.types.length)
    return {
      reason: plan.untyped
        ? `틀린 문제 ${plan.untyped}개에 유형이 없어 약한 유형을 못 찾았어요`
        : input.dueOnly
          ? "오늘 복습할 유형이 없어요"
          : "아직 틀렸거나 어려워한 유형이 없어요",
    };
  // 화면에서 유형이 섞이게 돌아가며 고른 순서로
  const ids: string[] = [];
  for (let round = 0; ; round++) {
    const row = plan.types.flatMap((t) => (t.picked[round] ? [t.picked[round].id] : []));
    if (!row.length) break;
    ids.push(...row);
  }
  // 은행이 모자라 못 채운 문제: 유형마다 고르게 나눴을 때 모자란 만큼 (모두 합쳐 count - 고른 수)
  const want = share(input.count, plan.types.length);
  let left = Math.max(0, input.count - ids.length);
  const shortTypes = plan.types
    .map((t, i) => ({ t, need: Math.max(0, want[i] - t.picked.length) }))
    .filter((x) => x.need > 0)
    .map((x) => {
      const need = Math.min(x.need, left);
      left -= need;
      return { grade: x.t.grade, unit: x.t.unit, type: x.t.type, need };
    })
    .filter((x) => x.need > 0);
  const seeds = shortTypes.length ? await seedProblems(studentId, shortTypes) : [];
  const short: DraftShort[] = shortTypes.map((x, i) => ({ ...x, seed: seeds[i] }));

  const draftId = newId("d");
  await db().begin(async (tx) => {
    await tx`delete from hw_drafts where student_id = ${studentId} and status = 'draft'`;
    await tx`
      insert into hw_drafts (draft_id, batch_id, student_id, title, due_date, memo, short, verified_only)
      values (${draftId}, ${batchId}, ${studentId}, ${input.title}, ${input.dueDate || null}, ${input.memo},
              ${tx.json(short)}, ${input.verifiedOnly})`;
    if (ids.length)
      await tx`insert into hw_draft_problems ${tx(ids.map((problem_id, i) => ({ draft_id: draftId, problem_id, position: i + 1, made_by_ai: false })))}`;
  });
  return { problems: ids.length, short: short.reduce((a, s) => a + s.need, 0) };
}

/** 유형마다 학생이 가장 최근에 틀린(또는 어려워한) 문제. AI로 채울 때 이 문제를 바탕으로 만든다. */
async function seedProblems(studentId: string, types: TypeKey[]): Promise<(string | null)[]> {
  const rows = await db()`
    select t.ord, s.id
    from unnest(${types.map((t) => t.grade)}::text[], ${types.map((t) => t.unit)}::text[], ${types.map((t) => t.type)}::text[],
                ${types.map((_, i) => i)}::int[]) as t(grade, unit, type, ord)
    cross join lateral (
      select p.id from hw_results r join problems p on p.id = r.problem_id join homework h on h.hw_id = r.hw_id
      where r.student_id = ${studentId} and (r.correct = 'N' or '어려워함' = any(r.tags))
        and p.grade = t.grade and p.unit = t.unit and p.type = t.type
      order by h.created_at desc limit 1
    ) s`;
  const out: (string | null)[] = types.map(() => null);
  for (const r of rows) out[r.ord as number] = r.id as string;
  return out;
}

/** 초안 목록. pending = 검토 중, 아니면 최근에 승인·반려한 것 */
export async function listDrafts(pending: boolean, limit = 100): Promise<Draft[]> {
  const sql = db();
  const rows = await sql`
    select d.*, d.due_date::text as due, s.name, s.class_id
    from hw_drafts d join students s on s.student_id = d.student_id
    where ${pending ? sql`d.status = 'draft'` : sql`d.status <> 'draft'`}
    order by ${pending ? sql`s.class_id, s.name, s.student_id` : sql`d.decided_at desc nulls last`}
    limit ${limit}`;
  if (!rows.length) return [];
  const items = pending
    ? await sql`
        select dp.draft_id, dp.made_by_ai, p.id, p.question, p.answer, p.solution, p.type, p.frame, p.difficulty, p.verified
        from hw_draft_problems dp join problems p on p.id = dp.problem_id
        where dp.draft_id = any(${rows.map((r) => r.draft_id as string)})
        order by dp.draft_id, dp.position`
    : [];
  const byDraft = new Map<string, DraftItem[]>();
  for (const r of items) {
    const list = byDraft.get(r.draft_id) ?? [];
    list.push({
      id: r.id,
      question: r.question,
      answer: r.answer,
      solution: r.solution,
      type: r.type,
      frame: r.frame,
      difficulty: r.difficulty,
      verified: r.verified,
      madeByAi: r.made_by_ai,
    });
    byDraft.set(r.draft_id, list);
  }
  return rows.map((r) => ({
    draftId: r.draft_id,
    batchId: r.batch_id,
    studentId: r.student_id,
    name: r.name,
    classId: r.class_id,
    status: r.status,
    title: r.title,
    dueDate: r.due ?? "",
    memo: r.memo,
    short: Array.isArray(r.short) ? r.short : [],
    verifiedOnly: r.verified_only,
    hwId: r.hw_id,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    items: byDraft.get(r.draft_id) ?? [],
  }));
}

export async function pendingDraftCount(): Promise<number> {
  const [r] = await db()`select count(*)::int as n from hw_drafts where status = 'draft'`;
  return r?.n ?? 0;
}

type Fail = { ok: false; error: string };
const NOT_OPEN: Fail = { ok: false, error: "이미 승인했거나 반려한 초안이에요. 새로고침해 주세요." };

/** 초안에서 문제 하나 빼기 */
export async function removeDraftProblem(draftId: string, problemId: string): Promise<{ ok: true } | Fail> {
  return db().begin(async (tx) => {
    const [d] = await tx`select 1 from hw_drafts where draft_id = ${draftId} and status = 'draft' for update`;
    if (!d) return NOT_OPEN;
    await tx`delete from hw_draft_problems where draft_id = ${draftId} and problem_id = ${problemId}`;
    return { ok: true as const };
  });
}

/** 초안의 문제 하나를 같은 유형의 학생이 안 받은 다른 문제로 바꾼다. skipped = 앞서 바꿔 뺀 문제 (되도록 다시 고르지 않게) */
export async function swapDraftProblem(draftId: string, problemId: string, skipped: string[]): Promise<{ ok: true; note?: string } | Fail> {
  const sql = db();
  const [d] = await sql`select student_id, verified_only from hw_drafts where draft_id = ${draftId} and status = 'draft'`;
  if (!d) return NOT_OPEN;
  const [p] = await sql`select id, grade, unit, type, frame, difficulty from problems where id = ${problemId}`;
  if (!p) return { ok: false, error: "문제를 찾지 못했어요." };
  const inDraft = (await sql`select problem_id from hw_draft_problems where draft_id = ${draftId}`).map((r) => r.problem_id as string);
  if (!inDraft.includes(problemId)) return { ok: false, error: "이 초안에 없는 문제예요. 새로고침해 주세요." };
  const found = await findSwap(
    { id: p.id, grade: p.grade, unit: p.unit, type: p.type, frame: p.frame, difficulty: p.difficulty },
    d.student_id,
    inDraft,
    skipped,
    d.verified_only,
  );
  if (!found) return { ok: false, error: "이 유형에 아직 안 받은 다른 문제가 없어요. 'AI로 채우기'를 쓰거나 빼 주세요." };
  return sql.begin(async (tx) => {
    const [open] = await tx`select 1 from hw_drafts where draft_id = ${draftId} and status = 'draft' for update`;
    if (!open) return NOT_OPEN;
    const [clash] = await tx`select 1 from hw_draft_problems where draft_id = ${draftId} and problem_id = ${found.problem.id}`;
    if (clash) return { ok: false as const, error: "다른 문제와 겹쳐서 바꾸지 못했어요. 다시 눌러 주세요." };
    const r = await tx`
      update hw_draft_problems set problem_id = ${found.problem.id}, made_by_ai = false
      where draft_id = ${draftId} and problem_id = ${problemId}`;
    if (!r.count) return { ok: false as const, error: "이 초안에 없는 문제예요. 새로고침해 주세요." };
    return { ok: true as const, note: found.note };
  });
}

/** AI가 만든 문제를 선생님이 그림·정답까지 확인함 → 은행에서도 검수한 문제가 된다 */
export async function confirmDraftProblem(draftId: string, problemId: string): Promise<{ ok: true } | Fail> {
  const r = await db()`
    update problems p set verified = true
    from hw_draft_problems dp join hw_drafts d on d.draft_id = dp.draft_id
    where dp.draft_id = ${draftId} and dp.problem_id = ${problemId} and p.id = dp.problem_id and d.status = 'draft'`;
  return r.count ? { ok: true } : NOT_OPEN;
}

/**
 * 승인: 초안을 그 학생 숙제로 낸다 (한 트랜잭션. 두 번 눌러도 숙제는 하나만 생긴다).
 * AI가 만든 문제 중 확인하지 않은 것이 있으면 내지 않는다.
 */
export async function approveDraft(draftId: string): Promise<{ ok: true; hwId: string } | Fail> {
  return db().begin(async (tx) => {
    const [d] = await tx`
      select d.*, d.due_date::text as due, s.class_id, s.name from hw_drafts d join students s on s.student_id = d.student_id
      where d.draft_id = ${draftId} and d.status = 'draft' for update of d`;
    if (!d) return NOT_OPEN;
    const items = await tx`
      select dp.problem_id, dp.made_by_ai, p.verified from hw_draft_problems dp join problems p on p.id = dp.problem_id
      where dp.draft_id = ${draftId} order by dp.position`;
    if (!items.length) return { ok: false as const, error: "초안에 문제가 없어요. 'AI로 채우기'로 채우거나 반려해 주세요." };
    const unchecked = items.filter((i) => i.made_by_ai && !i.verified).length;
    if (unchecked) return { ok: false as const, error: `AI가 새로 만든 문제 ${unchecked}개를 아직 확인하지 않았어요. 그림과 정답을 보고 '확인함'을 누르거나 빼 주세요.` };
    const r = await insertHomework(tx, {
      title: `${d.title || "숙제"} · ${d.name || d.student_id}`,
      dueDate: d.due ?? "",
      classId: d.class_id,
      memo: d.memo,
      studentIds: [d.student_id],
      problemIds: items.map((i) => i.problem_id as string),
    });
    if (!r.ok) return r;
    await tx`update hw_drafts set status = 'approved', hw_id = ${r.hwId}, decided_at = now() where draft_id = ${draftId}`;
    return { ok: true as const, hwId: r.hwId };
  });
}

export async function rejectDraft(draftId: string): Promise<{ ok: true } | Fail> {
  const r = await db()`update hw_drafts set status = 'rejected', decided_at = now() where draft_id = ${draftId} and status = 'draft'`;
  return r.count ? { ok: true } : NOT_OPEN;
}

/** 반려한 초안을 다시 검토 중으로 (그 학생의 검토 중인 초안이 없을 때만) */
export async function reopenDraft(draftId: string): Promise<{ ok: true } | Fail> {
  const r = await db()`
    update hw_drafts d set status = 'draft', decided_at = null
    where d.draft_id = ${draftId} and d.status = 'rejected'
      and not exists (select 1 from hw_drafts o where o.student_id = d.student_id and o.status = 'draft')`;
  return r.count ? { ok: true } : { ok: false, error: "이 학생의 검토 중인 초안이 이미 있어요." };
}

export type FillResult = { ok: true; made: number; failed: number; left: number } | Fail;

/**
 * 은행이 모자란 유형을 AI 유사문제로 채운다 (한 번에 FILL_PER_CALL 문제까지).
 * 학생이 틀린 문제를 바탕으로 만들고, 은행에 있는 같은 유형 문제와 같은 문제는 버린다.
 * 만든 문제는 은행에 '검수 안 함'으로 저장하고 초안 끝에 붙인다.
 */
export async function fillShort(draftId: string): Promise<FillResult> {
  const sql = db();
  const [d] = await sql`select short from hw_drafts where draft_id = ${draftId} and status = 'draft'`;
  if (!d) return NOT_OPEN;
  const short: DraftShort[] = (Array.isArray(d.short) ? d.short : []).filter((s: DraftShort) => s.need > 0);
  if (!short.length) return { ok: true, made: 0, failed: 0, left: 0 };

  // 유형마다 돌아가며 이번에 만들 수
  const plan = short.map(() => 0);
  for (let left = FILL_PER_CALL, round = 0; left > 0 && round < FILL_PER_CALL; round++)
    short.forEach((s, i) => {
      if (left > 0 && plan[i] < s.need) {
        plan[i]++;
        left--;
      }
    });

  type Job = { i: number; seed: Seed; bank: { question: string; answer: string }[] };
  const jobs: Job[] = [];
  for (const [i, s] of short.entries()) {
    if (!plan[i]) continue;
    const seed = await seedOf(s);
    if (!seed) continue;
    const bank = await sameTypeProblems(seed, 60);
    for (let k = 0; k < plan[i]; k++) jobs.push({ i, seed, bank });
  }
  if (!jobs.length) return { ok: false, error: "바탕으로 쓸 같은 유형 문제가 은행에 없어서 만들 수 없어요." };

  const settled = await Promise.allSettled(
    jobs.map((j, n) =>
      generateOne(
        1,
        figuresToBlocks(j.seed.question),
        false,
        undefined,
        { index: n + 1, total: jobs.length, bank: j.bank.slice(0, 8).map((p) => brief(p.question)) },
        { grade: j.seed.grade, unit: j.seed.unit, type: j.seed.type },
      ),
    ),
  );
  // 은행·이번에 만든 문제와 같은 문제는 버린다
  const kept: { job: Job; g: Generated }[] = [];
  const seen = [...new Map(jobs.map((j) => [j.seed.id, j.bank])).values()].flat().map((p) => fingerprint(p.question, p.answer));
  let failed = 0;
  settled.forEach((r, n) => {
    if (r.status === "rejected") {
      failed++;
      return;
    }
    const fp = fingerprint(r.value.question, r.value.answer);
    if (!r.value.answer.trim() || seen.some((x) => sameProblem(fp, x))) {
      failed++;
      return;
    }
    seen.push(fp);
    kept.push({ job: jobs[n], g: r.value });
  });
  const firstErr = settled.find((r) => r.status === "rejected");
  if (firstErr && firstErr.status === "rejected") await reportError("숙제 초안 AI로 채우기", firstErr.reason);

  const res = await sql.begin(async (tx) => {
    const [open] = await tx`select short from hw_drafts where draft_id = ${draftId} and status = 'draft' for update`;
    if (!open) return NOT_OPEN;
    const [{ pos }] = await tx`select coalesce(max(position), 0)::int as pos from hw_draft_problems where draft_id = ${draftId}`;
    const now: DraftShort[] = Array.isArray(open.short) ? open.short : [];
    let position = pos as number;
    // 유형(바탕 문제)마다 문제 묶음 하나
    const bySeed = new Map<string, { job: Job; g: Generated }[]>();
    for (const k of kept) bySeed.set(k.job.seed.id, [...(bySeed.get(k.job.seed.id) ?? []), k]);
    for (const list of bySeed.values()) {
      const seed = list[0].job.seed;
      const setId = newSetId();
      await tx`
        insert into problem_sets (id, made_on, grade, unit, subtype, image_ref, memo)
        values (${setId}, (now() at time zone 'Asia/Seoul')::date, ${seed.grade}, ${seed.unit}, ${seed.frame}, '', '숙제 초안을 채우려고 AI로 만듦')`;
      for (const [k, { g }] of list.entries()) {
        const id = `${setId}_${k + 1}`;
        await tx`
          insert into problems (id, set_id, position, taxonomy_id, grade, unit, type, frame, difficulty, source, origin_id,
                                question, answer, solution, image_ref, verified, memo, model)
          values (${id}, ${setId}, 1, ${seed.taxonomyId}, ${seed.grade}, ${seed.unit}, ${seed.type}, ${seed.frame}, ${seed.difficulty},
                  'AI 기본', ${seed.id}, ${g.question}, ${g.answer}, ${g.solution}, '', false, '', ${process.env.GEMINI_MODEL || "gemini-flash-latest"})`;
        await tx`insert into hw_draft_problems (draft_id, problem_id, position, made_by_ai) values (${draftId}, ${id}, ${++position}, true)`;
      }
      const key = list[0].job.i;
      const s = short[key];
      const t = now.find((x) => x.grade === s.grade && x.unit === s.unit && x.type === s.type);
      if (t) t.need = Math.max(0, t.need - list.length);
    }
    const next = now.filter((x) => x.need > 0);
    await tx`update hw_drafts set short = ${tx.json(next)} where draft_id = ${draftId}`;
    return { ok: true as const, made: kept.length, failed, left: next.reduce((a, x) => a + x.need, 0) };
  });
  return res;
}

type Seed = { id: string; question: string; grade: string; unit: string; type: string; frame: string; difficulty: string; taxonomyId: number | null };

/** AI로 만들 때 바탕 문제: 학생이 틀린 문제, 없으면 그 유형의 검수한(없으면 최근) 문제 */
async function seedOf(s: DraftShort): Promise<Seed | null> {
  const sql = db();
  const [r] = s.seed
    ? await sql`select id, question, grade, unit, type, frame, difficulty, taxonomy_id from problems where id = ${s.seed}`
    : await sql`
        select id, question, grade, unit, type, frame, difficulty, taxonomy_id from problems
        where grade = ${s.grade} and unit = ${s.unit} and type = ${s.type}
        order by verified desc, created_at desc limit 1`;
  if (!r) return s.seed ? seedOf({ ...s, seed: null }) : null;
  return {
    id: r.id,
    question: r.question,
    grade: r.grade,
    unit: r.unit,
    type: r.type,
    frame: r.frame,
    difficulty: r.difficulty || "중",
    taxonomyId: r.taxonomy_id === null ? null : Number(r.taxonomy_id),
  };
}
