"use client";

import { useEffect, useRef, useState } from "react";
import { FIELDS, FIELD_KEYS, emptyValues, type EntryValues } from "@/app/lib/fields";

type Entry = {
  date: string;
  values: EntryValues;
  include: boolean;
};

type SubmitResult = { date: string; ok: boolean; reason?: string };

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function FeedbackForm() {
  const [teachers, setTeachers] = useState<string[]>([]);
  const [students, setStudents] = useState<string[]>([]);

  const [teacher, setTeacher] = useState("");
  const [student, setStudent] = useState("");

  const [loadingTeachers, setLoadingTeachers] = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [processing, setProcessing] = useState(false);
  const [entries, setEntries] = useState<Entry[] | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<SubmitResult[] | null>(null);

  // Load teachers.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/get-teachers");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load teachers");
        if (active) setTeachers(data.teachers ?? []);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load teachers");
      } finally {
        if (active) setLoadingTeachers(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Load students when teacher changes.
  useEffect(() => {
    setStudent("");
    setStudents([]);
    if (!teacher) return;

    let active = true;
    setLoadingStudents(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/get-students?teacher=${encodeURIComponent(teacher)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load students");
        if (active) setStudents(data.students ?? []);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load students");
      } finally {
        if (active) setLoadingStudents(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [teacher]);

  async function handleCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoFile(file);
    setPhotoUrl(URL.createObjectURL(file));
    setEntries(null);
    setResults(null);
    await processImage(file);
  }

  async function processImage(file: File) {
    setProcessing(true);
    setError(null);
    setResults(null);
    try {
      const base64 = await fileToBase64(file);
      const res = await fetch("/api/process-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, mimeType: file.type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to read image");

      const list: Entry[] = (data.entries ?? []).map((e: Record<string, string>) => {
        const values = emptyValues();
        for (const k of FIELD_KEYS) values[k] = e[k] ?? "";
        return { date: e.date ?? "", values, include: true };
      });
      setEntries(list.length > 0 ? list : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read image");
      setEntries([]);
    } finally {
      setProcessing(false);
    }
  }

  function clearPhoto() {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(null);
    setPhotoFile(null);
    setEntries(null);
    setResults(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function updateEntry(idx: number, patch: Partial<Entry>) {
    setEntries((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
    setResults(null);
  }

  function updateEntryValue(idx: number, key: string, value: string) {
    setEntries((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], values: { ...next[idx].values, [key]: value } };
      return next;
    });
    setResults(null);
  }

  async function handleSubmit() {
    if (!entries) return;
    const chosen = entries.filter((e) => e.include);
    if (chosen.length === 0) {
      setError("Chưa chọn ngày nào để gửi.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch("/api/update-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacher,
          student,
          entries: chosen.map((e) => ({ date: e.date, ...e.values })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setResults(data.results ?? []);
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

  const canCapture = Boolean(teacher && student);
  const inputClass =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:opacity-60";

  return (
    <div className="flex flex-col gap-5 pb-10">
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Teacher */}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-slate-700">Giáo viên</span>
        <select value={teacher} onChange={(e) => setTeacher(e.target.value)} disabled={loadingTeachers} className={inputClass}>
          <option value="">{loadingTeachers ? "Đang tải..." : "-- Chọn giáo viên --"}</option>
          {teachers.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>

      {/* Student */}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-slate-700">Học sinh</span>
        <select value={student} onChange={(e) => setStudent(e.target.value)} disabled={!teacher || loadingStudents} className={inputClass}>
          <option value="">
            {!teacher ? "-- Chọn giáo viên trước --" : loadingStudents ? "Đang tải..." : "-- Chọn học sinh --"}
          </option>
          {students.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </label>

      {/* Camera */}
      <div className="flex flex-col gap-3">
        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleCapture} className="hidden" />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!canCapture || processing}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-3.5 text-base font-semibold text-white shadow-sm transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <CameraIcon />
          {photoUrl ? "Chụp lại" : "Chụp ảnh nhật ký"}
        </button>
        {!canCapture && <p className="text-center text-xs text-slate-400">Chọn giáo viên và học sinh để mở camera.</p>}
        {canCapture && !photoUrl && (
          <p className="text-center text-xs text-slate-400">Chụp cả trang — có nhiều ngày AI sẽ tự tách ra.</p>
        )}

        {photoUrl && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl} alt="Ảnh nhật ký đã chụp" className="max-h-64 w-full object-contain" />
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="truncate text-xs text-slate-500">{photoFile?.name}</span>
              <button type="button" onClick={clearPhoto} className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50">
                Xóa
              </button>
            </div>
          </div>
        )}
      </div>

      {processing && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-4 text-sm text-slate-500">
          <Spinner /> AI đang đọc ảnh nhật ký...
        </div>
      )}

      {entries && !processing && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">
              AI tìm thấy {entries.length} ngày
            </h2>
            <button
              type="button"
              onClick={() => photoFile && processImage(photoFile)}
              className="text-xs font-medium text-slate-500 hover:text-slate-900"
            >
              Đọc lại
            </button>
          </div>

          {entries.length === 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              Không đọc được ngày nào. Thử chụp lại rõ hơn.
            </p>
          )}

          {entries.map((entry, idx) => {
            const res = results?.find((r) => r.date === entry.date);
            return (
              <div key={idx} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={entry.include}
                    onChange={(e) => updateEntry(idx, { include: e.target.checked })}
                    className="h-5 w-5 rounded border-slate-300"
                  />
                  <label className="flex flex-1 items-center gap-2">
                    <span className="text-sm font-medium text-slate-700">Ngày</span>
                    <input
                      type="text"
                      value={entry.date}
                      onChange={(e) => updateEntry(idx, { date: e.target.value })}
                      placeholder="DD/MM/YYYY"
                      className="w-32 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                    />
                  </label>
                </div>

                {FIELDS.map((f) => (
                  <label key={f.key} className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-slate-700">{f.label}</span>
                    {f.type === "rating" ? (
                      <select
                        value={entry.values[f.key]}
                        onChange={(e) => updateEntryValue(idx, f.key, e.target.value)}
                        className={inputClass}
                      >
                        <option value="">-- Chưa rõ --</option>
                        {(f.options ?? []).map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : f.type === "textarea" ? (
                      <textarea
                        value={entry.values[f.key]}
                        onChange={(e) => updateEntryValue(idx, f.key, e.target.value)}
                        rows={3}
                        placeholder={f.placeholder}
                        className={`${inputClass} resize-y`}
                      />
                    ) : (
                      <input
                        type="text"
                        value={entry.values[f.key]}
                        onChange={(e) => updateEntryValue(idx, f.key, e.target.value)}
                        placeholder={f.placeholder}
                        className={inputClass}
                      />
                    )}
                  </label>
                ))}

                {res && (
                  <p className={`text-sm font-medium ${res.ok ? "text-emerald-600" : "text-red-600"}`}>
                    {res.ok ? "✓ Đã ghi" : `✗ ${res.reason ?? "Lỗi"}`}
                  </p>
                )}
              </div>
            );
          })}

          {entries.length > 0 && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3.5 text-base font-semibold text-white shadow-sm transition active:scale-[0.99] disabled:opacity-50"
            >
              {submitting && <Spinner />}
              {submitting ? "Đang gửi..." : "Gửi tất cả vào Google Sheet"}
            </button>
          )}

          {results && (
            <p className="text-center text-sm font-medium text-slate-600">
              Đã ghi {results.filter((r) => r.ok).length}/{results.length} ngày.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CameraIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin text-current" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
