# Wakewatch

A small, no-build web map for viewing live AIS vessel positions. It connects directly to [AISStream](https://aisstream.io/) in the browser and plots incoming position reports on a Leaflet/OpenStreetMap map.

## Run it

Serve the folder with any static web server:

```powershell
python -m http.server 8000
```

Then open <http://localhost:8000>.

The app starts in demo mode with simulated vessel movement. To use live data, create an AISStream API key, choose **Connect live**, paste the key, and draw or select a coverage area. The key is used only for the active WebSocket connection and is never stored.

## What it includes

- Live AIS position reports over WebSocket
- Clustered vessel markers and heading-aware ship symbols
- Vessel detail cards with MMSI, speed, course, heading, status, and report age
- Search, status filtering, map-follow mode, and a collapsible vessel list
- Demo feed for evaluating the interface without credentials
- Responsive desktop and mobile layouts

## Notes

- AIS coverage, latency, and message volume depend on the upstream provider.
- The browser connects to `wss://stream.aisstream.io/v0/stream`; a production deployment should normally proxy this connection through a backend to keep provider credentials server-side and apply rate limits.
- OpenStreetMap tiles require an internet connection and must be used in accordance with the tile usage policy.

