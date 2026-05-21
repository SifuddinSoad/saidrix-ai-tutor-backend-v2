// ===========================================
// Upload middleware — multipart project uploads
// Two flavours:
//   - uploadZip:    legacy single .zip archive
//   - uploadFolder: many individual files (webkitdirectory pick).
//                   Each file's relative path is sent under field
//                   "paths" as a JSON array, index-matched with req.files.
// Memory storage; we build the zip server-side and forward to R2.
// ===========================================

import multer from "multer";
import { MAX_ZIP_BYTES, MAX_FILE_BYTES } from "../config/review.config.js";

const storage = multer.memoryStorage();

function zipFilter(req, file, cb) {
  const okMime =
    file.mimetype === "application/zip" ||
    file.mimetype === "application/x-zip-compressed" ||
    file.mimetype === "application/octet-stream";
  const okExt = /\.zip$/i.test(file.originalname || "");
  if (okMime && okExt) return cb(null, true);
  return cb(new Error("Only .zip files are accepted"));
}

export const uploadZip = multer({
  storage,
  limits: { fileSize: MAX_ZIP_BYTES, files: 1 },
  fileFilter: zipFilter,
}).single("file");

// Folder upload: many files. Per-file cap is generous (binaries get
// filtered later); total payload capped at MAX_ZIP_BYTES; max 1000 files
// to keep memory predictable.
export const uploadFolder = multer({
  storage,
  limits: {
    fileSize: Math.max(MAX_FILE_BYTES * 20, 5 * 1024 * 1024), // 5 MB / file
    files: 1000,
    fieldSize: 2 * 1024 * 1024, // for the paths JSON
  },
}).array("files", 1000);

export default uploadZip;
