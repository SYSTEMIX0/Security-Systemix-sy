import { discordRedirectUri } from "./redirect";

const TRANSCRIPT_ROUTE_PREFIX = "/ticket-transcripts/";

/** Creates a stable public URL without trusting request Host headers. */
export function ticketTranscriptUrl(ticketId: number): string {
  const origin = new URL(discordRedirectUri()).origin;
  return new URL(`${TRANSCRIPT_ROUTE_PREFIX}${ticketId}`, origin).toString();
}

export function ticketTranscriptPath(ticketId: number): string {
  return `${TRANSCRIPT_ROUTE_PREFIX}${ticketId}`;
}

export { TRANSCRIPT_ROUTE_PREFIX };
