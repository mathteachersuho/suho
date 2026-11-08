/*
 * KaTeX 가 모르는 명령어를 아는 명령어로 바꿔 주는 매크로 (서버 그림, 문제 편집기 모두 같은 표를 쓴다).
 * 저장된 문제 글자는 그대로 두고 그릴 때만 바꾸므로, 이미 문제 은행에 있는 문제에도 바로 적용된다.
 */
export const KATEX_MACROS: Record<string, string> = {
  // 호 AB: LaTeX 의 \overparen, \wideparen(yhmath), \overarc, \arc 는 KaTeX 에 없다 → 둥근 호 모양 \overgroup
  "\\overparen": "\\overgroup{#1}",
  "\\wideparen": "\\overgroup{#1}",
  "\\overarc": "\\overgroup{#1}",
  "\\arc": "\\overgroup{#1}",
  // 그 밖에 OCR/AI 가 가끔 쓰는데 KaTeX 에 없는 것
  "\\overbar": "\\overline{#1}",
  "\\mbox": "\\text{#1}",
};
