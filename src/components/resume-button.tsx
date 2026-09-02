"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ResumeButton() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  return (
    <button
      className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        const response = await fetch("/api/automation/resume", { method: "POST" });
        setLoading(false);
        if (response.ok) router.refresh();
      }}
    >
      {loading ? "Reativando…" : "Já fiz login — reativar"}
    </button>
  );
}
