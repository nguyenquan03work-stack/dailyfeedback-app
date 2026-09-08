import { NextResponse } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";

// This route always runs per-request (never at build time).
export const dynamic = "force-dynamic";
// Vision calls can take a few seconds; give it room.
export const maxDuration = 60;

const MODEL = "gemini-flash-latest"; // alias -> luon la ban flash moi nhat

const SYSTEM_PROMPT = `You are a data extraction assistant. Read this handwritten math learning diary. Extract the evaluation and output a JSON with exactly these 3 keys:
- "danh_gia_nhanh": The overall rating (must be one of these exact strings: "Đạt", "Chưa đạt", or leave empty if not clear).
- "phan_tram": The completion percentage (e.g., "70%").
- "noi_dung": The specific learning content or notes (e.g., "- Timo", "- IGCSE", "- Algebra"). Correct any spelling mistakes in the teacher's quick handwriting.`;

// Force Gemini to return exactly the 3 fields we expect.
const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    danh_gia_nhanh: { type: Type.STRING },
    phan_tram: { type: Type.STRING },
    noi_dung: { type: Type.STRING },
  },
  required: ["danh_gia_nhanh", "phan_tram", "noi_dung"],
} as const;

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
            {
              inlineData: {
                mimeType: mimeType || "image/jpeg",
                data: image,
              },
            },
            { text: "Extract the evaluation from this learning-diary photo." },
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

    let data: {
      danh_gia_nhanh: string;
      phan_tram: string;
      noi_dung: string;
    };
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: "Model did not return valid JSON", raw: text },
        { status: 502 }
      );
    }

    // Normalise so the frontend always gets all 3 keys as strings.
    return NextResponse.json({
      danh_gia_nhanh: data.danh_gia_nhanh ?? "",
      phan_tram: data.phan_tram ?? "",
      noi_dung: data.noi_dung ?? "",
    });
  } catch (err) {
    console.error("process-image error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to process image";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
