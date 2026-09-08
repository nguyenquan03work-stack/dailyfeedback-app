// ---------------------------------------------------------------------------
// Chuẩn bị ảnh trước khi gửi cho AI.
// Nguyên tắc: CHỈ thu nhỏ ảnh thực sự lớn, giữ chất lượng cao.
// Ảnh đã nhỏ/nhẹ sẵn -> giữ nguyên, không đụng tới.
//
// Muốn chỉnh độ nét / dung lượng? Sửa 3 hằng số ngay bên dưới.
// ---------------------------------------------------------------------------

// Cạnh dài tối đa (px). Ảnh to hơn sẽ được thu về mức này. Tăng lên nếu cần nét hơn.
export const IMAGE_MAX_DIMENSION = 2000;

// Chất lượng JPEG khi phải nén (0-1). 0.85 = cao, chữ viết tay vẫn sắc nét.
export const IMAGE_QUALITY = 0.85;

// Dưới ngưỡng này VÀ không quá to -> giữ nguyên ảnh gốc (không nén).
export const IMAGE_SIZE_THRESHOLD = 3 * 1024 * 1024; // 3 MB

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

export type PreparedImage = { base64: string; mimeType: string };

/**
 * Trả về base64 + mimeType để gửi API.
 * - Nếu ảnh nhỏ (<= ngưỡng dung lượng) VÀ cạnh dài <= IMAGE_MAX_DIMENSION:
 *   giữ nguyên ảnh gốc.
 * - Ngược lại: thu nhỏ về IMAGE_MAX_DIMENSION (chỉ thu nhỏ, không phóng to),
 *   xuất JPEG chất lượng cao.
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

    // Cần thu nhỏ.
    const scale = longest > IMAGE_MAX_DIMENSION ? IMAGE_MAX_DIMENSION / longest : 1;
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      // Không dùng được canvas -> fallback ảnh gốc.
      const base64 = await fileToBase64(file);
      return { base64, mimeType: file.type || "image/jpeg" };
    }
    ctx.drawImage(img, 0, 0, w, h);

    const dataUrl = canvas.toDataURL("image/jpeg", IMAGE_QUALITY);
    const base64 = dataUrl.split(",")[1] ?? "";
    return { base64, mimeType: "image/jpeg" };
  } catch {
    // Bất kỳ lỗi nào -> dùng ảnh gốc để không chặn người dùng.
    const base64 = await fileToBase64(file);
    return { base64, mimeType: file.type || "image/jpeg" };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
