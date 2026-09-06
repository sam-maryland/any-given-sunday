import { PLAYOFF_TEAM_COUNT } from "../domain/standings";
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

// Palette and type stacks. Email clients strip <style> blocks and do not
// support custom properties, so every rule has to be inlined on the element —
// these constants keep the values in one place even though the CSS cannot be.
const INK = "#0c2011"; // masthead
const GOLD = "#b08d33"; // accent rules and the top-score figure
const PAPER = "#ffffff";
const CANVAS = "#eceae4"; // the surround outside the 600px sheet
const RULE = "#e2e0d9";
const TEXT = "#1c1c1a";
const MUTED = "#6f6f68";

// No web fonts: they need an external request that most clients block. Georgia
// carries the mastheads and Helvetica/Arial the data, both installed anywhere
// the email can land.
const SERIF = "Georgia, 'Times New Roman', Times, serif";
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";

/** Small letterspaced section label, e.g. "TOP SCORE". */
function label(text: string, color: string): string {
  return `<span style="font-family: ${SANS}; font-size: 11px; font-weight: bold; letter-spacing: 1.5px; text-transform: uppercase; color: ${color};">${text}</span>`;
}

/**
 * The inbox preview line, after the subject. Hidden in the body itself: the
 * zero-width joiners stop clients from padding the preview with whatever
 * markup happens to come next.
 */
function preheader(summary: WeeklySummary, users: UserMap): string {
  const text = summary.highScore
    ? `Week ${summary.week} top score: ${nameFor(summary.highScore.userId, users, summary.highScore.userName)}, ${summary.highScore.score.toFixed(2)} points.`
    : `Week ${summary.week} standings and results.`;
  return `<div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">${esc(text)}&zwnj;${"&nbsp;&zwnj;".repeat(30)}</div>`;
}

function nameFor(userId: string, users: UserMap, fallback: string): string {
  return users.get(userId)?.name ?? fallback;
}

// Mobile-first HTML recap email. Uses table layout and inline styles because
// email clients strip <style> blocks and ignore most modern CSS.
export function generateWeeklyRecapHTML(summary: WeeklySummary, users: UserMap): string {
  const cellBase = `font-family: ${SANS}; font-size: 15px; color: ${TEXT};`;
  const numCell = `${cellBase} text-align: right; white-space: nowrap;`;

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <!-- Declaring a light scheme stops Apple Mail and Outlook from inverting
         the palette into something muddy. -->
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>Any Given Sunday — Week ${summary.week} Briefing</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${CANVAS}; -webkit-text-size-adjust: 100%;">
    ${preheader(summary, users)}
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: ${CANVAS};">
        <tr>
            <td align="center" style="padding: 32px 12px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; background-color: ${PAPER}; border: 1px solid ${RULE};">
`;

  // Masthead. The week sits opposite the wordmark rather than beneath it, so
  // the eye lands on the league name and then the date line, like a letterhead.
  html += `
                    <tr>
                        <td style="background-color: ${INK}; padding: 26px 28px 22px 28px;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="font-family: ${SERIF}; font-size: 22px; font-weight: normal; letter-spacing: 0.5px; color: ${PAPER};">Any Given Sunday</td>
                                    <td align="right" style="font-family: ${SANS}; font-size: 11px; font-weight: bold; letter-spacing: 1.5px; text-transform: uppercase; color: ${GOLD}; white-space: nowrap;">Week ${summary.week} &middot; ${summary.year}</td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="height: 3px; background-color: ${GOLD}; font-size: 0; line-height: 0;">&nbsp;</td>
                    </tr>
`;

  // Top score. A restrained stat block: the label sets the context, the team
  // name carries the weight, and the figure is the only large numeral in the
  // email so it reads as the headline.
  if (summary.highScore) {
    const name = nameFor(summary.highScore.userId, users, summary.highScore.userName);
    html += `
                    <tr>
                        <td style="padding: 30px 28px 26px 28px; border-bottom: 1px solid ${RULE};">
                            ${label("Top Score", MUTED)}
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 12px;">
                                <tr>
                                    <td style="font-family: ${SERIF}; font-size: 26px; line-height: 32px; color: ${TEXT}; padding-right: 12px;">${esc(name)}</td>
                                    <td align="right" valign="bottom" style="white-space: nowrap;">
                                        <span style="font-family: ${SERIF}; font-size: 34px; line-height: 34px; color: ${GOLD};">${summary.highScore.score.toFixed(2)}</span>
                                        <span style="font-family: ${SANS}; font-size: 11px; font-weight: bold; letter-spacing: 1.5px; color: ${MUTED};"> PTS</span>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
`;
  } else {
    html += `
                    <tr>
                        <td style="padding: 24px 28px; border-bottom: 1px solid ${RULE}; font-family: ${SANS}; font-size: 14px; color: ${MUTED};">
                            No scoring data was available for this week.
                        </td>
                    </tr>
`;
  }

  if (summary.standings.length > 0) {
    const headCell = `font-family: ${SANS}; font-size: 10px; font-weight: bold; letter-spacing: 1.2px; text-transform: uppercase; color: ${MUTED}; padding: 0 0 8px 0; border-bottom: 2px solid ${INK};`;

    html += `
                    <tr>
                        <td style="padding: 30px 28px 32px 28px;">
                            ${label("Standings", MUTED)}
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 14px; border-collapse: collapse;">
                                <tr>
                                    <th align="left" width="28" style="${headCell}">#</th>
                                    <th align="left" style="${headCell}">Team</th>
                                    <th align="right" width="58" style="${headCell}">W-L</th>
                                    <th align="right" width="62" style="${headCell}">PF</th>
                                    <th align="right" width="62" style="${headCell}">PA</th>
                                </tr>
`;

    summary.standings.forEach((standing, i) => {
      // Only draw the cutoff when there are teams on the far side of it.
      if (i === PLAYOFF_TEAM_COUNT && summary.standings.length > PLAYOFF_TEAM_COUNT) {
        html += `
                                <tr>
                                    <td colspan="5" style="padding: 10px 0 8px 0; border-top: 2px solid ${GOLD}; text-align: center;">
                                        ${label("Playoff Cutoff", GOLD)}
                                    </td>
                                </tr>
`;
      }

      // In playoff position the rank is inked and the name set in the serif;
      // below the line both drop to the muted sans. The contrast does the work
      // the old bold-everything treatment was trying to do.
      const inPlayoffs = i < PLAYOFF_TEAM_COUNT;
      const rankColor = inPlayoffs ? INK : MUTED;
      const nameStyle = inPlayoffs
        ? `font-family: ${SERIF}; font-size: 17px; color: ${TEXT};`
        : `font-family: ${SANS}; font-size: 15px; color: ${MUTED};`;

      html += `
                                <tr>
                                    <td align="left" style="${cellBase} padding: 11px 0; border-bottom: 1px solid ${RULE}; color: ${rankColor}; font-size: 13px;">${i + 1}</td>
                                    <td align="left" style="padding: 11px 8px 11px 0; border-bottom: 1px solid ${RULE}; ${nameStyle}">${esc(nameFor(standing.userId, users, standing.userId))}</td>
                                    <td style="${numCell} padding: 11px 0; border-bottom: 1px solid ${RULE};">${standing.wins}-${standing.losses}</td>
                                    <td style="${numCell} padding: 11px 0; border-bottom: 1px solid ${RULE}; color: ${MUTED};">${standing.pointsFor.toFixed(1)}</td>
                                    <td style="${numCell} padding: 11px 0; border-bottom: 1px solid ${RULE}; color: ${MUTED};">${standing.pointsAgainst.toFixed(1)}</td>
                                </tr>
`;
    });

    html += `
                            </table>
                        </td>
                    </tr>
`;
  }

  html += `
                    <tr>
                        <td style="background-color: #f7f6f3; padding: 24px 28px; border-top: 1px solid ${RULE};" align="center">
                            <a href="https://sleeper.com/leagues/${encodeURIComponent(summary.leagueId)}/league" style="display: inline-block; background-color: ${INK}; color: ${PAPER}; text-decoration: none; padding: 12px 26px; font-family: ${SANS}; font-size: 12px; font-weight: bold; letter-spacing: 1.2px; text-transform: uppercase;">View on Sleeper</a>
                            <p style="margin: 18px 0 0 0; font-family: ${SANS}; font-size: 12px; line-height: 18px; color: ${MUTED};">Next briefing after Week ${summary.week + 1} concludes.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

  return html;
}
