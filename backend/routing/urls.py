from django.urls import path

from . import views

urlpatterns = [
    path("health/", views.health, name="health"),
    path("geocode/", views.geocode, name="geocode"),
    path("trips/", views.trips, name="trips"),
    path("heatmap/", views.heatmap, name="heatmap"),
]
