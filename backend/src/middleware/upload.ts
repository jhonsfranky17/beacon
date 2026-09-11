import multer from "multer";
import type { NextFunction, Request, RequestHandler, Response } from "express";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/**
 * build-spec §5.5 — image only, max ~8MB, in-memory (never touches disk;
 * uploaded straight to MinIO from the buffer).
 */
export const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Only image uploads are allowed"));
      return;
    }
    cb(null, true);
  },
});

/**
 * multer's own middleware calls next(err) on an oversized/wrong-type file,
 * which would otherwise fall through to Express's default 500 handler.
 * Wrap it so upload problems come back as a clean 400. Whether the field is
 * required at all is left to the route handler (req.file stays undefined,
 * no error, if the field is simply absent).
 */
export function singlePhotoUpload(fieldName: string): RequestHandler {
  const middleware = photoUpload.single(fieldName);
  return (req: Request, res: Response, next: NextFunction) => {
    middleware(req, res, (error: unknown) => {
      if (error) {
        const message = error instanceof Error ? error.message : "Invalid photo upload";
        res.status(400).json({ error: message });
        return;
      }
      next();
    });
  };
}
