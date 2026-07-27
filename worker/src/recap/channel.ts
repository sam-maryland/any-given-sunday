// Posts the recap to a Discord channel. Unlike interaction replies, this is a
// bot-authenticated call, so it needs the bot token.
export async function postToChannel(
  botToken: string,
  channelId: string,
  content: string,
): Promise<void> {
  const maxAttempts = 3;
  let lastError = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content }),
      },
    );

    if (res.ok) {
      return;
    }

    lastError = `${res.status}: ${await res.text()}`;

    // Honour Discord's rate limit hint; otherwise back off linearly.
    let waitMs = attempt * 1000;
    if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After");
      if (retryAfter) {
        waitMs = Math.ceil(Number(retryAfter) * 1000) || waitMs;
      }
    } else if (res.status < 500) {
      // 4xx other than rate limiting will not succeed on retry.
      break;
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  throw new Error(`failed to post to Discord channel: ${lastError}`);
}
