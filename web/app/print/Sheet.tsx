"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import { cart } from "@/lib/cart";
import { IconArrow, IconDown, IconPrinter, IconUp, IconX } from "@/components/Icons";

export type SheetItem = {
  id: string;
  tag: string;
  question: string;
  answer: string;
  solution: string;
};

const PER_PAGE = [1, 2, 4, 5, 6] as const;

/** 문제 아래 풀이 공간의 최소 높이(px). 남는 높이는 문제 사이에 고르게 나눠 준다. */
const WORK_PX: Record<number, number> = { 1: 120, 2: 80, 4: 40, 5: 24, 6: 24 };
/** 글자 크기는 학습지 전체에 하나만 쓴다. 쪽당 N문제가 안 들어가면 이 크기까지 함께 줄이고, 그래도 넘치면 다음 쪽으로 넘긴다. */
const MIN_SCALE = 0.85;

/** 한 쪽의 단 수와 단마다 넣을 최대 문제 수 (5문제는 왼쪽 3, 오른쪽 2) */
const colsOf = (per: number) => (per >= 4 ? [Math.ceil(per / 2), Math.floor(per / 2)] : [per]);

/** 쪽 → 단 → 문제 id. scale 은 모든 문제에 같이 쓰는 글자 크기 배율, solo 는 혼자서도 단을 넘는 문제만 따로 줄인 배율. */
export type Layout = {
  scale: number;
  pages: string[][][];
  solo: Record<string, number>;
};

function plainLayout(ids: string[], per: number): Layout {
  const caps = colsOf(per);
  const pages: string[][][] = [];
  for (let i = 0; i < ids.length; i += per) {
    const group = ids.slice(i, i + per);
    pages.push(
      caps.map((_, c) =>
        group.slice(
          caps.slice(0, c).reduce((a, n) => a + n, 0),
          caps.slice(0, c + 1).reduce((a, n) => a + n, 0),
        ),
      ),
    );
  }
  return { scale: 1, pages, solo: {} };
}

/**
 * 문제 높이(h, 글자 배율 1일 때)와 단 높이(room)로 쪽을 나눈다.
 * 문제는 자르지 않고, 단에 다 안 들어가면 다음 단·다음 쪽으로 넘긴다.
 */
function paginate(ids: string[], h: Record<string, number>, extra: number, room: number, per: number, scale: number): Layout {
  const caps = colsOf(per);
  const pages: string[][][] = [];
  const solo: Record<string, number> = {};
  let page: string[][] = caps.map(() => []);
  let col = 0;
  let used = 0;
  for (const id of ids) {
    let need = h[id] * scale + extra;
    while (page[col].length && (page[col].length >= caps[col] || used + need > room)) {
      col++;
      used = 0;
      if (col >= caps.length) {
        pages.push(page);
        page = caps.map(() => []);
        col = 0;
      }
    }
    if (need > room) {
      // 혼자서도 단보다 긴 문제는 그 문제만 더 줄인다
      solo[id] = Math.max(0.4, (room - extra) / h[id]);
      need = room;
    }
    page[col].push(id);
    used += need;
  }
  if (page.some((c) => c.length)) pages.push(page);
  return { scale, pages, solo };
}

/** 쪽당 N문제가 그대로 들어가는 가장 큰 글자 배율을 찾는다. MIN_SCALE 로도 안 되면 넘치는 문제를 다음 쪽으로 보낸다. */
function planLayout(root: HTMLElement | null, ids: string[], per: number): Layout | null {
  if (!root || !ids.length) return null;
  const colEl = root.querySelector<HTMLElement>(".sheet-col");
  if (!colEl) return null;
  const room = colEl.clientHeight;
  const h: Record<string, number> = {};
  let extra = 0;
  for (const item of root.querySelectorAll<HTMLElement>(".sheet-item")) {
    const fit = item.querySelector<HTMLElement>(".sheet-fit");
    const id = item.dataset.id;
    if (!fit || !id) continue;
    h[id] = fit.getBoundingClientRect().height;
    extra = item.offsetHeight - fit.offsetHeight; // 위아래 여백과 선
  }
  extra += WORK_PX[per] ?? 40;
  // 쪽당 N문제가 그대로 들어가면 그 배율로, 안 되면 쪽 수가 가장 적은 배율 중 가장 큰 것으로
  const want = Math.ceil(ids.length / per);
  let best: Layout | null = null;
  for (let scale = 1; scale >= MIN_SCALE - 1e-9; scale -= 0.025) {
    const next = paginate(ids, h, extra, room, per, Math.round(scale * 1000) / 1000);
    if (next.pages.length <= want && !Object.keys(next.solo).length) return next;
    const solo = (l: Layout) => Object.keys(l.solo).length;
    if (!best || next.pages.length < best.pages.length || (next.pages.length === best.pages.length && solo(next) < solo(best))) best = next;
  }
  return best;
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

  // 보이지 않는 곳에 문제를 한 번 그려 높이를 재고, 글자 크기와 쪽 나누기를 정한다.
  // 그림·글꼴이 늦게 불러와져도 다시 잰다.
  const measure = useRef<HTMLDivElement>(null);
  const ids = list.map((it) => it.id);
  const key = `${per}|${ids.join(",")}|${title}`;
  const [plan, setPlan] = useState<{ key: string; layout: Layout } | null>(null);
  const layout = plan?.key === key ? plan.layout : plainLayout(ids, per);
  useLayoutEffect(() => {
    let alive = true;
    const replan = () => {
      if (!alive) return;
      const next = planLayout(measure.current, key.split("|")[1].split(",").filter(Boolean), Number(key.split("|")[0]));
      if (next) setPlan((old) => (old?.key === key && JSON.stringify(old.layout) === JSON.stringify(next) ? old : { key, layout: next }));
    };
    replan();
    document.fonts?.ready.then(replan);
    window.addEventListener("load", replan);
    const imgs = [...(measure.current?.querySelectorAll("img") ?? [])];
    imgs.forEach((im) => im.addEventListener("load", replan));
    return () => {
      alive = false;
      window.removeEventListener("load", replan);
      imgs.forEach((im) => im.removeEventListener("load", replan));
    };
  }, [key]);

  const item = (it: SheetItem, zoom?: number) => {
    const no = order.indexOf(it.id) + 1;
    return (
      <div key={it.id} className="sheet-item" data-id={it.id}>
        {zoom !== undefined && (
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
        )}
        <div className="sheet-fit" style={zoom && zoom !== 1 ? { zoom } : undefined}>
          <p className="sheet-no">
            {no}
            {it.tag && <span>{it.tag}</span>}
          </p>
          <div className="problem-body" dangerouslySetInnerHTML={{ __html: it.question }} />
        </div>
        <div className="sheet-work" />
      </div>
    );
  };
  const head = (pi: number) => (
    <header className="sheet-head">
      <h1>{title}</h1>
      {pi === 0 ? <p>이름 ______________</p> : <p>{pi + 1}쪽</p>}
    </header>
  );
  const nCols = colsOf(per).length;

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
        {missing > 0 && <p className="mx-auto max-w-5xl px-4 pb-3 text-sm text-bad">지워졌거나 찾을 수 없는 문제 {missing}개는 빼고 만들었어요.</p>}
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
        <>
          <div className="sheet-wrap">
            {layout.pages.map((cols, pi) => (
              <section key={pi} className="sheet-page">
                {head(pi)}
                <div className={`sheet-cols cols-${nCols}`}>
                  {cols.map((col, ci) => (
                    <div key={ci} className="sheet-col">
                      {col.map((id) => byId.get(id) && item(byId.get(id)!, layout.solo[id] ?? layout.scale))}
                    </div>
                  ))}
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
          <div ref={measure} className="sheet-measure" aria-hidden>
            <section className="sheet-page">
              {head(0)}
              <div className={`sheet-cols cols-${nCols}`}>
                <div className="sheet-col">
                  <div className="sheet-measure-items">{list.map((it) => item(it))}</div>
                </div>
                {nCols > 1 && <div className="sheet-col" />}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
