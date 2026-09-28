import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { q } from '../db.js';
import { config } from '../config.js';
import { h, badRequest, now } from '../lib/util.js';
import { requireUser } from '../auth.js';

const storage = multer.diskStorage({
  destination: config.uploadDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase().replace(/[^.\w]/g, '').slice(0, 10);
    cb(null, crypto.randomBytes(16).toString('hex') + ext);
  },
});
const upload = multer({ storage, limits: { fileSize: config.maxUploadBytes } });

const r = Router();
r.use(requireUser);

r.post(
  '/',
  upload.single('file'),
  h((req, res) => {
    if (!req.file) throw badRequest('No file uploaded');
    const id = crypto.randomUUID();
    q.run(
      'INSERT INTO uploads (id, user_id, filename, mime, size, stored_as, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      req.user.id,
      req.file.originalname.slice(0, 300),
      req.file.mimetype,
      req.file.size,
      req.file.filename,
      now(),
    );
    res.status(201).json({ id, url: '/uploads/' + req.file.filename, name: req.file.originalname, size: req.file.size, mime: req.file.mimetype });
  }),
);

export default r;
