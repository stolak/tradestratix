import multer from 'multer';
import { httpError } from '../utils/helpers.js';

/** In-memory upload for proof photos / PDFs (forwarded to S3). */
export const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'application/pdf'
    ].includes(file.mimetype);
    if (!ok) {
      cb(httpError(400, 'Proof file must be a JPEG, PNG, WebP, GIF or PDF') as any);
      return;
    }
    cb(null, true);
  }
});
