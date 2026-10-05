"use client";

import ErrorScreen from "@/components/ErrorScreen";

export default function StudentError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorScreen {...props} home="/student" />;
}
