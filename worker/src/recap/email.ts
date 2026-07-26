import { User, UserMap } from "../domain/types";
import { WeeklySummary } from "../domain/weeklySummary";
import { generateWeeklyRecapHTML } from "./template";

export interface EmailResult {
  sent: number;
}

/**
 * Sends the recap to every league member with an email address.
 *
 * Uses Resend's batch endpoint so all recipients cost a single subrequest —
 * the Go version sent one request per recipient with a 600ms sleep between
 * them to stay under the rate limit, which does not fit a Worker's budget.
 *
 * @param displayNames names to show in the email body (Sleeper team names)
 */
export async function sendWeeklyRecap(
  apiKey: string,
  fromEmail: string,
  summary: WeeklySummary,
  recipients: User[],
  displayNames: UserMap,
): Promise<EmailResult> {
  const withEmail = recipients.filter((u) => !!u.email);
  if (withEmail.length === 0) {
    console.log(JSON.stringify({ event: "recap_email_skipped", reason: "no recipients" }));
    return { sent: 0 };
  }

  const html = generateWeeklyRecapHTML(summary, displayNames);
  const subject = `🏈 Any Given Sunday: Week ${summary.week} Recap`;

  const batch = withEmail.map((user) => ({
    from: fromEmail,
    to: [user.email as string],
    subject,
    html,
  }));

  const res = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(batch),
  });

  if (!res.ok) {
    throw new Error(`Resend batch send failed (${res.status}): ${await res.text()}`);
  }

  return { sent: batch.length };
}
