import sharp from "sharp";
import { getConfig } from "./config";

const acceptedFormats = new Map([
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);

export class UploadValidationError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export type ValidatedUpload = {
  buffer: Buffer;
  originalName: string;
  mediaType: string;
  byteSize: number;
  width: number;
  height: number;
  extension: string;
};

export async function validateUpload(value: FormDataEntryValue | null, label: string): Promise<ValidatedUpload> {
  if (!(value instanceof File) || value.size === 0) throw new UploadValidationError("missing_file", `请选择${label}。`);
  if (value.size > getConfig().UPLOAD_MAX_BYTES) throw new UploadValidationError("file_too_large", `${label}超过上传大小限制，请压缩后重试。`);

  const buffer = Buffer.from(await value.arrayBuffer());
  try {
    const imageOptions = { failOn: "error" as const, limitInputPixels: 80_000_000 };
    const metadata = await sharp(buffer, imageOptions).metadata();
    const format = metadata.format;
    const mediaType = format ? acceptedFormats.get(format) : undefined;
    if (!format || !mediaType || !metadata.width || !metadata.height) throw new Error("unsupported image");
    await sharp(buffer, imageOptions).stats();
    return {
      buffer,
      originalName: value.name.slice(0, 255) || `${label}.${format}`,
      mediaType,
      byteSize: buffer.byteLength,
      width: metadata.width,
      height: metadata.height,
      extension: format === "jpeg" ? "jpg" : format,
    };
  } catch {
    throw new UploadValidationError("undecodable_file", `${label}不是可解码的 JPG、PNG 或 WebP 图片，请替换文件。`);
  }
}
