import { redirect } from "next/navigation";

/** 약한 유형 숙제는 숙제 내기 화면으로 합쳐졌다. 예전 주소로 들어오면 옮겨 준다. */
export default async function WeakHomeworkPage({ searchParams }: PageProps<"/teacher/homework/weak">) {
  const sp = await searchParams;
  const q = new URLSearchParams({ mode: "weak" });
  if (typeof sp.s === "string") q.set("s", sp.s);
  if (sp.due === "1") q.set("due", "1");
  redirect(`/teacher/homework/new?${q}`);
}
