import { NextResponse } from "next/server";
import { getSpreadsheet } from "@/app/lib/googleSheet";

// Never evaluate this route at build time; it always runs per-request.
export const dynamic = "force-dynamic";

// Student names live in Column C (index 2), starting at row 3.
const NAME_COLUMN_INDEX = 2; // A=0, B=1, C=2
const FIRST_DATA_ROW_INDEX = 2; // row 3 is index 2 (0-based)

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const teacher = searchParams.get("teacher")?.trim();

  if (!teacher) {
    return NextResponse.json(
      { error: "Missing required query param: teacher" },
      { status: 400 }
    );
  }

  try {
    const doc = await getSpreadsheet();

    // Each tab (worksheet) is named after a teacher.
    const sheet = doc.sheetsByTitle[teacher];
    if (!sheet) {
      return NextResponse.json(
        { error: `No sheet tab found for teacher "${teacher}"` },
        { status: 404 }
      );
    }

    // Load only Column C from row 3 down to the last row with data.
    const lastRow = sheet.rowCount;
    await sheet.loadCells({
      startRowIndex: FIRST_DATA_ROW_INDEX,
      endRowIndex: lastRow,
      startColumnIndex: NAME_COLUMN_INDEX,
      endColumnIndex: NAME_COLUMN_INDEX + 1,
    });

    const students: string[] = [];
    for (let row = FIRST_DATA_ROW_INDEX; row < lastRow; row++) {
      const cell = sheet.getCell(row, NAME_COLUMN_INDEX);
      const value = cell.value;
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        students.push(String(value).trim());
      }
    }

    return NextResponse.json({ teacher, students });
  } catch (err) {
    console.error("get-students error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to fetch students";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
