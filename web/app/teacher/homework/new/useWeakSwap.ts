"use client";

import { useRef, useState } from "react";
import { weakSwapAction } from "../actions";

type Item = { id: string; tag: string; difficulty: string; html: string };

/**
 * 약한 유형 문제 새로고침(↻): 한 학생의 문제 하나를 같은 유형의 다른 문제로 바꾼다.
 * 바꿔 뺀 문제는 학생마다 기억해 두고 되도록 다시 고르지 않는다. 한 번에 한 문제씩만 바꾼다.
 */
export function useWeakSwap(verifiedOnly = false) {
  const [working, setWorking] = useState<string | null>(null); // "학생/문제"
  const [note, setNote] = useState<{ key: string; text: string } | null>(null);
  const skipped = useRef<Record<string, string[]>>({});

  /** chosen: 그 학생이 지금 받는 문제 전부, apply: 바꾼 문제를 화면에 넣는다 */
  const swap = async (studentId: string, problemId: string, chosen: string[], apply: (item: Item) => void) => {
    const key = `${studentId}/${problemId}`;
    setWorking(key);
    setNote(null);
    try {
      const r = await weakSwapAction(studentId, problemId, chosen, skipped.current[studentId] ?? [], verifiedOnly);
      if ("error" in r) return setNote({ key, text: r.error });
      skipped.current[studentId] = [...(skipped.current[studentId] ?? []).filter((x) => x !== r.item.id), problemId].slice(-200);
      apply(r.item);
      if (r.note) setNote({ key: `${studentId}/${r.item.id}`, text: r.note });
    } catch {
      setNote({ key, text: "문제를 바꾸지 못했어요. 잠시 뒤 다시 해 주세요." });
    } finally {
      setWorking(null);
    }
  };
  const noteOf = (studentId: string, problemId: string) => (note?.key === `${studentId}/${problemId}` ? note.text : "");
  const spinning = (studentId: string, problemId: string) => working === `${studentId}/${problemId}`;
  return { swap, noteOf, spinning, busy: working !== null };
}
