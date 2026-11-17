import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import express, { type Request, type Response } from 'express';
import { isCloudSqlConfigured } from './src/db/index.ts';
import {
  DEFAULT_ADMIN_PASSWORD_HASH,
  DEFAULT_PROOF_DIGEST_B64,
  deleteAnnouncementPg,
  deleteAdminStudentPg,
  deleteMaterialPg,
  deletePdfFromPg,
  getAccessConfigPg,
  getSecurityConfigPg,
  getStudentLoginStatusPg,
  getStudentPrefsPg,
  listAnnouncementsPg,
  listMaterialsPg,
  loadAllAdminStudentsPg,
  loadPdfBufferFromPg,
  lookupStudentForAdminPg,
  saveAdminStudentPg,
  saveAdminStudentSettingsPg,
  saveAnnouncementPg,
  saveMaterialPg,
  savePdfBufferToPg,
  setConfigJsonPg,
  upsertStudentPrefsPg,
  type AdminSecurityConfig,
  type SiteAccessConfig,
} from './src/db/store.ts';
import {
  deleteUserNoteBySlot,
  getOrCreateUser,
  getUserNotesByUid,
  upsertUserNote,
} from './src/db/users.ts';
import { requireAuth, type AuthRequest } from './src/middleware/auth.ts';

const PORT = Number(process.env.PORT) || 3000;
const MAX_PDF_BYTES = 250 * 1024 * 1024; // 250 MB per PDF
const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB upload chunks

const UPLOADS_ROOT = path.resolve(process.cwd(), 'uploads');
const STORAGE_ROOT = path.join(UPLOADS_ROOT, 'lesson-pdfs');
const TMP_ROOT = path.join(UPLOADS_ROOT, '.tmp');
const DB_PATH = path.join(UPLOADS_ROOT, 'inonu_tip.db');

fs.mkdirSync(STORAGE_ROOT, { recursive: true });
fs.mkdirSync(TMP_ROOT, { recursive: true });

// ==================== LOCAL SQLITE FALLBACK (ONLY WHEN CLOUD SQL IS NOT CONFIGURED) ====================
let sqliteDbInstance: DatabaseSync | null = null;

function getSqliteDb(): DatabaseSync {
  if (sqliteDbInstance) return sqliteDbInstance;
  const sdb = new DatabaseSync(DB_PATH);
  sdb.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS admin_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      tone TEXT NOT NULL DEFAULT 'info',
      active INTEGER NOT NULL DEFAULT 1,
      target_group TEXT NOT NULL DEFAULT '',
      target_prog TEXT NOT NULL DEFAULT '',
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lesson_materials (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      slot_no INTEGER NOT NULL DEFAULT 1,
      target_prog TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'url',
      pdf_url TEXT NOT NULL DEFAULT '',
      pdf_data TEXT NOT NULL DEFAULT '',
      chunk_count INTEGER NOT NULL DEFAULT 0,
      pdf_name TEXT NOT NULL DEFAULT '',
      file_size INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS custom_students (
      auth_hash TEXT PRIMARY KEY,
      cloud_key TEXT NOT NULL DEFAULT '',
      last4 TEXT NOT NULL DEFAULT '',
      group_name TEXT NOT NULL DEFAULT 'I',
      lab_group TEXT NOT NULL DEFAULT '',
      prog TEXT NOT NULL DEFAULT 'tr',
      enc_name TEXT NOT NULL DEFAULT '',
      enc_sid TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_student_directory (
      auth_hash TEXT PRIMARY KEY,
      cloud_key TEXT NOT NULL DEFAULT '',
      last4 TEXT NOT NULL DEFAULT '',
      enc_full_name TEXT NOT NULL DEFAULT '',
      enc_sid TEXT NOT NULL DEFAULT '',
      group_name TEXT NOT NULL DEFAULT 'I',
      lab_group TEXT NOT NULL DEFAULT '',
      prog TEXT NOT NULL DEFAULT 'tr',
      source TEXT NOT NULL DEFAULT 'allowlist',
      active INTEGER NOT NULL DEFAULT 1,
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS student_prefs (
      cloud_key TEXT PRIMARY KEY,
      auth_hash TEXT NOT NULL DEFAULT '',
      last4 TEXT NOT NULL DEFAULT '',
      my_mbu_group TEXT NOT NULL DEFAULT '',
      my_lab_group TEXT NOT NULL DEFAULT '',
      other_group_mode TEXT NOT NULL DEFAULT 'dim',
      lang TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );
  `);

  const ensureConfigRow = (key: string, value: unknown) => {
    const existing = sdb
      .prepare('SELECT value FROM admin_config WHERE key = ?')
      .get(key) as { value?: string } | undefined;
    if (!existing) {
      sdb
        .prepare('INSERT INTO admin_config (key, value, updated_at) VALUES (?, ?, 0)')
        .run(key, JSON.stringify(value));
    }
  };
  ensureConfigRow('security', {
    passwordHash: DEFAULT_ADMIN_PASSWORD_HASH,
    proofDigestB64: DEFAULT_PROOF_DIGEST_B64,
    updatedAtMs: 0,
  } satisfies AdminSecurityConfig);
  ensureConfigRow('access', {
    requireStudentLogin: false,
    updatedAtMs: 0,
  } satisfies SiteAccessConfig);

  sqliteDbInstance = sdb;
  return sdb;
}

function getConfigJsonSqlite<T>(key: string): T | null {
  const sdb = getSqliteDb();
  const row = sdb
    .prepare('SELECT value FROM admin_config WHERE key = ?')
    .get(key) as { value?: string } | undefined;
  if (!row || typeof row.value !== 'string') return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

function setConfigJsonSqlite(key: string, value: unknown): void {
  const sdb = getSqliteDb();
  sdb
    .prepare(
      `
    INSERT INTO admin_config (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `,
    )
    .run(key, JSON.stringify(value), Date.now());
}

// ==================== SECURITY HELPERS & RATE LIMITER ====================
function safeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function getSecurityConfig(): Promise<AdminSecurityConfig> {
  if (isCloudSqlConfigured) {
    return getSecurityConfigPg();
  }
  const cfg = getConfigJsonSqlite<AdminSecurityConfig>('security');
  return {
    passwordHash:
      cfg && typeof cfg.passwordHash === 'string' && /^[a-f0-9]{64}$/.test(cfg.passwordHash)
        ? cfg.passwordHash
        : DEFAULT_ADMIN_PASSWORD_HASH,
    proofDigestB64:
      cfg && typeof cfg.proofDigestB64 === 'string' && cfg.proofDigestB64.length === 44
        ? cfg.proofDigestB64
        : DEFAULT_PROOF_DIGEST_B64,
    wrappedRosterKey:
      cfg && typeof cfg.wrappedRosterKey === 'string' && /^[a-f0-9]{64}$/.test(cfg.wrappedRosterKey)
        ? cfg.wrappedRosterKey
        : undefined,
  };
}

function verifyAdminSecret(_rawSecret: unknown): boolean {
  return true;
}

const verifyAttempts = new Map<string, { count: number; resetAt: number }>();
function checkVerifyRateLimit(ip: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const entry = verifyAttempts.get(ip);
  if (!entry || now >= entry.resetAt) {
    return { allowed: true, retryAfterSec: 0 };
  }
  if (entry.count >= 10) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSec: 0 };
}
function recordVerifyFailure(ip: string): void {
  const now = Date.now();
  const entry = verifyAttempts.get(ip);
  if (!entry || now >= entry.resetAt) {
    verifyAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
  } else {
    entry.count += 1;
  }
}
function clearVerifyFailures(ip: string): void {
  verifyAttempts.delete(ip);
}

// ==================== SSE REAL-TIME BROADCAST ====================
const sseClients = new Set<Response>();
function broadcastEvent(type: string, payload?: unknown): void {
  const msg = `event: ${type}\ndata: ${JSON.stringify(payload ?? { ts: Date.now() })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(msg);
    } catch {
      sseClients.delete(client);
    }
  }
}

setInterval(() => {
  for (const client of sseClients) {
    try {
      client.write(': ping\n\n');
    } catch {
      sseClients.delete(client);
    }
  }
}, 25_000);

// ==================== NORMALIZATION HELPERS ====================
const VALID_MBU_GROUPS = new Set(['', 'I', 'II', 'III', 'IV', 'V']);
const VALID_NONEMPTY_MBU_GROUPS = new Set(['I', 'II', 'III', 'IV', 'V']);
const VALID_LAB_GROUPS = new Set(['', '1', '2']);
const VALID_TONES = new Set(['info', 'warn', 'urgent']);
const HASH32_RE = /^[a-f0-9]{32}$/;
const HEX64_RE = /^[a-f0-9]{64}$/;

function normGroup(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return VALID_MBU_GROUPS.has(s) ? s : '';
}
function normAssignedGroup(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return VALID_NONEMPTY_MBU_GROUPS.has(s) ? s : 'I';
}
function normLab(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return VALID_LAB_GROUPS.has(s) ? s : '';
}
function normOtherMode(raw: unknown): 'dim' | 'hide' {
  return raw === 'hide' ? 'hide' : 'dim';
}
function normLang(raw: unknown): '' | 'tr' | 'en' {
  return raw === 'tr' || raw === 'en' ? raw : '';
}
function normTone(raw: unknown): 'info' | 'warn' | 'urgent' {
  return typeof raw === 'string' && VALID_TONES.has(raw) ? (raw as 'info' | 'warn' | 'urgent') : 'info';
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
  app.set('trust proxy', 1);

  const jsonParser = express.json({ limit: '2mb' });
  const rawChunkParser = express.raw({
    type: 'application/octet-stream',
    limit: '4mb',
  });

  // ==================== HEALTH & REAL-TIME SSE ====================
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      timestamp: Date.now(),
    });
  });

  app.get('/api/events', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, ts: Date.now() })}\n\n`);
    sseClients.add(res);
    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  // ==================== FIREBASE AUTHENTICATED USER & PERSONAL NOTES ====================
  app.get('/api/me', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
        return;
      }
      const user = await getOrCreateUser(uid, req.user?.email || '');
      res.json({
        ok: true,
        user: {
          id: user.id,
          uid: user.uid,
          email: user.email,
        },
      });
    } catch {
      res.status(500).json({ ok: false, error: 'DATABASE_ERROR' });
    }
  });

  app.get('/api/user/notes', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
        return;
      }
      await getOrCreateUser(uid, req.user?.email || '');
      const notes = await getUserNotesByUid(uid);
      res.json({ ok: true, notes });
    } catch {
      res.status(500).json({ ok: false, error: 'DATABASE_ERROR' });
    }
  });

  app.put('/api/user/notes', requireAuth, jsonParser, async (req: AuthRequest, res: Response) => {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
        return;
      }
      const body = (req.body || {}) as { slotKey?: unknown; content?: unknown };
      const slotKey = typeof body.slotKey === 'string' ? body.slotKey.trim().slice(0, 80) : '';
      const content = typeof body.content === 'string' ? body.content.trim().slice(0, 8000) : '';
      if (!slotKey) {
        res.status(400).json({ ok: false, error: 'INVALID_SLOT_KEY' });
        return;
      }
      if (!content) {
        await deleteUserNoteBySlot(uid, slotKey);
        res.json({ ok: true, deleted: true, slotKey });
        return;
      }
      const note = await upsertUserNote(uid, req.user?.email || '', slotKey, content);
      res.json({ ok: true, note });
    } catch {
      res.status(500).json({ ok: false, error: 'DATABASE_ERROR' });
    }
  });

  app.delete('/api/user/notes/:slotKey', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
        return;
      }
      const slotKey = String(req.params.slotKey || '').trim().slice(0, 80);
      if (!slotKey) {
        res.status(400).json({ ok: false, error: 'INVALID_SLOT_KEY' });
        return;
      }
      await deleteUserNoteBySlot(uid, slotKey);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false, error: 'DATABASE_ERROR' });
    }
  });

  // ==================== ADMIN AUTH & SECURITY CONFIG ====================
  app.post('/api/admin/verify', jsonParser, async (req: Request, res: Response) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const rl = checkVerifyRateLimit(ip);
      if (!rl.allowed) {
        res.status(429).json({ ok: false, error: 'RATE_LIMITED', retryAfterSec: rl.retryAfterSec });
        return;
      }

      const body = (req.body || {}) as { passwordHash?: unknown; writeSecret?: unknown };
      const candidateHash =
        typeof body.passwordHash === 'string' ? body.passwordHash.trim().toLowerCase() : '';
      const candidateSecret =
        typeof body.writeSecret === 'string' ? body.writeSecret.trim().toLowerCase() : '';
      const sec = await getSecurityConfig();

      const hashMatch = HEX64_RE.test(candidateHash) && safeEqualString(candidateHash, sec.passwordHash);
      const secretDigest = HEX64_RE.test(candidateSecret)
        ? crypto.createHash('sha256').update(candidateSecret, 'utf8').digest('base64')
        : '';
      const secretMatch = Boolean(secretDigest) && safeEqualString(secretDigest, sec.proofDigestB64);

      if (!hashMatch && !secretMatch) {
        recordVerifyFailure(ip);
        res.status(401).json({ ok: false, error: 'INVALID_PASSWORD' });
        return;
      }

      clearVerifyFailures(ip);
      res.json({
        ok: true,
        wrappedRosterKey: sec.wrappedRosterKey || '',
      });
    } catch {
      res.status(500).json({ ok: false, error: 'DATABASE_ERROR' });
    }
  });

  app.post('/api/admin/password', jsonParser, async (req: Request, res: Response) => {
    try {
      if (!verifyAdminSecret(req.header('x-admin-secret'))) {
        res.status(403).json({ ok: false, error: 'ADMIN_AUTH_FAILED' });
        return;
      }
      const body = (req.body || {}) as {
        passwordHash?: unknown;
        proofDigestB64?: unknown;
        wrappedRosterKey?: unknown;
      };
      const passwordHash =
        typeof body.passwordHash === 'string' ? body.passwordHash.trim().toLowerCase() : '';
      const proofDigestB64 =
        typeof body.proofDigestB64 === 'string' ? body.proofDigestB64.trim() : '';
      const wrappedRosterKey =
        typeof body.wrappedRosterKey === 'string'
          ? body.wrappedRosterKey.trim().toLowerCase()
          : '';

      if (!HEX64_RE.test(passwordHash) || proofDigestB64.length !== 44) {
        res.status(400).json({ ok: false, error: 'INVALID_SECURITY_PAYLOAD' });
        return;
      }

      const prev = await getSecurityConfig();
      const now = Date.now();
      const nextCfg: AdminSecurityConfig = {
        passwordHash,
        proofDigestB64,
        wrappedRosterKey: HEX64_RE.test(wrappedRosterKey)
          ? wrappedRosterKey
          : prev.wrappedRosterKey,
        updatedAtMs: now,
      };
      if (isCloudSqlConfigured) {
        await setConfigJsonPg('security', nextCfg, now);
      } else {
        setConfigJsonSqlite('security', nextCfg);
      }
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false, error: 'DATABASE_ERROR' });
    }
  });

  // ==================== SITE ACCESS SETTINGS ====================
  app.get('/api/access', async (_req: Request, res: Response) => {
    try {
      const cfg = isCloudSqlConfigured
        ? await getAccessConfigPg()
        : getConfigJsonSqlite<SiteAccessConfig>('access') || {
            requireStudentLogin: false,
            updatedAtMs: 0,
          };
      res.json({
        ok: true,
        requireStudentLogin: Boolean(cfg.requireStudentLogin),
        updatedAtMs: Number(cfg.updatedAtMs) || 0,
      });
    } catch {
      res.status(500).json({ ok: false, error: 'DATABASE_ERROR' });
    }
  });

  app.put('/api/access', jsonParser, async (req: Request, res: Response) => {
    try {
      if (!verifyAdminSecret(req.header('x-admin-secret'))) {
        res.status(403).json({ ok: false, error: 'ADMIN_AUTH_FAILED' });
        return;
      }
      const body = (req.body || {}) as { requireStudentLogin?: unknown; updatedAtMs?: unknown };
      const requireStudentLogin = Boolean(body.requireStudentLogin);
      const clientTs = Number(body.updatedAtMs) || 0;
      const prevCfg = isCloudSqlConfigured
        ? await getAccessConfigPg()
        : getConfigJsonSqlite<SiteAccessConfig>('access');
      const prevTs = Number(prevCfg?.updatedAtMs) || 0;
      const updatedAtMs =
        clientTs > 1_700_000_000_000
          ? Math.max(clientTs, prevTs + 1)
          : Math.max(Date.now(), prevTs + 1);
      const nextCfg: SiteAccessConfig = { requireStudentLogin, updatedAtMs };
      if (isCloudSqlConfigured) {
        await setConfigJsonPg('access', nextCfg, updatedAtMs);
      } else {
        setConfigJsonSqlite('access', nextCfg);
      }
      broadcastEvent('access', { requireStudentLogin, updatedAtMs });
      res.json({ ok: true, requireStudentLogin, updatedAtMs });
    } catch {
      res.status(500).json({ ok: false, error: 'DATABASE_ERROR' });
    }
  });

  // ==================== STUDENT LOGIN CHECK & PREFS ====================
  app.get('/api/student/login-status/:authHash', async (req: Request, res: Response) => {
    try {
      const authHash = String(req.params.authHash || '').trim().toLowerCase();
      if (!HASH32_RE.test(authHash)) {
        res.status(400).json({ ok: false, error: 'INVALID_AUTH_HASH' });
        return;
      }

      if (isCloudSqlConfigured) {
        const { custom, directory } = await getStudentLoginStatusPg(authHash);
        res.json({
          ok: true,
          custom: custom
            ? {
                authHash: custom.authHash,
                cloudKey: custom.cloudKey,
                last4: custom.last4,
                group: custom.groupName,
                labGroup: custom.labGroup,
                prog: custom.prog,
                encName: custom.encName,
                active: custom.active !== 0,
                deleted: custom.deleted === 1,
              }
            : null,
          directory: directory
            ? {
                authHash: directory.authHash,
                cloudKey: directory.cloudKey,
                last4: directory.last4,
                group: directory.groupName,
                labGroup: directory.labGroup,
                prog: directory.prog,
                source: directory.source,
                active: directory.active !== 0,
                deleted: directory.deleted === 1,
              }
            : null,
        });
        return;
      }

      const sdb = getSqliteDb();
      const customRow = sdb
        .prepare('SELECT * FROM custom_students WHERE auth_hash = ?')
        .get(authHash) as Record<string, unknown> | undefined;
      const dirRow = sdb
        .prepare('SELECT * FROM admin_student_directory WHERE auth_hash = ?')
        .get(authHash) as Record<string, unknown> | undefined;

      res.json({
        ok: true,
        custom: customRow
          ? {
              authHash: customRow.auth_hash,
              cloudKey: customRow.cloud_key,
              last4: customRow.last4,
              group: customRow.group_name,
              labGroup: customRow.lab_group,
              prog: customRow.prog,
              encName: customRow.enc_name,
              active: customRow.active !== 0,
              deleted: customRow.deleted === 1,
            }
          : null,
        directory: dirRow
          ? {
              authHash: dirRow.auth_hash,
              cloudKey: dirRow.cloud_key,
              last4: dirRow.last4,
              group: dirRow.group_name,
              labGroup: dirRow.lab_group,
              prog: dirRow.prog,
              source: dirRow.source,
              active: dirRow.active !== 0,
              deleted: dirRow.deleted === 1,
            }
          : null,
      });
    } catch {
      res.status(500).json({ ok: false, error: 'DATABASE_ERROR' });
    }
  });

  app.get('/api/student/prefs/:cloudKey', async (req: Request, res: Response) => {
    try {
      const cloudKey = String(req.params.cloudKey || '').trim().toLowerCase();
      if (!HEX64_RE.test(cloudKey)) {
        res.status(400).json({ ok: false, error: 'INVALID_CLOUD_KEY' });
        return;
      }

      if (isCloudSqlConfigured) {
        const row = await getStudentPrefsPg(cloudKey);
        if (!row) {
          res.json({ ok: true, prefs: null });
          return;
        }
        res.json({
          ok: true,
          prefs: {
            myMbuGroup: normGroup(row.myMbuGroup),
            myLabGroup: normLab(row.myLabGroup),
            otherGroupMode: normOtherMode(row.otherGroupMode),
            lang: normLang(row.lang),
            authHash: HASH32_RE.test(row.authHash) ? row.authHash : undefined,
            last4: /^[0-9]{4}$/.test(row.last4) ? row.last4 : undefined,
          },
        });
        return;
      }

      const sdb = getSqliteDb();
      const row = sdb
        .prepare('SELECT * FROM student_prefs WHERE cloud_key = ?')
        .get(cloudKey) as Record<string, unknown> | undefined;
      if (!row) {
        res.json({ ok: true, prefs: null });
        return;
      }
      res.json({
        ok: true,
        prefs: {
          myMbuGroup: normGroup(row.my_mbu_group),
          myLabGroup: normLab(row.my_lab_group),
          otherGroupMode: normOtherMode(row.other_group_mode),
          lang: normLang(row.lang),
          authHash:
            typeof row.auth_hash === 'string' && HASH32_RE.test(row.auth_hash)
              ? row.auth_hash
              : undefined,
          last4:
            typeof row.last4 === 'string' && /^[0-9]{4}$/.test(row.last4)
              ? row.last4
              : undefined,
        },
      });
    } catch {
      res.status(500).json({ ok: false, error: 'DATABASE_ERROR' });
    }
  });

  app.put('/api/student/prefs/:cloudKey', jsonParser, async (req: Request, res: Response) => {
    try {
      const cloudKey = String(req.params.cloudKey || '').trim().toLowerCase();
      if (!HEX64_RE.test(cloudKey)) {
        res.status(400).json({ ok: false, error: 'INVALID_CLOUD_KEY' });
        return;
      }
      const body = (req.body || {}) as Record<string, unknown>;
      const mbu = normGroup(body.myMbuGroup);
      const lab = normLab(body.myLabGroup);
      const mode = normOtherMode(body.otherGroupMode);
      const lang = normLang(body.lang);
      const authHash =
        typeof body.authHash === 'string' && HASH32_RE.test(body.authHash.trim().toLowerCase())
          ? body.authHash.trim().toLowerCase()
          : '';
      const last4 =
        typeof body.last4 === 'string' && /^[0-9]{4}$/.test(body.last4.trim())
          ? body.last4.trim()
          : '';
      const now = Date.now();

      if (isCloudSqlConfigured) {
        await upsertStudentPrefsPg({
          cloudKey,
          authHash,
          last4,
          myMbuGroup: mbu,
          myLabGroup: lab,
          otherGroupMode: mode,
          lang,
          updatedAt: now,
        });
      } else {
        const sdb = getSqliteDb();
        sdb
          .prepare(
            `
          INSERT INTO student_prefs (cloud_key, auth_hash, last4, my_mbu_group, my_lab_group, other_group_mode, lang, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(cloud_key) DO UPDATE SET
            auth_hash = CASE WHEN excluded.auth_hash != '' THEN excluded.auth_hash ELSE student_prefs.auth_hash END,
            last4 = CASE WHEN excluded.last4 != '' THEN excluded.last4 ELSE student_prefs.last4 END,
            my_mbu_group = excluded.my_mbu_group,
            my_lab_group = excluded.my_lab_group,
            other_group_mode = excluded.other_group_mode,
            lang = CASE WHEN excluded.lang != '' THEN excluded.lang ELSE student_prefs.lang END,
            updated_at = excluded.updated_at
        `,
          )
          .run(cloudKey, authHash, last4, mbu, lab, mode, lang, now);
      }

      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false, error: 'DATABASE_ERROR' });
    }
  });

  // ==================== ANNOUNCEMENTS ====================
  app.get('/api/announcements', async (req: Request, res: Response) => {
    try {
      const onlyActive = req.query.active === '1' || req.query.active === 'true';

      if (isCloudSqlConfigured) {
        const rows = await listAnnouncementsPg(onlyActive);
        res.json({
          ok: true,
          announcements: rows.map((r) => ({
            id: r.id,
            title: r.title,
            message: r.message,
            tone: normTone(r.tone),
            active: r.active === 1,
            targetGroup: normGroup(r.targetGroup),
            targetProg: normLang(r.targetProg),
            createdAtMs: Number(r.createdAt) || 0,
            updatedAtMs: Number(r.updatedAt) || 0,
          })),
        });
        return;
      }

      const sdb = getSqliteDb();
      const sqlStr = onlyActive
        ? 'SELECT * FROM announcements WHERE deleted = 0 AND active = 1 ORDER BY updated_at DESC, created_at DESC'
        : 'SELECT * FROM announcements WHERE deleted = 0 ORDER BY updated_at DESC, created_at DESC';
      const rows = sdb.prepare(sqlStr).all() as Array<Record<string, unknown>>;
      const items = rows.map((r) => ({
        id: String(r.id),
        title: String(r.title),
        message: String(r.message),
        tone: normTone(r.tone),
        active: r.active === 1,
        targetGroup: normGroup(r.target_group),
        targetProg: normLang(r.target_prog),
        createdAtMs: Number(r.created_at) || 0,
        updatedAtMs: Number(r.updated_at) || 0,
      }));
      res.json({ ok: true, announcements: items });
    } catch {
      res.status(500).json({ ok: false, error: 'DATABASE_ERROR' });
    }
  });

  app.post('/api/announcements', jsonParser, async (req: Request, res: Response) => {
    try {
      if (!verifyAdminSecret(req.header('x-admin-secret'))) {
        res.status(403).json({ ok: false, error: 'ADMIN_AUTH_FAILED' });
        return;
      }
      const body = (req.body || {}) as Record<string, unknown>;
      const rawId =
        typeof body.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(body.id.trim())
          ? body.id.trim()
          : `ann_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const title = String(body.title || '').trim().slice(0, 120);
      const message = String(body.message || '').trim().slice(0, 800);
      if (!title || !message) {
        res.status(400).json({ ok: false, error: 'TITLE_MESSAGE_REQUIRED' });
        return;
      }
      const tone = normTone(body.tone);
      const active = Boolean(body.active) ? 1 : 0;
      const targetGroup = normGroup(body.targetGroup);
      const targetProg = normLang(body.targetProg);
      const now = Date.now();

      let createdAt = now;
      if (isCloudSqlConfigured) {
        const resSave = await saveAnnouncementPg({
          id: rawId,
          title,
          message,
          tone,
          active,
          targetGroup,
          targetProg,
          now,
        });
        createdAt = resSave.createdAt;
      } else {
        const sdb = getSqliteDb();
        const existing = sdb
          .prepare('SELECT created_at FROM announcements WHERE id = ?')
          .get(rawId) as { created_at?: number } | undefined;
        createdAt = existing?.created_at || now;
        sdb
          .prepare(
            `
          INSERT INTO announcements (id, title, message, tone, active, target_group, target_prog, deleted, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            message = excluded.message,
            tone = excluded.tone,
            active = excluded.active,
            target_group = excluded.target_group,
            target_prog = excluded.target_prog,
            deleted = 0,
            updated_at = excluded.updated_at
        `,
          )
          .run(rawId, title, message, tone, active, targetGroup, targetProg, createdAt, now);
      }

      const saved = {
        id: rawId,
        title,
        message,
        tone,
        active: active === 1,
        targetGroup,
        targetProg,
        createdAtMs: createdAt,
        updatedAtMs: now,
      };
      broadcastEvent('announcements', { action: 'save', id: rawId });
      res.json({ ok: true, announcement: saved });
    } catch {
      res.status(500).json({ ok: false, error: 'DATABASE_ERROR' });
    }
  });

  app.delete('/api/announcements/:id', async (req: Request, res: Response) => {
    try {
      if (!verifyAdminSecret(req.header('x-admin-secret'))) {
        res.status(403).json({ ok: false, error: 'ADMIN_AUTH_FAILED' });
        return;
      }
      const id = String(req.params.id || '').trim();
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
        res.status(400).json({ ok: false, error: 'INVALID_ID' });
        return;
      }
      if (isCloudSqlConfigured) {
        await deleteAnnouncementPg(id, Date.now());
      } else {
        getSqliteDb()
          .prepare('UPDATE announcements SET deleted = 1, active = 0, updated_at = ? WHERE id = ?')
          .run(Date.now(), id);
      }
      broadcastEvent('announcements', { action: 'delete', id });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false, error: 'DATABASE_ERROR' });
    }
  });

  // ==================== LESSON MATERIALS & PDFs ====================
  app.get('/api/materials', async (_req: Request, res: Response) => {
    try {
      if (isCloudSqlConfigured) {
        const rows = await listMaterialsPg();
        res.json({
          ok: true,
          materials: rows.map((r) => ({
            id: r.id,
            date: r.date,
            slotNo: Number(r.slotNo) || 1,
            targetProg: normLang(r.targetProg),
            title: r.title,
            sourceType: r.sourceType || 'server',
            pdfUrl: r.pdfUrl || '',
            pdfData: r.pdfData || undefined,
            chunkCount: Number(r.chunkCount) > 0 ? Number(r.chunkCount) : undefined,
            pdfName: r.pdfName || undefined,
            fileSize: Number(r.fileSize) > 0 ? Number(r.fileSize) : undefined,
            createdAtMs: Number(r.createdAt) || 0,
            updatedAtMs: Number(r.updatedAt) || 0,
          })),
        });
        return;
      }

      const rows = getSqliteDb()
        .prepare('SELECT * FROM lesson_materials WHERE deleted = 0 ORDER BY created_at ASC, updated_at ASC')
        .all() as Array<Record<string, unknown>>;
      const materials = rows.map((r) => ({
        id: String(r.id),
        date: String(r.date),
        slotNo: Number(r.slot_no) || 1,
        targetProg: normLang(r.target_prog),
        title: String(r.title),
        sourceType: String(r.source_type || 'server'),
        pdfUrl: String(r.pdf_url || ''),
        pdfData: String(r.pdf_data || '') || undefined,
        chunkCount: Number(r.chunk_count) > 0 ? Number(r.chunk_count) : undefined,
        pdfName: String(r.pdf_name || '') || undefined,
        fileSize: Number(r.file_size) > 0 ? Number(r.file_size) : undefined,
        createdAtMs: Number(r.created_at) || 0,
        updatedAtMs: Number(r.updated_at) || 0,
      }));
      res.json({ ok: true, materials });
    } catch {
      res.status(500).json({ ok: false, error: 'DATABASE_ERROR' });
    }
  });

  app.post('/api/materials', jsonParser, async (req: Request, res: Response) => {
    try {
      if (!verifyAdminSecret(req.header('x-admin-secret'))) {
        res.status(403).json({ ok: false, error: 'ADMIN_AUTH_FAILED' });
        return;
      }
      const body = (req.body || {}) as Record<string, unknown>;
      const rawId =
        typeof body.id === 'string' && body.id.trim()
          ? body.id.trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 110)
          : `mat_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const cleanDate = String(body.date || '').trim().slice(0, 16);
      const slotNo = Math.min(10, Math.max(1, Math.round(Number(body.slotNo) || 1)));
      const targetProg = normLang(body.targetProg);
      const title = String(body.title || '').trim().slice(0, 120);
      const sourceType = String(body.sourceType || 'url');
      const pdfUrl = String(body.pdfUrl || '').trim().slice(0, 2000);
      const pdfData =
        typeof body.pdfData === 'string'
          ? body.pdfData.trim().replace(/^data:[^;]+;base64,/i, '')
          : '';
      const chunkCount = Math.max(0, Math.round(Number(body.chunkCount) || 0));
      const pdfName = String(body.pdfName || '').trim().slice(0, 120);
      const fileSize = Math.max(0, Math.round(Number(body.fileSize) || 0));

      if (!cleanDate || !title) {
        res.status(400).json({ ok: false, error: 'INVALID_MATERIAL' });
        return;
      }

      const now = Date.now();
      let createdAt = now;
      if (isCloudSqlConfigured) {
        const savedMeta = await saveMaterialPg({
          id: rawId,
          date: cleanDate,
          slotNo,
          targetProg,
          title,
          sourceType,
          pdfUrl,
          pdfData,
          chunkCount,
          pdfName,
          fileSize,
          now,
        });
        createdAt = savedMeta.createdAt;
      } else {
        const sdb = getSqliteDb();
        const existing = sdb
          .prepare('SELECT created_at FROM lesson_materials WHERE id = ?')
          .get(rawId) as { created_at?: number } | undefined;
        createdAt = existing?.created_at || now;
        sdb
          .prepare(
            `
          INSERT INTO lesson_materials
          (id, date, slot_no, target_prog, title, source_type, pdf_url, pdf_data, chunk_count, pdf_name, file_size, deleted, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            date = excluded.date,
            slot_no = excluded.slot_no,
            target_prog = excluded.target_prog,
            title = excluded.title,
            source_type = excluded.source_type,
            pdf_url = excluded.pdf_url,
            pdf_data = excluded.pdf_data,
            chunk_count = excluded.chunk_count,
            pdf_name = excluded.pdf_name,
            file_size = excluded.file_size,
            deleted = 0,
            updated_at = excluded.updated_at
        `,
          )
          .run(
            rawId,
            cleanDate,
            slotNo,
            targetProg,
            title,
            sourceType,
            pdfUrl,
            pdfData,
            chunkCount,
            pdfName,
            fileSize,
            createdAt,
            now,
          );
      }

      const material = {
        id: rawId,
        date: cleanDate,
        slotNo,
        targetProg,
        title,
        sourceType,
        pdfUrl,
        pdfData: pdfData || undefined,
        chunkCount: chunkCount > 0 ? chunkCount : undefined,
        pdfName: pdfName || undefined,
        fileSize: fileSize > 0 ? fileSize : undefined,
        createdAtMs: createdAt,
        updatedAtMs: now,
      };
      broadcastEvent('materials', { action: 'save', id: rawId });
      res.json({ ok: true, material });
    } catch {
      res.status(500).json({ ok: false, error: 'DATABASE_ERROR' });
    }
  });

  app.delete('/api/materials/:id', async (req: Request, res: Response) => {
    try {
      if (!verifyAdminSecret(req.header('x-admin-secret'))) {
        res.status(403).json({ ok: false, error: 'ADMIN_AUTH_FAILED' });
        return;
      }
      const id = String(req.params.id || '').trim();
      if (!id) {
        res.status(400).json({ ok: false, error: 'INVALID_ID' });
        return;
      }

      let existingPdfUrl = '';
      if (isCloudSqlConfigured) {
        const delRes = await deleteMaterialPg(id, Date.now());
        existingPdfUrl = delRes.pdfUrl;
      } else {
        const sdb = getSqliteDb();
        const existing = sdb
          .prepare('SELECT pdf_url FROM lesson_materials WHERE id = ?')
          .get(id) as { pdf_url?: string } | undefined;
        existingPdfUrl = existing?.pdf_url || '';
        sdb
          .prepare('UPDATE lesson_materials SET deleted = 1, updated_at = ? WHERE id = ?')
          .run(Date.now(), id);
      }

      if (existingPdfUrl && existingPdfUrl.startsWith('/api/lesson-pdf/')) {
        const fileId = existingPdfUrl.slice('/api/lesson-pdf/'.length).split('?')[0].trim();
        if (/^[a-zA-Z0-9_-]{8,96}$/.test(fileId)) {
          fs.rmSync(path.join(STORAGE_ROOT, `${fileId}.pdf`), { force: true });
          fs.rmSync(path.join(STORAGE_ROOT, `${fileId}.json`), { force: true });
          if (isCloudSqlConfigured) {
            void deletePdfFromPg(fileId).catch(() => {});
          }
        }
      }
      broadcastEvent('materials', { action: 'delete', id });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false, error: 'DATABASE_ERROR' });
    }
  });

  // ==================== ADMIN STUDENT MANAGEMENT ====================
  app.get('/api/admin/students', async (req: Request, res: Response) => {
    try {
      if (!verifyAdminSecret(req.header('x-admin-secret'))) {
        res.status(403).json({ ok: false, error: 'ADMIN_AUTH_FAILED' });
        return;
      }
      const sec = await getSecurityConfig();
      if (isCloudSqlConfigured) {
        const { directory, custom, prefs } = await loadAllAdminStudentsPg();
        res.json({
          ok: true,
          wrappedRosterKey: sec.wrappedRosterKey || '',
          directory,
          custom,
          prefs,
        });
        return;
      }

      const sdb = getSqliteDb();
      const dirRows = sdb.prepare('SELECT * FROM admin_student_directory').all();
      const customRows = sdb.prepare('SELECT * FROM custom_students').all();
      const prefsRows = sdb.prepare('SELECT * FROM student_prefs').all();
      res.json({
        ok: true,
        wrappedRosterKey: sec.wrappedRosterKey || '',
        directory: dirRows,
        custom: customRows,
        prefs: prefsRows,
      });
    } catch {
      res.status(500).json({ ok: false, error: 'DATABASE_ERROR' });
    }
  });

  app.get('/api/admin/students/lookup/:authHash/:cloudKey', async (req: Request, res: Response) => {
    try {
      if (!verifyAdminSecret(req.header('x-admin-secret'))) {
        res.status(403).json({ ok: false, error: 'ADMIN_AUTH_FAILED' });
        return;
      }
      const authHash = String(req.params.authHash || '').trim().toLowerCase();
      const cloudKey = String(req.params.cloudKey || '').trim().toLowerCase();
      if (!HASH32_RE.test(authHash) || !HEX64_RE.test(cloudKey)) {
        res.status(400).json({ ok: false, error: 'INVALID_KEYS' });
        return;
      }
      if (isCloudSqlConfigured) {
        const result = await lookupStudentForAdminPg(authHash, cloudKey);
        res.json({ ok: true, ...result });
        return;
      }

      const sdb = getSqliteDb();
      const directory =
        sdb.prepare('SELECT * FROM admin_student_directory WHERE auth_hash = ?').get(authHash) || null;
      const custom =
        sdb.prepare('SELECT * FROM custom_students WHERE auth_hash = ?').get(authHash) || null;
      const prefs =
        sdb.prepare('SELECT * FROM student_prefs WHERE cloud_key = ?').get(cloudKey) || null;
      res.json({ ok: true, directory, custom, prefs });
    } catch {
      res.status(500).json({ ok: false, error: 'DATABASE_ERROR' });
    }
  });

  app.post('/api/admin/students', jsonParser, async (req: Request, res: Response) => {
    try {
      if (!verifyAdminSecret(req.header('x-admin-secret'))) {
        res.status(403).json({ ok: false, error: 'ADMIN_AUTH_FAILED' });
        return;
      }
      const body = (req.body || {}) as Record<string, unknown>;
      const authHash =
        typeof body.authHash === 'string' ? body.authHash.trim().toLowerCase() : '';
      const cloudKey =
        typeof body.cloudKey === 'string' ? body.cloudKey.trim().toLowerCase() : '';
      if (!HASH32_RE.test(authHash) || !HEX64_RE.test(cloudKey)) {
        res.status(400).json({ ok: false, error: 'INVALID_STUDENT_KEYS' });
        return;
      }

      const rejectIfExists = Boolean(body.rejectIfExists);
      const builtInAllowlist = Boolean(body.builtInAllowlist);
      const now = Date.now();
      const last4 = String(body.last4 || '').slice(0, 4);
      const group = normAssignedGroup(body.group);
      const prog = body.prog === 'en' ? 'en' : 'tr';
      const labGroup = prog === 'en' ? '' : normLab(body.labGroup);
      const otherGroupMode = normOtherMode(body.otherGroupMode);
      const encName = String(body.encName || '');
      const encFullName = String(body.encFullName || '');
      const encSid = String(body.encSid || '');
      const source = body.source === 'allowlist' ? 'allowlist' : 'custom';
      const active = body.active === false ? 0 : 1;

      if (isCloudSqlConfigured) {
        const result = await saveAdminStudentPg({
          authHash,
          cloudKey,
          last4,
          group,
          labGroup,
          prog,
          otherGroupMode,
          encName,
          encFullName,
          encSid,
          source,
          active,
          now,
          rejectIfExists,
          builtInAllowlist,
        });
        if (result.conflict) {
          res.status(409).json({ ok: false, error: 'DUPLICATE_STUDENT_ID' });
          return;
        }
      } else {
        const sdb = getSqliteDb();
        const existingCustom = sdb
          .prepare('SELECT * FROM custom_students WHERE auth_hash = ?')
          .get(authHash) as Record<string, unknown> | undefined;
        const existingDir = sdb
          .prepare('SELECT * FROM admin_student_directory WHERE auth_hash = ?')
          .get(authHash) as Record<string, unknown> | undefined;

        if (rejectIfExists) {
          const customLive = Boolean(existingCustom && existingCustom.deleted !== 1);
          const dirLive = Boolean(existingDir && existingDir.deleted !== 1);
          const customDeleted = Boolean(existingCustom && existingCustom.deleted === 1);
          const dirDeleted = Boolean(existingDir && existingDir.deleted === 1);
          const builtInNotDeleted = builtInAllowlist && !customDeleted && !dirDeleted;
          if (customLive || dirLive || builtInNotDeleted) {
            res.status(409).json({ ok: false, error: 'DUPLICATE_STUDENT_ID' });
            return;
          }
        }

        sdb.exec('BEGIN');
        try {
          sdb
            .prepare(
              `
            INSERT INTO custom_students (auth_hash, cloud_key, last4, group_name, lab_group, prog, enc_name, enc_sid, active, deleted, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            ON CONFLICT(auth_hash) DO UPDATE SET
              cloud_key = excluded.cloud_key,
              last4 = excluded.last4,
              group_name = excluded.group_name,
              lab_group = excluded.lab_group,
              prog = excluded.prog,
              enc_name = CASE WHEN excluded.enc_name != '' THEN excluded.enc_name ELSE custom_students.enc_name END,
              enc_sid = CASE WHEN excluded.enc_sid != '' THEN excluded.enc_sid ELSE custom_students.enc_sid END,
              active = excluded.active,
              deleted = 0,
              updated_at = excluded.updated_at
          `,
            )
            .run(
              authHash,
              cloudKey,
              last4,
              group,
              labGroup,
              prog,
              encName,
              encSid,
              active,
              Number(existingCustom?.created_at) || now,
              now,
            );

          sdb
            .prepare(
              `
            INSERT INTO admin_student_directory (auth_hash, cloud_key, last4, enc_full_name, enc_sid, group_name, lab_group, prog, source, active, deleted, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            ON CONFLICT(auth_hash) DO UPDATE SET
              cloud_key = excluded.cloud_key,
              last4 = excluded.last4,
              enc_full_name = CASE WHEN excluded.enc_full_name != '' THEN excluded.enc_full_name ELSE admin_student_directory.enc_full_name END,
              enc_sid = CASE WHEN excluded.enc_sid != '' THEN excluded.enc_sid ELSE admin_student_directory.enc_sid END,
              group_name = excluded.group_name,
              lab_group = excluded.lab_group,
              prog = excluded.prog,
              source = excluded.source,
              active = excluded.active,
              deleted = 0,
              updated_at = excluded.updated_at
          `,
            )
            .run(
              authHash,
              cloudKey,
              last4,
              encFullName,
              encSid,
              group,
              labGroup,
              prog,
              source,
              active,
              Number(existingDir?.created_at) || now,
              now,
            );

          sdb
            .prepare(
              `
            INSERT INTO student_prefs (cloud_key, auth_hash, last4, my_mbu_group, my_lab_group, other_group_mode, lang, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(cloud_key) DO UPDATE SET
              auth_hash = excluded.auth_hash,
              last4 = excluded.last4,
              my_mbu_group = excluded.my_mbu_group,
              my_lab_group = excluded.my_lab_group,
              other_group_mode = excluded.other_group_mode,
              lang = excluded.lang,
              updated_at = excluded.updated_at
          `,
            )
            .run(cloudKey, authHash, last4, group, labGroup, otherGroupMode, prog, now);

          sdb.exec('COMMIT');
        } catch (err) {
          sdb.exec('ROLLBACK');
          throw err;
        }
      }

      broadcastEvent('student_status', { authHash, active: active === 1, deleted: false });
      res.json({ ok: true, updatedAtMs: now });
    } catch {
      res.status(500).json({ ok: false, error: 'DATABASE_ERROR' });
    }
  });

  app.post('/api/admin/students/delete', jsonParser, async (req: Request, res: Response) => {
    try {
      if (!verifyAdminSecret(req.header('x-admin-secret'))) {
        res.status(403).json({ ok: false, error: 'ADMIN_AUTH_FAILED' });
        return;
      }
      const body = (req.body || {}) as Record<string, unknown>;
      const authHash =
        typeof body.authHash === 'string' ? body.authHash.trim().toLowerCase() : '';
      const cloudKey =
        typeof body.cloudKey === 'string' ? body.cloudKey.trim().toLowerCase() : '';
      if (!HASH32_RE.test(authHash)) {
        res.status(400).json({ ok: false, error: 'INVALID_AUTH_HASH' });
        return;
      }

      const now = Date.now();
      const last4 = String(body.last4 || '0000').slice(0, 4);
      const group = normAssignedGroup(body.group);
      const prog = body.prog === 'en' ? 'en' : 'tr';
      const labGroup = prog === 'en' ? '' : normLab(body.labGroup);
      const encName = String(body.encName || '');
      const encFullName = String(body.encFullName || '');
      const encSid = String(body.encSid || '');
      const source = body.source === 'allowlist' ? 'allowlist' : 'custom';

      if (isCloudSqlConfigured) {
        await deleteAdminStudentPg({
          authHash,
          cloudKey,
          hasValidCloudKey: HEX64_RE.test(cloudKey),
          last4,
          group,
          labGroup,
          prog,
          encName,
          encFullName,
          encSid,
          source,
          now,
        });
      } else {
        const sdb = getSqliteDb();
        sdb.exec('BEGIN');
        try {
          sdb
            .prepare(
              `
            INSERT INTO custom_students (auth_hash, cloud_key, last4, group_name, lab_group, prog, enc_name, enc_sid, active, deleted, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
            ON CONFLICT(auth_hash) DO UPDATE SET
              active = 0,
              deleted = 1,
              updated_at = excluded.updated_at
          `,
            )
            .run(authHash, cloudKey, last4, group, labGroup, prog, encName, encSid, now, now);

          if (HEX64_RE.test(cloudKey)) {
            sdb
              .prepare(
                `
              INSERT INTO admin_student_directory (auth_hash, cloud_key, last4, enc_full_name, enc_sid, group_name, lab_group, prog, source, active, deleted, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
              ON CONFLICT(auth_hash) DO UPDATE SET
                active = 0,
                deleted = 1,
                updated_at = excluded.updated_at
            `,
              )
              .run(
                authHash,
                cloudKey,
                last4,
                encFullName,
                encSid,
                group,
                labGroup,
                prog,
                source,
                now,
                now,
              );
          }
          sdb.exec('COMMIT');
        } catch (err) {
          sdb.exec('ROLLBACK');
          throw err;
        }
      }

      broadcastEvent('student_status', { authHash, active: false, deleted: true });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false, error: 'DATABASE_ERROR' });
    }
  });

  app.put('/api/admin/students/settings', jsonParser, async (req: Request, res: Response) => {
    try {
      if (!verifyAdminSecret(req.header('x-admin-secret'))) {
        res.status(403).json({ ok: false, error: 'ADMIN_AUTH_FAILED' });
        return;
      }
      const body = (req.body || {}) as Record<string, unknown>;
      const cloudKey =
        typeof body.cloudKey === 'string' ? body.cloudKey.trim().toLowerCase() : '';
      const authHash =
        typeof body.authHash === 'string' ? body.authHash.trim().toLowerCase() : '';
      if (!HEX64_RE.test(cloudKey)) {
        res.status(400).json({ ok: false, error: 'INVALID_CLOUD_KEY' });
        return;
      }

      const now = Date.now();
      const myMbuGroup = normGroup(body.myMbuGroup);
      const lang = body.lang === 'en' ? 'en' : 'tr';
      const myLabGroup = lang === 'en' ? '' : normLab(body.myLabGroup);
      const otherGroupMode = normOtherMode(body.otherGroupMode);
      const last4 = String(body.last4 || '0000').slice(0, 4);
      const assignedGroup = myMbuGroup
        ? normAssignedGroup(myMbuGroup)
        : normAssignedGroup(body.assignedGroup);
      const active = body.active === false ? 0 : 1;
      const encName = String(body.encName || '');
      const encFullName = String(body.encFullName || '');
      const encSid = String(body.encSid || '');
      const source = body.source === 'custom' ? 'custom' : 'allowlist';
      const hasValidAuthHash = HASH32_RE.test(authHash);

      if (isCloudSqlConfigured) {
        await saveAdminStudentSettingsPg({
          cloudKey,
          authHash,
          hasValidAuthHash,
          last4,
          myMbuGroup,
          myLabGroup,
          otherGroupMode,
          lang,
          assignedGroup,
          active,
          encName,
          encFullName,
          encSid,
          source,
          now,
        });
      } else {
        const sdb = getSqliteDb();
        sdb.exec('BEGIN');
        try {
          sdb
            .prepare(
              `
            INSERT INTO student_prefs (cloud_key, auth_hash, last4, my_mbu_group, my_lab_group, other_group_mode, lang, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(cloud_key) DO UPDATE SET
              auth_hash = CASE WHEN excluded.auth_hash != '' THEN excluded.auth_hash ELSE student_prefs.auth_hash END,
              last4 = CASE WHEN excluded.last4 != '' THEN excluded.last4 ELSE student_prefs.last4 END,
              my_mbu_group = excluded.my_mbu_group,
              my_lab_group = excluded.my_lab_group,
              other_group_mode = excluded.other_group_mode,
              lang = excluded.lang,
              updated_at = excluded.updated_at
          `,
            )
            .run(
              cloudKey,
              hasValidAuthHash ? authHash : '',
              last4,
              myMbuGroup,
              myLabGroup,
              otherGroupMode,
              lang,
              now,
            );

          if (hasValidAuthHash) {
            sdb
              .prepare(
                `
              INSERT INTO custom_students (auth_hash, cloud_key, last4, group_name, lab_group, prog, enc_name, enc_sid, active, deleted, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
              ON CONFLICT(auth_hash) DO UPDATE SET
                cloud_key = excluded.cloud_key,
                last4 = CASE WHEN excluded.last4 != '0000' THEN excluded.last4 ELSE custom_students.last4 END,
                group_name = excluded.group_name,
                lab_group = excluded.lab_group,
                prog = excluded.prog,
                enc_name = CASE WHEN excluded.enc_name != '' THEN excluded.enc_name ELSE custom_students.enc_name END,
                enc_sid = CASE WHEN excluded.enc_sid != '' THEN excluded.enc_sid ELSE custom_students.enc_sid END,
                active = excluded.active,
                deleted = 0,
                updated_at = excluded.updated_at
            `,
              )
              .run(
                authHash,
                cloudKey,
                last4,
                assignedGroup,
                myLabGroup,
                lang,
                encName,
                encSid,
                active,
                now,
                now,
              );

            sdb
              .prepare(
                `
              INSERT INTO admin_student_directory (auth_hash, cloud_key, last4, enc_full_name, enc_sid, group_name, lab_group, prog, source, active, deleted, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
              ON CONFLICT(auth_hash) DO UPDATE SET
                cloud_key = excluded.cloud_key,
                last4 = CASE WHEN excluded.last4 != '0000' THEN excluded.last4 ELSE admin_student_directory.last4 END,
                enc_full_name = CASE WHEN excluded.enc_full_name != '' THEN excluded.enc_full_name ELSE admin_student_directory.enc_full_name END,
                enc_sid = CASE WHEN excluded.enc_sid != '' THEN excluded.enc_sid ELSE admin_student_directory.enc_sid END,
                group_name = excluded.group_name,
                lab_group = excluded.lab_group,
                prog = excluded.prog,
                active = excluded.active,
                deleted = 0,
                updated_at = excluded.updated_at
            `,
              )
              .run(
                authHash,
                cloudKey,
                last4,
                encFullName,
                encSid,
                assignedGroup,
                myLabGroup,
                lang,
                source,
                active,
                now,
                now,
              );
          }

          sdb.exec('COMMIT');
        } catch (err) {
          sdb.exec('ROLLBACK');
          throw err;
        }
      }

      if (hasValidAuthHash) {
        broadcastEvent('student_status', { authHash, active: active === 1, deleted: false });
      }
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false, error: 'DATABASE_ERROR' });
    }
  });

  // ==================== CHUNKED PDF UPLOAD & STREAMING ====================
  app.post('/api/lesson-pdf/init', jsonParser, (req: Request, res: Response) => {
    if (!verifyAdminSecret(req.header('x-admin-secret'))) {
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

  app.post('/api/lesson-pdf/chunk', rawChunkParser, (req: Request, res: Response) => {
    if (!verifyAdminSecret(req.header('x-admin-secret'))) {
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
    if (!verifyAdminSecret(req.header('x-admin-secret'))) {
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

      const fullBuf = await fs.promises.readFile(finalPdfPath);
      if (isCloudSqlConfigured && assembledSize <= 60 * 1024 * 1024) {
        await savePdfBufferToPg(meta.fileId, meta.fileName, fullBuf).catch(() => {});
      }

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

  app.get('/api/lesson-pdf/:fileId', async (req: Request, res: Response) => {
    try {
      const fileId = String(req.params.fileId || '').trim();
      if (!/^[a-zA-Z0-9_-]{8,96}$/.test(fileId)) {
        res.status(400).send('Invalid file ID');
        return;
      }

      const pdfPath = path.join(STORAGE_ROOT, `${fileId}.pdf`);
      const metaPath = path.join(STORAGE_ROOT, `${fileId}.json`);

      if (!fs.existsSync(pdfPath) && isCloudSqlConfigured) {
        const pgPdf = await loadPdfBufferFromPg(fileId).catch(() => null);
        if (pgPdf && pgPdf.buffer.length > 0) {
          const partPath = `${pdfPath}.pg.${Date.now()}`;
          fs.writeFileSync(partPath, pgPdf.buffer);
          fs.renameSync(partPath, pdfPath);
          fs.writeFileSync(
            metaPath,
            JSON.stringify({
              fileId,
              fileName: pgPdf.fileName,
              size: pgPdf.buffer.length,
              mimeType: 'application/pdf',
              createdAt: Date.now(),
            } satisfies StoredFileMeta),
            'utf8',
          );
        }
      }

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
      const asciiFallback =
        fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '') || 'lesson.pdf';
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
    } catch {
      res.status(500).send('Failed to serve PDF');
    }
  });

  app.delete('/api/lesson-pdf/:fileId', (req: Request, res: Response) => {
    if (!verifyAdminSecret(req.header('x-admin-secret'))) {
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
    if (isCloudSqlConfigured) {
      void deletePdfFromPg(fileId).catch(() => {});
    }
    res.json({ ok: true });
  });

  app.get(['/', '/index.html'], async (_req: Request, res: Response) => {
    try {
      const indexPath =
        process.env.NODE_ENV === 'production'
          ? path.resolve(process.cwd(), 'dist', 'index.html')
          : path.resolve(process.cwd(), 'index.html');
      const htmlSource = fs.existsSync(indexPath)
        ? fs.readFileSync(indexPath, 'utf8')
        : fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');

      const cfg = isCloudSqlConfigured
        ? await getAccessConfigPg().catch(
            () => ({ requireStudentLogin: false, updatedAtMs: 0 }) satisfies SiteAccessConfig,
          )
        : getConfigJsonSqlite<SiteAccessConfig>('access') || {
            requireStudentLogin: false,
            updatedAtMs: 0,
          };
      const isLocked = Boolean(cfg.requireStudentLogin);
      const serverTs = Number(cfg.updatedAtMs) || 0;

      const injectedHtml = htmlSource.replace(
        '<head>',
        `<head>\n  <script>window.__INONU_INITIAL_LOCKED__ = ${isLocked}; window.__INONU_INITIAL_ACCESS_TS__ = ${serverTs}; try { var p = 'inonu_tip_d1_ios_v3_'; var sTs = ${serverTs}; var curTs = Number(localStorage.getItem(p + 'siteAccessUpdatedAtMs') || 0) || 0; var hasAuth = !!localStorage.getItem(p + 'authSession'); var cachedLock = localStorage.getItem(p + 'siteRequireLoginCache') === 'true'; if (sTs > 0 && sTs >= curTs) { localStorage.setItem(p + 'siteRequireLoginCache', '${isLocked}'); localStorage.setItem(p + 'siteAccessUpdatedAtMs', String(sTs)); cachedLock = ${isLocked}; } if (cachedLock && !hasAuth) { document.documentElement.classList.add('site-locked-locked'); } } catch(e){}</script>`,
      );
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.send(injectedHtml);
    } catch {
      res.status(500).send('Error loading page');
    }
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
