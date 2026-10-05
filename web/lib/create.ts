import "server-only";
import { AiError, gemini, geminiJson } from "./ai/clients";
import { classifyStep1, classifyStep2, parseProblem, problemPrompt, type GenKind, type Generated } from "./ai/prompts";
import { DIFFICULTIES } from "./difficulty";
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

export async function generateOne(kind: GenKind, text: string, detailed: boolean, imageB64?: string): Promise<Generated> {
  const out = parseProblem(await gemini(problemPrompt(kind, text, detailed), kind === 0 ? imageB64 : undefined));
  if (!out.question.trim()) throw new AiError("빈 문제가 만들어졌어요. 다시 만들어 주세요.");
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

/** 원본 다시 쓰기, 유사문제 1·2번, 분류를 한꺼번에 (동시에) 만든다. 하나가 실패해도 나머지는 돌려준다. */
export async function generateAll(text: string, detailed: boolean, imageB64: string | undefined, taxonomy: TaxRow[]) {
  const [p0, p1, p2, cls] = await Promise.allSettled([
    generateOne(0, text, detailed, imageB64),
    generateOne(1, text, detailed),
    generateOne(2, text, detailed),
    classify(text, taxonomy),
  ]);
  const card = (r: PromiseSettledResult<Generated>): CardResult =>
    r.status === "fulfilled" ? { ok: true, data: r.value } : { ok: false, error: msg(r.reason) };
  if (p0.status === "rejected") console.error("원본 다시 쓰기 실패", p0.reason);
  return {
    // 원본 다시 쓰기가 실패하면 인식한 글자를 그대로 원본으로 쓴다 (Streamlit 과 같게)
    original: p0.status === "fulfilled" ? p0.value : { question: text, answer: "", solution: "" },
    originalRebuilt: p0.status === "fulfilled",
    p1: card(p1),
    p2: card(p2),
    suggestion: cls.status === "fulfilled" ? cls.value : null,
  };
}
