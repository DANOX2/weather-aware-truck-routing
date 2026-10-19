from django.conf import settings
from django.http import FileResponse, Http404
from django.urls import include, path
from django.views.decorators.cache import never_cache


@never_cache  # assets are fingerprinted and cached; the page that references them must not be
def spa(request):
    index = settings.FRONTEND_DIST / "index.html"
    if not index.is_file():
        raise Http404("Frontend not built. Run `npm run build` in frontend/.")
    return FileResponse(index.open("rb"), content_type="text/html")


urlpatterns = [
    path("api/", include("routing.urls")),
    path("", spa, name="spa"),
]
