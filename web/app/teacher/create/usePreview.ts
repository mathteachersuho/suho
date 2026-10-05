"use client";

import { useEffect, useRef, useState } from "react";
import { previewAction } from "./actions";

/** 글자를 고치면 잠깐 뒤 서버에서 문제 은행과 같은 모양(수식, 표, 그림)으로 그려 온다 */
export function usePreview(texts: string[], delay = 350) {
  const [html, setHtml] = useState<string[]>([]);
  const key = JSON.stringify(texts);
  const seq = useRef(0);
  useEffect(() => {
    const my = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const out = await previewAction(JSON.parse(key));
        if (my === seq.current) setHtml(out);
      } catch {}
    }, delay);
    return () => clearTimeout(t);
  }, [key, delay]);
  return html;
}
