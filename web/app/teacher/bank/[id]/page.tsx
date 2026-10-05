import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProblemForEdit } from "@/lib/problems";
import { listTaxonomy } from "@/lib/taxonomy";
import EditProblem from "./EditProblem";

export const metadata: Metadata = { title: "문제 고치기 · 수학클래스룸" };

// AI로 고치기가 수십 초 걸릴 수 있어서 넉넉하게
export const maxDuration = 120;

export default async function EditProblemPage({ params, searchParams }: PageProps<"/teacher/bank/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const [p, taxonomy] = await Promise.all([getProblemForEdit(decodeURIComponent(id).slice(0, 80)), listTaxonomy()]);
  if (!p) notFound();
  // 돌아갈 곳: 고치기 전에 보던 문제 은행 쪽 (필터·쪽 번호 그대로). 다른 주소는 받지 않는다.
  const back = typeof sp.back === "string" && /^\/teacher\/bank(?:[?#]|$)/.test(sp.back) ? sp.back : "/teacher/bank";
  return (
    <EditProblem
      id={p.id}
      back={back}
      homework={p.homework}
      taxonomy={taxonomy}
      initial={{
        question: p.question,
        answer: p.answer,
        solution: p.solution,
        difficulty: p.difficulty,
        verified: p.verified,
        cls: { grade: p.grade, unit: p.unit, type: p.type, frame: p.frame, description: p.description },
      }}
    />
  );
}
