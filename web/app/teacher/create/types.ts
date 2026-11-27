export type Source = "원본" | "AI 기본" | "AI 실력";

export type Classification = { grade: string; unit: string; type: string; frame: string; description: string };

export type SaveItem = {
  source: Source;
  question: string;
  answer: string;
  solution: string;
  difficulty: string;
  verified: boolean;
  cls: Classification;
};

/** 교재에서 고른 자리 (교재 화면에서 만들 때만). 저장할 때 함께 기억해 다음에 같은 쪽을 열면 보여 준다. */
export type BookCropInput = { bookId: string; page: number; x: number; y: number; w: number; h: number; text: string };

export type SavePayload = { groupId: string; semester: string; items: SaveItem[]; crop?: BookCropInput };
export type SaveResult = { ok: true; ids: string[]; duplicate?: boolean } | { ok: false; error: string };
