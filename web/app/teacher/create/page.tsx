import { aiConfigured } from "@/lib/ai/clients";
import { listTaxonomy, unitSemesters } from "@/lib/taxonomy";
import CreateFlow from "./CreateFlow";

// Gemini가 원본·유사문제를 만드는 데 수십 초 걸릴 수 있어서 넉넉하게
export const maxDuration = 120;

export default async function CreatePage() {
  const [taxonomy, semesters] = await Promise.all([listTaxonomy(), unitSemesters()]);
  const cfg = aiConfigured();
  return (
    <div className="space-y-6 pb-16">
      <div>
        <p className="eyebrow">Create</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">문제 만들기</h1>
        <p className="mt-1 text-sm text-ink-soft">사진을 올리면 원본을 깔끔하게 다시 쓰고, 정한 개수만큼 기본 다지기·실력 키우기 문제를 만들어 문제 은행에 저장해요.</p>
      </div>
      {!cfg.mathpix || !cfg.gemini ? (
        <div className="rounded-2xl border border-line bg-warn-soft p-5 text-sm">
          <p className="font-semibold">아직 Vercel에 키가 없어요</p>
          <p className="mt-1 text-ink-soft">
            Vercel 프로젝트 Settings → Environment Variables에{" "}
            {[!cfg.mathpix && "MATHPIX_APP_ID, MATHPIX_APP_KEY", !cfg.gemini && "GEMINI_API_KEY"].filter(Boolean).join(", ")}를 넣고 다시
            배포해 주세요. 값은 Streamlit Secrets에 있는 것과 같아요.
          </p>
        </div>
      ) : null}
      <CreateFlow taxonomy={taxonomy} semesters={semesters} />
    </div>
  );
}
