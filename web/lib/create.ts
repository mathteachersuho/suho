import "server-only";
import { AiError, gemini, geminiJson } from "./ai/clients";
import { classifyStep1, classifyStep2, editPrompt, parseProblem, problemPrompt, type EditTarget, type GenKind, type Generated, type Variation } from "./ai/prompts";
import { DIFFICULTIES } from "./difficulty";
import { figuresToBlocks, renderFigureBlocks } from "./figure";
import { brief, fingerprint, sameProblem, type Fingerprint } from "./similar";
import { sameTypeProblems } from "./problems";
import { reportError } from "./reportError";
import type { TaxRow } from "./taxonomy";

export const SEMESTERS = ["1학기", "2학기", "공통"] as const;

export type Suggestion = {
  grade: string;
  unit: string;
  type: string;
  frame: string;
  description: string;
  semester: string;
  difficulty: string;
  isNewFrame: boolean;
};

export type CardResult = { ok: true; data: Generated } | { ok: false; error: string };

/** AI가 쓴 <좌표그림> 블록을 정확한 SVG로 바꾼다 */
const drawFigures = (g: Generated): Generated => ({ question: renderFigureBlocks(g.question), answer: g.answer, solution: renderFigureBlocks(g.solution) });

export async function generateOne(kind: GenKind, text: string, detailed: boolean, imageB64?: string, v: Variation = {}): Promise<Generated> {
  const out = drawFigures(parseProblem(await gemini(problemPrompt(kind, text, detailed, v), kind === 0 ? imageB64 : undefined)));
  if (!out.question.trim()) throw new AiError("빈 문제가 만들어졌어요. 다시 만들어 주세요.");
  return out;
}

/** 말로 적은 요청대로 문제 고치기 */
export async function editOne(current: Generated, instruction: string, imageB64?: string, target: EditTarget = "problem"): Promise<Generated> {
  const img = target === "problem" ? imageB64 : undefined;
  // 앱이 그린 좌표 그림은 설정(<좌표그림>)으로 바꿔 보내서 AI가 좌표·식만 고치게 한다
  const asBlocks = { question: figuresToBlocks(current.question), answer: current.answer, solution: figuresToBlocks(current.solution) };
  const out = drawFigures(parseProblem(await gemini(editPrompt(asBlocks, instruction, !!img, target), img)));
  // 풀이만 고칠 때는 AI가 문제를 건드렸더라도 원래 문제를 그대로 둔다
  if (target === "solution") {
    if (!out.solution.trim() && !out.answer.trim()) throw new AiError("고친 풀이가 비어 있어요. 요청을 조금 바꿔 다시 해 보세요.");
    return { question: current.question, answer: out.answer || current.answer, solution: out.solution || current.solution };
  }
  if (!out.question.trim()) throw new AiError("고친 문제가 비어 있어요. 요청을 조금 바꿔 다시 해 보세요.");
  return out;
}

/** app.py classify_frame 과 같은 두 단계 분류 */
export async function classify(text: string, taxonomy: TaxRow[]): Promise<Suggestion> {
  const types: [string, string, string][] = [];
  for (const t of taxonomy) if (!types.some((x) => x[0] === t.grade && x[1] === t.unit && x[2] === t.type)) types.push([t.grade, t.unit, t.type]);
  const s1 = await geminiJson(classifyStep1(text, types));
  const pick = Number.parseInt(String(s1.pick ?? -1), 10);
  const [grade, unit, type] =
    pick >= 0 && pick < types.length ? types[pick] : (["grade", "unit", "type"].map((k) => String(s1[k] ?? "").trim()) as [string, string, string]);
  const frames = taxonomy.filter((t) => t.grade === grade && t.unit === unit && t.type === type);
  const s2 = await geminiJson(classifyStep2(text, [grade, unit, type], frames));
  const fpick = Number.parseInt(String(s2.pick ?? -1), 10);
  const known = fpick >= 0 && fpick < frames.length ? frames[fpick] : null;
  const difficulty = String(s2.difficulty ?? "중").trim();
  const semester = String(s1.semester ?? "").trim();
  return {
    grade,
    unit,
    type,
    frame: known ? known.frame : String(s2.frame ?? "").trim(),
    description: known ? known.description : String(s2.description ?? "").trim(),
    semester: (SEMESTERS as readonly string[]).includes(semester) ? semester : "",
    difficulty: (DIFFICULTIES as readonly string[]).includes(difficulty) ? difficulty : "중",
    isNewFrame: !known,
  };
}

const msg = (e: unknown) => (e instanceof AiError ? e.message : "만들지 못했어요. 다시 눌러 주세요.");

/** 한 번에 만들 수 있는 유사문제 수 (종류마다) */
export const MAX_PER_KIND = 10;
export type Counts = { basic: number; advanced: number };

/** 같은 문제 확인 뒤 다시 만들기는 이 시간 안에서만 (화면 기다림 상한 120초) */
const REDO_BEFORE_MS = 65_000;
const REDO_ROUNDS = 2;

/** AI에게 보여 줄 "은행에 이미 있는 같은 유형 문제" 수 (프롬프트가 너무 길어지지 않게) */
const BANK_IN_PROMPT = 8;

/** 원본 다시 쓰기·분류를 먼저 하고(동시에), 분류한 유형의 은행 문제를 찾은 뒤 기본 다지기 n개, 실력 키우기 m개를 동시에 만든다.
 *  은행에 있는 같은 유형 문제는 AI에게 겹치지 말라고 알려 주고, 다 만든 뒤 원본·은행·다른 문제와 같은 문제가 있으면 그 칸만 다시 만든다.
 *  하나가 실패해도 나머지는 돌려준다. */
export async function generateAll(text: string, detailed: boolean, imageB64: string | undefined, taxonomy: TaxRow[], counts: Counts = { basic: 7, advanced: 3 }) {
  const started = Date.now();
  const p0p = Promise.allSettled([generateOne(0, text, detailed, imageB64)]).then(([r]) => r);
  const cls = await classify(text, taxonomy).catch(() => null);
  const bank = cls
    ? await sameTypeProblems(cls).catch(async (e) => {
        await reportError("같은 유형 은행 문제 찾기", e);
        return [];
      })
    : [];
  const bankBrief = bank.slice(0, BANK_IN_PROMPT).map((p) => brief(p.question));
  const many = (kind: 1 | 2, n: number) =>
    Array.from({ length: n }, (_, i) => generateOne(kind, text, detailed, undefined, { index: i + 1, total: n, bank: bankBrief }));
  const [p0, basic, advanced] = await Promise.all([p0p, Promise.allSettled(many(1, counts.basic)), Promise.allSettled(many(2, counts.advanced))]);
  const card = (r: PromiseSettledResult<Generated>): CardResult =>
    r.status === "fulfilled" ? { ok: true, data: r.value } : { ok: false, error: msg(r.reason) };
  if (p0.status === "rejected") console.error("원본 다시 쓰기 실패", p0.reason);
  const original = p0.status === "fulfilled" ? p0.value : { question: text, answer: "", solution: "" };
  const cards = { 1: basic.map(card), 2: advanced.map(card) };
  await removeDuplicates(cards, [original, { question: text, answer: original.answer }, ...bank], bankBrief, text, detailed, counts, started);
  return {
    // 원본 다시 쓰기가 실패하면 인식한 글자를 그대로 원본으로 쓴다 (Streamlit 과 같게)
    original,
    originalRebuilt: p0.status === "fulfilled",
    basic: cards[1],
    advanced: cards[2],
    suggestion: cls,
    bankChecked: bank.length,
  };
}

/** 같은 문제를 찾아 그 칸만 다시 만든다 (cards 를 바로 고친다). 다시 만들어도 같으면 마지막 것을 그대로 둔다.
 *  base = 원본과 은행 문제 (비교만 하고 AI에게 다시 보여 주지는 않는다) */
async function removeDuplicates(
  cards: Record<1 | 2, CardResult[]>,
  base: { question: string; answer: string }[],
  bankBrief: string[],
  text: string,
  detailed: boolean,
  counts: Counts,
  started: number,
) {
  const kept: Fingerprint[] = base.map((p) => fingerprint(p.question, p.answer));
  const made: string[] = []; // 이번에 만든 문제 (다시 만들 때 AI에게 보여 준다)
  const isDup = (g: Generated) => {
    const fp = fingerprint(g.question, g.answer);
    return kept.some((k) => sameProblem(fp, k));
  };
  const keep = (g: Generated) => {
    kept.push(fingerprint(g.question, g.answer));
    made.push(brief(g.question));
  };
  let redo: { kind: 1 | 2; i: number }[] = [];
  for (const kind of [1, 2] as const)
    cards[kind].forEach((c, i) => {
      if (!c.ok) return;
      if (isDup(c.data)) redo.push({ kind, i });
      else keep(c.data);
    });
  for (let round = 0; round < REDO_ROUNDS && redo.length && Date.now() - started < REDO_BEFORE_MS; round++) {
    const avoid = made.slice(-12);
    const total = (kind: 1 | 2) => (kind === 1 ? counts.basic : counts.advanced);
    const again = await Promise.allSettled(
      redo.map(({ kind, i }) => generateOne(kind, text, detailed, undefined, { index: i + 1, total: total(kind), avoid, bank: bankBrief })),
    );
    const next: typeof redo = [];
    again.forEach((r, j) => {
      const { kind, i } = redo[j];
      if (r.status === "rejected") return; // 다시 만들기가 실패하면 처음 것을 둔다
      cards[kind][i] = { ok: true, data: r.value };
      if (isDup(r.value)) next.push(redo[j]);
      else keep(r.value);
    });
    redo = next;
  }
}
