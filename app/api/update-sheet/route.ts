import { NextResponse } from "next/server";
import { getSpreadsheet } from "@/app/lib/googleSheet";

export const dynamic = "force-dynamic";

// --- Date helpers ---------------------------------------------------------
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Google Sheets stores real dates as a serial number (days since 1899-12-30).
// 25569 = days between that epoch and the Unix epoch (1970-01-01).
function serialToDate(serial: number): Date {
  return new Date(Math.round((serial - 25569) * 86400000));
}

/**
 * Normalise any date-ish input to the canonical string "DD/MM/YYYY".
 * Handles:
 *   - a numeric Sheets serial (cell stored as a real Date, e.g. 46237)
 *   - a raw string "03/08/2026" / "3/8/2026" (also '-' or '.' separators)
 *   - an ISO string "2026-08-03"
 * Returns null if it can't be parsed.
 */
function normalizeDate(input: unknown): string | null {
  if (input === null || input === undefined) return null;

  if (typeof input === "number" && Number.isFinite(input)) {
    const d = serialToDate(input);
    return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  }

  const s = String(input).trim();
  if (!s) return null;

  // DD/MM/YYYY (day first)
  let m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    return `${pad(Number(dd))}/${pad(Number(mm))}/${yyyy}`;
  }
  // YYYY-MM-DD (ISO)
  m = s.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) {
    const [, yyyy, mm, dd] = m;
    return `${pad(Number(dd))}/${pad(Number(mm))}/${yyyy}`;
  }
  return null;
}

// --- Route ----------------------------------------------------------------
type Payload = {
  teacher?: string;
  student?: string;
  date?: string; // DD/MM/YYYY
  danh_gia?: string;
  phan_tram?: string;
  noi_dung?: string;
};

export async function POST(request: Request) {
  let body: Payload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const teacher = body.teacher?.trim();
  const student = body.student?.trim();
  const targetDate = normalizeDate(body.date);

  if (!teacher || !student || !targetDate) {
    return NextResponse.json(
      { error: "Missing teacher, student or a valid date (DD/MM/YYYY)" },
      { status: 400 }
    );
  }

  try {
    const doc = await getSpreadsheet();

    const sheet = doc.sheetsByTitle[teacher];
    if (!sheet) {
      return NextResponse.json(
        { error: `No sheet tab found for teacher "${teacher}"` },
        { status: 404 }
      );
    }

    // Load Row 1 (the date row) across every column.
    await sheet.loadCells({
      startRowIndex: 0,
      endRowIndex: 1,
      startColumnIndex: 0,
      endColumnIndex: sheet.columnCount,
    });

    // Find the column whose RAW value matches the date.
    // Merged cells: only the first (anchor) column of the merge holds a value,
    // so this naturally lands on the first column of the 3-column group.
    let dateColIndex = -1;
    for (let col = 0; col < sheet.columnCount; col++) {
      const cell = sheet.getCell(0, col);
      // Strictly use the raw underlying value first; fall back to the
      // formatted display only if the raw value can't be parsed.
      const key = normalizeDate(cell.value) ?? normalizeDate(cell.formattedValue);
      if (key && key === targetDate) {
        dateColIndex = col;
        break;
      }
    }

    if (dateColIndex === -1) {
      return NextResponse.json(
        { error: `Date "${targetDate}" not found in Row 1 of tab "${teacher}"` },
        { status: 404 }
      );
    }

    // Load Column C (index 2) from row 3 (index 2) down, to find the student.
    await sheet.loadCells({
      startRowIndex: 2,
      endRowIndex: sheet.rowCount,
      startColumnIndex: 2,
      endColumnIndex: 3,
    });

    let studentRow = -1;
    for (let row = 2; row < sheet.rowCount; row++) {
      const v = sheet.getCell(row, 2).value;
      if (v != null && String(v).trim() === student) {
        studentRow = row;
        break;
      }
    }

    if (studentRow === -1) {
      return NextResponse.json(
        { error: `Student "${student}" not found in column C of tab "${teacher}"` },
        { status: 404 }
      );
    }

    // Load the 3 target cells at the intersection (student row x date group).
    await sheet.loadCells({
      startRowIndex: studentRow,
      endRowIndex: studentRow + 1,
      startColumnIndex: dateColIndex,
      endColumnIndex: dateColIndex + 3,
    });

    sheet.getCell(studentRow, dateColIndex).value = body.danh_gia ?? "";
    sheet.getCell(studentRow, dateColIndex + 1).value = body.phan_tram ?? "";
    sheet.getCell(studentRow, dateColIndex + 2).value = body.noi_dung ?? "";

    await sheet.saveUpdatedCells();

    return NextResponse.json({
      ok: true,
      teacher,
      student,
      date: targetDate,
      dateColIndex,
      studentRow: studentRow + 1, // 1-based for humans
    });
  } catch (err) {
    console.error("update-sheet error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to update sheet";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
