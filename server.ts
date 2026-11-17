import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';

const PORT = Number(process.env.PORT) || 3000;
const MAX_PDF_BYTES = 250 * 1024 * 1024; // 250 MB
const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB chunks (under Cloud Run 32 MB limit)
const DEFAULT_PROOF_DIGEST_B64 = 'NYixg8m6D55ww5bflL1j5si5a9Yb3lurTyAKeAOKDEs=';
const STORAGE_ROOT = path.resolve(process.cwd(), 'uploads', 'lesson-pdfs');
const TMP_ROOT = path.resolve(process.cwd(), 'uploads', '.tmp');

fs.mkdirSync(STORAGE_ROOT, { recursive: true });
fs.mkdirSync(TMP_ROOT, { recursive: true });

interface FirebaseConfig {
  projectId?: string;
  apiKey?: string;
  firestoreDatabaseId?: string;
}

function loadFirebaseConfig(): FirebaseConfig {
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    const raw = fs.readFileSync(cfgPath, 'utf8');
    return JSON.parse(raw) as FirebaseConfig;
  } catch {
    return {};
  }
}

const firebaseConfig = loadFirebaseConfig();

let cachedProofDigest = '';
let cachedProofFetchedAt = 0;

async function fetchActiveProofDigestB64(forceRefresh = false): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && cachedProofDigest && now - cachedProofFetchedAt < 15_000) {
    return cachedProofDigest;
  }

  const { projectId, apiKey, firestoreDatabaseId } = firebaseConfig;
  if (!projectId || !apiKey || !firestoreDatabaseId) {
    return DEFAULT_PROOF_DIGEST_B64;
  }

  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(firestoreDatabaseId)}/documents/admin_config/security?key=${encodeURIComponent(apiKey)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (resp.status === 404) {
      cachedProofDigest = DEFAULT_PROOF_DIGEST_B64;
      cachedProofFetchedAt = now;
      return cachedProofDigest;
    }
    if (resp.ok) {
      const json = (await resp.json()) as {
        fields?: { proofDigestB64?: { stringValue?: string } };
      };
      const digest = json?.fields?.proofDigestB64?.stringValue;
      cachedProofDigest =
        typeof digest === 'string' && digest.length === 44
          ? digest
          : DEFAULT_PROOF_DIGEST_B64;
      cachedProofFetchedAt = now;
      return cachedProofDigest;
    }
  } catch {
    // Fallback to cached or default
  }
  return cachedProofDigest || DEFAULT_PROOF_DIGEST_B64;
}

function safeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function verifyAdminSecret(rawSecret: unknown): Promise<boolean> {
  const secret = typeof rawSecret === 'string' ? rawSecret.trim().toLowerCase() : '';
  if (!/^[a-f0-9]{64}$/.test(secret)) return false;

  const candidateDigest = crypto.createHash('sha256').update(secret, 'utf8').digest('base64');
  const expected = await fetchActiveProofDigestB64(false);
  if (safeEqualString(candidateDigest, expected)) return true;

  // Retry with forced refresh in case admin password was just updated
  const freshExpected = await fetchActiveProofDigestB64(true);
  return safeEqualString(candidateDigest, freshExpected);
}

function sanitizePdfFileName(raw: unknown): string {
  const cleaned = String(raw || 'ders-notu.pdf')
    .replace(/[\r\n"/\\:*?<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 110);
  if (!cleaned) return 'ders-notu.pdf';
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`;
}

function cleanupStaleTmpDirs() {
  try {
    const entries = fs.readdirSync(TMP_ROOT, { withFileTypes: true });
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const dirPath = path.join(TMP_ROOT, ent.name);
      try {
        const st = fs.statSync(dirPath);
        if (st.mtimeMs < cutoff) {
          fs.rmSync(dirPath, { recursive: true, force: true });
        }
      } catch {
        // Ignore individual cleanup error
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

interface UploadMeta {
  fileId: string;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  createdAt: number;
}

interface StoredFileMeta {
  fileId: string;
  fileName: string;
  size: number;
  mimeType: string;
  createdAt: number;
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');

  const jsonParser = express.json({ limit: '128kb' });
  const rawChunkParser = express.raw({
    type: 'application/octet-stream',
    limit: '4mb',
  });

  app.post('/api/lesson-pdf/init', jsonParser, async (req: Request, res: Response) => {
    const ok = await verifyAdminSecret(req.header('x-admin-secret'));
    if (!ok) {
      res.status(403).json({ ok: false, error: 'ADMIN_AUTH_FAILED' });
      return;
    }

    const body = (req.body || {}) as {
      fileName?: unknown;
      fileSize?: unknown;
      totalChunks?: unknown;
    };
    const fileSize = Number(body.fileSize);
    const totalChunks = Math.trunc(Number(body.totalChunks));

    if (!Number.isFinite(fileSize) || fileSize < 1 || fileSize > MAX_PDF_BYTES) {
      res.status(400).json({ ok: false, error: 'INVALID_FILE_SIZE' });
      return;
    }
    if (!Number.isFinite(totalChunks) || totalChunks < 1 || totalChunks > 200) {
      res.status(400).json({ ok: false, error: 'INVALID_CHUNK_COUNT' });
      return;
    }

    const fileName = sanitizePdfFileName(body.fileName);
    const uploadId = `up_${crypto.randomBytes(12).toString('hex')}`;
    const fileId = `pdf_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const tmpDir = path.join(TMP_ROOT, uploadId);

    fs.mkdirSync(tmpDir, { recursive: true });
    const meta: UploadMeta = {
      fileId,
      fileName,
      fileSize,
      totalChunks,
      createdAt: Date.now(),
    };
    fs.writeFileSync(path.join(tmpDir, 'meta.json'), JSON.stringify(meta), 'utf8');

    setImmediate(cleanupStaleTmpDirs);

    res.json({
      ok: true,
      uploadId,
      fileId,
      chunkSize: CHUNK_SIZE,
      maxBytes: MAX_PDF_BYTES,
    });
  });

  app.post('/api/lesson-pdf/chunk', rawChunkParser, async (req: Request, res: Response) => {
    const ok = await verifyAdminSecret(req.header('x-admin-secret'));
    if (!ok) {
      res.status(403).json({ ok: false, error: 'ADMIN_AUTH_FAILED' });
      return;
    }

    const uploadId = String(req.header('x-upload-id') || req.query.uploadId || '').trim();
    const chunkIndex = Math.trunc(
      Number(req.header('x-chunk-index') ?? req.query.chunkIndex ?? -1),
    );

    if (!/^up_[a-f0-9]{24}$/.test(uploadId)) {
      res.status(400).json({ ok: false, error: 'INVALID_UPLOAD_ID' });
      return;
    }

    const tmpDir = path.join(TMP_ROOT, uploadId);
    const metaPath = path.join(tmpDir, 'meta.json');
    if (!fs.existsSync(metaPath)) {
      res.status(404).json({ ok: false, error: 'UPLOAD_NOT_FOUND' });
      return;
    }

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as UploadMeta;
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= meta.totalChunks) {
      res.status(400).json({ ok: false, error: 'INVALID_CHUNK_INDEX' });
      return;
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0 || req.body.length > CHUNK_SIZE + 4096) {
      res.status(400).json({ ok: false, error: 'INVALID_CHUNK_PAYLOAD' });
      return;
    }

    const chunkPath = path.join(tmpDir, `chunk_${chunkIndex}`);
    fs.writeFileSync(chunkPath, req.body);

    res.json({ ok: true, chunkIndex, bytes: req.body.length });
  });

  app.post('/api/lesson-pdf/complete', jsonParser, async (req: Request, res: Response) => {
    const ok = await verifyAdminSecret(req.header('x-admin-secret'));
    if (!ok) {
      res.status(403).json({ ok: false, error: 'ADMIN_AUTH_FAILED' });
      return;
    }

    const uploadId = String((req.body as { uploadId?: unknown })?.uploadId || '').trim();
    if (!/^up_[a-f0-9]{24}$/.test(uploadId)) {
      res.status(400).json({ ok: false, error: 'INVALID_UPLOAD_ID' });
      return;
    }

    const tmpDir = path.join(TMP_ROOT, uploadId);
    const metaPath = path.join(tmpDir, 'meta.json');
    if (!fs.existsSync(metaPath)) {
      res.status(404).json({ ok: false, error: 'UPLOAD_NOT_FOUND' });
      return;
    }

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as UploadMeta;
    let assembledSize = 0;
    for (let i = 0; i < meta.totalChunks; i++) {
      const cp = path.join(tmpDir, `chunk_${i}`);
      if (!fs.existsSync(cp)) {
        res.status(400).json({ ok: false, error: `MISSING_CHUNK_${i}` });
        return;
      }
      assembledSize += fs.statSync(cp).size;
      if (assembledSize > MAX_PDF_BYTES) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        res.status(413).json({ ok: false, error: 'FILE_TOO_LARGE' });
        return;
      }
    }

    const partPath = path.join(STORAGE_ROOT, `${meta.fileId}.pdf.part`);
    const finalPdfPath = path.join(STORAGE_ROOT, `${meta.fileId}.pdf`);
    const finalMetaPath = path.join(STORAGE_ROOT, `${meta.fileId}.json`);

    try {
      const writeStream = fs.createWriteStream(partPath);
      await new Promise<void>((resolve, reject) => {
        writeStream.on('error', reject);
        writeStream.on('finish', () => resolve());
        void (async () => {
          try {
            for (let i = 0; i < meta.totalChunks; i++) {
              const chunkBuf = fs.readFileSync(path.join(tmpDir, `chunk_${i}`));
              if (!writeStream.write(chunkBuf)) {
                await new Promise<void>((drainResolve) => {
                  writeStream.once('drain', () => drainResolve());
                });
              }
            }
            writeStream.end();
          } catch (err) {
            writeStream.destroy();
            reject(err);
          }
        })();
      });

      fs.renameSync(partPath, finalPdfPath);
      const storedMeta: StoredFileMeta = {
        fileId: meta.fileId,
        fileName: meta.fileName,
        size: assembledSize,
        mimeType: 'application/pdf',
        createdAt: Date.now(),
      };
      fs.writeFileSync(finalMetaPath, JSON.stringify(storedMeta), 'utf8');
      fs.rmSync(tmpDir, { recursive: true, force: true });

      res.json({
        ok: true,
        fileId: meta.fileId,
        url: `/api/lesson-pdf/${meta.fileId}`,
        fileName: meta.fileName,
        size: assembledSize,
      });
    } catch (err) {
      fs.rmSync(partPath, { force: true });
      console.error('PDF assemble error:', err);
      res.status(500).json({ ok: false, error: 'ASSEMBLE_FAILED' });
    }
  });

  app.get('/api/lesson-pdf/:fileId', (req: Request, res: Response) => {
    const fileId = String(req.params.fileId || '').trim();
    if (!/^[a-zA-Z0-9_-]{8,96}$/.test(fileId)) {
      res.status(400).send('Invalid file ID');
      return;
    }

    const pdfPath = path.join(STORAGE_ROOT, `${fileId}.pdf`);
    const metaPath = path.join(STORAGE_ROOT, `${fileId}.json`);
    if (!fs.existsSync(pdfPath)) {
      res.status(404).send('PDF not found');
      return;
    }

    const stat = fs.statSync(pdfPath);
    let fileName = `${fileId}.pdf`;
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as StoredFileMeta;
        if (meta.fileName) fileName = sanitizePdfFileName(meta.fileName);
      } catch {
        // Fallback filename
      }
    }

    const isDownload = req.query.download === '1' || req.query.download === 'true';
    const disposition = isDownload ? 'attachment' : 'inline';
    const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '') || 'lesson.pdf';
    const encodedName = encodeURIComponent(fileName);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodedName}`,
    );

    const rangeHeader = req.headers.range;
    if (rangeHeader && /^bytes=\d*-\d*$/.test(rangeHeader)) {
      const [rawStart, rawEnd] = rangeHeader.replace('bytes=', '').split('-');
      const start = rawStart ? parseInt(rawStart, 10) : 0;
      const end = rawEnd ? Math.min(parseInt(rawEnd, 10), stat.size - 1) : stat.size - 1;
      if (start >= stat.size || end < start) {
        res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
        return;
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      fs.createReadStream(pdfPath, { start, end }).pipe(res);
      return;
    }

    res.setHeader('Content-Length', String(stat.size));
    fs.createReadStream(pdfPath).pipe(res);
  });

  app.delete('/api/lesson-pdf/:fileId', async (req: Request, res: Response) => {
    const ok = await verifyAdminSecret(req.header('x-admin-secret'));
    if (!ok) {
      res.status(403).json({ ok: false, error: 'ADMIN_AUTH_FAILED' });
      return;
    }

    const fileId = String(req.params.fileId || '').trim();
    if (!/^[a-zA-Z0-9_-]{8,96}$/.test(fileId)) {
      res.status(400).json({ ok: false, error: 'INVALID_FILE_ID' });
      return;
    }

    fs.rmSync(path.join(STORAGE_ROOT, `${fileId}.pdf`), { force: true });
    fs.rmSync(path.join(STORAGE_ROOT, `${fileId}.json`), { force: true });
    res.json({ ok: true });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req: Request, res: Response, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
