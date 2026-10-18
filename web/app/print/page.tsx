import type { Metadata } from "next";
import { getHomework } from "@/lib/homework";
import { getProblems } from "@/lib/problems";
import { renderProblemHtml } from "@/lib/mathText";
import { requireTeacher } from "@/lib/session";
import Sheet, { type SheetItem, type SheetSet } from "./Sheet";

export const metadata: Metadata = { title: "학습지 · 수학클래스룸" };

const MAX = 60;
const list = (raw: string | string[] | undefined) => [...new Set((Array.isArray(raw) ? raw.join(",") : raw || "").split(",").map((s) => s.trim()).filter(Boolean))];
const toItem = (p: { id: string; type: string; frame: string; difficulty: string; question: string; answer: string; solution: string }): SheetItem => ({
  id: p.id,
  tag: [p.type, p.frame, p.difficulty].filter(Boolean).join(" · "),
  question: renderProblemHtml(p.question),
  answer: renderProblemHtml(p.answer),
  solution: renderProblemHtml(p.solution),
});

/** 학습지: ?ids= 문제들로 한 장, 또는 ?hw= 숙제들(학생마다 따로 낸 숙제)로 학생 이름을 넣은 학습지를 한꺼번에 */
export default async function PrintPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireTeacher();
  const sp = await searchParams;
  const title = typeof sp.title === "string" ? sp.title.slice(0, 60) : "";
  const today = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date());

  const hwIds = list(sp.hw).slice(0, MAX);
  if (hwIds.length) {
    const hws = (await Promise.all(hwIds.map((id) => getHomework(id)))).filter((h) => !!h);
    const sets: SheetSet[] = hws.map((h) => ({
      key: h.hw.hwId,
      name: h.students.map((s) => s.name || s.studentId).join(", "),
      items: h.problems.map(toItem),
    }));
    // 숙제 이름 끝의 ' · 학생 이름'은 학습지 이름 칸에 따로 넣으니 제목에서 뺀다
    const first = hws[0];
    const base = first ? first.hw.title.replace(new RegExp(` · ${(sets[0].name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "") : "";
    return <Sheet sets={sets} defaultTitle={title || base || `${today} 숙제`} missing={0} back={{ href: "/teacher/homework", label: "숙제" }} />;
  }

  const ids = list(sp.ids).slice(0, MAX);
  const problems = await getProblems(ids);
  return <Sheet sets={[{ key: "one", name: "", items: problems.map(toItem) }]} defaultTitle={title || `${today} 연습 문제`} missing={ids.length - problems.length} />;
}
