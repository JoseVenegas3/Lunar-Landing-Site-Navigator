#!/usr/bin/env python3
"""Build the application's terrain grids from the real LRO/LOLA elevation model.

Source: "A New View of the Lunar South Pole from LOLA", NASA GSFC PGDA product 90
        Barker et al. 2023, Planet. Sci. J. 4, 183, doi:10.3847/PSJ/acf3e1
        data doi:10.60903/gsfcpgda-lola-spole

The source rasters are cloud-optimised GeoTIFFs, so only the windows and the
overview levels that are needed are fetched with HTTP range requests; the
multi-gigabyte files are never downloaded in full.

Outputs (public/dem/, served statically with the app):

  regional.i16        1301 x 1301, 800 m, +-520 km around the pole   (from the 240 m/px mosaic)
  cap.i16             2001 x 2001, 160 m, +-160 km around the pole   (from the 20 m/px mosaic, 8x overview)
  site-<id>.f32        513 x 513,   32 m, +-8.2 km around each site  (from the 20 m/px mosaic)
  manifest.json       grid geometry, provenance, per-site statistics

.i16 files hold little-endian int16 heights in units of 0.5 m; .f32 files hold
little-endian float32 heights in metres. Heights are relative to the 1737.4 km
sphere. Rows run south-to-north in the app's map frame (j increases with +y).

The app's map frame is azimuthal-equidistant about the south pole (r = R * colat);
LOLA is polar stereographic (r = 2 R tan(colat / 2)). Both share the azimuth, so
the conversion is purely radial.

Requires: pip install rasterio numpy
Usage:    python scripts/build_lola_dem.py               everything
          python scripts/build_lola_dem.py --sites-only  only the per-site grids (after editing sites.ts)
          python scripts/build_lola_dem.py --keep-cap    regional and site grids, reusing the polar cap
"""
from __future__ import annotations

import json
import math
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import Window

R_M = 1_737_400.0
BASE = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/"
URL_20M = BASE + "LDEM_80S_20MPP_ADJ.TIF"
URL_240M = BASE + "LDEM_60S_240MPP_ADJ.TIF"

REGIONAL_N, REGIONAL_SPACING_M = 1401, 800.0  # +-560 km: a 250 km horizon search from 80 S (303 km) reaches 553 km
CAP_N, CAP_SPACING_M = 2001, 160.0
LOCAL_N, LOCAL_SPACING_M = 513, 32.0

GDAL_ENV = dict(
    GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
    CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".TIF",
    GDAL_HTTP_MAX_RETRY="8",
    GDAL_HTTP_RETRY_DELAY="3",
    GDAL_HTTP_VERSION="1.1",
    GDAL_HTTP_MULTIPLEX="NO",
    GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="YES",
    CPL_VSIL_CURL_CHUNK_SIZE="1048576",
    GDAL_CACHEMAX=512 * 1024 * 1024,
)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "dem"


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def read_sites() -> list[dict]:
    """Candidate sites from src/engine/sites.ts, so there is a single list to maintain."""
    text = (ROOT / "src" / "engine" / "sites.ts").read_text(encoding="utf-8")
    sites = []
    for m in re.finditer(r"id:\s*'([^']+)',\s*name:\s*'([^']+)'.*?latDeg:\s*(-?[\d.]+),\s*lonDeg:\s*(-?[\d.]+)", text, re.S):
        sites.append({"id": m.group(1), "name": m.group(2), "lat": float(m.group(3)), "lon": float(m.group(4))})
    if not sites:
        raise RuntimeError("no sites parsed from src/engine/sites.ts")
    return sites


def latlon_to_map(lat: float, lon: float) -> tuple[float, float]:
    """App map frame (metres): azimuthal equidistant about the south pole."""
    r = R_M * math.radians(90.0 + lat)
    return r * math.sin(math.radians(lon)), r * math.cos(math.radians(lon))


def map_to_stereo(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Azimuthal-equidistant map coordinates -> south polar stereographic (both metres)."""
    r = np.hypot(x, y)
    scale = np.ones_like(r)
    nz = r > 1e-6
    scale[nz] = 2.0 * R_M * np.tan(r[nz] / R_M / 2.0) / r[nz]
    return x * scale, y * scale


def read_block(ds, x_min: float, x_max: float, y_min: float, y_max: float, factor: int = 1):
    """Read a stereographic bounding box, optionally decimated by `factor` (served from COG overviews).

    Returns (array with row 0 at y_max, x of column 0 centre, y of row 0 centre, pixel size).
    """
    px = ds.transform.a
    col0 = int(math.floor((x_min - ds.transform.c) / px))
    col1 = int(math.ceil((x_max - ds.transform.c) / px))
    row0 = int(math.floor((ds.transform.f - y_max) / px))
    row1 = int(math.ceil((ds.transform.f - y_min) / px))
    col0, row0 = max(0, col0), max(0, row0)
    col1, row1 = min(ds.width, col1), min(ds.height, row1)
    # Align to the decimation factor so overview pixels are used as they are.
    col0 -= col0 % factor
    row0 -= row0 % factor
    width = ((col1 - col0 + factor - 1) // factor) * factor
    height = ((row1 - row0 + factor - 1) // factor) * factor
    window = Window(col0, row0, width, height)
    last = None
    for attempt in range(6):
        try:
            data = ds.read(1, window=window, out_shape=(height // factor, width // factor),
                           resampling=Resampling.average, boundless=True, fill_value=np.nan)
            break
        except Exception as exc:  # transient range-request failures
            last = exc
            log(f"    read failed ({exc.__class__.__name__}), retry {attempt + 1}")
            time.sleep(4 + 4 * attempt)
    else:
        raise RuntimeError(f"could not read window {window}") from last
    size = px * factor
    x0 = ds.transform.c + (col0 + factor / 2.0) * px
    y0 = ds.transform.f - (row0 + factor / 2.0) * px
    return data.astype(np.float32), x0, y0, size


def bilinear(block: np.ndarray, x0: float, y0: float, size: float, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    """Sample `block` (row 0 at y0, y decreasing with row) at stereographic points."""
    fx = (xs - x0) / size
    fy = (y0 - ys) / size
    h, w = block.shape
    fx = np.clip(fx, 0, w - 1.000001)
    fy = np.clip(fy, 0, h - 1.000001)
    i = fx.astype(np.int64)
    j = fy.astype(np.int64)
    tx = (fx - i).astype(np.float32)
    ty = (fy - j).astype(np.float32)
    a = block[j, i] * (1 - tx) + block[j, i + 1] * tx
    b = block[j + 1, i] * (1 - tx) + block[j + 1, i + 1] * tx
    return a * (1 - ty) + b * ty


def box_filter(a: np.ndarray, k: int) -> np.ndarray:
    """k x k moving average (k odd), used before decimating to avoid aliasing."""
    if k <= 1:
        return a
    pad = k // 2
    p = np.pad(a.astype(np.float64), pad, mode="edge")
    c = np.cumsum(np.cumsum(p, axis=0), axis=1)
    c = np.pad(c, ((1, 0), (1, 0)))
    out = c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]
    return (out / (k * k)).astype(np.float32)


def app_grid(cx: float, cy: float, n: int, spacing: float) -> tuple[np.ndarray, np.ndarray]:
    half = (n - 1) / 2.0 * spacing
    xs = cx - half + np.arange(n) * spacing
    ys = cy - half + np.arange(n) * spacing
    return np.meshgrid(xs, ys)  # row index = y index (south to north)


def resample(ds, cx: float, cy: float, n: int, spacing: float, factor: int, smooth: int = 1) -> np.ndarray:
    gx, gy = app_grid(cx, cy, n, spacing)
    sx, sy = map_to_stereo(gx, gy)
    margin = 3 * ds.transform.a * factor
    block, x0, y0, size = read_block(ds, sx.min() - margin, sx.max() + margin, sy.min() - margin, sy.max() + margin, factor)
    if np.isnan(block).any():
        # Outside the mosaic footprint: fill with the mean so the horizon search sees a neutral plain.
        log(f"    {int(np.isnan(block).sum())} empty pixels filled")
        block = np.where(np.isnan(block), np.nanmean(block), block)
    block = box_filter(block, smooth)
    return bilinear(block, x0, y0, size, sx, sy).astype(np.float32)


def write_i16(path: Path, metres: np.ndarray) -> None:
    np.clip(np.rint(metres * 2.0), -32768, 32767).astype("<i2").tofile(path)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    sites = read_sites()
    sites_only = "--sites-only" in sys.argv[1:]
    keep_cap = "--keep-cap" in sys.argv[1:]
    previous = None
    if sites_only or keep_cap:
        previous = json.loads((OUT / "manifest.json").read_text(encoding="utf-8"))
    manifest: dict = {
        "source": "LRO LOLA, NASA GSFC PGDA product 90 (LDEM_80S_20MPP_ADJ, LDEM_60S_240MPP_ADJ)",
        "citation": "Barker et al. 2023, Planet. Sci. J. 4, 183, doi:10.3847/PSJ/acf3e1",
        "dataDoi": "10.60903/gsfcpgda-lola-spole",
        "frame": "MOON_ME (DE421), heights in metres above the 1737.4 km sphere",
        "generatedUtc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "projection": "azimuthal equidistant about the south pole: x = r sin(lon), y = r cos(lon), r = R * colatitude",
        "sites": [],
    }

    with rasterio.Env(**GDAL_ENV):
        if previous:
            manifest["regional"], manifest["cap"] = previous["regional"], previous["cap"]
        if not sites_only:
            log("regional grid from the 240 m/px mosaic ...")
            with rasterio.open(URL_240M) as ds:
                # 240 m source, 800 m target: 3 x 3 average first.
                regional = resample(ds, 0.0, 0.0, REGIONAL_N, REGIONAL_SPACING_M, factor=1, smooth=3)
            write_i16(OUT / "regional.i16", regional)
            manifest["regional"] = {
                "file": "regional.i16", "n": REGIONAL_N, "spacingM": REGIONAL_SPACING_M, "encoding": "int16le-0.5m",
                "sourcePixelM": 240, "minM": float(regional.min()), "maxM": float(regional.max()),
            }
            log(f"  min {regional.min():.0f} m, max {regional.max():.0f} m")

        with rasterio.open(URL_20M) as ds:
            if not previous:
                log("polar cap from the 20 m/px mosaic (8x overview = 160 m) ...")
                cap = resample(ds, 0.0, 0.0, CAP_N, CAP_SPACING_M, factor=8)
                write_i16(OUT / "cap.i16", cap)
                manifest["cap"] = {
                    "file": "cap.i16", "n": CAP_N, "spacingM": CAP_SPACING_M, "encoding": "int16le-0.5m",
                    "sourcePixelM": 160, "minM": float(cap.min()), "maxM": float(cap.max()),
                }

            for site in sites:
                log(f"site {site['id']} ({site['lat']}, {site['lon']}) from the 20 m/px mosaic ...")
                cx, cy = latlon_to_map(site["lat"], site["lon"])
                grid = resample(ds, cx, cy, LOCAL_N, LOCAL_SPACING_M, factor=1)
                name = f"site-{site['id']}.f32"
                grid.astype("<f4").tofile(OUT / name)
                c = (LOCAL_N - 1) // 2
                # Where is the best high ground near the nominal point? (helps choosing coordinates)
                reach = int(round(2000.0 / LOCAL_SPACING_M))
                sub = grid[c - reach:c + reach + 1, c - reach:c + reach + 1]
                jj, ii = np.unravel_index(int(np.argmax(sub)), sub.shape)
                east_axis = (math.cos(math.radians(site["lon"])), -math.sin(math.radians(site["lon"])))
                north_axis = (math.sin(math.radians(site["lon"])), math.cos(math.radians(site["lon"])))
                dx, dy = (ii - reach) * LOCAL_SPACING_M, (jj - reach) * LOCAL_SPACING_M
                gy_, gx_ = np.gradient(grid[c - 2:c + 3, c - 2:c + 3], LOCAL_SPACING_M)
                slope = math.degrees(math.atan(math.hypot(float(gx_[2, 2]), float(gy_[2, 2]))))
                entry = {
                    "id": site["id"], "name": site["name"], "latDeg": site["lat"], "lonDeg": site["lon"],
                    "file": name, "n": LOCAL_N, "spacingM": LOCAL_SPACING_M, "encoding": "float32le-m", "sourcePixelM": 20,
                    "elevationM": float(grid[c, c]), "slopeDeg": slope,
                    "minM": float(grid.min()), "maxM": float(grid.max()),
                    "highestWithin2km": {
                        "elevationM": float(sub[jj, ii]),
                        "eastM": dx * east_axis[0] + dy * east_axis[1],
                        "northM": dx * north_axis[0] + dy * north_axis[1],
                    },
                }
                manifest["sites"].append(entry)
                hi = entry["highestWithin2km"]
                log(f"  nominal {entry['elevationM']:.0f} m, slope {slope:.1f} deg; highest within 2 km "
                    f"{hi['elevationM']:.0f} m at E {hi['eastM']:+.0f} m, N {hi['northM']:+.0f} m")

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    total = sum(p.stat().st_size for p in OUT.iterdir())
    log(f"wrote {OUT} ({total / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
