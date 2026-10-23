import { and, desc, eq, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { tickets, type TicketRow } from "../../../drizzle/schema";
import { getDb } from "../../db";

export type NewTicket = Pick<TicketRow, "guildId" | "openerId" | "topic">;

export async function createTicket(input: NewTicket): Promise<TicketRow> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  // Unique(guildId,ticketNumber) resolves concurrent allocation collisions safely.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const [latest] = await db.select({ ticketNumber: tickets.ticketNumber }).from(tickets)
      .where(eq(tickets.guildId, input.guildId)).orderBy(desc(tickets.ticketNumber)).limit(1);
    const ticketNumber = (latest?.ticketNumber ?? 0) + 1;
    try {
      const result = await db.insert(tickets).values({ ...input, ticketNumber, transcript: "", messageCount: 0, status: "open" });
      const id = Number(result[0].insertId);
      const [row] = await db.select().from(tickets).where(and(eq(tickets.guildId, input.guildId), eq(tickets.id, id))).limit(1);
      if (!row) throw new Error("ticket_insert_missing");
      return row;
    } catch (error) {
      if (attempt === 4) throw error;
    }
  }
  throw new Error("ticket_number_allocation_failed");
}

export async function listOpenTickets(guildId: string, openerId?: string): Promise<TicketRow[]> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  return db.select().from(tickets).where(and(eq(tickets.guildId, guildId), ne(tickets.status, "closed"), ...(openerId ? [eq(tickets.openerId, openerId)] : [])));
}

export async function getTicketByChannel(guildId: string, channelId: string): Promise<TicketRow | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const [row] = await db.select().from(tickets).where(and(eq(tickets.guildId, guildId), eq(tickets.channelId, channelId))).limit(1);
  return row;
}

export async function setTicketChannel(guildId: string, id: number, channelId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(tickets).set({ channelId }).where(and(eq(tickets.guildId, guildId), eq(tickets.id, id)));
}

export async function closeTicket(guildId: string, id: number, actorId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(tickets).set({ status: "closed", closedById: actorId, closedAt: new Date(), transcript: "" })
    .where(and(eq(tickets.guildId, guildId), eq(tickets.id, id), ne(tickets.status, "closed")));
}

export async function claimTicket(guildId: string, id: number, actorId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(tickets).set({ status: "claimed", claimedById: actorId })
    .where(and(eq(tickets.guildId, guildId), eq(tickets.id, id), ne(tickets.status, "closed")));
}
