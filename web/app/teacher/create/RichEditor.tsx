"use client";

import katex from "katex";
import { useEffect, useRef, useState } from "react";

/*
 * 글자는 화면에서 바로 고치고, 수식은 눌러서 수식 편집기(MathLive)로 고치는 편집 칸.
 * 저장 형식은 지금과 같은 글자($수식$, $$수식$$)라서 문제 은행·학습지와 그대로 맞는다.
 * 그림(SVG)이나 표는 망가지지 않게 한 덩어리로 보여 주고, 편집 칸에서는 고치지 않는다 (AI로 고치기나 코드로 고치기를 쓴다).
 */

type Seg = { kind: "text"; v: string } | { kind: "math"; v: string; display: boolean } | { kind: "raw"; v: string };

const RAW = /<svg[\s\S]*?<\/svg>|<table[\s\S]*?<\/table>|(?:^[ \t]*\|.*\|[ \t]*(?:\n|$))+/gm;
const MATH = /\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g;

function parse(src: string): Seg[] {
  const out: Seg[] = [];
  const pushText = (t: string) => {
    let last = 0;
    for (const m of t.matchAll(MATH)) {
      if (m.index! > last) out.push({ kind: "text", v: t.slice(last, m.index) });
      out.push(m[1] !== undefined ? { kind: "math", v: m[1].trim(), display: true } : { kind: "math", v: m[2].trim(), display: false });
      last = m.index! + m[0].length;
    }
    if (last < t.length) out.push({ kind: "text", v: t.slice(last) });
  };
  let last = 0;
  for (const m of src.matchAll(RAW)) {
    if (m.index! > last) pushText(src.slice(last, m.index));
    out.push({ kind: "raw", v: m[0].replace(/\n$/, "") });
    last = m.index! + m[0].length;
    if (m[0].endsWith("\n")) out.push({ kind: "text", v: "\n" });
  }
  if (last < src.length) pushText(src.slice(last));
  return out;
}

function renderTex(el: HTMLElement, tex: string, display: boolean) {
  el.dataset.tex = tex;
  el.dataset.display = display ? "1" : "0";
  if (!tex.trim()) {
    el.textContent = "수식";
    el.classList.add("re-math-empty");
    return;
  }
  el.classList.remove("re-math-empty");
  katex.render(tex, el, { throwOnError: false, displayMode: display, strict: "ignore", output: "html" });
}

function mathChip(tex: string, display: boolean) {
  const el = document.createElement("span");
  el.contentEditable = "false";
  el.className = display ? "re-math re-math-block" : "re-math";
  el.title = "눌러서 수식 고치기";
  renderTex(el, tex, display);
  return el;
}

function rawChip(raw: string) {
  const el = document.createElement("span");
  el.contentEditable = "false";
  el.className = "re-raw";
  el.dataset.raw = raw;
  el.textContent = raw.trimStart().startsWith("|") || raw.includes("<table") ? "표 (이 칸에서는 고칠 수 없어요)" : "그림 (AI로 고치기를 써 주세요)";
  return el;
}

function build(root: HTMLElement, src: string) {
  root.replaceChildren();
  for (const s of parse(src)) {
    if (s.kind === "math") root.append(mathChip(s.v, s.display));
    else if (s.kind === "raw") root.append(rawChip(s.v));
    else {
      s.v.split("\n").forEach((line, i) => {
        if (i) root.append(document.createElement("br"));
        if (line) root.append(document.createTextNode(line));
      });
    }
  }
}

function serialize(root: HTMLElement): string {
  let out = "";
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      out += (n.textContent || "").replace(/ /g, " ");
      return;
    }
    if (!(n instanceof HTMLElement)) return;
    if (n.dataset.tex !== undefined) {
      const t = n.dataset.tex.trim();
      if (t) out += n.dataset.display === "1" ? `$$${t}$$` : `$${t}$`;
      return;
    }
    if (n.dataset.raw !== undefined) {
      out += n.dataset.raw;
      return;
    }
    if (n.tagName === "BR") {
      out += "\n";
      return;
    }
    const block = n.tagName === "DIV" || n.tagName === "P";
    if (block && out && !out.endsWith("\n")) out += "\n";
    n.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  return out.replace(/\n+$/, "");
}

type MathFieldEl = HTMLElement & { value: string; focus: () => void };

export default function RichEditor({
  value,
  onChange,
  label,
  minRows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  minRows?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<string | null>(null); // 마지막으로 이 칸이 내보낸 값 (밖에서 바뀐 값만 다시 그린다)
  const [edit, setEdit] = useState<{ el: HTMLElement; tex: string } | null>(null);
  const [ready, setReady] = useState(false);
  const fieldBox = useRef<HTMLDivElement>(null);
  const field = useRef<MathFieldEl | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root || value === last.current) return;
    build(root, value);
    last.current = value;
  }, [value]);

  const emit = () => {
    const root = ref.current;
    if (!root) return;
    const v = serialize(root);
    last.current = v;
    onChange(v);
  };

  // 수식 편집기는 처음 쓸 때만 불러온다 (용량이 커서)
  useEffect(() => {
    if (!edit) return;
    let alive = true;
    (async () => {
      const ml = await import("mathlive");
      ml.MathfieldElement.fontsDirectory = null; // KaTeX 글꼴은 이미 화면에 있다
      ml.MathfieldElement.soundsDirectory = null;
      if (!alive || !fieldBox.current) return;
      const mf = new ml.MathfieldElement() as unknown as MathFieldEl;
      mf.value = edit.tex;
      mf.className = "re-field";
      fieldBox.current.replaceChildren(mf);
      field.current = mf;
      setReady(true);
      requestAnimationFrame(() => mf.focus());
    })();
    return () => {
      alive = false;
      field.current = null;
      setReady(false);
    };
  }, [edit]);

  const closeMath = (apply: "save" | "delete" | "cancel") => {
    if (!edit) return;
    if (apply === "save" && field.current) {
      renderTex(edit.el, field.current.value, edit.el.dataset.display === "1");
      if (!field.current.value.trim()) edit.el.remove();
    } else if (apply === "delete" || (apply === "cancel" && !edit.tex)) {
      edit.el.remove();
    }
    setEdit(null);
    emit();
  };

  const insertMath = () => {
    const root = ref.current;
    if (!root) return;
    const chip = mathChip("", false);
    const sel = window.getSelection();
    const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    if (range && root.contains(range.commonAncestorContainer)) {
      range.deleteContents();
      range.insertNode(chip);
    } else root.append(chip);
    setEdit({ el: chip, tex: "" });
  };

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-medium text-ink-soft">{label}</span>
        <button type="button" className="btn-soft ml-auto px-2 py-0.5 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={insertMath}>
          + 수식 넣기
        </button>
      </div>
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        contentEditable
        suppressContentEditableWarning
        className="field re-editor"
        style={{ minHeight: `${minRows * 1.7 + 1}rem` }}
        onInput={emit}
        onClick={(e) => {
          const chip = (e.target as HTMLElement).closest<HTMLElement>(".re-math");
          if (chip && ref.current?.contains(chip)) setEdit({ el: chip, tex: chip.dataset.tex || "" });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            document.execCommand("insertLineBreak");
          }
        }}
        onPaste={(e) => {
          e.preventDefault();
          document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
        }}
      />
      {edit && (
        <div className="mt-2 rounded-xl border border-line bg-surface p-3 shadow-sm">
          <p className="mb-2 text-xs text-ink-soft">수식 고치기 · 분수는 /, 제곱은 ^, 루트는 sqrt 를 치면 바로 바뀌어요</p>
          {!ready && <p className="text-sm text-ink-soft">수식 편집기를 여는 중…</p>}
          {/* 이 칸 안은 MathLive가 직접 채운다 (React가 건드리지 않게 비워 둔다) */}
          <div ref={fieldBox} />
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn-main px-3 py-1.5" onClick={() => closeMath("save")} disabled={!ready}>
              확인
            </button>
            <button type="button" className="btn-soft px-3 py-1.5" onClick={() => closeMath("cancel")}>
              취소
            </button>
            {edit.tex && (
              <button type="button" className="btn-soft ml-auto px-3 py-1.5 text-bad" onClick={() => closeMath("delete")}>
                수식 지우기
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
