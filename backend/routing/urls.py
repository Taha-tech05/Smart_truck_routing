"""Routing app URLs."""
from django.urls import path

from . import views

urlpatterns = [
    path("health", views.health, name="health"),
    path("geocode", views.geocode_view, name="geocode"),
    path("analyze", views.analyze_view, name="analyze"),
    path("heatmap", views.heatmap_view, name="heatmap"),
]
