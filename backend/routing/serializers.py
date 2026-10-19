from datetime import UTC, datetime, timedelta

from rest_framework import serializers

from .sampling import ALLOWED_INTERVALS_MI

MAX_DEPARTURE_AHEAD = timedelta(hours=48)
DEPARTURE_GRACE = timedelta(minutes=15)  # a form left open for a bit is still "now"
MIN_WEIGHT_LB, MAX_WEIGHT_LB = 1_000, 80_000  # 80,000 lb = US federal gross limit


class PointSerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lon = serializers.FloatField(min_value=-180, max_value=180)
    label = serializers.CharField(required=False, allow_blank=True, max_length=200)


class TripRequestSerializer(serializers.Serializer):
    origin = PointSerializer()
    destination = PointSerializer()
    depart_at = serializers.DateTimeField()
    weight_lb = serializers.IntegerField(min_value=MIN_WEIGHT_LB, max_value=MAX_WEIGHT_LB)
    interval_mi = serializers.ChoiceField(choices=ALLOWED_INTERVALS_MI, default=25)

    def validate_depart_at(self, value: datetime) -> datetime:
        now = datetime.now(UTC)
        if value < now - DEPARTURE_GRACE:
            raise serializers.ValidationError("Departure can't be in the past.")
        if value > now + MAX_DEPARTURE_AHEAD:
            raise serializers.ValidationError(
                "Departure must be within the next 48 hours, where forecasts are reliable."
            )
        return max(value, now)

    def validate(self, attrs):
        o, d = attrs["origin"], attrs["destination"]
        if abs(o["lat"] - d["lat"]) < 1e-4 and abs(o["lon"] - d["lon"]) < 1e-4:
            raise serializers.ValidationError("Origin and destination are the same place.")
        return attrs


class HeatmapRequestSerializer(serializers.Serializer):
    # Route paths as returned by /trips ([lon, lat] pairs), so the server stays stateless.
    paths = serializers.ListField(
        child=serializers.ListField(
            child=serializers.ListField(child=serializers.FloatField(), min_length=2, max_length=2),
            min_length=2,
            max_length=3000,
        ),
        min_length=1,
        max_length=5,
    )
    weight_lb = serializers.IntegerField(min_value=MIN_WEIGHT_LB, max_value=MAX_WEIGHT_LB)
