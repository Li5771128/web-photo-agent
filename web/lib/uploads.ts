import sharp from "sharp";
import { getConfig } from "./config";

export type AssetRole = "reference" | "target";

const acceptedFormats = new Map([
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);

const rawMediaTypes: Record<string, string> = {
  dng: "image/x-adobe-dng",
  cr2: "image/x-canon-cr2",
  cr3: "image/x-canon-cr3",
  nef: "image/x-nikon-nef",
  arw: "image/x-sony-arw",
  raf: "image/x-fuji-raf",
  rw2: "image/x-panasonic-rw2",
  orf: "image/x-olympus-orf",
};

export const acceptedRawExtensions = new Set(Object.keys(rawMediaTypes));

export class UploadValidationError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export type ValidatedUpload = {
  buffer: Buffer;
  originalName: string;
  mediaType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  extension: string;
  isRaw: boolean;
};

function extensionOf(name: string): string {
  const lowerName = name.toLowerCase();
  const extension = lowerName.split(".").pop();
  return extension && extension !== lowerName ? extension : "";
}

function isTiff(buffer: Buffer): boolean {
  return buffer.length >= 4 && (
    buffer.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) ||
    buffer.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))
  );
}

function hasRawSignature(buffer: Buffer, extension: string): boolean {
  if (extension === "raf") return buffer.subarray(0, 16).toString("ascii") === "FUJIFILMCCD-RAW ";
  if (extension === "rw2") return buffer.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x55, 0x00]));
  if (extension === "orf") {
    const signature = buffer.subarray(0, 4).toString("ascii");
    return signature === "IIRO" || signature === "IIRS";
  }
  if (extension === "cr2") return isTiff(buffer) && buffer.subarray(8, 10).toString("ascii") === "CR";
  if (extension === "cr3") {
    return buffer.subarray(4, 8).toString("ascii") === "ftyp" && buffer.subarray(8, 32).toString("ascii").includes("crx");
  }
  return ["dng", "nef", "arw"].includes(extension) && isTiff(buffer);
}

export async function validateUpload(
  value: FormDataEntryValue | null,
  label: string,
  role: AssetRole,
): Promise<ValidatedUpload> {
  if (!(value instanceof File) || value.size === 0) throw new UploadValidationError("missing_file", `请选择${label}。`);

  const extension = extensionOf(value.name);
  const isRaw = acceptedRawExtensions.has(extension);
  if (isRaw && role !== "target") {
    throw new UploadValidationError("raw_reference_unsupported", "参考图 A 暂不支持 RAW，请选择 JPG、PNG 或 WebP。");
  }

  const maximumBytes = isRaw ? getConfig().RAW_UPLOAD_MAX_BYTES : getConfig().IMAGE_UPLOAD_MAX_BYTES;
  if (value.size > maximumBytes) {
    const maximumMb = Math.floor(maximumBytes / 1024 / 1024);
    throw new UploadValidationError("file_too_large", `${label}超过 ${maximumMb} MB 上传限制，请更换文件。`);
  }

  const buffer = Buffer.from(await value.arrayBuffer());
  if (isRaw) {
    if (!hasRawSignature(buffer, extension)) {
      throw new UploadValidationError("raw_signature_invalid", `${label}的扩展名与 RAW 文件内容不匹配，请更换文件。`);
    }
    return {
      buffer,
      originalName: value.name.slice(0, 255) || `${label}.${extension}`,
      mediaType: rawMediaTypes[extension],
      byteSize: buffer.byteLength,
      width: null,
      height: null,
      extension,
      isRaw: true,
    };
  }

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
      isRaw: false,
    };
  } catch {
    throw new UploadValidationError("undecodable_file", `${label}不是可解码的 JPG、PNG 或 WebP 图片，请替换文件。`);
  }
}
