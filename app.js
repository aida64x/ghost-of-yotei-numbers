'use strict';

const NAV = [
  ['Player', [['combat', 'Parry and dodge'], ['loadout', 'Loadout'], ['armor', 'Armor'], ['weapons', 'Weapons and tools'], ['charms', 'Charms'], ['skills', 'Skills and progression']]],
  ['Enemies', [['enemies', 'Enemies'], ['duels', 'Duels and bounties'], ['damage', 'Damage']]],
  ['Site', [['about', 'About']]],
];
const VIEWS = NAV.flatMap(([, items]) => items);
const DIFFS = ['Easy', 'Medium', 'Hard', 'Lethal'];
const FPS = 60;
const MAX_F32 = 3e38;
let DATA = null;
const state = { diff: 1, charm: false, chest: 'none', enemy: 'none', enemyView: 'base', arch: null, armor: null, weapon: null,
  charmCat: 'All', charmSize: 'all', charmQuery: '', dmgDiff: 1, dmgHideSpecial: true };

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => (v === null || v === undefined) ? '-' : (+(+v).toFixed(3)).toLocaleString('en-US');
const human = s => String(s).replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
const sign = v => (v >= 0 ? '+' : '−');
function fmtVal(fmt, v) {
  if (v === null || v === undefined) return '<span class="muted">-</span>';
  const a = Math.abs(v);
  if (fmt === 'window') return `<span title="${sign(v)}${a.toFixed(3)} s">${sign(v)}${Math.round(a * FPS)} f</span>`;
  if (fmt === 'pct') return `${sign(v)}${+(a * 100).toFixed(2)}%`;
  return `${sign(v)}${+a.toFixed(4)}`;
}
const frames = sec => Math.round(sec * FPS);
const ms = sec => Math.round(sec * 1000);
/* At 30 fps a press registers every 33 ms, so a window of f frames at 60 fps covers either
   floor(f/2) or ceil(f/2) frames depending on where the hit falls. Returns real time. */
function at30(f) {
  const lo = Math.round(Math.floor(f / 2) * 1000 / 30), hi = Math.round(Math.ceil(f / 2) * 1000 / 30);
  return lo === hi ? `${lo} ms` : `${lo} or ${hi} ms`;
}
const statCell = s => `<span class="stat">${esc(human(s))}<span class="internal">${esc(s)}</span></span>`;
const intro = text => `<p class="page-intro">${text}</p>`;

/* sortable table: cols = [{label, num}], rows = [[cell]] where cell is text or {html, key} */
function table(cols, rows, opts = {}) {
  const head = cols.map((c, i) => `<th class="${c.num ? 'num ' : ''}${opts.sortable ? 'sortable' : ''}" data-col="${i}" ${opts.sortable ? 'tabindex="0"' : ''} scope="col">${c.label}</th>`).join('');
  const cell = c => (c !== null && typeof c === 'object') ? c : { html: esc(c), key: c };
  const body = rows.map(r => `<tr>${r.map((c, i) => { c = cell(c); return `<td class="${cols[i].num ? 'num' : ''}" data-key="${esc(c.key ?? '')}">${c.html ?? ''}</td>`; }).join('')}</tr>`).join('');
  return `<div class="table-wrap"><table ${opts.sortable ? 'data-sortable="1"' : ''}>${opts.caption ? `<caption class="sr">${esc(opts.caption)}</caption>` : ''}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
function bindSorting(root) {
  root.querySelectorAll('table[data-sortable] th.sortable').forEach(th => {
    const go = () => {
      const tbl = th.closest('table'), col = +th.dataset.col, dir = th.getAttribute('aria-sort') === 'descending' ? 'ascending' : 'descending';
      tbl.querySelectorAll('th').forEach(x => x.removeAttribute('aria-sort'));
      th.setAttribute('aria-sort', dir);
      const rows = [...tbl.tBodies[0].rows];
      const val = r => { const k = r.cells[col].dataset.key; const n = parseFloat(k); return isNaN(n) ? k.toLowerCase() : n; };
      rows.sort((a, b) => { const x = val(a), y = val(b); const c = x < y ? -1 : x > y ? 1 : 0; return dir === 'ascending' ? c : -c; });
      rows.forEach(r => tbl.tBodies[0].appendChild(r));
    };
    th.addEventListener('click', go);
    th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}
function seg(name, label, options, current) {
  return `<div class="seg" role="group" aria-label="${esc(label)}">${options.map(([v, text]) =>
    `<button type="button" data-seg="${esc(name)}" data-value="${esc(v)}" aria-pressed="${String(v) === String(current)}">${esc(text)}</button>`).join('')}</div>`;
}
function bindSeg(root, name, onPick) {
  root.querySelectorAll(`[data-seg="${name}"]`).forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll(`[data-seg="${name}"]`).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    onPick(b.dataset.value);
  }));
}
const field = (label, control) => `<label class="field"><span>${esc(label)}</span>${control}</label>`;

/* ---------- parry and dodge ---------- */
function band(d) { return d === 0 ? 'Easy' : d === 1 ? 'Medium' : 'HardPlus'; }
function bonus(sourceName, stat, levelIndex) {
  const src = DATA.window_bonuses.find(b => b.name === sourceName);
  const row = src && src.stats.find(s => s.stat === stat);
  return row ? (row.values[Math.min(levelIndex, row.values.length - 1)] || 0) : 0;
}
function windowsNow() {
  const d = state.diff, w = DATA.combat.windows[d], b = band(d);
  let parry = w.parry, perfect = w.perfect_parry, dodge = w.perfect_dodge;
  if (state.charm) {
    parry += bonus('Charm of Futsunushi', `ParryWindowMod${b}`, 0);
    perfect += bonus('Charm of Futsunushi', `PerfectParryWindowMod${b}`, 0);
    dodge += bonus('Charm of Futsunushi', `PerfectDodgeWindowMod${b}`, 0);
  }
  const chest = { bounty0: ['Bounty Master Armor', 0], bounty1: ['Bounty Master Armor', 1], undying0: ['Armor of the Undying', 0], undying2: ['Armor of the Undying', 2] }[state.chest];
  if (chest) {
    const [name, lvl] = chest;
    if (name === 'Bounty Master Armor') perfect += bonus(name, `PerfectParryWindowMod${b}`, lvl);
    else { perfect += bonus(name, `AlignedPerfectParryWindowMod${b}`, lvl); dodge += bonus(name, `AlignedPerfectDodgeWindowMod${b}`, lvl); }
  }
  const adj = w.enemy_adjust[state.enemy];
  if (adj) { parry += adj[0]; perfect += adj[1]; }
  return { parry, perfect, dodge };
}
function lane(cls, name, sub, sec) {
  const f = Math.max(0, frames(sec));
  return `<div class="lane"><div class="lane-name">${esc(name)}<small>${esc(sub)}</small></div>
    <div class="lane-bar"><div class="fill ${cls}" data-lane="${cls}" style="width:${Math.min(100, f / FPS * 100)}%"><span class="fill-label">${f} f, ${ms(f / FPS)} ms</span></div></div></div>`;
}
function calcFoot() {
  const w = windowsNow();
  return `At 30 fps: Perfect Parry ${at30(frames(w.perfect))}, Parry ${at30(frames(w.parry))}, depending on the attack. The average matches 60 fps.`;
}
function viewCombat() {
  const c = DATA.combat, ws = c.windows;
  const chestOpts = [['none', 'Other chest armor'], ['bounty0', 'Bounty Master Armor'], ['bounty1', 'Bounty Master Armor +1'],
    ['undying0', 'Armor of the Undying (aligned)'], ['undying2', 'Armor of the Undying +2 (aligned)']];
  const enemyOpts = [['none', 'Most enemies'], ['Polearms', 'Polearm users'], ['Sickles', 'Sickle users'], ['Swords', 'Sword users'], ['First check (unidentified)', 'Unidentified group']];
  const axis = [60, 45, 30, 15].map(f => `<span style="right:${f / FPS * 100}%">${f} f</span>`).join('') + `<span class="strike" style="right:0">hit</span>`;
  const w = windowsNow();
  let html = `<h1>Parry and dodge</h1>` + intro('How long before an enemy\'s hit you can press block or dodge. Every window ends when the hit lands. Frames are at 60 fps.');
  html += `<div class="calc">
    <div class="toolbar">
      ${field('Difficulty', seg('diff', 'Difficulty', DIFFS.map((d, i) => [i, d]), state.diff))}
      ${field('Chest armor', `<select id="chest">${chestOpts.map(([v, l]) => `<option value="${v}" ${v === state.chest ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
      ${field('Enemy', `<select id="enemy">${enemyOpts.map(([v, l]) => `<option value="${esc(v)}" ${v === state.enemy ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
      <label class="check"><input type="checkbox" id="charm" ${state.charm ? 'checked' : ''}> Charm of Futsunushi</label>
    </div>
    ${lane('parry', 'Parry', 'block', w.parry)}${lane('perfect', 'Perfect Parry', 'block', w.perfect)}${lane('dodge', 'Perfect Dodge', 'dodge', w.dodge)}
    <div class="axis" aria-hidden="true"><span></span><div class="axis-scale">${axis}</div></div>
    <p class="calc-foot" id="calc-foot">${calcFoot()}</p>
  </div>`;

  html += `<h2>Base windows</h2><p>The Timing Windows setting picks a row. Story mode has no row of its own and most likely uses Easy. Hard and Lethal have the same Perfect Parry and Perfect Dodge windows.</p>`;
  html += table([{ label: 'Difficulty' }, { label: 'Parry', num: 1 }, { label: 'Perfect Parry', num: 1 }, { label: 'Perfect Dodge', num: 1 }, { label: 'Unknown', num: 1 }],
    ws.map(w => [w.difficulty, ...[w.parry, w.perfect_parry, w.perfect_dodge, w.unknown].map(s => ({ html: `${frames(s)} f <span class="sub">${ms(s)} ms</span>`, key: s }))]));
  html += `<p class="small muted">The last column is a fifth value in the same table. No stat changes it and its use is unknown.</p>`;

  html += `<h2>Gear bonuses</h2><p>These add to the base windows. Hard and Lethal share one value. Charm of Futsunushi is the only charm with a window bonus.</p>`;
  const bonusRows = [];
  for (const src of DATA.window_bonuses) for (const s of src.stats) {
    bonusRows.push([src.name, { html: statCell(s.stat) },
      { html: src.levels.map((l, i) => s.values[i] === null || s.values[i] === undefined ? '' : `${esc(l)}: ${fmtVal('window', s.values[i])}`).filter(Boolean).join('<br>') }]);
  }
  html += table([{ label: 'Source' }, { label: 'Stat' }, { label: 'By upgrade level' }], bonusRows);

  html += `<h2>Enemy adjustments</h2><p>Some enemy types widen or shorten the Parry and Perfect Parry windows. Only the first matching row applies.</p>`;
  const groups = Object.keys(ws[0].enemy_adjust);
  html += table([{ label: 'Enemies' }, ...DIFFS.map(d => ({ label: `${d} (Parry / Perfect)`, num: 1 }))],
    groups.map(g => [g, ...ws.map(w => ({ html: w.enemy_adjust[g].map(v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(frames(v))} f`).join(' / ') }))]));

  html += `<h2>Shorter windows on fast attacks</h2>
  <p>A window can't start earlier than about 1/6 s into the enemy's attack animation. Fast attacks can get less than the table shows, mostly the long Parry window on Easy. There is also a small bonus at low health (+0.05 s Parry, +0.01 s Perfect Parry, scaled) with an unknown trigger.</p>
  <h2>Frame rate</h2>
  <p>The windows are set in seconds and don't change with frame rate. A press only registers once per frame, every 16.7 ms at 60 fps or 33.3 ms at 30 fps.</p>
  <p>At 30 fps the windows are the same length on average, but they vary from attack to attack. On Hard and Lethal the 50 ms Perfect Parry window is 33 ms on some attacks and 67 ms on others. At 40 fps it is always 50 ms.</p>`;

  html += `<h2>Weapon alignment</h2><p>Each weapon counters one type of enemy. You are aligned when you have the counter weapon out.</p>`;
  html += table([{ label: 'Weapon' }, { label: 'Counters' }], c.alignment.map(a => [a.weapon, a.against]));
  html += `<p class="small muted">Shield users only count as Shields, even if they also carry a sword or sickle. Brutes always count as Brutes for the Odachi. One unidentified status effect makes every weapon count as aligned.</p>`;

  const det = c.detection, ag = c.aggression;
  html += `<h2>Detection</h2>`;
  html += table([{ label: '' }, ...DIFFS.map(d => ({ label: d, num: 1 }))], [
    ['Range at which enemies hear you', ...det.noise_range.map(v => ({ html: `×${num(v)}`, key: v }))],
    ['Time for an enemy to spot you', ...det.detect_time.map(v => ({ html: `×${num(v)}`, key: v }))],
  ]);
  html += `<p class="small muted">Spotting time is also multiplied by 1 + Awareness Mod, the stealth stat on some armor and charms. The base time is at least 2 seconds.</p>`;
  html += `<h2>Enemy aggression</h2><p>The numbers are exact. The labels are our best guess at what each row controls.</p>`;
  html += table([{ label: 'Setting' }, ...DIFFS.map(d => ({ label: d, num: 1 }))], [
    ['Wait between attacks, 2 enemies (s)', ...ag.attack_wait.map(a => `${num(a.two[0])} to ${num(a.two[1])}`)],
    ['Wait between attacks, 5 enemies (s)', ...ag.attack_wait.map(a => `${num(a.five[0])} to ${num(a.five[1])}`)],
    ['Attackers at once, with 2, 3 and 5 enemies', ...ag.group_budget.map(b => b.join(', '))],
    ...ag.windup.distances_m.map((m, k) => [`Wind-up at ${num(m)} m (s)`, ...ag.windup.rows.map(r => num(r[k]))]),
    ...ag.reaction_delay.map((r, k) => [`Reaction delay, type ${k + 1} (s)`, ...r.map(num)]),
    ['Minimum time between repeated actions (s)', ...ag.repeat_gap.map(num)],
  ]);
  html += `<p class="small muted">Enemy damage per difficulty is on the <a href="#damage">Damage</a> page.</p>`;
  return html;
}
function bindCombat(root) {
  const refresh = () => {
    const w = windowsNow();
    for (const [cls, sec] of [['parry', w.parry], ['perfect', w.perfect], ['dodge', w.dodge]]) {
      const f = Math.max(0, frames(sec)), fill = root.querySelector(`.fill[data-lane="${cls}"]`);
      fill.style.width = Math.min(100, f / FPS * 100) + '%';
      fill.querySelector('.fill-label').textContent = `${f} f, ${ms(f / FPS)} ms`;
    }
    root.querySelector('#calc-foot').textContent = calcFoot();
  };
  bindSeg(root, 'diff', v => { state.diff = +v; refresh(); });
  root.querySelector('#chest').addEventListener('change', e => { state.chest = e.target.value; refresh(); });
  root.querySelector('#enemy').addEventListener('change', e => { state.enemy = e.target.value; refresh(); });
  root.querySelector('#charm').addEventListener('change', e => { state.charm = e.target.checked; refresh(); });
}

/* ---------- armor, weapons ---------- */
function extraText(b) {
  if (b.kind === 'perk') return `perk ${b.text}`;
  if (b.kind === 'unlock') return `unlocks ${b.text}`;
  if (b.kind === 'item') return `gives ${b.text}`;
  return `carry ${b.text}`;
}
function familyDetail(f) {
  let html = `<h2>${esc(f.name)}</h2>`;
  if (f.description) html += `<p class="flavor">${esc(f.description)}</p>`;
  if (f.stats.length) {
    html += table([{ label: 'Stat' }, ...f.levels.map(l => ({ label: esc(l), num: 1 }))],
      f.stats.map(s => [{ html: statCell(s.stat) + (s.hero ? ' <span class="tag">player</span>' : '') }, ...s.values.map(v => ({ html: fmtVal(s.fmt, v) }))]));
  }
  const items = f.extras.map((bits, i) => bits.length ? `<li>${esc(f.levels[i])}: ${bits.map(b => esc(extraText(b))).join(', ')}</li>` : '').join('');
  if (items) html += `<ul class="levels-extra">${items}</ul>`;
  if (f.internal) html += `<p class="small muted">Internal name <code>${esc(f.internal)}</code></p>`;
  return html;
}
function splitView(groups, current, key, label) {
  const all = groups.flatMap(g => g.items);
  const cur = all.find(f => f.key === current) || all[0];
  const picker = groups.map(g => `${g.title ? `<h4>${esc(g.title)}</h4>` : ''}${g.items.map(f => `<button type="button" data-pick="${esc(key)}" data-value="${esc(f.key)}" aria-current="${f.key === cur.key}">${esc(f.name)}</button>`).join('')}`).join('');
  const select = `<select class="picker-select" data-pick-select="${esc(key)}" aria-label="${esc(label)}">${groups.map(g => `<optgroup label="${esc(g.title || label)}">${g.items.map(f => `<option value="${esc(f.key)}" ${f.key === cur.key ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</optgroup>`).join('')}</select>`;
  return { cur, html: `<div class="split"><nav class="picker" aria-label="${esc(label)}">${picker}</nav><div class="detail">${select}<div id="detail-${esc(key)}"></div></div></div>` };
}
function bindSplit(root, key, render) {
  const show = v => {
    state[key] = v;
    root.querySelectorAll(`[data-pick="${key}"]`).forEach(b => b.setAttribute('aria-current', String(b.dataset.value === v)));
    const sel = root.querySelector(`[data-pick-select="${key}"]`); if (sel) sel.value = v;
    const box = root.querySelector(`#detail-${key}`); box.innerHTML = render(v); bindSorting(box);
  };
  root.querySelectorAll(`[data-pick="${key}"]`).forEach(b => b.addEventListener('click', () => show(b.dataset.value)));
  const sel = root.querySelector(`[data-pick-select="${key}"]`); if (sel) sel.addEventListener('change', e => show(e.target.value));
  return show;
}
function viewArmor() {
  const { cur, html } = splitView([{ title: '', items: DATA.armor }], state.armor, 'armor', 'Armor');
  state.armor = cur.key;
  return `<h1>Armor</h1>` + intro('Stats for each chest armor at every upgrade level. Each column includes the upgrades before it. Headgear is cosmetic, except Kanemori\'s Two-Faced Mask.') + html;
}
function viewWeapons() {
  const kinds = ['Melee weapons', 'Ranged weapons', 'Tools and other gear'];
  const groups = kinds.map(k => ({ title: k, items: DATA.weapons.filter(w => w.kind === k) })).filter(g => g.items.length);
  const { cur, html } = splitView(groups, state.weapon, 'weapon', 'Weapons and tools');
  state.weapon = cur.key;
  return `<h1>Weapons and tools</h1>` + intro('Stats at every upgrade level. Base is the item\'s own value. The katana and dual katana have no base damage stat: their damage comes from each move, and upgrades add a flat amount to it. Bow upgrades also unlock new arrow types.') + html;
}

/* ---------- charms ---------- */
function charmRows() {
  const q = state.charmQuery.trim().toLowerCase();
  return DATA.charms.filter(c => (state.charmCat === 'All' || c.category === state.charmCat)
    && (state.charmSize === 'all' || (state.charmSize === 'major') === c.major)
    && (!q || (c.name + ' ' + c.description + ' ' + c.stats.map(s => s.stat).join(' ') + ' ' + c.perks.join(' ')).toLowerCase().includes(q)));
}
function charmTable() {
  const rows = charmRows();
  const body = rows.map(c => {
    const eff = c.stats.map(s => `<div>${esc(human(s.stat))} ${s.values.map(v => fmtVal(s.fmt, v)).join(', ')}</div>`).join('')
      + c.perks.map(p => `<span class="tag">perk ${esc(p)}</span>`).join(' ')
      + c.upgrade_perks.map(p => `<span class="tag">upgrade: ${esc(p)}</span>`).join(' ')
      + c.carry.map(x => `<span class="tag">carry ${esc(x)}</span>`).join(' ');
    return [{ html: `${esc(c.name)}<span class="sub">${esc(c.category)}, ${c.major ? 'major' : 'minor'}${c.obtainable ? '' : ', unused'}</span>`, key: c.name },
      { html: eff || '-' }, { html: `<span class="muted">${esc(c.description)}</span>` }];
  });
  return `<p class="count">${rows.length} of ${DATA.charms.length}</p>` + table([{ label: 'Charm' }, { label: 'Effect by level' }, { label: 'In-game text' }], body, { sortable: true });
}
function viewCharms() {
  const cats = ['All', ...new Set(DATA.charms.map(c => c.category))];
  return `<h1>Charms</h1>` + intro('All 91 charms with exact values at every upgrade level, listed from base to fully upgraded. Charms marked unused are in the files but no task awards them.') + `
  <div class="toolbar">
    <div class="chips" role="group" aria-label="Category">${cats.map(c => `<button type="button" data-cat="${esc(c)}" aria-pressed="${c === state.charmCat}">${esc(c)}</button>`).join('')}</div>
    ${seg('size', 'Charm size', [['all', 'All'], ['major', 'Major'], ['minor', 'Minor']], state.charmSize)}
    <input type="search" id="charm-q" placeholder="Search" aria-label="Search charms" value="${esc(state.charmQuery)}">
  </div><div id="charm-table">${charmTable()}</div>`;
}
function bindCharms(root) {
  const redraw = () => { const box = root.querySelector('#charm-table'); box.innerHTML = charmTable(); bindSorting(box); };
  root.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => {
    state.charmCat = b.dataset.cat; root.querySelectorAll('[data-cat]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); redraw();
  }));
  bindSeg(root, 'size', v => { state.charmSize = v; redraw(); });
  root.querySelector('#charm-q').addEventListener('input', e => { state.charmQuery = e.target.value; redraw(); });
}

/* ---------- skills and progression ---------- */
function viewSkills() {
  const p = DATA.progression;
  const base = DATA.enemies.player[1]?.base?.hp ?? 100;
  let html = `<h1>Skills and progression</h1>` + intro('Skill tree entries that change a number or add a perk, then health, Spirit and carry upgrades. Skill names are the game\'s internal ones.');
  html += `<h2>Skills</h2>` + table([{ label: 'Skill' }, { label: 'Perks' }, { label: 'Values' }], DATA.skills.map(s => [
    { html: esc(human(s.task)), key: s.task },
    { html: s.perks.map(x => `<span class="tag">${esc(x)}</span>`).join(' ') || '-' },
    { html: s.stats.map(x => `${esc(human(x.stat))} ${fmtVal(x.fmt, x.value)}${x.target !== 'hero' ? ` <span class="muted">(${esc(x.target)})</span>` : ''}`).join('<br>') || '-' }]), { sortable: true });

  html += `<h2>Health upgrades</h2><p>You start with ${num(base)} health and ${num(DATA.enemies.player[1]?.base?.blkp ?? 100)} block points on every difficulty. Later upgrades add less.</p>`;
  let tot = base;
  html += table([{ label: 'Upgrade', num: 1 }, { label: 'Adds', num: 1 }, { label: 'Max health', num: 1 }], p.health.map((v, i) => { tot += v; return [String(i + 1), `+${num(v)}`, num(tot)]; }));
  html += `<h2>Spirit</h2>` + table([{ label: 'Task' }, { label: 'Change' }], p.spirit.map(s => [s.task, `${human(s.stat)} +${num(s.value)}`]));
  html += `<h2>Carry capacity</h2><p>How much each upgrade raises the limit. Starting limits aren't known.</p>`;
  html += table([{ label: 'Item' }, { label: '1st', num: 1 }, { label: '2nd', num: 1 }, { label: '3rd', num: 1 }, { label: 'Total', num: 1 }],
    p.carry.map(c => [human(c.item), ...c.steps.map(v => v ? `+${v}` : '-'), `+${c.steps.reduce((a, b) => a + b, 0)}`]), { sortable: true });
  html += `<h2>Story perks</h2>` + table([{ label: 'Task' }, { label: 'Perks' }], p.story_perks.map(s => [s.task, { html: s.perks.map(x => `<span class="tag">${esc(x)}</span>`).join(' ') }]), { sortable: true });
  return html;
}

/* ---------- enemies ---------- */
const pair = p => p ? `${num(p.hp)} <span class="muted">/ ${num(p.blkp)}</span>` : '<span class="muted">-</span>';
function enemyMatrix(arch) {
  const rows = DATA.enemies.enemies.filter(p => p.archk === arch);
  const regions = ['NonValley', 'Frontier', 'Castle', 'Ninja', 'Gun', 'Finale'].filter(r => rows.some(p => p.evagrp === r));
  const ranks = ['Grunt', 'Veteran', 'Elite', 'Leader'].filter(k => rows.some(p => p.wpnlvl === k));
  const v = state.enemyView;
  return `<h2>${esc(human(arch))}</h2>` + table([{ label: 'Region' }, ...ranks.map(r => ({ label: r, num: 1 }))], regions.map(g => [g, ...ranks.map(r => {
    const p = rows.find(x => x.evagrp === g && x.wpnlvl === r);
    return { html: p ? pair(p[v]) : '<span class="muted">-</span>' };
  })]));
}
function viewEnemies() {
  const E = DATA.enemies;
  const archs = [...new Set(E.enemies.map(p => p.archk))].sort();
  state.arch = state.arch && archs.includes(state.arch) ? state.arch : 'Skirmisher';
  let html = `<h1>Enemies</h1>` + intro('Health and block points by enemy type, region and rank, shown as health / block. Block points are the guard meter you break to stagger an enemy.');
  html += `<div class="toolbar">${seg('ev', 'Values', [['base', 'Base game'], ['ng_plus', 'New Game+'], ['alt', 'Alternate']], state.enemyView)}</div>
  <p class="small muted">Regions are the game's internal enemy groups. Which areas each one covers isn't confirmed. Alternate is a third set of values with an unknown use.</p>`;
  html += splitView([{ title: '', items: archs.map(a => ({ key: a, name: human(a) })) }], state.arch, 'arch', 'Enemy type').html;
  html += `<h2>Animals and civilians</h2>` + table([{ label: 'Type' }, { label: 'Health / block', num: 1 }, { label: 'New Game+', num: 1 }],
    E.archetypes.map(p => [human(p.archk), { html: pair(p.base), key: p.base?.hp }, { html: pair(p.ng_plus), key: p.ng_plus?.hp }]), { sortable: true });
  html += `<h2>Player and allies</h2>` + table([{ label: '' }, { label: 'Health / block', num: 1 }, { label: 'New Game+', num: 1 }, { label: 'Damage ratio', num: 1 }], [
    ...E.player.map(p => [`Player, ${p.gdk === 'Nightmare' ? 'Lethal' : p.gdk}`, { html: pair(p.base) }, { html: pair(p.ng_plus && p.ng_plus.hp > 0 ? p.ng_plus : null) }, '-']),
    ...E.buddies.map(p => [`Ally (${human(p.buddylk)})`, { html: pair(p.base) }, { html: pair(p.ng_plus) }, num((E.buddy_adjustments[p.buddylk] || [])[0])]),
  ]);
  return html;
}
function bindEnemies(root) {
  const show = bindSplit(root, 'arch', a => enemyMatrix(a));
  show(state.arch);
  bindSeg(root, 'ev', v => { state.enemyView = v; show(state.arch); });
}

/* ---------- duels and bounties ---------- */
function opponentTable(items, key, adj) {
  return table([{ label: 'Opponent' }, { label: 'Health', num: 1 }, { label: 'Block', num: 1 }, { label: 'Alternate', num: 1 }, { label: 'New Game+', num: 1 }, { label: 'Damage', num: 1 }, { label: 'NG+ damage', num: 1 }],
    items.map(p => {
      const a = adj[p[key]] || [];
      return [{ html: esc(human(p[key])), key: p[key] }, { html: num(p.base?.hp), key: p.base?.hp }, { html: num(p.base?.blkp), key: p.base?.blkp },
        { html: pair(p.alt), key: p.alt?.hp ?? -1 }, { html: pair(p.ng_plus), key: p.ng_plus?.hp ?? -1 }, { html: a[0] !== undefined ? `×${num(a[0])}` : '-', key: a[0] ?? 0 }, { html: a[1] !== undefined ? `×${num(a[1])}` : '-', key: a[1] ?? 0 }];
    }), { sortable: true });
}
function viewDuels() {
  const E = DATA.enemies;
  return `<h1>Duels and bounties</h1>` + intro('Health, block points and damage multiplier for every duel opponent and bounty target. Names are internal. The prefix is the region: Fr, Cv, Nv, Gv or Fn.') +
    `<h2>Duels</h2>${opponentTable(E.duels, 'dueldk', E.duel_adjustments)}
    <p class="small muted">Two phases of the final duel have 9,999 health, probably so that a scripted event ends them.</p>
    <h2>Bounty targets</h2>${opponentTable(E.bounties, 'bhtdk', E.bounty_adjustments)}`;
}

/* ---------- damage ---------- */
function median(a) { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; }
function dmgTable() {
  const d = state.dmgDiff;
  const rows = DATA.enemies.damage_classes.filter(c => !state.dmgHideSpecial || (c.hit_points || [0]).some(v => v > 0 && v < MAX_F32));
  const v4 = (arr, i) => !arr ? null : arr.length === 4 ? arr[i] : arr[0];
  const show = v => v === null ? '-' : v >= MAX_F32 ? '∞' : num(v);
  return `<p class="count">${rows.length} classes</p>` + table([{ label: 'ID' }, ...DIFFS.map(x => ({ label: x, num: 1 })), { label: `NG+ (${DIFFS[d]})`, num: 1 }, { label: 'Block damage', num: 1 }, { label: 'Legends', num: 1 }],
    rows.map(c => [{ html: `<code>${esc(c.damage_class.slice(2))}</code>`, key: c.damage_class },
      ...DIFFS.map((_, i) => ({ html: i === d ? `<b>${show(v4(c.hit_points, i))}</b>` : show(v4(c.hit_points, i)), key: v4(c.hit_points, i) ?? -1 })),
      { html: show(v4(c.hit_points_ng_plus, d)), key: v4(c.hit_points_ng_plus, d) ?? -1 },
      { html: show(v4(c.block_points, d)), key: v4(c.block_points, d) ?? -1 },
      { html: show(v4(c.legends_hit_points, 0)), key: v4(c.legends_hit_points, 0) ?? -1 }]), { sortable: true });
}
function viewDamage() {
  const dc = DATA.enemies.damage_classes.filter(c => c.hit_points && c.hit_points.length === 4 && c.hit_points[1] > 0 && c.hit_points[1] < MAX_F32);
  const ratio = i => num(median(dc.map(c => c.hit_points[i] / c.hit_points[1])));
  return `<h1>Damage</h1>` + intro(`How much damage enemy attacks do at each Enemy Damage setting. You start with 100 health, so 50 is half of it. Compared to Medium, a typical attack does ×${ratio(0)} on Easy, ×${ratio(2)} on Hard and ×${ratio(3)} on Lethal.`) + `
  <p class="small muted">Only damage to you depends on difficulty. Enemies hitting each other use the Medium value. Block damage is what a blocked hit takes from your 100 block points. New Game+ values replace the normal ones. Damage classes have no names in the game, so they are listed by ID.</p>
  <div class="toolbar">${field('Highlight', seg('dd', 'Highlighted difficulty', DIFFS.map((x, i) => [i, x]), state.dmgDiff))}
  <label class="check"><input type="checkbox" id="dmg-special" ${state.dmgHideSpecial ? 'checked' : ''}> Hide classes that do no damage or kill outright</label></div>
  <div id="dmg-table">${dmgTable()}</div>`;
}
function bindDamage(root) {
  const redraw = () => { const box = root.querySelector('#dmg-table'); box.innerHTML = dmgTable(); bindSorting(box); };
  bindSeg(root, 'dd', v => { state.dmgDiff = +v; redraw(); });
  root.querySelector('#dmg-special').addEventListener('change', e => { state.dmgHideSpecial = e.target.checked; redraw(); });
}

/* ---------- about ---------- */
function viewAbout() {
  return `<h1>About</h1>` + intro(`Values are for game version ${esc(DATA.version)} and may change in later patches.`) + `
  <h2>Reading the numbers</h2>
  <p>Stats start at zero and add up from everything you have equipped or unlocked. Chance stats are the chance itself, so Charm of Fortitude's +10% Lethal Damage Survival Chance is exactly a 10% chance. Scale and Mod stats change something by that percentage. Flat stats add to a value the game sets elsewhere, such as your 100 starting health or the base parry windows.</p>
  <p>Bows, the Tanegashima, the Yari, Kusarigama and Odachi, the Tanto, bombs and one cursed mask have base stats of their own. Upgrades add to them, and the New Game+ upgrade adds to the last level.</p>
  <p>Stat and perk names such as <code>AlignedPerfectParryWindowModEasy</code> are the game's internal names.</p>
  <h2>Not covered</h2>
  <ul>
    <li>The damage of each player attack. The katana and dual katana set damage per move.</li>
    <li>Starting ammo limits.</li>
    <li>Which enemy attack uses which damage class.</li>
    <li>The in-game names of skills.</li>
  </ul>
  <h2>Unused content</h2>
  <p>Charm of Doubling would double the effect of a minor charm when it is the only minor charm of its category. It exists only as a name and description. Nothing in this version grants it, so the loadout builder ignores it.</p>`;
}

/* ---------- loadout ---------- */
const CHARM_SLOTS = 6, MAJOR_SLOTS = 4;
const LOADOUT_KEY = 'yotei-loadout-v1';
let loadout = null;
const DAMAGE_STATS = [['KatanaDamage', 'Katana'], ['DualKatanaDamage', 'Dual Katana'], ['SpearDamage', 'Yari'], ['KusarigamaDamage', 'Kusarigama'],
  ['OdachiDamage', 'Odachi'], ['RangedDamageMediumBow', 'Hankyu'], ['RangedDamageLongbow', 'Yumi'], ['RangedDamageTanegashima', 'Tanegashima'], ['RangedDamagePistol', 'Tanzutsu']];

const chestOptions = () => DATA.armor.filter(a => a.internal && a.internal.startsWith('gear_chest'));
const maskOptions = () => DATA.armor.filter(a => a.internal && !a.internal.startsWith('gear_chest'));
function defaultLoadout() {
  const start = DATA.armor.find(a => a.internal === 'gear_chest_default') || chestOptions()[0];
  return { diff: 1, chest: start ? start.key : '', chestLvl: 0, mask: '', maskLvl: 0,
    weapons: Object.fromEntries(DATA.weapons.map(w => [w.key, 0])),
    charms: Array.from({ length: CHARM_SLOTS }, () => ({ name: '', lvl: 0 })), health: 0 };
}
function loadLoadout() {
  const L = defaultLoadout();
  let src = null;
  const m = location.hash.match(/^#loadout=([A-Za-z0-9_-]+)/);
  if (m) {
    try { src = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))))); } catch (e) { src = null; }
    history.replaceState(null, '', '#loadout');
  }
  if (!src) { try { src = JSON.parse(localStorage.getItem(LOADOUT_KEY) || 'null'); } catch (e) { src = null; } }
  if (src && typeof src === 'object') {
    for (const k of ['diff', 'chest', 'chestLvl', 'mask', 'maskLvl', 'health']) if (k in src) L[k] = src[k];
    if (src.weapons && typeof src.weapons === 'object') Object.assign(L.weapons, src.weapons);
    if (Array.isArray(src.charms)) src.charms.slice(0, CHARM_SLOTS).forEach((c, i) => { if (c && typeof c === 'object') L.charms[i] = { name: String(c.name || ''), lvl: +c.lvl || 0 }; });
  }
  L.diff = Math.min(3, Math.max(0, +L.diff || 0));
  L.health = Math.min(DATA.progression.health.length, Math.max(0, +L.health || 0));
  return L;
}
function saveLoadout() { try { localStorage.setItem(LOADOUT_KEY, JSON.stringify(loadout)); } catch (e) { /* storage unavailable */ } }
function shareLink() {
  // only what differs from the default loadout, so the link stays short
  const def = defaultLoadout(), L = loadout, out = {};
  for (const k of ['diff', 'chest', 'chestLvl', 'mask', 'maskLvl', 'health']) if (L[k] !== def[k]) out[k] = L[k];
  const weapons = Object.fromEntries(Object.entries(L.weapons).filter(([k, v]) => v !== def.weapons[k]));
  if (Object.keys(weapons).length) out.weapons = weapons;
  const charms = L.charms.map(c => (c.name ? { name: c.name, lvl: c.lvl } : 0));
  while (charms.length && !charms[charms.length - 1]) charms.pop();
  if (charms.length) out.charms = charms;
  const code = btoa(unescape(encodeURIComponent(JSON.stringify(out)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${location.href.split('#')[0]}#loadout=${code}`;
}
const clampLevel = (n, i) => Math.max(0, Math.min(+i || 0, n - 1));
const charmLevels = c => Array.from({ length: c.levels }, (_, i) => i === 0 ? 'Base' : `+${i}`);

function loadoutSources(L) {
  const out = [];
  const addFamily = (f, lvl) => {
    if (!f || lvl < 0) return;
    const i = clampLevel(f.levels.length, lvl);
    out.push({ name: f.name, stats: f.stats.map(s => ({ stat: s.stat, fmt: s.fmt, value: s.values[i] })).filter(s => s.value),
      perks: f.extras.slice(0, i + 1).flat().filter(b => b.kind === 'perk').map(b => b.text) });
  };
  addFamily(DATA.armor.find(a => a.key === L.chest), L.chestLvl);
  if (L.mask) addFamily(DATA.armor.find(a => a.key === L.mask), L.maskLvl);
  for (const w of DATA.weapons) addFamily(w, L.weapons[w.key] ?? 0);
  for (const slot of L.charms) {
    const c = DATA.charms.find(x => x.name === slot.name);
    if (!c) continue;
    const i = clampLevel(c.levels, slot.lvl);
    out.push({ name: c.name, stats: c.stats.map(s => ({ stat: s.stat, fmt: s.fmt, value: s.values[i] })).filter(s => s.value),
      perks: c.perks_by_level.slice(0, i + 1).flat() });
  }
  const hp = DATA.progression.health.slice(0, L.health).reduce((a, b) => a + b, 0);
  if (hp) out.push({ name: 'Health upgrades', stats: [{ stat: 'MaximumHealth', fmt: 'raw', value: hp }], perks: [] });
  return out;
}
function loadoutTotals(sources) {
  const totals = new Map();
  for (const s of sources) for (const x of s.stats) {
    const e = totals.get(x.stat) || { stat: x.stat, value: 0, fmts: new Set(), from: [] };
    e.value += x.value; e.fmts.add(x.fmt); e.from.push({ name: s.name, value: x.value, fmt: x.fmt });
    totals.set(x.stat, e);
  }
  for (const e of totals.values()) e.fmt = e.fmts.has('window') ? 'window' : e.fmts.size === 1 ? [...e.fmts][0] : 'raw';
  return totals;
}
function loadoutResults() {
  const L = loadout, sources = loadoutSources(L), T = loadoutTotals(sources);
  const v = k => (T.get(k) ? T.get(k).value : 0);
  const d = L.diff, b = band(d), w = DATA.combat.windows[d];
  const base = (DATA.enemies.player[d] && DATA.enemies.player[d].base) || { hp: 100, blkp: 100 };
  const parry = w.parry + v(`ParryWindowMod${b}`);
  const pp = w.perfect_parry + v(`PerfectParryWindowMod${b}`), ppAligned = pp + v(`AlignedPerfectParryWindowMod${b}`);
  const pd = w.perfect_dodge + v(`PerfectDodgeWindowMod${b}`), pdAligned = pd + v(`AlignedPerfectDodgeWindowMod${b}`);
  const win = (s, aligned) => `<b>${frames(s)} f</b> <span class="muted">${ms(s)} ms${aligned !== undefined && frames(aligned) !== frames(s) ? `, ${frames(aligned)} f with an aligned weapon` : ''}</span>`;
  const rows = [
    ['Max health', `<b>${num(base.hp + v('MaximumHealth'))}</b>`],
    ['Block points', `<b>${num(base.blkp)}</b>`],
    [`Parry (${DIFFS[d]})`, win(parry)],
    [`Perfect Parry (${DIFFS[d]})`, win(pp, ppAligned)],
    [`Perfect Dodge (${DIFFS[d]})`, win(pd, pdAligned)],
    ...DAMAGE_STATS.filter(([k]) => v(k)).map(([k, label]) => [`${label} damage`, `<b>${num(v(k))}</b> <span class="muted">${k.startsWith('Ranged') ? 'per hit' : 'added to each hit'}</span>`]),
  ];
  const warnings = [];
  const equipped = L.charms.map(s => DATA.charms.find(c => c.name === s.name)).filter(Boolean);
  const majors = equipped.filter(c => c.major).length;
  if (majors > MAJOR_SLOTS) warnings.push(`${majors} Major charms equipped. The game allows ${MAJOR_SLOTS}.`);
  const dupes = [...new Set(equipped.map(c => c.name).filter((n, i, a) => a.indexOf(n) !== i))];
  if (dupes.length) warnings.push(`${dupes.join(', ')} is equipped twice. The game allows each charm once.`);
  const unused = equipped.filter(c => !c.obtainable).map(c => c.name);
  if (unused.length) warnings.push(`${unused.join(', ')} can't be earned in the game.`);
  const perks = new Map();
  for (const s of sources) for (const p of s.perks) { if (!perks.has(p)) perks.set(p, []); if (!perks.get(p).includes(s.name)) perks.get(p).push(s.name); }
  const statRows = [...T.values()].sort((a, b) => a.stat.localeCompare(b.stat)).map(e => [
    { html: statCell(e.stat), key: e.stat },
    { html: fmtVal(e.fmt, e.value), key: e.value },
    { html: e.from.map(f => `${esc(f.name)} <span class="muted">${fmtVal(f.fmt, f.value)}</span>`).join('<br>') }]);
  return `<table class="summary"><tbody>${rows.map(([k, val]) => `<tr><th scope="row">${esc(k)}</th><td>${val}</td></tr>`).join('')}</tbody></table>
    ${warnings.map(x => `<p class="warn">${esc(x)}</p>`).join('')}
    <h2>Perks</h2>${perks.size ? `<p>${[...perks].map(([p, from]) => `<span class="tag" title="${esc(from.join(', '))}">${esc(human(p))}</span>`).join(' ')}</p>` : '<p class="muted">None.</p>'}
    <h2>Stat totals</h2>
    ${statRows.length ? table([{ label: 'Stat' }, { label: 'Total', num: 1 }, { label: 'From' }], statRows, { sortable: true }) : '<p class="muted">Nothing equipped changes a stat.</p>'}
    <p class="small muted">Window stats are listed per difficulty band. The windows above use the band for your difficulty.</p>`;
}
function levelSelect(id, labels, current, label, allowNone) {
  const opts = (allowNone ? [[-1, 'Not owned']] : []).concat(labels.map((l, i) => [i, l]));
  return `<select id="${esc(id)}" aria-label="${esc(label)}">${opts.map(([i, l]) => `<option value="${i}" ${+current === i ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}
function charmSelect(i, current) {
  const cats = [...new Set(DATA.charms.map(c => c.category))];
  return `<select id="charm-${i}" data-charm="${i}" aria-label="Charm slot ${i + 1}"><option value="">Empty</option>${cats.map(cat => `<optgroup label="${esc(cat)}">${DATA.charms.filter(c => c.category === cat).map(c =>
    `<option value="${esc(c.name)}" ${c.name === current ? 'selected' : ''}>${esc(c.name)}${c.major ? ' (major)' : ''}${c.obtainable ? '' : ' (unused)'}</option>`).join('')}</optgroup>`).join('')}</select>`;
}
function viewLoadout() {
  loadout = loadLoadout();
  const L = loadout;
  const fam = (list, key) => list.find(f => f.key === key);
  const chest = fam(DATA.armor, L.chest), mask = fam(DATA.armor, L.mask);
  const weaponRows = kind => DATA.weapons.filter(w => w.kind === kind).map(w =>
    `<div class="slot"><span>${esc(w.name)}</span>${levelSelect(`w-${w.key}`, w.levels, L.weapons[w.key] ?? 0, `${w.name} level`, true)}</div>`).join('');
  return `<h1>Loadout</h1>` + intro('Choose your gear to see the totals. The loadout is saved in this browser.') + `
  <div class="loadout">
    <form class="slots" id="slots" onsubmit="return false">
      <fieldset><legend>Difficulty</legend>${seg('ldiff', 'Difficulty', DIFFS.map((x, i) => [i, x]), L.diff)}</fieldset>
      <fieldset><legend>Armor</legend>
        <div class="slot"><select id="chest" aria-label="Chest armor">${chestOptions().map(a => `<option value="${esc(a.key)}" ${a.key === L.chest ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
        <span id="chest-level">${chest ? levelSelect('chest-lvl', chest.levels, L.chestLvl, 'Chest armor level') : ''}</span></div>
        <div class="slot"><select id="mask" aria-label="Mask"><option value="">Mask without stats</option>${maskOptions().map(a => `<option value="${esc(a.key)}" ${a.key === L.mask ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
        <span id="mask-level">${mask ? levelSelect('mask-lvl', mask.levels, L.maskLvl, 'Mask level') : ''}</span></div>
      </fieldset>
      <fieldset><legend>Charms</legend>
        ${L.charms.map((s, i) => { const c = DATA.charms.find(x => x.name === s.name);
          return `<div class="slot">${charmSelect(i, s.name)}<span id="charm-level-${i}">${c ? levelSelect(`charm-lvl-${i}`, charmLevels(c), s.lvl, `Charm slot ${i + 1} level`) : ''}</span></div>`; }).join('')}
        <p class="small muted">6 slots. Up to 4 can hold major charms.</p>
      </fieldset>
      <fieldset><legend>Melee weapons</legend>${weaponRows('Melee weapons')}</fieldset>
      <fieldset><legend>Ranged weapons</legend>${weaponRows('Ranged weapons')}</fieldset>
      <fieldset><legend>Tools</legend>${weaponRows('Tools and other gear')}</fieldset>
      <fieldset><legend>Health upgrades</legend>
        <div class="slot"><input type="range" id="health" min="0" max="${DATA.progression.health.length}" value="${L.health}" aria-label="Health upgrades collected"><output id="health-out">${L.health}</output></div>
      </fieldset>
      <div class="actions"><button type="button" class="action" id="share">Copy share link</button><button type="button" class="action secondary" id="reset">Reset</button></div>
      <p class="small muted" id="share-note" aria-live="polite"></p>
    </form>
    <section id="results" aria-live="polite" aria-label="Loadout totals">${loadoutResults()}</section>
  </div>`;
}
function bindLoadout(root) {
  const redraw = () => { saveLoadout(); const box = root.querySelector('#results'); box.innerHTML = loadoutResults(); bindSorting(box); };
  const swapLevel = (spanId, f, labels, id, label) => { root.querySelector(spanId).innerHTML = f ? levelSelect(id, labels, 0, label) : ''; };
  bindSeg(root, 'ldiff', v => { loadout.diff = +v; redraw(); });
  root.querySelector('#slots').addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'chest') {
      loadout.chest = t.value; loadout.chestLvl = 0;
      const f = DATA.armor.find(a => a.key === t.value); swapLevel('#chest-level', f, f && f.levels, 'chest-lvl', 'Chest armor level');
    } else if (t.id === 'chest-lvl') loadout.chestLvl = +t.value;
    else if (t.id === 'mask') {
      loadout.mask = t.value; loadout.maskLvl = 0;
      const f = DATA.armor.find(a => a.key === t.value); swapLevel('#mask-level', f, f && f.levels, 'mask-lvl', 'Mask level');
    } else if (t.id === 'mask-lvl') loadout.maskLvl = +t.value;
    else if (t.dataset.charm !== undefined) {
      const i = +t.dataset.charm; loadout.charms[i] = { name: t.value, lvl: 0 };
      const c = DATA.charms.find(x => x.name === t.value); swapLevel(`#charm-level-${i}`, c, c && charmLevels(c), `charm-lvl-${i}`, `Charm slot ${i + 1} level`);
    } else if (t.id.startsWith('charm-lvl-')) loadout.charms[+t.id.slice(10)].lvl = +t.value;
    else if (t.id.startsWith('w-')) loadout.weapons[t.id.slice(2)] = +t.value;
    else return;
    redraw();
  });
  root.querySelector('#health').addEventListener('input', e => { loadout.health = +e.target.value; root.querySelector('#health-out').textContent = e.target.value; redraw(); });
  root.querySelector('#share').addEventListener('click', async () => {
    const link = shareLink(), note = root.querySelector('#share-note');
    try { await navigator.clipboard.writeText(link); note.textContent = 'Link copied.'; }
    catch (e) { note.innerHTML = `<input type="text" readonly value="${esc(link)}" aria-label="Share link" style="width:100%">`; }
  });
  root.querySelector('#reset').addEventListener('click', () => {
    try { localStorage.removeItem(LOADOUT_KEY); } catch (e) { /* storage unavailable */ }
    route();
  });
}

/* ---------- routing ---------- */
const RENDER = {
  combat: [viewCombat, bindCombat], loadout: [viewLoadout, bindLoadout],
  armor: [viewArmor, root => bindSplit(root, 'armor', k => familyDetail(DATA.armor.find(f => f.key === k)))(state.armor)],
  weapons: [viewWeapons, root => bindSplit(root, 'weapon', k => familyDetail(DATA.weapons.find(f => f.key === k)))(state.weapon)],
  charms: [viewCharms, bindCharms], skills: [viewSkills, () => {}], enemies: [viewEnemies, bindEnemies],
  duels: [viewDuels, () => {}], damage: [viewDamage, bindDamage], about: [viewAbout, () => {}],
};
function route() {
  const id = location.hash.slice(1).split('=')[0] || 'combat';
  const view = RENDER[id] ? id : 'combat';
  document.querySelectorAll('#nav a').forEach(a => a.setAttribute('aria-current', a.dataset.view === view ? 'page' : 'false'));
  const main = document.getElementById('main');
  main.innerHTML = RENDER[view][0]();
  RENDER[view][1](main);
  bindSorting(main);
  const title = VIEWS.find(v => v[0] === view)[1];
  document.title = `${title} - Ghost of Yōtei numbers`;
}
function start() {
  document.getElementById('nav').innerHTML = NAV.map(([group, items]) =>
    `<div class="group"><span class="group-name">${esc(group)}</span>${items.map(([id, label]) => `<a href="#${id}" data-view="${id}">${esc(label)}</a>`).join('')}</div>`).join('');
  window.addEventListener('hashchange', () => {
    route();
    const main = document.getElementById('main');
    main.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  });
  fetch('data.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(d => { DATA = d; route(); })
    .catch(e => { document.getElementById('main').innerHTML = `<p>The data didn't load (${esc(e.message)}). Reload the page to try again.</p>`; });
}
start();
