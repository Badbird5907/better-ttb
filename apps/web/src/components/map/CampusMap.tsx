import "leaflet/dist/leaflet.css";

import * as L from "leaflet";
import { millisofdayToHHMM } from "@better-ttb/shared";
import * as React from "react";

import { useResolvedTheme } from "@/components/theme-toggle";
import type { DayItinerary, ItineraryMarker } from "@/lib/itinerary";

interface CampusMapProps {
  itinerary: DayItinerary;
}

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

    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      tileLayerRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    tileLayerRef.current?.setUrl(CARTO_TILE_URLS[resolvedTheme]);
  }, [resolvedTheme]);

  React.useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;

    if (!map || !layer) {
      return;
    }

    layer.clearLayers();

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

    if (path.length > 1) {
      L.polyline(path, {
        color: "#334155",
        weight: 3,
        opacity: 0.7,
        dashArray: "6 8",
      }).addTo(layer);
    }

    const bounds = L.latLngBounds(path as L.LatLngTuple[]);
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 17 });
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
