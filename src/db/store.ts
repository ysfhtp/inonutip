import { and, asc, desc, eq, max, sql } from 'drizzle-orm';
import { db, withPgRetry } from './index.ts';
import {
  adminConfig,
  adminStudentDirectory,
  announcements,
  customStudents,
  lessonMaterials,
  lessonPdfChunks,
  studentPrefs,
} from './schema.ts';

export interface AdminSecurityConfig {
  passwordHash: string;
  proofDigestB64: string;
  wrappedRosterKey?: string;
  updatedAtMs?: number;
}

export interface SiteAccessConfig {
  requireStudentLogin: boolean;
  updatedAtMs: number;
}

export const DEFAULT_ADMIN_PASSWORD_HASH =
  '25be9d153053e43e3de8b19857b85e4cd3d806568ba6e19ed5c9106f5821d527';
export const DEFAULT_PROOF_DIGEST_B64 = 'NYixg8m6D55ww5bflL1j5si5a9Yb3lurTyAKeAOKDEs=';

const PDF_CHUNK_BYTES = 512 * 1024; // 512 KB binary chunks in PostgreSQL

function wrapDbError(op: string, error: unknown): never {
  console.error(`Database query failed (${op}):`, error);
  throw new Error('Database query failed. Please try again later.', { cause: error });
}

async function runPg<T>(op: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await withPgRetry(fn);
  } catch (error) {
    wrapDbError(op, error);
  }
}

const CONFIG_CACHE_TTL_MS = 5000;
const configMemoryCache = new Map<string, { value: unknown; expiresAt: number }>();

let defaultConfigsEnsured = false;
let ensureDefaultConfigsPromise: Promise<void> | null = null;

export async function getConfigJsonPg<T>(key: string): Promise<T | null> {
  const cached = configMemoryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T;
  }
  return runPg(`getConfigJsonPg:${key}`, async () => {
    const rows = await db.select().from(adminConfig).where(eq(adminConfig.key, key));
    const row = rows[0];
    if (!row || typeof row.value !== 'string') return null;
    try {
      const parsed = JSON.parse(row.value) as T;
      configMemoryCache.set(key, { value: parsed, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
      return parsed;
    } catch {
      return null;
    }
  });
}

export async function setConfigJsonPg(key: string, value: unknown, updatedAtMs?: number): Promise<void> {
  configMemoryCache.delete(key);
  await runPg(`setConfigJsonPg:${key}`, async () => {
    const now = updatedAtMs ?? Date.now();
    const serialized = JSON.stringify(value);
    await db
      .insert(adminConfig)
      .values({ key, value: serialized, updatedAt: now })
      .onConflictDoUpdate({
        target: adminConfig.key,
        set: { value: serialized, updatedAt: now },
      });
  });
  configMemoryCache.set(key, { value, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
}

export async function ensureDefaultConfigsPg(): Promise<void> {
  if (defaultConfigsEnsured) return;
  if (!ensureDefaultConfigsPromise) {
    ensureDefaultConfigsPromise = runPg('ensureDefaultConfigsPg', async () => {
      await db
        .insert(adminConfig)
        .values([
          {
            key: 'security',
            value: JSON.stringify({
              passwordHash: DEFAULT_ADMIN_PASSWORD_HASH,
              proofDigestB64: DEFAULT_PROOF_DIGEST_B64,
              updatedAtMs: 0,
            } satisfies AdminSecurityConfig),
            updatedAt: 0,
          },
          {
            key: 'access',
            value: JSON.stringify({
              requireStudentLogin: false,
              updatedAtMs: 0,
            } satisfies SiteAccessConfig),
            updatedAt: 0,
          },
        ])
        .onConflictDoNothing();
      defaultConfigsEnsured = true;
    }).finally(() => {
      ensureDefaultConfigsPromise = null;
    });
  }
  await ensureDefaultConfigsPromise;
}

export async function getSecurityConfigPg(): Promise<AdminSecurityConfig> {
  let cfg = await getConfigJsonPg<AdminSecurityConfig>('security');
  if (!cfg) {
    await ensureDefaultConfigsPg();
    cfg = await getConfigJsonPg<AdminSecurityConfig>('security');
  }
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
    updatedAtMs: Number(cfg?.updatedAtMs) || 0,
  };
}

export async function getAccessConfigPg(): Promise<SiteAccessConfig> {
  let cfg = await getConfigJsonPg<SiteAccessConfig>('access');
  if (!cfg) {
    await ensureDefaultConfigsPg();
    cfg = await getConfigJsonPg<SiteAccessConfig>('access');
  }
  return {
    requireStudentLogin: Boolean(cfg?.requireStudentLogin),
    updatedAtMs: Number(cfg?.updatedAtMs) || 0,
  };
}

// ==================== STUDENT LOGIN STATUS & PREFS ====================
export async function getStudentLoginStatusPg(authHash: string) {
  return runPg('getStudentLoginStatusPg', async () => {
    const [customRows, dirRows] = await Promise.all([
      db.select().from(customStudents).where(eq(customStudents.authHash, authHash)),
      db.select().from(adminStudentDirectory).where(eq(adminStudentDirectory.authHash, authHash)),
    ]);
    return {
      custom: customRows[0] ?? null,
      directory: dirRows[0] ?? null,
    };
  });
}

export async function getStudentPrefsPg(cloudKey: string) {
  return runPg('getStudentPrefsPg', async () => {
    const rows = await db.select().from(studentPrefs).where(eq(studentPrefs.cloudKey, cloudKey));
    return rows[0] ?? null;
  });
}

export async function upsertStudentPrefsPg(input: {
  cloudKey: string;
  authHash: string;
  last4: string;
  myMbuGroup: string;
  myLabGroup: string;
  otherGroupMode: string;
  lang: string;
  updatedAt: number;
}): Promise<void> {
  await runPg('upsertStudentPrefsPg', async () => {
    await db
      .insert(studentPrefs)
      .values({
        cloudKey: input.cloudKey,
        authHash: input.authHash,
        last4: input.last4,
        myMbuGroup: input.myMbuGroup,
        myLabGroup: input.myLabGroup,
        otherGroupMode: input.otherGroupMode,
        lang: input.lang,
        updatedAt: input.updatedAt,
      })
      .onConflictDoUpdate({
        target: studentPrefs.cloudKey,
        set: {
          authHash: input.authHash
            ? input.authHash
            : sql`${studentPrefs.authHash}`,
          last4: input.last4 ? input.last4 : sql`${studentPrefs.last4}`,
          myMbuGroup: input.myMbuGroup,
          myLabGroup: input.myLabGroup,
          otherGroupMode: input.otherGroupMode,
          lang: input.lang ? input.lang : sql`${studentPrefs.lang}`,
          updatedAt: input.updatedAt,
        },
      });
  });
}

// ==================== ANNOUNCEMENTS ====================
export async function listAnnouncementsPg(onlyActive: boolean) {
  return runPg('listAnnouncementsPg', async () => {
    const whereClause = onlyActive
      ? and(eq(announcements.deleted, 0), eq(announcements.active, 1))
      : eq(announcements.deleted, 0);

    return await db
      .select()
      .from(announcements)
      .where(whereClause)
      .orderBy(desc(announcements.updatedAt), desc(announcements.createdAt));
  });
}

export async function saveAnnouncementPg(input: {
  id: string;
  title: string;
  message: string;
  tone: string;
  active: number;
  targetGroup: string;
  targetProg: string;
  now: number;
}) {
  return runPg('saveAnnouncementPg', async () => {
    const existingRows = await db
      .select({ createdAt: announcements.createdAt })
      .from(announcements)
      .where(eq(announcements.id, input.id));
    const createdAt = existingRows[0]?.createdAt || input.now;

    await db
      .insert(announcements)
      .values({
        id: input.id,
        title: input.title,
        message: input.message,
        tone: input.tone,
        active: input.active,
        targetGroup: input.targetGroup,
        targetProg: input.targetProg,
        deleted: 0,
        createdAt,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: announcements.id,
        set: {
          title: input.title,
          message: input.message,
          tone: input.tone,
          active: input.active,
          targetGroup: input.targetGroup,
          targetProg: input.targetProg,
          deleted: 0,
          updatedAt: input.now,
        },
      });

    return { createdAt, updatedAt: input.now };
  });
}

export async function deleteAnnouncementPg(id: string, now: number): Promise<void> {
  await runPg('deleteAnnouncementPg', async () => {
    await db
      .update(announcements)
      .set({ deleted: 1, active: 0, updatedAt: now })
      .where(eq(announcements.id, id));
  });
}

// ==================== LESSON MATERIALS & CHUNKS ====================
export async function listMaterialsPg() {
  return runPg('listMaterialsPg', async () => {
    return await db
      .select()
      .from(lessonMaterials)
      .where(eq(lessonMaterials.deleted, 0))
      .orderBy(asc(lessonMaterials.createdAt), asc(lessonMaterials.updatedAt));
  });
}

export async function saveMaterialPg(input: {
  id: string;
  date: string;
  slotNo: number;
  targetProg: string;
  title: string;
  sourceType: string;
  pdfUrl: string;
  pdfData: string;
  chunkCount: number;
  pdfName: string;
  fileSize: number;
  now: number;
}) {
  return runPg('saveMaterialPg', async () => {
    const existingRows = await db
      .select({ createdAt: lessonMaterials.createdAt })
      .from(lessonMaterials)
      .where(eq(lessonMaterials.id, input.id));
    const createdAt = existingRows[0]?.createdAt || input.now;

    await db
      .insert(lessonMaterials)
      .values({
        id: input.id,
        date: input.date,
        slotNo: input.slotNo,
        targetProg: input.targetProg,
        title: input.title,
        sourceType: input.sourceType,
        pdfUrl: input.pdfUrl,
        pdfData: input.pdfData,
        chunkCount: input.chunkCount,
        pdfName: input.pdfName,
        fileSize: input.fileSize,
        deleted: 0,
        createdAt,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: lessonMaterials.id,
        set: {
          date: input.date,
          slotNo: input.slotNo,
          targetProg: input.targetProg,
          title: input.title,
          sourceType: input.sourceType,
          pdfUrl: input.pdfUrl,
          pdfData: input.pdfData,
          chunkCount: input.chunkCount,
          pdfName: input.pdfName,
          fileSize: input.fileSize,
          deleted: 0,
          updatedAt: input.now,
        },
      });

    return { createdAt, updatedAt: input.now };
  });
}

export async function deleteMaterialPg(id: string, now: number): Promise<{ pdfUrl: string }> {
  return runPg('deleteMaterialPg', async () => {
    const rows = await db
      .select({ pdfUrl: lessonMaterials.pdfUrl })
      .from(lessonMaterials)
      .where(eq(lessonMaterials.id, id));
    await db
      .update(lessonMaterials)
      .set({ deleted: 1, updatedAt: now })
      .where(eq(lessonMaterials.id, id));
    return { pdfUrl: rows[0]?.pdfUrl || '' };
  });
}

export async function savePdfBufferToPg(
  fileId: string,
  fileName: string,
  buf: Buffer,
): Promise<void> {
  await runPg('savePdfBufferToPg', async () => {
    const now = Date.now();
    const totalChunks = Math.max(1, Math.ceil(buf.length / PDF_CHUNK_BYTES));
    await db.transaction(async (tx) => {
      await tx.delete(lessonPdfChunks).where(eq(lessonPdfChunks.fileId, fileId));
      for (let i = 0; i < totalChunks; i++) {
        const start = i * PDF_CHUNK_BYTES;
        const end = Math.min(buf.length, start + PDF_CHUNK_BYTES);
        const slice = buf.subarray(start, end);
        await tx.insert(lessonPdfChunks).values({
          chunkKey: `${fileId}_${i}`,
          fileId,
          chunkIndex: i,
          fileName: i === 0 ? fileName : '',
          fileSize: i === 0 ? buf.length : 0,
          dataB64: slice.toString('base64'),
          createdAt: now,
        });
      }
    });
  });
}

export async function loadPdfBufferFromPg(
  fileId: string,
): Promise<{ buffer: Buffer; fileName: string } | null> {
  return runPg('loadPdfBufferFromPg', async () => {
    const rows = await db
      .select()
      .from(lessonPdfChunks)
      .where(eq(lessonPdfChunks.fileId, fileId))
      .orderBy(asc(lessonPdfChunks.chunkIndex));
    if (!rows.length) return null;
    const buffers = rows.map((r) => Buffer.from(r.dataB64, 'base64'));
    const fileName = rows.find((r) => r.fileName)?.fileName || `${fileId}.pdf`;
    return { buffer: Buffer.concat(buffers), fileName };
  });
}

export async function deletePdfFromPg(fileId: string): Promise<void> {
  await runPg('deletePdfFromPg', async () => {
    await db.delete(lessonPdfChunks).where(eq(lessonPdfChunks.fileId, fileId));
  });
}

// ==================== ADMIN STUDENT DIRECTORY ====================
export async function loadAllAdminStudentsPg() {
  return runPg('loadAllAdminStudentsPg', async () => {
    const [directory, custom, prefs] = await Promise.all([
      db.select().from(adminStudentDirectory),
      db.select().from(customStudents),
      db.select().from(studentPrefs),
    ]);
    return {
      directory: directory.map((d) => ({
        auth_hash: d.authHash,
        cloud_key: d.cloudKey,
        last4: d.last4,
        enc_full_name: d.encFullName,
        enc_sid: d.encSid,
        group_name: d.groupName,
        lab_group: d.labGroup,
        prog: d.prog,
        source: d.source,
        active: d.active,
        deleted: d.deleted,
        created_at: d.createdAt,
        updated_at: d.updatedAt,
      })),
      custom: custom.map((c) => ({
        auth_hash: c.authHash,
        cloud_key: c.cloudKey,
        last4: c.last4,
        group_name: c.groupName,
        lab_group: c.labGroup,
        prog: c.prog,
        enc_name: c.encName,
        enc_sid: c.encSid,
        active: c.active,
        deleted: c.deleted,
        created_at: c.createdAt,
        updated_at: c.updatedAt,
      })),
      prefs: prefs.map((p) => ({
        cloud_key: p.cloudKey,
        auth_hash: p.authHash,
        last4: p.last4,
        my_mbu_group: p.myMbuGroup,
        my_lab_group: p.myLabGroup,
        other_group_mode: p.otherGroupMode,
        lang: p.lang,
        updated_at: p.updatedAt,
      })),
    };
  });
}

export async function lookupStudentForAdminPg(authHash: string, cloudKey: string) {
  return runPg('lookupStudentForAdminPg', async () => {
    const [dirRows, customRows, prefRows] = await Promise.all([
      db.select().from(adminStudentDirectory).where(eq(adminStudentDirectory.authHash, authHash)),
      db.select().from(customStudents).where(eq(customStudents.authHash, authHash)),
      db.select().from(studentPrefs).where(eq(studentPrefs.cloudKey, cloudKey)),
    ]);
    const d = dirRows[0];
    const c = customRows[0];
    const p = prefRows[0];
    return {
      directory: d
        ? {
            auth_hash: d.authHash,
            cloud_key: d.cloudKey,
            last4: d.last4,
            enc_full_name: d.encFullName,
            enc_sid: d.encSid,
            group_name: d.groupName,
            lab_group: d.labGroup,
            prog: d.prog,
            source: d.source,
            active: d.active,
            deleted: d.deleted,
            created_at: d.createdAt,
            updated_at: d.updatedAt,
          }
        : null,
      custom: c
        ? {
            auth_hash: c.authHash,
            cloud_key: c.cloudKey,
            last4: c.last4,
            group_name: c.groupName,
            lab_group: c.labGroup,
            prog: c.prog,
            enc_name: c.encName,
            enc_sid: c.encSid,
            active: c.active,
            deleted: c.deleted,
            created_at: c.createdAt,
            updated_at: c.updatedAt,
          }
        : null,
      prefs: p
        ? {
            cloud_key: p.cloudKey,
            auth_hash: p.authHash,
            last4: p.last4,
            my_mbu_group: p.myMbuGroup,
            my_lab_group: p.myLabGroup,
            other_group_mode: p.otherGroupMode,
            lang: p.lang,
            updated_at: p.updatedAt,
          }
        : null,
    };
  });
}

export async function saveAdminStudentPg(input: {
  authHash: string;
  cloudKey: string;
  last4: string;
  group: string;
  labGroup: string;
  prog: string;
  otherGroupMode: string;
  encName: string;
  encFullName: string;
  encSid: string;
  source: string;
  active: number;
  now: number;
  rejectIfExists: boolean;
  builtInAllowlist: boolean;
}): Promise<{ conflict: boolean }> {
  return runPg('saveAdminStudentPg', async () => {
    return await db.transaction(async (tx) => {
      const [existingCustomRows, existingDirRows] = await Promise.all([
        tx.select().from(customStudents).where(eq(customStudents.authHash, input.authHash)),
        tx.select().from(adminStudentDirectory).where(eq(adminStudentDirectory.authHash, input.authHash)),
      ]);
      const existingCustom = existingCustomRows[0];
      const existingDir = existingDirRows[0];

      if (input.rejectIfExists) {
        const customLive = Boolean(existingCustom && existingCustom.deleted !== 1);
        const dirLive = Boolean(existingDir && existingDir.deleted !== 1);
        const customDeleted = Boolean(existingCustom && existingCustom.deleted === 1);
        const dirDeleted = Boolean(existingDir && existingDir.deleted === 1);
        const builtInNotDeleted = input.builtInAllowlist && !customDeleted && !dirDeleted;
        if (customLive || dirLive || builtInNotDeleted) {
          return { conflict: true };
        }
      }

      await tx
        .insert(customStudents)
        .values({
          authHash: input.authHash,
          cloudKey: input.cloudKey,
          last4: input.last4,
          groupName: input.group,
          labGroup: input.labGroup,
          prog: input.prog,
          encName: input.encName,
          encSid: input.encSid,
          active: input.active,
          deleted: 0,
          createdAt: existingCustom?.createdAt || input.now,
          updatedAt: input.now,
        })
        .onConflictDoUpdate({
          target: customStudents.authHash,
          set: {
            cloudKey: input.cloudKey,
            last4: input.last4,
            groupName: input.group,
            labGroup: input.labGroup,
            prog: input.prog,
            encName: input.encName ? input.encName : sql`${customStudents.encName}`,
            encSid: input.encSid ? input.encSid : sql`${customStudents.encSid}`,
            active: input.active,
            deleted: 0,
            updatedAt: input.now,
          },
        });

      await tx
        .insert(adminStudentDirectory)
        .values({
          authHash: input.authHash,
          cloudKey: input.cloudKey,
          last4: input.last4,
          encFullName: input.encFullName,
          encSid: input.encSid,
          groupName: input.group,
          labGroup: input.labGroup,
          prog: input.prog,
          source: input.source,
          active: input.active,
          deleted: 0,
          createdAt: existingDir?.createdAt || input.now,
          updatedAt: input.now,
        })
        .onConflictDoUpdate({
          target: adminStudentDirectory.authHash,
          set: {
            cloudKey: input.cloudKey,
            last4: input.last4,
            encFullName: input.encFullName
              ? input.encFullName
              : sql`${adminStudentDirectory.encFullName}`,
            encSid: input.encSid ? input.encSid : sql`${adminStudentDirectory.encSid}`,
            groupName: input.group,
            labGroup: input.labGroup,
            prog: input.prog,
            source: input.source,
            active: input.active,
            deleted: 0,
            updatedAt: input.now,
          },
        });

      await tx
        .insert(studentPrefs)
        .values({
          cloudKey: input.cloudKey,
          authHash: input.authHash,
          last4: input.last4,
          myMbuGroup: input.group,
          myLabGroup: input.labGroup,
          otherGroupMode: input.otherGroupMode,
          lang: input.prog,
          updatedAt: input.now,
        })
        .onConflictDoUpdate({
          target: studentPrefs.cloudKey,
          set: {
            authHash: input.authHash,
            last4: input.last4,
            myMbuGroup: input.group,
            myLabGroup: input.labGroup,
            otherGroupMode: input.otherGroupMode,
            lang: input.prog,
            updatedAt: input.now,
          },
        });

      return { conflict: false };
    });
  });
}

export async function deleteAdminStudentPg(input: {
  authHash: string;
  cloudKey: string;
  hasValidCloudKey: boolean;
  last4: string;
  group: string;
  labGroup: string;
  prog: string;
  encName: string;
  encFullName: string;
  encSid: string;
  source: string;
  now: number;
}): Promise<void> {
  await runPg('deleteAdminStudentPg', async () => {
    await db.transaction(async (tx) => {
      await tx
        .insert(customStudents)
        .values({
          authHash: input.authHash,
          cloudKey: input.cloudKey,
          last4: input.last4,
          groupName: input.group,
          labGroup: input.labGroup,
          prog: input.prog,
          encName: input.encName,
          encSid: input.encSid,
          active: 0,
          deleted: 1,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .onConflictDoUpdate({
          target: customStudents.authHash,
          set: {
            active: 0,
            deleted: 1,
            updatedAt: input.now,
          },
        });

      if (input.hasValidCloudKey) {
        await tx
          .insert(adminStudentDirectory)
          .values({
            authHash: input.authHash,
            cloudKey: input.cloudKey,
            last4: input.last4,
            encFullName: input.encFullName,
            encSid: input.encSid,
            groupName: input.group,
            labGroup: input.labGroup,
            prog: input.prog,
            source: input.source,
            active: 0,
            deleted: 1,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .onConflictDoUpdate({
            target: adminStudentDirectory.authHash,
            set: {
              active: 0,
              deleted: 1,
              updatedAt: input.now,
            },
          });
      }
    });
  });
}

export async function saveAdminStudentSettingsPg(input: {
  cloudKey: string;
  authHash: string;
  hasValidAuthHash: boolean;
  last4: string;
  myMbuGroup: string;
  myLabGroup: string;
  otherGroupMode: string;
  lang: string;
  assignedGroup: string;
  active: number;
  encName: string;
  encFullName: string;
  encSid: string;
  source: string;
  now: number;
}): Promise<void> {
  await runPg('saveAdminStudentSettingsPg', async () => {
    await db.transaction(async (tx) => {
      await tx
        .insert(studentPrefs)
        .values({
          cloudKey: input.cloudKey,
          authHash: input.hasValidAuthHash ? input.authHash : '',
          last4: input.last4,
          myMbuGroup: input.myMbuGroup,
          myLabGroup: input.myLabGroup,
          otherGroupMode: input.otherGroupMode,
          lang: input.lang,
          updatedAt: input.now,
        })
        .onConflictDoUpdate({
          target: studentPrefs.cloudKey,
          set: {
            authHash: input.hasValidAuthHash ? input.authHash : sql`${studentPrefs.authHash}`,
            last4: input.last4 ? input.last4 : sql`${studentPrefs.last4}`,
            myMbuGroup: input.myMbuGroup,
            myLabGroup: input.myLabGroup,
            otherGroupMode: input.otherGroupMode,
            lang: input.lang,
            updatedAt: input.now,
          },
        });

      if (input.hasValidAuthHash) {
        await tx
          .insert(customStudents)
          .values({
            authHash: input.authHash,
            cloudKey: input.cloudKey,
            last4: input.last4,
            groupName: input.assignedGroup,
            labGroup: input.myLabGroup,
            prog: input.lang,
            encName: input.encName,
            encSid: input.encSid,
            active: input.active,
            deleted: 0,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .onConflictDoUpdate({
            target: customStudents.authHash,
            set: {
              cloudKey: input.cloudKey,
              last4: input.last4 !== '0000' ? input.last4 : sql`${customStudents.last4}`,
              groupName: input.assignedGroup,
              labGroup: input.myLabGroup,
              prog: input.lang,
              encName: input.encName ? input.encName : sql`${customStudents.encName}`,
              encSid: input.encSid ? input.encSid : sql`${customStudents.encSid}`,
              active: input.active,
              deleted: 0,
              updatedAt: input.now,
            },
          });

        await tx
          .insert(adminStudentDirectory)
          .values({
            authHash: input.authHash,
            cloudKey: input.cloudKey,
            last4: input.last4,
            encFullName: input.encFullName,
            encSid: input.encSid,
            groupName: input.assignedGroup,
            labGroup: input.myLabGroup,
            prog: input.lang,
            source: input.source,
            active: input.active,
            deleted: 0,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .onConflictDoUpdate({
            target: adminStudentDirectory.authHash,
            set: {
              cloudKey: input.cloudKey,
              last4: input.last4 !== '0000' ? input.last4 : sql`${adminStudentDirectory.last4}`,
              encFullName: input.encFullName
                ? input.encFullName
                : sql`${adminStudentDirectory.encFullName}`,
              encSid: input.encSid ? input.encSid : sql`${adminStudentDirectory.encSid}`,
              groupName: input.assignedGroup,
              labGroup: input.myLabGroup,
              prog: input.lang,
              active: input.active,
              deleted: 0,
              updatedAt: input.now,
            },
          });
      }
    });
  });
}

// ==================== SUPABASE <-> CLOUD SQL MERGE HELPERS ====================
export async function getAllAnnouncementsRawPg() {
  return runPg('getAllAnnouncementsRawPg', async () => {
    const rows = await db.select().from(announcements);
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      message: r.message,
      tone: r.tone,
      active: r.active,
      target_group: r.targetGroup,
      target_prog: r.targetProg,
      deleted: r.deleted,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    }));
  });
}

export async function getAllMaterialsRawPg() {
  return runPg('getAllMaterialsRawPg', async () => {
    const rows = await db.select().from(lessonMaterials);
    return rows.map((r) => ({
      id: r.id,
      date: r.date,
      slot_no: r.slotNo,
      target_prog: r.targetProg,
      title: r.title,
      source_type: r.sourceType,
      pdf_url: r.pdfUrl,
      pdf_data: r.pdfData.length > 32_768 && r.pdfUrl ? '' : r.pdfData,
      chunk_count: r.chunkCount,
      pdf_name: r.pdfName,
      file_size: r.fileSize,
      deleted: r.deleted,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    }));
  });
}

export async function getMaterialStatsPg(): Promise<{ count: number; maxUpdatedAt: number }> {
  return runPg('getMaterialStatsPg', async () => {
    const rows = await db
      .select({
        count: sql<number>`count(*)::int`,
        maxUpdatedAt: max(lessonMaterials.updatedAt),
      })
      .from(lessonMaterials);
    return {
      count: Number(rows[0]?.count) || 0,
      maxUpdatedAt: Number(rows[0]?.maxUpdatedAt) || 0,
    };
  });
}

export async function getAnnouncementStatsPg(): Promise<{ count: number; maxUpdatedAt: number }> {
  return runPg('getAnnouncementStatsPg', async () => {
    const rows = await db
      .select({
        count: sql<number>`count(*)::int`,
        maxUpdatedAt: max(announcements.updatedAt),
      })
      .from(announcements);
    return {
      count: Number(rows[0]?.count) || 0,
      maxUpdatedAt: Number(rows[0]?.maxUpdatedAt) || 0,
    };
  });
}

export async function getStudentMaxUpdatedAtPg(): Promise<{ customMax: number; dirMax: number }> {
  return runPg('getStudentMaxUpdatedAtPg', async () => {
    const [cRows, dRows] = await Promise.all([
      db.select({ mx: max(customStudents.updatedAt) }).from(customStudents),
      db.select({ mx: max(adminStudentDirectory.updatedAt) }).from(adminStudentDirectory),
    ]);
    return {
      customMax: Number(cRows[0]?.mx) || 0,
      dirMax: Number(dRows[0]?.mx) || 0,
    };
  });
}

export async function mergeRemoteMaterialsIntoPg(mats: Array<Record<string, unknown>>): Promise<boolean> {
  return runPg('mergeRemoteMaterialsIntoPg', async () => {
    const prev = await getMaterialStatsPg();
    for (const m of mats) {
      if (!m || typeof m.id !== 'string') continue;
      const incomingUpdatedAt = Number(m.updated_at ?? m.updatedAtMs) || Date.now();
      const incomingPdfData = String(m.pdf_data ?? m.pdfData ?? '');
      await db
        .insert(lessonMaterials)
        .values({
          id: m.id,
          date: String(m.date || ''),
          slotNo: Number(m.slot_no ?? m.slotNo) || 1,
          targetProg: String(m.target_prog ?? m.targetProg ?? ''),
          title: String(m.title || 'PDF'),
          sourceType: String(m.source_type ?? m.sourceType ?? 'server'),
          pdfUrl: String(m.pdf_url ?? m.pdfUrl ?? ''),
          pdfData: incomingPdfData,
          chunkCount: Number(m.chunk_count ?? m.chunkCount) || 0,
          pdfName: String(m.pdf_name ?? m.pdfName ?? ''),
          fileSize: Number(m.file_size ?? m.fileSize) || 0,
          deleted: Number(m.deleted) ? 1 : 0,
          createdAt: Number(m.created_at ?? m.createdAtMs) || Date.now(),
          updatedAt: incomingUpdatedAt,
        })
        .onConflictDoUpdate({
          target: lessonMaterials.id,
          set: {
            date: sql`CASE WHEN ${incomingUpdatedAt} >= ${lessonMaterials.updatedAt} THEN ${String(m.date || '')} ELSE ${lessonMaterials.date} END`,
            slotNo: sql`CASE WHEN ${incomingUpdatedAt} >= ${lessonMaterials.updatedAt} THEN ${Number(m.slot_no ?? m.slotNo) || 1} ELSE ${lessonMaterials.slotNo} END`,
            targetProg: sql`CASE WHEN ${incomingUpdatedAt} >= ${lessonMaterials.updatedAt} THEN ${String(m.target_prog ?? m.targetProg ?? '')} ELSE ${lessonMaterials.targetProg} END`,
            title: sql`CASE WHEN ${incomingUpdatedAt} >= ${lessonMaterials.updatedAt} THEN ${String(m.title || 'PDF')} ELSE ${lessonMaterials.title} END`,
            sourceType: sql`CASE WHEN ${incomingUpdatedAt} >= ${lessonMaterials.updatedAt} THEN ${String(m.source_type ?? m.sourceType ?? 'server')} ELSE ${lessonMaterials.sourceType} END`,
            pdfUrl: sql`CASE WHEN ${incomingUpdatedAt} >= ${lessonMaterials.updatedAt} THEN ${String(m.pdf_url ?? m.pdfUrl ?? '')} ELSE ${lessonMaterials.pdfUrl} END`,
            pdfData: sql`CASE WHEN ${incomingUpdatedAt} >= ${lessonMaterials.updatedAt} AND ${incomingPdfData} != '' THEN ${incomingPdfData} ELSE ${lessonMaterials.pdfData} END`,
            chunkCount: sql`CASE WHEN ${incomingUpdatedAt} >= ${lessonMaterials.updatedAt} THEN ${Number(m.chunk_count ?? m.chunkCount) || 0} ELSE ${lessonMaterials.chunkCount} END`,
            pdfName: sql`CASE WHEN ${incomingUpdatedAt} >= ${lessonMaterials.updatedAt} THEN ${String(m.pdf_name ?? m.pdfName ?? '')} ELSE ${lessonMaterials.pdfName} END`,
            fileSize: sql`CASE WHEN ${incomingUpdatedAt} >= ${lessonMaterials.updatedAt} THEN ${Number(m.file_size ?? m.fileSize) || 0} ELSE ${lessonMaterials.fileSize} END`,
            deleted: sql`CASE WHEN ${incomingUpdatedAt} >= ${lessonMaterials.updatedAt} THEN ${Number(m.deleted) ? 1 : 0} ELSE ${lessonMaterials.deleted} END`,
            updatedAt: sql`GREATEST(${lessonMaterials.updatedAt}, ${incomingUpdatedAt})`,
          },
        });
    }
    const next = await getMaterialStatsPg();
    return next.count !== prev.count || next.maxUpdatedAt > prev.maxUpdatedAt;
  });
}

export async function mergeRemoteAnnouncementsIntoPg(anns: Array<Record<string, unknown>>): Promise<boolean> {
  return runPg('mergeRemoteAnnouncementsIntoPg', async () => {
    const prev = await getAnnouncementStatsPg();
    for (const a of anns) {
      if (!a || typeof a.id !== 'string') continue;
      const incomingUpdatedAt = Number(a.updated_at ?? a.updatedAtMs) || Date.now();
      await db
        .insert(announcements)
        .values({
          id: a.id,
          title: String(a.title || ''),
          message: String(a.message || ''),
          tone: String(a.tone || 'info'),
          active: Number(a.active) ? 1 : 0,
          targetGroup: String(a.target_group ?? a.targetGroup ?? ''),
          targetProg: String(a.target_prog ?? a.targetProg ?? ''),
          deleted: Number(a.deleted) ? 1 : 0,
          createdAt: Number(a.created_at ?? a.createdAtMs) || Date.now(),
          updatedAt: incomingUpdatedAt,
        })
        .onConflictDoUpdate({
          target: announcements.id,
          set: {
            title: sql`CASE WHEN ${incomingUpdatedAt} >= ${announcements.updatedAt} THEN ${String(a.title || '')} ELSE ${announcements.title} END`,
            message: sql`CASE WHEN ${incomingUpdatedAt} >= ${announcements.updatedAt} THEN ${String(a.message || '')} ELSE ${announcements.message} END`,
            tone: sql`CASE WHEN ${incomingUpdatedAt} >= ${announcements.updatedAt} THEN ${String(a.tone || 'info')} ELSE ${announcements.tone} END`,
            active: sql`CASE WHEN ${incomingUpdatedAt} >= ${announcements.updatedAt} THEN ${Number(a.active) ? 1 : 0} ELSE ${announcements.active} END`,
            targetGroup: sql`CASE WHEN ${incomingUpdatedAt} >= ${announcements.updatedAt} THEN ${String(a.target_group ?? a.targetGroup ?? '')} ELSE ${announcements.targetGroup} END`,
            targetProg: sql`CASE WHEN ${incomingUpdatedAt} >= ${announcements.updatedAt} THEN ${String(a.target_prog ?? a.targetProg ?? '')} ELSE ${announcements.targetProg} END`,
            deleted: sql`CASE WHEN ${incomingUpdatedAt} >= ${announcements.updatedAt} THEN ${Number(a.deleted) ? 1 : 0} ELSE ${announcements.deleted} END`,
            updatedAt: sql`GREATEST(${announcements.updatedAt}, ${incomingUpdatedAt})`,
          },
        });
    }
    const next = await getAnnouncementStatsPg();
    return next.count !== prev.count || next.maxUpdatedAt > prev.maxUpdatedAt;
  });
}

export async function mergeRemoteStudentsIntoPg(input: {
  customs?: Array<Record<string, unknown>>;
  dirs?: Array<Record<string, unknown>>;
  prefs?: Array<Record<string, unknown>>;
}): Promise<Array<{ authHash: string; active: boolean; deleted: boolean }>> {
  const hash32Re = /^[a-f0-9]{32}$/;
  const hex64Re = /^[a-f0-9]{64}$/;

  return runPg('mergeRemoteStudentsIntoPg', async () => {
    const studentsChanged: Array<{ authHash: string; active: boolean; deleted: boolean }> = [];
    const prevMax = await getStudentMaxUpdatedAtPg();

    if (Array.isArray(input.customs)) {
      for (const c of input.customs) {
        if (!c || typeof c.auth_hash !== 'string' || !hash32Re.test(c.auth_hash)) continue;
        const ts = Number(c.updated_at) || Date.now();
        const isActive = Number(c.active) !== 0 && c.active !== false;
        const isDeleted = Number(c.deleted) === 1 || c.deleted === true;
        const encName = String(c.enc_name || '');
        const encSid = String(c.enc_sid || '');
        await db
          .insert(customStudents)
          .values({
            authHash: c.auth_hash,
            cloudKey: String(c.cloud_key || ''),
            last4: String(c.last4 || ''),
            groupName: String(c.group_name || 'I'),
            labGroup: String(c.lab_group || ''),
            prog: String(c.prog || 'tr'),
            encName,
            encSid,
            active: isActive ? 1 : 0,
            deleted: isDeleted ? 1 : 0,
            createdAt: Number(c.created_at) || Date.now(),
            updatedAt: ts,
          })
          .onConflictDoUpdate({
            target: customStudents.authHash,
            set: {
              cloudKey: sql`CASE WHEN ${ts} >= ${customStudents.updatedAt} THEN ${String(c.cloud_key || '')} ELSE ${customStudents.cloudKey} END`,
              last4: sql`CASE WHEN ${ts} >= ${customStudents.updatedAt} THEN ${String(c.last4 || '')} ELSE ${customStudents.last4} END`,
              groupName: sql`CASE WHEN ${ts} >= ${customStudents.updatedAt} THEN ${String(c.group_name || 'I')} ELSE ${customStudents.groupName} END`,
              labGroup: sql`CASE WHEN ${ts} >= ${customStudents.updatedAt} THEN ${String(c.lab_group || '')} ELSE ${customStudents.labGroup} END`,
              prog: sql`CASE WHEN ${ts} >= ${customStudents.updatedAt} THEN ${String(c.prog || 'tr')} ELSE ${customStudents.prog} END`,
              encName: sql`CASE WHEN ${ts} >= ${customStudents.updatedAt} AND ${encName} != '' THEN ${encName} ELSE ${customStudents.encName} END`,
              encSid: sql`CASE WHEN ${ts} >= ${customStudents.updatedAt} AND ${encSid} != '' THEN ${encSid} ELSE ${customStudents.encSid} END`,
              active: sql`CASE WHEN ${ts} >= ${customStudents.updatedAt} THEN ${isActive ? 1 : 0} ELSE ${customStudents.active} END`,
              deleted: sql`CASE WHEN ${ts} >= ${customStudents.updatedAt} THEN ${isDeleted ? 1 : 0} ELSE ${customStudents.deleted} END`,
              updatedAt: sql`GREATEST(${customStudents.updatedAt}, ${ts})`,
            },
          });
        if (ts > prevMax.customMax && (!isActive || isDeleted)) {
          studentsChanged.push({ authHash: c.auth_hash, active: isActive, deleted: isDeleted });
        }
      }
    }

    if (Array.isArray(input.dirs)) {
      for (const d of input.dirs) {
        if (!d || typeof d.auth_hash !== 'string' || !hash32Re.test(d.auth_hash)) continue;
        const ts = Number(d.updated_at) || Date.now();
        const isActive = Number(d.active) !== 0 && d.active !== false;
        const isDeleted = Number(d.deleted) === 1 || d.deleted === true;
        const encFullName = String(d.enc_full_name || '');
        const encSid = String(d.enc_sid || '');
        await db
          .insert(adminStudentDirectory)
          .values({
            authHash: d.auth_hash,
            cloudKey: String(d.cloud_key || ''),
            last4: String(d.last4 || ''),
            encFullName,
            encSid,
            groupName: String(d.group_name || 'I'),
            labGroup: String(d.lab_group || ''),
            prog: String(d.prog || 'tr'),
            source: String(d.source || 'allowlist'),
            active: isActive ? 1 : 0,
            deleted: isDeleted ? 1 : 0,
            createdAt: Number(d.created_at) || Date.now(),
            updatedAt: ts,
          })
          .onConflictDoUpdate({
            target: adminStudentDirectory.authHash,
            set: {
              cloudKey: sql`CASE WHEN ${ts} >= ${adminStudentDirectory.updatedAt} THEN ${String(d.cloud_key || '')} ELSE ${adminStudentDirectory.cloudKey} END`,
              last4: sql`CASE WHEN ${ts} >= ${adminStudentDirectory.updatedAt} THEN ${String(d.last4 || '')} ELSE ${adminStudentDirectory.last4} END`,
              encFullName: sql`CASE WHEN ${ts} >= ${adminStudentDirectory.updatedAt} AND ${encFullName} != '' THEN ${encFullName} ELSE ${adminStudentDirectory.encFullName} END`,
              encSid: sql`CASE WHEN ${ts} >= ${adminStudentDirectory.updatedAt} AND ${encSid} != '' THEN ${encSid} ELSE ${adminStudentDirectory.encSid} END`,
              groupName: sql`CASE WHEN ${ts} >= ${adminStudentDirectory.updatedAt} THEN ${String(d.group_name || 'I')} ELSE ${adminStudentDirectory.groupName} END`,
              labGroup: sql`CASE WHEN ${ts} >= ${adminStudentDirectory.updatedAt} THEN ${String(d.lab_group || '')} ELSE ${adminStudentDirectory.labGroup} END`,
              prog: sql`CASE WHEN ${ts} >= ${adminStudentDirectory.updatedAt} THEN ${String(d.prog || 'tr')} ELSE ${adminStudentDirectory.prog} END`,
              source: sql`CASE WHEN ${ts} >= ${adminStudentDirectory.updatedAt} THEN ${String(d.source || 'allowlist')} ELSE ${adminStudentDirectory.source} END`,
              active: sql`CASE WHEN ${ts} >= ${adminStudentDirectory.updatedAt} THEN ${isActive ? 1 : 0} ELSE ${adminStudentDirectory.active} END`,
              deleted: sql`CASE WHEN ${ts} >= ${adminStudentDirectory.updatedAt} THEN ${isDeleted ? 1 : 0} ELSE ${adminStudentDirectory.deleted} END`,
              updatedAt: sql`GREATEST(${adminStudentDirectory.updatedAt}, ${ts})`,
            },
          });
        if (ts > prevMax.dirMax && (!isActive || isDeleted)) {
          studentsChanged.push({ authHash: d.auth_hash, active: isActive, deleted: isDeleted });
        }
      }
    }

    if (Array.isArray(input.prefs)) {
      for (const p of input.prefs) {
        if (!p || typeof p.cloud_key !== 'string' || !hex64Re.test(p.cloud_key)) continue;
        const ts = Number(p.updated_at) || Date.now();
        const authHash = String(p.auth_hash || '');
        const last4 = String(p.last4 || '');
        const lang = String(p.lang || '');
        await db
          .insert(studentPrefs)
          .values({
            cloudKey: p.cloud_key,
            authHash,
            last4,
            myMbuGroup: String(p.my_mbu_group || ''),
            myLabGroup: String(p.my_lab_group || ''),
            otherGroupMode: String(p.other_group_mode || 'dim'),
            lang,
            updatedAt: ts,
          })
          .onConflictDoUpdate({
            target: studentPrefs.cloudKey,
            set: {
              authHash: sql`CASE WHEN ${ts} >= ${studentPrefs.updatedAt} AND ${authHash} != '' THEN ${authHash} ELSE ${studentPrefs.authHash} END`,
              last4: sql`CASE WHEN ${ts} >= ${studentPrefs.updatedAt} AND ${last4} != '' THEN ${last4} ELSE ${studentPrefs.last4} END`,
              myMbuGroup: sql`CASE WHEN ${ts} >= ${studentPrefs.updatedAt} THEN ${String(p.my_mbu_group || '')} ELSE ${studentPrefs.myMbuGroup} END`,
              myLabGroup: sql`CASE WHEN ${ts} >= ${studentPrefs.updatedAt} THEN ${String(p.my_lab_group || '')} ELSE ${studentPrefs.myLabGroup} END`,
              otherGroupMode: sql`CASE WHEN ${ts} >= ${studentPrefs.updatedAt} THEN ${String(p.other_group_mode || 'dim')} ELSE ${studentPrefs.otherGroupMode} END`,
              lang: sql`CASE WHEN ${ts} >= ${studentPrefs.updatedAt} AND ${lang} != '' THEN ${lang} ELSE ${studentPrefs.lang} END`,
              updatedAt: sql`GREATEST(${studentPrefs.updatedAt}, ${ts})`,
            },
          });
      }
    }

    return studentsChanged;
  });
}
