import { NextResponse } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";
import { FIELDS, FIELD_KEYS } from "@/app/lib/fields";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "gemini-flash-latest"; // alias -> luon la ban flash moi nhat

// Build the system prompt from the central fields config.
const fieldLines = FIELDS.map((f) => `- "${f.key}": ${f.hint}`).join("\n");
const SYSTEM_PROMPT = `You are a data extraction assistant. Read this handwritten math learning diary page. The page may contain MULTIPLE date blocks — each block starts with a date (e.g. "3/8/26", "05.08.2026"). For EACH date block, output one entry, keeping top-to-bottom order.

Return JSON of the form { "entries": [ ... ] }. Each entry must have:
- "date": the block's date as DD/MM/YYYY with a 4-digit year (e.g. "3/8/26" -> "03/08/2026", "05.08.2026" -> "05/08/2026").
${fieldLines}

Correct any spelling mistakes in the teacher's quick handwriting. If a field is missing in a block, use an empty string.`;

// Build the response schema from the central fields config.
const entryProps: Record<string, { type: Type }> = { date: { type: Type.STRING } };
for (const key of FIELD_KEYS) entryProps[key] = { type: Type.STRING };

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    entries: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: entryProps,
        required: ["date", ...FIELD_KEYS],
      },
    },
  },
  required: ["entries"],
};

// Transient errors from Gemini (overload / rate limit) worth retrying.
function isRetryable(err: unknown): boolean {
  const msg = String(err instanceof Error ? err.message : err);
  return /\b(503|429)\b|UNAVAILABLE|overloaded|high demand|RESOURCE_EXHAUSTED/i.test(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing GEMINI_API_KEY in .env.local" },
      { status: 500 }
    );
  }

  let body: { image?: string; mimeType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { image, mimeType } = body;
  if (!image) {
    return NextResponse.json(
      { error: "Missing 'image' (base64 without the data: prefix)" },
      { status: 400 }
    );
  }

  const ai = new GoogleGenAI({ apiKey });
  const params = {
    model: MODEL,
    contents: [
      {
        role: "user" as const,
        parts: [
          { inlineData: { mimeType: mimeType || "image/jpeg", data: image } },
          { text: "Extract every date block from this learning-diary page." },
        ],
      },
    ],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0,
    },
  };

  // Try up to 4 times, backing off, when Gemini is temporarily overloaded.
  const delays = [1200, 2500, 4000];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const response = await ai.models.generateContent(params);
      const text = response.text ?? "";

      let parsed: { entries?: Array<Record<string, unknown>> };
      try {
        parsed = JSON.parse(text);
      } catch {
        return NextResponse.json(
          { error: "Model did not return valid JSON", raw: text },
          { status: 502 }
        );
      }

      const entries = (parsed.entries ?? []).map((e) => {
        const out: Record<string, string> = {
          date: e.date != null ? String(e.date) : "",
        };
        for (const key of FIELD_KEYS) out[key] = e[key] != null ? String(e[key]) : "";
        return out;
      });

      return NextResponse.json({ entries });
    } catch (err) {
      lastErr = err;
      if (attempt < delays.length && isRetryable(err)) {
        await sleep(delays[attempt]);
        continue;
      }
      break;
    }
  }

  console.error("process-image error:", lastErr);
  if (isRetryable(lastErr)) {
    return NextResponse.json(
      { error: "Google AI đang quá tải, vui lòng thử lại sau ít giây." },
      { status: 503 }
    );
  }
  const message =
    lastErr instanceof Error ? lastErr.message : "Failed to process image";
  return NextResponse.json({ error: message }, { status: 500 });
}
