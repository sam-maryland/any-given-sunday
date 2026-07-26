import { UserMap } from "../domain/types";
import { WeeklySummary } from "../domain/weeklySummary";

// Escapes values interpolated into the email HTML. Team names come from
// Sleeper and are user-controlled.
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Mobile-first HTML recap email. Uses table layout and inline styles because
// email clients strip <style> blocks and ignore most modern CSS.
export function generateWeeklyRecapHTML(summary: WeeklySummary, users: UserMap): string {
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Weekly Fantasy Recap</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f4f4f4;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f4f4f4;">
        <tr>
            <td align="center" style="padding: 20px 0;">
                <!-- Main Container -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
`;

  html += `
                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #0a3d0c 0%, #1a5d1a 100%); padding: 30px 20px; text-align: center;">
                            <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">ANY GIVEN SUNDAY</h1>
                            <p style="color: #e0e0e0; margin: 10px 0 0 0; font-size: 18px;">Week ${summary.week} • ${summary.year}</p>
                        </td>
                    </tr>
`;

  if (summary.highScore) {
    const name = users.get(summary.highScore.userId)?.name ?? summary.highScore.userName;
    html += `
                    <!-- High Score Winner -->
                    <tr>
                        <td style="background-color: #ffd700; padding: 30px 20px; text-align: center; border-bottom: 4px solid #f0c000;">
                            <p style="color: #333; margin: 0 0 10px 0; font-size: 16px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">💰 High Score Winner 💰</p>
                            <h2 style="color: #000; margin: 10px 0; font-size: 32px; font-weight: bold;">${esc(name)}</h2>
                            <p style="color: #333; margin: 10px 0 0 0; font-size: 24px; font-weight: bold;">${summary.highScore.score.toFixed(2)} points</p>
                        </td>
                    </tr>
`;
  } else {
    html += `
                    <!-- No High Score Available -->
                    <tr>
                        <td style="background-color: #f0f0f0; padding: 30px 20px; text-align: center; border-bottom: 2px solid #ddd;">
                            <p style="color: #666; margin: 0; font-size: 16px;">❌ No high score data available for this week</p>
                        </td>
                    </tr>
`;
  }

  html += `
                    <!-- Standings -->
                    <tr>
                        <td style="padding: 30px 20px;">
                            <h3 style="color: #0a3d0c; margin: 0 0 20px 0; font-size: 20px; text-align: center; font-weight: bold;">📊 STANDINGS 📊</h3>
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
`;

  summary.standings.forEach((standing, i) => {
    const name = users.get(standing.userId)?.name ?? standing.userId;

    if (i === 6) {
      html += `
                                <tr>
                                    <td style="padding: 10px 15px; background-color: #e8f5e9; text-align: center; border-top: 2px solid #0a3d0c; border-bottom: 2px solid #0a3d0c;">
                                        <span style="color: #0a3d0c; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">━━━ Playoff Line ━━━</span>
                                    </td>
                                </tr>
`;
    }

    const bgColor = i % 2 === 1 ? "#f9f9f9" : "#ffffff";
    const weight = i < 6 ? "bold" : "normal";

    html += `
                                <tr>
                                    <td style="padding: 12px 15px; background-color: ${bgColor}; border-bottom: 1px solid #e0e0e0;">
                                        <span style="color: #333; font-size: 16px; font-weight: ${weight};">${i + 1}. ${esc(name)} <span style="color: #666;">(${standing.wins}-${standing.losses})</span></span>
                                    </td>
                                </tr>
`;
  });

  html += `
                            </table>
                        </td>
                    </tr>
`;

  html += `
                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f8f8f8; padding: 25px 20px; text-align: center; border-top: 2px solid #e0e0e0;">
                            <p style="color: #555; margin: 0 0 15px 0; font-size: 14px;">Next update after Week ${summary.week + 1} games complete! 🏈</p>
                            <a href="https://sleeper.com/leagues/${encodeURIComponent(summary.leagueId)}/league" style="display: inline-block; background-color: #0a3d0c; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-size: 14px; font-weight: bold;">View on Sleeper →</a>
                        </td>
                    </tr>
`;

  html += `
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

  return html;
}
