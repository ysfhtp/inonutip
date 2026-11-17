import { relations } from 'drizzle-orm';
import {
  bigint,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const userNotes = pgTable(
  'user_notes',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    slotKey: text('slot_key').notNull(),
    content: text('content').notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull().default(0),
  },
  (table) => [uniqueIndex('user_notes_user_slot_idx').on(table.userId, table.slotKey)],
);

export const usersRelations = relations(users, ({ many }) => ({
  notes: many(userNotes),
}));

export const userNotesRelations = relations(userNotes, ({ one }) => ({
  author: one(users, {
    fields: [userNotes.userId],
    references: [users.id],
  }),
}));

export const adminConfig = pgTable('admin_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull().default(0),
});

export const announcements = pgTable('announcements', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  tone: text('tone').notNull().default('info'),
  active: integer('active').notNull().default(1),
  targetGroup: text('target_group').notNull().default(''),
  targetProg: text('target_prog').notNull().default(''),
  deleted: integer('deleted').notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull().default(0),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull().default(0),
});

export const lessonMaterials = pgTable('lesson_materials', {
  id: text('id').primaryKey(),
  date: text('date').notNull(),
  slotNo: integer('slot_no').notNull().default(1),
  targetProg: text('target_prog').notNull().default(''),
  title: text('title').notNull(),
  sourceType: text('source_type').notNull().default('url'),
  pdfUrl: text('pdf_url').notNull().default(''),
  pdfData: text('pdf_data').notNull().default(''),
  chunkCount: integer('chunk_count').notNull().default(0),
  pdfName: text('pdf_name').notNull().default(''),
  fileSize: integer('file_size').notNull().default(0),
  deleted: integer('deleted').notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull().default(0),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull().default(0),
});

export const lessonPdfChunks = pgTable('lesson_pdf_chunks', {
  chunkKey: text('chunk_key').primaryKey(),
  fileId: text('file_id').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  fileName: text('file_name').notNull().default(''),
  fileSize: integer('file_size').notNull().default(0),
  dataB64: text('data_b64').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull().default(0),
});

export const customStudents = pgTable('custom_students', {
  authHash: text('auth_hash').primaryKey(),
  cloudKey: text('cloud_key').notNull().default(''),
  last4: text('last4').notNull().default(''),
  groupName: text('group_name').notNull().default('I'),
  labGroup: text('lab_group').notNull().default(''),
  prog: text('prog').notNull().default('tr'),
  encName: text('enc_name').notNull().default(''),
  encSid: text('enc_sid').notNull().default(''),
  active: integer('active').notNull().default(1),
  deleted: integer('deleted').notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull().default(0),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull().default(0),
});

export const adminStudentDirectory = pgTable('admin_student_directory', {
  authHash: text('auth_hash').primaryKey(),
  cloudKey: text('cloud_key').notNull().default(''),
  last4: text('last4').notNull().default(''),
  encFullName: text('enc_full_name').notNull().default(''),
  encSid: text('enc_sid').notNull().default(''),
  groupName: text('group_name').notNull().default('I'),
  labGroup: text('lab_group').notNull().default(''),
  prog: text('prog').notNull().default('tr'),
  source: text('source').notNull().default('allowlist'),
  active: integer('active').notNull().default(1),
  deleted: integer('deleted').notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull().default(0),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull().default(0),
});

export const studentPrefs = pgTable('student_prefs', {
  cloudKey: text('cloud_key').primaryKey(),
  authHash: text('auth_hash').notNull().default(''),
  last4: text('last4').notNull().default(''),
  myMbuGroup: text('my_mbu_group').notNull().default(''),
  myLabGroup: text('my_lab_group').notNull().default(''),
  otherGroupMode: text('other_group_mode').notNull().default('dim'),
  lang: text('lang').notNull().default(''),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull().default(0),
});
