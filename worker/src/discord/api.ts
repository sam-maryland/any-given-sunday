import { InteractionResponseData } from "./types";

// Edits the original (deferred) interaction response. Authenticated by the
// interaction token itself — no bot token required.
export async function editOriginalResponse(
  appId: string,
  interactionToken: string,
  data: InteractionResponseData,
): Promise<void> {
  const res = await fetch(
    `https://discord.com/api/v10/webhooks/${appId}/${interactionToken}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord webhook edit failed (${res.status}): ${body}`);
  }
}
