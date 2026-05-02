import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import multer from "multer";

export const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve(process.cwd(), "uploads");

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename(_req, file, cb) {
    const id = crypto.randomBytes(12).toString("hex");
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
    cb(null, `${Date.now()}-${id}${ext}`);
  },
});

export const uploadQuickReplyMedia = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ok =
      file.mimetype.startsWith("image/") ||
      file.mimetype.startsWith("video/") ||
      file.mimetype.startsWith("audio/");
    if (!ok) return cb(new Error("Only image/video/audio are allowed"));
    cb(null, true);
  },
});

const documentExtensions = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".txt",
  ".csv",
]);

function isAllowedChatUpload(file: Express.Multer.File) {
  if (
    file.mimetype.startsWith("image/") ||
    file.mimetype.startsWith("video/") ||
    file.mimetype.startsWith("audio/")
  ) {
    return true;
  }

  const ext = path.extname(file.originalname).toLowerCase();
  if (documentExtensions.has(ext)) return true;

  return [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv",
  ].includes(file.mimetype);
}

export const uploadChatMedia = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024, files: 10 },
  fileFilter(_req, file, cb) {
    const ok = isAllowedChatUpload(file);
    if (!ok) return cb(new Error("Unsupported file type"));
    cb(null, true);
  },
});

export function publicUrlFor(storedPath: string): string {
  const rel = path.relative(UPLOADS_DIR, storedPath);
  return `/uploads/${rel.split(path.sep).join("/")}`;
}
