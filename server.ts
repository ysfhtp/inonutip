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
  getAllAnnouncementsRawPg,
  getAllMaterialsRawPg,
  getConfigJsonPg,
  getSecurityConfigPg,
  getStudentLoginStatusPg,
  getStudentPrefsPg,
  listAnnouncementsPg,
  listMaterialsPg,
  loadAllAdminStudentsPg,
  loadPdfBufferFromPg,
  lookupStudentForAdminPg,
  mergeRemoteAnnouncementsIntoPg,
  mergeRemoteMaterialsIntoPg,
  mergeRemoteStudentsIntoPg,
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

// ==================== OPTIONAL SUPABASE STORAGE & STATE SYNC ====================
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SUPABASE_KEY = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  ''
).trim();
const SUPABASE_BUCKET =
  (process.env.SUPABASE_STORAGE_BUCKET || 'lesson-pdfs').trim() || 'lesson-pdfs';
const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);
const SUPABASE_PULL_TTL_MS = 2000;

type SupabaseKvDomain =
  | 'access'
  | 'security'
  | 'announcements'
  | 'materials'
  | 'custom_students'
  | 'admin_dir'
  | 'student_prefs';

function encodeStorageObjectPath(objName: string): string {
  return objName
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function supabaseHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    ...extra,
  };
}

async function ensureSupabaseBucket(): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: 'POST',
      headers: supabaseHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        id: SUPABASE_BUCKET,
        name: SUPABASE_BUCKET,
        public: false,
        file_size_limit: MAX_PDF_BYTES,
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // Bucket may already exist or permissions managed in Supabase dashboard
  }
}

async function uploadPdfBufferToSupabase(
  fileId: string,
  pdfBuf: Buffer,
  meta: StoredFileMeta,
): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  try {
    await ensureSupabaseBucket();
    const pdfKey = encodeStorageObjectPath(`${fileId}.pdf`);
    const resp = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${pdfKey}`,
      {
        method: 'POST',
        headers: supabaseHeaders({
          'Content-Type': 'application/pdf',
          'x-upsert': 'true',
        }),
        body: new Uint8Array(pdfBuf),
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!resp.ok) return false;

    const metaKey = encodeStorageObjectPath(`${fileId}.json`);
    void fetch(
      `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${metaKey}`,
      {
        method: 'POST',
        headers: supabaseHeaders({
          'Content-Type': 'application/json',
          'x-upsert': 'true',
        }),
        body: JSON.stringify(meta),
        signal: AbortSignal.timeout(8000),
      },
    ).catch(() => {});

    return true;
  } catch {
    return false;
  }
}

async function fetchPdfFromSupabaseToLocal(
  fileId: string,
  destPdfPath: string,
  destMetaPath: string,
): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  try {
    const pdfKey = encodeStorageObjectPath(`${fileId}.pdf`);
    const resp = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${pdfKey}`,
      {
        headers: supabaseHeaders(),
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!resp.ok) return false;
    const arrBuf = await resp.arrayBuffer();
    const buf = Buffer.from(arrBuf);
    if (buf.length < 1) return false;
    const partPath = `${destPdfPath}.dl.${Date.now()}`;
    fs.writeFileSync(partPath, buf);
    fs.renameSync(partPath, destPdfPath);

    try {
      const metaKey = encodeStorageObjectPath(`${fileId}.json`);
      const mResp = await fetch(
        `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${metaKey}`,
        {
          headers: supabaseHeaders(),
          signal: AbortSignal.timeout(5000),
        },
      );
      if (mResp.ok) {
        const metaText = await mResp.text();
        fs.writeFileSync(destMetaPath, metaText, 'utf8');
      }
    } catch {
      // Optional metadata file
    }
    return true;
  } catch {
    return false;
  }
}

async function deletePdfFromSupabase(fileId: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}`, {
      method: 'DELETE',
      headers: supabaseHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefixes: [`${fileId}.pdf`, `${fileId}.json`] }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // Best-effort cleanup
  }
}

async function pushSupabaseKv(key: string, value: unknown): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/inonu_kv?on_conflict=key`, {
      method: 'POST',
      headers: supabaseHeaders({
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      }),
      body: JSON.stringify({ key, value, updated_at: Date.now() }),
      signal: AbortSignal.timeout(4500),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

async function pullSupabaseKvAll(): Promise<Record<string, { value: unknown; updated_at: number }> | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/inonu_kv?select=key,value,updated_at`, {
      headers: supabaseHeaders(),
      signal: AbortSignal.timeout(4500),
    });
    if (!resp.ok) return null;
    const rows = (await resp.json()) as Array<{
      key?: string;
      value?: unknown;
      updated_at?: number;
    }>;
    if (!Array.isArray(rows)) return null;
    const out: Record<string, { value: unknown; updated_at: number }> = {};
    for (const r of rows) {
      if (r && typeof r.key === 'string') {
        out[r.key] = { value: r.value, updated_at: Number(r.updated_at) || 0 };
      }
    }
    return out;
  } catch {
    return null;
  }
}

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

// ==================== SUPABASE SYNC BRIDGE ====================
async function getSupabaseDomainPayload(domain: SupabaseKvDomain): Promise<unknown> {
  if (isCloudSqlConfigured) {
    switch (domain) {
      case 'access':
        return getAccessConfigPg();
      case 'security':
        return getSecurityConfigPg();
      case 'announcements':
        return getAllAnnouncementsRawPg();
      case 'materials':
        return getAllMaterialsRawPg();
      case 'custom_students':
        return (await loadAllAdminStudentsPg()).custom;
      case 'admin_dir':
        return (await loadAllAdminStudentsPg()).directory;
      case 'student_prefs':
        return (await loadAllAdminStudentsPg()).prefs;
    }
  }

  const sdb = getSqliteDb();
  switch (domain) {
    case 'access':
      return getConfigJsonSqlite<SiteAccessConfig>('access') || { requireStudentLogin: false, updatedAtMs: 0 };
    case 'security':
      return (
        getConfigJsonSqlite<AdminSecurityConfig>('security') || {
          passwordHash: DEFAULT_ADMIN_PASSWORD_HASH,
          proofDigestB64: DEFAULT_PROOF_DIGEST_B64,
          updatedAtMs: 0,
        }
      );
    case 'announcements':
      return sdb.prepare('SELECT * FROM announcements').all();
    case 'materials': {
      const rows = sdb.prepare('SELECT * FROM lesson_materials').all() as Array<Record<string, unknown>>;
      return rows.map((r) => {
        if (typeof r.pdf_data === 'string' && r.pdf_data.length > 32_768 && typeof r.pdf_url === 'string' && r.pdf_url) {
          return { ...r, pdf_data: '' };
        }
        return r;
      });
    }
    case 'custom_students':
      return sdb.prepare('SELECT * FROM custom_students').all();
    case 'admin_dir':
      return sdb.prepare('SELECT * FROM admin_student_directory').all();
    case 'student_prefs':
      return sdb.prepare('SELECT * FROM student_prefs').all();
  }
}

async function pushDomainToSupabase(domain: SupabaseKvDomain): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  try {
    const payload = await getSupabaseDomainPayload(domain);
    return await pushSupabaseKv(domain, payload);
  } catch {
    return false;
  }
}

async function mergeRemoteKvIntoDb(
  kv: Record<string, { value: unknown; updated_at: number }>,
): Promise<{
  accessChanged: boolean;
  accessVal?: SiteAccessConfig;
  materialsChanged: boolean;
  announcementsChanged: boolean;
  studentsChanged: Array<{ authHash: string; active: boolean; deleted: boolean }>;
}> {
  let accessChanged = false;
  let nextAccessVal: SiteAccessConfig | undefined;
  let materialsChanged = false;
  let announcementsChanged = false;
  let studentsChanged: Array<{ authHash: string; active: boolean; deleted: boolean }> = [];

  try {
    const remoteAccess = kv.access?.value as Partial<SiteAccessConfig> | undefined;
    if (remoteAccess && typeof remoteAccess === 'object') {
      const cur = isCloudSqlConfigured
        ? await getConfigJsonPg<SiteAccessConfig>('access')
        : getConfigJsonSqlite<SiteAccessConfig>('access');
      const remoteTs = Number(remoteAccess.updatedAtMs) || 0;
      const localTs = Number(cur?.updatedAtMs) || 0;
      if (remoteTs > localTs) {
        const nextCfg: SiteAccessConfig = {
          requireStudentLogin: Boolean(remoteAccess.requireStudentLogin),
          updatedAtMs: remoteTs,
        };
        if (isCloudSqlConfigured) {
          await setConfigJsonPg('access', nextCfg, remoteTs);
        } else {
          setConfigJsonSqlite('access', nextCfg);
        }
        accessChanged = true;
        nextAccessVal = nextCfg;
      }
    }

    const remoteSec = kv.security?.value as Partial<AdminSecurityConfig> | undefined;
    if (
      remoteSec &&
      typeof remoteSec === 'object' &&
      typeof remoteSec.passwordHash === 'string' &&
      /^[a-f0-9]{64}$/.test(remoteSec.passwordHash) &&
      typeof remoteSec.proofDigestB64 === 'string' &&
      remoteSec.proofDigestB64.length === 44
    ) {
      const curSec = isCloudSqlConfigured
        ? await getConfigJsonPg<AdminSecurityConfig>('security')
        : getConfigJsonSqlite<AdminSecurityConfig>('security');
      const remoteTs = Number(remoteSec.updatedAtMs) || Number(kv.security?.updated_at) || 0;
      const localTs = Number(curSec?.updatedAtMs) || 0;
      const localIsDefault = !curSec || curSec.passwordHash === DEFAULT_ADMIN_PASSWORD_HASH;
      const remoteIsCustom = remoteSec.passwordHash !== DEFAULT_ADMIN_PASSWORD_HASH;
      if (remoteTs > localTs || (localIsDefault && remoteIsCustom)) {
        const nextSec: AdminSecurityConfig = {
          passwordHash: remoteSec.passwordHash,
          proofDigestB64: remoteSec.proofDigestB64,
          wrappedRosterKey:
            typeof remoteSec.wrappedRosterKey === 'string' &&
            /^[a-f0-9]{64}$/.test(remoteSec.wrappedRosterKey)
              ? remoteSec.wrappedRosterKey
              : curSec?.wrappedRosterKey,
          updatedAtMs: remoteTs,
        };
        if (isCloudSqlConfigured) {
          await setConfigJsonPg('security', nextSec, remoteTs);
        } else {
          setConfigJsonSqlite('security', nextSec);
        }
      }
    }

    const mats = kv.materials?.value as Array<Record<string, unknown>> | undefined;
    const anns = kv.announcements?.value as Array<Record<string, unknown>> | undefined;
    const customs = kv.custom_students?.value as Array<Record<string, unknown>> | undefined;
    const dirs = kv.admin_dir?.value as Array<Record<string, unknown>> | undefined;
    const prefs = kv.student_prefs?.value as Array<Record<string, unknown>> | undefined;

    if (isCloudSqlConfigured) {
      if (Array.isArray(mats)) {
        materialsChanged = await mergeRemoteMaterialsIntoPg(mats);
      }
      if (Array.isArray(anns)) {
        announcementsChanged = await mergeRemoteAnnouncementsIntoPg(anns);
      }
      if (Array.isArray(customs) || Array.isArray(dirs) || Array.isArray(prefs)) {
        studentsChanged = await mergeRemoteStudentsIntoPg({ customs, dirs, prefs });
      }
    } else {
      const sdb = getSqliteDb();
      if (Array.isArray(mats)) {
        const prevMatStats = sdb
          .prepare('SELECT COUNT(*) AS cnt, COALESCE(MAX(updated_at), 0) AS mx FROM lesson_materials')
          .get() as { cnt?: number; mx?: number } | undefined;
        const stmt = sdb.prepare(`
          INSERT INTO lesson_materials
          (id, date, slot_no, target_prog, title, source_type, pdf_url, pdf_data, chunk_count, pdf_name, file_size, deleted, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            date = CASE WHEN excluded.updated_at >= lesson_materials.updated_at THEN excluded.date ELSE lesson_materials.date END,
            slot_no = CASE WHEN excluded.updated_at >= lesson_materials.updated_at THEN excluded.slot_no ELSE lesson_materials.slot_no END,
            target_prog = CASE WHEN excluded.updated_at >= lesson_materials.updated_at THEN excluded.target_prog ELSE lesson_materials.target_prog END,
            title = CASE WHEN excluded.updated_at >= lesson_materials.updated_at THEN excluded.title ELSE lesson_materials.title END,
            source_type = CASE WHEN excluded.updated_at >= lesson_materials.updated_at THEN excluded.source_type ELSE lesson_materials.source_type END,
            pdf_url = CASE WHEN excluded.updated_at >= lesson_materials.updated_at THEN excluded.pdf_url ELSE lesson_materials.pdf_url END,
            pdf_data = CASE WHEN excluded.updated_at >= lesson_materials.updated_at AND excluded.pdf_data != '' THEN excluded.pdf_data ELSE lesson_materials.pdf_data END,
            chunk_count = CASE WHEN excluded.updated_at >= lesson_materials.updated_at THEN excluded.chunk_count ELSE lesson_materials.chunk_count END,
            pdf_name = CASE WHEN excluded.updated_at >= lesson_materials.updated_at THEN excluded.pdf_name ELSE lesson_materials.pdf_name END,
            file_size = CASE WHEN excluded.updated_at >= lesson_materials.updated_at THEN excluded.file_size ELSE lesson_materials.file_size END,
            deleted = CASE WHEN excluded.updated_at >= lesson_materials.updated_at THEN excluded.deleted ELSE lesson_materials.deleted END,
            updated_at = MAX(lesson_materials.updated_at, excluded.updated_at)
        `);
        for (const m of mats) {
          if (!m || typeof m.id !== 'string') continue;
          stmt.run(
            m.id,
            String(m.date || ''),
            Number(m.slot_no ?? m.slotNo) || 1,
            String(m.target_prog ?? m.targetProg ?? ''),
            String(m.title || 'PDF'),
            String(m.source_type ?? m.sourceType ?? 'server'),
            String(m.pdf_url ?? m.pdfUrl ?? ''),
            String(m.pdf_data ?? m.pdfData ?? ''),
            Number(m.chunk_count ?? m.chunkCount) || 0,
            String(m.pdf_name ?? m.pdfName ?? ''),
            Number(m.file_size ?? m.fileSize) || 0,
            Number(m.deleted) ? 1 : 0,
            Number(m.created_at ?? m.createdAtMs) || Date.now(),
            Number(m.updated_at ?? m.updatedAtMs) || Date.now(),
          );
        }
        const nextMatStats = sdb
          .prepare('SELECT COUNT(*) AS cnt, COALESCE(MAX(updated_at), 0) AS mx FROM lesson_materials')
          .get() as { cnt?: number; mx?: number } | undefined;
        if (
          (Number(nextMatStats?.cnt) || 0) !== (Number(prevMatStats?.cnt) || 0) ||
          (Number(nextMatStats?.mx) || 0) > (Number(prevMatStats?.mx) || 0)
        ) {
          materialsChanged = true;
        }
      }

      if (Array.isArray(anns)) {
        const prevAnnStats = sdb
          .prepare('SELECT COUNT(*) AS cnt, COALESCE(MAX(updated_at), 0) AS mx FROM announcements')
          .get() as { cnt?: number; mx?: number } | undefined;
        const stmt = sdb.prepare(`
          INSERT INTO announcements (id, title, message, tone, active, target_group, target_prog, deleted, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = CASE WHEN excluded.updated_at >= announcements.updated_at THEN excluded.title ELSE announcements.title END,
            message = CASE WHEN excluded.updated_at >= announcements.updated_at THEN excluded.message ELSE announcements.message END,
            tone = CASE WHEN excluded.updated_at >= announcements.updated_at THEN excluded.tone ELSE announcements.tone END,
            active = CASE WHEN excluded.updated_at >= announcements.updated_at THEN excluded.active ELSE announcements.active END,
            target_group = CASE WHEN excluded.updated_at >= announcements.updated_at THEN excluded.target_group ELSE announcements.target_group END,
            target_prog = CASE WHEN excluded.updated_at >= announcements.updated_at THEN excluded.target_prog ELSE announcements.target_prog END,
            deleted = CASE WHEN excluded.updated_at >= announcements.updated_at THEN excluded.deleted ELSE announcements.deleted END,
            updated_at = MAX(announcements.updated_at, excluded.updated_at)
        `);
        for (const a of anns) {
          if (!a || typeof a.id !== 'string') continue;
          stmt.run(
            a.id,
            String(a.title || ''),
            String(a.message || ''),
            String(a.tone || 'info'),
            Number(a.active) ? 1 : 0,
            String(a.target_group ?? a.targetGroup ?? ''),
            String(a.target_prog ?? a.targetProg ?? ''),
            Number(a.deleted) ? 1 : 0,
            Number(a.created_at ?? a.createdAtMs) || Date.now(),
            Number(a.updated_at ?? a.updatedAtMs) || Date.now(),
          );
        }
        const nextAnnStats = sdb
          .prepare('SELECT COUNT(*) AS cnt, COALESCE(MAX(updated_at), 0) AS mx FROM announcements')
          .get() as { cnt?: number; mx?: number } | undefined;
        if (
          (Number(nextAnnStats?.cnt) || 0) !== (Number(prevAnnStats?.cnt) || 0) ||
          (Number(nextAnnStats?.mx) || 0) > (Number(prevAnnStats?.mx) || 0)
        ) {
          announcementsChanged = true;
        }
      }

      if (Array.isArray(customs)) {
        const prevCustomStats = sdb
          .prepare('SELECT COALESCE(MAX(updated_at), 0) AS mx FROM custom_students')
          .get() as { mx?: number } | undefined;
        const prevMax = Number(prevCustomStats?.mx) || 0;
        const stmt = sdb.prepare(`
          INSERT INTO custom_students
          (auth_hash, cloud_key, last4, group_name, lab_group, prog, enc_name, enc_sid, active, deleted, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(auth_hash) DO UPDATE SET
            cloud_key = CASE WHEN excluded.updated_at >= custom_students.updated_at THEN excluded.cloud_key ELSE custom_students.cloud_key END,
            last4 = CASE WHEN excluded.updated_at >= custom_students.updated_at THEN excluded.last4 ELSE custom_students.last4 END,
            group_name = CASE WHEN excluded.updated_at >= custom_students.updated_at THEN excluded.group_name ELSE custom_students.group_name END,
            lab_group = CASE WHEN excluded.updated_at >= custom_students.updated_at THEN excluded.lab_group ELSE custom_students.lab_group END,
            prog = CASE WHEN excluded.updated_at >= custom_students.updated_at THEN excluded.prog ELSE custom_students.prog END,
            enc_name = CASE WHEN excluded.updated_at >= custom_students.updated_at AND excluded.enc_name != '' THEN excluded.enc_name ELSE custom_students.enc_name END,
            enc_sid = CASE WHEN excluded.updated_at >= custom_students.updated_at AND excluded.enc_sid != '' THEN excluded.enc_sid ELSE custom_students.enc_sid END,
            active = CASE WHEN excluded.updated_at >= custom_students.updated_at THEN excluded.active ELSE custom_students.active END,
            deleted = CASE WHEN excluded.updated_at >= custom_students.updated_at THEN excluded.deleted ELSE custom_students.deleted END,
            updated_at = MAX(custom_students.updated_at, excluded.updated_at)
        `);
        for (const c of customs) {
          if (!c || typeof c.auth_hash !== 'string' || !HASH32_RE.test(c.auth_hash)) continue;
          const ts = Number(c.updated_at) || Date.now();
          const isActive = Number(c.active) !== 0 && c.active !== false;
          const isDeleted = Number(c.deleted) === 1 || c.deleted === true;
          stmt.run(
            c.auth_hash,
            String(c.cloud_key || ''),
            String(c.last4 || ''),
            String(c.group_name || 'I'),
            String(c.lab_group || ''),
            String(c.prog || 'tr'),
            String(c.enc_name || ''),
            String(c.enc_sid || ''),
            isActive ? 1 : 0,
            isDeleted ? 1 : 0,
            Number(c.created_at) || Date.now(),
            ts,
          );
          if (ts > prevMax && (!isActive || isDeleted)) {
            studentsChanged.push({ authHash: c.auth_hash, active: isActive, deleted: isDeleted });
          }
        }
      }

      if (Array.isArray(dirs)) {
        const prevDirStats = sdb
          .prepare('SELECT COALESCE(MAX(updated_at), 0) AS mx FROM admin_student_directory')
          .get() as { mx?: number } | undefined;
        const prevMax = Number(prevDirStats?.mx) || 0;
        const stmt = sdb.prepare(`
          INSERT INTO admin_student_directory
          (auth_hash, cloud_key, last4, enc_full_name, enc_sid, group_name, lab_group, prog, source, active, deleted, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(auth_hash) DO UPDATE SET
            cloud_key = CASE WHEN excluded.updated_at >= admin_student_directory.updated_at THEN excluded.cloud_key ELSE admin_student_directory.cloud_key END,
            last4 = CASE WHEN excluded.updated_at >= admin_student_directory.updated_at THEN excluded.last4 ELSE admin_student_directory.last4 END,
            enc_full_name = CASE WHEN excluded.updated_at >= admin_student_directory.updated_at AND excluded.enc_full_name != '' THEN excluded.enc_full_name ELSE admin_student_directory.enc_full_name END,
            enc_sid = CASE WHEN excluded.updated_at >= admin_student_directory.updated_at AND excluded.enc_sid != '' THEN excluded.enc_sid ELSE admin_student_directory.enc_sid END,
            group_name = CASE WHEN excluded.updated_at >= admin_student_directory.updated_at THEN excluded.group_name ELSE admin_student_directory.group_name END,
            lab_group = CASE WHEN excluded.updated_at >= admin_student_directory.updated_at THEN excluded.lab_group ELSE admin_student_directory.lab_group END,
            prog = CASE WHEN excluded.updated_at >= admin_student_directory.updated_at THEN excluded.prog ELSE admin_student_directory.prog END,
            source = CASE WHEN excluded.updated_at >= admin_student_directory.updated_at THEN excluded.source ELSE admin_student_directory.source END,
            active = CASE WHEN excluded.updated_at >= admin_student_directory.updated_at THEN excluded.active ELSE admin_student_directory.active END,
            deleted = CASE WHEN excluded.updated_at >= admin_student_directory.updated_at THEN excluded.deleted ELSE admin_student_directory.deleted END,
            updated_at = MAX(admin_student_directory.updated_at, excluded.updated_at)
        `);
        for (const d of dirs) {
          if (!d || typeof d.auth_hash !== 'string' || !HASH32_RE.test(d.auth_hash)) continue;
          const ts = Number(d.updated_at) || Date.now();
          const isActive = Number(d.active) !== 0 && d.active !== false;
          const isDeleted = Number(d.deleted) === 1 || d.deleted === true;
          stmt.run(
            d.auth_hash,
            String(d.cloud_key || ''),
            String(d.last4 || ''),
            String(d.enc_full_name || ''),
            String(d.enc_sid || ''),
            String(d.group_name || 'I'),
            String(d.lab_group || ''),
            String(d.prog || 'tr'),
            String(d.source || 'allowlist'),
            isActive ? 1 : 0,
            isDeleted ? 1 : 0,
            Number(d.created_at) || Date.now(),
            ts,
          );
          if (ts > prevMax && (!isActive || isDeleted)) {
            studentsChanged.push({ authHash: d.auth_hash, active: isActive, deleted: isDeleted });
          }
        }
      }

      if (Array.isArray(prefs)) {
        const stmt = sdb.prepare(`
          INSERT INTO student_prefs
          (cloud_key, auth_hash, last4, my_mbu_group, my_lab_group, other_group_mode, lang, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(cloud_key) DO UPDATE SET
            auth_hash = CASE WHEN excluded.updated_at >= student_prefs.updated_at AND excluded.auth_hash != '' THEN excluded.auth_hash ELSE student_prefs.auth_hash END,
            last4 = CASE WHEN excluded.updated_at >= student_prefs.updated_at AND excluded.last4 != '' THEN excluded.last4 ELSE student_prefs.last4 END,
            my_mbu_group = CASE WHEN excluded.updated_at >= student_prefs.updated_at THEN excluded.my_mbu_group ELSE student_prefs.my_mbu_group END,
            my_lab_group = CASE WHEN excluded.updated_at >= student_prefs.updated_at THEN excluded.my_lab_group ELSE student_prefs.my_lab_group END,
            other_group_mode = CASE WHEN excluded.updated_at >= student_prefs.updated_at THEN excluded.other_group_mode ELSE student_prefs.other_group_mode END,
            lang = CASE WHEN excluded.updated_at >= student_prefs.updated_at AND excluded.lang != '' THEN excluded.lang ELSE student_prefs.lang END,
            updated_at = MAX(student_prefs.updated_at, excluded.updated_at)
        `);
        for (const p of prefs) {
          if (!p || typeof p.cloud_key !== 'string' || !HEX64_RE.test(p.cloud_key)) continue;
          stmt.run(
            p.cloud_key,
            String(p.auth_hash || ''),
            String(p.last4 || ''),
            String(p.my_mbu_group || ''),
            String(p.my_lab_group || ''),
            String(p.other_group_mode || 'dim'),
            String(p.lang || ''),
            Number(p.updated_at) || Date.now(),
          );
        }
      }
    }
  } catch {
    // Non-fatal merge error
  }

  return {
    accessChanged,
    accessVal: nextAccessVal,
    materialsChanged,
    announcementsChanged,
    studentsChanged,
  };
}

let lastSupabasePullAt = 0;
let inflightSupabasePull: Promise<void> | null = null;

async function ensureFreshSupabaseSync(force = false): Promise<void> {
  if (!isSupabaseConfigured) return;
  const now = Date.now();
  if (!force && now - lastSupabasePullAt < SUPABASE_PULL_TTL_MS) {
    return;
  }
  if (inflightSupabasePull) {
    return inflightSupabasePull;
  }
  inflightSupabasePull = (async () => {
    try {
      const kv = await pullSupabaseKvAll();
      lastSupabasePullAt = Date.now();
      if (!kv) return;
      const res = await mergeRemoteKvIntoDb(kv);
      if (res.accessChanged && res.accessVal) {
        broadcastEvent('access', res.accessVal);
      }
      if (res.materialsChanged) {
        broadcastEvent('materials', { source: 'supabase_sync' });
      }
      if (res.announcementsChanged) {
        broadcastEvent('announcements', { source: 'supabase_sync' });
      }
      for (const stu of res.studentsChanged) {
        broadcastEvent('student_status', stu);
      }
    } catch {
      // Non-fatal pull error
    } finally {
      inflightSupabasePull = null;
    }
  })();
  return inflightSupabasePull;
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

if (isSupabaseConfigured) {
  setInterval(() => {
    if (sseClients.size > 0) {
      void ensureFreshSupabaseSync(true);
    }
  }, 3000);
}

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
      await ensureFreshSupabaseSync();
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
      await pushDomainToSupabase('security');
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false, error: 'DATABASE_ERROR' });
    }
  });

  // ==================== SITE ACCESS SETTINGS ====================
  app.get('/api/access', async (_req: Request, res: Response) => {
    try {
      await ensureFreshSupabaseSync();
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
      await pushDomainToSupabase('access');
      broadcastEvent('access', { requireStudentLogin, updatedAtMs });
      res.json({ ok: true, requireStudentLogin, updatedAtMs });
    } catch {
      res.status(500).json({ ok: false, error: 'DATABASE_ERROR' });
    }
  });

  // ==================== STUDENT LOGIN CHECK & PREFS ====================
  app.get('/api/student/login-status/:authHash', async (req: Request, res: Response) => {
    try {
      await ensureFreshSupabaseSync();
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
      await ensureFreshSupabaseSync();
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

      await pushDomainToSupabase('student_prefs');
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false, error: 'DATABASE_ERROR' });
    }
  });

  // ==================== ANNOUNCEMENTS ====================
  app.get('/api/announcements', async (req: Request, res: Response) => {
    try {
      await ensureFreshSupabaseSync();
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
      await pushDomainToSupabase('announcements');
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
      await pushDomainToSupabase('announcements');
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false, error: 'DATABASE_ERROR' });
    }
  });

  // ==================== LESSON MATERIALS & PDFs ====================
  app.get('/api/materials', async (_req: Request, res: Response) => {
    try {
      await ensureFreshSupabaseSync();
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
      await pushDomainToSupabase('materials');
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

      await pushDomainToSupabase('materials');

      if (existingPdfUrl && existingPdfUrl.startsWith('/api/lesson-pdf/')) {
        const fileId = existingPdfUrl.slice('/api/lesson-pdf/'.length).split('?')[0].trim();
        if (/^[a-zA-Z0-9_-]{8,96}$/.test(fileId)) {
          fs.rmSync(path.join(STORAGE_ROOT, `${fileId}.pdf`), { force: true });
          fs.rmSync(path.join(STORAGE_ROOT, `${fileId}.json`), { force: true });
          if (isCloudSqlConfigured) {
            void deletePdfFromPg(fileId).catch(() => {});
          }
          void deletePdfFromSupabase(fileId);
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
      await ensureFreshSupabaseSync();
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
      await ensureFreshSupabaseSync();
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

      await Promise.all([
        pushDomainToSupabase('custom_students'),
        pushDomainToSupabase('admin_dir'),
        pushDomainToSupabase('student_prefs'),
      ]);
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

      await Promise.all([
        pushDomainToSupabase('custom_students'),
        pushDomainToSupabase('admin_dir'),
      ]);
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

      await Promise.all([
        pushDomainToSupabase('student_prefs'),
        pushDomainToSupabase('custom_students'),
        pushDomainToSupabase('admin_dir'),
      ]);
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
      if (isSupabaseConfigured) {
        await uploadPdfBufferToSupabase(meta.fileId, fullBuf, storedMeta);
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

      if (!fs.existsSync(pdfPath) && isSupabaseConfigured) {
        await fetchPdfFromSupabaseToLocal(fileId, pdfPath, metaPath);
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
    void deletePdfFromSupabase(fileId);
    res.json({ ok: true });
  });

  app.get(['/', '/index.html'], async (_req: Request, res: Response) => {
    try {
      await ensureFreshSupabaseSync();
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
