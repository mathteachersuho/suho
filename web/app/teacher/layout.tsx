import TopBar from "@/components/TopBar";
import { requireTeacher } from "@/lib/session";

export default async function TeacherLayout({ children }: LayoutProps<"/teacher">) {
  await requireTeacher();
  return (
    <>
      <TopBar
        who="선생님"
        items={[
          { label: "👥 학생 관리", href: "/teacher", active: true },
          { label: "📚 문제 은행" },
          { label: "📝 숙제" },
          { label: "📊 리포트" },
        ]}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </>
  );
}
