import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { User } from "../domain/types";
import { WeeklySummary } from "../domain/weeklySummary";
import { sendWeeklyRecap } from "./email";

const SUMMARY: WeeklySummary = {
  leagueId: "L1",
  year: 2026,
  week: 3,
  highScore: { userId: "u1", userName: "Team One", score: 123.45, week: 3, year: 2026 },
  standings: [],
  dataSyncStatus: "",
};

function user(id: string, email: string | null): User {
  return { id, name: `Team ${id}`, discord_id: null, onboarding_complete: true, email };
}

let requests: { url: string; body: any }[];

beforeEach(() => {
  requests = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("sendWeeklyRecap", () => {
  const recipients = [user("u1", "one@example.com"), user("u2", "two@example.com")];

  it("sends every recipient in one batch request", async () => {
    const result = await sendWeeklyRecap("key", "from@x.com", SUMMARY, recipients, new Map());

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://api.resend.com/emails/batch");
    expect(requests[0]!.body).toHaveLength(2);
    expect(result.sent).toBe(2);
  });

  it("attaches the delivery time so Resend holds it until 8am Eastern", async () => {
    const deliverAt = new Date("2026-09-15T12:00:00.000Z");
    await sendWeeklyRecap("key", "from@x.com", SUMMARY, recipients, new Map(), deliverAt);

    for (const email of requests[0]!.body) {
      expect(email.scheduled_at).toBe("2026-09-15T12:00:00.000Z");
    }
  });

  it("omits the delivery time when sending immediately", async () => {
    await sendWeeklyRecap("key", "from@x.com", SUMMARY, recipients, new Map(), null);

    for (const email of requests[0]!.body) {
      expect(email).not.toHaveProperty("scheduled_at");
    }
  });

  it("skips recipients without an email address", async () => {
    const result = await sendWeeklyRecap(
      "key",
      "from@x.com",
      SUMMARY,
      [user("u1", "one@example.com"), user("u2", null), user("u3", "")],
      new Map(),
    );

    expect(result.sent).toBe(1);
    expect(requests[0]!.body).toHaveLength(1);
  });

  it("makes no request when nobody has an email address", async () => {
    const result = await sendWeeklyRecap("key", "from@x.com", SUMMARY, [], new Map());
    expect(requests).toHaveLength(0);
    expect(result.sent).toBe(0);
  });

  it("raises when Resend rejects the batch", async () => {
    vi.stubGlobal("fetch", async () => new Response("bad request", { status: 422 }));
    await expect(
      sendWeeklyRecap("key", "from@x.com", SUMMARY, recipients, new Map()),
    ).rejects.toThrow(/422/);
  });
});
