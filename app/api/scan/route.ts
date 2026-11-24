import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const runtime = "nodejs";

type AnalysisResult = {
  risk_score: number;
  summary: string;
  red_flags: string[];
  advice: string[];
};

type OpenRouterTextPart = { type: "text"; text: string };
type OpenRouterImagePart = {
  type: "image_url";
  image_url: { url: string };
};
type OpenRouterFilePart = {
  type: "file";
  file: { filename: string; file_data: string };
};
type OpenRouterContentPart =
  | OpenRouterTextPart
  | OpenRouterImagePart
  | OpenRouterFilePart;

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: {
    message?: string;
    code?: number | string;
  };
};

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL_FALLBACKS = [
  "nvidia/nemotron-3.5-super-vl:free",
  "google/gemma-4-31b-it:free",
  "openrouter/free",
] as const;

function getRequiredEnv(name: "OPENROUTER_API_KEY" | "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value =
    name === "OPENROUTER_API_KEY"
      ? process.env.OPENROUTER_API_KEY
      : name === "NEXT_PUBLIC_SUPABASE_URL"
        ? process.env.NEXT_PUBLIC_SUPABASE_URL
        : process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
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
  if (!isRecord(value)) {
    throw new Error("OpenRouter response is not a JSON object.");
  }

  const score = Number(value.risk_score);
  if (!Number.isFinite(score)) {
    throw new Error("OpenRouter response is missing a valid risk_score.");
  }

  if (typeof value.summary !== "string") {
    throw new Error("OpenRouter response is missing a valid summary.");
  }
  if (!Array.isArray(value.red_flags) || !Array.isArray(value.advice)) {
    throw new Error("OpenRouter response must include red_flags and advice arrays.");
  }

  return {
    risk_score: Math.max(0, Math.min(100, Math.round(score))),
    summary: value.summary,
    red_flags: value.red_flags.filter((item): item is string => typeof item === "string"),
    advice: value.advice.filter((item): item is string => typeof item === "string"),
  };
}

function extractMessageText(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function cleanJsonText(rawText: string): string {
  const trimmed = rawText.trim();
  const fenced = trimmed.match(/^\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function shouldRetry(status: number, responseText: string): boolean {
  if ([404, 429, 502, 503, 504].includes(status)) return true;
  return /rate.?limit|temporarily unavailable|model.*unavailable|no available provider|provider.*unavailable/i.test(responseText);
}

async function requestOpenRouter(
  apiKey: string,
  content: OpenRouterContentPart[]
): Promise<string> {
  let lastError = "OpenRouter request failed.";

  for (let index = 0; index < MODEL_FALLBACKS.length; index += 1) {
    const model = MODEL_FALLBACKS[index];
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/alimoeinzade369-cyber/fineprint-ai",
        "X-Title": "FinePrint AI",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content,
          },
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
    });

    const responseText = await response.text();
    if (!response.ok) {
      lastError = `OpenRouter model ${model} failed (HTTP ${response.status}): ${responseText}`;
      console.error(lastError);
      const hasFallback = index < MODEL_FALLBACKS.length - 1;
      if (hasFallback && shouldRetry(response.status, responseText)) continue;
      throw new Error(lastError);
    }

    let payload: OpenRouterResponse;
    try {
      payload = JSON.parse(responseText) as OpenRouterResponse;
    } catch {
      throw new Error(`OpenRouter returned invalid response JSON for model ${model}.`);
    }

    const messageText = extractMessageText(payload.choices?.[0]?.message?.content);
    if (!messageText) {
      throw new Error(
        payload.error?.message ??
          `OpenRouter returned an empty response for model ${model}.`
      );
    }
    return messageText;
  }

  throw new Error(lastError);
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const openRouterApiKey = getRequiredEnv("OPENROUTER_API_KEY");
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) throw new Error(`Authentication failed: ${authError.message}`);
    if (!user) {
      return NextResponse.json({ error: "Please sign in." }, { status: 401 });
    }

    const form = await request.formData();
    const text = String(form.get("text") ?? "").trim();
    const uploadedFile = form.get("file");
    const content: OpenRouterContentPart[] = [];
    let fileName: string | null = null;

    const prompt =
      "Analyze this contract or document for a non-lawyer. Return ONLY a JSON object with exactly these keys: risk_score (integer 0-100), summary (plain language string), red_flags (array of concise strings), advice (array of practical questions/actions). Score higher means greater risk. Identify uncertainty and do not invent clauses. This is informational, not legal advice.";

    content.push({ type: "text", text: prompt });

    if (uploadedFile instanceof File && uploadedFile.size > 0) {
      if (uploadedFile.size > 15 * 1024 * 1024) {
        return NextResponse.json(
          { error: "File must be smaller than 15 MB." },
          { status: 400 }
        );
      }

      const allowedTypes = [
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/webp",
        "text/plain",
      ];
      if (!allowedTypes.includes(uploadedFile.type)) {
        return NextResponse.json(
          { error: "Supported formats: PDF, PNG, JPG, WEBP, TXT." },
          { status: 400 }
        );
      }

      fileName = uploadedFile.name;
      if (uploadedFile.type === "text/plain") {
        content.push({
          type: "text",
          text: `User-provided document text:\n${await uploadedFile.text()}`,
        });
      } else {
        const bytes = new Uint8Array(await uploadedFile.arrayBuffer());
        const dataUrl = `data:${uploadedFile.type};base64,${bytesToBase64(bytes)}`;

        if (uploadedFile.type === "application/pdf") {
          content.push({
            type: "file",
            file: { filename: uploadedFile.name, file_data: dataUrl },
          });
        } else {
          content.push({
            type: "image_url",
            image_url: { url: dataUrl },
          });
        }
      }
    }

    if (text) {
      content.push({ type: "text", text: `User-provided document text:\n${text}` });
    }
    if (content.length === 1) {
      return NextResponse.json(
        { error: "Add text or upload a document." },
        { status: 400 }
      );
    }

    const db = createAdminClient();
    const rawText = await requestOpenRouter(openRouterApiKey, content);
    let decoded: unknown;
    try {
      decoded = JSON.parse(cleanJsonText(rawText));
    } catch {
      throw new Error("OpenRouter returned invalid JSON.");
    }
    const analysis = parseAnalysis(decoded);

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
      return NextResponse.json(
        {
          error: "Analysis completed, but saving the scan failed.",
          details: saveError.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(analysis);
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    console.error("POST /api/scan failed:", error);
    return NextResponse.json(
      { error: message, details: message },
      { status: 500 }
    );
  }
}
