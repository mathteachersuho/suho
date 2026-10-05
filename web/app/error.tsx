"use client";

import ErrorScreen from "@/components/ErrorScreen";

export default function RootError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="flex flex-1 items-center px-4 py-16">
      <ErrorScreen {...props} />
    </main>
  );
}
