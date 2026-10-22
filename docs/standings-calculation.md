# Fantasy Football Standings Calculation

This document explains how team standings are calculated in our fantasy football league system.

The website serves any Sleeper league. Each league's playoff size, byes and median games come from its Sleeper settings, ties on wins go to points for (Sleeper's own rule), and a finished season is placed by the league's bracket, placement games included. The rules below are Any Given Sunday's, set in `worker/src/domain/leagueFormat.ts`: the head-to-head tiebreaker, and quarterfinal losers ordered by tiebreakers rather than the fifth place game. Understanding these calculations helps explain why teams are ranked in their positions and what determines playoff seeding.

## Overview

The standings calculation differs depending on whether the league is currently in progress (regular season) or completed (post-season). Regular season standings determine playoff seeding, while post-season standings reflect final league placement based on playoff performance.

## Regular Season Standings

During the regular season, teams are ranked based on their performance in regular season matchups only. Playoff games are excluded from these calculations.

### Primary Ranking Criteria

Teams are primarily ranked by **wins** in descending order (most wins first).

### Tiebreaker System

When teams have the same number of wins, the following tiebreakers are applied in order:

#### 1. Head-to-Head (only when it's fair)
Head-to-head is used only when it compares like with like. Fantasy schedules are uneven, so by mid-season some tied teams will have played each other and some won't. Counting raw wins against the tied group would reward a team just for having played more of them.

- **Every tied team has played every other tied team:** rank by record in games among the tied teams (win percentage, with a tie counting as half a win). This is the normal case for a two-team tie where the teams have met.
- **Not everyone has played, but one team beat all the others:** that team goes first, having beaten every other tied team at least once without losing to any. The remaining teams then start the tiebreak over among themselves.
- **Otherwise:** head-to-head is skipped and the tie goes straight to points for.

If head-to-head is used but leaves teams level (for example, two teams split their two games), points for decides between them.

#### 2. Points For (Total Points Scored)
- If head-to-head is level or skipped, the team with more total points scored throughout the season is ranked higher
- This rewards consistent offensive performance

#### 3. Points Against (Total Points Allowed)
- If Points For are also tied, the team that allowed fewer points is ranked higher

#### 4. Random Tiebreaker (Coin Flip)
- As a final tiebreaker, a random determination is made
- This is extremely rare but ensures no two teams can have identical standings

### Calculation Process

1. **Regular Season Data Collection**: Only non-playoff matchups are considered
2. **Record Calculation**: For each team, calculate wins, losses, ties, total points for, and total points against
3. **Head-to-Head Matrix**: Track games played and wins by each team against every other team
4. **Grouping**: Group teams by number of wins
5. **Tiebreaking**: Within each win group, apply the tiebreakers above
6. **Final Ordering**: Combine all groups in descending order of wins

The website (ags-hq.org) shows which tiebreaker separated each pair of adjacent teams, and the Discord `/standings` command notes every spot a tiebreaker decided.

### Playoff Qualification

- **Top 6 teams** make the playoffs
- **Seeds 1-2**: Receive first-round byes
- **Seeds 3-6**: Play in the first round (quarterfinals)

## The Playoff Race

While a season is in progress, the website (ags-hq.org) shows each team's odds of making the playoffs, getting a bye, and finishing as the 1 seed.

- **How the odds are made:** every remaining regular season game is played out 10,000 times. A team's score in each simulated game is drawn around its average so far, pulled toward the league average (worth three league-average games, so one big week early on doesn't make a team a favourite). Every simulated finish is ranked with exactly the tiebreakers above. The page runs the same code the standings do.
- **"In" and "Out"** are mathematical certainties, not simulation results. A team is in when fewer than six other teams can even reach its current win total; it is out when six teams already have more wins than it can reach. Both assume every tiebreak goes against the team, so they can lag a week behind reality but are never wrong. Everything else is a percentage, and a simulation never shows 0% or 100%.
- **What-if picks:** viewers can pick winners for the next week's games and watch the odds move. Picks stay on the viewer's page and aren't saved. Each team's card also shows its playoff odds with a win and with a loss.
- **Where it runs:** the simulation runs in the viewer's browser. The Worker only sends the games played and the schedule still to come (`/api/playoff-race`), cached until the next weekly sync.

## Post-Season Standings (Final Rankings)

Once the league is complete, the final standings are determined by playoff performance rather than regular season record. This means a team with a worse regular season record can finish ahead of teams with better regular season records if they perform better in the playoffs.

### Final Ranking Structure

#### Positions 1-2: Championship Game Results
- **1st Place**: Winner of the championship game (finals)
- **2nd Place**: Loser of the championship game (finals)

#### Positions 3-4: Third Place Game Results
- **3rd Place**: Winner of the third-place game
- **4th Place**: Loser of the third-place game

*Note: The third-place game is played between the two teams that lost in the semifinals.*

#### Positions 5-6: Quarterfinal Losers
- **5th & 6th Place**: Teams that lost in the quarterfinals (first round of playoffs)
- These two teams are ranked against each other using the same tiebreaker system as regular season standings
- The quarterfinal loser with the better regular season record (using the tiebreaker system) gets 5th place

#### Positions 7-12: Non-Playoff Teams
- **7th-12th Place**: Teams that did not make the playoffs
- Ranked using regular season standings (same system as described above)
- These positions do not change once playoffs begin

### Playoff Bracket Structure

The playoffs follow this structure:
- **Quarterfinals**: Seeds 3 vs 6, Seeds 4 vs 5 (Seeds 1 & 2 have byes)
- **Semifinals**: Seed 1 vs lowest remaining seed, Seed 2 vs highest remaining seed
- **Championship Game**: Winners of semifinals play for 1st/2nd place
- **Third Place Game**: Losers of semifinals play for 3rd/4th place

Before 2026, higher seeds sometimes picked their opponents instead (in 2025, Seed 3 picked its quarterfinal opponent and Seed 1 its semifinal opponent), so past brackets don't always follow these pairings. Final placements don't depend on pairings either way: they come only from the championship, the third place game, and the quarterfinal losers.

## Example Scenarios

### Regular Season Tiebreaker Examples

**Everyone has played.** Three teams tied at 8-4, and each has played the other two:
- **Team A**: beat Team B and Team C (2-0 among the tied teams)
- **Team B**: beat Team C, lost to Team A (1-1)
- **Team C**: lost to both (0-2)

**Result**: A, B, C on head-to-head.

**Not everyone has played.** Three teams tied at 4-1 after week 5:
- **Team A**: beat Team C, 758.0 PF
- **Team B**: hasn't played A or C, 852.5 PF
- **Team C**: lost to Team A, 704.2 PF

A beat C, but B has played neither, and nobody beat both others. Head-to-head is skipped. **Result**: B, A, C on points for.

**A sweep.** Same tie, but Team A beat both B and C, while B and C haven't played each other. A beat every other tied team, so A goes first. B and C then start over: they haven't played, so points for decides between them.

### Post-Season Ranking Change Example

Regular season top 6:
1. Team A (10-2)
2. Team B (9-3) 
3. Team C (8-4)
4. Team D (8-4)
5. Team E (7-5)
6. Team F (6-6)

Playoff results:
- **Quarterfinals**: Team C beats Team F, Team E beats Team D
- **Semifinals**: Team C beats Team A, Team B beats Team E  
- **Championship**: Team C beats Team B
- **Third Place**: Team A beats Team E

**Final standings**:
1. Team C (champion, was 3rd seed)
2. Team B (runner-up, was 2nd seed)
3. Team A (3rd place winner, was 1st seed)
4. Team E (3rd place loser, was 5th seed)
5. Team D (quarterfinal loser with better regular season record)
6. Team F (quarterfinal loser with worse regular season record)
7-12. Non-playoff teams in regular season order

This example shows how playoff performance can significantly change final rankings compared to regular season standings.

## Technical Implementation Notes

- **Data Sources**: Standings are calculated from matchup data stored in the database
- **Real-time Updates**: Regular season standings update after each completed week
- **Playoff Validation**: The system validates that playoff bracket data is complete and consistent before calculating final standings
- **Tie Handling**: The system properly handles tied games (though rare in fantasy football)

## Frequently Asked Questions

**Q: Why did Team X finish behind Team Y even though they had a better record?**
A: In final standings, playoff performance determines positions 1-6. Regular season record only matters for playoff seeding and final ranking of teams within the same playoff outcome (like quarterfinal losers).

**Q: How is head-to-head calculated in multi-team ties?**
A: Only games among the tied teams count. If every tied team has played the others, the best record in those games goes first. If not, head-to-head only counts for a team that beat all the others. Otherwise it's skipped.

**Q: What happens if two teams never played each other?**
A: Head-to-head is skipped and the tie goes to points for, unless a third tied team beat both of them.

**Q: Can standings change after the regular season ends?**
A: Once playoffs begin, positions 7-12 are locked based on regular season performance. Only positions 1-6 change based on playoff results.