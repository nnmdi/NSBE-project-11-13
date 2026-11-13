"""Build the atlas CSV from NOAA station CSVs and Census urban polygons."""
import csv
import io
import math
from pathlib import Path
import re
import sys
import tarfile
from collections import defaultdict
from statistics import mean

import numpy as np
from osgeo import ogr
from scipy.spatial import cKDTree

source = Path(sys.argv[1])
states = set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split())
periods = ('ANN', 'JJA', 'DJF')
stations = []
with tarfile.open(source / 'normals.tar.gz') as archive:
    for member in archive:
        if not member.isfile() or not Path(member.name).name.startswith('US'):
            continue
        row = next(csv.DictReader(io.TextIOWrapper(archive.extractfile(member))))
        match = re.search(r', ([A-Z]{2}) US$', row['NAME'])
        if not match or match[1] not in states:
            continue
        try:
            lat, lon, elev = (float(row[key]) for key in ('LATITUDE', 'LONGITUDE', 'ELEVATION'))
            values = [float(row[f'{p}-TAVG-NORMAL']) for p in periods]
            years = [int(row[f'years_{p}-TAVG-NORMAL']) for p in periods]
        except (KeyError, ValueError):
            continue
        if not all(-100 < value < 140 for value in values) or min(years) < 24 or not -500 < elev < 5000:
            continue
        stations.append((row['STATION'], lat, lon, elev, values))

dataset = ogr.Open(f'/vsizip/{{{source / "census"}}}/cb_2020_us_ua20_500k.shp')
areas = []
for feature in dataset.GetLayer():
    geo = feature.GetGeometryRef().Clone()
    areas.append((feature['GEOID20'], feature['NAME20'], geo, geo.GetEnvelope()))

bounds = np.array([a[3] for a in areas])
urban = []
rural = []
for station in stations:
    _, lat, lon, _, _ = station
    candidate = np.flatnonzero((bounds[:,0] <= lon) & (bounds[:,1] >= lon) &
                               (bounds[:,2] <= lat) & (bounds[:,3] >= lat))
    point = ogr.Geometry(ogr.wkbPoint)
    point.AddPoint_2D(lon, lat)
    area = next((areas[i] for i in candidate if areas[i][2].Intersects(point)), None)
    if area is None:
        rural.append(station)
    else:
        urban.append((area[:2], station))

def xyz(lat, lon):
    lat, lon = map(math.radians, (lat, lon))
    return 6371 * np.array([math.cos(lat)*math.cos(lon), math.cos(lat)*math.sin(lon), math.sin(lat)])

coords = np.array([xyz(s[1], s[2]) for s in rural])
tree = cKDTree(coords)
groups = defaultdict(list)
for area, station in urban:
    _, lat, lon, elev, _ = station
    center = xyz(lat, lon)
    neighbors = []
    for idx in tree.query_ball_point(center, 80):
        reference = rural[idx]
        chord = np.linalg.norm(coords[idx] - center)
        distance = 2 * 6371 * math.asin(chord / (2 * 6371))
        if 5 <= distance <= 80 and abs(elev - reference[3]) <= 150:
            neighbors.append((distance, reference[0], reference))
    if len(neighbors) >= 2:
        groups[area].append((station, sorted(neighbors)[:3]))

with open('dist/urban-rural-normals.csv', 'w', newline='') as file:
    writer = csv.writer(file)
    writer.writerow(['area_id','area','latitude','longitude','urban_stations','rural_stations',
                     'mean_pair_distance_km','urban_station_ids','rural_station_ids',
                     *[f'{p.lower()}_{kind}_f' for p in periods for kind in ('urban','rural')]])
    for (area_id, name), matches in sorted(groups.items()):
        city = [s for s, _ in matches]
        references = {ref[0] for _, nearby in matches for _, _, ref in nearby}
        values = []
        for i in range(len(periods)):
            values.extend((mean(s[4][i] for s in city),
                           mean(mean(ref[4][i] for _, _, ref in nearby) for _, nearby in matches)))
        writer.writerow([area_id,name,round(city[0][1],4),round(city[0][2],4),
                         len(city),len(references),round(mean(mean(d for d, _, _ in refs) for _, refs in matches),1),
                         '|'.join(s[0] for s in city),'|'.join(sorted(references)),
                         *[round(v,4) for v in values]])
print(f'{len(groups)} areas, {len(urban)} urban candidates, {len(rural)} rural candidates')
