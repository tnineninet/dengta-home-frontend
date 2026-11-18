// iPhone Photos may hand the file input a JPEG rendition or the original HEIC.
// Keep PNG/WebP untouched so the server still validates transparency and animation.
const byExtension = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif" };
const maxUpload = 12 * 1024 * 1024;
export const PRIVATE_PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";

export function assertPrivatePhotoActive(signal) {
  // iOS 15 supports AbortController, but does not always implement throwIfAborted or reason.
  if (signal?.aborted) throw signal.reason || new DOMException("已取消照片处理。", "AbortError");
}

export async function preparePrivatePhoto(file, purpose, signal) {
  assertPrivatePhotoActive(signal);
  if (!file?.size) throw new Error("图片为空，请重新从照片或文件中选择。");
  const ext = String(file.name || "").split(".").pop().toLowerCase();
  const mime = (!file.type || file.type === "application/octet-stream" ? byExtension[ext] : file.type) || "";
  if (mime === "image/heic-sequence" || mime === "image/heif-sequence") {
    throw new Error("请选择静态照片；请先把这组 HEIC 照片导出为一张 JPEG。");
  }
  const heic = mime === "image/heic" || mime === "image/heif";
  const name = file.name || "photo";
  if (mime === "image/png" || mime === "image/webp") {
    if (file.size > maxUpload) throw new Error("图片超过 12 MB，请缩小后再选择。");
    return mime === file.type ? file : new File([file], name, { type: mime });
  }
  if (!heic && mime !== "image/jpeg") throw new Error("请选择 JPG、PNG、WebP 或 HEIC 静态照片。");
  if (file.size > 32 * 1024 * 1024) throw new Error("原始照片超过 32 MB，请缩小后再选择。");

  // Image.decode also accepts GIF, SVG, etc. Reject renamed content before flattening it into JPEG.
  const header = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  assertPrivatePhotoActive(signal);
  const jpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const fourcc = offset => String.fromCharCode(...header.subarray(offset, offset + 4));
  const brands = [];
  if (fourcc(4) === "ftyp") {
    const boxSize = new DataView(header.buffer).getUint32(0);
    for (let offset = 8; offset + 4 <= Math.min(boxSize, header.length); offset += 4) {
      if (offset !== 12) brands.push(fourcc(offset));
    }
  }
  if (heic && brands.some(brand => ["msf1", "hevc", "hevx", "hevm", "hevs"].includes(brand))) {
    throw new Error("请选择静态照片；请先把这组 HEIC 照片导出为一张 JPEG。");
  }
  if (!(heic ? jpeg || brands.some(brand => ["heic", "heix", "heim", "heis", "mif1"].includes(brand)) : jpeg)) {
    throw new Error(heic ? "无法读取这张 HEIC 照片，请导出为 JPEG 后重试。" : "无法读取这张照片，请重新选择或导出为 JPEG。");
  }
  const image = new Image();
  const url = URL.createObjectURL(file);
  let canvas;
  // Release a pending decode when the settings sheet closes or the account changes.
  const cancel = () => image.removeAttribute("src");
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    image.src = url;
    try { await image.decode(); }
    catch {
      assertPrivatePhotoActive(signal);
      throw new Error(heic ? "这个设备无法读取这张 HEIC 照片。请导出为 JPEG 后重试。" : "无法读取这张照片，请重新选择或导出为 JPEG。");
    }
    assertPrivatePhotoActive(signal);
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height) throw new Error("无法读取照片的尺寸，请重新选择。");
    const background = purpose === "chat_background";
    const pixels = width * height;
    if (!heic && file.size <= maxUpload && pixels <= (background ? 40e6 : 16e6)) {
      return mime === file.type ? file : new File([file], name, { type: mime });
    }
    const cropWidth = background ? width : Math.min(width, height);
    const cropHeight = background ? height : cropWidth;
    const scale = Math.min(1, (background ? 2560 : 1024) / Math.max(cropWidth, cropHeight));
    canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(cropWidth * scale));
    canvas.height = Math.max(1, Math.round(cropHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法处理照片，请先在相册中缩小再上传。");
    context.drawImage(image, (width - cropWidth) / 2, (height - cropHeight) / 2, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
    assertPrivatePhotoActive(signal);
    if (!blob?.size || blob.type !== "image/jpeg" || blob.size > maxUpload) {
      throw new Error("照片转换失败，请先导出较小的 JPEG 再上传。");
    }
    return new File([blob], `${name.replace(/\.[^.]+$/, "")}.jpg`, { type: blob.type });
  } finally {
    signal?.removeEventListener("abort", cancel);
    image.removeAttribute("src");
    URL.revokeObjectURL(url);
    if (canvas) canvas.width = canvas.height = 0;
  }
}
