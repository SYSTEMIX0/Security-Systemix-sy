import { describe, expect, it } from "vitest";
import { renderWelcomeTemplate, welcomePayload } from "./welcome";

describe("welcome template renderer", () => {
  it("replaces only supported placeholders including the displayed {count} alias", () => {
    expect(renderWelcomeTemplate("Hi {user} at {server}: {memberCount} / {count}", { userId: "12345678901234567", server: "Guild", memberCount: 8 })).toEqual({
      content: "Hi <@12345678901234567> at Guild: 8 / 8", mentionsUser: true,
    });
  });
  it("escapes markup and does not create a user mention unless {user} was selected", () => {
    expect(renderWelcomeTemplate("**{server}** @everyone <@12345678901234567>", { userId: "12345678901234567", server: "A*B", memberCount: 1 })).toEqual({
      content: "\\*\\*A*B\\*\\* @everyone ‹@12345678901234567›", mentionsUser: false,
    });
  });
  it("marks only explicit {user} placeholder as mention-enabled", () => {
    expect(renderWelcomeTemplate("Welcome {user}", { userId: "12345678901234567", server: "G", memberCount: 1 }).mentionsUser).toBe(true);
  });
  it("uses an embed with the configured image even when the embed switch is off", () => {
    const payload = welcomePayload({ id: "12345678901234567", guild: { name: "Guild", memberCount: 5 } } as never, "أهلاً {user}", false, "https://cdn.example.com/welcome.png");
    expect(payload.embeds).toHaveLength(1);
    expect(payload.embeds?.[0]?.data.image?.url).toBe("https://cdn.example.com/welcome.png");
  });
});
