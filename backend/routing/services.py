"""Trip planning: routes → checkpoints → weather at ETA → risk → ranking."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from django.conf import settings

from .geometry import METERS_PER_MILE, LatLon, simplify
from .providers import open_meteo, tomtom, valhalla
from .recommend import CRITERIA, rank_routes, route_stats
from .risk import RiskLevel, assess
from .sampling import sample_checkpoints

PATH_TOLERANCE_DEG = 0.002  # ~200 m: invisible at trip zoom, ~95% fewer vertices


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, UTC).isoformat(timespec="minutes")


def plan_trip(
    origin: LatLon,
    destination: LatLon,
    depart_at: datetime,
    weight_lb: float,
    interval_mi: int,
) -> dict:
    # "now" (within a minute) lets TomTom use live traffic instead of a historic profile.
    is_now = depart_at - datetime.now(UTC) <= timedelta(minutes=1)
    provider = "tomtom"
    try:
        routes = tomtom.get_routes(origin, destination, None if is_now else depart_at, weight_lb)
    except tomtom.RoutingProviderError as exc:
        if exc.code == "no_route":
            raise
        # TomTom down, rate limited or unconfigured: fall back to Valhalla (no live traffic).
        try:
            routes = valhalla.get_routes(origin, destination, weight_lb)
        except tomtom.RoutingProviderError:
            raise exc from None
        provider = "valhalla"
    depart_ts = depart_at.timestamp()

    sampled = [sample_checkpoints(r.geometry, interval_mi) for r in routes]
    forecasts = open_meteo.get_forecasts([(c.lat, c.lon) for cps in sampled for c in cps])
    gusts = settings.WIND_METRIC == "gust"

    route_payloads, all_stats = [], []
    for i, (route, checkpoints) in enumerate(zip(routes, sampled, strict=True)):
        cp_payloads, segments = [], []
        for cp in checkpoints:
            eta_ts = depart_ts + cp.elapsed_s
            forecast = forecasts[open_meteo.snap(cp.lat, cp.lon)]
            hour = forecast.index_at(eta_ts)
            payload = {
                "mile": round(cp.mile, 1),
                "lat": round(cp.lat, 5),
                "lon": round(cp.lon, 5),
                "eta": _iso(eta_ts),
                "represents_mi": round(cp.represents_mi, 2),
            }
            if hour is None:  # beyond the forecast horizon: shown, but not scored
                payload.update(level=None, forecast_time=None)
                cp_payloads.append(payload)
                continue

            wind = forecast.wind_mph[hour]
            gust = forecast.gust_mph[hour]
            rain = forecast.rain_in_hr[hour]
            snow = forecast.snow_in_hr[hour]
            result = assess(gust if gusts else wind, rain, snow, weight_lb)
            segments.append((result.level, cp.represents_mi))
            payload.update(
                level=result.level.name,
                drivers=result.drivers,
                load_escalated=result.load_escalated,
                forecast_time=_iso(forecast.start_ts + hour * 3600),
                weather={
                    "wind_mph": round(wind, 1),
                    "gust_mph": round(gust, 1),
                    "rain_in_hr": round(rain, 3),
                    "snow_in_hr": round(snow, 2),
                },
                levels={
                    "wind": result.wind.name,
                    "rain": result.rain.name,
                    "snow": result.snow.name,
                },
            )
            cp_payloads.append(payload)

        stats = route_stats(segments, route.duration_s)
        all_stats.append(stats)
        path = simplify(list(route.geometry.coords), PATH_TOLERANCE_DEG)
        route_payloads.append(
            {
                "id": i,
                "distance_mi": round(route.distance_m / METERS_PER_MILE, 1),
                "duration_s": round(route.duration_s),
                "traffic_delay_s": round(route.traffic_delay_s),
                "departure": _iso(depart_ts),
                "arrival": _iso(depart_ts + route.duration_s),
                "via_detour": route.via_detour,
                "miles_by_level": {
                    lvl.name: round(mi, 1) for lvl, mi in stats.miles_by_level.items()
                },
                "avg_risk": round(stats.avg_risk, 3),
                "path": [[round(lon, 5), round(lat, 5)] for lat, lon in path],  # GeoJSON order
                "checkpoints": cp_payloads,
            }
        )

    ranking = rank_routes(all_stats)
    for rank, idx in enumerate(ranking.order):
        route_payloads[idx]["rank"] = rank + 1

    best = ranking.order[0]
    labels = {key: label for key, label, *_ in CRITERIA}
    return {
        "routes": route_payloads,
        "recommendation": {
            "route_id": best,
            "criterion": ranking.deciding_criterion,
            "label": ranking.deciding_label,
            "all_have_no_travel": ranking.all_have_no_travel,
            "beats": [
                {"route_id": idx, "criterion": key, "label": labels.get(key)}
                for idx, key in ranking.winner_beats.items()
            ],
            "criteria_order": [key for key, *_ in CRITERIA],
        },
        "risk_levels": [lvl.name for lvl in RiskLevel],
        "interval_mi": interval_mi,
        "weight_lb": weight_lb,
        "wind_metric": settings.WIND_METRIC,
        "routing_provider": provider,  # "valhalla" = backup routing without live traffic
    }
