# Weather-Aware Truck Routing

Helps a truck driver pick the safest route: it compares 3 route options using the forecast weather at each checkpoint *when the truck will actually be there*, the load weight, and the travel time.

> 🚧 In progress. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for requirements, the quality bar, how we read the ambiguous rules, and the plan.

## Stack
- **Frontend:** React 19, Vite 8, TypeScript, MUI 9, MapLibre GL + deck.gl, TanStack Query
- **Backend:** Django 6.1, Django REST Framework, Python 3.13 (uv), Redis cache
- **Providers:** TomTom (truck routing + geocoding), Open-Meteo (hourly forecast)

## Run locally
Requirements: Node 24 (`nvm use`) and [uv](https://docs.astral.sh/uv/).

```bash
# backend → http://localhost:8000
cd backend
cp .env.example .env        # add your TOMTOM_API_KEY
uv sync
uv run python manage.py runserver

# frontend → http://localhost:5173 (proxies /api to :8000)
cd frontend
npm install
npm run dev
```

## Tests & lint
```bash
cd backend && uv run pytest && uv run ruff check .
cd frontend && npm run lint && npm run build
```
