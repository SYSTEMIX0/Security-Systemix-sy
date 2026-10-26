import { and, desc, eq, ne, sql } from "drizzle-orm";
import { tickets, ticketOpenCounts, ticketSequences, type TicketRow } from "../../../drizzle/schema";
import { getDb } from "../../db";

export type NewTicket = Pick<TicketRow, "guildId" | "openerId" | "topic"> & {
  maxOpenPerUser: number;
};

export class TicketLimitReachedError extends Error {
  constructor() {
    super("ticket_limit_reached");
    this.name = "TicketLimitReachedError";
  }
}

export type TicketClaimResult = "claimed" | "already_claimed" | "unavailable";

/** A bounded snapshot made only at close time when the guild owner has enabled it. */
export type TicketTranscript = {
  version: 1;
  channelName: string;
  exportedAt: string;
  truncated: boolean;
  messages: Array<{
    authorId: string;
    authorName: string;
    bot: boolean;
    content: string;
    attachments: string[];
    createdAt: string;
  }>;
};

/**
 * Reserves both a sequential ticket number and one of the member's active-ticket
 * slots in the same MySQL transaction. The per-guild sequence row serializes
 * allocation, making the limit reliable even when two clicks arrive together.
 */
export async function createTicket(input: NewTicket): Promise<TicketRow> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");

  return db.transaction(async (tx) => {
    // INSERT ... ON DUPLICATE KEY UPDATE acquires an exclusive record lock.
    await tx.insert(ticketSequences).values({ guildId: input.guildId, nextTicketNumber: 2 })
      .onDuplicateKeyUpdate({ set: { nextTicketNumber: sql`${ticketSequences.nextTicketNumber}` } });
    await tx.insert(ticketOpenCounts).values({ guildId: input.guildId, openerId: input.openerId, openCount: 0 })
      .onDuplicateKeyUpdate({ set: { openCount: sql`${ticketOpenCounts.openCount}` } });

    const [sequence] = await tx.select().from(ticketSequences)
      .where(eq(ticketSequences.guildId, input.guildId)).for("update");
    const [memberCount] = await tx.select().from(ticketOpenCounts)
      .where(and(eq(ticketOpenCounts.guildId, input.guildId), eq(ticketOpenCounts.openerId, input.openerId))).for("update");
    if (!sequence || !memberCount) throw new Error("ticket_reservation_missing");
    if (memberCount.openCount >= input.maxOpenPerUser) throw new TicketLimitReachedError();

    const ticketNumber = sequence.nextTicketNumber - 1;
    await tx.update(ticketSequences).set({ nextTicketNumber: sequence.nextTicketNumber + 1 })
      .where(eq(ticketSequences.guildId, input.guildId));
    await tx.update(ticketOpenCounts).set({ openCount: memberCount.openCount + 1 })
      .where(and(eq(ticketOpenCounts.guildId, input.guildId), eq(ticketOpenCounts.openerId, input.openerId)));

    const result = await tx.insert(tickets).values({
      guildId: input.guildId,
      openerId: input.openerId,
      topic: input.topic,
      ticketNumber,
      transcript: null,
      messageCount: 0,
      status: "open",
    });
    const id = Number(result[0].insertId);
    const [row] = await tx.select().from(tickets)
      .where(and(eq(tickets.guildId, input.guildId), eq(tickets.id, id))).limit(1);
    if (!row) throw new Error("ticket_insert_missing");
    return row;
  });
}

export async function listOpenTickets(guildId: string, openerId?: string): Promise<TicketRow[]> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  return db.select().from(tickets)
    .where(and(eq(tickets.guildId, guildId), ne(tickets.status, "closed"), ...(openerId ? [eq(tickets.openerId, openerId)] : [])))
    .orderBy(desc(tickets.ticketNumber));
}

export async function getTicketByChannel(guildId: string, channelId: string): Promise<TicketRow | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const [row] = await db.select().from(tickets)
    .where(and(eq(tickets.guildId, guildId), eq(tickets.channelId, channelId))).limit(1);
  return row;
}

export async function getTicketById(id: number): Promise<TicketRow | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const [row] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  return row;
}

/** Stores the bounded transcript before deleting the Discord channel. */
export async function saveTicketTranscript(guildId: string, id: number, transcript: TicketTranscript): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(tickets).set({ transcript: JSON.stringify(transcript), messageCount: transcript.messages.length })
    .where(and(eq(tickets.guildId, guildId), eq(tickets.id, id), eq(tickets.status, "closing")));
}

/** A failed channel deletion must not leave an early copy of an open conversation in storage. */
export async function clearTicketTranscript(guildId: string, id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(tickets).set({ transcript: null, messageCount: 0 })
    .where(and(eq(tickets.guildId, guildId), eq(tickets.id, id), eq(tickets.status, "closing")));
}

export async function setTicketChannel(guildId: string, id: number, channelId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(tickets).set({ channelId })
    .where(and(eq(tickets.guildId, guildId), eq(tickets.id, id), eq(tickets.status, "open")));
}

async function decrementOpenCount(tx: Parameters<Parameters<NonNullable<Awaited<ReturnType<typeof getDb>>>["transaction"]>[0]>[0], guildId: string, openerId: string): Promise<void> {
  await tx.update(ticketOpenCounts).set({ openCount: sql`GREATEST(${ticketOpenCounts.openCount} - 1, 0)` })
    .where(and(eq(ticketOpenCounts.guildId, guildId), eq(ticketOpenCounts.openerId, openerId)));
}

/** Marks a provisioning failure as closed and releases the member's slot. */
export async function cancelTicketReservation(guildId: string, id: number, actorId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.transaction(async (tx) => {
    const [ticket] = await tx.select().from(tickets)
      .where(and(eq(tickets.guildId, guildId), eq(tickets.id, id))).for("update");
    if (!ticket || ticket.status === "closed") return;
    await tx.update(tickets).set({ status: "closed", closedById: actorId, closedAt: new Date() })
      .where(and(eq(tickets.guildId, guildId), eq(tickets.id, id)));
    await decrementOpenCount(tx, guildId, ticket.openerId);
  });
}

/** Moves the ticket into a visible closing state before deleting its Discord channel. */
export async function beginTicketClose(guildId: string, id: number): Promise<TicketRow | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  return db.transaction(async (tx) => {
    const [ticket] = await tx.select().from(tickets)
      .where(and(eq(tickets.guildId, guildId), eq(tickets.id, id))).for("update");
    if (!ticket || ticket.status === "closed" || ticket.status === "closing") return undefined;
    await tx.update(tickets).set({ status: "closing" })
      .where(and(eq(tickets.guildId, guildId), eq(tickets.id, id)));
    return ticket;
  });
}

/** Restores a ticket when Discord refuses to delete the channel. */
export async function restoreTicketAfterCloseFailure(guildId: string, id: number, previousStatus: "open" | "claimed"): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(tickets).set({ status: previousStatus })
    .where(and(eq(tickets.guildId, guildId), eq(tickets.id, id), eq(tickets.status, "closing")));
}

/** Finalizes a successfully deleted ticket and releases the member's active slot. */
export async function finishTicketClose(guildId: string, id: number, actorId: string, closedAt = new Date()): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  return db.transaction(async (tx) => {
    const [ticket] = await tx.select().from(tickets)
      .where(and(eq(tickets.guildId, guildId), eq(tickets.id, id))).for("update");
    if (!ticket || ticket.status !== "closing") return false;
    await tx.update(tickets).set({ status: "closed", closedById: actorId, closedAt })
      .where(and(eq(tickets.guildId, guildId), eq(tickets.id, id), eq(tickets.status, "closing")));
    await decrementOpenCount(tx, guildId, ticket.openerId);
    return true;
  });
}

/** Claims only an open ticket; a second support member can never overwrite the first claimant. */
export async function claimTicket(guildId: string, id: number, actorId: string): Promise<TicketClaimResult> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  return db.transaction(async (tx) => {
    const [ticket] = await tx.select().from(tickets)
      .where(and(eq(tickets.guildId, guildId), eq(tickets.id, id))).for("update");
    if (!ticket || ticket.status === "closed" || ticket.status === "closing") return "unavailable";
    if (ticket.status === "claimed") return "already_claimed";
    await tx.update(tickets).set({ status: "claimed", claimedById: actorId })
      .where(and(eq(tickets.guildId, guildId), eq(tickets.id, id), eq(tickets.status, "open")));
    return "claimed";
  });
}
