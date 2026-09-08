import { NextResponse } from "next/server";
import { getSpreadsheet } from "@/app/lib/googleSheet";

// Never evaluate this route at build time; it always runs per-request.
export const dynamic = "force-dynamic";

// Each worksheet tab is named after a teacher, so the tab titles ARE the
// teacher list. This means adding a new teacher tab needs no code change.
export async function GET() {
  try {
    const doc = await getSpreadsheet();
    const teachers = doc.sheetsByIndex.map((s) => s.title);
    return NextResponse.json({ teachers });
  } catch (err) {
    console.error("get-teachers error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to fetch teachers";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
