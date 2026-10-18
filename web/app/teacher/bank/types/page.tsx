import Link from "next/link";
import { taxonomyUnits, unitTaxonomy } from "@/lib/taxonomyEdit";
import UnitPicker from "./UnitPicker";
import TypesEditor from "./TypesEditor";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined, max = 60) => (Array.isArray(v) ? v[0] : v || "").trim().slice(0, max);

export default async function TypesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const units = await taxonomyUnits();
  const grade = one(sp.grade);
  const unit = one(sp.unit);
  const found = units.some((u) => u.grade === grade && u.unit === unit);
  const groups = found ? await unitTaxonomy(grade, unit) : [];

  return (
    <div className="space-y-6 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Types</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">유형 정리</h1>
          <p className="mt-1 text-sm text-ink-soft">유형·세부 유형의 이름을 바꾸거나, 비슷한 세부 유형을 하나로 합쳐요.</p>
        </div>
        <Link href="/teacher/bank" className="btn-soft py-2">
          문제 은행으로
        </Link>
      </div>

      <UnitPicker units={units} grade={grade} unit={found ? unit : ""} />

      {!found ? (
        <div className="card py-10 text-center">
          <p className="font-semibold">학년과 단원을 골라 주세요</p>
          <p className="text-sm text-ink-soft">고른 단원의 유형과 세부 유형이 문제 수와 함께 나와요.</p>
        </div>
      ) : (
        <TypesEditor key={`${grade}\u0000${unit}`} grade={grade} unit={unit} groups={groups} />
      )}
    </div>
  );
}
