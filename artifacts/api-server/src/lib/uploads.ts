import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import multer from "multer";
import type { Response } from "express";

export const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve(process.cwd(), "uploads");

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const activeContentExtensions = new Set([
  ".html",
  ".htm",
  ".js",
  ".mjs",
  ".svg",
  ".xhtml",
  ".xml",
]);

const activeContentMimeTypes = new Set([
  "application/javascript",
  "application/ecmascript",
  "application/json",
  "application/xhtml+xml",
  "application/xml",
  "image/svg+xml",
  "text/ecmascript",
  "text/html",
  "text/javascript",
  "text/xml",
]);

function cleanMimeType(mimeType: string) {
  return mimeType.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
}

function uploadExtension(file: Express.Multer.File) {
  return path.extname(file.originalname).toLowerCase();
}

function isActiveContentUpload(file: Express.Multer.File) {
  return activeContentExtensions.has(uploadExtension(file)) || activeContentMimeTypes.has(cleanMimeType(file.mimetype));
}

function uploadRejected(message: string) {
  const err = new Error(message) as Error & { status?: number };
  err.status = 400;
  return err;
}

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
    const ok = isAllowedChatUpload(file);
    if (!ok) return cb(uploadRejected("Unsupported file type"));
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
  if (isActiveContentUpload(file)) return false;
  const mimeType = cleanMimeType(file.mimetype);
  if (
    mimeType.startsWith("image/") ||
    mimeType.startsWith("video/") ||
    mimeType.startsWith("audio/")
  ) {
    return true;
  }

  const ext = uploadExtension(file);
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
  ].includes(mimeType);
}

export const uploadChatMedia = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024, files: 10 },
  fileFilter(_req, file, cb) {
    const ok = isAllowedChatUpload(file);
    if (!ok) return cb(uploadRejected("Unsupported file type"));
    cb(null, true);
  },
});

export const uploadChatNoteFile = multer({
  storage,
  limits: { fileSize: 75 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    if (!isAllowedChatUpload(file)) return cb(uploadRejected("Unsupported file type"));
    cb(null, true);
  },
});

export const uploadAgentTrainingFiles = multer({
  storage,
  limits: { fileSize: 75 * 1024 * 1024, files: 40 },
  fileFilter(_req, file, cb) {
    if (isActiveContentUpload(file)) return cb(uploadRejected("Active content uploads are not allowed"));
    const ext = uploadExtension(file);
    const mimeType = cleanMimeType(file.mimetype);
    const ok =
      mimeType.startsWith("image/") ||
      mimeType.startsWith("video/") ||
      [
        ".pdf",
        ".doc",
        ".docx",
        ".txt",
        ".csv",
        ".md",
      ].includes(ext) ||
      [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
        "text/csv",
        "text/markdown",
      ].includes(mimeType);
    if (!ok) return cb(uploadRejected("Unsupported training file type"));
    cb(null, true);
  },
});

export function publicUrlFor(storedPath: string): string {
  const rel = path.relative(UPLOADS_DIR, path.resolve(storedPath));
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Stored path is outside upload directory");
  }
  return `/uploads/${rel.split(path.sep).map(encodeURIComponent).join("/")}`;
}

export function setUploadStaticHeaders(res: Response) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  const contentType = String(res.getHeader("Content-Type") || "").toLowerCase();
  const inlineSafe =
    contentType.startsWith("image/") ||
    contentType.startsWith("video/") ||
    contentType.startsWith("audio/") ||
    contentType.startsWith("application/pdf");
  if (!inlineSafe) {
    res.setHeader("Content-Disposition", "attachment");
  }
}
