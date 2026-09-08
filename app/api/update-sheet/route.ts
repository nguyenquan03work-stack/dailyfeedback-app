import { NextResponse } from "next/server";
import { getSpreadsheet } from "@/app/lib/googleSheet";
import { FIELD_KEYS } from "@/app/lib/fields";

export const dynamic = "force-dynamic";

// --- Date helpers ---------------------------------------------------------
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Google Sheets stores real dates as a serial (days since 1899-12-30).
// 25569 = days between that epoch and the Unix epoch (1970-01-01).
function serialToDate(serial: number): Date {
  return new Date(Math.round((serial - 25569) * 86400000));
}

// Normalise any date-ish value to "DD/MM/YYYY", or null.
function normalizeDate(input: unknown): string | null {
  if (input === null || input === undefined) return null;

  if (typeof input === "number" && Number.isFinite(input)) {
    const d = serialToDate(input);
    return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  }

  const s = String(input).trim();
  if (!s) return null;

  let m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/); // DD/MM/YY(YY)
  if (m) {
    const [, dd, mm, yy] = m;
    const yyyy = yy.length === 2 ? `20${yy}` : yy;
    return `${pad(Number(dd))}/${pad(Number(mm))}/${yyyy}`;
  }
  m = s.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/); // ISO
  if (m) {
    const [, yyyy, mm, dd] = m;
    return `${pad(Number(dd))}/${pad(Number(mm))}/${yyyy}`;
  }
  return null;
}

// --- Route ----------------------------------------------------------------
type Entry = { date?: string } & Record<string, string | undefined>;
type Payload = { teacher?: string; student?: string; entries?: Entry[] };

export async function POST(request: Request) {
  let body: Payload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const teacher = body.teacher?.trim();
  const student = body.student?.trim();
  const entries = Array.isArray(body.entries) ? body.entries : [];

  if (!teacher || !student || entries.length === 0) {
    return NextResponse.json(
      { error: "Missing teacher, student, or entries" },
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

    // Load Row 1 (dates) and build date -> column-index map (raw value first).
    await sheet.loadCells({
      startRowIndex: 0,
      endRowIndex: 1,
      startColumnIndex: 0,
      endColumnIndex: sheet.columnCount,
    });
    const dateToCol = new Map<string, number>();
    for (let col = 0; col < sheet.columnCount; col++) {
      const cell = sheet.getCell(0, col);
      const key = normalizeDate(cell.value) ?? normalizeDate(cell.formattedValue);
      if (key && !dateToCol.has(key)) dateToCol.set(key, col);
    }

    // Load Column C (index 2) from row 3 down, find the student row.
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

    // For each entry, match date and stage the 3 (N) cells.
    const results: Array<{ date: string; ok: boolean; reason?: string }> = [];
    let anyWritten = false;

    for (const entry of entries) {
      const targetDate = normalizeDate(entry.date);
      if (!targetDate) {
        results.push({ date: String(entry.date ?? ""), ok: false, reason: "Ngày không hợp lệ" });
        continue;
      }
      const col = dateToCol.get(targetDate);
      if (col === undefined) {
        results.push({ date: targetDate, ok: false, reason: "Không thấy cột ngày này trong Row 1" });
        continue;
      }

      await sheet.loadCells({
        startRowIndex: studentRow,
        endRowIndex: studentRow + 1,
        startColumnIndex: col,
        endColumnIndex: col + FIELD_KEYS.length,
      });
      FIELD_KEYS.forEach((key, i) => {
        sheet.getCell(studentRow, col + i).value = entry[key] ?? "";
      });
      anyWritten = true;
      results.push({ date: targetDate, ok: true });
    }

    if (anyWritten) await sheet.saveUpdatedCells();

    return NextResponse.json({
      ok: true,
      teacher,
      student,
      studentRow: studentRow + 1, // 1-based for humans
      results,
    });
  } catch (err) {
    console.error("update-sheet error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to update sheet";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
