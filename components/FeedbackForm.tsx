"use client";

import { useEffect, useRef, useState } from "react";

type Extracted = {
  danh_gia_nhanh: string;
  phan_tram: string;
  noi_dung: string;
};

const EMPTY: Extracted = { danh_gia_nhanh: "", phan_tram: "", noi_dung: "" };

// Read a File as base64 WITHOUT the "data:...;base64," prefix.
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// "2026-08-03" (from <input type=date>) -> "03/08/2026" for the API.
function toDDMMYYYY(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return "";
  return `${d}/${m}/${y}`;
}

function todayISO(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

export default function FeedbackForm() {
  const [teachers, setTeachers] = useState<string[]>([]);
  const [students, setStudents] = useState<string[]>([]);

  const [teacher, setTeacher] = useState("");
  const [student, setStudent] = useState("");
  const [date, setDate] = useState(todayISO());

  const [loadingTeachers, setLoadingTeachers] = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [processing, setProcessing] = useState(false);
  const [extracted, setExtracted] = useState<Extracted | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitOk, setSubmitOk] = useState(false);

  // 1. Load teachers (worksheet tab names).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/get-teachers");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load teachers");
        if (active) setTeachers(data.teachers ?? []);
      } catch (err) {
        if (active)
          setError(err instanceof Error ? err.message : "Failed to load teachers");
      } finally {
        if (active) setLoadingTeachers(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // 2. Load students when teacher changes.
  useEffect(() => {
    setStudent("");
    setStudents([]);
    if (!teacher) return;

    let active = true;
    setLoadingStudents(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/get-students?teacher=${encodeURIComponent(teacher)}`
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load students");
        if (active) setStudents(data.students ?? []);
      } catch (err) {
        if (active)
          setError(err instanceof Error ? err.message : "Failed to load students");
      } finally {
        if (active) setLoadingStudents(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [teacher]);

  // 3. Capture -> send to AI.
  async function handleCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoFile(file);
    setPhotoUrl(URL.createObjectURL(file));
    setExtracted(null);
    setSubmitOk(false);
    await processImage(file);
  }

  async function processImage(file: File) {
    setProcessing(true);
    setError(null);
    try {
      const base64 = await fileToBase64(file);
      const res = await fetch("/api/process-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, mimeType: file.type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to read image");
      setExtracted({
        danh_gia_nhanh: data.danh_gia_nhanh ?? "",
        phan_tram: data.phan_tram ?? "",
        noi_dung: data.noi_dung ?? "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read image");
      setExtracted({ ...EMPTY });
    } finally {
      setProcessing(false);
    }
  }

  function clearPhoto() {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(null);
    setPhotoFile(null);
    setExtracted(null);
    setSubmitOk(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function updateField(key: keyof Extracted, value: string) {
    setExtracted((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSubmitOk(false);
  }

  // 4. Submit the (edited) result into the Google Sheet.
  async function handleSubmit() {
    if (!extracted) return;
    setSubmitting(true);
    setError(null);
    setSubmitOk(false);
    try {
      const res = await fetch("/api/update-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacher,
          student,
          date: toDDMMYYYY(date),
          danh_gia: extracted.danh_gia_nhanh,
          phan_tram: extracted.phan_tram,
          noi_dung: extracted.noi_dung,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setSubmitOk(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  const canCapture = Boolean(teacher && student && date);
  const inputClass =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:opacity-60";

  return (
    <div className="flex flex-col gap-5 pb-10">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {/* Teacher */}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-slate-700">Giáo viên</span>
        <select
          value={teacher}
          onChange={(e) => setTeacher(e.target.value)}
          disabled={loadingTeachers}
          className={inputClass}
        >
          <option value="">
            {loadingTeachers ? "Đang tải..." : "-- Chọn giáo viên --"}
          </option>
          {teachers.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>

      {/* Student */}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-slate-700">Học sinh</span>
        <select
          value={student}
          onChange={(e) => setStudent(e.target.value)}
          disabled={!teacher || loadingStudents}
          className={inputClass}
        >
          <option value="">
            {!teacher
              ? "-- Chọn giáo viên trước --"
              : loadingStudents
              ? "Đang tải..."
              : "-- Chọn học sinh --"}
          </option>
          {students.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      {/* Date */}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-slate-700">Ngày nhật ký</span>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={inputClass}
        />
      </label>

      {/* Camera */}
      <div className="flex flex-col gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleCapture}
          className="hidden"
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!canCapture || processing}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-3.5 text-base font-semibold text-white shadow-sm transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <CameraIcon />
          {photoUrl ? "Chụp lại" : "Chụp ảnh nhật ký"}
        </button>

        {!canCapture && (
          <p className="text-center text-xs text-slate-400">
            Chọn giáo viên, học sinh và ngày để mở camera.
          </p>
        )}

        {photoUrl && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoUrl}
              alt="Ảnh nhật ký đã chụp"
              className="max-h-64 w-full object-contain"
            />
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="truncate text-xs text-slate-500">
                {photoFile?.name}
              </span>
              <button
                type="button"
                onClick={clearPhoto}
                className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
              >
                Xóa
              </button>
            </div>
          </div>
        )}
      </div>

      {processing && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-4 text-sm text-slate-500">
          <Spinner />
          AI đang đọc ảnh nhật ký...
        </div>
      )}

      {extracted && !processing && (
        <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">
              Kết quả AI đọc được
            </h2>
            <button
              type="button"
              onClick={() => photoFile && processImage(photoFile)}
              className="text-xs font-medium text-slate-500 hover:text-slate-900"
            >
              Đọc lại
            </button>
          </div>
          <p className="-mt-2 text-xs text-slate-400">
            Kiểm tra và chỉnh sửa lại nếu cần trước khi gửi.
          </p>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">
              Đánh giá nhanh
            </span>
            <select
              value={extracted.danh_gia_nhanh}
              onChange={(e) => updateField("danh_gia_nhanh", e.target.value)}
              className={inputClass}
            >
              <option value="">-- Chưa rõ --</option>
              <option value="Đạt">Đạt</option>
              <option value="Chưa đạt">Chưa đạt</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">
              Phần trăm hoàn thành
            </span>
            <input
              type="text"
              value={extracted.phan_tram}
              onChange={(e) => updateField("phan_tram", e.target.value)}
              placeholder="VD: 70%"
              className={inputClass}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">
              Nội dung học
            </span>
            <textarea
              value={extracted.noi_dung}
              onChange={(e) => updateField("noi_dung", e.target.value)}
              rows={4}
              placeholder="- Timo&#10;- IGCSE&#10;- Algebra"
              className={`${inputClass} resize-y`}
            />
          </label>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3.5 text-base font-semibold text-white shadow-sm transition active:scale-[0.99] disabled:opacity-50"
          >
            {submitting && <Spinner />}
            {submitting ? "Đang gửi..." : "Gửi vào Google Sheet"}
          </button>

          {submitOk && (
            <p className="text-center text-sm font-medium text-emerald-600">
              ✓ Đã lưu vào Google Sheet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CameraIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin text-current"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
