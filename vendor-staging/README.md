# UTSG Buildings Vendor Staging

This directory contains `buildings.utsg.json`, a vendored University of Toronto St. George buildings dataset for better-ttb.

## Provenance

- Base data: `cobalt-uoft/datasets` `buildings.json`, downloaded from https://raw.githubusercontent.com/cobalt-uoft/datasets/master/buildings.json. The upstream repository is MIT licensed.
- Supplemental reference: official map.utoronto.ca Concept3D locations API, downloaded from https://api.concept3d.com/locations?map=1809&key=0001085cc708b9cef47080f064612ca5 on 2026-07-11.

## Transform

1. Read the Cobalt file as newline-delimited JSON.
2. Keep only `campus == "UTSG"`.
3. Drop geometry (`polygon`) and transform each row to `{ code, name, shortName, address, lat, lng, source }`.
4. Build `address` as `"<street>, <city>"`.
5. Mark Cobalt rows with `source: "cobalt-2017"`.
6. Drop placeholder `code: "-"`, duplicated upstream codes after the first sorted row, demolished rows, and zero-coordinate rows that cannot pass the coordinate sanity checks.
7. Add missing post-2017 Concept3D rows for `MY`, `SW`, and `SCM`, marked with `source: "concept3d-2026"`. `SCM` is a best-effort non-conflicting code for Student Commons because Concept3D uses `SU`, which conflicts with Cobalt's existing `SU` for 40 Sussex Avenue.
8. Sort the final array by `code` and pretty-print with a two-space JSON indent.

## Regenerate

Run the generation workflow from the repository root:

```powershell
$ErrorActionPreference = 'Stop'
$cobaltUrl = 'https://raw.githubusercontent.com/cobalt-uoft/datasets/master/buildings.json'
$conceptUrl = 'https://api.concept3d.com/locations?map=1809&key=0001085cc708b9cef47080f064612ca5'
# Parse Cobalt as NDJSON, filter UTSG, normalize fields, add MY/SW/SCM from Concept3D,
# assert BA and MP coordinates, assert coordinate bounds, assert unique codes, assert count >= 170,
# then write vendor-staging/buildings.utsg.json.
```

Concept3D additions in this snapshot:

- MY - Myhal Centre for Engineering Innovation & Entrepreneurship from Concept3D `Myhal Centre for Engineering Innovation & Entrepreneurship | MY` (43.660862, -79.396538)
- SCM - Student Commons from Concept3D `Student Commons | SU` (43.658752, -79.397919)
- SW - Schwartz Reisman Innovation Campus West from Concept3D `Schwartz Reisman Innovation Campus West` (43.660328, -79.389145)
