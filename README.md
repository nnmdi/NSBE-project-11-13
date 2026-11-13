# U.S. Urban Heat Atlas

An interactive map and sortable table comparing urban and rural air-temperature normals for 457 U.S. urban areas. Search by area, switch between annual, summer, and winter averages, toggle °F and °C, and export the results as CSV.

## Run locally

```sh
python3 -m http.server 8000 --directory dist
```

Open http://localhost:8000. The app uses static files and needs no build step.

## Data and method

The estimated heat island intensity is **urban mean air temperature − rural reference mean air temperature**. The project combines [NOAA's 1991–2020 station climate normals](https://www.ncei.noaa.gov/data/normals-annualseasonal/1991-2020/archive/) with [2020 Census urban-area boundaries](https://www.census.gov/geographies/mapping-files/2020/geo/carto-boundary-file.html). Each qualifying urban station is matched to two or three stations outside Census urban areas within 5–80 km and 150 m of elevation. The resulting CSV is in `dist/urban-rural-normals.csv`. Coverage varies with station availability.

To rebuild the CSV, download the NOAA annual/seasonal station archive as `normals.tar.gz` and the original Census urban-area shapefile ZIP as `census` into a data directory. Install the Python GDAL bindings, NumPy, and SciPy, then run `python3 build_data.py /path/to/data-directory` from the repository root.


## Shade planner

Open the Shade planner in the atlas and select any of the 457 areas in the comparison CSV. The selected area's NOAA summer mean sets the initial air-temperature input. Edit the candidate shade, expected foot traffic, and cost. A regression fitted to synthetic pavement temperatures estimates cooling, then the planner checks every combination of the five sites to maximize the cooling × people/hour score within the budget.

The editable sites and model training data are simulated. The held-out error measures fit to that simulation. Collect field measurements before using the estimates to make real spending decisions.
