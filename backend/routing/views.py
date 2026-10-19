from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from . import services
from .heatmap import build_heatmap
from .providers.open_meteo import WeatherProviderError
from .providers.tomtom import RoutingProviderError, search_places
from .serializers import HeatmapRequestSerializer, TripRequestSerializer

# Provider error code → HTTP status. Codes are stable so the UI can map them to messages.
ROUTING_STATUS = {
    "no_route": status.HTTP_422_UNPROCESSABLE_ENTITY,
    "rate_limited": status.HTTP_503_SERVICE_UNAVAILABLE,
    "not_configured": status.HTTP_503_SERVICE_UNAVAILABLE,
}


def _provider_error(exc: Exception) -> Response:
    if isinstance(exc, RoutingProviderError):
        code = exc.code
        http = ROUTING_STATUS.get(code, status.HTTP_502_BAD_GATEWAY)
    else:
        code, http = "weather_unavailable", status.HTTP_502_BAD_GATEWAY
    return Response({"code": code, "detail": str(exc)}, status=http)


@api_view(["GET"])
def health(request):
    return Response({"status": "ok"})


@api_view(["GET"])
def geocode(request):
    query = request.query_params.get("q", "").strip()
    if len(query) < 3:
        return Response({"results": []})
    try:
        places = search_places(query[:120])
    except RoutingProviderError as exc:
        return _provider_error(exc)
    return Response({"results": [{"label": p.label, "lat": p.lat, "lon": p.lon} for p in places]})


@api_view(["POST"])
def trips(request):
    serializer = TripRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    try:
        trip = services.plan_trip(
            origin=(data["origin"]["lat"], data["origin"]["lon"]),
            destination=(data["destination"]["lat"], data["destination"]["lon"]),
            depart_at=data["depart_at"],
            weight_lb=data["weight_lb"],
            interval_mi=data["interval_mi"],
        )
    except (RoutingProviderError, WeatherProviderError) as exc:
        return _provider_error(exc)
    return Response(trip)


@api_view(["POST"])
def heatmap(request):
    serializer = HeatmapRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    paths = [[(lat, lon) for lon, lat in path] for path in data["paths"]]
    try:
        return Response(build_heatmap(paths, data["weight_lb"]))
    except WeatherProviderError as exc:
        return _provider_error(exc)
