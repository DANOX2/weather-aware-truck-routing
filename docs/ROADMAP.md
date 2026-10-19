# Roadmap — Weather-Aware Truck Routing

Take-home assessment for **Spotter AI — Remote FullStack Engineer (React + Django)**.

| | |
|---|---|
| Hard budget | **16 working hours** across 4 days |
| Target | Submit at the end of **Day 3** (~14 h); Day 4 is buffer only |
| Grading | 40% logic (routes, weather, risk, recommendation) · 40% UI/map/heatmap smoothness & performance · 15% code quality · 5% docs & walkthrough |
| North star | "Prioritize correctness and clarity over extra features." |
| **Our priority** | **Quality of the core features, UI and UX comes first.** Extra features only get built after every item in the quality bar (§2) is green. |

---

## 1. Requirements (traceable)

### Inputs
- **R1** Origin & destination (address search with autocomplete)
- **R2** Departure date/time
- **R3** Load weight (lb)

### Behaviour
- **R4** Generate **3 route options** using a routing API
- **R5** Sample weather every **10 / 25 / 50 miles** (user-selectable), at the truck's **ETA at each checkpoint**
- **R6** Classify weather risk with the provided rules (table + load rules below)
- **R7** Recommend the best route: fewest Severe miles → fewest High miles → lowest average risk → shortest travel time
- **R8** Map shows all routes, checkpoints, risk levels, ETAs and route summaries
- **R9** Weather heatmap along the trip corridor with a **0–48 h forecast slider**

### Risk rules (from the brief)

| Condition | Low | Moderate | High | Severe | No Travel |
|---|---|---|---|---|---|
| Wind (mph) | < 25 | 25–34 | 35–44 | 45–54 | ≥ 55 |
| Rain (in/hr) | < 0.10 | 0.10–0.25 | 0.25–0.50 | 0.50–1.00 | > 1.00 |
| Snow (in/hr) | < 0.5 | 0.5–1.0 | 1.0–2.0 | 2.0–3.0 | > 3.0 |

Load rules: ≥ 55 mph → No Travel (any load) · 45–54 mph & > 30,000 lb → No Travel · 35–44 mph & > 40,000 lb → Severe.

### Deliverables
- **D-REPO** GitHub repository · **D-HOST** hosted application · **D-LOOM** 5–10 min Loom walkthrough

---

## 2. Quality bar (non-negotiable)

80% of the grade is the core logic and the UI. Each item below is a pass/fail check, verified on the **hosted** app before submitting.

### 2.1 Core features: acceptance criteria
| Req | It is done when… |
|---|---|
| R1 | Autocomplete suggests places within 300 ms of typing (debounced, cached). Picking one sets exact coordinates, so free text is never sent to routing. Origin and destination can be swapped with one click. |
| R2 | Defaults to "now, rounded to the next 15 min" in the user's timezone, shown with its UTC offset. Past times and times beyond 48 h are blocked, with an inline message saying why. |
| R3 | Weight in lb with thousands separators and a sensible range (1,000–80,000 lb, the US federal gross limit). Helper text shows the load-rule cut-offs (30k / 40k), so the user sees why weight matters. |
| R4 | 3 routes shown whenever the API returns them, each with distance, drive time, ETA and its own colour. If fewer come back, a plain notice says so. |
| R5 | Changing the 10/25/50 interval **re-samples without calling the routing API again** (routes are cached). Every checkpoint shows its mile marker, ETA in local time and the forecast hour used. |
| R6 | Every threshold boundary and load rule has a unit test. A checkpoint tooltip shows **which condition caused its level** (e.g. "High: gusts 38 mph + 42,000 lb load → Severe"). |
| R7 | The recommended route is marked and its card says **why it won** ("Fewest Severe miles: 0 vs 12 vs 31"). The ranking is deterministic and tested. |
| R8 | All routes are on the map; the recommended one is drawn on top. Hovering or selecting a route card highlights that route on the map, and the reverse. Checkpoints are coloured by risk with an always-visible legend. |
| R9 | The heatmap slider moves at **60 fps with no network request** while dragging. It has play/pause, labels in local time, and markers for the trip's departure and arrival. The legend uses the same five risk colours as the checkpoints. |

### 2.2 UI quality
- **One visual system**: MUI theme tokens only (no one-off hex values), 8 px spacing grid, DM Sans for text and DM Mono for numbers so figures line up in columns.
- **Risk shown the same way everywhere**: the same 5 colours, labels and order on checkpoints, the risk strip, cards, legend and heatmap. Colour is never the only signal: each level also has a text label or icon.
- **Information hierarchy**: the recommendation is the first thing you read. Severe/High miles come before anything else on each card.
- Contrast meets WCAG AA on the navy background. Focus is visible on every control.

### 2.3 UX
- **Every state is designed**: empty (first visit has a sample trip ready to run), loading (skeleton cards, map keeps its previous view), partial results (2 of 3 routes), provider failure (a clear message plus a retry button), no safe route (a banner that suggests a later departure).
- **Feedback under 100 ms** for every interaction. Long work shows progress steps: "Routing… Fetching weather… Scoring…".
- Keyboard: the whole form works with the keyboard, Enter submits, arrow keys move the slider.
- Responsive: on a laptop (1366×768) everything fits without scrolling the page. On a phone, the map sits above a bottom sheet with the results.
- Map camera: fits all routes after a search, smooth transitions, never jumps.
- Shareable URL that restores the trip (cheap and helps the reviewer). Moved here from the stretch list.

### 2.4 Performance targets (measured, reported in README)
- Trip planning (cold cache) < 4 s; cached < 300 ms.
- Heatmap payload for 49 h < 150 KB; slider frame time < 16 ms.
- Initial JS < 300 KB gzipped (map code loaded lazily).

---

## 3. How we read the ambiguous parts

These go in the README as well, so reviewers see the choices were deliberate.

| # | Ambiguity in the brief | Our rule |
|---|---|---|
| A1 | Shared boundaries (rain 0.25 is both Moderate and High, etc.) | **Ranges are half-open; a boundary value belongs to the higher level.** Rain: Moderate [0.10, 0.25), High [0.25, 0.50), Severe [0.50, 1.00], No Travel > 1.00. Snow is the same shape. Wind: Moderate [25, 35), High [35, 45), Severe [45, 55), No Travel ≥ 55. Each boundary gets a unit test. |
| A2 | "Every 10 / 25 / 50 miles" | A **user-selectable interval**, default 25 mi. Checkpoints at mile 0, every N miles, and at the destination. |
| A3 | Wind: sustained or gusts? | **Gusts** (high-profile trailers tip over on gusts, so this is the safer choice). Sustained wind is still shown in tooltips. Set by one backend setting. |
| A4 | Overall level of a checkpoint | **Highest** of the wind, rain and snow levels, after the load rules have adjusted the wind level. |
| A5 | "Severe miles" | Each checkpoint covers the stretch of route **halfway to its neighbours**. A route's Severe/High miles are the total of those stretches. |
| A6 | "Average risk" | Mile-weighted mean of levels scored Low=0 … No Travel=4. |
| A7 | No Travel isn't in the ranking list | Any route with **No Travel** miles ranks below every route without them. If all routes have some, we still rank them but show a "no safe route at this departure" banner. |
| A8 | "Balancing" vs the numbered list | A **strict lexicographic** order, exactly as numbered. The UI explains which criterion decided the winner. |
| A9 | Forecast time at a checkpoint | Departure time + the routing API's cumulative travel time to that point, rounded to the **nearest forecast hour**. |
| A10 | Rain/snow per hour | Open-Meteo hourly values (each is the total for the preceding hour), requested in inches (verified: `snowfall` comes back in inches too). **Rain rate = `rain` + `showers`.** Open-Meteo reports convective showers separately, and leaving them out would miss thunderstorm downpours. |
| A11 | Heatmap slider "0–48 h" | Hours **from now** (the forecast's own clock). Markers on the slider show the trip's departure and arrival. The heatmap colours each cell by its overall risk level (A4). |
| A12 | Departure in the far future | Departure must be between now and now + 48 h, so every ETA falls inside a reliable forecast. |
| A13 | API returns fewer than 3 routes | Ask TomTom for 2 alternatives. If it returns fewer, show what came back with a notice. Stretch: generate more by forcing the route through an offset waypoint. |

---

## 4. Decisions

### Made
| ID | Decision | Why |
|---|---|---|
| T1 | **React 19 + Vite 8 + TypeScript + MUI 9** | Spotter's job post asks for React + MUI. Vite is the current standard. |
| T2 | **Django 6.1 + DRF 3.18 on Python 3.13**, managed with **uv** | Latest stable versions that work together. DRF is named in the job post. |
| T3 | **TomTom Routing API**: `travelMode=truck` with `vehicleWeight` and `extendedRouteRepresentation=travelTime`. **The main route and detour routes through offset waypoints are requested in parallel** (TomTom's own alternatives cost about +5.5 s). TomTom Search for geocoding. | Truck-aware, takes the load weight, gives travel time along the route (A9). Free tier with no card, 2,500 requests/day. ❌ OpenRouteService: alternatives limited to < 100 km. Also compared: HERE (strong; kept as plan B), Google (truck routing probably at the Enterprise tier), Mapbox (no truck mode). |
| T4 | **Open-Meteo** for weather | No API key, hourly 0–48 h forecasts, many coordinates per request, returns mph and inches. |
| T5 | **MapLibre GL 6 + deck.gl 9**, CARTO Dark Matter basemap | Drawn on the GPU (needed for the 40% performance grade), no key needed, the dark map matches Spotter's navy UI. |
| T6 | **TanStack Query** for server state, React state/context for UI state | Small and well known. No Redux needed. |
| T7 | **Redis cache** in production (`REDIS_URL`), in-process cache locally. No database models. | Redis is in the job post. Routes and forecasts are cached by rounded coordinates and hour. |
| T8 | One **Docker image**: Django + WhiteNoise serves the built SPA | Single deploy, no CORS in production, quick to host. |
| T9 | **Spotter's visual language** (navy `#061830`, turquoise `#40E0D0`, coral `#F84960`, DM Sans, Lens-style cold→hot heat scale). See `docs/brand.md` | The app should look like it already belongs in their product suite. |
| T10 | **ruff + pytest** (backend), **oxlint + tsc** (frontend), GitHub Actions CI | Covers the 15% code-quality grade at almost no cost. |
| T11 | **Hosting: GCP Cloud Run (primary) + Railway (backup)**, both running the same Docker image (port from `$PORT`, Redis optional) | Cloud Run matches Spotter's GCP. Railway is the quickest fallback if GCP setup blocks us. On Cloud Run we skip Redis (managed Redis starts around $35/mo), so each instance keeps its own in-memory cache. |

### Waiting on you
| ID | Decision | Recommendation | Blocks |
|---|---|---|---|
| P1 | **TomTom API key**: sign up at developer.tomtom.com (≈5 min) and put the key in `backend/.env` | — | Phase 1, real routes (can use mocks until then) |
| P3 | **Repo visibility**: private while building, public at submission | Private now → public on Day 3 | Repo creation |
| P4 | GitHub auth on this machine: run `! gh auth login` | — | First push |

---

## 5. Architecture

```
React (Vite, MUI, MapLibre + deck.gl)
   │  POST /api/trips       { origin, destination, departAt, weightLb, intervalMi }
   │  GET  /api/geocode     ?q=            (autocomplete, cached)
   │  GET  /api/heatmap     ?bbox=&hours=0-48   (one call, all 49 hours)
   ▼
Django + DRF
   routing/
     risk.py         pure functions: classify(wind, rain, snow, weight) -> RiskLevel   ← fully unit-tested
     sampling.py     route polyline + travel time per point -> checkpoints (mile, lat/lon, ETA)
     recommend.py    route stats + lexicographic ranking + "why" explanation
     providers/      tomtom.py, open_meteo.py (httpx, timeouts, cache)
     services.py     plan_trip(): routes → checkpoints → batched weather → risk → ranking
```

Heatmap performance plan:
- Build the corridor grid on the server (route bounding box + buffer, ~30×30 cells).
- Fetch **all 49 hours in one batched request**.
- Return a compact payload of uint8 risk values per cell per hour, encoded as base64.
- The client draws each hour as a smoothly interpolated texture (deck.gl `BitmapLayer`), so **dragging the slider never touches the network**. A play button animates through the hours.

---

## 6. Phases and hour budget (16 h max)

| Phase | Scope | Budget | Day |
|---|---|---|---|
| **P0 Setup** | Research, decisions, project skeleton, CI, roadmap | 1.0 h | Day 1 ✅ |
| **P1 Domain core** ✅ | `risk.py` + boundary-table tests · TomTom + Open-Meteo clients with caching · checkpoint sampling, ETAs and ranking ("why" data included) with tests | 3.0 h | Day 1 |
| **P2 API** ✅ | `/trips`, `/geocode`, `/heatmap`; request checks; clear error codes the UI can turn into messages | 1.0 h | Day 2 |
| **P3a UI: plan** ✅ | Trip form meeting R1–R3 criteria · route cards with "why it won" and risk strip | 2.0 h | Day 2 |
| **P3b UI: map** | R8 criteria: route ↔ card highlighting, checkpoint tooltips explaining the cause, legend, camera | 2.0 h | Day 2–3 |
| **P3c UI: heatmap** | R9 criteria: corridor raster, 60 fps slider, play, departure/arrival markers | 2.0 h | Day 3 |
| **P3d UX polish** | Go through §2.2–2.3 item by item: every state, keyboard, responsive, contrast, shareable URL, small transitions | **1.5 h** | Day 3 |
| **P4 Ship** | Dockerfile, deploy, production settings, measure §2.4 targets and fix whatever misses | 1.5 h | Day 3 |
| **P5 Docs + Loom** | README (setup, our rules for the ambiguities, architecture, measured numbers, trade-offs), 5–10 min Loom | 1.5 h | Day 3–4 |
| Buffer | | 0.5 h | Day 4 |
| **Total** | | **16 h** | |

Of the 16 h, **9.5 h go to UI/UX (P3a–P3d + the P4 performance pass)** and 4 h to the domain core and API, which roughly follows the 40/40 grading split.

Rule: if a phase goes over budget by more than 30 min, cut the stretch items first. **Never cut P3d (UX polish) or the quality bar.**

---

## 7. What makes this stand out (from the job post)

The posting asks for: React + **MUI**, DRF, *"non-trivial business logic … scoring, ranking, decision rules, and surfacing them clearly in the UI"*, *"strong attention to visual detail"*, *"performance instincts (query behavior, caching)"*, Redis/GCP/Docker, and experience with AI coding assistants.

| Stand-out item | Matches | Cost |
|---|---|---|
| **"Why this route" explanation**: shows which ranking criterion decided the winner, with the numbers for each route | "surfacing them clearly in the UI" | Low (in P3a) |
| **Risk strip** per route: a thin coloured bar along the trip's distance, readable at a glance | Visual detail, clarity | Low |
| Looks native to Spotter: MUI, their palette, DM Sans, Lens heat scale | MUI, visual detail | Low (theme done) |
| One request for the whole heatmap, slider runs entirely on the GPU, measured numbers in the README | Performance instincts | In P3c |
| Redis cache with clear keys and timeouts, batched weather calls (one call per route, not per checkpoint) | Caching, query behaviour | In P1 |
| Every rule boundary covered by tests; ranking tests | Business logic, code quality | In P1 |
| Docker + CI + deployed on GCP (if P2 = Cloud Run) | GCP, Docker | In P4 |
| *Stretch (only once §2 is all green):* **departure-time advisor**: "Leave at 14:00 → 0 Severe miles" (re-scores the cached forecast for +0…+24 h) | Decision rules | ~1 h, taken from the buffer |

Out of scope on purpose: user accounts, saved trips, building our own routing engine, mobile app.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| TomTom returns fewer than 3 alternatives on some trips | A13 notice; stretch item forces more alternatives via waypoints |
| Open-Meteo rate limits (10k calls/day, a call with many locations counts as several) | Batch requests, round coordinates to 0.1°, Redis cache with 30 min timeout |
| Hosting cold starts hurt the "performance" impression | Cloud Run / Railway; warm the app before recording the Loom |
| Going over the 16 h budget | Budget per phase plus the cut rule in §6 |

## 8b. Findings log
- **2026-10-19**: TomTom sometimes returns only 2 routes (Dallas → Denver) even with `maxAlternatives=5`. Fixed with detour via-points, filtered by overlap (> 0.7 of shared 0.1° cells counts as a duplicate) and by time (> 1.5× the fastest is dropped).
- **2026-10-19**: TomTom's `progress` is sparse (~80 entries for ~10k points). ETAs are interpolated between entries.
- **2026-10-19**: A live Dallas → Denver trip takes **9.4 s cold** (target < 4 s). The provider calls run one after another. → In P4, run the detour and weather calls in parallel. The response is 55 KB with paths simplified to ~250 points.
- **2026-10-19**: "Why it won" now explains the winner against **each** alternative. Comparing only with the runner-up hid the safety reason whenever the two best routes were both calm.
- **2026-10-19**: Measured one TomTom call for Dallas → Denver: 7.4 s with `maxAlternatives=5`, 1.8 s without. Switched to parallel main + detour requests. **Cold trip plan: 9.4 s → 3.8 s** with 3 TomTom requests.
- **2026-10-19**: Open-Meteo counts **each location as one call** (10k/day, 600/min, per IP; Cloud Run's outbound IPs are shared). The heatmap only fetches a corridor of cells around the routes, at most 300 (Dallas → Denver: 200 cells at 0.5°). The heatmap score is continuous, and its integer part always equals the checkpoint level (tested across a sweep of conditions).
- **2026-10-19**: Live API on Dallas → Denver: `/trips` **3.6 s** cold, 52 KB (9.6 KB gzipped) · `/heatmap` **0.8 s** cold / 69 ms cached, 14 KB for all 49 hours.
- **2026-10-19**: Shorter trips can have fewer than 3 truck routes (Houston → New Orleans: 1; Albuquerque → Denver: 2) because the detours fail the time or overlap filters. The UI says so plainly. Possible tuning: adapt the detour offset to trip length.
- **2026-10-19**: For the Loom, scan the live US forecast on recording day (coarse grid, ~230 Open-Meteo calls) and pick a trip that crosses real hazardous weather. Hazards are local, so check the trip with the real checkpoints before recording.

## 9. Definition of done
- [ ] Every item of the §2 quality bar checked on the hosted URL (criteria, UI, UX states, performance numbers)
- [ ] R1–R9 work on the hosted URL for a long trip (e.g. Dallas, TX → Denver, CO)
- [ ] Backend tests green in CI; lint clean on both sides
- [ ] README covers setup, environment variables, our rules for the ambiguities, architecture and trade-offs
- [ ] Loom recorded (5–10 min) and linked in the README
- [ ] Repo public, link + hosted URL + Loom sent
