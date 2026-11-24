"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FileText, LogOut, ShieldCheck, Upload, Sparkles } from "lucide-react";

type Scan = {
  id: string;
  created_at: string;
  file_name: string | null;
  risk_score: number;
  summary: string;
};

type AnalysisResult = {
  risk_score: number;
  summary: string;
  red_flags: string[];
  advice: string[];
};

type ApiError = Record<string, unknown> & {
  error?: string;
  details?: string;
};

type AuthUser = {
  id: string;
  email?: string;
};

function isApiError(value: unknown): value is ApiError {
  return typeof value === "object" && value !== null;
}

export default function Dashboard() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [scans, setScans] = useState<Scan[]>([]);
  const [text, setText] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string>("");
  const router = useRouter();
  const supabase = createClient();

  async function load(): Promise<void> {
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) {
      router.replace("/login");
      return;
    }
    setUser({ id: currentUser.id, email: currentUser.email ?? undefined });

    const { data, error: scansError } = await supabase
      .from("scans")
      .select("id,created_at,file_name,risk_score,summary")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false })
      .limit(10);

    if (scansError) {
      setError(scansError.message);
      return;
    }
    setScans((data ?? []) as Scan[]);
  }

  useEffect(() => {
    void load();
  }, []);

  async function signout(): Promise<void> {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  async function analyze(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setResult(null);

    if (!text.trim() && !file) {
      setError("Paste text or choose a file first.");
      return;
    }

    setBusy(true);
    try {
      const formData = new FormData();
      formData.set("text", text);
      if (file) formData.set("file", file);

      const response = await fetch("/api/scan", { method: "POST", body: formData });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const apiError = isApiError(payload) ? payload : {};
        const errorText = typeof apiError.error === "string" ? apiError.error : "Analysis failed.";
        const detailText = typeof apiError.details === "string" ? apiError.details : "";
        setError(detailText && detailText !== errorText ? `${errorText} — ${detailText}` : errorText);
        return;
      }

      if (!isApiError(payload)
        || typeof payload.risk_score !== "number"
        || typeof payload.summary !== "string"
        || !Array.isArray(payload.red_flags)
        || !Array.isArray(payload.advice)) {
        setError("The server returned an unexpected analysis response.");
        return;
      }

      const analysis: AnalysisResult = {
        risk_score: payload.risk_score,
        summary: payload.summary,
        red_flags: payload.red_flags.filter((item): item is string => typeof item === "string"),
        advice: payload.advice.filter((item): item is string => typeof item === "string"),
      };
      setResult(analysis);
      setText("");
      setFile(null);
      await load();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2 font-bold"><ShieldCheck className="text-brand" /> FinePrint AI</div>
          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-slate-500 sm:inline">{user?.email}</span>
            <button onClick={signout} className="flex items-center gap-2 text-slate-600"><LogOut size={16} /> Sign out</button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-brand">YOUR WORKSPACE</p>
            <h1 className="mt-2 text-3xl font-extrabold">Document analysis</h1>
            <p className="mt-2 text-slate-500">Understand the risks before you sign.</p>
          </div>
        </div>

        <div className="mt-8 grid gap-7 lg:grid-cols-[1.2fr_.8fr]">
          <section className="rounded-3xl border bg-white p-6 shadow-soft">
            <h2 className="flex items-center gap-2 text-xl font-bold"><Sparkles className="text-brand" /> New analysis</h2>
            <form onSubmit={analyze} className="mt-5 space-y-4">
              <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Paste contract text here…" rows={8} className="w-full resize-y rounded-2xl border p-4 outline-brand" />
              <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed p-4 text-sm text-slate-600">
                <Upload className="text-brand" />
                <span>{file ? file.name : "Choose a PDF, image, or text file"}</span>
                <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt" className="hidden" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
              </label>
              {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
              <button disabled={busy} className="w-full rounded-xl bg-brand p-3 font-semibold text-white disabled:opacity-50">
                {busy ? "Analyzing document…" : "Analyze document"}
              </button>
            </form>
          </section>

          <section className="rounded-3xl border bg-white p-6 shadow-soft">
            <h2 className="text-xl font-bold">Recent scans</h2>
            {scans.length === 0 ? (
              <p className="mt-5 text-sm text-slate-500">Your analyses will appear here.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {scans.map((scan) => (
                  <div key={scan.id} className="rounded-xl bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 font-semibold">
                        <FileText size={16} />
                        <span className="truncate text-sm">{scan.file_name || "Pasted text"}</span>
                      </div>
                      <span className="text-sm font-bold">{scan.risk_score}/100</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{new Date(scan.created_at).toLocaleString()}</p>
                    <p className="mt-2 line-clamp-2 text-sm text-slate-600">{scan.summary}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {result && (
          <section className="mt-7 rounded-3xl border bg-white p-6 shadow-soft">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl font-bold">Analysis results</h2>
              <span className="rounded-full bg-amber-100 px-4 py-2 font-bold">Risk score: {result.risk_score}/100</span>
            </div>
            <p className="mt-4 leading-7 text-slate-700">{result.summary}</p>
            <h3 className="mt-6 font-bold">Red flags</h3>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">
              {result.red_flags.map((item, index) => <li key={index}>{item}</li>)}
            </ul>
            <h3 className="mt-6 font-bold">Recommended actions</h3>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">
              {result.advice.map((item, index) => <li key={index}>{item}</li>)}
            </ul>
            <p className="mt-6 text-xs text-slate-500">AI-generated information; not legal advice.</p>
          </section>
        )}
      </div>
    </main>
  );
}