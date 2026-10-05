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

export type SavePayload = { groupId: string; semester: string; items: SaveItem[] };
export type SaveResult = { ok: true; ids: string[]; duplicate?: boolean } | { ok: false; error: string };
