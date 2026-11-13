'use strict';

const shadePlanner = (() => {
  const surfaces = ['Asphalt', 'Concrete', 'Pavers'];
  const sampleSites = [
    ['Bus stop', 'Concrete', 10, 75, 80, 6000],
    ['Main sidewalk', 'Concrete', 20, 70, 115, 8500],
    ['Parking walkway', 'Asphalt', 5, 55, 45, 5000],
    ['Public plaza', 'Pavers', 15, 80, 55, 7000],
    ['School crossing', 'Asphalt', 10, 60, 65, 5500]
  ];
  const el = id => document.getElementById(id);
  const money = value => new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  }).format(value);
  const number = value => value.toLocaleString('en-US', {maximumFractionDigits: 1, minimumFractionDigits: 1});
  const features = (air, surface, shade) => {
    const fraction = shade / 100;
    const heat = (air - 80) / 20;
    return [1, heat, fraction, heat * fraction, ...surfaces.slice(1).flatMap(kind => {
      const isKind = Number(kind === surface);
      return [isKind, isKind * fraction];
    })];
  };
  const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);

  // Fixed simulation grid. Alternate observations are reserved for the demo check.
  function syntheticSamples() {
    const rows = [];
    const heatOffsets = [32, 23, 26];
    const shadeEffects = [30, 21, 24];
    for (let air = 40; air <= 120; air += 5) {
      for (const [kind, surface] of surfaces.entries()) {
        for (let shade = 0; shade <= 100; shade += 10) {
          const fraction = shade / 100;
          const heat = (air - 80) / 20;
          const noise = Math.sin((rows.length + 1) * 4.17) * 1.6;
          const pavement = air + heatOffsets[kind] + 2 * heat -
            (shadeEffects[kind] + 3 * heat) * fraction + noise;
          rows.push({x: features(air, surface, shade), y: pavement});
        }
      }
    }
    return rows;
  }

  function fit(samples) {
    const size = samples[0].x.length;
    const system = Array.from({length: size}, (_, i) => [
      ...Array.from({length: size}, (_, j) => samples.reduce((sum, row) => sum + row.x[i] * row.x[j], 0)),
      samples.reduce((sum, row) => sum + row.x[i] * row.y, 0)
    ]);
    for (let col = 0; col < size; col++) {
      const pivot = system[col][col];
      system[col] = system[col].map(value => value / pivot);
      for (let i = 0; i < size; i++) {
        if (i === col) continue;
        const factor = system[i][col];
        system[i] = system[i].map((value, j) => value - factor * system[col][j]);
      }
    }
    return system.map(row => row[size]);
  }

  function chooseSites(sites, budget) {
    let best = {sites: [], cost: 0, score: 0};
    for (let mask = 1; mask < 2 ** sites.length; mask++) {
      const group = sites.filter((_, index) => mask & (1 << index));
      const cost = group.reduce((sum, site) => sum + site.cost, 0);
      const score = group.reduce((sum, site) => sum + site.score, 0);
      if (cost <= budget && (score > best.score || (score === best.score && cost < best.cost))) {
        best = {sites: group, cost, score};
      }
    }
    return best;
  }

  const samples = syntheticSamples();
  const training = samples.filter((_, i) => i % 5 !== 0);
  const test = samples.filter((_, i) => i % 5 === 0);
  const model = fit(training);
  const mae = test.reduce((sum, row) => sum + Math.abs(dot(model, row.x) - row.y), 0) / test.length;
  let areas = new Map();
  let activeArea;

  function cell(row, control, label) {
    control.setAttribute('aria-label', label);
    row.insertCell().append(control);
    return control;
  }

  function populateInputs() {
    for (const [name, surface, current, proposed, people, cost] of sampleSites) {
      const row = el('shadeInputs').insertRow();
      row.insertCell().textContent = name;
      const select = document.createElement('select');
      for (const kind of surfaces) select.add(new Option(kind, kind, false, kind === surface));
      cell(row, select, name + ' surface');
      for (const [label, value, min, max] of [
        ['current shade percent', current, 0, 100], ['proposed shade percent', proposed, 0, 100],
        ['people per hour in new shade', people, 0, 100000], ['cost in dollars', cost, 0, 100000000]
      ]) {
        const input = document.createElement('input');
        Object.assign(input, {type:'number', value, min, max, step:1, required:true});
        cell(row, input, name + ' ' + label);
      }
    }
  }

  function update() {
    const out = el('shadeResults');
    const form = el('shadeForm');
    if (!form.checkValidity()) {
      out.textContent = 'Enter a valid budget, temperature, and site inputs to calculate a recommendation.';
      return;
    }
    const air = el('scenarioAir').valueAsNumber;
    const budget = el('shadeBudget').valueAsNumber;
    const sites = [...el('shadeInputs').rows].map(row => {
      const [surface, current, proposed, people, cost] = [...row.querySelectorAll('select,input')]
        .map(control => control.type === 'number' ? control.valueAsNumber : control.value);
      const before = dot(model, features(air, surface, current));
      const after = dot(model, features(air, surface, proposed));
      const cooling = before - after;
      return {name: row.cells[0].textContent, current, proposed, people, cost, before, after, cooling,
        score: Math.max(0, cooling) * people};
    });
    if (sites.some(site => site.proposed < site.current)) {
      out.textContent = 'Proposed shade must be at least as high as current shade for every site.';
      return;
    }
    const best = chooseSites(sites, budget);
    const selected = new Set(best.sites);
    const heading = document.createElement('h3');
    heading.textContent = best.sites.length ? 'Recommended projects' : 'No projects selected';
    const summary = document.createElement('p');
    summary.textContent = best.sites.length
      ? best.sites.length + ' of ' + sites.length + ' sites · ' + money(best.cost) + ' used · ' +
        money(budget - best.cost) + ' remaining · ' + number(best.score) + ' combined score'
      : 'No project with a positive cooling score fits this budget.';
    out.replaceChildren(heading, summary);
    const wrapper = document.createElement('div');
    wrapper.className = 'table-scroll';
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th scope="col">Site</th><th scope="col">Before (°F)</th><th scope="col">After (°F)</th><th scope="col">Cooling (°F)</th><th scope="col">Score</th><th scope="col">Budget decision</th></tr></thead>';
    const tbody = table.createTBody();
    const ranked = [...sites].sort((a, b) => Number(selected.has(b)) - Number(selected.has(a)) || b.score - a.score);
    for (const site of ranked) {
      const row = tbody.insertRow();
      if (selected.has(site)) row.className = 'selected';
      for (const value of [site.name, number(site.before), number(site.after), number(site.cooling),
        number(site.score), selected.has(site) ? 'Fund · ' + money(site.cost) : 'Skip · ' + money(site.cost)]) {
        row.insertCell().textContent = value;
      }
    }
    wrapper.append(table);
    out.append(wrapper);
  }

  function select(id) {
    const area = areas.get(id);
    if (!area || activeArea === id) return;
    activeArea = id;
    el('plannerArea').value = id;
    const urban = Number(area.jja_urban_f);
    const rural = Number(area.jja_rural_f);
    const gap = urban - rural;
    el('plannerClimate').textContent = 'NOAA summer mean: ' + number(urban) + ' °F urban · ' +
      number(rural) + ' °F rural · ' + (gap > 0 ? '+' : '') + number(gap) + ' °F gap';
    el('scenarioAir').value = urban.toFixed(1);
    update();
  }

  function start(rows, selected) {
    areas = new Map(rows.map(area => [area.area_id, area]));
    const dropdown = el('plannerArea');
    dropdown.replaceChildren(...[...rows].sort((a, b) => a.area.localeCompare(b.area))
      .map(area => new Option(area.area.replaceAll('--', '–'), area.area_id)));
    dropdown.disabled = false;
    dropdown.addEventListener('change', () => select(dropdown.value));
    populateInputs();
    const form = el('shadeForm');
    form.addEventListener('submit', event => {event.preventDefault(); update();});
    form.addEventListener('input', update);
    el('modelMetrics').textContent = 'Demo check: ' + number(mae) +
      ' °F mean absolute error on ' + test.length + ' held-out simulated examples. This measures fit to the simulation. Real-world accuracy remains unknown.';
    select(selected ?? rows[0]?.area_id);
  }

  return {start, select};
})();
window.shadePlanner = shadePlanner;
