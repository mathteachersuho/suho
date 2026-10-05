import type { Metadata } from "next";
import { getProblems } from "@/lib/problems";
import { renderProblemHtml } from "@/lib/mathText";
import { requireTeacher } from "@/lib/session";
import Sheet, { type SheetItem } from "./Sheet";

export const metadata: Metadata = { title: "학습지 · 수학클래스룸" };

const MAX = 60;

export default async function PrintPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireTeacher();
  const raw = (await searchParams).ids;
  const ids = [...new Set((Array.isArray(raw) ? raw.join(",") : raw || "").split(",").map((s) => s.trim()).filter(Boolean))].slice(0, MAX);
  const problems = await getProblems(ids);
  const items: SheetItem[] = problems.map((p) => ({
    id: p.id,
    tag: [p.type, p.frame, p.difficulty].filter(Boolean).join(" · "),
    question: renderProblemHtml(p.question),
    answer: renderProblemHtml(p.answer),
    solution: renderProblemHtml(p.solution),
  }));
  const today = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date());
  return <Sheet items={items} defaultTitle={`${today} 연습 문제`} missing={ids.length - problems.length} />;
}
