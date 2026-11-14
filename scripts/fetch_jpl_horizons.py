#!/usr/bin/env python3
"""Export a JPL Horizons cache of the Sun and the Earth seen from a lunar site.

The web application never calls this service: it computes its ephemerides
locally with astronomy-engine, so it works offline and has no CORS exposure.
This optional script queries the official NASA/JPL Horizons API and writes a
JSON cache that can be used to

  * validate the in-browser engine (npm run compare-horizons -- <file>), and
  * archive the reference ephemeris of a mission window next to the analysis.

Only the Python standard library is used.

Examples
--------
  python scripts/fetch_jpl_horizons.py --lat -89.54 --lon -129.78 \
      --start 2027-09-01 --days 30 --out data/horizons/shackleton_2027-09.json

  python scripts/fetch_jpl_horizons.py --site malapert-massif --start 2028-03-01 --days 60
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

API_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"
MOON = "301"
TARGETS = {"sun": "10", "earth": "399"}

# Landing points of src/engine/sites.ts (selenographic, longitude east-positive).
SITES = {
    "shackleton-ridge": (-89.4401, -137.3618),
    "malapert-massif": (-85.9759, 1.5730),
    "haworth-rim": (-86.7573, -20.4744),
    "nobile-rim": (-85.2682, 32.0028),
    "de-gerlache-rim-2": (-88.7047, -68.4666),
}

MONTHS = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}


def query(target: str, lat: float, lon: float, height_km: float, start: datetime, stop: datetime, step: str) -> str:
    """Run one observer-table query and return the raw text result."""
    params = {
        "format": "json",
        "COMMAND": f"'{target}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": f"'coord@{MOON}'",
        "COORD_TYPE": "'GEODETIC'",
        # Horizons expects east longitude, latitude, altitude (km) for a surface site.
        "SITE_COORD": f"'{lon % 360.0:.6f},{lat:.6f},{height_km:.6f}'",
        "START_TIME": f"'{start:%Y-%m-%d %H:%M}'",
        "STOP_TIME": f"'{stop:%Y-%m-%d %H:%M}'",
        "STEP_SIZE": f"'{step}'",
        # 4 = apparent azimuth and elevation, 20 = observer range and range-rate.
        "QUANTITIES": "'4,20'",
        "APPARENT": "'AIRLESS'",
        "CSV_FORMAT": "'YES'",
        "CAL_FORMAT": "'CAL'",
        "TIME_DIGITS": "'MINUTES'",
        "ANG_FORMAT": "'DEG'",
        "RANGE_UNITS": "'KM'",
        "EXTRA_PREC": "'YES'",
    }
    url = f"{API_URL}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": "clps-lunar-mission-browser/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if "error" in payload:
        raise RuntimeError(f"Horizons error: {payload['error']}")
    result = payload.get("result", "")
    if "$$SOE" not in result:
        raise RuntimeError("Horizons returned no ephemeris table:\n" + result[-1500:])
    return result


def parse_table(result: str) -> list[dict]:
    """Extract (time, azimuth, elevation, range) rows from an observer table."""
    body = result.split("$$SOE", 1)[1].split("$$EOE", 1)[0]
    rows = []
    for line in body.strip().splitlines():
        cells = [c.strip() for c in line.split(",")]
        if len(cells) < 6:
            continue
        # "2027-Sep-01 00:00"
        date_part, time_part = cells[0].split()
        year, month, day = date_part.split("-")
        hour, minute = time_part.split(":")
        stamp = datetime(int(year), MONTHS[month], int(day), int(hour), int(minute), tzinfo=timezone.utc)
        numeric = []
        for cell in cells[1:]:
            try:
                numeric.append(float(cell))
            except ValueError:
                continue  # solar-presence / interference flag columns
        if len(numeric) < 3:
            continue
        rows.append({
            "t": stamp.strftime("%Y-%m-%dT%H:%MZ"),
            "ms": int(stamp.timestamp() * 1000),
            "az": numeric[0],
            "el": numeric[1],
            "range_km": numeric[2],
        })
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--site", choices=sorted(SITES), help="candidate site id (overrides --lat/--lon)")
    parser.add_argument("--lat", type=float, help="selenographic latitude, degrees (south negative)")
    parser.add_argument("--lon", type=float, help="selenographic longitude, degrees (east positive)")
    parser.add_argument("--height-km", type=float, default=0.0, help="height above the 1737.4 km sphere, km")
    parser.add_argument("--start", required=True, help="window start, UTC, YYYY-MM-DD")
    parser.add_argument("--days", type=int, default=30, help="window length in days (1-180)")
    parser.add_argument("--step", default="1h", help="Horizons step size, default 1h")
    parser.add_argument("--out", type=Path, help="output JSON path")
    args = parser.parse_args()

    if args.site:
        lat, lon = SITES[args.site]
    elif args.lat is not None and args.lon is not None:
        lat, lon = args.lat, args.lon
    else:
        parser.error("give --site or both --lat and --lon")
    if not 1 <= args.days <= 180:
        parser.error("--days must be between 1 and 180")
    if not -90.0 <= lat <= 90.0:
        parser.error("--lat must be between -90 and 90")

    start = datetime.strptime(args.start, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    stop = start + timedelta(days=args.days)
    label = args.site or f"lat{lat:+.3f}_lon{lon:+.3f}"
    out = args.out or Path("data") / "horizons" / f"{label}_{start:%Y-%m-%d}_{args.days}d.json"

    cache = {
        "source": "NASA/JPL Horizons API (https://ssd.jpl.nasa.gov/api/horizons.api)",
        "retrieved_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "site": {"id": args.site, "lat_deg": lat, "lon_deg": lon, "height_km": args.height_km},
        "window": {"start": start.strftime("%Y-%m-%dT%H:%MZ"), "stop": stop.strftime("%Y-%m-%dT%H:%MZ"), "step": args.step},
        "conventions": "azimuth degrees clockwise from north through east, elevation above the local horizontal, airless apparent",
    }
    for name, code in TARGETS.items():
        print(f"querying Horizons: {name} from the Moon at lat {lat:.3f}, lon {lon:.3f} ...", file=sys.stderr)
        cache[name] = parse_table(query(code, lat, lon, args.height_km, start, stop, args.step))
        print(f"  {len(cache[name])} samples", file=sys.stderr)
        time.sleep(1.0)  # be polite to the public API

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(cache, indent=1), encoding="utf-8")
    print(f"wrote {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
