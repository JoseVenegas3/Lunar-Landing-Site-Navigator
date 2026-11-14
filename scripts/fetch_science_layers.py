#!/usr/bin/env python3
"""Fetch the orbital science layers used by the site suitability score.

Everything is read with HTTP range requests, so only the bytes that are needed
leave the archives. Sources:

  psr      Permanently shadowed regions from LOLA, NASA GSFC PGDA product 90
           (LPSR_80S_20MPP_ADJ.TIF), Barker et al. 2023, doi:10.3847/PSJ/acf3e1
  diviner  Polar resource product of the Diviner radiometer (LRO-L-DLRE-5-PRP-V2.0):
           annual average and maximum temperature and the depth at which water
           ice is stable, ~500 m triangles. Paige et al. 2010, doi:10.1126/science.1187726
  feo      Lunar Prospector gamma-ray spectrometer elemental abundances, 2 degree
           equal-area pixels (LP-L-GRS-5-ELEM-ABUNDANCE-V1.0). Prettyman et al. 2006,
           doi:10.1029/2005JE002656
  gravity  GRAIL free-air gravity anomaly, degree-420 expansion, 16 pixel/deg
           (GGGRX_1200A_ANOM_L420). Lemoine et al. 2014, doi:10.1002/2014GL060027

Hydrogen (LEND / Lunar Prospector neutron maps) and a geological-density layer
are not fetched: no gridded product for them was found in these archives.

Outputs (public/science/):
  layers.json   provenance, per-site values, FeO pixels south of 78 S
  psr_cap.bin   PSR mask on the app's 160 m polar cap grid, 1 bit per cell (MSB first)
  gravity.f32   free-air anomaly on a 5 km polar grid, float32 mGal

Requires: pip install rasterio numpy
Usage:    python scripts/fetch_science_layers.py
"""
from __future__ import annotations

import json
import math
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_lola_dem import (  # noqa: E402
    CAP_N, CAP_SPACING_M, GDAL_ENV, LOCAL_N, LOCAL_SPACING_M, R_M, app_grid, bilinear, latlon_to_map, log, map_to_stereo,
    read_block, read_sites,
)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "science"
PDS = "https://pds-geosciences.wustl.edu"
URL_PSR = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LPSR_80S_20MPP_ADJ.TIF"
URL_DIVINER = PDS + "/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_prp/dlre_prp_south.tab"
URL_FEO = PDS + "/lunar/lp-l-grs-5-elem-abundance-v1/lp_9001/data/lpgrs_high1_elem_abundance_2deg.tab"
URL_GRAVITY = PDS + "/grail/grail-l-lgrs-5-rdr-v1/grail_1001/rsdmap/gggrx_1200a_anom_l420.img"
UA = {"User-Agent": "clps-lunar-mission-browser/1.0"}

GRAVITY_N, GRAVITY_SPACING_M = 123, 5000.0
R_KM = R_M / 1000.0


def http_range(url: str, start: int, end: int) -> bytes:
    """Bytes [start, end] of a remote file, with retries."""
    last = None
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, headers={**UA, "Range": f"bytes={start}-{end}"})
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            if len(data) == end - start + 1:
                return data
            last = RuntimeError(f"short read {len(data)} of {end - start + 1}")
        except Exception as exc:  # transient network errors
            last = exc
        time.sleep(3 + 3 * attempt)
    raise RuntimeError(f"range request failed for {url}") from last


def map_to_latlon(x: float, y: float) -> tuple[float, float]:
    """App map frame (metres) -> selenographic latitude / east longitude, degrees."""
    r = math.hypot(x, y)
    return -90.0 + math.degrees(r / R_M), math.degrees(math.atan2(x, y)) if r > 1e-6 else 0.0


# ------------------------------------------------------------------- PSR

def fetch_psr(sites: list[dict]) -> tuple[dict, dict]:
    per_site: dict = {}
    with rasterio.Env(**GDAL_ENV):
        with rasterio.open(URL_PSR) as ds:
            log("PSR mask on the polar cap grid (8x overview) ...")
            gx, gy = app_grid(0.0, 0.0, CAP_N, CAP_SPACING_M)
            sx, sy = map_to_stereo(gx, gy)
            margin = 3 * ds.transform.a * 8
            block, x0, y0, size = read_block(ds, sx.min() - margin, sx.max() + margin, sy.min() - margin, sy.max() + margin, 8)
            block = np.nan_to_num(block, nan=0.0)
            cap = bilinear(block, x0, y0, size, sx, sy) >= 0.5
            np.packbits(cap.astype(np.uint8), axis=None).tofile(OUT / "psr_cap.bin")
            log(f"  {100 * cap.mean():.2f} % of the cap is permanently shadowed")

            for site in sites:
                cx, cy = latlon_to_map(site["lat"], site["lon"])
                gx, gy = app_grid(cx, cy, LOCAL_N, LOCAL_SPACING_M)
                sx, sy = map_to_stereo(gx, gy)
                m = 3 * ds.transform.a
                block, x0, y0, size = read_block(ds, sx.min() - m, sx.max() + m, sy.min() - m, sy.max() + m, 1)
                local = bilinear(np.nan_to_num(block, nan=0.0), x0, y0, size, sx, sy) >= 0.5
                dist = np.hypot(gx - cx, gy - cy)
                inside = dist <= (LOCAL_N - 1) / 2 * LOCAL_SPACING_M
                near = dist[local & inside]
                per_site[site["id"]] = {
                    "distanceKm": float(near.min() / 1000.0) if near.size else None,
                    "fractionWithin8kmPct": float(100.0 * (local & inside).sum() / inside.sum()),
                    "landingPointInPsr": bool(local[(LOCAL_N - 1) // 2, (LOCAL_N - 1) // 2]),
                }
                log(f"  {site['id']}: nearest PSR {per_site[site['id']]['distanceKm']} km, {per_site[site['id']]['fractionWithin8kmPct']:.1f} % of the 8 km disc")
    layer = {
        "source": "LOLA permanently shadowed regions, NASA GSFC PGDA product 90 (LPSR_80S_20MPP_ADJ)",
        "citation": "Barker et al. 2023, Planet. Sci. J. 4, 183, doi:10.3847/PSJ/acf3e1",
        "file": "psr_cap.bin", "n": CAP_N, "spacingM": CAP_SPACING_M, "encoding": "bit-msb-first",
        "capPsrPct": float(100 * cap.mean()),
        "note": "Site values use the 20 m/px mask; the cap mask is the 160 m overview, so PSRs smaller than ~160 m are missing from it.",
    }
    return layer, per_site


# --------------------------------------------------------------- Diviner

DIV_N = 1200          # grid cells per side
DIV_REC = 210         # bytes per record
DIV_HALF = 16         # cells fetched on each side of the site
_div_geom: tuple[float, float] | None = None


def diviner_geometry() -> tuple[float, float]:
    """Half-width and cell size (km) of the stereographic grid, from the first record."""
    global _div_geom
    if _div_geom is None:
        f = [float(v) for v in http_range(URL_DIVINER, DIV_REC, 2 * DIV_REC - 1).decode().split(",")]
        k1 = 2 * R_KM / (R_KM - f[2])
        k2 = 2 * R_KM / (R_KM - f[5])
        half = abs(f[0] * k1)
        _div_geom = (half, 2 * half / DIV_N if abs(f[0] * k1 - f[3] * k2) < 1e-3 else abs(f[0] * k1 - f[3] * k2))
    return _div_geom


def fetch_diviner(sites: list[dict]) -> tuple[dict, dict]:
    half, dx = diviner_geometry()
    log(f"Diviner polar resource product: grid half-width {half:.2f} km, cell {dx * 1000:.0f} m")
    per_site: dict = {}
    for site in sites:
        lat, lon = site["lat"], site["lon"]
        r = 2 * R_KM * math.tan(math.radians(90 + lat) / 2)
        # Body-fixed stereographic plane: X towards longitude 0, Y towards 90 E.
        bx, by = r * math.cos(math.radians(lon)), r * math.sin(math.radians(lon))
        a0, b0 = int((half - bx) / dx), int((by + half) / dx)
        tri = []
        for a in range(a0 - DIV_HALF, a0 + DIV_HALF + 1):
            if not 0 <= a < DIV_N:
                continue
            b_lo, b_hi = max(0, b0 - DIV_HALF), min(DIV_N - 1, b0 + DIV_HALF)
            first = 2 * (a * DIV_N + b_lo)
            count = 2 * (b_hi - b_lo + 1)
            text = http_range(URL_DIVINER, DIV_REC * (1 + first), DIV_REC * (1 + first + count) - 1).decode()
            for line in text.splitlines():
                f = [float(v) for v in line.split(",")]
                tri.append((f[9], f[10], f[12], f[13], f[14]))
        t = np.array(tri)
        # Distance of each triangle centre from the site, on the sphere (km).
        dlat = np.radians(t[:, 1] - lat)
        dlon = np.radians((t[:, 0] - lon + 180) % 360 - 180) * math.cos(math.radians(lat))
        dist = R_KM * np.hypot(dlat, dlon)
        k = int(np.argmin(dist))
        if dist[k] > 1.0:
            raise RuntimeError(f"Diviner indexing is off for {site['id']}: nearest triangle {dist[k]:.2f} km away")
        stable = t[:, 4] >= 0  # ice stable at or below the surface within the model depth
        surface = (t[:, 4] >= 0) & (t[:, 4] < 1e-6)
        per_site[site["id"]] = {
            "tAvgK": float(t[k, 2]), "tMaxK": float(t[k, 3]),
            "iceDepthM": float(t[k, 4]) if t[k, 4] >= 0 else None,
            "nearestIceStableKm": float(dist[stable].min()) if stable.any() else None,
            "nearestSurfaceIceKm": float(dist[surface].min()) if surface.any() else None,
            "iceStablePct": float(100 * stable.mean()),
            "coldestTAvgK": float(t[:, 2].min()), "searchRadiusKm": float(DIV_HALF * dx),
            "offsetKm": float(dist[k]),
        }
        v = per_site[site["id"]]
        log(f"  {site['id']}: Tavg {v['tAvgK']:.0f} K, Tmax {v['tMaxK']:.0f} K, ice depth {v['iceDepthM']}, nearest ice-stable ground {v['nearestIceStableKm']} km")
    layer = {
        "source": "LRO Diviner polar resource product, LRO-L-DLRE-5-PRP-V2.0 (dlre_prp_south.tab)",
        "citation": "Paige et al. 2010, Science 330, 479, doi:10.1126/science.1187726",
        "cellM": dx * 1000,
        "note": "Annual average and maximum bolometric temperature and the depth at which water ice is thermally stable. Fetched for the candidate sites only.",
    }
    return layer, per_site


# ------------------------------------------------------------------- FeO

def fetch_feo(sites: list[dict]) -> tuple[dict, dict]:
    log("Lunar Prospector GRS FeO, 2 degree pixels ...")
    with urllib.request.urlopen(urllib.request.Request(URL_FEO, headers=UA), timeout=300) as r:
        text = r.read().decode("ascii", "replace")
    pixels = []
    for line in text.splitlines():
        p = line.split()
        if len(p) < 13:
            continue
        min_lat, max_lat, min_lon, max_lon = (float(v) for v in p[1:5])
        if max_lat <= -78.0:
            pixels.append([min_lat, max_lat, min_lon, max_lon, round(100.0 * float(p[12]), 3)])
    if not pixels:
        raise RuntimeError("no south-polar FeO pixels parsed")

    def at(lat: float, lon: float) -> float | None:
        for a, b, c, d, v in pixels:
            if a <= lat <= b and (c <= lon <= d or c <= lon + 360 <= d or c <= lon - 360 <= d):
                return v
        return None

    per_site = {s["id"]: at(s["lat"], s["lon"]) for s in sites}
    for k, v in per_site.items():
        log(f"  {k}: FeO {v} wt.%")
    layer = {
        "source": "Lunar Prospector gamma-ray spectrometer, LP-L-GRS-5-ELEM-ABUNDANCE-V1.0, 2 degree pixels",
        "citation": "Prettyman et al. 2006, J. Geophys. Res. 111, E12007, doi:10.1029/2005JE002656",
        "pixels": pixels,
        "note": "One value per ~60 km pixel: it describes the region, not the landing point.",
    }
    return layer, per_site


# --------------------------------------------------------------- gravity

def fetch_gravity(sites: list[dict]) -> tuple[dict, dict]:
    log("GRAIL free-air anomaly, 16 px/deg, rows south of 78.5 S ...")
    samples, ppd = 5760, 16
    first_line = int((90 + 78.5) * ppd)          # 2696
    lines = 2880 - first_line
    raw = http_range(URL_GRAVITY, first_line * samples * 4, 2880 * samples * 4 - 1)
    img = np.frombuffer(raw, dtype="<f4").reshape(lines, samples)

    def sample(lat: np.ndarray, lon_e: np.ndarray) -> np.ndarray:
        fl = np.clip((90.0 - lat) * ppd - 0.5 - first_line, 0, lines - 1.000001)
        fs = (lon_e % 360.0) * ppd - 0.5
        i = np.floor(fs).astype(np.int64)
        j = fl.astype(np.int64)
        ts, tl = fs - i, fl - j
        i0, i1 = i % samples, (i + 1) % samples
        a = img[j, i0] * (1 - ts) + img[j, i1] * ts
        b = img[j + 1, i0] * (1 - ts) + img[j + 1, i1] * ts
        return a * (1 - tl) + b * tl

    gx, gy = app_grid(0.0, 0.0, GRAVITY_N, GRAVITY_SPACING_M)
    lat = -90.0 + np.degrees(np.hypot(gx, gy) / R_M)
    lon = np.degrees(np.arctan2(gx, gy))
    grid = sample(lat, lon).astype("<f4")
    grid.tofile(OUT / "gravity.f32")
    per_site = {}
    for s in sites:
        per_site[s["id"]] = float(sample(np.array([s["lat"]]), np.array([s["lon"]]))[0])
        log(f"  {s['id']}: {per_site[s['id']]:+.0f} mGal")
    layer = {
        "source": "GRAIL free-air gravity anomaly, GGGRX_1200A_ANOM_L420, 16 pixel/degree",
        "citation": "Lemoine et al. 2014, Geophys. Res. Lett. 41, 3382, doi:10.1002/2014GL060027",
        "file": "gravity.f32", "n": GRAVITY_N, "spacingM": GRAVITY_SPACING_M, "unit": "mGal",
        "minMgal": float(grid.min()), "maxMgal": float(grid.max()),
        "note": "Free-air anomaly truncated at degree 420 (about 13 km half-wavelength); it is dominated by topography.",
    }
    return layer, per_site


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    sites = read_sites()
    psr_layer, psr = fetch_psr(sites)
    div_layer, div = fetch_diviner(sites)
    feo_layer, feo = fetch_feo(sites)
    grav_layer, grav = fetch_gravity(sites)
    out = {
        "generatedUtc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "layers": {"psr": psr_layer, "diviner": div_layer, "feo": feo_layer, "gravity": grav_layer},
        "notLoaded": {
            "hydrogen": "No gridded LEND or Lunar Prospector neutron hydrogen map was found in the PDS Geosciences archives used here.",
            "geology": "Geological feature density is a derived product of a specific study; there is no archive layer for it.",
        },
        "sites": {
            s["id"]: {"latDeg": s["lat"], "lonDeg": s["lon"], "psr": psr[s["id"]], "diviner": div[s["id"]], "feoWtPct": feo[s["id"]], "gravityMgal": grav[s["id"]]}
            for s in sites
        },
    }
    (OUT / "layers.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    total = sum(p.stat().st_size for p in OUT.iterdir())
    log(f"wrote {OUT} ({total / 1e6:.2f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
