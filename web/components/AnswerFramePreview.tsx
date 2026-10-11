"use client";

import { answerTemplate } from "@/lib/answerTemplate";
import TemplateInput from "./TemplateInput";

/** 선생님 화면: 지금 정답으로 학생에게 어떤 답 틀이 나오는지 미리 보여 준다 */
export default function AnswerFramePreview({ answer }: { answer: string }) {
  const tpl = answerTemplate(answer);
  return (
    <div className="mt-1.5 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-soft">
      <p>학생 답 틀 {tpl ? "미리 보기" : "없음: 학생은 글자로 답을 써요"} · 방정식·부등식은 x=3, 2&lt;x&lt;3처럼 문자를 넣어 적어 주세요.</p>
      {tpl && (
        <div className="mt-1 opacity-80" inert>
          <TemplateInput nodes={tpl} values={[]} onChange={() => {}} label="미리 보기" />
        </div>
      )}
    </div>
  );
}
