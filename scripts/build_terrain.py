#!/usr/bin/env python3
"""Build self-contained Torres del Paine terrain assets from public source data."""

from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from xml.etree import ElementTree

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.transform import from_bounds
from rasterio.warp import reproject
from shapely.geometry import LineString, Polygon, mapping
from shapely.ops import polygonize, unary_union

BOUNDS = (-73.28, -51.20, -72.82, -50.88)  # west, south, east, north
SIZE = 513
TILES = ("S52_00_W074_00", "S52_00_W073_00", "S51_00_W074_00", "S51_00_W073_00")
BASE_URL = "https://copernicus-dem-30m.s3.amazonaws.com"
OUT = Path(__file__).resolve().parents[1] / "public" / "data"


def tile_url(tile: str) -> str:
    product = f"Copernicus_DSM_COG_10_{tile}_DEM"
    return f"{BASE_URL}/{product}/{product}.tif"


def build_heightmap() -> np.ndarray:
    transform = from_bounds(*BOUNDS, SIZE, SIZE)
    destination = np.full((SIZE, SIZE), -9999.0, dtype=np.float32)
    environment = {
        "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
        "AWS_NO_SIGN_REQUEST": "YES",
        "VSI_CACHE": "TRUE",
        "VSI_CACHE_SIZE": 32_000_000,
    }
    with rasterio.Env(**environment):
        for tile in TILES:
            url = tile_url(tile)
            print(f"Reading {url}")
            with rasterio.open(url) as source:
                reproject(
                    source=rasterio.band(source, 1),
                    destination=destination,
                    src_transform=source.transform,
                    src_crs=source.crs,
                    src_nodata=source.nodata,
                    dst_transform=transform,
                    dst_crs="EPSG:4326",
                    dst_nodata=-9999,
                    resampling=Resampling.bilinear,
                    init_dest_nodata=False,
                )
    if np.any(destination < -100):
        missing = int(np.count_nonzero(destination < -100))
        raise RuntimeError(f"Elevation mosaic has {missing} missing samples")
    return np.rint(np.clip(destination, 0, 65535)).astype("<u2")


def fetch_osm_water() -> list[dict]:
    west, south, east, north = BOUNDS
    nodes: dict[int, tuple[float, float]] = {}
    ways: dict[int, tuple[list[int], dict[str, str]]] = {}
    relations: dict[int, tuple[list[tuple[str, int, str]], dict[str, str]]] = {}
    divisions = 3
    for row in range(divisions):
        cell_south = south + (north - south) * row / divisions
        cell_north = south + (north - south) * (row + 1) / divisions
        for column in range(divisions):
            cell_west = west + (east - west) * column / divisions
            cell_east = west + (east - west) * (column + 1) / divisions
            bbox = f"{cell_west},{cell_south},{cell_east},{cell_north}"
            print(f"Reading OpenStreetMap map data ({row * divisions + column + 1}/{divisions ** 2})")
            request = Request(
                f"https://api.openstreetmap.org/api/0.6/map?{urlencode({'bbox': bbox})}",
                headers={"User-Agent": "TorresPaineThreeJS/1.0 (terrain asset builder)"},
            )
            with urlopen(request, timeout=90) as response:
                root = ElementTree.parse(response).getroot()
            for node in root.findall("node"):
                nodes[int(node.attrib["id"])] = (float(node.attrib["lon"]), float(node.attrib["lat"]))
            for way in root.findall("way"):
                refs = [int(item.attrib["ref"]) for item in way.findall("nd")]
                tags = {tag.attrib["k"]: tag.attrib["v"] for tag in way.findall("tag")}
                ways[int(way.attrib["id"])] = (refs, tags)
            for relation in root.findall("relation"):
                members = [(member.attrib["type"], int(member.attrib["ref"]), member.attrib.get("role", "")) for member in relation.findall("member")]
                tags = {tag.attrib["k"]: tag.attrib["v"] for tag in relation.findall("tag")}
                relations[int(relation.attrib["id"])] = (members, tags)

    polygons: list[Polygon] = []
    relation_lines: list[LineString] = []
    for refs, tags in ways.values():
        if tags.get("natural") == "water" and all(ref in nodes for ref in refs):
            points = [nodes[ref] for ref in refs]
            if len(points) >= 4 and points[0] == points[-1]:
                polygons.append(Polygon(points))
    for members, tags in relations.values():
        if tags.get("natural") != "water" and tags.get("water") not in {"lake", "reservoir"}:
            continue
        for member_type, member_ref, role in members:
            if member_type == "way" and role == "outer" and member_ref in ways:
                refs, _ = ways[member_ref]
                if len(refs) >= 2 and all(ref in nodes for ref in refs):
                    relation_lines.append(LineString([nodes[ref] for ref in refs]))
    if relation_lines:
        polygons.extend(polygonize(unary_union(relation_lines)))
    valid = [polygon.buffer(0) for polygon in polygons if polygon.is_valid and polygon.area > 1e-8]
    if not valid:
        raise RuntimeError("OpenStreetMap returned no usable water polygons")
    return [mapping(polygon) for polygon in valid]


def build_water_mask(geometries: list[dict]) -> np.ndarray:
    transform = from_bounds(*BOUNDS, SIZE, SIZE)
    return rasterize(
        [(geometry, 1) for geometry in geometries],
        out_shape=(SIZE, SIZE),
        transform=transform,
        fill=0,
        dtype=np.uint8,
        all_touched=True,
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    heights = build_heightmap()
    water = build_water_mask(fetch_osm_water())
    (OUT / "terrain.bin").write_bytes(heights.tobytes(order="C"))
    (OUT / "water-mask.bin").write_bytes(water.tobytes(order="C"))
    metadata = {
        "width": SIZE,
        "height": SIZE,
        "minElevation": int(heights.min()),
        "maxElevation": int(heights.max()),
        "bounds": {"west": BOUNDS[0], "south": BOUNDS[1], "east": BOUNDS[2], "north": BOUNDS[3]},
        "source": "Copernicus DEM GLO-30 (2021 release)",
        "byteOrder": "little-endian uint16",
    }
    (OUT / "terrain-meta.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(f"Wrote {OUT} ({metadata['minElevation']}–{metadata['maxElevation']} m, {int(water.sum())} water cells)")


if __name__ == "__main__":
    os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
    main()
