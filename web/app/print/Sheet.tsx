"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cart } from "@/lib/cart";
import { IconArrow, IconDown, IconPrinter, IconUp, IconX } from "@/components/Icons";

export type SheetItem = { id: string; tag: string; question: string; answer: string; solution: string };

const PER_PAGE = [1, 2, 4, 5, 6] as const;

/** 풀이 공간으로 남겨 둘 최소 높이 (쪽당 문제가 많을수록 작게) */
const WORK_PX: Record<number, number> = { 1: 120, 2: 90, 4: 60, 5: 24, 6: 24 };

/**
 * 문제 칸마다 문제(번호+지문)가 칸 높이를 넘으면 글자·그림을 같은 비율로 줄여 칸 안에 넣는다.
 * 쪽 높이는 A4로 고정이라, 이렇게 하면 '쪽당 N문제'가 언제나 A4 한 장에 들어간다.
 */
function fitItems(root: HTMLElement | null, per: number) {
  if (!root) return;
  for (const item of root.querySelectorAll<HTMLElement>(".sheet-item")) {
    const fit = item.querySelector<HTMLElement>(".sheet-fit");
    if (!fit) continue;
    fit.style.zoom = "1";
    const cs = getComputedStyle(item);
    const room = item.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - (WORK_PX[per] ?? 40);
    const need = fit.scrollHeight;
    fit.style.zoom = need > room && room > 0 ? String(Math.max(0.45, room / need)) : "1";
  }
}

function chunk<T>(xs: T[], n: number) {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** A4 학습지 미리보기 + 인쇄. 화면에서 고친 제목, 순서, 문제 수가 그대로 인쇄된다. */
export default function Sheet({ items, defaultTitle, missing }: { items: SheetItem[]; defaultTitle: string; missing: number }) {
  const [title, setTitle] = useState(defaultTitle);
  const [per, setPer] = useState<(typeof PER_PAGE)[number]>(2);
  const [withAnswers, setWithAnswers] = useState(true);
  const [order, setOrder] = useState(items.map((it) => it.id));
  const byId = new Map(items.map((it) => [it.id, it]));
  const list = order.map((id) => byId.get(id)!).filter(Boolean);

  const sync = (next: string[]) => {
    setOrder(next);
    const url = new URL(window.location.href);
    url.searchParams.set("ids", next.join(","));
    window.history.replaceState(null, "", url);
  };
  const remove = (id: string) => {
    cart.remove(id);
    sync(order.filter((x) => x !== id));
  };
  const move = (id: string, dir: -1 | 1) => {
    cart.move(id, dir);
    const next = [...order];
    const i = next.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    sync(next);
  };

  const pages = chunk(list, per);

  // 문제가 칸보다 길면 줄여 넣는다. 그림·글꼴이 늦게 불러와져도, 인쇄 직전에도 다시 맞춘다.
  const wrap = useRef<HTMLDivElement>(null);
  const key = `${per}|${order.join(",")}|${title}`;
  useLayoutEffect(() => fitItems(wrap.current, per), [key, per]);
  useEffect(() => {
    const again = () => fitItems(wrap.current, per);
    document.fonts?.ready.then(again);
    window.addEventListener("load", again);
    window.addEventListener("beforeprint", again);
    const imgs = [...(wrap.current?.querySelectorAll("img") ?? [])];
    imgs.forEach((im) => im.addEventListener("load", again));
    return () => {
      window.removeEventListener("load", again);
      window.removeEventListener("beforeprint", again);
      imgs.forEach((im) => im.removeEventListener("load", again));
    };
  }, [key, per]);

  return (
    <div className="min-h-full bg-surface-2 print:bg-white">
      <div className="sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur-md print:hidden">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <Link href="/teacher/bank" className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-ink-soft hover:bg-surface-2 hover:text-ink">
            <IconArrow className="h-4 w-4 rotate-180" />
            문제 은행
          </Link>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="field max-w-xs flex-1 py-2" aria-label="학습지 제목" />
          <div className="flex rounded-xl bg-surface-2 p-1" role="radiogroup" aria-label="한 쪽에 넣을 문제 수">
            {PER_PAGE.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={per === n}
                onClick={() => setPer(n)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${per === n ? "bg-surface text-ink shadow-sm" : "text-ink-soft"}`}
              >
                쪽당 {n}
              </button>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={withAnswers} onChange={(e) => setWithAnswers(e.target.checked)} className="h-4 w-4 accent-accent" />
            정답지 붙이기
          </label>
          <button type="button" onClick={() => window.print()} disabled={!list.length} className="btn-main ml-auto py-2">
            <IconPrinter />
            인쇄 / PDF 저장
          </button>
        </div>
        {missing > 0 && (
          <p className="mx-auto max-w-5xl px-4 pb-3 text-sm text-bad">지워졌거나 찾을 수 없는 문제 {missing}개는 빼고 만들었어요.</p>
        )}
      </div>

      {list.length === 0 ? (
        <div className="mx-auto max-w-md px-4 py-20 text-center print:hidden">
          <p className="font-semibold">학습지에 넣은 문제가 없어요</p>
          <p className="mt-1 text-sm text-ink-soft">문제 은행에서 문제를 담아 오세요.</p>
          <Link href="/teacher/bank" className="btn-main mt-4">
            문제 은행으로
          </Link>
        </div>
      ) : (
        <div className="sheet-wrap" ref={wrap}>
          {pages.map((group, pi) => (
            <section key={pi} className="sheet-page">
              <header className="sheet-head">
                <h1>{title}</h1>
                {pi === 0 ? <p>이름 ______________</p> : <p>{pi + 1}쪽</p>}
              </header>
              <div className={`sheet-grid per-${per}`}>
                {group.map((it) => {
                  const no = order.indexOf(it.id) + 1;
                  return (
                    <div key={it.id} className="sheet-item">
                      <div className="sheet-tools print:hidden">
                        <button type="button" onClick={() => move(it.id, -1)} disabled={no === 1} aria-label="앞으로">
                          <IconUp />
                        </button>
                        <button type="button" onClick={() => move(it.id, 1)} disabled={no === list.length} aria-label="뒤로">
                          <IconDown />
                        </button>
                        <button type="button" onClick={() => remove(it.id)} aria-label="빼기">
                          <IconX />
                        </button>
                      </div>
                      <div className="sheet-fit">
                        <p className="sheet-no">
                          {no}
                          {it.tag && <span>{it.tag}</span>}
                        </p>
                        <div className="problem-body" dangerouslySetInnerHTML={{ __html: it.question }} />
                      </div>
                      <div className="sheet-work" />
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          {withAnswers && (
            <section className="sheet-page sheet-answers">
              <header className="sheet-head">
                <h1>정답과 풀이</h1>
                <p>{title}</p>
              </header>
              <ol>
                {list.map((it, i) => (
                  <li key={it.id}>
                    <p>
                      <b>{i + 1}.</b> <span className="problem-body" dangerouslySetInnerHTML={{ __html: it.answer || "-" }} />
                    </p>
                    {it.solution && <div className="problem-body sol" dangerouslySetInnerHTML={{ __html: it.solution }} />}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
