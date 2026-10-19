# Brand & UI reference (Spotter AI)

Colours and fonts were sampled from the computed styles on spotter.ai (`/`, `/lens`, `/tms`, `/sentinel`, `/driversapp`) on 2026-10-19.
Screenshots are kept locally in `docs/inspo/` and are not committed, since they belong to Spotter.

## Palette
| Token | Hex | Where Spotter uses it |
|---|---|---|
| navy | `#061830` | Main page background (TMS, Sentinel) |
| navyDeep | `#040F1F` | Deepest sections, map surroundings |
| surface | `#0D1E2D` | Nav bar, cards |
| surfaceRaised | `#0A1F36` | Raised panels |
| panel | `#04283C` / `#043344` | Lens table rows, date picker |
| turquoise | `#40E0D0` | Highlighted headline words, links, active states, accent borders at 10–20% alpha |
| teal | `#008080` | Main "Get Started" button |
| mint | `#14D29B` / `#00D9A5` | Positive change, Sentinel accents |
| coral | `#F84960` | Logo dot, negative change (`#FF7979`) |
| amber | `#FFA600` | Warnings, "in shop" pill |
| textMuted | `#C4D0D6` | Body text on navy |
| border | `rgba(255,255,255,0.08)` | Card and table borders |

**Lens heat scale (cold → hot):** teal → light blue → mint → pale yellow → orange → red. We reuse this order for the weather heatmap.

## Typography
- **DM Sans** (Google Fonts) for headings and UI. Spotter also uses the licensed *Matter*; DM Sans is the free font they fall back to.
- **Open Sans** in Lens data tables. We use **DM Mono** for numbers so figures line up.

## Patterns worth borrowing
- **Lens:** sortable table on the left, choropleth map plus time series on the right → our results list on the left, map on the right.
- **TMS:** status pills with a count (`OPERATING (184)`) → risk pills on route cards (`SEVERE 12 mi`). Colored day tiles in a weekly row → our per-route risk strip.
- **Sentinel:** dark glass cards with soft radial teal glows; comparison table with the "winner" row highlighted → our route comparison with the recommended route highlighted.
- Headlines highlight one key word in turquoise ("Trucking **Automation**").
