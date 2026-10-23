export const SETTINGS_CONFIRMATION_HEADER = "x-systemix-confirm";

export type SettingsConfirmation = "CONFIRM_SETTINGS" | "ENABLE_PROTECTION";

/** Settings mutations always require an explicit user confirmation; enforcement mode is stricter. */
export function acceptsSettingsConfirmation(value: string | undefined, mode: "observe" | "protect"): value is SettingsConfirmation {
  if (value !== "CONFIRM_SETTINGS" && value !== "ENABLE_PROTECTION") return false;
  return mode !== "protect" || value === "ENABLE_PROTECTION";
}

export async function runWithAuditPrecondition<T>(audit: () => Promise<unknown>, persist: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    await audit();
  } catch {
    return { ok: false };
  }
  return { ok: true, value: await persist() };
}
