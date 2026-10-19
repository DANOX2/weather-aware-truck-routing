import pytest


@pytest.fixture(autouse=True)
def isolate_from_local_env(settings):
    """Tests never depend on a developer's .env (demo mode, real API keys)."""
    settings.DEMO_FIXTURES = False
    settings.TOMTOM_API_KEY = ""
