"""Find a real trip that crosses hazardous weather in the next 48 h (demo / Loom prep).

    uv run python manage.py find_hazards --weight 42000 --verify 3

1. Scans a coarse US grid (~230 Open-Meteo calls) for the worst conditions per cell.
2. Pairs major freight cities whose straight line passes a hazard at about the right time.
3. Plans the top candidates for real (3–5 TomTom calls each) and prints those with
   High/Severe/No-travel miles, plus the departure time to use.
"""

import math
import time
from datetime import UTC, datetime, timedelta

from django.core.management.base import BaseCommand

from routing.geometry import METERS_PER_MILE, haversine_m
from routing.heatmap import risk_index
from routing.providers.open_meteo import WeatherProviderError, get_forecasts
from routing.providers.tomtom import RoutingProviderError
from routing.services import plan_trip

CITIES = {
    "Seattle, WA": (47.61, -122.33),
    "Portland, OR": (45.52, -122.68),
    "Sacramento, CA": (38.58, -121.49),
    "Los Angeles, CA": (34.05, -118.24),
    "Las Vegas, NV": (36.17, -115.14),
    "Phoenix, AZ": (33.45, -112.07),
    "Salt Lake City, UT": (40.76, -111.89),
    "Boise, ID": (43.62, -116.2),
    "Denver, CO": (39.74, -104.99),
    "Albuquerque, NM": (35.08, -106.65),
    "El Paso, TX": (31.76, -106.49),
    "Billings, MT": (45.78, -108.5),
    "Dallas, TX": (32.78, -96.8),
    "Houston, TX": (29.76, -95.37),
    "Oklahoma City, OK": (35.47, -97.52),
    "Kansas City, MO": (39.1, -94.58),
    "Omaha, NE": (41.26, -95.93),
    "Minneapolis, MN": (44.98, -93.27),
    "Chicago, IL": (41.88, -87.63),
    "St. Louis, MO": (38.63, -90.2),
    "Memphis, TN": (35.15, -90.05),
    "Nashville, TN": (36.16, -86.78),
    "Atlanta, GA": (33.75, -84.39),
    "Jacksonville, FL": (30.33, -81.66),
    "Charlotte, NC": (35.23, -80.84),
    "Indianapolis, IN": (39.77, -86.16),
    "Columbus, OH": (39.96, -83.0),
    "Detroit, MI": (42.33, -83.05),
    "Pittsburgh, PA": (40.44, -79.99),
    "Richmond, VA": (37.54, -77.44),
    "Philadelphia, PA": (39.95, -75.17),
    "New York, NY": (40.71, -74.01),
    "Boston, MA": (42.36, -71.06),
    "New Orleans, LA": (29.95, -90.07),
}
TRUCK_MPH = 55  # rough average for timing a departure toward a hazard


def _distance_to_segment_mi(p, a, b):
    """Approximate distance from p to segment a–b (equirectangular, fine at this scale)."""
    k = math.cos(math.radians(p[0]))
    ax, ay, bx, by, px, py = a[1] * k, a[0], b[1] * k, b[0], p[1] * k, p[0]
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy or 1)))
    closest = (ay + t * dy, (ax + t * dx) / k)
    return haversine_m(p, closest) / METERS_PER_MILE, t


class Command(BaseCommand):
    help = "Find a real trip through hazardous weather in the next 48 h (for demos)."

    def add_arguments(self, parser):
        parser.add_argument("--weight", type=int, default=42_000)
        parser.add_argument("--verify", type=int, default=3, help="candidates to plan for real")

    def handle(self, *args, weight, verify, **options):
        now = time.time()
        cells = [
            (float(lat), float(lon)) for lat in range(26, 49, 2) for lon in range(-124, -67, 3)
        ]
        forecasts = get_forecasts(cells, grid_deg=1.0)
        hazards = []
        for (lat, lon), f in forecasts.items():
            for h in range(48):
                i = f.index_at(now + h * 3600)
                if i is None:
                    continue
                score = risk_index(f.gust_mph[i], f.rain_in_hr[i], f.snow_in_hr[i], weight)
                if score >= 2:
                    hazards.append((score, (lat, lon), h))
        self.stdout.write(f"{len(hazards)} hazardous cell-hours (High or worse) in the next 48 h")

        candidates = []
        for (o_name, o), (d_name, d) in ((x, y) for x in CITIES.items() for y in CITIES.items()):
            trip_mi = haversine_m(o, d) / METERS_PER_MILE
            if o_name == d_name or not 200 < trip_mi < 1100:
                continue
            for score, cell, hour in hazards:
                off_mi, t = _distance_to_segment_mi(cell, o, d)
                depart_in = hour - t * trip_mi * 1.2 / TRUCK_MPH  # 1.2: roads aren't straight
                if off_mi < 40 and 0.5 <= depart_in <= 46:
                    candidates.append((score, o_name, d_name, round(depart_in)))
                    break
        candidates.sort(reverse=True)
        seen, shortlist = set(), []
        for c in candidates:
            if (c[1], c[2]) not in seen and (c[2], c[1]) not in seen:
                seen.add((c[1], c[2]))
                shortlist.append(c)
        self.stdout.write(f"{len(shortlist)} city pairs pass a hazard; planning the top {verify}…")

        base = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
        for _score, o_name, d_name, depart_in in shortlist[:verify]:
            depart = base + timedelta(hours=depart_in)
            try:
                # 25 mi keeps each trip around 100 forecast locations (Open-Meteo: 600/min).
                trip = plan_trip(CITIES[o_name], CITIES[d_name], depart, weight, interval_mi=25)
            except (RoutingProviderError, WeatherProviderError) as exc:
                self.stdout.write(f"\n{o_name} → {d_name}: skipped ({exc})")
                continue
            worst = {
                r["id"]: {k: v for k, v in r["miles_by_level"].items() if k != "LOW" and v}
                for r in trip["routes"]
            }
            rec = trip["recommendation"]
            self.stdout.write(
                f"\n{o_name} → {d_name}, depart {depart:%a %H:%M} UTC (+{depart_in} h), "
                f"{weight:,} lb\n  risky miles per route: {worst}\n"
                f"  recommended route {rec['route_id']}: "
                + "; ".join(f"beats {b['route_id']} on {b['criterion']}" for b in rec["beats"])
            )
