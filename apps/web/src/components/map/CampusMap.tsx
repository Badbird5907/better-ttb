import "leaflet/dist/leaflet.css";

import * as L from "leaflet";
import { millisofdayToHHMM } from "@better-ttb/shared";
import * as React from "react";

import { useResolvedTheme } from "@/components/theme-toggle";
import type { DayItinerary, ItineraryMarker, ItineraryTransfer } from "@/lib/itinerary";
import { fetchWalkRoute } from "@/lib/route-client";

interface CampusMapProps {
  itinerary: DayItinerary;
  /** Index (into `itinerary.transfers`) of the currently hovered transfer card, or null. */
  hoveredTransferIndex: number | null;
}

/**
 * Per-transfer layer bookkeeping so the hover effect can isolate a single route
 * without refetching or rebuilding anything. `routeLine` starts undefined and is
 * populated when the real geometry finishes loading; `fromMarkerIdx`/`toMarkerIdx`
 * point at the endpoints in `markerRefs`.
 */
interface TransferEntry {
  severity: ItineraryTransfer["severity"];
  fallbackLine: L.Polyline;
  routeLine?: L.Polyline;
  fromMarkerIdx: number;
  toMarkerIdx: number;
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
export function CampusMap({ itinerary, hoveredTransferIndex }: CampusMapProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<L.Map | null>(null);
  const layerRef = React.useRef<L.LayerGroup | null>(null);
  const routeLayerRef = React.useRef<L.LayerGroup | null>(null);
  const tileLayerRef = React.useRef<L.TileLayer | null>(null);
  const resolvedTheme = useResolvedTheme();

  // Per-transfer polylines + endpoint markers, rebuilt whenever the itinerary
  // changes. Kept in refs (not state) so the hover effect can restyle them
  // imperatively without triggering a rebuild or route refetch.
  const transferEntriesRef = React.useRef<TransferEntry[]>([]);
  const markerRefs = React.useRef<L.Marker[]>([]);
  // Mirror of the hovered index so an async route fetch that resolves *while*
  // a card is hovered can apply the current hover styling to the new polyline.
  const hoveredIndexRef = React.useRef<number | null>(null);

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
    // Reset per-rebuild bookkeeping so stale entries/markers can't leak across
    // day/term changes or strict-mode double-invokes.
    transferEntriesRef.current = [];
    markerRefs.current = [];

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

      const leafletMarker = L.marker(position, { icon: buildMarkerIcon(marker) })
        .bindPopup(buildPopupHtml(marker))
        .addTo(layer);
      markerRefs.current.push(leafletMarker);
    });

    const bounds = L.latLngBounds(path as L.LatLngTuple[]);
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 17 });

    // Cancel any in-flight route fetches when the day/term (itinerary) changes.
    const controller = new AbortController();

    itinerary.transfers.forEach((transfer, transferIndex) => {
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

      // Markers collapse consecutive same-building stops and transfers are the
      // building changes between them, so transfer N always bridges marker N and
      // marker N+1 in chronological order.
      const entry: TransferEntry = {
        severity: transfer.severity,
        fallbackLine: fallback,
        fromMarkerIdx: transferIndex,
        toMarkerIdx: transferIndex + 1,
      };
      transferEntriesRef.current.push(entry);

      void fetchWalkRoute(transfer.from.buildingCode, transfer.to.buildingCode, controller.signal)
        .then((route) => {
          if (controller.signal.aborted || !route || route.coordinates.length < 2) {
            return;
          }

          // Upgrade to the solid, real walking geometry.
          routeLayer.removeLayer(fallback);
          const routeLine = L.polyline(route.coordinates as L.LatLngTuple[], {
            color,
            weight: 4,
            opacity: 0.85,
          }).addTo(routeLayer);
          entry.routeLine = routeLine;

          // A route that finishes loading *while* a card is hovered must respect
          // the current hover state instead of the just-added default style.
          applyHoverStyles(
            hoveredIndexRef.current,
            transferEntriesRef.current,
            markerRefs.current,
            routeLayer,
          );
        })
        .catch(() => {
          // Keep the dashed fallback on any unexpected failure.
        });
    });

    // Apply whatever hover state is active at (re)build time (e.g. rebuild while
    // a card stays hovered).
    applyHoverStyles(
      hoveredIndexRef.current,
      transferEntriesRef.current,
      markerRefs.current,
      routeLayer,
    );

    return () => {
      controller.abort();
    };
  }, [itinerary]);

  // Hover isolation — deliberately separate from the route-fetch effect so
  // hovering never triggers a refetch or a layer rebuild. Restyles existing
  // polylines/markers imperatively.
  React.useEffect(() => {
    hoveredIndexRef.current = hoveredTransferIndex;
    const routeLayer = routeLayerRef.current;

    if (!routeLayer) {
      return;
    }

    applyHoverStyles(
      hoveredTransferIndex,
      transferEntriesRef.current,
      markerRefs.current,
      routeLayer,
    );
  }, [hoveredTransferIndex]);

  return <div ref={containerRef} className="h-full w-full bg-background" />;
}

/**
 * Imperatively restyles route polylines and markers to isolate a single hovered
 * transfer. When `hoveredIndex` is null everything is restored to its default
 * appearance. A transfer's active polyline is its `routeLine` once loaded, else
 * its dashed `fallbackLine`.
 */
function applyHoverStyles(
  hoveredIndex: number | null,
  entries: readonly TransferEntry[],
  markers: readonly L.Marker[],
  routeLayer: L.LayerGroup,
): void {
  if (hoveredIndex === null) {
    // Restore every polyline and marker to its default appearance. Once a real
    // route line exists it replaces the fallback, so only one of the two is on
    // the map at a time.
    entries.forEach((entry) => {
      const color = SEVERITY_COLORS[entry.severity];

      if (entry.routeLine) {
        if (!routeLayer.hasLayer(entry.routeLine)) {
          entry.routeLine.addTo(routeLayer);
        }
        entry.routeLine.setStyle({ color, weight: 4, opacity: 0.85 });
        if (routeLayer.hasLayer(entry.fallbackLine)) {
          routeLayer.removeLayer(entry.fallbackLine);
        }
      } else {
        if (!routeLayer.hasLayer(entry.fallbackLine)) {
          entry.fallbackLine.addTo(routeLayer);
        }
        entry.fallbackLine.setStyle({ color, weight: 3, opacity: 0.6 });
      }
    });
    markers.forEach((marker) => marker.setOpacity(1));
    return;
  }

  const hovered = entries[hoveredIndex];

  entries.forEach((entry, index) => {
    const color = SEVERITY_COLORS[entry.severity];
    const active = entry.routeLine ?? entry.fallbackLine;

    if (index === hoveredIndex) {
      // Emphasize the hovered transfer: heavier weight, full opacity, keep color.
      const baseWeight = entry.routeLine ? 4 : 3;
      active.setStyle({ color, weight: baseWeight + 2, opacity: 1 });
    } else {
      // Hide the non-hovered transfers' lines. Removing both the fallback and
      // any loaded route keeps them fully out of view until hover ends.
      if (routeLayer.hasLayer(entry.fallbackLine)) {
        routeLayer.removeLayer(entry.fallbackLine);
      }
      if (entry.routeLine && routeLayer.hasLayer(entry.routeLine)) {
        routeLayer.removeLayer(entry.routeLine);
      }
    }
  });

  // Re-add the hovered transfer's fallback if a non-hovered pass removed it (can
  // happen when its route hasn't loaded yet and it shares nothing else).
  if (hovered && !hovered.routeLine && !routeLayer.hasLayer(hovered.fallbackLine)) {
    hovered.fallbackLine.addTo(routeLayer);
    hovered.fallbackLine.setStyle({
      color: SEVERITY_COLORS[hovered.severity],
      weight: 5,
      opacity: 1,
    });
  }

  // Fade markers that are not the hovered transfer's endpoints.
  markers.forEach((marker, index) => {
    const isEndpoint =
      hovered != null && (index === hovered.fromMarkerIdx || index === hovered.toMarkerIdx);
    marker.setOpacity(isEndpoint ? 1 : 0.3);
  });
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
