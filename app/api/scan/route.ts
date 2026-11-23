import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const runtime = "nodejs";

type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  promptFeedback?: { blockReason?: string };
};

type AnalysisResult = {
  risk_score: number;
  summary: string;
  red_flags: string[];
  advice: string[];
};

function getRequiredEnv(name: "GEMINI_API_KEY" | "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  // Use literal property access so bundlers can statically identify each binding.
  const value =
    name === "GEMINI_API_KEY" ? process.env.GEMINI_API_KEY :
    name === "NEXT_PUBLIC_SUPABASE_URL" ? process.env.NEXT_PUBLIC_SUPABASE_URL :
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function createAdminClient() {
  return createAdmin(
    getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    for (let index = 0; index < chunk.length; index += 1) {
      binary += String.fromCharCode(chunk[index]);
    }
  }
  return btoa(binary);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) || "Unknown error";
  } catch {
    return "Unknown error";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseAnalysis(value: unknown): AnalysisResult {
  if (!isRecord(value)) throw new Error("Gemini response is not a JSON object.");
  const score = Number(value.risk_score);
  if (!Number.isFinite(score)) throw new Error("Gemini response is missing a valid risk_score.");
  return {
    risk_score: Math.max(0, Math.min(100, Math.round(score))),
    summary: typeof value.summary === "string" ? value.summary : "",
    red_flags: Array.isArray(value.red_flags) ? value.red_flags.filter((item): item is string => typeof item === "string") : [],
    advice: Array.isArray(value.advice) ? value.advice.filter((item): item is string => typeof item === "string") : [],
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const geminiApiKey = getRequiredEnv("GEMINI_API_KEY");
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) throw new Error(`Authentication failed: ${authError.message}`);
    if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

    const form = await request.formData();
    const text = String(form.get("text") ?? "").trim();
    const uploadedFile = form.get("file");
    const parts: GeminiPart[] = [];
    let fileName: string | null = null;

    if (uploadedFile instanceof File && uploadedFile.size > 0) {
      if (uploadedFile.size > 15 * 1024 * 1024) {
        return NextResponse.json({ error: "File must be smaller than 15 MB." }, { status: 400 });
      }
      const allowedTypes = ["application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain"];
      if (!allowedTypes.includes(uploadedFile.type)) {
        return NextResponse.json({ error: "Supported formats: PDF, PNG, JPG, WEBP, TXT." }, { status: 400 });
      }
      fileName = uploadedFile.name;
      if (uploadedFile.type === "text/plain") {
        parts.push({ text: await uploadedFile.text() });
      } else {
        const bytes = new Uint8Array(await uploadedFile.arrayBuffer());
        parts.push({
          inline_data: {
            mime_type: uploadedFile.type,
            data: bytesToBase64(bytes),
          },
        });
      }
    }

    if (text) parts.push({ text: `User-provided document text:\n${text}` });
    if (parts.length === 0) {
      return NextResponse.json({ error: "Add text or upload a document." }, { status: 400 });
    }

    const db = createAdminClient();
    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("credits")
      .eq("id", user.id)
      .single();

    if (profileError) throw new Error(`Supabase profile lookup failed: ${profileError.message}`);
    if (!profile || typeof profile.credits !== "number" || profile.credits < 1) {
      return NextResponse.json({ error: "You have no credits remaining." }, { status: 402 });
    }

    const prompt = "Analyze this contract or document for a non-lawyer. Return ONLY valid JSON with keys: risk_score (integer 0-100), summary (plain language), red_flags (array of concise strings), advice (array of practical questions/actions). Score higher means greater risk. Identify uncertainty and do not invent clauses. This is informational, not legal advice.";
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }, ...parts] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
        }),
      }
    );

    if (!geminiResponse.ok) {
      const details = await geminiResponse.text();
      console.error("Gemini API error:", geminiResponse.status, details);
      return NextResponse.json({
        error: "Gemini API request failed.",
        details: `HTTP ${geminiResponse.status}: ${details}`,
      }, { status: 502 });
    }

    const geminiPayload: GeminiResponse = await geminiResponse.json();
    const rawText = geminiPayload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      throw new Error(`Gemini returned an empty response: ${geminiPayload.promptFeedback?.blockReason ?? "No text returned"}`);
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(rawText);
    } catch {
      throw new Error("Gemini returned invalid JSON.");
    }
    const analysis = parseAnalysis(decoded);

    const { data: updated, error: creditError } = await db
      .from("profiles")
      .update({ credits: profile.credits - 1 })
      .eq("id", user.id)
      .eq("credits", profile.credits)
      .select("credits")
      .single();

    if (creditError || !updated) {
      console.error("Supabase credit update error:", creditError);
      return NextResponse.json({
        error: "Could not update credits.",
        details: creditError?.message ?? "Credit balance changed; please try again.",
      }, { status: 409 });
    }

    const { error: saveError } = await db.from("scans").insert({
      user_id: user.id,
      file_name: fileName,
      risk_score: analysis.risk_score,
      summary: analysis.summary,
      red_flags: analysis.red_flags,
      advice: analysis.advice,
    });

    if (saveError) {
      console.error("Supabase scan save error:", saveError);
      return NextResponse.json({
        error: "Analysis completed, but saving the scan failed.",
        details: saveError.message,
        credits_remaining: updated.credits,
      }, { status: 500 });
    }

    return NextResponse.json({ ...analysis, credits_remaining: updated.credits });
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    console.error("POST /api/scan failed:", error);
    return NextResponse.json({
      error: message,
      details: message,
    }, { status: 500 });
  }
}