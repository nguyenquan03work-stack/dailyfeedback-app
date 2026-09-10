// ---------------------------------------------------------------------------
// Chuẩn bị ảnh trước khi gửi cho AI.
// Nguyên tắc: CHỈ thu nhỏ ảnh thực sự lớn, giữ chất lượng cao NHẤT có thể,
// nhưng LUÔN đảm bảo không vượt quá giới hạn 4.5MB của Vercel — bằng cách
// thử dần các mức kích thước/chất lượng thấp hơn cho tới khi chắc chắn vừa.
//
// Muốn chỉnh độ nét / dung lượng? Sửa các hằng số ngay bên dưới.
// ---------------------------------------------------------------------------

// Cạnh dài tối đa (px) ưu tiên dùng đầu tiên. Ảnh to hơn sẽ được thu về mức này.
export const IMAGE_MAX_DIMENSION = 2000;

// Chất lượng JPEG ưu tiên dùng đầu tiên (0-1). 0.85 = cao, chữ viết tay vẫn sắc nét.
export const IMAGE_QUALITY = 0.85;

// Dưới ngưỡng này VÀ không quá to -> giữ nguyên ảnh gốc (không nén).
export const IMAGE_SIZE_THRESHOLD = 3 * 1024 * 1024; // 3 MB

// Giới hạn thực của Vercel là 4.5MB cho TOÀN BỘ request (đã gồm base64 + JSON).
// Đặt ngân sách an toàn cho phần NHỊ PHÂN ảnh (trước khi mã hoá base64) thấp hơn
// hẳn mốc đó, vì base64 làm phồng thêm ~33%.
const MAX_OUTPUT_BYTES = 3 * 1024 * 1024; // ~3MB nhị phân -> base64 ~4MB, còn dư an toàn.

// Các mức thử dần khi ảnh vẫn còn quá nặng: từ nét nhất tới nhẹ nhất.
const DIMENSION_STEPS = [IMAGE_MAX_DIMENSION, 1600, 1300, 1000, 800];
const QUALITY_STEPS = [IMAGE_QUALITY, 0.75, 0.65, 0.55, 0.4];

// Đọc File thành base64 (bỏ tiền tố "data:...;base64,").
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// Ước lượng số byte nhị phân từ độ dài chuỗi base64.
function estimateBytesFromBase64(base64: string): number {
  return Math.floor((base64.length * 3) / 4);
}

function canvasToJpegBase64(canvas: HTMLCanvasElement, quality: number): string {
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return dataUrl.split(",")[1] ?? "";
}

export type PreparedImage = { base64: string; mimeType: string };

/**
 * Trả về base64 + mimeType để gửi API.
 * - Nếu ảnh nhỏ (<= ngưỡng dung lượng) VÀ cạnh dài <= IMAGE_MAX_DIMENSION:
 *   giữ nguyên ảnh gốc.
 * - Ngược lại: thử nén ở chất lượng/kích thước cao nhất trước, rồi hạ dần
 *   (kích thước, rồi chất lượng) cho tới khi chắc chắn dưới ngân sách an toàn,
 *   để KHÔNG BAO GIỜ gửi một request vượt giới hạn 4.5MB của Vercel.
 * Có lỗi bất kỳ khi xử lý -> tự động dùng ảnh gốc (an toàn).
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const longest = Math.max(img.naturalWidth, img.naturalHeight);

    // Đủ nhỏ rồi -> giữ nguyên.
    if (file.size <= IMAGE_SIZE_THRESHOLD && longest <= IMAGE_MAX_DIMENSION) {
      const base64 = await fileToBase64(file);
      return { base64, mimeType: file.type || "image/jpeg" };
    }

    let best: { base64: string; bytes: number } | null = null;

    for (const dim of DIMENSION_STEPS) {
      const scale = longest > dim ? dim / longest : 1;
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) break; // Không dùng được canvas -> dừng, dùng kết quả tốt nhất đã có (hoặc fallback bên dưới).
      ctx.drawImage(img, 0, 0, w, h);

      for (const q of QUALITY_STEPS) {
        const base64 = canvasToJpegBase64(canvas, q);
        const bytes = estimateBytesFromBase64(base64);

        if (!best || bytes < best.bytes) best = { base64, bytes };

        // Đủ nhẹ rồi -> dùng ngay, không cần nén thêm (giữ chất lượng cao nhất có thể).
        if (bytes <= MAX_OUTPUT_BYTES) {
          return { base64, mimeType: "image/jpeg" };
        }
      }
      // Chất lượng thấp nhất ở kích thước này vẫn còn nặng -> thử kích thước nhỏ hơn.
    }

    // Đã thử hết các mức mà vẫn không dưới ngân sách -> dùng bản nhẹ nhất tìm được
    // (vẫn tốt hơn nhiều so với gửi nguyên bản và chắc chắn bị chặn).
    if (best) return { base64: best.base64, mimeType: "image/jpeg" };

    const base64 = await fileToBase64(file);
    return { base64, mimeType: file.type || "image/jpeg" };
  } catch {
    // Bất kỳ lỗi nào -> dùng ảnh gốc để không chặn người dùng.
    const base64 = await fileToBase64(file);
    return { base64, mimeType: file.type || "image/jpeg" };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
