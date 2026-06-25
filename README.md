# Wakewatch

A small, no-build web map for viewing live AIS vessel positions. It connects directly to [AISStream](https://aisstream.io/) in the browser and plots incoming position reports on a Leaflet/OpenStreetMap map.

## Run it

Serve the folder with any static web server:

```powershell
python -m http.server 8000
```

Then open <http://localhost:8000>.

The app starts in demo mode with simulated vessel movement. To use live data, create an AISStream API key, choose **Connect live**, paste the key, and select the current map or worldwide coverage. The key is used only for the active WebSocket connection and is never stored.

## What it includes

- Live AIS position and static vessel reports over WebSocket
- Automatic reconnects with exponential backoff
- Coverage that follows the map as it pans and zooms
- Heading-aware vessel markers and optional breadcrumb trails
- Vessel details with MMSI, call sign, type, destination, ETA, speed, course, heading, status, and report age
- Search, status filtering, true in-view counts, and a collapsible vessel list
- Stale-contact styling and automatic cleanup of hour-old reports
- Demo feed for evaluating the interface without credentials
- Responsive desktop and mobile layouts

## Notes

- AIS coverage, latency, and message volume depend on the upstream provider.
- Track trails contain only positions received while the page is open; they are not historical voyage data.
- The browser connects to `wss://stream.aisstream.io/v0/stream`; a production deployment should normally proxy this connection through a backend to keep provider credentials server-side and apply rate limits.
- OpenStreetMap tiles require an internet connection and must be used in accordance with the tile usage policy.
