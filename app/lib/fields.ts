// ---------------------------------------------------------------------------
// SINGLE SOURCE OF TRUTH cho các trường dữ liệu của app.
// Muốn thêm / bớt / đổi tên trường? CHỈ sửa mảng FIELDS bên dưới.
// Ba nơi sẽ tự đổi theo: prompt gửi AI, ô nhập trên giao diện,
// và thứ tự cột ghi vào Google Sheet (theo đúng thứ tự trong mảng này).
//
// Lưu ý khi đổi: số cột mỗi ngày trong Sheet phải bằng số trường ở đây,
// và thứ tự cột (dateColIndex, +1, +2, ...) khớp thứ tự mảng.
// ---------------------------------------------------------------------------

export type FieldType = "rating" | "text" | "textarea";

export interface FieldDef {
  key: string; // khóa dữ liệu (không dấu, dùng nội bộ + trong JSON của AI)
  label: string; // nhãn hiển thị trên giao diện (tiếng Việt)
  type: FieldType; // kiểu ô nhập
  options?: string[]; // chỉ dùng cho type "rating"
  placeholder?: string;
  hint: string; // mô tả cho AI biết cần trích xuất gì (tiếng Anh, gửi trong prompt)
}

export const FIELDS: FieldDef[] = [
  {
    key: "danh_gia_nhanh",
    label: "Đánh giá nhanh",
    type: "rating",
    options: ["Đạt", "Chưa đạt"],
    hint: 'The overall quick rating. Must be exactly "Đạt", "Chưa đạt", or an empty string if not clear.',
  },
  {
    key: "phan_tram",
    label: "Phần trăm hoàn thành",
    type: "text",
    placeholder: "VD: 70%",
    hint: 'The completion percentage, e.g. "70%". Empty string if not present.',
  },
  {
    key: "noi_dung",
    label: "Nội dung học",
    type: "textarea",
    placeholder: "- Timo\n- IGCSE\n- Algebra",
    hint: 'The specific learning content / notes, e.g. "- Timo", "- IGCSE", "- Algebra". Correct spelling mistakes. Empty string if not present.',
  },
];

export const FIELD_KEYS: string[] = FIELDS.map((f) => f.key);

// Một entry (một ngày) = ngày + giá trị của từng trường.
export type EntryValues = Record<string, string>;

export function emptyValues(): EntryValues {
  const v: EntryValues = {};
  for (const f of FIELDS) v[f.key] = "";
  return v;
}
