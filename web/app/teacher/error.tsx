"use client";

import ErrorScreen from "@/components/ErrorScreen";

export default function TeacherError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorScreen {...props} home="/teacher" />;
}
