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

  try {
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
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
    });

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

    // Normalise: every entry has date + all field keys as strings.
    const entries = (parsed.entries ?? []).map((e) => {
      const out: Record<string, string> = {
        date: e.date != null ? String(e.date) : "",
      };
      for (const key of FIELD_KEYS) out[key] = e[key] != null ? String(e[key]) : "";
      return out;
    });

    return NextResponse.json({ entries });
  } catch (err) {
    console.error("process-image error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to process image";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
