'use strict';

const VIEWS = [
  ['combat', 'Combat'], ['armor', 'Armor'], ['weapons', 'Weapons and tools'], ['charms', 'Charms'],
  ['skills', 'Skills and progression'], ['enemies', 'Enemies'], ['duels', 'Duels and bounties'],
  ['damage', 'Damage'], ['about', 'About the data'],
];
const DIFFS = ['Easy', 'Medium', 'Hard', 'Lethal'];
const FPS = 60;
const MAX_F32 = 3e38;
let DATA = null;
const state = { diff: 1, charm: false, chest: 'none', enemy: 'none', enemyView: 'base', arch: null, armor: null, weapon: null,
  charmCat: 'All', charmSize: 'all', charmQuery: '', dmgDiff: 1, dmgHideSpecial: true };

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => (v === null || v === undefined) ? '—' : (+(+v).toFixed(3)).toLocaleString('en-US');
const human = s => String(s).replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
const sign = v => (v >= 0 ? '+' : '−');
function fmtVal(fmt, v) {
  if (v === null || v === undefined) return '—';
  const a = Math.abs(v);
  if (fmt === 'window') return `${sign(v)}${a.toFixed(3)} s <span class="muted">(${sign(v)}${Math.round(a * FPS)} f)</span>`;
  if (fmt === 'pct') return `${sign(v)}${+(a * 100).toFixed(2)}%`;
  return `${sign(v)}${+a.toFixed(4)}`;
}
const frames = sec => Math.round(sec * FPS);
const ms = sec => Math.round(sec * 1000);
/* At 30 fps a press can only register every 33 ms, so a window of f frames at 60 fps gives
   either floor(f/2) or ceil(f/2) 30 fps frames depending on where the strike falls; the
   average is unchanged. Returns the real time in ms. */
function at30(f) {
  const lo = Math.round(Math.floor(f / 2) * 1000 / 30), hi = Math.round(Math.ceil(f / 2) * 1000 / 30);
  return lo === hi ? `always ${lo} ms` : `${lo} or ${hi} ms`;
}
const statCell = s => `<span class="stat">${esc(human(s))}<span class="internal">${esc(s)}</span></span>`;

/* sortable table: cols = [{label, num}], rows = [[{html, key}]] */
function table(cols, rows, opts = {}) {
  const id = 't' + Math.random().toString(36).slice(2, 8);
  const head = cols.map((c, i) => `<th class="${c.num ? 'num ' : ''}${opts.sortable ? 'sortable' : ''}" data-col="${i}" ${opts.sortable ? 'tabindex="0"' : ''} scope="col">${c.label}</th>`).join('');
  const cell = c => (c !== null && typeof c === 'object') ? c : { html: esc(c), key: c };
  const body = rows.map(r => `<tr>${r.map((c, i) => { c = cell(c); return `<td class="${cols[i].num ? 'num' : ''}" data-key="${esc(c.key ?? '')}">${c.html ?? ''}</td>`; }).join('')}</tr>`).join('');
  return `<div class="table-wrap"><table id="${id}" ${opts.sortable ? 'data-sortable="1"' : ''}>${opts.caption ? `<caption class="sr">${esc(opts.caption)}</caption>` : ''}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
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
function seg(name, options, current) {
  return `<div class="seg" role="group" aria-label="${esc(name)}">${options.map(([v, label]) =>
    `<button type="button" data-seg="${esc(name)}" data-value="${esc(v)}" aria-pressed="${String(v) === String(current)}">${esc(label)}</button>`).join('')}</div>`;
}

/* ---------- combat ---------- */
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
  const pct = Math.min(100, f / FPS * 100);
  return `<div class="lane"><div class="lane-name">${esc(name)}<small>${esc(sub)}</small></div>
    <div class="lane-bar" style="--f:calc(100% / ${FPS})"><div class="fill ${cls}" data-lane="${cls}" style="width:${pct}%"><span class="fill-label">${f} frames (${ms(f / FPS)} ms)</span></div></div></div>`;
}
function rulerLanes() {
  const w = windowsNow();
  return lane('parry', 'Parry', 'press block', w.parry) + lane('perfect', 'Perfect Parry', 'press block', w.perfect) + lane('dodge', 'Perfect Dodge', 'press dodge', w.dodge);
}
function rulerFoot() {
  const w = windowsNow();
  const fp = frames(w.perfect), fpar = frames(w.parry);
  return `<span>At 30 fps the windows are just as long on average, but less consistent: Perfect Parry gives you <strong>${at30(fp)}</strong> per attack, Parry <strong>${at30(fpar)}</strong>.</span>`;
}
function viewCombat() {
  const c = DATA.combat, ws = c.windows;
  const chestOpts = [['none', 'Any other chest armor'], ['bounty0', 'Bounty Master Armor'], ['bounty1', 'Bounty Master Armor, upgraded'],
    ['undying0', 'Armor of the Undying, aligned weapon'], ['undying2', 'Armor of the Undying, upgraded, aligned weapon']];
  const enemyOpts = [['none', 'Most enemies'], ['Polearms', 'Polearm users'], ['Sickles', 'Sickle users'], ['Swords', 'Sword users'], ['First check (unidentified)', 'Unidentified group']];
  const axis = [60, 45, 30, 15].map(f => `<span style="right:${f / FPS * 100}%">${f === 60 ? '60 f (1 s)' : f + ' f'}</span>`).join('') + `<span class="strike" style="right:0">Strike</span>`;
  let html = `<section class="ruler" aria-labelledby="ruler-title">
    <div class="ruler-head"><h2 id="ruler-title">How long you have before the strike</h2>
    <p class="note" style="margin:0;max-width:40ch">Every defensive window closes the moment the enemy's hit lands. Frames at 60 fps.</p></div>
    <div class="controls">
      <div class="control"><span>Difficulty (Timing Windows)</span>${seg('diff', DIFFS.map((d, i) => [i, d]), state.diff)}</div>
      <div class="control"><span>Chest armor</span><select id="chest" aria-label="Chest armor">${chestOpts.map(([v, l]) => `<option value="${v}" ${v === state.chest ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="control"><span>Enemy</span><select id="enemy" aria-label="Enemy type">${enemyOpts.map(([v, l]) => `<option value="${esc(v)}" ${v === state.enemy ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="control"><span>Charm</span><label class="check"><input type="checkbox" id="charm" ${state.charm ? 'checked' : ''}> Charm of Futsunushi</label></div>
    </div>
    <div class="track" id="lanes">${rulerLanes()}</div>
    <div class="axis" aria-hidden="true"><span></span><div class="axis-scale">${axis}</div></div>
    <div class="ruler-foot" id="ruler-foot">${rulerFoot()}</div>
  </section>`;

  html += `<h2>Base windows by difficulty</h2>
  <p>The Custom difficulty's Timing Windows setting picks one of these rows directly. Story has no row of its own and most likely uses Easy. Hard and Lethal share the same Perfect Parry and Perfect Dodge; Lethal only shortens the regular Parry.</p>`;
  html += table([{ label: 'Difficulty' }, { label: 'Parry', num: 1 }, { label: 'Perfect Parry', num: 1 }, { label: 'Perfect Dodge', num: 1 }, { label: 'Unidentified window', num: 1 }],
    ws.map(w => [w.difficulty, ...[w.parry, w.perfect_parry, w.perfect_dodge, w.unknown].map(s => ({ html: `${frames(s)} f <span class="sub">${ms(s)} ms</span>`, key: s }))]));
  html += `<p class="note">The unidentified window is a fifth value in the same table that no stat changes.</p>`;

  html += `<h2>Gear that widens the windows</h2><p>These bonuses are added to the base windows. Hard and Lethal share one value. Charm of Futsunushi is the only charm that touches the windows; the two armors are both chest pieces.</p>`;
  const bonusRows = [];
  for (const src of DATA.window_bonuses) {
    for (const s of src.stats) {
      bonusRows.push([{ html: `<b>${esc(src.name)}</b>` }, { html: statCell(s.stat) },
        { html: src.levels.map((l, i) => s.values[i] === null || s.values[i] === undefined ? '' : `${esc(l)} ${fmtVal('window', s.values[i])}`).filter(Boolean).join('<br>') }]);
    }
  }
  html += table([{ label: 'Source' }, { label: 'Stat' }, { label: 'Value by upgrade level' }], bonusRows);

  html += `<h2>Per-enemy adjustments</h2><p>Some enemy classes change the Parry and Perfect Parry windows. The game checks the groups in table order and applies only the first match.</p>`;
  const groups = Object.keys(ws[0].enemy_adjust);
  html += table([{ label: 'Enemies' }, ...DIFFS.map(d => ({ label: `${d}: Parry / Perfect`, num: 1 }))],
    groups.map(g => [g, ...ws.map(w => ({ html: w.enemy_adjust[g].map(v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(frames(v))} f`).join(' / ') }))]));

  html += `<h3>Why a window can feel shorter than the table</h3>
  <p>A window can never open earlier than about 1/6 s after a point early in the attacker's animation, so fast attacks get less than the table gives; this hits the long Easy Parry window hardest. There is also a small low-health extension (+0.05 s Parry, +0.01 s Perfect Parry, times a scale) whose trigger is not identified.</p>
  <h3>30 fps versus 60 fps</h3>
  <p>The windows are defined in seconds and the game does not adjust them for frame rate. Your press is timed by the frame that handles it, so it can only register every 16.7 ms at 60 fps and every 33.3 ms at 30 fps.</p>
  <p>That does not halve the window at 30 fps: frames last twice as long, so the window covers half as many of them. What changes is consistency. At 60 fps every window is a whole number of frames, so it is the same length on every attack. At 30 fps most windows fall between frame counts, so you get a little less on some attacks and a little more on others, depending on where the strike lands between two frames. The 50 ms Perfect Parry on Hard and Lethal becomes 33 ms on half of attacks and 67 ms on the other half, still 50 ms on average. At 40 fps (25 ms frames) it is always 50 ms again.</p>`;

  html += `<h2>Weapon alignment</h2><p>Each weapon counters one enemy class. Being aligned means you have the counter weapon out at that moment.</p>`;
  html += table([{ label: 'Weapon' }, { label: 'Aligned against' }], c.alignment.map(a => [a.weapon, a.against]));
  html += `<p class="note">Shield-bearers count only as Shields, even if they also carry a sword or sickle. Brute types always count as Brutes for the Odachi. While an enemy has one particular, unidentified status effect, every weapon counts as aligned against it.</p>`;

  const det = c.detection, ag = c.aggression;
  html += `<h2>Difficulty settings</h2><h3>Detection</h3>`;
  html += table([{ label: '' }, ...DIFFS.map(d => ({ label: d, num: 1 }))], [
    ['Range at which enemies notice your noise', ...det.noise_range.map(v => ({ html: `×${num(v)}`, key: v }))],
    ['Time an enemy needs to spot you', ...det.detect_time.map(v => ({ html: `×${num(v)}`, key: v }))],
  ]);
  html += `<p class="note">The spotting time is also multiplied by (1 + Awareness Mod), the stealth stat on armor and charms, and the base time is at least 2 s.</p>`;
  html += `<h3>Enemy aggression</h3><p>The numbers are exact; what each row controls is our best reading of how the game uses it.</p>`;
  html += table([{ label: 'Likely meaning' }, ...DIFFS.map(d => ({ label: d, num: 1 }))], [
    ['Wait between attacks, 2 enemies (s)', ...ag.attack_wait.map(a => `${num(a.two[0])}–${num(a.two[1])}`)],
    ['Wait between attacks, 5 enemies (s)', ...ag.attack_wait.map(a => `${num(a.five[0])}–${num(a.five[1])}`)],
    ['Attackers allowed at once, 2 / 3 / 5 enemies', ...ag.group_budget.map(b => b.join(' / '))],
    ...ag.windup.distances_m.map((m, k) => [`Wind-up time at ${num(m)} m (s)`, ...ag.windup.rows.map(r => num(r[k]))]),
    ...ag.reaction_delay.map((r, k) => [`Reaction delay, event kind ${k} (s)`, ...r.map(num)]),
    ['Minimum gap before repeating an action (s)', ...ag.repeat_gap.map(num)],
  ]);
  html += `<p class="note">Enemy damage, resolve gains and animation speed per difficulty are not hard-coded. Damage per difficulty is on the Damage page.</p>`;
  return html;
}
function bindCombat(root) {
  const refresh = () => {
    const w = windowsNow();
    for (const [cls, sec] of [['parry', w.parry], ['perfect', w.perfect], ['dodge', w.dodge]]) {
      const f = Math.max(0, frames(sec)), fill = root.querySelector(`.fill[data-lane="${cls}"]`);
      fill.style.width = Math.min(100, f / FPS * 100) + '%';
      fill.querySelector('.fill-label').textContent = `${f} frames (${ms(f / FPS)} ms)`;
    }
    root.querySelector('#ruler-foot').innerHTML = rulerFoot();
  };
  root.querySelectorAll('[data-seg="diff"]').forEach(b => b.addEventListener('click', () => {
    state.diff = +b.dataset.value;
    root.querySelectorAll('[data-seg="diff"]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    refresh();
  }));
  root.querySelector('#chest').addEventListener('change', e => { state.chest = e.target.value; refresh(); });
  root.querySelector('#enemy').addEventListener('change', e => { state.enemy = e.target.value; refresh(); });
  root.querySelector('#charm').addEventListener('change', e => { state.charm = e.target.checked; refresh(); });
}

/* ---------- armor, weapons ---------- */
function familyDetail(f) {
  let html = `<h3>${esc(f.name)}</h3><p class="muted" style="margin-top:0">${f.internal ? `<code>${esc(f.internal)}</code>` : 'Applies to the player, no gear object'}</p>`;
  if (f.description) html += `<blockquote>${esc(f.description)}</blockquote>`;
  if (f.stats.length) {
    html += table([{ label: 'Stat' }, ...f.levels.map(l => ({ label: esc(l), num: 1 }))],
      f.stats.map(s => [{ html: statCell(s.stat) + (s.hero ? ' <span class="tag">player</span>' : '') }, ...s.values.map(v => ({ html: fmtVal(s.fmt, v) }))]));
    html += `<p class="note">Running totals: each column includes every earlier upgrade.${f.levels.includes('NG+') ? ' NG+ is the New Game+ upgrade on top of the last level.' : ''}</p>`;
  }
  const items = f.extras.map((bits, i) => bits.length ? `<li><b>${esc(f.levels[i])}</b> ${bits.map(b => `<span class="tag ${b.kind === 'unlock' ? '' : 'lily'}">${esc(b.kind === 'perk' ? 'Perk ' + b.text : b.kind === 'unlock' ? 'Unlocks ' + b.text : b.kind === 'item' ? 'Gives ' + b.text : 'Carry ' + b.text)}</span>`).join(' ')}</li>` : '').join('');
  if (items) html += `<ul class="extras">${items}</ul>`;
  return html;
}
function splitView(groups, current, key) {
  const all = groups.flatMap(g => g.items);
  const cur = all.find(f => f.key === current) || all[0];
  const picker = groups.map(g => `${g.title ? `<h4>${esc(g.title)}</h4>` : ''}${g.items.map(f => `<button type="button" data-pick="${esc(key)}" data-value="${esc(f.key)}" aria-current="${f.key === cur.key}">${esc(f.name)}</button>`).join('')}`).join('');
  const select = `<select class="picker-select" data-pick-select="${esc(key)}" aria-label="Choose">${groups.map(g => `<optgroup label="${esc(g.title || 'All')}">${g.items.map(f => `<option value="${esc(f.key)}" ${f.key === cur.key ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</optgroup>`).join('')}</select>`;
  return { cur, html: `<div class="split"><nav class="picker" aria-label="List">${picker}</nav><div class="detail">${select}<div id="detail-${esc(key)}"></div></div></div>` };
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
  const { cur, html } = splitView([{ title: '', items: DATA.armor }], state.armor, 'armor');
  state.armor = cur.key;
  return `<h2>Armor</h2><p>Every chest armor's real numbers at each upgrade level, including the New Game+ upgrade most of them have. Hats, masks and headbands are cosmetic, with one exception: Kanemori's Two-Faced Mask. The cosmetics an upgrade unlocks are listed under each armor.</p>` + html;
}
function viewWeapons() {
  const kinds = ['Melee weapons', 'Ranged weapons', 'Tools and other gear'];
  const groups = kinds.map(k => ({ title: k, items: DATA.weapons.filter(w => w.kind === k) })).filter(g => g.items.length);
  const { cur, html } = splitView(groups, state.weapon, 'weapon');
  state.weapon = cur.key;
  return `<h2>Weapons and tools</h2><p>The Base column is the item's own value; each upgrade adds to it. The katana and dual katana have no base damage stat: their damage is set per move, and upgrades add a flat amount on top. Bow upgrades also hand you a stack of a new ammo type, which is how those arrows are unlocked.</p>` + html;
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
    const eff = c.stats.map(s => `<div><span class="stat">${esc(human(s.stat))}</span> ${s.values.map(v => fmtVal(s.fmt, v)).join(' → ')}</div>`).join('')
      + c.perks.map(p => `<span class="tag lily">Perk ${esc(p)}</span>`).join(' ')
      + c.upgrade_perks.map(p => `<span class="tag lily">Upgrade adds ${esc(p)}</span>`).join(' ')
      + c.carry.map(x => `<span class="tag">Carry ${esc(x)}</span>`).join(' ');
    return [{ html: `<b>${esc(c.name)}</b><span class="sub">${esc(c.category)}${c.major ? ', major' : ', minor'}${c.obtainable ? '' : ', not awarded by any task'}</span>`, key: c.name },
      { html: eff || '—' }, { html: `<span class="muted">${esc(c.description)}</span>` }];
  });
  return `<p class="count">${rows.length} of ${DATA.charms.length} charms</p>` + table([{ label: 'Charm' }, { label: 'Effect at each level' }, { label: 'In-game text' }], body, { sortable: true });
}
function viewCharms() {
  const cats = ['All', ...new Set(DATA.charms.map(c => c.category))];
  return `<h2>Charms</h2><p>All 91 charms with the value of every effect at each upgrade level, from base to fully upgraded. Where the game says "a minor amount", this is the number it uses. Stats start at zero, so a bonus is the whole value: +10% Lethal Damage Survival Chance means a 10% chance.</p>
  <div class="toolbar">
    <div class="chips" role="group" aria-label="Category">${cats.map(c => `<button type="button" data-cat="${esc(c)}" aria-pressed="${c === state.charmCat}">${esc(c)}</button>`).join('')}</div>
    ${seg('size', [['all', 'All'], ['major', 'Major'], ['minor', 'Minor']], state.charmSize)}
    <input type="search" id="charm-q" placeholder="Search charms, stats or perks" aria-label="Search charms" value="${esc(state.charmQuery)}">
  </div><div id="charm-table">${charmTable()}</div>`;
}
function bindCharms(root) {
  const redraw = () => { const box = root.querySelector('#charm-table'); box.innerHTML = charmTable(); bindSorting(box); };
  root.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => {
    state.charmCat = b.dataset.cat; root.querySelectorAll('[data-cat]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); redraw();
  }));
  root.querySelectorAll('[data-seg="size"]').forEach(b => b.addEventListener('click', () => {
    state.charmSize = b.dataset.value; root.querySelectorAll('[data-seg="size"]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); redraw();
  }));
  root.querySelector('#charm-q').addEventListener('input', e => { state.charmQuery = e.target.value; redraw(); });
}

/* ---------- skills and progression ---------- */
function viewSkills() {
  const p = DATA.progression;
  const base = DATA.enemies.player[1]?.base?.hp ?? 100;
  let html = `<h2>Skills</h2><p>Skill tree entries, listed by the game's internal names because their in-game titles aren't linked to them. Entries that only unlock a move without a number are left out.</p>`;
  html += table([{ label: 'Skill' }, { label: 'Perks' }, { label: 'Numbers' }], DATA.skills.map(s => [
    { html: esc(human(s.task)), key: s.task },
    { html: s.perks.map(x => `<span class="tag lily">${esc(x)}</span>`).join(' ') || '—' },
    { html: s.stats.map(x => `${esc(human(x.stat))} ${fmtVal(x.fmt, x.value)}${x.target !== 'hero' ? ` <span class="muted">on ${esc(x.target)}</span>` : ''}`).join('<br>') || '—' }]), { sortable: true });

  html += `<h2>Health</h2><p>The player starts with ${num(base)} health and ${num(DATA.enemies.player[1]?.base?.blkp ?? 100)} block points on every difficulty. Each of the ${p.health.length} health upgrades adds less than the one before.</p>`;
  let tot = base;
  html += table([{ label: 'Upgrade', num: 1 }, { label: 'Adds', num: 1 }, { label: 'Max health after', num: 1 }], p.health.map((v, i) => { tot += v; return [String(i + 1), `+${num(v)}`, num(tot)]; }));
  html += `<p class="note">Armor can add more, such as Taro's Armor (+5 to +20).</p>`;
  html += `<h2>Spirit</h2>` + table([{ label: 'Task' }, { label: 'Change' }], p.spirit.map(s => [s.task, `${human(s.stat)} +${num(s.value)}`]));
  html += `<h2>Carry capacity</h2><p>Each upgrade raises how many of an item you can carry. Starting limits are not included.</p>`;
  html += table([{ label: 'Item' }, { label: 'Upgrade 1', num: 1 }, { label: 'Upgrade 2', num: 1 }, { label: 'Upgrade 3', num: 1 }, { label: 'Total', num: 1 }],
    p.carry.map(c => [human(c.item), ...c.steps.map(v => v ? `+${v}` : '—'), `+${c.steps.reduce((a, b) => a + b, 0)}`]), { sortable: true });
  html += `<h2>Perks unlocked by the story</h2>` + table([{ label: 'Task' }, { label: 'Perks' }], p.story_perks.map(s => [s.task, { html: s.perks.map(x => `<span class="tag lily">${esc(x)}</span>`).join(' ') }]), { sortable: true });
  return html;
}

/* ---------- enemies ---------- */
const pair = p => p ? `<b>${num(p.hp)}</b> <span class="muted">/ ${num(p.blkp)}</span>` : '<span class="muted">—</span>';
function enemyMatrix(arch) {
  const rows = DATA.enemies.enemies.filter(p => p.archk === arch);
  const regions = ['NonValley', 'Frontier', 'Castle', 'Ninja', 'Gun', 'Finale'].filter(r => rows.some(p => p.evagrp === r));
  const ranks = ['Grunt', 'Veteran', 'Elite', 'Leader'].filter(k => rows.some(p => p.wpnlvl === k));
  const v = state.enemyView;
  let html = `<h3>${esc(human(arch))}</h3>`;
  html += table([{ label: 'Region group' }, ...ranks.map(r => ({ label: r, num: 1 }))], regions.map(g => [g, ...ranks.map(r => {
    const p = rows.find(x => x.evagrp === g && x.wpnlvl === r);
    return { html: p ? pair(p[v]) : '<span class="muted">—</span>' };
  })]));
  return html;
}
function viewEnemies() {
  const E = DATA.enemies;
  const archs = [...new Set(E.enemies.map(p => p.archk))].sort();
  state.arch = state.arch && archs.includes(state.arch) ? state.arch : 'Skirmisher';
  let html = `<h2>Enemies</h2><p>Health and block points for every enemy type, by the game's internal region group and rank. Block points are the guard meter you break to stagger an enemy. Shown as <b>health</b> / block.</p>
  <div class="toolbar">${seg('ev', [['base', 'Base game'], ['ng_plus', 'New Game+'], ['alt', 'Alternate set']], state.enemyView)}</div>
  <p class="note">Region groups are internal names (NonValley, Frontier, Castle, Ninja, Gun, Finale) that line up with the game's valley names; exactly which in-game areas each covers is not confirmed. The alternate set is a third pair of values whose purpose is unknown; a dash means it is not set.</p>`;
  const groups = [{ title: '', items: archs.map(a => ({ key: a, name: human(a) })) }];
  const { html: split } = splitView(groups, state.arch, 'arch');
  html += split;
  html += `<h2>Creatures and civilians</h2>` + table([{ label: 'Archetype' }, { label: 'Health / block', num: 1 }, { label: 'New Game+', num: 1 }],
    E.archetypes.map(p => [human(p.archk), { html: pair(p.base), key: p.base?.hp }, { html: pair(p.ng_plus), key: p.ng_plus?.hp }]), { sortable: true });
  html += `<h2>The player and allies</h2>` + table([{ label: 'Who' }, { label: 'Health / block', num: 1 }, { label: 'New Game+', num: 1 }, { label: 'Damage ratio', num: 1 }], [
    ...E.player.map(p => [`Player, ${p.gdk === 'Nightmare' ? 'Lethal' : p.gdk}`, { html: pair(p.base) }, { html: pair(p.ng_plus && p.ng_plus.hp > 0 ? p.ng_plus : null) }, '—']),
    ...E.buddies.map(p => [`Ally profile ${human(p.buddylk)}`, { html: pair(p.base) }, { html: pair(p.ng_plus) }, num((E.buddy_adjustments[p.buddylk] || [])[0])]),
  ]);
  return html;
}
function bindEnemies(root) {
  const show = bindSplit(root, 'arch', a => enemyMatrix(a));
  show(state.arch);
  root.querySelectorAll('[data-seg="ev"]').forEach(b => b.addEventListener('click', () => {
    state.enemyView = b.dataset.value; root.querySelectorAll('[data-seg="ev"]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); show(state.arch);
  }));
}

/* ---------- duels and bounties ---------- */
function opponentTable(items, key, adj) {
  return table([{ label: 'Opponent' }, { label: 'Health', num: 1 }, { label: 'Block', num: 1 }, { label: 'Alternate', num: 1 }, { label: 'NG+ health / block', num: 1 }, { label: 'Damage ratio', num: 1 }, { label: 'NG+ damage ratio', num: 1 }],
    items.map(p => {
      const a = adj[p[key]] || [];
      return [{ html: esc(human(p[key])), key: p[key] }, { html: num(p.base?.hp), key: p.base?.hp }, { html: num(p.base?.blkp), key: p.base?.blkp },
        { html: pair(p.alt), key: p.alt?.hp ?? -1 }, { html: pair(p.ng_plus), key: p.ng_plus?.hp ?? -1 }, { html: a[0] !== undefined ? `×${num(a[0])}` : '—', key: a[0] ?? 0 }, { html: a[1] !== undefined ? `×${num(a[1])}` : '—', key: a[1] ?? 0 }];
    }), { sortable: true });
}
function viewDuels() {
  const E = DATA.enemies;
  return `<h2>Duels</h2><p>All ${E.duels.length} duel opponents by their internal names. The prefix is the area (Fr, Cv, Nv, Gv, Fn); phases are separate entries. The damage ratio scales how hard the opponent hits.</p>${opponentTable(E.duels, 'dueldk', E.duel_adjustments)}
  <h2>Bounty targets</h2><p>${E.bounties.length} bounty targets, same columns.</p>${opponentTable(E.bounties, 'bhtdk', E.bounty_adjustments)}
  <p class="note">Two phases of the final duel have 9,999 health (99,999 in New Game+), probably so that a scripted event ends them rather than damage.</p>`;
}

/* ---------- damage ---------- */
function median(a) { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; }
function dmgTable() {
  const d = state.dmgDiff;
  const rows = DATA.enemies.damage_classes.filter(c => {
    if (!state.dmgHideSpecial) return true;
    const hp = c.hit_points || [0];
    return hp.some(v => v > 0 && v < MAX_F32);
  });
  const v4 = (arr, i) => !arr ? null : arr.length === 4 ? arr[i] : arr[0];
  const show = v => v === null ? '—' : v >= MAX_F32 ? '∞' : num(v);
  return `<p class="count">${rows.length} damage classes</p>` + table([{ label: 'Class' }, ...DIFFS.map((x, i) => ({ label: `${x}${i === d ? ' (selected)' : ''}`, num: 1 })), { label: 'NG+ on ' + DIFFS[d], num: 1 }, { label: 'Block damage', num: 1 }, { label: 'Legends', num: 1 }],
    rows.map(c => [{ html: `<code>${esc(c.damage_class.slice(2))}</code>`, key: c.damage_class },
      ...DIFFS.map((_, i) => ({ html: i === d ? `<b>${show(v4(c.hit_points, i))}</b>` : show(v4(c.hit_points, i)), key: v4(c.hit_points, i) ?? -1 })),
      { html: show(v4(c.hit_points_ng_plus, d)), key: v4(c.hit_points_ng_plus, d) ?? -1 },
      { html: show(v4(c.block_points, d)), key: v4(c.block_points, d) ?? -1 },
      { html: show(v4(c.legends_hit_points, 0)), key: v4(c.legends_hit_points, 0) ?? -1 }]), { sortable: true });
}
function viewDamage() {
  const dc = DATA.enemies.damage_classes.filter(c => c.hit_points && c.hit_points.length === 4 && c.hit_points[1] > 0 && c.hit_points[1] < MAX_F32);
  const ratio = i => median(dc.map(c => c.hit_points[i] / c.hit_points[1]));
  return `<h2>Damage</h2><p>Enemy hits come from ${DATA.enemies.damage_classes.length} damage classes. Most give one value per Enemy Damage difficulty setting; the player has 100 health, so a value of 50 is half your base health. Only damage to the player uses your difficulty; enemies hitting each other use the Medium value. Damage classes have no names, so they are listed by ID.</p>
  <div class="cols2"><p><b>Typical scaling against Medium:</b> Easy ×${num(ratio(0))}, Hard ×${num(ratio(2))}, Lethal ×${num(ratio(3))} (medians over ${dc.length} classes).</p>
  <p><b>Block damage</b> is what a blocked hit takes from your 100 block points. <b>NG+</b> values replace the base values in New Game+.</p></div>
  <div class="toolbar">${seg('dd', DIFFS.map((x, i) => [i, x]), state.dmgDiff)}
  <label class="check"><input type="checkbox" id="dmg-special" ${state.dmgHideSpecial ? 'checked' : ''}> Hide classes that deal no damage or kill outright</label></div>
  <div id="dmg-table">${dmgTable()}</div>`;
}
function bindDamage(root) {
  const redraw = () => { const box = root.querySelector('#dmg-table'); box.innerHTML = dmgTable(); bindSorting(box); };
  root.querySelectorAll('[data-seg="dd"]').forEach(b => b.addEventListener('click', () => {
    state.dmgDiff = +b.dataset.value; root.querySelectorAll('[data-seg="dd"]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); redraw();
  }));
  root.querySelector('#dmg-special').addEventListener('change', e => { state.dmgHideSpecial = e.target.checked; redraw(); });
}

/* ---------- about ---------- */
function viewAbout() {
  return `<h2>About the data</h2>
  <p>All values are for game version ${esc(DATA.version)}. Later patches may change them.</p>
  <h3>How to read the numbers</h3>
  <ul>
    <li><b>Stats start at zero and add up.</b> A bonus such as Charm of Fortitude's +10% Lethal Damage Survival Chance is the whole value: nothing else sets that stat, so with the charm you have a 10% chance and without it none.</li>
    <li><b>Items have base values.</b> Bows, the Tanegashima, the Yari, Kusarigama and Odachi, the Tanto, bombs and one cursed mask carry their own stats, shown in the Base column. Upgrades add to them.</li>
    <li><b>Upgrade levels add up</b>, with New Game+ on top of the last level.</li>
    <li>Stat and perk names such as <code>AlignedPerfectParryWindowModEasy</code> are the game's own internal names.</li>
  </ul>
  <h3>What is not covered or not certain</h3>
  <ul>
    <li>The damage of each individual player attack (the katana and dual katana have no base damage stat; their damage is set per move), and starting ammo limits.</li>
    <li>Which enemy attack uses which damage class, and the in-game names of skills.</li>
    <li>Labels marked as likely or unidentified are best guesses, not confirmed.</li>
  </ul>`;
}

/* ---------- routing ---------- */
const RENDER = { combat: [viewCombat, bindCombat], armor: [viewArmor, root => bindSplit(root, 'armor', k => familyDetail(DATA.armor.find(f => f.key === k)))(state.armor)],
  weapons: [viewWeapons, root => bindSplit(root, 'weapon', k => familyDetail(DATA.weapons.find(f => f.key === k)))(state.weapon)],
  charms: [viewCharms, bindCharms], skills: [viewSkills, () => {}], enemies: [viewEnemies, bindEnemies], duels: [viewDuels, () => {}],
  damage: [viewDamage, bindDamage], about: [viewAbout, () => {}] };
function route() {
  const id = (location.hash.slice(1) || 'combat');
  const view = RENDER[id] ? id : 'combat';
  document.querySelectorAll('#nav a').forEach(a => a.setAttribute('aria-current', a.dataset.view === view ? 'page' : 'false'));
  const main = document.getElementById('main');
  main.innerHTML = RENDER[view][0]();
  RENDER[view][1](main);
  bindSorting(main);
  const title = VIEWS.find(v => v[0] === view)[1];
  document.title = view === 'combat' ? 'Ghost of Yōtei by the numbers' : `${title}: Ghost of Yōtei by the numbers`;
}
function start() {
  document.getElementById('nav').innerHTML = VIEWS.map(([id, label]) => `<a href="#${id}" data-view="${id}">${esc(label)}</a>`).join('');
  window.addEventListener('hashchange', () => { route(); document.getElementById('main').focus({ preventScroll: true }); window.scrollTo({ top: document.querySelector('.sections').offsetTop }); });
  fetch('data.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(d => { DATA = d; route(); })
    .catch(e => { document.getElementById('main').innerHTML = `<p>The data file did not load (${esc(e.message)}). Reload the page to try again.</p>`; });
}
start();
