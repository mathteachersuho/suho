import TopBar from "@/components/TopBar";
import { IconBook, IconChart, IconClipboard, IconUsers } from "@/components/Icons";
import { requireTeacher } from "@/lib/session";

export default async function TeacherLayout({ children }: LayoutProps<"/teacher">) {
  await requireTeacher();
  return (
    <>
      <TopBar
        who="선생님"
        items={[
          { label: "학생 관리", icon: <IconUsers />, href: "/teacher", active: true },
          { label: "문제 은행", icon: <IconBook /> },
          { label: "숙제", icon: <IconClipboard /> },
          { label: "리포트", icon: <IconChart /> },
        ]}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </>
  );
}
