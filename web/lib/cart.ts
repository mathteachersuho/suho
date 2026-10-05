"use client";

import { useSyncExternalStore } from "react";

/*
 * 학습지에 넣으려고 고른 문제 목록. 브라우저(localStorage)에 저장해서
 * 다른 쪽으로 넘어가거나 새로고침해도 유지된다. 서버에는 아무것도 저장하지 않는다.
 */
const KEY = "sheet-cart-v1";
const EVENT = "sheet-cart-change";
const EMPTY: string[] = [];
let cache: { raw: string | null; ids: string[] } = { raw: null, ids: EMPTY };

function read(): string[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return cache.ids;
  }
  if (raw === cache.raw) return cache.ids;
  let ids: string[] = EMPTY;
  try {
    const v = JSON.parse(raw || "[]");
    if (Array.isArray(v)) ids = v.filter((x) => typeof x === "string");
  } catch {}
  cache = { raw, ids };
  return ids;
}

function write(ids: string[]) {
  const raw = JSON.stringify(ids);
  cache = { raw, ids };
  try {
    localStorage.setItem(KEY, raw);
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useCart() {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export const cart = {
  toggle(id: string) {
    const ids = read();
    write(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  },
  addMany(add: string[]) {
    const ids = read();
    write([...ids, ...add.filter((x) => !ids.includes(x))]);
  },
  remove(id: string) {
    write(read().filter((x) => x !== id));
  },
  move(id: string, dir: -1 | 1) {
    const ids = [...read()];
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    write(ids);
  },
  clear() {
    write([]);
  },
};
