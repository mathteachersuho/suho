import TopBar from "@/components/TopBar";
import { IconBook, IconChart, IconClipboard, IconDownload, IconSparkle, IconUsers } from "@/components/Icons";
import DbUpdateNotice from "@/components/DbUpdateNotice";
import { backupDue } from "@/lib/backup";
import { missingSchema } from "@/lib/schemaCheck";
import { requireTeacher } from "@/lib/session";

export default async function TeacherLayout({ children }: LayoutProps<"/teacher">) {
  await requireTeacher();
  const [due, missing] = await Promise.all([backupDue().catch(() => false), missingSchema().catch(() => [] as string[])]);
  return (
    <>
      <TopBar
        who="선생님"
        items={[
          { label: "문제 만들기", icon: <IconSparkle />, href: "/teacher/create" },
          { label: "문제 은행", icon: <IconBook />, href: "/teacher/bank" },
          { label: "숙제", icon: <IconClipboard />, href: "/teacher/homework" },
          { label: "학생 관리", icon: <IconUsers />, href: "/teacher" },
          { label: "리포트", icon: <IconChart />, href: "/teacher/report" },
          { label: "백업", icon: <IconDownload />, href: "/teacher/backup", dot: due },
        ]}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        {missing.length > 0 && <DbUpdateNotice missing={missing} />}
        {children}
      </main>
    </>
  );
}
