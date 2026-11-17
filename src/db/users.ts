import { and, eq } from 'drizzle-orm';
import { db } from './index.ts';
import { userNotes, users } from './schema.ts';

export async function getOrCreateUser(uid: string, email: string) {
  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database query failed (getOrCreateUser):', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function getUserNotesByUid(uid: string) {
  try {
    return await db
      .select({
        id: userNotes.id,
        slotKey: userNotes.slotKey,
        content: userNotes.content,
        updatedAt: userNotes.updatedAt,
      })
      .from(userNotes)
      .innerJoin(users, eq(userNotes.userId, users.id))
      .where(eq(users.uid, uid));
  } catch (error) {
    console.error('Database query failed (getUserNotesByUid):', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function upsertUserNote(
  uid: string,
  email: string,
  slotKey: string,
  content: string,
) {
  try {
    const user = await getOrCreateUser(uid, email);
    const now = Date.now();
    const result = await db
      .insert(userNotes)
      .values({
        userId: user.id,
        slotKey,
        content,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [userNotes.userId, userNotes.slotKey],
        set: {
          content,
          updatedAt: now,
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database query failed (upsertUserNote):', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function deleteUserNoteBySlot(uid: string, slotKey: string) {
  try {
    const userRows = await db.select().from(users).where(eq(users.uid, uid));
    const user = userRows[0];
    if (!user) return;
    await db
      .delete(userNotes)
      .where(and(eq(userNotes.userId, user.id), eq(userNotes.slotKey, slotKey)));
  } catch (error) {
    console.error('Database query failed (deleteUserNoteBySlot):', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}
