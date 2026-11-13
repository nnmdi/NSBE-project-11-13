const $ = id => document.getElementById(id);
const model = {areas: [], selected: null, page: 0, key: 'delta', direction: -1};
const pageSize = 12;
const number = value => value.toFixed(1).replace('-0.0', '0.0');
const displayArea = name => name.replaceAll('--', '–');
const unit = () => $('unit').value;
const temp = value => number(unit() === 'C' ? (value - 32) / 1.8 : value) + ' °' + unit();
const delta = value => {
  const converted = unit() === 'C' ? value / 1.8 : value;
  const rounded = number(converted);
  return (Number(rounded) > 0 ? '+' : '') + rounded + ' °' + unit();
};

function parseCsv(text) {
  return text.trim().split(/\r?\n/).map(line =>
    [...line.matchAll(/(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/g)]
      .map(match => match[1]?.replace(/""/g, '"') ?? match[2])
  );
}
function currentRows() {
  const query = $('search').value.toLowerCase().trim().replace(/[–—]/g, '--');
  const period = $('period').value;
  return model.areas.filter(area => area.area.toLowerCase().includes(query)).map(area => {
    const urban = Number(area[period + '_urban_f']);
    const rural = Number(area[period + '_rural_f']);
    return {...area, urban, rural, delta: urban - rural, stations: Number(area.urban_stations)};
  }).sort((a, b) => {
    const key = model.key;
    const order = key === 'area' ? a.area.localeCompare(b.area) : a[key] - b[key];
    return model.direction * order || a.area.localeCompare(b.area);
  });
}
function svg(tag, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, val] of Object.entries(attrs)) node.setAttribute(key, val);
  return node;
}
const projection = d3.geoAlbersUsa().scale(1030).translate([450, 250]);
const markers = svg('g');
$('map').append(markers);

function selectArea(id, scroll = false) {
  model.selected = id;
  render();
  if (scroll) $('detail').scrollIntoView({block: 'nearest', behavior: 'smooth'});
}
function renderSuggestions(rows) {
  const container = $('suggestions');
  container.replaceChildren();
  const suggestions = $('search').value.trim()
    ? rows.slice(0, 5)
    : ['Denton--Lewisville', 'Chicago', 'Seattle--Tacoma', 'Anchorage', 'Honolulu']
        .map(name => model.areas.find(area => area.area.startsWith(name + ',')))
        .filter(Boolean);
  if (!suggestions.length) return;
  const label = document.createElement('span');
  label.textContent = $('search').value.trim() ? 'Matches' : 'Try an area';
  container.append(label);
  for (const area of suggestions) {
    const button = document.createElement('button');
    button.textContent = displayArea(area.area);
    button.addEventListener('click', () => {
      $('search').value = displayArea(area.area);
      model.page = 0;
      selectArea(area.area_id);
      $('search').focus();
    });
    container.append(button);
  }
}

function render() {
  const rows = currentRows();
  renderSuggestions(rows);
  const selected = rows.find(row => row.area_id === model.selected) ?? rows[0];
  if (selected) model.selected = selected.area_id;
  $('status').textContent = rows.length
    ? rows.length + ' of ' + model.areas.length + ' urban areas · ' + $('period').selectedOptions[0].textContent
    : 'No matches in the reference CSV. Try a nearby area or clear your search.';
  $('area').textContent = selected ? displayArea(selected.area) : 'No area selected';
  $('urban').textContent = selected ? temp(selected.urban) : '—';
  $('rural').textContent = selected ? temp(selected.rural) : '—';
  $('delta').textContent = selected ? delta(selected.delta) : '—';
  $('delta').classList.toggle('cooler', Boolean(selected?.delta < 0));
  $('interpretation').textContent = selected
    ? (Math.abs(selected.delta) < (unit() === 'C' ? .09 : .05) ? 'Near zero at displayed precision'
       : selected.delta > 0 ? 'Urban air is warmer' : 'Urban air is cooler')
    : '';
  $('stations').textContent = selected
    ? selected.urban_stations + ' urban · ' + selected.rural_stations + ' unique rural stations · ' +
      selected.mean_pair_distance_km + ' km mean match distance' : '';
  $('stationIds').textContent = selected
    ? 'Urban: ' + selected.urban_station_ids.replaceAll('|', ', ') +
      '\nRural: ' + selected.rural_station_ids.replaceAll('|', ', ') : '';
  $('stationIds').parentElement.hidden = !selected;

  markers.replaceChildren();
  const mapRows = [...rows].sort((a,b) => Number(a === selected) - Number(b === selected));
  for (const row of mapRows) {
    const position = projection([+row.longitude, +row.latitude]);
    if (!position) continue;
    const isSelected = row === selected;
    const strength = Math.min(Math.abs(row.delta) / 5, 1);
    const circle = svg('circle', {cx: position[0], cy: position[1],
      r: isSelected ? 8 : 4 + 2 * strength, tabindex: 0, role: 'button',
      'aria-label': row.area + ' ' + delta(row.delta), 'aria-pressed': isSelected,
      class: 'point' + (isSelected ? ' selected' : ''),
      fill: row.delta > .25 ? '#bd4b2d' : row.delta < -.25 ? '#337d8c' : '#b9a18a'});
    const title = svg('title');
    title.textContent = row.area + ' · ' + delta(row.delta);
    circle.append(title);
    const activate = () => {
      selectArea(row.area_id);
      markers.lastElementChild?.focus();
    };
    circle.addEventListener('click', activate);
    circle.addEventListener('keydown', event => {
      if (['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        activate();
      }
    });
    markers.append(circle);
  }

  const start = model.page * pageSize;
  const table = $('rows');
  table.replaceChildren();
  for (const row of rows.slice(start, start + pageSize)) {
    const tr = table.insertRow();
    if (row === selected) tr.className = 'selected';
    const button = document.createElement('button');
    button.textContent = displayArea(row.area);
    button.setAttribute('aria-pressed', row === selected);
    button.addEventListener('click', () => selectArea(row.area_id, true));
    tr.insertCell().append(button);
    for (const value of [temp(row.urban), temp(row.rural), delta(row.delta), row.urban_stations]) {
      tr.insertCell().textContent = value;
    }
    if (row.delta < 0) tr.cells[3].className = 'cooler';
  }
  $('pageText').textContent = rows.length ? (start + 1) + '–' + Math.min(start + pageSize, rows.length) + ' of ' + rows.length : '0 results';
  $('prev').disabled = model.page === 0;
  $('next').disabled = start + pageSize >= rows.length;
  $('export').disabled = !rows.length;
}
for (const id of ['search','period','unit']) $(id).addEventListener(id === 'search' ? 'input' : 'change', () => {
  if (!model.areas.length) return;
  model.page = 0;
  render();
});
$('prev').addEventListener('click', () => {model.page--; render();});
$('next').addEventListener('click', () => {model.page++; render();});
document.querySelectorAll('th[data-key]').forEach(th => th.querySelector('button').addEventListener('click', () => {
  const key = th.dataset.key;
  model.direction = model.key === key ? -model.direction : key === 'area' ? 1 : -1;
  model.key = key;
  model.page = 0;
  document.querySelector('[aria-sort]')?.removeAttribute('aria-sort');
  th.setAttribute('aria-sort', model.direction === 1 ? 'ascending' : 'descending');
  render();
}));
$('export').addEventListener('click', () => {
  const selectedUnit = unit().toLowerCase();
  const encode = value => '"' + String(value).replaceAll('"','""') + '"';
  const values = [['urban_area','season','urban_air_deg_' + selectedUnit,'rural_air_deg_' + selectedUnit,
    'urban_minus_rural_deg_' + selectedUnit,'urban_stations','unique_rural_stations']];
  const convert = value => unit() === 'C' ? (value - 32) / 1.8 : value;
  for (const row of currentRows()) {
    values.push([row.area, $('period').selectedOptions[0].textContent, convert(row.urban).toFixed(4),
      convert(row.rural).toFixed(4), (unit() === 'C' ? row.delta / 1.8 : row.delta).toFixed(4),
      row.urban_stations, row.rural_stations]);
  }
  const url = URL.createObjectURL(new Blob([values.map(row => row.map(encode).join(',')).join('\r\n')],
    {type:'text/csv;charset=utf-8'}));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'urban-heat-' + $('period').value + '-' + selectedUnit + '.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
async function read(url, format) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(url + ' failed to load');
  return response[format]();
}
async function start() {
  try {
    const [headers, ...rows] = parseCsv(await read('urban-rural-normals.csv', 'text'));
    model.areas = rows.map(row => Object.fromEntries(headers.map((key, index) => [key, row[index]])));
    const options = model.areas.map(area => {
      const option = document.createElement('option');
      option.value = displayArea(area.area);
      return option;
    });
    $('areaSuggestions').replaceChildren(...options);
    model.selected = model.areas.find(row => row.area.startsWith('Denton--Lewisville'))?.area_id;
    render();
  } catch (error) {
    $('status').textContent = 'Station comparisons could not load. Refresh to try again.';
    console.error(error);
  }
  try {
    const data = await read('states.json', 'json');
    const path = d3.geoPath(projection);
    const outlines = svg('g', {'aria-hidden': 'true'});
    for (const state of topojson.feature(data, data.objects.states).features) {
      const shape = path(state);
      if (shape) outlines.append(svg('path', {d: shape, class:'state'}));
    }
    $('map').prepend(outlines);
  } catch (error) {
    console.error(error);
  }
}
start();
