import { redirect } from "next/navigation";
import TopBar from "@/components/TopBar";
import { IconHome, IconKey, IconNote, IconClipboard, IconStar } from "@/components/Icons";
import { requireStudent } from "@/lib/session";
import { getStudent } from "@/lib/students";

export default async function StudentLayout({ children }: LayoutProps<"/student">) {
  const s = await requireStudent();
  const me = await getStudent(s.studentId);
  if (!me) redirect("/logout"); // 선생님이 지운 학생
  return (
    <>
      <TopBar
        who={me.name || me.studentId}
        items={[
          { label: "홈", icon: <IconHome />, href: "/student" },
          { label: "숙제", icon: <IconClipboard />, href: "/student/homework" },
          { label: "오답노트", icon: <IconNote /> },
          { label: "중요 문제", icon: <IconStar /> },
          { label: "비밀번호", icon: <IconKey />, href: "/student/password" },
        ]}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </>
  );
}
