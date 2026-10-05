"use client";

import { IconPrinter } from "@/components/Icons";

export default function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="btn-soft">
      <IconPrinter />
      인쇄 · PDF 저장
    </button>
  );
}
