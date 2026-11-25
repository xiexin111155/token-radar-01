// Token Radar's dashboard. It renders window.RADAR (written beside dashboard/ by main.ts):
// the ranked board, a detail view per protocol with its value breakdown and farm plan, and the
// tokenised comparables the model's multiples were measured from. No network, no framework:
// every byte it shows was computed by the entry program from the sealed snapshot.
(function () {
  'use strict';
  var D = window.RADAR;
  var main = document.getElementById('board');
  if (!D || !main) return;
  var bySlug = {};
  D.rows.forEach(function (r) { bySlug[r.slug] = r; });
  var maxImplied = D.rows.length ? D.rows[0].implied_value_usd : 1;
  var boardHash = '#/';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtUsd(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }
  function fmtPct(n) {
    if (n == null) return '<span class="flat">n/a</span>';
    var cls = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
    return '<span class="' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }
  function fmtAge(days) {
    if (days == null) return 'unreported';
    if (days >= 730) return (days / 365.25).toFixed(1) + ' yrs';
    if (days >= 60) return Math.round(days / 30.4) + ' mo';
    return days + ' d';
  }
  function fmtMult(n) { return n.toFixed(2) + 'x'; }
  function rings() {
    return '<svg class="rings" viewBox="0 0 48 48" fill="none" aria-hidden="true">' +
      '<circle cx="24" cy="24" r="21" stroke="#134e47" stroke-width="2"/>' +
      '<circle cx="24" cy="24" r="13.5" stroke="#1d7a6e" stroke-width="2"/>' +
      '<circle cx="24" cy="24" r="6" stroke="#2dd4bf" stroke-width="2"/>' +
      '<circle cx="24" cy="24" r="2.2" fill="#2dd4bf"/>' +
      '<line x1="24" y1="24" x2="40" y2="9" stroke="#2dd4bf" stroke-width="2"/></svg>';
  }
  function masthead() {
    var s = D.stats;
    return '<div class="masthead"><div class="brand">' + rings() + '<div>' +
      '<h1>TOKEN <span class="thin">RADAR</span></h1>' +
      '<p class="tagline">Protocols that still record no token, ranked by what their launch would be worth — each with the plan to farm it.</p>' +
      '</div></div><div class="stats">' +
      '<div class="stat"><b>' + s.protocols + '</b><span>protocols scanned</span></div>' +
      '<div class="stat"><b>' + s.ranked + '</b><span>pre-token, ranked</span></div>' +
      '<div class="stat"><b>' + s.watchlist + '</b><span>on the watchlist</span></div>' +
      '<div class="stat"><b>' + fmtUsd(s.total_implied_usd) + '</b><span>total implied value</span></div>' +
      '<div class="stat"><b>' + esc(D.as_of) + '</b><span>snapshot date</span></div>' +
      '</div></div>';
  }
  function modelStrip() {
    var top = D.multiples.categories.slice(0, 8).map(function (c) {
      return '<span><b>' + fmtMult(c.used) + '</b> ' + esc(c.category) + ' (n=' + c.n + ')</span>';
    }).join('');
    return '<section class="model"><h2>How a launch is priced</h2>' +
      '<span class="formula">implied value = TVL x category multiple x growth factor x tokenless-age factor x breadth factor</span>' +
      '<p>The category multiple is the median market-cap / TVL of the protocols in this snapshot whose token already trades, ' +
      'shrunk toward the global median of ' + fmtMult(D.multiples.global_median) + ' (n=' + D.multiples.global_n + ') and capped. ' +
      'The growth factor is 1 + the seven-day TVL change, clamped to [-25%, +40%]. The age factor adds up to +35% for years run ' +
      'with no token, saturating; breadth adds 2% per extra chain, up to ten. Nothing is priced from a list of names: move any ' +
      'figure in the snapshot and the board moves.</p>' +
      '<div class="mults">' + top + '</div></section>';
  }

  // ---- board state: kept in the hash so every view, filtered ones included, is a link ----
  function parseHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (h.indexOf('/p/') === 0) return { view: 'detail', slug: decodeURIComponent(h.slice(3)) };
    var q = {};
    var qs = h.indexOf('?') >= 0 ? h.slice(h.indexOf('?') + 1) : '';
    qs.split('&').forEach(function (pair) {
      if (!pair) return;
      var kv = pair.split('=');
      q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
    return { view: 'board', q: q.q || '', cat: q.cat || '', chain: q.chain || '', watch: q.watch === '1', sort: q.sort || 'value', dir: q.dir === 'asc' ? 'asc' : 'desc' };
  }
  function boardUrl(st) {
    var parts = [];
    if (st.q) parts.push('q=' + encodeURIComponent(st.q));
    if (st.cat) parts.push('cat=' + encodeURIComponent(st.cat));
    if (st.chain) parts.push('chain=' + encodeURIComponent(st.chain));
    if (st.watch) parts.push('watch=1');
    if (st.sort !== 'value') parts.push('sort=' + st.sort);
    if (st.dir === 'asc') parts.push('dir=asc');
    return '#/' + (parts.length ? '?' + parts.join('&') : '');
  }
  function filtered(st) {
    var rows = D.rows.filter(function (r) {
      if (st.watch && !r.watchlist) return false;
      if (st.cat && (r.category || 'Uncategorised') !== st.cat) return false;
      if (st.chain && r.chains.indexOf(st.chain) < 0) return false;
      if (st.q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase();
        if (hay.indexOf(st.q.toLowerCase()) < 0) return false;
      }
      return true;
    });
    var key = { value: 'implied_value_usd', tvl: 'tvl_usd', chg: 'change_7d', age: 'age_days', mult: 'multiple_used' }[st.sort] || 'implied_value_usd';
    rows.sort(function (a, b) {
      var av = a[key], bv = b[key];
      if (av == null && bv == null) return a.rank - b.rank;
      if (av == null) return 1;
      if (bv == null) return -1;
      var d = st.dir === 'asc' ? av - bv : bv - av;
      return d !== 0 ? d : a.rank - b.rank;
    });
    return rows;
  }
  function options(values, current, allLabel) {
    var out = '<option value="">' + allLabel + '</option>';
    values.forEach(function (v) {
      out += '<option value="' + esc(v) + '"' + (v === current ? ' selected' : '') + '>' + esc(v) + '</option>';
    });
    return out;
  }
  function renderBoard(st) {
    boardHash = boardUrl(st);
    var cats = [], chains = [], seenC = {}, seenH = {};
    D.rows.forEach(function (r) {
      var c = r.category || 'Uncategorised';
      if (!seenC[c]) { seenC[c] = 1; cats.push(c); }
      r.chains.forEach(function (ch) { if (!seenH[ch]) { seenH[ch] = 1; chains.push(ch); } });
    });
    cats.sort(); chains.sort();
    var rows = filtered(st);
    var html = masthead() + modelStrip() +
      '<div class="controls">' +
      '<input type="search" id="f-q" placeholder="Search name or slug" value="' + esc(st.q) + '" aria-label="Search">' +
      '<select id="f-cat" aria-label="Category">' + options(cats, st.cat, 'All categories') + '</select>' +
      '<select id="f-chain" aria-label="Chain">' + options(chains, st.chain, 'All chains') + '</select>' +
      '<label class="check"><input type="checkbox" id="f-watch"' + (st.watch ? ' checked' : '') + '> Watchlist only</label>' +
      '<select id="f-sort" aria-label="Sort by">' +
      [['value', 'Sort: implied value'], ['tvl', 'Sort: TVL'], ['chg', 'Sort: 7d growth'], ['age', 'Sort: tokenless age'], ['mult', 'Sort: multiple']]
        .map(function (o) { return '<option value="' + o[0] + '"' + (st.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
      '</select>' +
      '<button class="sortdir" id="f-dir" title="Flip sort direction">' + (st.dir === 'asc' ? 'Ascending' : 'Descending') + '</button>' +
      '<span class="count">' + rows.length + ' of ' + D.rows.length + ' shown</span></div>';
    if (rows.length === 0) {
      html += '<div class="empty">No ranked protocol matches this filter. Loosen it: the board holds ' + D.rows.length + ' pre-token protocols.</div>';
    } else {
      html += '<table class="board"><thead><tr><th>Rank</th><th>Protocol</th><th>Category</th>' +
        '<th class="r">TVL</th><th class="r">7d</th><th class="r">Tokenless age</th><th class="r">Chains</th>' +
        '<th class="r">Multiple</th><th class="r">Implied value</th></tr></thead><tbody>';
      rows.forEach(function (r) {
        html += '<tr data-slug="' + esc(r.slug) + '"><td class="rank">' + r.rank + '</td>' +
          '<td class="proto"><b>' + esc(r.name) + '</b>' + (r.watchlist ? '<span class="tag watch">Watchlist</span>' : '') +
          '<span class="sub">' + esc(r.slug) + '</span></td>' +
          '<td>' + esc(r.category || 'Uncategorised') + '</td>' +
          '<td class="r num">' + fmtUsd(r.tvl_usd) + '</td>' +
          '<td class="r num">' + fmtPct(r.change_7d) + '</td>' +
          '<td class="r num">' + fmtAge(r.age_days) + '</td>' +
          '<td class="r num">' + r.chains.length + '</td>' +
          '<td class="r num">' + fmtMult(r.multiple_used) + '</td>' +
          '<td class="r val"><span class="num">' + fmtUsd(r.implied_value_usd) + '</span>' +
          '<span class="bar"><i style="width:' + Math.max(1.5, (r.implied_value_usd / maxImplied) * 100).toFixed(1) + '%"></i></span></td></tr>';
      });
      html += '</tbody></table>';
    }
    html += liveSection() + footer();
    main.innerHTML = html;
    main.setAttribute('aria-busy', 'false');
    wireBoard(st);
  }
  function liveSection() {
    if (!D.live.length) return '';
    var html = '<section class="live"><h2>Already trading — set aside, and used as evidence</h2>' +
      '<p>These protocols record a token, so the radar does not rank them: no launch is coming. Their market caps over TVL are ' +
      'the multiples the board above is priced with. The largest ' + D.live.length + ' of ' + D.stats.tokenised + ' tokenised protocols:</p>' +
      '<table class="mini"><thead><tr><th>Protocol</th><th>Category</th><th class="r">TVL</th><th class="r">Market cap</th><th class="r">MCap / TVL</th></tr></thead><tbody>';
    D.live.forEach(function (r) {
      html += '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td class="r num">' + fmtUsd(r.tvl_usd) + '</td><td class="r num">' + fmtUsd(r.mcap_usd) + '</td>' +
        '<td class="r num">' + fmtMult(r.ratio) + '</td></tr>';
    });
    return html + '</tbody></table></section>';
  }
  function footer() {
    return '<footer>Source: ' + esc(D.source) + '. Implied values are this board\'s own model output, not a prediction ' +
      'that any protocol will issue a token. A protocol is described as recording no token because DefiLlama\'s record ' +
      'carries none; that record is not proof that none exists.</footer>';
  }
  function wireBoard(st) {
    function go(patch) {
      var next = Object.assign({}, st, patch);
      var url = boardUrl(next);
      if (url === boardHash) { renderBoard(next); return; }
      boardHash = url;
      window.history.replaceState(null, '', url);
      renderBoard(next);
    }
    var q = document.getElementById('f-q');
    q.addEventListener('input', function () { go({ q: q.value }); var el = document.getElementById('f-q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
    document.getElementById('f-cat').addEventListener('change', function (e) { go({ cat: e.target.value }); });
    document.getElementById('f-chain').addEventListener('change', function (e) { go({ chain: e.target.value }); });
    document.getElementById('f-watch').addEventListener('change', function (e) { go({ watch: e.target.checked }); });
    document.getElementById('f-sort').addEventListener('change', function (e) { go({ sort: e.target.value }); });
    document.getElementById('f-dir').addEventListener('click', function () { go({ dir: st.dir === 'asc' ? 'desc' : 'asc' }); });
    Array.prototype.forEach.call(main.querySelectorAll('tr[data-slug]'), function (tr) {
      tr.addEventListener('click', function () { window.location.hash = '#/p/' + encodeURIComponent(tr.getAttribute('data-slug')); });
    });
  }

  // ---- detail view: one protocol, its numbers, how its value is derived, and its farm plan ----
  function renderDetail(slug) {
    var r = bySlug[slug];
    if (!r) { renderBoard(parseHash()); return; }
    var multNote = r.category_n >= 3
      ? 'median of ' + r.category_n + ' tokenised ' + esc(r.category || 'Uncategorised') + ' protocols: ' + fmtMult(r.category_median) + ', shrunk toward the global median and capped'
      : 'only ' + r.category_n + ' tokenised ' + esc(r.category || 'Uncategorised') + ' in the snapshot, too thin to price alone, so the global median ' + fmtMult(D.multiples.global_median) + ' applies';
    var html = masthead() +
      '<a class="back" href="' + esc(boardHash) + '">&larr; Back to the board</a>' +
      '<div class="detail"><div class="detail-head"><h2 class="name">' + esc(r.name) + '</h2>' +
      (r.watchlist ? '<span class="tag watch">Watchlist</span>' : '') +
      '<span class="rankline">rank #' + r.rank + ' of ' + D.rows.length + '</span></div>' +
      '<div class="cards">' +
      '<div class="card"><b>' + fmtUsd(r.implied_value_usd) + '</b><span>implied launch value</span></div>' +
      '<div class="card"><b>' + fmtUsd(r.tvl_usd) + '</b><span>TVL</span></div>' +
      '<div class="card"><b>' + (r.change_7d == null ? 'n/a' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</b><span>TVL change, 7d</span></div>' +
      '<div class="card"><b>' + fmtAge(r.age_days) + '</b><span>run with no token</span></div>' +
      '<div class="card"><b>' + r.chains.length + '</b><span>chains</span></div>' +
      '<div class="card"><b>' + esc(r.category || 'Uncategorised') + '</b><span>category</span></div>' +
      '</div>' +
      '<section class="panel"><h2>How this value is derived</h2>' +
      '<table class="derive">' +
      '<tr><td>Total value locked</td><td class="r">' + fmtUsd(r.tvl_usd) + '</td></tr>' +
      '<tr><td>Category multiple (' + multNote + ')</td><td class="r">x ' + r.multiple_used.toFixed(3) + '</td></tr>' +
      '<tr><td>Growth factor (7d TVL change ' + (r.change_7d == null ? 'unreported, neutral' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + ')</td><td class="r">x ' + r.growth_factor.toFixed(3) + '</td></tr>' +
      '<tr><td>Tokenless-age factor (' + (r.age_days == null ? 'listing date unreported, neutral' : r.age_days + ' days with no token') + ')</td><td class="r">x ' + r.age_factor.toFixed(3) + '</td></tr>' +
      '<tr><td>Breadth factor (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ': ' + esc(r.chains.join(', ')) + ')</td><td class="r">x ' + r.breadth_factor.toFixed(3) + '</td></tr>' +
      '<tr class="total"><td>Implied launch value</td><td class="r">' + fmtUsd(r.implied_value_usd) + '</td></tr>' +
      '</table></section>' +
      '<section class="panel"><h2>Farm plan</h2><ol class="steps">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol></section></div>' + footer();
    main.innerHTML = html;
    main.setAttribute('aria-busy', 'false');
    window.scrollTo(0, 0);
  }

  function render() {
    var st = parseHash();
    if (st.view === 'detail') renderDetail(st.slug);
    else renderBoard(st);
  }
  window.addEventListener('hashchange', render);
  render();
})();
