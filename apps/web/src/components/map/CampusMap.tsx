import "leaflet/dist/leaflet.css";

import * as L from "leaflet";
import { millisofdayToHHMM } from "@better-ttb/shared";
import * as React from "react";

import { useResolvedTheme } from "@/components/theme-toggle";
import type { DayItinerary, ItineraryMarker, ItineraryTransfer } from "@/lib/itinerary";
import { fetchWalkRoute } from "@/lib/route-client";

interface CampusMapProps {
  itinerary: DayItinerary;
}

/** Solid-polyline colours per transfer severity (tight red, warn amber, ok slate). */
const SEVERITY_COLORS: Record<ItineraryTransfer["severity"], string> = {
  tight: "#dc2626",
  warn: "#d97706",
  ok: "#334155",
};

const ST_GEORGE_CENTER: L.LatLngTuple = [43.6629, -79.3957];
const DEFAULT_ZOOM = 15;
const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
const CARTO_TILE_URLS = {
  light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
} as const;

/**
 * Imperative leaflet map. Kept in a separate module that is only imported by the
 * /map route via React.lazy so leaflet lands in its own chunk and never bloats
 * the other routes. This component only renders on the client.
 */
export function CampusMap({ itinerary }: CampusMapProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<L.Map | null>(null);
  const layerRef = React.useRef<L.LayerGroup | null>(null);
  const routeLayerRef = React.useRef<L.LayerGroup | null>(null);
  const tileLayerRef = React.useRef<L.TileLayer | null>(null);
  const resolvedTheme = useResolvedTheme();

  React.useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = L.map(containerRef.current, {
      center: ST_GEORGE_CENTER,
      zoom: DEFAULT_ZOOM,
      scrollWheelZoom: true,
    });

    tileLayerRef.current = L.tileLayer(CARTO_TILE_URLS.light, {
      attribution: CARTO_ATTRIBUTION,
      maxZoom: 19,
      subdomains: "abcd",
    }).addTo(map);

    // Route lines sit under the markers so pins stay clickable; the marker layer
    // is added last so it paints on top.
    routeLayerRef.current = L.layerGroup().addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      routeLayerRef.current = null;
      tileLayerRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    tileLayerRef.current?.setUrl(CARTO_TILE_URLS[resolvedTheme]);
  }, [resolvedTheme]);

  React.useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    const routeLayer = routeLayerRef.current;

    if (!map || !layer || !routeLayer) {
      return;
    }

    layer.clearLayers();
    routeLayer.clearLayers();

    if (itinerary.markers.length === 0) {
      map.setView(ST_GEORGE_CENTER, DEFAULT_ZOOM);
      return;
    }

    const path: L.LatLngExpression[] = [];

    itinerary.markers.forEach((marker) => {
      const position: L.LatLngExpression = [
        marker.coordinates.lat,
        marker.coordinates.lng,
      ];
      path.push(position);

      L.marker(position, { icon: buildMarkerIcon(marker) })
        .bindPopup(buildPopupHtml(marker))
        .addTo(layer);
    });

    const bounds = L.latLngBounds(path as L.LatLngTuple[]);
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 17 });

    // Cancel any in-flight route fetches when the day/term (itinerary) changes.
    const controller = new AbortController();

    itinerary.transfers.forEach((transfer) => {
      const color = SEVERITY_COLORS[transfer.severity];
      const from: L.LatLngTuple = [transfer.from.coordinates.lat, transfer.from.coordinates.lng];
      const to: L.LatLngTuple = [transfer.to.coordinates.lat, transfer.to.coordinates.lng];

      // Immediate fallback: a dashed straight line while the real route loads (or
      // permanently, if the routing endpoint fails).
      const fallback = L.polyline([from, to], {
        color,
        weight: 3,
        opacity: 0.6,
        dashArray: "6 8",
      }).addTo(routeLayer);

      void fetchWalkRoute(transfer.from.buildingCode, transfer.to.buildingCode, controller.signal)
        .then((route) => {
          if (controller.signal.aborted || !route || route.coordinates.length < 2) {
            return;
          }

          // Upgrade to the solid, real walking geometry.
          routeLayer.removeLayer(fallback);
          L.polyline(route.coordinates as L.LatLngTuple[], {
            color,
            weight: 4,
            opacity: 0.85,
          }).addTo(routeLayer);
        })
        .catch(() => {
          // Keep the dashed fallback on any unexpected failure.
        });
    });

    return () => {
      controller.abort();
    };
  }, [itinerary]);

  return <div ref={containerRef} className="h-full w-full" />;
}

function buildMarkerIcon(marker: ItineraryMarker): L.DivIcon {
  const color = marker.stops[0]?.color ?? "#2563eb";

  return L.divIcon({
    className: "",
    html: `<div style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:9999px;background:${color};color:#fff;font-size:13px;font-weight:600;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.35);">${marker.index}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

function buildPopupHtml(marker: ItineraryMarker): string {
  const buildingName = marker.buildingName
    ? `<div style="font-size:11px;color:#64748b;">${escapeHtml(marker.buildingName)}</div>`
    : "";
  const stops = marker.stops
    .map((stop) => {
      const time = `${millisofdayToHHMM(stop.startMillis)}–${millisofdayToHHMM(stop.endMillis)}`;

      return `<div style="margin-top:6px;">
        <div style="font-weight:600;">${escapeHtml(stop.courseCode)} · ${escapeHtml(stop.sectionName)}</div>
        <div style="color:#475569;">${escapeHtml(stop.room)}</div>
        <div style="color:#475569;">${time}</div>
      </div>`;
    })
    .join("");

  return `<div style="min-width:150px;">
    <div style="font-weight:600;">${escapeHtml(marker.buildingCode)}</div>
    ${buildingName}
    ${stops}
  </div>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
