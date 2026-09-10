import { NextResponse } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";
import { FIELDS, FIELD_KEYS } from "@/app/lib/fields";

export const dynamic = "force-dynamic";
// Vercel Hobby cho phép tối đa 300s. Ảnh nhiều chữ + prompt chi tiết có thể
// khiến AI xử lý lâu; đặt cao để tránh bị hủy giữa chừng (lỗi 504).
export const maxDuration = 180;

// Model chính + model dự phòng (nhẹ hơn, ít bị quá tải hơn).
const PRIMARY_MODEL = "gemini-flash-latest";
const FALLBACK_MODEL = "gemini-flash-lite-latest";

const CURRENT_YEAR = new Date().getFullYear();

// Build the system prompt from the central fields config.
const fieldLines = FIELDS.map((f) => `- "${f.key}": ${f.hint}`).join("\n");
const SYSTEM_PROMPT = `You are a data extraction assistant reading a handwritten math learning-diary page from a Vietnamese tutoring center.

IMPORTANT: the photo MAY BE ROTATED or sideways. Mentally rotate it and read the handwriting in whatever orientation makes it upright.

The page contains one or MORE blocks. Each block starts with a "Date:" label and has fields such as Objectives, Comments (Knowledges, Skills, Attitude, Homework) and Notes.

For EVERY block that has a Date, output one entry — even if the other fields are hard to read or empty. NEVER skip a block just because some fields are unclear. If any date at all is visible, you MUST return at least one entry.

Return JSON of the form { "entries": [ ... ] }. Each entry must have:
- "date": the block's date as DD/MM/YYYY. Dates are often written WITHOUT a year (e.g. "05/07", "18/7"); assume the year is ${CURRENT_YEAR}, so "05/07" -> "05/07/${CURRENT_YEAR}".
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
  const contents = [
    {
      role: "user" as const,
      parts: [
        { inlineData: { mimeType: mimeType || "image/jpeg", data: image } },
        { text: "Extract every date block from this learning-diary page." },
      ],
    },
  ];
  const config = {
    systemInstruction: SYSTEM_PROMPT,
    responseMimeType: "application/json",
    responseSchema: RESPONSE_SCHEMA,
    temperature: 0,
  };

  // Gọi 1 model, có thử lại khi gặp lỗi tạm thời.
  async function callModel(modelName: string) {
    // Chỉ thử lại 1 lần/model (thay vì 2) để không cộng dồn quá nhiều thời
    // gian chờ trước khi chuyển sang model dự phòng — ảnh nặng đã tốn đủ lâu rồi.
    const delays = [800];
    let lastErr: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        return await ai.models.generateContent({ model: modelName, contents, config });
      } catch (err) {
        lastErr = err;
        if (attempt < delays.length && isRetryable(err)) {
          await sleep(delays[attempt]);
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  try {
    let response;
    try {
      response = await callModel(PRIMARY_MODEL);
    } catch (err) {
      // Model chính quá tải -> thử model dự phòng nhẹ hơn.
      if (isRetryable(err)) {
        response = await callModel(FALLBACK_MODEL);
      } else {
        throw err;
      }
    }

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
    console.error("process-image error:", err);
    if (isRetryable(err)) {
      return NextResponse.json(
        { error: "Google AI đang quá tải, vui lòng thử lại sau ít giây." },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to process image";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
