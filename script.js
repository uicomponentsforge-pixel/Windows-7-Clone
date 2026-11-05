/* Windows 7 desktop - script.js */
(function () {
  'use strict';

  /* ---------- helpers & storage ---------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function load(k, d) { try { var v = localStorage.getItem('w7.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem('w7.' + k, JSON.stringify(v)); } catch (e) {} }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------- wallpapers ---------- */
  var WALLS = [
    'radial-gradient(ellipse at 70% 30%,#7fd0ff 0,#2a78c8 35%,#0b3166 80%)',
    'linear-gradient(135deg,#0f2027,#2c5364)',
    'radial-gradient(circle at 30% 70%,#9be15d,#1b7a4a 55%,#06301f)',
    'linear-gradient(160deg,#ff9966,#c0392b 60%,#3b0f2a)'
  ];
  var wallIdx = load('wall', 0);
  function applyWall() { $('#desktop').style.backgroundImage = WALLS[wallIdx % WALLS.length]; }
  function setWall(i) { wallIdx = i; save('wall', wallIdx); applyWall(); }
  function nextWall() { setWall((wallIdx + 1) % WALLS.length); }

  /* ---------- settings & color themes ---------- */
  var THEMES = [
    { name: 'Sky', glass: 'rgba(110,160,210,.72)', dark: 'rgba(20,40,70,.85)', tb1: 'rgba(150,190,235,.85)', tb2: 'rgba(40,80,130,.92)' },
    { name: 'Graphite', glass: 'rgba(150,155,165,.75)', dark: 'rgba(30,32,38,.88)', tb1: 'rgba(150,155,165,.85)', tb2: 'rgba(40,42,48,.94)' },
    { name: 'Rose', glass: 'rgba(215,140,165,.72)', dark: 'rgba(70,25,45,.86)', tb1: 'rgba(235,170,195,.85)', tb2: 'rgba(130,45,80,.92)' },
    { name: 'Forest', glass: 'rgba(120,185,140,.72)', dark: 'rgba(20,55,35,.86)', tb1: 'rgba(160,215,175,.85)', tb2: 'rgba(35,95,60,.92)' }
  ];
  var cfg = load('cfg', { theme: 0, clock24: false, small: false });
  function saveCfg() { save('cfg', cfg); }
  function applyTheme() {
    var t = THEMES[cfg.theme] || THEMES[0], r = document.documentElement.style;
    r.setProperty('--glass', t.glass); r.setProperty('--glass-dark', t.dark);
    r.setProperty('--tb1', t.tb1); r.setProperty('--tb2', t.tb2);
    $('#desktop').classList.toggle('small', !!cfg.small);
  }

  /* ---------- virtual C: drive (kept in localStorage) ---------- */
  var vfs = load('vfs', null) || { kids: {
    Documents: { kids: { 'Welcome.txt': { text: 'This file lives on the virtual C: drive, which is stored inside this browser.\nEdit it in Notepad and press Save.' } } },
    Desktop: { kids: {} }, Downloads: { kids: {} }, Pictures: { kids: {} }
  } };
  var vReady = false, vDirty = false, persistT = 0, gcTries = 0;
  function vsave() {
    vDirty = true;
    if (window.indexedDB) { clearTimeout(persistT); persistT = setTimeout(persistVfs, 300); }
    else { try { localStorage.setItem('w7.vfs', JSON.stringify(vfs)); vDirty = false; } catch (e) { return false; } }
    try { renderDesk(); } catch (e) {} try { fsRefresh(); } catch (e) {} try { scheduleGC(); } catch (e) {} return true;
  }
  function persistVfs() {
    if (!vReady || !window.indexedDB) return;
    idbPut('__vfs', JSON.stringify(vfs)).then(function () { vDirty = false; try { localStorage.removeItem('w7.vfs'); } catch (e) {} },
      function () { toast('The browser could not save your files because its storage is full.'); });
  }
  function bootVfs() {
    if (!window.indexedDB) { vReady = true; return; }
    idbGet('__vfs').then(function (s) {
      var v = null; try { v = s ? JSON.parse(s) : null; } catch (e) {}
      if (v && v.kids) vfs = v;
      vReady = true;
      if (!v || vDirty) persistVfs();
      try { renderDesk(); fsRefresh(); } catch (e) {}
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    }, function () { vReady = true; });
  }
  window.addEventListener('beforeunload', function () { if (vDirty) persistVfs(); });
  function vget(parts) { var n = vfs; parts.forEach(function (k) { n = n.kids[k]; }); return n; }
  function vsaveFn(node, field) {
    return function (v) {
      var old = node[field]; node[field] = v;
      if (vsave()) return Promise.resolve();
      node[field] = old; return Promise.reject(new Error('Not enough browser storage space.'));
    };
  }
  function askPath(def) {
    var s = prompt('Save as (missing folders are created):', def); if (s === null) return null;
    var parts = s.replace(/^[a-zA-Z]:/, '').split(/[\\\/]+/).filter(Boolean);
    if (!parts.length || parts.some(function (p) { return /[:*?"<>|]/.test(p); })) { alert('That path is not valid.'); return null; }
    return parts;
  }
  function vwrite(parts, content, field) { /* returns '' on success, otherwise a message */
    var n = vfs, name = parts[parts.length - 1], i;
    for (i = 0; i < parts.length - 1; i++) {
      if (!n.kids[parts[i]]) n.kids[parts[i]] = { kids: {} };
      n = n.kids[parts[i]]; if (!n.kids) return 'A file is in the way: ' + parts[i];
    }
    var ex = n.kids[name], f = {};
    if (ex && ex.kids) return 'A folder with that name already exists.';
    if (ex && !confirm('Replace "' + name + '"?')) return 'cancelled';
    f[field] = content; n.kids[name] = f;
    if (vsave()) return '';
    if (ex) n.kids[name] = ex; else delete n.kids[name];
    return 'Not enough browser storage space.';
  }

  /* ---------- window manager ---------- */
  var wins = [], zTop = 10, uid = 0, active = null;

  function openApp(id, opts) {
    var app = APPS[id]; if (!app) return;
    var w = createWindow(app);
    app.build(w.body, w, opts);
  }

  function createWindow(app) {
    var n = wins.length;
    var e = el('div', 'win');
    e.style.left = (60 + (n % 8) * 28) + 'px';
    e.style.top = (40 + (n % 8) * 28) + 'px';
    e.style.width = (app.w || 420) + 'px';
    e.style.height = (app.h || 320) + 'px';
    e.innerHTML = '<div class="titlebar"><span>' + app.icon + '</span><span class="t">' + app.title + '</span>' +
      '<div class="wbtns"><button class="mn" title="Minimize">&#8211;</button><button class="mx" title="Maximize">&#9633;</button><button class="x" title="Close">&#10005;</button></div></div>' +
      '<div class="body"></div><div class="grip"></div>';
    var btn = el('button', 'task', app.icon + ' ' + app.title);
    var w = { id: ++uid, el: e, btn: btn, body: $('.body', e), app: app, min: false, saved: null };
    $('#windows').appendChild(e);
    $('#tasks').appendChild(btn);
    wins.push(w);

    e.addEventListener('mousedown', function () { focus(w); });
    btn.addEventListener('click', function () {
      if (w.min) { restore(w); } else if (active === w) { minimize(w); } else { focus(w); }
    });
    $('.mn', e).onclick = function () { minimize(w); };
    $('.mx', e).onclick = function () { toggleMax(w); };
    $('.x', e).onclick = function () { closeWin(w); };
    $('.titlebar', e).addEventListener('dblclick', function (ev) { if (ev.target.tagName !== 'BUTTON') toggleMax(w); });
    dragSetup(w); resizeSetup(w);
    focus(w);
    return w;
  }

  function focus(w) {
    if (w.min) { w.min = false; w.el.classList.remove('hide'); }
    w.el.style.zIndex = ++zTop;
    active = w;
    wins.forEach(function (o) {
      o.el.classList.toggle('active', o === w);
      o.btn.classList.toggle('active', o === w);
      o.btn.classList.toggle('min', o.min);
    });
  }
  function minimize(w) {
    w.min = true; w.el.classList.add('hide');
    if (active === w) active = null;
    wins.forEach(function (o) { o.btn.classList.remove('active'); o.btn.classList.toggle('min', o.min); });
  }
  function restore(w) { focus(w); }
  function toggleMax(w) { w.el.classList.toggle('max'); focus(w); }
  function closeWin(w) {
    w.el.remove(); w.btn.remove();
    wins.splice(wins.indexOf(w), 1);
    if (active === w) { active = null; var top = wins.filter(function (o) { return !o.min; }).pop(); if (top) focus(top); }
  }

  function dragSetup(w) {
    var bar = $('.titlebar', w.el);
    bar.addEventListener('mousedown', function (ev) {
      if (ev.target.tagName === 'BUTTON' || w.el.classList.contains('max')) return;
      var dx = ev.clientX - w.el.offsetLeft, dy = ev.clientY - w.el.offsetTop;
      function mv(e) {
        w.el.style.left = Math.max(-200, e.clientX - dx) + 'px';
        w.el.style.top = Math.max(0, e.clientY - dy) + 'px';
      }
      function up() { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); }
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
      ev.preventDefault();
    });
  }
  function resizeSetup(w) {
    $('.grip', w.el).addEventListener('mousedown', function (ev) {
      var sx = ev.clientX, sy = ev.clientY, sw = w.el.offsetWidth, sh = w.el.offsetHeight;
      function mv(e) {
        w.el.style.width = Math.max(240, sw + e.clientX - sx) + 'px';
        w.el.style.height = Math.max(140, sh + e.clientY - sy) + 'px';
      }
      function up() { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); }
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
      ev.preventDefault(); ev.stopPropagation();
    });
  }

  function showDesktop() {
    var anyVisible = wins.some(function (w) { return !w.min; });
    wins.forEach(function (w) { if (anyVisible) { w.min = true; w.el.classList.add('hide'); } else { w.min = false; w.el.classList.remove('hide'); } w.btn.classList.toggle('min', w.min); });
    if (!anyVisible && wins.length) focus(wins[wins.length - 1]);
  }

  /* ---------- applications ---------- */
  var APPS = {
    notepad: {
      title: 'Notepad', icon: '\uD83D\uDCDD', w: 460, h: 340,
      build: function (body, self, opts) {
        var file = opts || null, suggest = 'Untitled.txt';
        var bar = el('div', 'bar'), ta = el('textarea', 'np'), msg = el('span', '', '');
        ta.value = file ? file.text : ''; ta.spellcheck = false;
        msg.style.cssText = 'margin-left:auto;color:#345;align-self:center';
        var bSave = el('button', '', 'Save'), bAs = el('button', '', 'Save as...'), bImp = el('button', '', 'Import file...');
        var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.txt,text/plain'; inp.hidden = true;
        function title(n) { $('.t', self.el).textContent = 'Notepad - ' + n; self.btn.textContent = APPS.notepad.icon + ' ' + n; }
        if (file) title(file.name);
        function saveAs() {
          var parts = askPath('C:\\Documents\\' + (file ? file.name : suggest)); if (!parts) return;
          var err = vwrite(parts, ta.value, 'text');
          if (err) { if (err !== 'cancelled') msg.textContent = err; return; }
          var name = parts[parts.length - 1];
          file = { name: name, text: ta.value, save: vsaveFn(vget(parts), 'text') };
          title(name); msg.textContent = 'Saved to C:\\' + parts.join('\\');
        }
        bSave.onclick = function () {
          if (!file) { saveAs(); return; }
          file.save(ta.value).then(function () { msg.textContent = 'Saved ' + file.name; })
            .catch(function (e) { msg.textContent = 'Save failed: ' + e.message; });
        };
        bAs.onclick = saveAs;
        bImp.onclick = function () { inp.click(); };
        inp.onchange = function () {
          var f = inp.files[0]; if (!f) return;
          var r = new FileReader();
          r.onload = function () { ta.value = r.result; file = null; suggest = f.name; title(f.name); msg.textContent = 'Imported. Use Save to keep it on C:'; };
          r.readAsText(f);
        };
        bar.append(bSave, bAs, bImp, msg, inp); body.append(bar, ta);
      }
    },
    calc: {
      title: 'Calculator', icon: '\uD83D\uDDA9', w: 260, h: 360,
      build: function (body) {
        var wrap = el('div', 'calc'), disp = el('div', 'disp', '0'), keys = el('div', 'keys');
        var cur = '0', acc = null, op = null, fresh = true;
        function show() { disp.textContent = cur; }
        function calc(a, b, o) { return o === '+' ? a + b : o === '-' ? a - b : o === '*' ? a * b : o === '/' ? (b === 0 ? NaN : a / b) : b; }
        function fmt(n) { return isFinite(n) ? String(parseFloat(n.toPrecision(12))) : 'Error'; }
        function press(k) {
          if (/\d/.test(k)) { cur = (fresh || cur === '0') ? k : cur + k; fresh = false; }
          else if (k === '.') { if (fresh) { cur = '0.'; fresh = false; } else if (cur.indexOf('.') < 0) cur += '.'; }
          else if (k === 'C') { cur = '0'; acc = null; op = null; fresh = true; }
          else if (k === '\u00B1') { cur = fmt(-parseFloat(cur)); }
          else if (k === '\u2190') { cur = cur.length > 1 ? cur.slice(0, -1) : '0'; }
          else { // operator or =
            var v = parseFloat(cur);
            if (op && !fresh) { v = calc(acc, v, op); cur = fmt(v); }
            acc = v; fresh = true; op = (k === '=') ? null : k;
          }
          show();
        }
        ['C', '\u2190', '\u00B1', '/', '7', '8', '9', '*', '4', '5', '6', '-', '1', '2', '3', '+', '0', '.', '=', ''].forEach(function (k) {
          if (!k) { keys.appendChild(el('span')); return; }
          var b = el('button', '', k === '*' ? '\u00D7' : k === '/' ? '\u00F7' : k); b.onclick = function () { press(k); }; keys.appendChild(b);
        });
        wrap.append(disp, keys); body.appendChild(wrap);
      }
    }
  };

  APPS.taskmgr = {
    title: 'Task Manager', icon: '\uD83D\uDCCA', w: 460, h: 320,
    build: function (body, self) {
      var box = el('div', 'tm'), foot = el('div', 'bar'), last = '', t;
      body.append(box, foot);
      function draw() {
        if (!self.el.isConnected) { clearInterval(t); return; }
        var sig = wins.map(function (w) { return w.id + (w.min ? 'm' : 'r'); }).join();
        if (sig === last) return;
        last = sig; box.innerHTML = '';
        var tbl = el('table', '', '<tr><th>Application</th><th>Status</th><th></th></tr>');
        wins.forEach(function (w) {
          var tr = el('tr', '', '<td>' + w.app.icon + ' ' + w.app.title + '</td><td>' + (w.min ? 'Minimized' : 'Running') + '</td>');
          var td = el('td'), s = el('button', '', 'Switch to'), x = el('button', '', 'End task');
          s.onclick = function () { focus(w); };
          x.onclick = function () { closeWin(w); };
          td.append(s, x); tr.appendChild(td); tbl.appendChild(tr);
        });
        box.appendChild(tbl);
        foot.textContent = 'Applications: ' + wins.length + ' (windows of this desktop only, not your real computer)';
      }
      t = setInterval(draw, 700); draw();
    }
  };

  APPS.control = {
    title: 'Control Panel', icon: '\u2699\uFE0F', w: 420, h: 340,
    build: function (body) {
      var p = el('div', 'cp', '<h3>Adjust your computer\'s settings</h3>');
      [['\uD83C\uDFA8', 'Personalization', 'Change the wallpaper and window colors', 'personalize'],
       ['\uD83D\uDCCA', 'Task Manager', 'See and close open applications', 'taskmgr']].forEach(function (it) {
        var b = el('button', 'cp-item', '<span>' + it[0] + '</span><div><b>' + it[1] + '</b><br>' + it[2] + '</div>');
        b.onclick = function () { openApp(it[3]); }; p.appendChild(b);
      });
      function check(label, key) {
        var l = el('label', 'cp-row'), c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!cfg[key];
        c.onchange = function () { cfg[key] = c.checked; saveCfg(); applyTheme(); tick(); };
        l.append(c, document.createTextNode(' ' + label)); p.appendChild(l);
      }
      check('Use 24-hour clock', 'clock24');
      check('Small desktop icons', 'small');
      var r = el('button', 'cp-reset', 'Reset all settings and saved data');
      r.onclick = function () {
        if (!confirm('This clears your wallpaper, colors and everything saved on the virtual C: drive, then reloads. Continue?')) return;
        var ks = [], i; for (i = 0; i < localStorage.length; i++) { if (localStorage.key(i).indexOf('w7.') === 0) ks.push(localStorage.key(i)); }
        ks.forEach(function (k) { localStorage.removeItem(k); }); try { indexedDB.deleteDatabase('w7files'); } catch (e) {} location.reload();
      };
      p.appendChild(r); body.appendChild(p);
    }
  };

  APPS.personalize = {
    title: 'Personalization', icon: '\uD83C\uDFA8', w: 460, h: 360,
    build: function (body) {
      var p = el('div', 'cp');
      function draw() {
        p.innerHTML = '<h3>Change the visuals on your computer</h3><b>Desktop background</b>';
        var g = el('div', 'thumbs');
        WALLS.forEach(function (bg, i) {
          var t = el('div', 'thumb' + (i === wallIdx ? ' on' : '')); t.style.backgroundImage = bg;
          t.onclick = function () { setWall(i); draw(); }; g.appendChild(t);
        });
        p.appendChild(g); p.appendChild(el('b', '', 'Window color'));
        var s = el('div', 'swatches');
        THEMES.forEach(function (th, i) {
          var b = el('button', 'sw' + (i === cfg.theme ? ' on' : ''), th.name);
          b.style.background = 'linear-gradient(' + th.tb1 + ',' + th.tb2 + ')';
          b.onclick = function () { cfg.theme = i; saveCfg(); applyTheme(); draw(); }; s.appendChild(b);
        });
        p.appendChild(s);
      }
      body.appendChild(p); draw();
    }
  };

  /* ---------- Paint ---------- */
  APPS.paint = {
    title: 'Paint', icon: '\uD83D\uDD8C\uFE0F', w: 700, h: 520,
    build: function (body, self, opts) {
      var file = opts || null, tool = 'Brush', color = '#000000', size = 4, W = 640, H = 400;
      var bar = el('div', 'bar'), wrap = el('div', 'paintwrap'), cv = document.createElement('canvas');
      cv.width = W; cv.height = H; cv.className = 'paintcv';
      var g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.lineCap = 'round'; g.lineJoin = 'round';
      var toolBtns = {};
      ['Brush', 'Eraser', 'Line', 'Rectangle'].forEach(function (t) {
        var b = el('button', t === tool ? 'on' : '', t);
        b.onclick = function () { tool = t; Object.keys(toolBtns).forEach(function (k) { toolBtns[k].classList.toggle('on', k === t); }); };
        toolBtns[t] = b; bar.appendChild(b);
      });
      var sz = document.createElement('select');
      [2, 4, 8, 14, 24].forEach(function (n) { var o = document.createElement('option'); o.value = n; o.textContent = n + ' px'; if (n === size) o.selected = true; sz.appendChild(o); });
      sz.onchange = function () { size = +sz.value; };
      var pick = document.createElement('input'); pick.type = 'color'; pick.value = color;
      pick.oninput = function () { color = pick.value; };
      bar.append(sz, pick);
      ['#000000', '#7f7f7f', '#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#2980b9', '#8e44ad', '#ffffff'].forEach(function (c) {
        var s = el('button', 'swc'); s.style.background = c; s.title = c;
        s.onclick = function () { color = c; pick.value = c; }; bar.appendChild(s);
      });
      var clr = el('button', '', 'Clear'), sv = el('button', '', 'Save'), sa = el('button', '', 'Save as...'), msg = el('span', '', '');
      msg.style.cssText = 'margin-left:auto;color:#345';
      clr.onclick = function () { g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); };
      function title(n) { $('.t', self.el).textContent = 'Paint - ' + n; self.btn.textContent = APPS.paint.icon + ' ' + n; }
      function saveAs() {
        var parts = askPath('C:\\Pictures\\' + (file ? file.name : 'Untitled.png')); if (!parts) return;
        var url = cv.toDataURL('image/png'), err = vwrite(parts, url, 'data');
        if (err) { if (err !== 'cancelled') msg.textContent = err; return; }
        var name = parts[parts.length - 1];
        file = { name: name, save: vsaveFn(vget(parts), 'data') }; title(name); msg.textContent = 'Saved to C:\\' + parts.join('\\');
      }
      sv.onclick = function () {
        if (!file) { saveAs(); return; }
        file.save(cv.toDataURL('image/png')).then(function () { msg.textContent = 'Saved ' + file.name; })
          .catch(function (e) { msg.textContent = 'Save failed: ' + e.message; });
      };
      sa.onclick = saveAs;
      if (file) { title(file.name); var im = new Image(); im.onload = function () { var s = Math.min(1, W / im.width, H / im.height); g.drawImage(im, 0, 0, im.width * s, im.height * s); }; im.src = file.data; }
      bar.append(clr, sv, sa, msg);
      function pos(e) { var r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; }
      function style() { g.strokeStyle = tool === 'Eraser' ? '#fff' : color; g.lineWidth = tool === 'Eraser' ? size * 3 : size; }
      cv.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        var s = pos(e), snap = (tool === 'Line' || tool === 'Rectangle') ? g.getImageData(0, 0, W, H) : null;
        style();
        if (!snap) { g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x + 0.01, s.y); g.stroke(); g.beginPath(); g.moveTo(s.x, s.y); }
        function mv(ev) {
          var p = pos(ev);
          if (snap) {
            g.putImageData(snap, 0, 0); style(); g.beginPath();
            if (tool === 'Line') { g.moveTo(s.x, s.y); g.lineTo(p.x, p.y); } else { g.rect(s.x, s.y, p.x - s.x, p.y - s.y); }
            g.stroke();
          } else { g.lineTo(p.x, p.y); g.stroke(); g.beginPath(); g.moveTo(p.x, p.y); }
        }
        function up() { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); }
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
        e.preventDefault();
      });
      wrap.appendChild(cv); body.append(bar, wrap);
    }
  };

  /* ---------- Games ---------- */
  APPS.snake = {
    title: 'Snake', icon: '\uD83D\uDC0D', w: 340, h: 420,
    build: function (body, self) {
      var N = 20, S = 15, cv = document.createElement('canvas'), g, snake, dir, nd, food, score, over, t;
      cv.width = cv.height = N * S; cv.className = 'snakecv'; g = cv.getContext('2d');
      var best = load('snakeBest', 0), bar = el('div', 'bar'), info = el('span', '', ''), nb = el('button', '', 'New game');
      info.style.marginLeft = 'auto'; bar.append(nb, info);
      body.append(bar, cv, el('div', 'hint', 'Arrow keys or WASD. The game pauses while this window is not in front.'));
      function rnd(n) { return Math.floor(Math.random() * n); }
      function place() { do { food = { x: rnd(N), y: rnd(N) }; } while (snake.some(function (s) { return s.x === food.x && s.y === food.y; })); }
      function reset() { snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }]; dir = nd = { x: 1, y: 0 }; score = 0; over = false; place(); draw(); }
      function draw() {
        g.fillStyle = '#10243a'; g.fillRect(0, 0, N * S, N * S);
        g.fillStyle = '#e74c3c'; g.fillRect(food.x * S + 1, food.y * S + 1, S - 2, S - 2);
        snake.forEach(function (s, i) { g.fillStyle = i ? '#4cd964' : '#a8f5a2'; g.fillRect(s.x * S + 1, s.y * S + 1, S - 2, S - 2); });
        info.textContent = (over ? 'Game over. ' : '') + 'Score ' + score + '  Best ' + best;
      }
      function step() {
        if (!self.el.isConnected) { clearInterval(t); document.removeEventListener('keydown', key); return; }
        if (self.min || over || active !== self) return;
        dir = nd; var h = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
        if (h.x < 0 || h.y < 0 || h.x >= N || h.y >= N || snake.some(function (s) { return s.x === h.x && s.y === h.y; })) {
          over = true; beep(160, 0.3); if (score > best) { best = score; save('snakeBest', best); } draw(); return;
        }
        snake.unshift(h);
        if (h.x === food.x && h.y === food.y) { score++; place(); beep(660, 0.06); } else { snake.pop(); }
        draw();
      }
      function key(e) {
        if (active !== self) return;
        var m = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] }[e.key];
        if (!m || e.altKey) return;
        e.preventDefault();
        if (m[0] !== -dir.x || m[1] !== -dir.y) nd = { x: m[0], y: m[1] };
      }
      nb.onclick = reset; document.addEventListener('keydown', key);
      t = setInterval(step, 120); reset();
    }
  };

  APPS.mines = {
    title: 'Minesweeper', icon: '\uD83D\uDCA3', w: 300, h: 380,
    build: function (body) {
      var R = 9, C = 9, M = 10, cells, over, started, shown, flags;
      var bar = el('div', 'bar'), face = el('button', '', 'New game'), info = el('span', '', ''), grid = el('div', 'mine-grid');
      info.style.marginLeft = 'auto'; bar.append(face, info); body.append(bar, grid);
      var COL = ['', '#0000ff', '#007b00', '#ff0000', '#00007b', '#7b0000', '#007b7b', '#000', '#555'];
      function nb(i) { var r = Math.floor(i / C), c = i % C, o = []; for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) { var y = r + a, x = c + b; if ((a || b) && y >= 0 && x >= 0 && y < R && x < C) o.push(y * C + x); } return o; }
      function paint(i) {
        var c = cells[i], b = c.b;
        b.className = c.r ? 'r' : ''; b.style.color = COL[c.n] || '#000';
        b.textContent = c.r ? (c.m ? '\uD83D\uDCA3' : (c.n || '')) : (c.f ? '\uD83D\uDEA9' : '');
        if (c.r && c.m && c.boom) b.classList.add('boom');
      }
      function status(msg) { info.textContent = msg || ('Mines left: ' + (M - flags)); }
      function lose(i) { over = true; cells[i].boom = true; cells.forEach(function (c, k) { if (c.m) { c.r = true; } paint(k); }); status('You hit a mine.'); }
      function reveal(i) {
        var st = [i];
        while (st.length) {
          var k = st.pop(), c = cells[k]; if (c.r || c.f) continue;
          c.r = true; shown++; paint(k);
          if (!c.n) nb(k).forEach(function (q) { st.push(q); });
        }
      }
      function start(first) {
        var placed = 0; while (placed < M) { var k = Math.floor(Math.random() * R * C); if (k !== first && !cells[k].m) { cells[k].m = true; placed++; } }
        cells.forEach(function (c, k) { c.n = nb(k).filter(function (q) { return cells[q].m; }).length; });
        started = true;
      }
      function click(i) {
        if (over || cells[i].r || cells[i].f) return;
        if (!started) start(i);
        if (cells[i].m) { lose(i); return; }
        reveal(i);
        if (shown === R * C - M) { over = true; status('You win!'); }
      }
      function flag(i) {
        if (over || cells[i].r) return;
        cells[i].f = !cells[i].f; flags += cells[i].f ? 1 : -1; paint(i); status();
      }
      function reset() {
        grid.innerHTML = ''; cells = []; over = false; started = false; shown = 0; flags = 0;
        for (var i = 0; i < R * C; i++) {
          (function (i) {
            var b = document.createElement('button');
            b.onclick = function () { click(i); };
            b.oncontextmenu = function (e) { e.preventDefault(); flag(i); };
            cells.push({ m: false, r: false, f: false, n: 0, b: b }); grid.appendChild(b);
          })(i);
        }
        status();
      }
      face.onclick = reset; reset();
    }
  };

  /* ---------- Computer & File Explorer ---------- */
  APPS.computer = {
    title: 'Computer', icon: '\uD83D\uDDA5\uFE0F', w: 480, h: 340,
    build: function (body) {
      var p = el('div', 'cp', '<h3>Hard Disk Drives</h3>');
      var used = 0; eachNode(function (c) { used += c.file ? (c.size || 0) : (c.text || c.data || '').length; });
      var d = el('button', 'cp-item drive', '<span>\uD83D\uDCBD</span><div><b>Local Disk (C:)</b><br><span class="cap"></span></div>');
      d.querySelector('.cap').textContent = fmtSize(used) + ' used';
      d.onclick = function () { openApp('explorer'); };
      p.appendChild(d);
      p.appendChild(el('h3', '', 'Other locations'));
      var note = el('div', 'hint', 'A web page cannot list your real drives. Pick a folder and the browser asks you for permission.');
      var r = el('button', 'cp-item', '<span>\uD83D\uDCC2</span><div><b>Open a folder on this computer...</b><br>Browse it in File Explorer and edit text files</div>');
      r.onclick = function () {
        if (!window.showDirectoryPicker) { note.textContent = 'This browser cannot open real folders. Chrome 86 or later can.'; return; }
        window.showDirectoryPicker({ mode: 'readwrite' }).then(function (h) { openApp('explorer', { handle: h }); }).catch(function () {});
      };
      var im = el('button', 'cp-item', '<span>\uD83D\uDCE5</span><div><b>Import files to the Desktop...</b><br>Copy files of any type from this computer onto the desktop</div>');
      var imsg = el('div', 'hint'); im.onclick = function () { pickFiles(['Desktop'], function (m) { imsg.textContent = m + ' They are on the desktop and in C:\\Desktop.'; }); };
      p.append(r, note, im, imsg); body.appendChild(p);
    }
  };

  APPS.explorer = {
    title: 'File Explorer', icon: '\uD83D\uDCC1', w: 580, h: 400,
    build: function (body, self, opts) {
      var real = (opts && opts.handle) ? [opts.handle] : null, path = (opts && opts.path && vfind(opts.path) && vfind(opts.path).kids) ? opts.path.slice() : [], sel = null;
      var bar = el('div', 'bar'), addr = el('span', 'addr'), list = el('div', 'xl'), st = el('div', 'bar');
      function pick(d, en) { var o = list.querySelector('.sel'); if (o) o.classList.remove('sel'); d.classList.add('sel'); sel = en; }
      var bRen, bDel, bNewF, bNewT;
      function dirNode() { var n = vfs; path.forEach(function (k) { n = n.kids[k]; }); return n; }
      function entries() {
        if (!real) { var k = dirNode().kids; return Promise.resolve(Object.keys(k).map(function (n) { return { name: n, dir: !!k[n].kids, img: !!k[n].data, node: k[n] }; })); }
        var out = [], it = real[real.length - 1].values();
        function step() {
          return it.next().then(function (r) {
            if (r.done) return out;
            out.push({ name: r.value.name, dir: r.value.kind === 'directory', h: r.value }); return step();
          });
        }
        return step();
      }
      function render() {
        sel = null; list.innerHTML = '';
        addr.textContent = real ? real.map(function (h) { return h.name; }).join(' \\ ') : 'C:\\' + path.join('\\');
        entries().then(function (es) {
          es.sort(function (a, b) { return (b.dir - a.dir) || a.name.localeCompare(b.name); });
          es.forEach(function (en) {
            var d = el('div', 'xi'), ic = el('span', '', iconFor(en.name, en.node, en.dir));
            d.append(ic, document.createTextNode(en.name)); if (en.node && en.node.size) d.title = en.name + ' (' + fmtSize(en.node.size) + ')';
            d.onclick = function () { pick(d, en); };
            d.oncontextmenu = function (e) {
              e.stopPropagation(); pick(d, en);
              if (real) { menu(e, [['Open', function () { open(en); }]]); return; }
              var node = dirNode().kids[en.name], items = [['Open', function () { open(en); }]];
              if (node.data) items.push(['Edit with Paint', function () { editInPaint(en.name, node); }]);
              if (!en.dir) items.push(['Save a copy to this computer', function () { exportNode(en.name, node); }]);
              items.push('-', ['Cut', function () { fsCopy(path.concat(en.name), true); }], ['Copy', function () { fsCopy(path.concat(en.name), false); }]);
              if (en.dir) items.push(['Paste', function () { fsPaste(path.concat(en.name)); }, !fileClip]);
              items.push('-', ['Rename', function () { bRen.onclick(); }], ['Delete', function () { bDel.onclick(); }]);
              menu(e, items);
            };
            d.ondblclick = function () { open(en); };
            list.appendChild(d);
          });
          if (!es.length) list.appendChild(el('div', 'empty', 'This folder is empty.'));
          st.textContent = es.length + ' item' + (es.length === 1 ? '' : 's');
        }).catch(function (e) { st.textContent = 'Could not read this folder: ' + e.message; });
      }
      function open(en) {
        if (en.dir) { if (real) real.push(en.h); else path.push(en.name); render(); return; }
        if (!real) {
          var f = dirNode().kids[en.name];
          openFileNode(en.name, f, dirNode().kids);
        } else if (/\.(txt|md|json|js|css|html?|csv|log|xml|ini)$/i.test(en.name)) {
          en.h.getFile().then(function (f) { return f.text(); }).then(function (t) {
            openApp('notepad', { name: en.name, text: t, save: function (x) {
              return en.h.createWritable().then(function (w) { return w.write(x).then(function () { return w.close(); }); });
            } });
          }).catch(function (e) { st.textContent = 'Could not open file: ' + e.message; });
        } else { st.textContent = 'Only text files can be opened here.'; }
      }
      function btn(label, fn) { var b = el('button', '', label); b.onclick = fn; bar.appendChild(b); return b; }
      function name(ask, def) {
        var n = prompt(ask, def); if (n === null) return null; n = n.trim();
        if (!n || /[\\\/:*?"<>|]/.test(n)) { st.textContent = 'That name is not valid.'; return null; }
        if (dirNode().kids[n]) { st.textContent = 'That name already exists.'; return null; }
        return n;
      }
      btn('Refresh', render);
      btn('\u2191 Up', function () { if (real) { if (real.length > 1) real.pop(); } else path.pop(); render(); });
      if (!real) {
        bNewF = btn('New folder', function () { var n = name('Folder name:', 'New folder'); if (n) { dirNode().kids[n] = { kids: {} }; vsave(); render(); } });
        bNewT = btn('New text file', function () { var n = name('File name:', 'New Text Document.txt'); if (n) { dirNode().kids[n] = { text: '' }; vsave(); render(); } });
        bRen = btn('Rename', function () {
          if (!sel) { st.textContent = 'Select an item first.'; return; }
          var n = name('New name:', sel.name); if (!n) return;
          var k = dirNode().kids; k[n] = k[sel.name]; delete k[sel.name]; vsave(); render();
        });
        bDel = btn('Delete', function () {
          if (!sel) { st.textContent = 'Select an item first.'; return; }
          if (confirm('Move "' + sel.name + '" to the Recycle Bin?')) { trashItem(dirNode().kids, sel.name); vsave(); render(); }
        });
        btn('Import files...', function () { pickFiles(path.slice(), render); });
      }
      if (!real) {
        list.oncontextmenu = function (e) {
          menu(e, [['Paste', function () { fsPaste(path.slice()); }, !fileClip], '-', ['New folder', function () { bNewF.onclick(); }], ['New text file', function () { bNewT.onclick(); }],
            ['Import files...', function () { pickFiles(path.slice(), render); }], ['Refresh', render]]);
        };
        fsWatch(function () { if (!self.el.isConnected) return false; render(); return true; });
        list.ondragover = function (e) { e.preventDefault(); };
        list.ondrop = function (e) {
          e.preventDefault(); e.stopPropagation();
          if (e.dataTransfer && e.dataTransfer.files.length) importFiles(e.dataTransfer.files, path.slice(), function (m) { st.textContent = m; render(); });
        };
      }
      bar.appendChild(addr); body.append(bar, list, st); render();
    }
  };

  /* ---------- Browser ---------- */
  APPS.browser = {
    title: 'Browser', icon: '\uD83C\uDF10', w: 760, h: 520,
    build: function (body, self) {
      var hist = ['about:home'], pos = 0;
      var LINKS = [['Wikipedia', 'https://en.wikipedia.org/'], ['MDN Web Docs', 'https://developer.mozilla.org/'], ['OpenStreetMap', 'https://www.openstreetmap.org/']];
      var HOME = '<body style="font:14px Segoe UI,Arial;padding:24px;background:#f4f8fd"><h2>Browser</h2><p>Type a web address above, or try:</p><ul>' +
        LINKS.map(function (l) { return '<li><a href="#" data-u="' + l[1] + '">' + l[0] + '</a></li>'; }).join('') +
        '</ul><p style="color:#567">Text that is not a web address searches Wikipedia. Some sites do not allow being shown inside another page; use Open in new tab for those.</p>' +
        '<script>(' + function () { document.addEventListener('click', function (e) { var u = e.target.getAttribute('data-u'); if (u) { parent.postMessage({ go: u }, '*'); e.preventDefault(); } }); } + ')()<\/script></body>';
      var bar = el('div', 'bar'), st = el('div', 'bar'), url = document.createElement('input'), fr = document.createElement('iframe');
      var back = el('button', '', '\u25C0'), fwd = el('button', '', '\u25B6'), rel = el('button', '', 'Reload'), home = el('button', '', 'Home'), go = el('button', '', 'Go'), tab = el('button', '', 'Open in new tab');
      url.type = 'text'; url.className = 'url'; url.placeholder = 'Type a web address or search'; back.title = 'Back'; fwd.title = 'Forward';
      fr.className = 'view'; fr.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
      function norm(s) {
        s = s.trim(); if (!s) return null;
        if (/^https?:\/\//i.test(s)) return s;
        if (/^[^\s]+\.[^\s]{2,}(\/.*)?$/.test(s) || /^localhost(:\d+)?(\/.*)?$/.test(s)) return 'https://' + s;
        return 'https://en.wikipedia.org/w/index.php?search=' + encodeURIComponent(s);
      }
      function show() {
        var u = hist[pos]; url.value = u === 'about:home' ? '' : u;
        if (u === 'about:home') { fr.removeAttribute('src'); fr.srcdoc = HOME; st.textContent = 'Home'; }
        else { fr.removeAttribute('srcdoc'); fr.src = u; st.textContent = 'Loading ' + u + ' ...'; }
        back.disabled = pos <= 0; fwd.disabled = pos >= hist.length - 1;
      }
      function nav(u) { hist = hist.slice(0, pos + 1); hist.push(u); pos++; show(); }
      function submit() { var u = norm(url.value); if (u) nav(u); }
      fr.onload = function () { if (hist[pos] !== 'about:home') st.textContent = 'Done. If the page is blank, the site may not allow being shown here; try Open in new tab.'; };
      back.onclick = function () { if (pos > 0) { pos--; show(); } };
      fwd.onclick = function () { if (pos < hist.length - 1) { pos++; show(); } };
      rel.onclick = show;
      home.onclick = function () { if (hist[pos] !== 'about:home') nav('about:home'); };
      go.onclick = submit;
      url.onkeydown = function (e) { if (e.key === 'Enter') submit(); };
      tab.onclick = function () { if (hist[pos] === 'about:home') { st.textContent = 'Nothing to open yet. Go to a page first.'; return; } window.open(hist[pos], '_blank', 'noopener'); };
      function onMsg(e) {
        if (!self.el.isConnected) { window.removeEventListener('message', onMsg); return; }
        if (e.source === fr.contentWindow && e.data && typeof e.data.go === 'string' && /^https?:\/\//i.test(e.data.go)) nav(e.data.go);
      }
      window.addEventListener('message', onMsg);
      bar.append(back, fwd, rel, home, url, go, tab); body.append(bar, fr, st); show();
    }
  };

  /* ---------- Command Prompt & PowerShell (simulated; they work on the virtual C: drive) ---------- */
  function makeShell(ps) {
    var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
    var COMMON = { 'help': 'help', 'cls': 'cls', 'exit': 'exit', 'hostname': 'hostname', 'whoami': 'whoami', 'tasklist': 'tasks', 'taskkill': 'kill',
      'find': 'grep', 'findstr': 'grep', 'sort': 'sort', 'more': 'more', 'tree': 'tree', 'ipconfig': 'ipconfig', 'ping': 'ping', 'systeminfo': 'sysinfo',
      'shutdown': 'shutdown', 'logoff': 'shutdown', 'notepad': 'launch', 'mspaint': 'launch', 'calc': 'launch', 'explorer': 'launch', 'control': 'launch',
      'taskmgr': 'launch', 'cmd': 'launch', 'powershell': 'launch', 'iexplore': 'launch', 'winmine': 'launch' };
    var CMD = { 'dir': 'ls', 'cd': 'cd', 'chdir': 'cd', 'echo': 'echo', 'md': 'mkdir', 'mkdir': 'mkdir', 'type': 'type', 'del': 'rm', 'erase': 'rm', 'rd': 'rm', 'rmdir': 'rm',
      'ren': 'ren', 'rename': 'ren', 'copy': 'copy', 'xcopy': 'copy', 'move': 'move', 'date': 'date', 'time': 'time', 'ver': 'ver', 'set': 'set', 'title': 'title',
      'color': 'color', 'pause': 'pause', 'rem': 'rem', 'call': 'call', 'start': 'start' };
    var PSM = { 'man': 'help', 'get-help': 'help', 'clear': 'cls', 'clear-host': 'cls', 'echo': 'echo', 'write-output': 'echo', 'write-host': 'echo',
      'ls': 'ls', 'dir': 'ls', 'gci': 'ls', 'get-childitem': 'ls', 'gi': 'ls', 'get-item': 'ls', 'cd': 'cd', 'sl': 'cd', 'set-location': 'cd', 'pwd': 'pwd', 'gl': 'pwd', 'get-location': 'pwd',
      'mkdir': 'mkdir', 'md': 'mkdir', 'new-item': 'new', 'ni': 'new', 'cat': 'type', 'type': 'type', 'gc': 'type', 'get-content': 'type',
      'rm': 'rm', 'del': 'rm', 'ri': 'rm', 'remove-item': 'rm', 'rmdir': 'rm', 'erase': 'rm', 'ren': 'ren', 'rni': 'ren', 'rename-item': 'ren',
      'copy': 'copy', 'cp': 'copy', 'cpi': 'copy', 'copy-item': 'copy', 'move': 'move', 'mv': 'move', 'mi': 'move', 'move-item': 'move',
      'get-date': 'date', 'ps': 'tasks', 'gps': 'tasks', 'get-process': 'tasks', 'stop-process': 'kill', 'kill': 'kill',
      'start': 'start', 'saps': 'start', 'start-process': 'start', 'select-string': 'grep', 'sls': 'grep', 'sort-object': 'sort',
      'measure-object': 'measure', 'measure': 'measure', 'select-object': 'select', 'select': 'select',
      'out-host': 'passthru', 'out-string': 'passthru', 'format-table': 'passthru', 'ft': 'passthru', 'format-list': 'passthru', 'fl': 'passthru', 'out-null': 'nullout',
      'test-path': 'testpath', 'set-content': 'setcontent', 'add-content': 'addcontent', 'ac': 'addcontent', 'get-random': 'random',
      'get-command': 'getcommand', 'gcm': 'getcommand', 'get-alias': 'getalias', 'gal': 'getalias', 'get-computerinfo': 'sysinfo',
      'stop-computer': 'shutdown', 'restart-computer': 'shutdown', '&': 'call' };
    var NOPE = ['netstat', 'nslookup', 'tracert', 'arp', 'chkdsk', 'format', 'diskpart', 'sfc', 'reg', 'regedit', 'sc', 'net', 'wmic', 'schtasks', 'gpupdate',
      'defrag', 'attrib', 'icacls', 'cacls', 'bcdedit', 'driverquery', 'powercfg', 'wevtutil', 'msiexec', 'getmac', 'route', 'nbtstat', 'pathping', 'telnet', 'ftp']
      .concat(ps ? ['get-service', 'get-eventlog', 'get-wmiobject', 'get-ciminstance', 'get-netadapter', 'get-disk', 'set-executionpolicy', 'invoke-webrequest', 'iwr', 'curl', 'wget', 'install-module', 'get-module'] : ['assoc', 'ftype', 'mklink']);
    var MAP = {};
    [COMMON, ps ? PSM : CMD].forEach(function (src) { Object.keys(src).forEach(function (k) { MAP[k] = src[k]; }); });
    NOPE.forEach(function (k) { if (!has(MAP, k)) MAP[k] = 'nope'; });
    var USAGE = {
      cls: 'cls  - clear the screen', echo: 'echo <text>  - show text. "echo text > file.txt" writes a file, ">>" adds to it.',
      ls: 'dir / ls [path]  - list a folder. /s or -Recurse goes into subfolders, /b or -Name shows names only.', cd: 'cd <folder>  - change folder (cd .. goes up)',
      pwd: 'pwd  - show the current folder', mkdir: 'mkdir <folder> ...  - make folders', new: 'New-Item <name> [-ItemType Directory|File] [-Value text]',
      type: 'type / cat <file>  - show a text file', rm: 'del / rm <file or folder>  - delete. Folders with contents need /s or -Recurse.',
      ren: 'ren <name> <new name>  - rename', copy: 'copy <source> <destination>  - copy a file (folders need /s or -Recurse)',
      move: 'move <source> <destination>  - move or rename', tree: 'tree [path]  - draw the folder tree (/f includes files)',
      date: 'date  - show the date', time: 'time  - show the time', ver: 'ver  - show the version', hostname: 'hostname', whoami: 'whoami',
      tasks: 'tasklist / Get-Process  - list the open windows of this desktop', kill: 'taskkill /im <app>  or  Stop-Process -Name <app>  - close an app',
      start: 'start <app>  - open an app', exit: 'exit  - close this window',
      grep: 'find "text" [file]  |  findstr <pattern> [file]  |  Select-String <pattern> [file]. They also work after a pipe (|).',
      sort: 'sort [file]  (/r reverses). Also works after a pipe.', more: 'more [file]  - show a file', measure: 'Measure-Object  - count piped lines',
      select: 'Select-Object -First n | -Last n  - use after a pipe', set: 'set [NAME=value]  - show or change variables. Use %NAME% in later commands.',
      title: 'title <text>  - rename this window', color: 'color <hex digits, for example 0a>  - background then text color. color alone resets.',
      pause: 'pause  - wait for a key', rem: 'rem <comment>', call: 'call <script.bat>  - run a script saved on C:', sysinfo: 'systeminfo  - what the browser reports about this computer',
      ipconfig: 'ipconfig  - network status as far as the browser can tell', ping: 'ping <host> [-n count]  - an HTTPS reachability check, not a real ICMP ping',
      shutdown: 'shutdown /s | /r | /l  - shut down, restart or lock this simulated desktop', launch: 'Type an app name to open it. notepad <file> and mspaint <file> open files from C:.',
      testpath: 'Test-Path <path>  - True or False', setcontent: 'Set-Content <file> <text>  - replace a file\'s text', addcontent: 'Add-Content <file> <text>  - add a line',
      random: 'Get-Random [-Minimum n] [-Maximum n]', getcommand: 'Get-Command  - list the cmdlets', getalias: 'Get-Alias  - list the aliases',
      passthru: 'Out-Host / Format-Table / Out-String  - show piped text', nullout: 'Out-Null  - discard piped text', nope: 'This tool needs the real system, which a web page cannot reach.'
    };
    var DISP = { cls: 'Clear-Host', echo: 'Write-Output', ls: 'Get-ChildItem', cd: 'Set-Location', pwd: 'Get-Location', new: 'New-Item', type: 'Get-Content', rm: 'Remove-Item',
      ren: 'Rename-Item', copy: 'Copy-Item', move: 'Move-Item', date: 'Get-Date', tasks: 'Get-Process', kill: 'Stop-Process', start: 'Start-Process', grep: 'Select-String',
      sort: 'Sort-Object', measure: 'Measure-Object', select: 'Select-Object', help: 'Get-Help', getcommand: 'Get-Command', addcontent: 'Add-Content' };
    var CL = ['#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#c0c0c0', '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff'];

    return function (body, self) {
      var cwd = [], hist = [], hi = 0, C = {}, sink = null, depth = 0, waiting = false, pv = {};
      var env = { USERNAME: 'user', COMPUTERNAME: 'WIN7-PC', OS: 'Windows_NT', SYSTEMDRIVE: 'C:', USERPROFILE: 'C:\\Users\\user', TEMP: 'C:\\Temp', PATHEXT: '.COM;.EXE;.BAT;.CMD', PROMPT: '$P$G' };
      var term = el('div', 'term' + (ps ? ' ps' : '')), out = el('div'), row = el('div', 'trow'), pr = el('span'), inp = document.createElement('input');
      inp.spellcheck = false; inp.setAttribute('autocomplete', 'off'); row.append(pr, inp); term.append(out, row); body.appendChild(term);

      function say(t, cls) {
        if (sink) { String(t).split('\n').forEach(function (l) { sink.push(l); }); return; }
        var d = el('div', cls || ''); d.textContent = t; out.appendChild(d);
      }
      function err(t) { var d = el('div', 'err'); d.textContent = t; out.appendChild(d); }
      function pathStr(p) { return 'C:\\' + p.join('\\'); }
      function promptStr() { return ps ? 'PS ' + pathStr(cwd) + '> ' : pathStr(cwd) + '>'; }
      function setPrompt() { pr.textContent = promptStr(); term.scrollTop = term.scrollHeight; }
      function resolve(a) {
        var s = a.replace(/^"|"$/g, ''), abs = /^([a-zA-Z]:)?[\\\/]/.test(s) || /^[a-zA-Z]:$/.test(s), parts = abs ? [] : cwd.slice();
        s.replace(/^[a-zA-Z]:/, '').split(/[\\\/]+/).forEach(function (p) { if (!p || p === '.') return; if (p === '..') parts.pop(); else parts.push(p); });
        return parts;
      }
      function node(parts) { var n = vfs; for (var i = 0; i < parts.length; i++) { if (!n.kids || !n.kids[parts[i]]) return null; n = n.kids[parts[i]]; } return n; }
      function parentOf(parts) { return node(parts.slice(0, -1)); }
      function sizeOf(n) { return n.kids ? 0 : (n.size || (n.data || n.text || '').length); }
      function notFound(p) { return ps ? "Cannot find path '" + pathStr(p) + "' because it does not exist." : 'The system cannot find the path specified.'; }
      function under(parts, base) { return parts.length >= base.length && base.every(function (x, i) { return parts[i] === x; }); }
      function badName(name) { return /[:*?"<>|]/.test(name); }
      function unq(s) { return String(s).trim().replace(/^(["'])(.*)\1$/, '$2'); }
      function findApp(q) {
        q = String(q || '').toLowerCase().replace(/\.exe$/, '').replace(/\s+/g, '');
        var al = { mspaint: 'paint', winmine: 'mines', iexplore: 'browser', calculator: 'calc' }; if (al[q]) q = al[q];
        var id = null; Object.keys(APPS).forEach(function (k) { if (k === q || APPS[k].title.toLowerCase().replace(/\s+/g, '') === q) id = k; });
        return id;
      }
      function make(parts, item) {
        if (!parts.length) { err('Invalid path.'); return false; }
        var par = parentOf(parts), name = parts[parts.length - 1];
        if (!par || !par.kids) { err(notFound(parts.slice(0, -1))); return false; }
        if (badName(name)) { err('The filename, directory name, or volume label syntax is incorrect.'); return false; }
        if (par.kids[name]) { err(ps ? 'An item with the specified name ' + pathStr(parts) + ' already exists.' : 'A subdirectory or file ' + name + ' already exists.'); return false; }
        par.kids[name] = item; return true;
      }
      function writeFile(parts, text, append) {
        var par = parentOf(parts), name = parts[parts.length - 1];
        if (!parts.length || !par || !par.kids) { err(notFound(parts.slice(0, -1))); return; }
        if (badName(name)) { err('The filename, directory name, or volume label syntax is incorrect.'); return; }
        var ex = par.kids[name];
        if (ex && ex.kids) { err('Access is denied. That is a folder.'); return; }
        if (ex && (ex.data || ex.file)) { err('That file is not a text file and cannot be written to.'); return; }
        par.kids[name] = { text: (append && ex ? ex.text + '\n' : '') + text };
        if (!vsave()) { if (ex) par.kids[name] = ex; else delete par.kids[name]; err('Not enough browser storage space.'); }
      }
      function srcLines(file, input) {
        if (input) return input;
        if (!file) { err('No input. Give a file name or pipe text into this command.'); return null; }
        var p = resolve(file), n = node(p);
        if (!n || n.kids) { err(ps ? notFound(p) : 'The system cannot find the file specified.'); return null; }
        return n.data ? ['(This is a picture.)'] : n.file ? ['(This is a binary file.)'] : String(n.text).split(/\r?\n/);
      }
      function expand(s) {
        if (!ps) return s.replace(/%(\w+)%/g, function (m, k) {
          var K = k.toUpperCase(), d = new Date();
          if (K === 'CD') return pathStr(cwd); if (K === 'DATE') return d.toLocaleDateString(); if (K === 'TIME') return d.toLocaleTimeString();
          if (K === 'RANDOM') return String(Math.floor(Math.random() * 32768));
          return has(env, K) ? env[K] : m;
        });
        return s.replace(/\$env:(\w+)/gi, function (m, k) { var K = k.toUpperCase(); return has(env, K) ? env[K] : ''; })
          .replace(/\$(\w+)/g, function (m, k) { if (k.toLowerCase() === 'pwd') return pathStr(cwd); return has(pv, k) ? pv[k] : m; });
      }

      /* ----- commands ----- */
      C.help = function (a) {
        var q = (a.pos[0] || '').toLowerCase();
        if (q) { var id = has(MAP, q) ? MAP[q] : null; say(id && USAGE[id] ? USAGE[id] : "No help is available for '" + a.pos[0] + "'."); return; }
        say('Commands you can use here:');
        say(Object.keys(MAP).filter(function (k) { return MAP[k] !== 'nope'; }).sort().join(', '));
        say(''); say('Type help <command> or <command> /? for usage. Pipes (|) and > / >> redirection work. Scripts (.bat, .cmd, .ps1) saved on C: run by name.');
        say('Real-system tools (netstat, diskpart, regedit and similar) are recognized but cannot run, because a web page cannot reach the real system.');
        say('Apps you can open: ' + Object.keys(APPS).join(', '));
      };
      C.nope = function (a) { err("'" + a.name + "' needs access to the real system, which a web page does not have, so this simulated shell cannot run it."); };
      C.cls = function () { out.innerHTML = ''; };
      C.pwd = function () { say(pathStr(cwd)); };
      C.ver = function () { say('Microsoft Windows [Version 6.1.7601] (simulated)'); };
      C.hostname = function () { say('WIN7-PC'); };
      C.whoami = function () { say('win7-pc\\user'); };
      C.exit = function () { closeWin(self); };
      C.rem = function () {};
      C.nullout = function () {};
      C.date = function () { var d = new Date(); say(ps ? d.toString() : 'The current date is: ' + d.toLocaleDateString()); };
      C.time = function () { say('The current time is: ' + new Date().toLocaleTimeString()); };
      C.echo = function (a) { if (!ps && /^(on|off)$/i.test(a.rest)) return; say(unq(a.rest)); };
      C.passthru = function (a, input) { if (input) input.forEach(function (l) { say(l); }); };
      C.title = function (a) { var t = a.rest || (ps ? 'Windows PowerShell' : 'Command Prompt'); $('.t', self.el).textContent = t; self.btn.textContent = (ps ? APPS.powershell : APPS.cmd).icon + ' ' + t; };
      C.color = function (a) {
        var v = (a.pos[0] || '').toLowerCase();
        if (!v) { term.style.background = ''; term.style.color = ''; return; }
        if (!/^[0-9a-f]{1,2}$/.test(v)) { err('Usage: color <background and text hex digits, for example 0a>'); return; }
        var bg = v.length === 2 ? parseInt(v.charAt(0), 16) : 0, fg = parseInt(v.charAt(v.length - 1), 16);
        if (bg === fg) { err('Background and text colors must differ.'); return; }
        term.style.background = CL[bg]; term.style.color = CL[fg];
      };
      C.pause = function () { if (depth) return; say('Press any key to continue . . .'); waiting = true; };
      C.set = function (a) {
        var r = a.rest, i = r.indexOf('=');
        if (!r || i < 0) { Object.keys(env).sort().forEach(function (k) { if (!r || k.indexOf(r.toUpperCase()) === 0) say(k + '=' + env[k]); }); return; }
        var k = r.slice(0, i).trim().toUpperCase(), v = r.slice(i + 1);
        if (!k) { err('The syntax of the command is incorrect.'); return; }
        if (v) env[k] = v; else delete env[k];
      };
      function listDir(parts, nd, a) {
        var bare = a.flags.b || a.flags.name, rec = a.flags.s || a.flags.recurse, kids = nd.kids;
        var names = Object.keys(kids).sort(function (x, y) { return (!!kids[y].kids - !!kids[x].kids) || x.localeCompare(y); }), files = 0, dirs = 0;
        if (bare) { names.forEach(function (k) { say(rec ? pathStr(parts.concat(k)) : k); }); }
        else {
          say(ps ? '    Directory: ' + pathStr(parts) : ' Directory of ' + pathStr(parts)); say('');
          if (ps) { say('Mode        Length Name'); say('----        ------ ----'); }
          names.forEach(function (k) {
            var d = !!kids[k].kids; if (d) dirs++; else files++;
            say(ps ? (d ? 'd-----      ' : '-a----      ') + String(d ? '' : sizeOf(kids[k])).padStart(6) + ' ' + k : (d ? '<DIR>' : String(sizeOf(kids[k]))).padEnd(10) + k);
          });
          if (!ps) { say(files + ' File(s)'); say(dirs + ' Dir(s)'); }
        }
        if (rec) names.forEach(function (k) { if (kids[k].kids) listDir(parts.concat(k), kids[k], a); });
      }
      C.ls = function (a) {
        var parts = a.pos[0] ? resolve(a.pos.join(' ')) : cwd, n = node(parts);
        if (!n) { err(ps ? notFound(parts) : 'File Not Found'); return; }
        if (n.kids) { listDir(parts, n, a); return; }
        var one = {}; one[parts[parts.length - 1]] = n; listDir(parts.slice(0, -1), { kids: one }, { flags: {} });
      };
      C.tree = function (a) {
        var parts = a.pos[0] ? resolve(a.pos.join(' ')) : cwd, n = node(parts);
        if (!n || !n.kids) { err(notFound(parts)); return; }
        say(pathStr(parts));
        (function walk(nd, pre) {
          var names = Object.keys(nd.kids).filter(function (k) { return nd.kids[k].kids || a.flags.f; }).sort();
          names.forEach(function (k, i) {
            var last = i === names.length - 1; say(pre + (last ? '\\---' : '+---') + k);
            if (nd.kids[k].kids) walk(nd.kids[k], pre + (last ? '    ' : '|   '));
          });
        })(n, '');
      };
      C.cd = function (a) {
        if (!a.pos[0]) { if (!ps) say(pathStr(cwd)); return; }
        var p = resolve(a.pos.join(' ')), n = node(p);
        if (!n || !n.kids) err(notFound(p)); else cwd = p;
      };
      C.mkdir = function (a) { if (!a.pos.length) { err('Usage: mkdir <folder>'); return; } a.pos.forEach(function (p) { make(resolve(p), { kids: {} }); }); vsave(); };
      C.new = function (a) {
        var f = a.flags, dir = /^dir/i.test(f.itemtype || ''), path = f.name ? (f.path ? f.path + '\\' + f.name : f.name) : (f.path || a.pos[0]);
        if (!path) { err('Usage: New-Item <name> [-ItemType Directory|File] [-Value text]'); return; }
        make(resolve(path), dir ? { kids: {} } : { text: f.value || '' }); vsave();
      };
      C.type = function (a) {
        if (!a.pos.length) { err('Usage: type <file>'); return; }
        a.pos.forEach(function (p) { var l = srcLines(p, null); if (l) say(l.join('\n')); });
      };
      C.more = function (a, input) { var l = srcLines(a.pos[0], input); if (l) l.forEach(function (x) { say(x); }); };
      C.setcontent = C.addcontent = function (a) {
        var f = a.flags, path = f.path || a.pos[0], val = f.value !== undefined ? f.value : a.pos.slice(f.path ? 0 : 1).join(' ');
        if (!path) { err('Usage: Set-Content <file> <text>'); return; }
        writeFile(resolve(path), val, a.name === 'add-content' || a.name === 'ac');
      };
      C.testpath = function (a) { say(a.pos[0] && node(resolve(a.pos[0])) ? 'True' : 'False'); };
      C.rm = function (a) {
        var rec = a.flags.r || a.flags.recurse || a.flags.s;
        if (!a.pos.length) { err('Usage: del <file or folder>'); return; }
        a.pos.forEach(function (p) {
          var parts = resolve(p), n = node(parts);
          if (!parts.length) { err('Access is denied.'); return; }
          if (!n) { err(notFound(parts)); return; }
          if (n.kids && Object.keys(n.kids).length && !rec) { err(ps ? 'The directory is not empty. Use -Recurse to remove it and its contents.' : 'The directory is not empty. Use /s to remove it and its contents.'); return; }
          delete parentOf(parts).kids[parts[parts.length - 1]];
          if (under(cwd, parts)) cwd = parts.slice(0, -1);
        });
        vsave();
      };
      C.ren = function (a) {
        if (a.pos.length < 2) { err('Usage: ren <name> <new name>'); return; }
        var parts = resolve(a.pos[0]), n = node(parts), nn = a.pos[1];
        if (!parts.length || !n) { err(notFound(parts)); return; }
        if (/[\\\/]/.test(nn) || badName(nn)) { err('The new name must be a valid name only, without a path.'); return; }
        var par = parentOf(parts), old = parts[parts.length - 1];
        if (par.kids[nn]) { err('A file with that name already exists.'); return; }
        par.kids[nn] = n; delete par.kids[old];
        if (under(cwd, parts)) cwd[parts.length - 1] = nn;
        vsave();
      };
      C.copy = function (a) {
        if (a.pos.length < 2) { err('Usage: copy <source> <destination>'); return; }
        var sp = resolve(a.pos[0]), sn = node(sp), dp = resolve(a.pos[1]), dn = node(dp);
        if (!sn) { err(notFound(sp)); return; }
        if (sn.kids && !(a.flags.s || a.flags.e || a.flags.recurse)) { err('That is a folder. Use /s (or -Recurse) to copy folders.'); return; }
        if (dn && dn.kids) dp = dp.concat(sp[sp.length - 1]);
        var par = parentOf(dp), name = dp[dp.length - 1];
        if (!dp.length || !par || !par.kids) { err(notFound(dp.slice(0, -1))); return; }
        if (sn.kids && under(dp, sp)) { err('Cannot copy a folder into itself.'); return; }
        if (par.kids[name] && par.kids[name].kids) { err('A folder with that name already exists.'); return; }
        par.kids[name] = JSON.parse(JSON.stringify(sn));
        if (vsave()) say('        1 item(s) copied.'); else err('Not enough browser storage space.');
      };
      C.move = function (a) {
        if (a.pos.length < 2) { err('Usage: move <source> <destination>'); return; }
        var sp = resolve(a.pos[0]), sn = node(sp), dp = resolve(a.pos[1]), dn = node(dp);
        if (!sp.length || !sn) { err(notFound(sp)); return; }
        if (dn && dn.kids) dp = dp.concat(sp[sp.length - 1]);
        var par = parentOf(dp), name = dp[dp.length - 1];
        if (!dp.length || !par || !par.kids) { err(notFound(dp.slice(0, -1))); return; }
        if (under(dp, sp)) { err('Cannot move something into itself.'); return; }
        if (badName(name)) { err('The filename, directory name, or volume label syntax is incorrect.'); return; }
        if (par.kids[name]) { err('A file with that name already exists.'); return; }
        par.kids[name] = sn; delete parentOf(sp).kids[sp[sp.length - 1]];
        if (under(cwd, sp)) cwd = dp.concat(cwd.slice(sp.length));
        vsave(); say('        1 item(s) moved.');
      };
      C.grep = function (a, input) {
        var f = a.flags, pat = f.pattern !== undefined ? f.pattern : a.pos[0], file = f.path || (f.pattern !== undefined ? a.pos[0] : a.pos[1]);
        if (!pat) { err('Usage: find "text" [file]'); return; }
        var ci = f.i || ((a.name === 'select-string' || a.name === 'sls') && !f.casesensitive), lines = srcLines(file, input), re;
        if (!lines) return;
        var lit = pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        try { re = new RegExp(a.name === 'find' ? lit : pat, ci ? 'i' : ''); } catch (e) { re = new RegExp(lit, ci ? 'i' : ''); }
        var hit = lines.filter(function (l) { return re.test(l) !== !!f.v; });
        if (f.c) say(String(hit.length)); else hit.forEach(function (l) { say(l); });
      };
      C.sort = function (a, input) {
        var l = srcLines(a.pos[0], input); if (!l) return;
        l = l.slice().sort(function (x, y) { return x.localeCompare(y); }); if (a.flags.r || a.flags.descending) l.reverse();
        l.forEach(function (x) { say(x); });
      };
      C.measure = function (a, input) { var n = input ? input.length : 0; say(ps ? 'Count    : ' + n : String(n)); };
      C.select = function (a, input) {
        if (!input) { err('Pipe text into Select-Object, for example: Get-Content file.txt | Select-Object -First 3'); return; }
        var l = input, first = parseInt(a.flags.first, 10), last = parseInt(a.flags.last, 10);
        if (first > 0) l = l.slice(0, first); if (last > 0) l = l.slice(-last);
        l.forEach(function (x) { say(x); });
      };
      C.random = function (a) {
        var lo = parseInt(a.flags.minimum, 10) || 0, hi2 = parseInt(a.flags.maximum, 10) || 2147483647;
        say(String(lo + Math.floor(Math.random() * Math.max(1, hi2 - lo))));
      };
      C.getcommand = function () {
        say(Object.keys(MAP).filter(function (k) { return k.indexOf('-') > 0 && MAP[k] !== 'nope'; }).sort().join('\n'));
      };
      C.getalias = function () {
        Object.keys(MAP).sort().forEach(function (k) { var id = MAP[k]; if (k.indexOf('-') < 0 && id !== 'nope' && DISP[id] && DISP[id].toLowerCase() !== k) say(k.padEnd(10) + '-> ' + DISP[id]); });
      };
      C.tasks = function () {
        say('Application'.padEnd(28) + 'Status');
        wins.forEach(function (w) { say(w.app.title.padEnd(28) + (w.min ? 'Minimized' : 'Running')); });
      };
      C.kill = function (a) {
        var q = a.flags.im || a.flags.name || a.pos[0];
        if (!q) { err('Usage: taskkill /im <app>. Apps: ' + Object.keys(APPS).join(', ')); return; }
        var id = findApp(q), hit = id ? wins.filter(function (w) { return w.app === APPS[id]; }) : [];
        if (!hit.length) { err(ps ? "Cannot find a process with the name '" + q + "'." : 'ERROR: The process "' + q + '" not found.'); return; }
        hit.forEach(function (w) { closeWin(w); });
        if (!ps) say('SUCCESS: Sent termination signal to ' + hit.length + ' window(s).');
      };
      C.start = function (a) {
        if (!a.pos[0]) { err('Usage: start <app>. Apps: ' + Object.keys(APPS).join(', ')); return; }
        var id = findApp(a.pos[0]);
        if (!id) { err("Cannot find '" + a.pos[0] + "'. Apps: " + Object.keys(APPS).join(', ')); return; }
        openApp(id);
      };
      C.launch = function (a) {
        var id = findApp(a.name), f = a.pos[0];
        if (id === 'notepad' && f) {
          var p = resolve(f), n = node(p);
          if (n && n.kids) { err('That is a folder.'); return; }
          if (!n) { make(p, { text: '' }); vsave(); n = node(p); if (!n) return; }
          if (n.data || n.file) { err('That is not a text file.'); return; }
          openApp('notepad', { name: p[p.length - 1], text: n.text, save: vsaveFn(n, 'text') });
        } else if (id === 'paint' && f) {
          var q = resolve(f), m = node(q);
          if (!m || !m.data) { err('That file does not exist or is not a picture.'); return; }
          openApp('paint', { name: q[q.length - 1], data: m.data, save: vsaveFn(m, 'data') });
        } else { openApp(id); }
      };
      C.call = function (a) {
        var p = a.pos[0] && resolve(a.pos[0]), n = p && node(p);
        if (!n || n.kids || n.text === undefined) { err('Cannot find the script file.'); return; }
        runScript(n);
      };
      C.shutdown = function (a) {
        var k = a.name, f = a.flags;
        if (k === 'restart-computer' || f.r) power('restart'); else if (k === 'stop-computer' || f.s) power('off'); else if (k === 'logoff' || f.l) power('lock');
        else say('Usage: shutdown /s (shut down), /r (restart), /l (lock). This only affects this simulated desktop.');
      };
      C.sysinfo = function () {
        var n = navigator, d = n.deviceMemory ? '~' + n.deviceMemory + ' GB (browser estimate)' : 'not reported by this browser', tz = '';
        try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
        say('Host Name:        WIN7-PC'); say('OS Name:          Microsoft Windows 7 Professional (simulated desktop)');
        say('Browser:          ' + n.userAgent); say('Processors:       ' + (n.hardwareConcurrency || '?') + ' logical');
        say('Memory:           ' + d); say('Screen:           ' + screen.width + ' x ' + screen.height); say('Language:         ' + n.language);
        say('Time Zone:        ' + tz); say('Virtual C: used:  ' + Math.round(JSON.stringify(vfs).length / 1024) + ' KB');
        say('(This information comes from your browser.)');
      };
      C.ipconfig = function () {
        var c = navigator.connection;
        say('Windows IP Configuration (simulated)'); say('');
        say('A web page cannot read your network adapters or IP address.');
        say('The browser reports: ' + (navigator.onLine ? 'online' : 'no network'));
        if (c && c.effectiveType) say('Connection quality: ' + c.effectiveType);
      };
      C.ping = function (a) {
        var host = (a.pos[0] || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
        if (!host) { err('Usage: ping <host> [-n count]'); return; }
        if (!/^[\w.-]+(:\d+)?$/.test(host)) { err('That host name is not valid.'); return; }
        var count = Math.max(1, Math.min(10, parseInt(a.flags.n, 10) || 4)), times = [], i = 0;
        say('Pinging ' + host + ' with an HTTPS request (not a real ICMP ping):');
        (function next() {
          if (i >= count) {
            var ok = times.length; say(''); say('Requests: sent ' + count + ', replies ' + ok + ', no reply ' + (count - ok));
            if (ok) say('Time: min ' + Math.min.apply(null, times) + ' ms, max ' + Math.max.apply(null, times) + ' ms, average ' + Math.round(times.reduce(function (x, y) { return x + y; }, 0) / ok) + ' ms');
            setPrompt(); return;
          }
          var t0 = performance.now(), ctl = window.AbortController ? new AbortController() : null, to = setTimeout(function () { if (ctl) ctl.abort(); }, 4000);
          fetch('https://' + host + '/?' + Date.now(), { mode: 'no-cors', cache: 'no-store', signal: ctl ? ctl.signal : undefined })
            .then(function () { var ms = Math.round(performance.now() - t0); times.push(ms); say('Reply from ' + host + ': time=' + ms + ' ms'); },
              function () { say('No reply: timed out or the host cannot be reached.'); })
            .then(function () { clearTimeout(to); i++; next(); });
        })();
      };

      /* ----- running a line ----- */
      function splitPipes(s) {
        var parts = [], cur = '', q = false;
        for (var i = 0; i < s.length; i++) { var ch = s.charAt(i); if (ch === '"') q = !q; if (ch === '|' && !q) { parts.push(cur); cur = ''; } else cur += ch; }
        parts.push(cur); return parts;
      }
      function runScript(n) {
        if (depth > 4) { err('Scripts are nested too deeply.'); return; }
        depth++; String(n.text).split(/\r?\n/).forEach(function (l) { exec(l); }); depth--;
      }
      function runStage(text, input) {
        var raw = text.trim(); if (!raw) return;
        var name = raw.split(/\s+/)[0], rest = expand(raw.slice(name.length).trim()), key = name.toLowerCase();
        var toks = rest.match(/"[^"]*"|\S+/g) || [], a = { name: key, rest: rest, pos: [], flags: {} };
        var FLAG = ps ? /^-[a-zA-Z]+$/ : /^(-[a-zA-Z]+|\/[a-zA-Z]+)$/, VAL = { itemtype: 1, name: 1, path: 1, value: 1, pattern: 1, first: 1, last: 1, im: 1, n: 1, maximum: 1, minimum: 1 };
        for (var i = 0; i < toks.length; i++) {
          var t = toks[i];
          if (FLAG.test(t)) { var f = t.slice(1).toLowerCase(); a.flags[f] = VAL[f] ? unq(toks[++i] || '') : true; }
          else a.pos.push(unq(t));
        }
        var id = has(MAP, key) ? MAP[key] : null;
        if (!id) {
          var sp = resolve(name), sn = node(sp);
          if (sn && !sn.kids && sn.text !== undefined && /\.(bat|cmd|ps1)$/i.test(name)) { runScript(sn); return; }
          err(ps ? "The term '" + name + "' is not recognized as the name of a cmdlet, function, script file, or operable program." : "'" + name + "' is not recognized as an internal or external command, operable program or batch file.");
          return;
        }
        if (a.pos.indexOf('/?') >= 0 || a.pos.indexOf('-?') >= 0) { say(USAGE[id] || 'No help is available.'); return; }
        try { C[id](a, input); } catch (e) { err('Error: ' + e.message); }
      }
      function exec(line) {
        var raw = line.trim().replace(/^@/, '');
        if (!raw || /^(::|#)/.test(raw)) return;
        if (ps) {
          var m1 = raw.match(/^\$env:(\w+)\s*=\s*(.*)$/i), m2 = raw.match(/^\$(\w+)\s*=\s*(.*)$/);
          if (m1) { env[m1[1].toUpperCase()] = unq(expand(m1[2])); return; }
          if (m2) { pv[m2[1]] = unq(expand(m2[2])); return; }
          if (/^\$[\w:]+$/.test(raw)) { say(expand(raw)); return; }
        }
        var redir = null, m = raw.match(/\s*(>>?)\s*("[^"]+"|[^\s>|]+)\s*$/);
        if (m && ((raw.slice(0, m.index).match(/"/g) || []).length % 2 === 0)) { redir = { append: m[1] === '>>', path: unq(m[2]) }; raw = raw.slice(0, m.index); }
        var stages = splitPipes(raw), input = null;
        for (var s = 0; s < stages.length; s++) {
          sink = (s < stages.length - 1 || redir) ? [] : null;
          try { runStage(stages[s], input); } finally { input = sink; sink = null; }
        }
        if (redir) writeFile(resolve(redir.path), (input || []).join('\n'), redir.append);
      }
      inp.addEventListener('keydown', function (e) {
        if (waiting) { waiting = false; e.preventDefault(); return; }
        if (e.key === 'Enter') {
          var v = inp.value; inp.value = ''; if (v.trim()) hist.push(v); hi = hist.length;
          var d = el('div'); d.textContent = promptStr() + v; out.appendChild(d);
          exec(v); setPrompt();
        } else if (e.key === 'ArrowUp') { if (hi > 0) { hi--; inp.value = hist[hi]; } e.preventDefault(); }
        else if (e.key === 'ArrowDown') { if (hi < hist.length - 1) { hi++; inp.value = hist[hi]; } else { hi = hist.length; inp.value = ''; } e.preventDefault(); }
      });
      term.onclick = function () { if (!String(window.getSelection())) inp.focus(); };
      var b = el('div'); b.textContent = ps ? 'Windows PowerShell (simulated)' : 'Microsoft Windows [Version 6.1.7601] (simulated)'; out.appendChild(b);
      say('This shell works on the virtual C: drive only. It cannot run real programs or change your computer.');
      say('Type help for the list of commands.'); say('');
      setPrompt(); setTimeout(function () { inp.focus(); }, 0);
    };
  }
  APPS.cmd = { title: 'Command Prompt', icon: '\u2328\uFE0F', w: 640, h: 360, build: makeShell(false) };
  APPS.powershell = { title: 'Windows PowerShell', icon: '\uD83D\uDCBB', w: 680, h: 380, build: makeShell(true) };

  /* ---------- Microsoft Office suite (lightweight versions; files save to the virtual C: drive) ---------- */
  var OFFG = 'Microsoft Office';
  var OFFLIST = ['access', 'excel', 'groove', 'infopath', 'onenote', 'powerpoint', 'publisher', 'word', 'selfcert', 'clip', 'langs', 'diag', 'picman'];
  var EXT = { doc: 'word', xls: 'excel', ppt: 'powerpoint', mdb: 'access', one: 'onenote', pub: 'publisher', xsn: 'infopath' };
  var LANGS = [['en-US', 'English (United States)'], ['en-GB', 'English (United Kingdom)'], ['bn', 'Bengali'], ['hi', 'Hindi'], ['ur', 'Urdu'], ['ar', 'Arabic'],
    ['fr', 'French'], ['de', 'German'], ['es', 'Spanish'], ['it', 'Italian'], ['pt-BR', 'Portuguese (Brazil)'], ['nl', 'Dutch'], ['sv', 'Swedish'], ['pl', 'Polish'],
    ['ru', 'Russian'], ['tr', 'Turkish'], ['zh-CN', 'Chinese (Simplified)'], ['ja', 'Japanese'], ['ko', 'Korean']];

  function loadJSON(opts, def) { try { return opts ? JSON.parse(opts.text) : def; } catch (e) { return def; } }
  function vfind(parts) { var n = vfs; for (var i = 0; i < parts.length; i++) { if (!n.kids || !n.kids[parts[i]]) return null; n = n.kids[parts[i]]; } return n; }
  function openFileNode(name, f, dir) {
    if (f.file) { openBlobNode(name, f, dir); return; }
    if (f.data) { openApp('photoviewer', { name: name, node: f, dir: dir || null }); return; }
    var m = /\.(\w+)$/.exec(name), id = m && EXT[m[1].toLowerCase()];
    openApp(id || 'notepad', { name: name, text: f.text || '', save: vsaveFn(f, 'text') });
  }
  function cleanHTML(h) {
    var d = document.implementation.createHTMLDocument('');
    d.body.innerHTML = h;
    Array.prototype.forEach.call(d.body.querySelectorAll('script,iframe,object,embed,link,meta,style,form'), function (n) { n.remove(); });
    Array.prototype.forEach.call(d.body.querySelectorAll('*'), function (n) {
      Array.prototype.slice.call(n.attributes).forEach(function (at) { if (/^on/i.test(at.name) || /^\s*javascript:/i.test(at.value)) n.removeAttribute(at.name); });
    });
    return d.body.innerHTML;
  }
  function makeSaver(self, app, opts, defDir, defName, status) {
    var file = opts || null;
    function title(n) { $('.t', self.el).textContent = app.title.replace('Microsoft Office ', '') + ' - ' + n; self.btn.textContent = app.icon + ' ' + n; }
    if (file) title(file.name);
    return function (asNew, content) {
      if (file && !asNew) { file.save(content).then(function () { status('Saved ' + file.name); }).catch(function (e) { status('Save failed: ' + e.message); }); return; }
      var parts = askPath(defDir + (file ? file.name : defName)); if (!parts) return;
      var err = vwrite(parts, content, 'text');
      if (err) { if (err !== 'cancelled') status(err); return; }
      file = { name: parts[parts.length - 1], save: vsaveFn(vget(parts), 'text') }; title(file.name); status('Saved to C:\\' + parts.join('\\'));
    };
  }
  function officeShell(self, app, opts, defDir, defName, get) {
    var msg = el('span', '', ''), save = makeSaver(self, app, opts, defDir, defName, function (t) { msg.textContent = t; });
    var b1 = el('button', '', 'Save'), b2 = el('button', '', 'Save as...');
    msg.style.cssText = 'margin-left:auto;color:#345'; b1.onclick = function () { save(false, get()); }; b2.onclick = function () { save(true, get()); };
    return { buttons: [b1, b2], msg: msg };
  }
  function tbtn(bar, label, fn) { var b = el('button', '', label); b.onclick = fn; bar.appendChild(b); return b; }

  APPS.word = {
    title: 'Microsoft Office Word', icon: '\uD83D\uDCC4', group: OFFG, w: 660, h: 500,
    build: function (body, self, opts) {
      var bar = el('div', 'bar'), area = el('div', 'wpaper'), page = el('div', 'wpage'), st = el('div', 'bar'), fs = 3;
      page.contentEditable = 'true'; page.spellcheck = true; page.lang = cfg.editLang || 'en-US';
      page.innerHTML = opts && opts.text ? cleanHTML(opts.text) : '<p><br></p>';
      function cmd(c, v) { page.focus(); document.execCommand(c, false, v || null); count(); }
      function count() { st.textContent = (page.innerText.trim().split(/\s+/).filter(Boolean).length) + ' words   Language: ' + page.lang; }
      [['B', 'bold'], ['I', 'italic'], ['U', 'underline'], ['Left', 'justifyLeft'], ['Center', 'justifyCenter'], ['Right', 'justifyRight'], ['\u2022 List', 'insertUnorderedList'], ['1. List', 'insertOrderedList'], ['Undo', 'undo'], ['Redo', 'redo']].forEach(function (b) {
        var x = tbtn(bar, b[0], function () {}); x.onmousedown = function (e) { e.preventDefault(); cmd(b[1]); };
      });
      var up = tbtn(bar, 'A+', function () {}), dn = tbtn(bar, 'A-', function () {});
      up.onmousedown = function (e) { e.preventDefault(); fs = Math.min(7, fs + 1); cmd('fontSize', String(fs)); };
      dn.onmousedown = function (e) { e.preventDefault(); fs = Math.max(1, fs - 1); cmd('fontSize', String(fs)); };
      var sh = officeShell(self, APPS.word, opts, 'C:\\Documents\\', 'Document1.doc', function () { return page.innerHTML; });
      bar.append(sh.buttons[0], sh.buttons[1], sh.msg); page.oninput = count;
      area.appendChild(page); body.append(bar, area, st); count();
    }
  };

  APPS.excel = {
    title: 'Microsoft Office Excel', icon: '\uD83D\uDCC8', group: OFFG, w: 720, h: 480,
    build: function (body, self, opts) {
      var COLS = 10, ROWS = 30, data = loadJSON(opts, {}), inputs = {};
      if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
      function A(c, r) { return String.fromCharCode(65 + c) + (r + 1); }
      function ref(s) { var m = /^([A-Z])(\d+)$/.exec(s); return m ? { c: m[1].charCodeAt(0) - 65, r: +m[2] - 1 } : null; }
      function val(a, d) {
        var raw = data[a]; if (raw === undefined || raw === null || raw === '') return '';
        raw = String(raw);
        if (raw.charAt(0) !== '=') return (raw.trim() !== '' && isFinite(raw)) ? +raw : raw;
        if (d > 25) return '#CIRC!';
        try { return calc(raw.slice(1), d); } catch (e) { return /^#/.test(e.message) ? e.message : '#ERR!'; }
      }
      function calc(src, d) {
        var t = src.toUpperCase().match(/\d+\.?\d*|[A-Z]+\d+:[A-Z]+\d+|[A-Z]+\d+|[A-Z]+|[-+*\/^(),]/g) || [], i = 0;
        function num(a) { var v = val(a, d + 1); if (typeof v === 'string') { if (v === '') return 0; if (v.charAt(0) === '#') throw new Error(v); throw new Error('#VALUE!'); } return v; }
        function rng(s) {
          var p = s.split(':'), x = ref(p[0]), y = ref(p[1]), o = [], c, r; if (!x || !y) throw new Error('#REF!');
          for (r = Math.min(x.r, y.r); r <= Math.max(x.r, y.r); r++) for (c = Math.min(x.c, y.c); c <= Math.max(x.c, y.c); c++) {
            var v = val(A(c, r), d + 1); if (typeof v === 'number') o.push(v); else if (typeof v === 'string' && v.charAt(0) === '#') throw new Error(v);
          }
          return o;
        }
        function expr() { var v = term(); while (t[i] === '+' || t[i] === '-') { var o = t[i++], w = term(); v = o === '+' ? v + w : v - w; } return v; }
        function term() { var v = pw(); while (t[i] === '*' || t[i] === '/') { var o = t[i++], w = pw(); if (o === '/' && w === 0) throw new Error('#DIV/0!'); v = o === '*' ? v * w : v / w; } return v; }
        function pw() { var v = un(); if (t[i] === '^') { i++; v = Math.pow(v, pw()); } return v; }
        function un() { if (t[i] === '-') { i++; return -un(); } if (t[i] === '+') { i++; return un(); } return prim(); }
        function prim() {
          var k = t[i++]; if (k === undefined) throw new Error('#ERR!');
          if (/^\d/.test(k)) return parseFloat(k);
          if (k === '(') { var v = expr(); if (t[i++] !== ')') throw new Error('#ERR!'); return v; }
          if (/^[A-Z]+\d+$/.test(k)) { if (!ref(k)) throw new Error('#REF!'); return num(k); }
          if (/^[A-Z]+$/.test(k) && t[i] === '(') {
            i++; var args = [];
            if (t[i] !== ')') { do { if (/^[A-Z]+\d+:[A-Z]+\d+$/.test(t[i] || '')) args = args.concat(rng(t[i++])); else args.push(expr()); } while (t[i] === ',' && ++i); }
            if (t[i++] !== ')') throw new Error('#ERR!'); return fn(k, args);
          }
          throw new Error('#ERR!');
        }
        function fn(n, a) {
          var s = a.reduce(function (x, y) { return x + y; }, 0);
          if (n === 'SUM') return s; if (n === 'COUNT') return a.length;
          if (n === 'AVERAGE') { if (!a.length) throw new Error('#DIV/0!'); return s / a.length; }
          if (n === 'MIN') return a.length ? Math.min.apply(null, a) : 0; if (n === 'MAX') return a.length ? Math.max.apply(null, a) : 0;
          if (n === 'ABS') return Math.abs(a[0]); if (n === 'SQRT') { if (a[0] < 0) throw new Error('#NUM!'); return Math.sqrt(a[0]); }
          if (n === 'ROUND') { var p = Math.pow(10, a[1] || 0); return Math.round(a[0] * p) / p; }
          throw new Error('#NAME?');
        }
        var out = expr(); if (i !== t.length) throw new Error('#ERR!'); return out;
      }
      function show(a) { var v = val(a, 0); inputs[a].value = typeof v === 'number' ? String(parseFloat(v.toPrecision(12))) : v; }
      function refresh() { Object.keys(inputs).forEach(function (a) { if (document.activeElement !== inputs[a]) show(a); }); }
      var bar = el('div', 'bar'), wrap = el('div', 'xgw'), tbl = el('table', 'xg'), head = el('tr'), st = el('div', 'bar', 'Type numbers or formulas such as =A1+B1 or =SUM(A1:A5). Functions: SUM, AVERAGE, MIN, MAX, COUNT, ABS, SQRT, ROUND.');
      head.appendChild(el('th')); for (var c = 0; c < COLS; c++) head.appendChild(el('th', '', String.fromCharCode(65 + c))); tbl.appendChild(head);
      for (var r = 0; r < ROWS; r++) {
        var tr = el('tr'); tr.appendChild(el('th', '', String(r + 1)));
        for (c = 0; c < COLS; c++) {
          (function (a, cc, rr) {
            var td = el('td'), inp = document.createElement('input'); inputs[a] = inp; inp.type = 'text';
            inp.onfocus = function () { inp.value = data[a] || ''; };
            inp.oninput = function () { if (inp.value === '') delete data[a]; else data[a] = inp.value; refresh(); };
            inp.onblur = function () { show(a); };
            inp.onkeydown = function (e) { if (e.key === 'Enter') { var nx = inputs[A(cc, rr + 1)]; if (nx) nx.focus(); } };
            td.appendChild(inp); tr.appendChild(td);
          })(A(c, r), c, r);
        }
        tbl.appendChild(tr);
      }
      var sh = officeShell(self, APPS.excel, opts, 'C:\\Documents\\', 'Book1.xls', function () { return JSON.stringify(data); });
      bar.append(sh.buttons[0], sh.buttons[1], sh.msg); wrap.appendChild(tbl); body.append(bar, wrap, st); refresh();
    }
  };

  APPS.powerpoint = {
    title: 'Microsoft Office PowerPoint', icon: '\uD83D\uDCFA', group: OFFG, w: 700, h: 470,
    build: function (body, self, opts) {
      var deck = loadJSON(opts, { slides: [{ t: 'Presentation title', b: 'Click to add text' }] }), cur = 0;
      if (!deck || !deck.slides || !deck.slides.length) deck = { slides: [{ t: '', b: '' }] };
      var bar = el('div', 'bar'), wrap = el('div', 'ppwrap'), side = el('div', 'ppside'), main = el('div', 'ppmain'), ti = el('div', 'pptitle'), tx = el('div', 'ppbody');
      ti.contentEditable = tx.contentEditable = 'true'; main.append(ti, tx); wrap.append(side, main);
      function store() { deck.slides[cur].t = ti.innerText; deck.slides[cur].b = tx.innerText; }
      function draw() {
        side.innerHTML = '';
        deck.slides.forEach(function (s, i) { var d = el('div', 'ppthumb' + (i === cur ? ' on' : '')); d.textContent = (i + 1) + '. ' + (s.t || '(blank)'); d.onclick = function () { store(); cur = i; draw(); }; side.appendChild(d); });
        ti.innerText = deck.slides[cur].t; tx.innerText = deck.slides[cur].b;
      }
      tbtn(bar, 'New slide', function () { store(); deck.slides.splice(cur + 1, 0, { t: '', b: '' }); cur++; draw(); });
      tbtn(bar, 'Delete slide', function () { if (deck.slides.length > 1) { deck.slides.splice(cur, 1); cur = Math.max(0, cur - 1); draw(); } });
      tbtn(bar, 'Slide Show', function () {
        store(); var i = cur, ov = el('div', 'ppshow'); ov.tabIndex = 0;
        function render() { ov.innerHTML = ''; var h = el('h1'), b = el('div'); h.textContent = deck.slides[i].t; b.textContent = deck.slides[i].b; ov.append(h, b); }
        function step(d) { var n = i + d; if (n < 0) return; if (n >= deck.slides.length) { ov.remove(); return; } i = n; render(); }
        ov.onclick = function () { step(1); };
        ov.onkeydown = function (e) { if (e.key === 'Escape') ov.remove(); else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') step(1); else if (e.key === 'ArrowLeft') step(-1); e.preventDefault(); e.stopPropagation(); };
        render(); body.appendChild(ov); ov.focus();
      });
      var sh = officeShell(self, APPS.powerpoint, opts, 'C:\\Documents\\', 'Presentation1.ppt', function () { store(); return JSON.stringify(deck); });
      bar.append(sh.buttons[0], sh.buttons[1], sh.msg); body.append(bar, wrap); draw();
    }
  };

  APPS.access = {
    title: 'Microsoft Office Access', icon: '\uD83D\uDD11', group: OFFG, w: 720, h: 460,
    build: function (body, self, opts) {
      var db = loadJSON(opts, { tables: { Contacts: { cols: ['Name', 'Phone'], rows: [['', '']] } } }), cur, sel = -1, q = '';
      if (!db || !db.tables || !Object.keys(db.tables).length) db = { tables: { Table1: { cols: ['Field1'], rows: [['']] } } };
      cur = Object.keys(db.tables)[0];
      var bar = el('div', 'bar'), wrap = el('div', 'acc'), side = el('div', 'accside'), main = el('div', 'accmain'), find = document.createElement('input');
      find.type = 'text'; find.placeholder = 'Find...'; find.oninput = function () { q = find.value.toLowerCase(); grid(); };
      function T() { return db.tables[cur]; }
      function tabs() { side.innerHTML = ''; Object.keys(db.tables).forEach(function (n) { var d = el('div', n === cur ? 'on' : ''); d.textContent = n; d.onclick = function () { cur = n; sel = -1; tabs(); grid(); }; side.appendChild(d); }); }
      function grid() {
        main.innerHTML = ''; var t = T(), tbl = el('table', 'dsh'), hr = el('tr'); hr.appendChild(el('th'));
        t.cols.forEach(function (c, ci) {
          var th = el('th'); th.textContent = c; th.title = 'Click to sort';
          th.onclick = function () { t.rows.sort(function (a, b) { return String(a[ci]).localeCompare(String(b[ci]), undefined, { numeric: true }); }); sel = -1; grid(); };
          hr.appendChild(th);
        });
        tbl.appendChild(hr);
        t.rows.forEach(function (r, ri) {
          if (q && r.join(' ').toLowerCase().indexOf(q) < 0) return;
          var tr = el('tr', ri === sel ? 'on' : ''), n = el('td', 'n', String(ri + 1)); n.onclick = function () { sel = ri; grid(); }; tr.appendChild(n);
          t.cols.forEach(function (c, ci) { var td = el('td'), inp = document.createElement('input'); inp.type = 'text'; inp.value = r[ci] || ''; inp.oninput = function () { r[ci] = inp.value; }; td.appendChild(inp); tr.appendChild(td); });
          tbl.appendChild(tr);
        });
        main.appendChild(tbl);
      }
      tbtn(bar, 'New table', function () {
        var n = (prompt('Table name:', 'Table' + (Object.keys(db.tables).length + 1)) || '').trim();
        if (!n || db.tables[n]) return; db.tables[n] = { cols: ['Field1'], rows: [['']] }; cur = n; sel = -1; tabs(); grid();
      });
      tbtn(bar, 'Add field', function () {
        var n = (prompt('Field name:', 'Field' + (T().cols.length + 1)) || '').trim(); if (!n) return;
        T().cols.push(n); T().rows.forEach(function (r) { r.push(''); }); grid();
      });
      tbtn(bar, 'Add record', function () { T().rows.push(T().cols.map(function () { return ''; })); grid(); });
      tbtn(bar, 'Delete record', function () { if (sel >= 0) { T().rows.splice(sel, 1); sel = -1; grid(); } });
      tbtn(bar, 'Delete table', function () {
        if (Object.keys(db.tables).length < 2) return;
        if (confirm('Delete table "' + cur + '"?')) { delete db.tables[cur]; cur = Object.keys(db.tables)[0]; sel = -1; tabs(); grid(); }
      });
      bar.appendChild(find);
      var sh = officeShell(self, APPS.access, opts, 'C:\\Documents\\', 'Database1.mdb', function () { return JSON.stringify(db); });
      bar.append(sh.buttons[0], sh.buttons[1], sh.msg); wrap.append(side, main); body.append(bar, wrap); tabs(); grid();
    }
  };

  APPS.onenote = {
    title: 'Microsoft Office OneNote', icon: '\uD83D\uDCD3', group: OFFG, w: 640, h: 440,
    build: function (body, self, opts) {
      var nb = loadJSON(opts, { pages: [{ t: 'Untitled page', b: '' }] }), cur = 0;
      if (!nb || !nb.pages || !nb.pages.length) nb = { pages: [{ t: 'Untitled page', b: '' }] };
      var bar = el('div', 'bar'), wrap = el('div', 'on-wrap'), side = el('div', 'on-side'), main = el('div', 'on-main'), ti = document.createElement('input'), ta = document.createElement('textarea');
      ti.type = 'text'; ti.placeholder = 'Page title'; main.append(ti, ta); wrap.append(side, main);
      function store() { nb.pages[cur].t = ti.value; nb.pages[cur].b = ta.value; }
      function list() { side.innerHTML = ''; nb.pages.forEach(function (p, i) { var d = el('div', i === cur ? 'on' : ''); d.textContent = p.t || '(untitled)'; d.onclick = function () { store(); cur = i; load2(); }; side.appendChild(d); }); }
      function load2() { ti.value = nb.pages[cur].t; ta.value = nb.pages[cur].b; list(); }
      ti.oninput = function () { store(); list(); };
      tbtn(bar, 'New page', function () { store(); nb.pages.push({ t: '', b: '' }); cur = nb.pages.length - 1; load2(); ti.focus(); });
      tbtn(bar, 'Delete page', function () { if (nb.pages.length > 1) { nb.pages.splice(cur, 1); cur = Math.max(0, cur - 1); load2(); } });
      var sh = officeShell(self, APPS.onenote, opts, 'C:\\Documents\\', 'Notebook.one', function () { store(); return JSON.stringify(nb); });
      bar.append(sh.buttons[0], sh.buttons[1], sh.msg); body.append(bar, wrap); load2();
    }
  };

  APPS.publisher = {
    title: 'Microsoft Office Publisher', icon: '\uD83D\uDCF0', group: OFFG, w: 680, h: 520,
    build: function (body, self, opts) {
      var doc = loadJSON(opts, { objs: [] }), sel = null, els = [];
      if (!doc || !Array.isArray(doc.objs)) doc = { objs: [] };
      var bar = el('div', 'bar'), wrap = el('div', 'pubwrap'), page = el('div', 'pubpage'), color = document.createElement('input'); color.type = 'color'; color.value = '#3b78c4';
      function okc(c) { return /^#[0-9a-f]{6}$/i.test(c) ? c : '#cccccc'; }
      function pick(o) { sel = o; els.forEach(function (d) { d.classList.toggle('sel', d._o === o); }); }
      function mk(o) {
        var d = el('div', 'pobj'), txt = el('span'), h = el('div', 'phandle'); d._o = o;
        function lay() { d.style.left = (+o.x || 0) + 'px'; d.style.top = (+o.y || 0) + 'px'; d.style.width = (+o.w || 80) + 'px'; d.style.height = (+o.h || 40) + 'px'; }
        lay(); d.style.fontSize = (+o.fs || 16) + 'px';
        if (o.k === 'text') { d.style.color = okc(o.c); d.style.background = 'transparent'; } else { d.style.background = okc(o.c); if (o.k === 'oval') d.style.borderRadius = '50%'; }
        txt.textContent = o.t || ''; d.append(txt, h);
        d.ondblclick = function () { txt.contentEditable = 'true'; txt.focus(); };
        txt.onblur = function () { o.t = txt.textContent; txt.contentEditable = 'false'; };
        d.onmousedown = function (e) {
          if (txt.isContentEditable && e.target === txt) return;
          pick(o); var sx = e.clientX, sy = e.clientY, ox = o.x, oy = o.y, ow = o.w, oh = o.h, rs = e.target === h;
          function mv(ev) { if (rs) { o.w = Math.max(20, ow + ev.clientX - sx); o.h = Math.max(16, oh + ev.clientY - sy); } else { o.x = ox + ev.clientX - sx; o.y = oy + ev.clientY - sy; } lay(); }
          function up() { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); }
          document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); e.preventDefault(); e.stopPropagation();
        };
        return d;
      }
      function render() { page.innerHTML = ''; els = []; doc.objs.forEach(function (o) { var d = mk(o); els.push(d); page.appendChild(d); }); pick(sel); }
      function add(k) { var o = { k: k, x: 40 + doc.objs.length * 12, y: 40 + doc.objs.length * 12, w: k === 'text' ? 200 : 120, h: k === 'text' ? 40 : 80, c: color.value, t: k === 'text' ? 'Text' : '', fs: 16 }; doc.objs.push(o); var d = mk(o); els.push(d); page.appendChild(d); pick(o); }
      function chg(fn) { if (sel) { fn(sel); var s = sel; render(); pick(s); } }
      tbtn(bar, 'Text box', function () { add('text'); }); tbtn(bar, 'Rectangle', function () { add('rect'); }); tbtn(bar, 'Oval', function () { add('oval'); });
      bar.appendChild(color); color.oninput = function () { chg(function (o) { o.c = color.value; }); };
      tbtn(bar, 'A+', function () { chg(function (o) { o.fs = Math.min(72, (+o.fs || 16) + 2); }); });
      tbtn(bar, 'A-', function () { chg(function (o) { o.fs = Math.max(8, (+o.fs || 16) - 2); }); });
      tbtn(bar, 'Delete', function () { if (sel) { doc.objs.splice(doc.objs.indexOf(sel), 1); sel = null; render(); } });
      page.onmousedown = function (e) { if (e.target === page) pick(null); };
      var sh = officeShell(self, APPS.publisher, opts, 'C:\\Documents\\', 'Publication1.pub', function () { return JSON.stringify(doc); });
      bar.append(sh.buttons[0], sh.buttons[1], sh.msg); wrap.appendChild(page); body.append(bar, wrap); render();
    }
  };

  APPS.infopath = {
    title: 'Microsoft Office InfoPath', icon: '\uD83D\uDCCB', group: OFFG, w: 620, h: 460,
    build: function (body, self, opts) {
      var form = loadJSON(opts, { fields: [{ n: 'Name', t: 'text' }, { n: 'Date', t: 'date' }], recs: [] }), mode = 'fill';
      if (!form || !Array.isArray(form.fields) || !Array.isArray(form.recs)) form = { fields: [{ n: 'Name', t: 'text' }], recs: [] };
      var bar = el('div', 'bar'), area = el('div', 'ofm'), TYPES = ['text', 'number', 'date', 'checkbox'];
      function render() {
        area.innerHTML = '';
        if (mode === 'design') {
          area.appendChild(el('h3', '', 'Design the form'));
          form.fields.forEach(function (f, i) {
            var row = el('div'), n = document.createElement('input'), s = document.createElement('select'), x = el('button', '', 'Remove');
            n.type = 'text'; n.value = f.n; n.oninput = function () { f.n = n.value; };
            TYPES.forEach(function (t) { var o = document.createElement('option'); o.value = o.textContent = t; if (t === f.t) o.selected = true; s.appendChild(o); });
            s.onchange = function () { f.t = s.value; }; x.onclick = function () { form.fields.splice(i, 1); render(); };
            row.append(n, s, x); area.appendChild(row);
          });
          var add = el('button', '', 'Add field'); add.onclick = function () { form.fields.push({ n: 'Field' + (form.fields.length + 1), t: 'text' }); render(); }; area.appendChild(add);
        } else if (mode === 'fill') {
          area.appendChild(el('h3', '', 'Fill out the form')); var ctr = [];
          form.fields.forEach(function (f) {
            var l = el('label'), c = document.createElement('input'); c.type = TYPES.indexOf(f.t) >= 0 ? f.t : 'text'; l.appendChild(document.createTextNode(f.n + ': ')); l.appendChild(c); ctr.push(c); area.appendChild(l);
          });
          var sub2 = el('button', '', 'Submit'), m = el('span', '', ''); m.style.marginLeft = '8px';
          sub2.onclick = function () {
            var rec = {}; form.fields.forEach(function (f, i) { rec[f.n] = ctr[i].type === 'checkbox' ? (ctr[i].checked ? 'Yes' : 'No') : ctr[i].value; });
            form.recs.push(rec); ctr.forEach(function (c) { if (c.type === 'checkbox') c.checked = false; else c.value = ''; }); m.textContent = 'Submitted. Remember to Save the form to keep the responses.';
          };
          area.append(sub2, m);
        } else {
          area.appendChild(el('h3', '', 'Responses (' + form.recs.length + ')'));
          var tbl = el('table'), hr = el('tr'); form.fields.forEach(function (f) { var th = el('th'); th.textContent = f.n; hr.appendChild(th); }); tbl.appendChild(hr);
          form.recs.forEach(function (r) { var tr = el('tr'); form.fields.forEach(function (f) { var td = el('td'); td.textContent = r[f.n] === undefined ? '' : r[f.n]; tr.appendChild(td); }); tbl.appendChild(tr); });
          area.appendChild(tbl); var clr = el('button', '', 'Clear responses'); clr.onclick = function () { if (confirm('Delete all responses?')) { form.recs = []; render(); } }; area.appendChild(clr);
        }
      }
      ['design', 'fill', 'data'].forEach(function (m) { tbtn(bar, m === 'design' ? 'Design' : m === 'fill' ? 'Fill out' : 'Responses', function () { mode = m; render(); }); });
      var sh = officeShell(self, APPS.infopath, opts, 'C:\\Documents\\', 'Form1.xsn', function () { return JSON.stringify(form); });
      bar.append(sh.buttons[0], sh.buttons[1], sh.msg); body.append(bar, area); render();
    }
  };

  APPS.groove = {
    title: 'Microsoft Office Groove', icon: '\uD83D\uDC65', group: OFFG, w: 640, h: 440,
    build: function (body) {
      var G = load('groove', { ws: [{ n: 'My Workspace', files: [], msgs: [] }] }), cur = 0, tab = 'chat';
      if (!G.ws || !G.ws.length) G = { ws: [{ n: 'My Workspace', files: [], msgs: [] }] };
      var bar = el('div', 'bar'), wrap = el('div', 'on-wrap'), side = el('div', 'on-side'), main = el('div', 'ofm');
      function persist() { save('groove', G); }
      function W() { return G.ws[cur]; }
      function draw() {
        side.innerHTML = ''; G.ws.forEach(function (w, i) { var d = el('div', i === cur ? 'on' : ''); d.textContent = w.n; d.onclick = function () { cur = i; draw(); }; side.appendChild(d); });
        main.innerHTML = ''; var note = el('div', 'hint', 'Workspaces here live only on this computer. A web page has no server to share them with other people.'); main.appendChild(note);
        if (tab === 'chat') {
          W().msgs.forEach(function (m) { var d = el('div'); d.textContent = '[' + m.time + '] You: ' + m.t; main.appendChild(d); });
          var inp = document.createElement('input'), go = el('button', '', 'Post'); inp.type = 'text'; inp.style.minWidth = '260px';
          function post() { if (!inp.value.trim()) return; W().msgs.push({ t: inp.value.trim(), time: new Date().toLocaleString() }); persist(); draw(); }
          go.onclick = post; inp.onkeydown = function (e) { if (e.key === 'Enter') post(); }; main.append(inp, go);
        } else {
          W().files.forEach(function (p, i) {
            var d = el('div'), o = el('button', '', 'Open'), r = el('button', '', 'Remove'), n = vfind(p.split(/[\\\/]+/).filter(Boolean));
            d.appendChild(document.createTextNode('C:\\' + p + (n ? '  ' : '  (missing)  ')));
            o.onclick = function () { var f = vfind(p.split(/[\\\/]+/).filter(Boolean)); if (f && !f.kids) openFileNode(p.split('\\').pop(), f, (vfind(p.split(/[\\\/]+/).filter(Boolean).slice(0, -1)) || {}).kids); };
            r.onclick = function () { W().files.splice(i, 1); persist(); draw(); }; d.append(o, r); main.appendChild(d);
          });
          if (!W().files.length) main.appendChild(el('div', '', 'No files in this workspace yet.'));
        }
      }
      tbtn(bar, 'New workspace', function () { var n = (prompt('Workspace name:', 'Workspace ' + (G.ws.length + 1)) || '').trim(); if (n) { G.ws.push({ n: n, files: [], msgs: [] }); cur = G.ws.length - 1; persist(); draw(); } });
      tbtn(bar, 'Discussion', function () { tab = 'chat'; draw(); }); tbtn(bar, 'Files', function () { tab = 'files'; draw(); });
      tbtn(bar, 'Add file', function () {
        var s = prompt('Path of a file on C: (for example C:\\Documents\\Welcome.txt):', 'C:\\Documents\\'); if (!s) return;
        var parts = s.replace(/^[a-zA-Z]:/, '').split(/[\\\/]+/).filter(Boolean), n = vfind(parts);
        if (!n || n.kids) { alert('That file does not exist on C:.'); return; }
        W().files.push(parts.join('\\')); tab = 'files'; persist(); draw();
      });
      wrap.append(side, main); body.append(bar, wrap); draw();
    }
  };

  APPS.selfcert = {
    title: 'Digital Certificate for VBA Projects', icon: '\uD83D\uDD10', group: OFFG, w: 520, h: 420,
    build: function (body) {
      var certs = load('certs', []), p = el('div', 'ofm'), name = document.createElement('input'), go = el('button', '', 'Create'), msg = el('div', 'hint'), list = el('div');
      name.type = 'text'; name.value = 'My Certificate'; name.style.minWidth = '240px';
      p.append(el('h3', '', 'Create Digital Certificate'), el('div', 'hint', 'This makes a demonstration certificate record with a real public-key fingerprint generated by your browser. It is not an X.509 certificate and cannot sign real VBA projects.'),
        el('label', '', 'Your certificate\'s name:'), name, go, msg, el('h3', '', 'Certificates'), list);
      function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
      function draw() {
        list.innerHTML = '';
        certs.forEach(function (c, i) {
          var d = el('div'), x = el('button', '', 'Delete'); d.style.margin = '6px 0';
          d.textContent = c.n + '  created ' + c.on + ', expires ' + c.exp + '  fingerprint ' + c.fp.slice(0, 32).replace(/(.{4})/g, '$1 ') + '  ';
          x.onclick = function () { certs.splice(i, 1); save('certs', certs); draw(); }; d.appendChild(x); list.appendChild(d);
        });
        if (!certs.length) list.textContent = 'No certificates yet.';
      }
      go.onclick = function () {
        var n = name.value.trim(); if (!n) { msg.textContent = 'Enter a name first.'; return; }
        if (!window.crypto || !crypto.subtle) { msg.textContent = 'This browser cannot create keys on this page.'; return; }
        msg.textContent = 'Creating...';
        crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
          .then(function (kp) { return crypto.subtle.exportKey('spki', kp.publicKey); })
          .then(function (spki) { return crypto.subtle.digest('SHA-256', spki); })
          .then(function (h) {
            var d = new Date(), e = new Date(d.getTime() + 365 * 864e5);
            certs.push({ n: n, on: d.toLocaleDateString(), exp: e.toLocaleDateString(), fp: hex(h) }); save('certs', certs); msg.textContent = 'Created "' + n + '".'; draw();
          }).catch(function (err) { msg.textContent = 'Could not create the certificate: ' + err.message; });
      };
      body.appendChild(p); draw();
    }
  };

  APPS.clip = {
    title: 'Microsoft Clip Organizer', icon: '\uD83D\uDCCE', group: OFFG, w: 560, h: 420,
    build: function (body) {
      var CLIPS = {
        Animals: [['\uD83D\uDC36', 'dog puppy pet'], ['\uD83D\uDC31', 'cat kitten pet'], ['\uD83D\uDC2D', 'mouse rodent'], ['\uD83D\uDC30', 'rabbit bunny'], ['\uD83D\uDC3B', 'bear'], ['\uD83D\uDC38', 'frog'], ['\uD83D\uDC14', 'chicken bird'], ['\uD83D\uDC1F', 'fish']],
        Food: [['\uD83C\uDF4E', 'apple fruit'], ['\uD83C\uDF4C', 'banana fruit'], ['\uD83C\uDF55', 'pizza'], ['\uD83C\uDF54', 'burger'], ['\uD83C\uDF70', 'cake dessert'], ['\u2615', 'coffee drink']],
        Objects: [['\uD83D\uDCA1', 'idea bulb light'], ['\uD83D\uDCF1', 'phone mobile'], ['\uD83D\uDCBB', 'laptop computer'], ['\uD83D\uDCF7', 'camera photo'], ['\uD83C\uDF81', 'gift present'], ['\uD83D\uDD11', 'key'], ['\u23F0', 'clock alarm time']],
        Symbols: [['\u2B50', 'star'], ['\u2764', 'heart love'], ['\u2714', 'check tick yes'], ['\u2716', 'cross no'], ['\u26A0', 'warning'], ['\u2709', 'mail letter envelope'], ['\u2600', 'sun weather'], ['\u2601', 'cloud weather']],
        Nature: [['\uD83C\uDF33', 'tree'], ['\uD83C\uDF38', 'flower blossom'], ['\uD83C\uDF19', 'moon night'], ['\uD83D\uDD25', 'fire flame'], ['\uD83C\uDF0A', 'wave sea water']]
      };
      var cat = 'All', q = '', chosen = null, bar = el('div', 'bar'), wrap = el('div', 'on-wrap'), side = el('div', 'on-side'), main = el('div', 'ofm'), find = document.createElement('input');
      find.type = 'text'; find.placeholder = 'Search for clips...'; find.oninput = function () { q = find.value.toLowerCase(); draw(); }; bar.appendChild(find);
      function all() { var o = []; Object.keys(CLIPS).forEach(function (k) { if (cat === 'All' || cat === k) CLIPS[k].forEach(function (c) { if (!q || c[1].indexOf(q) >= 0) o.push(c); }); }); return o; }
      function draw() {
        side.innerHTML = ''; ['All'].concat(Object.keys(CLIPS)).forEach(function (k) { var d = el('div', k === cat ? 'on' : ''); d.textContent = k; d.onclick = function () { cat = k; draw(); }; side.appendChild(d); });
        main.innerHTML = ''; var g = el('div', 'clips'), l = all();
        l.forEach(function (c) { var b = el('div', 'clip' + (chosen === c ? ' on' : '')); b.textContent = c[0]; b.title = c[1]; b.onclick = function () { chosen = c; draw(); }; g.appendChild(b); });
        if (!l.length) g.textContent = 'No clips match your search.'; main.appendChild(g);
        if (chosen) {
          var cp = el('button', '', 'Copy'), sv = el('button', '', 'Save to Pictures'), m = el('span', '', ''); m.style.marginLeft = '8px';
          cp.onclick = function () {
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(chosen[0]).then(function () { m.textContent = 'Copied.'; }, function () { m.textContent = 'Copy was blocked.'; });
            else { var t = document.createElement('textarea'); t.value = chosen[0]; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); m.textContent = 'Copied.'; } catch (e) { m.textContent = 'Copy was blocked.'; } t.remove(); }
          };
          sv.onclick = function () {
            var cv = document.createElement('canvas'); cv.width = cv.height = 128; var x = cv.getContext('2d');
            x.font = '96px "Segoe UI Emoji","Segoe UI Symbol",Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#000'; x.fillText(chosen[0], 64, 70);
            var err = vwrite(['Pictures', chosen[1].split(' ')[0] + '.png'], cv.toDataURL('image/png'), 'data'); m.textContent = err ? (err === 'cancelled' ? '' : err) : 'Saved to C:\\Pictures';
          };
          var pv = el('div'); pv.style.cssText = 'font-size:72px;margin:8px 0'; pv.textContent = chosen[0]; main.append(pv, cp, sv, m);
        }
      }
      wrap.append(side, main); body.append(bar, wrap); draw();
    }
  };

  APPS.langs = {
    title: 'Microsoft Office Language Settings', icon: '\uD83D\uDD24', group: OFFG, w: 440, h: 340,
    build: function (body) {
      var p = el('div', 'ofm'), msg = el('div', 'hint');
      function sel(cur) { var s = document.createElement('select'); LANGS.forEach(function (l) { var o = document.createElement('option'); o.value = l[0]; o.textContent = l[1]; if (l[0] === cur) o.selected = true; s.appendChild(o); }); return s; }
      var disp = sel(cfg.lang || 'en-US'), edit = sel(cfg.editLang || 'en-US'), ok = el('button', '', 'OK');
      var l1 = el('label', '', 'Display language (calendar and date names):'), l2 = el('label', '', 'Editing language (spell checking in Word):');
      l1.appendChild(document.createElement('br')); l1.appendChild(disp); l2.appendChild(document.createElement('br')); l2.appendChild(edit);
      ok.onclick = function () { cfg.lang = disp.value; cfg.editLang = edit.value; saveCfg(); tick(); msg.textContent = 'Saved. New Word documents use the editing language; the calendar uses the display language.'; };
      p.append(el('h3', '', 'Enabled languages'), l1, l2, ok, msg, el('div', 'hint', 'Menus and buttons stay in English. Spell checking depends on the dictionaries your browser has for the chosen language.'));
      body.appendChild(p);
    }
  };

  APPS.diag = {
    title: 'Microsoft Office Diagnostics', icon: '\uD83D\uDD27', group: OFFG, w: 560, h: 440,
    build: function (body) {
      var bar = el('div', 'bar'), area = el('div', 'ofm'), report = '';
      function run() {
        var rows = [];
        function add(ok, n, d) { rows.push({ ok: ok, n: n, d: d }); }
        var ls = false; try { localStorage.setItem('w7.diag', '1'); ls = localStorage.getItem('w7.diag') === '1'; localStorage.removeItem('w7.diag'); } catch (e) {}
        add(ls ? 1 : -1, 'Browser storage', ls ? 'Reading and writing works.' : 'Cannot write to browser storage, so nothing will be saved.');
        var kb = Math.round(JSON.stringify(vfs).length / 1024); add(kb < 200000 ? 1 : 0, 'Virtual C: drive', fmtSize(kb * 1024) + ' of files and settings are kept in memory while the desktop is open' + (kb >= 200000 ? ' (a lot for a computer with little RAM).' : '.'));
        var total = 0, bad = [], pics = 0;
        (function walk(nd, path) {
          Object.keys(nd.kids).forEach(function (k) {
            var c = nd.kids[k]; if (c.kids) { walk(c, path.concat(k)); return; }
            var m = /\.(\w+)$/.exec(k), ext = m ? m[1].toLowerCase() : ''; if (c.data) pics++;
            if (EXT[ext] && !c.file) { total++; if (ext !== 'doc' && c.text) { try { JSON.parse(c.text); } catch (e) { bad.push(k); } } }
          });
        })(vfs, []);
        add(bad.length ? 0 : 1, 'Office files', total + ' file(s) found' + (bad.length ? '. These cannot be read: ' + bad.join(', ') : '. All can be read.'));
        add(1, 'Pictures', pics + ' picture(s) on the virtual drive.');
        var nb = Object.keys(usedKeys()).length; add(window.indexedDB ? 1 : (nb ? -1 : 0), 'Imported files', window.indexedDB ? nb + ' file(s), ' + fmtSize(blobBytes()) + ' stored separately.' : 'This browser cannot store large imported files.');
        add(window.showDirectoryPicker ? 1 : 0, 'Open real folders', window.showDirectoryPicker ? 'Supported.' : 'Not supported by this browser.');
        add(navigator.clipboard ? 1 : 0, 'Clipboard', navigator.clipboard ? 'Available.' : 'Limited. Copy may be blocked.');
        add(window.crypto && crypto.subtle ? 1 : 0, 'Certificates (secure crypto)', window.crypto && crypto.subtle ? 'Available.' : 'Not available on this page.');
        add(window.AudioContext || window.webkitAudioContext ? 1 : 0, 'Sound', window.AudioContext || window.webkitAudioContext ? 'Available.' : 'Not available.');
        add(navigator.onLine ? 1 : 0, 'Network', navigator.onLine ? 'The browser reports online.' : 'The browser reports no network.');
        add(screen.width >= 1024 ? 1 : 0, 'Screen', screen.width + ' x ' + screen.height + (screen.width < 1024 ? ' (small; some windows may not fit).' : '.'));
        area.innerHTML = ''; report = 'Office Diagnostics report\n';
        rows.forEach(function (r) {
          var d = el('div'), s = r.ok > 0 ? '[OK]   ' : r.ok === 0 ? '[WARN] ' : '[FAIL] '; d.style.margin = '4px 0'; d.textContent = s + r.n + ': ' + r.d; area.appendChild(d); report += s + r.n + ': ' + r.d + '\n';
        });
        storageInfo(function (u, q) {
          if (!q) return; var d = el('div'), s = u / q < 0.8 ? '[OK]   ' : '[WARN] '; d.style.margin = '4px 0';
          d.textContent = s + 'Browser storage: ' + fmtSize(u) + ' used of ' + fmtSize(q) + ' allowed.'; area.appendChild(d); report += d.textContent + '\n';
        });
      }
      tbtn(bar, 'Run again', run);
      tbtn(bar, 'Copy report', function () {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(report);
        else { var t = document.createElement('textarea'); t.value = report; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e) {} t.remove(); }
      });
      body.append(bar, area); run();
    }
  };

  APPS.picman = {
    title: 'Microsoft Office Picture Manager', icon: '\uD83D\uDCF7', group: OFFG, w: 700, h: 480,
    build: function (body, self) {
      var bar = el('div', 'bar'), wrap = el('div', 'pmwrap'), side = el('div', 'pmside'), main = el('div', 'pmmain'), cv = document.createElement('canvas'), g = cv.getContext('2d'), msg = el('span', '', ''), cur = null, hist = [];
      msg.style.cssText = 'margin-left:auto;color:#345';
      function pics() {
        var out = []; (function walk(nd, path) { Object.keys(nd.kids).sort().forEach(function (k) { var c = nd.kids[k]; if (c.kids) walk(c, path.concat(k)); else if (c.data) out.push({ name: k, node: c, path: path.concat(k) }); }); })(vfs.kids.Pictures && vfs.kids.Pictures.kids ? vfs.kids.Pictures : { kids: {} }, ['Pictures']);
        return out;
      }
      function drawSide() {
        side.innerHTML = ''; var l = pics(); if (!l.length) side.textContent = 'No pictures in C:\\Pictures. Save one from Paint.';
        l.forEach(function (p) { var im = new Image(); im.src = p.node.data; im.title = p.name; im.className = cur && cur.node === p.node ? 'on' : ''; im.onclick = function () { open(p); }; side.appendChild(im); });
      }
      function open(p) { var im = new Image(); im.onload = function () { cv.width = im.width; cv.height = im.height; g.drawImage(im, 0, 0); cur = p; hist = []; msg.textContent = p.name + ' (' + im.width + ' x ' + im.height + ')'; drawSide(); }; im.src = p.node.data; }
      function tr(fn) { if (!cur) { msg.textContent = 'Pick a picture first.'; return; } if (hist.length > 5) hist.shift(); hist.push(g.getImageData(0, 0, cv.width, cv.height)); fn(); }
      function rot(dir) { tr(function () { var w = cv.width, h = cv.height, t = document.createElement('canvas'); t.width = h; t.height = w; var x = t.getContext('2d'); x.translate(h / 2, w / 2); x.rotate(dir * Math.PI / 2); x.drawImage(cv, -w / 2, -h / 2); cv.width = h; cv.height = w; g.drawImage(t, 0, 0); }); }
      function flip(h) { tr(function () { var w = cv.width, ht = cv.height, t = document.createElement('canvas'); t.width = w; t.height = ht; t.getContext('2d').drawImage(cv, 0, 0); g.save(); g.clearRect(0, 0, w, ht); if (h) { g.translate(w, 0); g.scale(-1, 1); } else { g.translate(0, ht); g.scale(1, -1); } g.drawImage(t, 0, 0); g.restore(); }); }
      function pix(f) { tr(function () { var d = g.getImageData(0, 0, cv.width, cv.height), a = d.data; for (var i = 0; i < a.length; i += 4) f(a, i); g.putImageData(d, 0, 0); }); }
      function cl(v) { return Math.max(0, Math.min(255, v)); }
      tbtn(bar, 'Rotate left', function () { rot(-1); }); tbtn(bar, 'Rotate right', function () { rot(1); });
      tbtn(bar, 'Flip horizontal', function () { flip(true); }); tbtn(bar, 'Flip vertical', function () { flip(false); });
      tbtn(bar, 'Brighter', function () { pix(function (a, i) { a[i] = cl(a[i] + 20); a[i + 1] = cl(a[i + 1] + 20); a[i + 2] = cl(a[i + 2] + 20); }); });
      tbtn(bar, 'Darker', function () { pix(function (a, i) { a[i] = cl(a[i] - 20); a[i + 1] = cl(a[i + 1] - 20); a[i + 2] = cl(a[i + 2] - 20); }); });
      tbtn(bar, 'Grayscale', function () { pix(function (a, i) { var v = a[i] * 0.3 + a[i + 1] * 0.59 + a[i + 2] * 0.11; a[i] = a[i + 1] = a[i + 2] = v; }); });
      tbtn(bar, 'Undo', function () { if (hist.length) { var d = hist.pop(); cv.width = d.width; cv.height = d.height; g.putImageData(d, 0, 0); } });
      tbtn(bar, 'Save', function () {
        if (!cur) { msg.textContent = 'Pick a picture first.'; return; }
        vsaveFn(cur.node, 'data')(cv.toDataURL('image/png')).then(function () { msg.textContent = 'Saved ' + cur.name; drawSide(); }).catch(function (e) { msg.textContent = 'Save failed: ' + e.message; });
      });
      tbtn(bar, 'Save as...', function () {
        if (!cur) { msg.textContent = 'Pick a picture first.'; return; }
        var parts = askPath('C:\\Pictures\\' + cur.name.replace(/\.png$/i, '') + ' edited.png'); if (!parts) return;
        var err = vwrite(parts, cv.toDataURL('image/png'), 'data'); if (err) { if (err !== 'cancelled') msg.textContent = err; return; }
        cur = { name: parts[parts.length - 1], node: vget(parts), path: parts }; msg.textContent = 'Saved ' + cur.name; drawSide();
      });
      tbtn(bar, 'Refresh', drawSide); bar.appendChild(msg);
      main.appendChild(cv); wrap.append(side, main); body.append(bar, wrap); drawSide(); var first = pics()[0]; if (first) open(first);
    }
  };

  APPS.office = {
    title: 'Microsoft Office', icon: '\uD83D\uDCBC', w: 560, h: 340,
    build: function (body) {
      var g = el('div', 'offgrid');
      OFFLIST.forEach(function (id) {
        var d = el('div', 'offi'), s = el('span'); s.textContent = APPS[id].icon; d.appendChild(s); d.appendChild(document.createTextNode(APPS[id].title.replace('Microsoft Office ', '').replace('Microsoft ', '')));
        d.ondblclick = function () { openApp(id); }; d.title = 'Double-click to open'; g.appendChild(d);
      });
      body.appendChild(g);
    }
  };

  /* ---------- files of any type: stored as blobs in IndexedDB, referenced from the virtual drive ---------- */
  var blobFlag = load('blobs', false), importing = 0, gcT = 0, idbP = null;
  function idb() {
    if (!idbP) idbP = new Promise(function (res, rej) {
      var r = indexedDB.open('w7files', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('blobs'); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
    return idbP;
  }
  function idbPut(key, blob) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('blobs', 'readwrite'); tx.objectStore('blobs').put(blob, key);
        tx.oncomplete = function () { res(); }; tx.onerror = tx.onabort = function () { rej(tx.error || new Error('no room')); };
      });
    });
  }
  function idbGet(key) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) { var q = db.transaction('blobs', 'readonly').objectStore('blobs').get(key); q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); }; });
    });
  }
  function eachNode(cb) {
    function w(n) { Object.keys(n.kids).forEach(function (k) { var c = n.kids[k]; if (c.kids) w(c); else cb(c); }); }
    w(vfs); (vfs.bin || []).forEach(function (e) { if (e.node.kids) w(e.node); else cb(e.node); });
  }
  function usedKeys() { var s = {}; eachNode(function (c) { if (c.file) s[c.file] = 1; }); return s; }
  function blobBytes() { var t = 0; eachNode(function (c) { if (c.file) t += c.size || 0; }); return t; }
  function storageInfo(cb) {
    try { if (navigator.storage && navigator.storage.estimate) { navigator.storage.estimate().then(function (e) { cb(e.usage || 0, e.quota || 0); }, function () { cb(0, 0); }); return; } } catch (e) {}
    cb(0, 0);
  }
  function fmtSize(b) { return b < 1024 ? b + ' bytes' : b < 1048576 ? Math.round(b / 1024) + ' KB' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1073741824).toFixed(2) + ' GB'; }
  function scheduleGC() { if (!blobFlag || !window.indexedDB) return; clearTimeout(gcT); gcT = setTimeout(idbGC, 1500); }
  function idbGC() {
    if (importing || vDirty || !vReady) { if (++gcTries < 20) scheduleGC(); return; }
    gcTries = 0;
    idb().then(function (db) {
      var tx = db.transaction('blobs', 'readwrite'), st = tx.objectStore('blobs'), rq = st.getAllKeys();
      rq.onsuccess = function () { var used = usedKeys(); rq.result.forEach(function (k) { if (!used[k] && k !== '__vfs') st.delete(k); }); };
    }).catch(function () {});
  }
  function dataToBlob(u) {
    var m = /^data:([^;,]*)(;base64)?,(.*)$/.exec(u || ''); if (!m) return new Blob([]);
    var bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]), a = new Uint8Array(bin.length), i; for (i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return new Blob([a], { type: m[1] || 'application/octet-stream' });
  }
  function exportNode(name, n) {
    function dl(b) { var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000); }
    if (n.file) idbGet(n.file).then(function (b) { if (b) dl(b); else toast('The file data is missing.'); }, function () { toast('The file could not be read.'); });
    else if (n.data) dl(dataToBlob(n.data));
    else dl(new Blob([n.text || ''], { type: 'text/plain' }));
  }
  function openBlobNode(name, f, dir) {
    var t = f.type || '';
    if (/^image\//.test(t) && t !== 'image/svg+xml') { openApp('photoviewer', { name: name, node: f, dir: dir || null }); return; }
    var w = /^(application\/pdf|audio\/|video\/)/.test(t) ? window.open('', '_blank') : null;
    if (!w) { exportNode(name, f); toast('This type of file cannot be opened here. A copy was saved to your computer.'); return; }
    idbGet(f.file).then(function (b) {
      if (!b) { w.close(); toast('The file data is missing.'); return; }
      var url = URL.createObjectURL(new Blob([b], { type: t })); w.opener = null; w.location.href = url; setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
    }, function () { w.close(); toast('The file could not be read.'); });
  }
  function iconFor(name, n, dir) {
    if (dir || (n && n.kids)) return '\uD83D\uDCC1';
    if (n && n.data) return '\uD83D\uDDBC\uFE0F';
    var m = /\.(\w+)$/.exec(name), ext = m ? m[1].toLowerCase() : '', t = (n && n.type) || '';
    if (n && n.file) {
      if (/^image\//.test(t)) return '\uD83D\uDDBC\uFE0F'; if (/^audio\//.test(t)) return '\uD83C\uDFB5'; if (/^video\//.test(t)) return '\uD83C\uDFAC';
      if (ext === 'pdf') return '\uD83D\uDCD5'; if (/^(zip|rar|7z|gz|tar)$/.test(ext)) return '\uD83D\uDCE6'; return '\uD83D\uDCC4';
    }
    return EXT[ext] ? APPS[EXT[ext]].icon : '\uD83D\uDCC4';
  }

  /* ---------- Importing files from the real computer, and files on the desktop ---------- */
  function deskDir() { if (!vfs.kids.Desktop || !vfs.kids.Desktop.kids) vfs.kids.Desktop = { kids: {} }; return vfs.kids.Desktop; }
  function importFiles(files, dest, done) {
    if (dest.length === 1 && dest[0] === 'Desktop') deskDir();
    var dir = vfind(dest);
    if (!dir || !dir.kids) { done('That folder no longer exists.'); return; }
    var list = Array.prototype.slice.call(files), ok = 0, skipped = [];
    function uniq(name) {
      name = name.replace(/[\\\/:*?"<>|]/g, '_'); if (!dir.kids[name]) return name;
      var m = /^(.*?)(\.[^.]*)?$/.exec(name), i = 2; while (dir.kids[m[1] + ' (' + i + ')' + (m[2] || '')]) i++;
      return m[1] + ' (' + i + ')' + (m[2] || '');
    }
    (function next() {
      var f = list.shift();
      if (!f) { done(ok + ' file(s) imported' + (skipped.length ? '. Skipped: ' + skipped.join('; ') : '.')); return; }
      var ext = (/\.(\w+)$/.exec(f.name) || [])[1] || '', img = /^image\//.test(f.type);
      var text = !img && (/^text\//.test(f.type) || /^(txt|md|csv|json|js|css|html?|xml|log|ini|bat|cmd|ps1)$/i.test(ext));
      if ((img || text) && f.size <= 1048576) {
        var r = new FileReader();
        r.onload = function () {
          var name = uniq(f.name); dir.kids[name] = img ? { data: r.result } : { text: r.result };
          if (vsave()) ok++; else { delete dir.kids[name]; skipped.push(f.name + ' (not enough storage space)'); }
          next();
        };
        r.onerror = function () { skipped.push(f.name + ' (could not be read)'); next(); };
        if (img) r.readAsDataURL(f); else r.readAsText(f);
        return;
      }
      if (!window.indexedDB) { skipped.push(f.name + ' (this browser cannot store large files)'); next(); return; }
      var key = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      importing++; blobFlag = true; save('blobs', true);
      idbPut(key, f).then(function () {
        var name = uniq(f.name); dir.kids[name] = { file: key, size: f.size, type: f.type || 'application/octet-stream' };
        if (vsave()) ok++; else { delete dir.kids[name]; skipped.push(f.name + ' (not enough storage space)'); }
      }).catch(function () { skipped.push(f.name + ' (the browser could not store it)'); }).then(function () { importing--; next(); });
    })();
  }
  function pickFiles(dest, after) {
    var inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true;
    inp.onchange = function () { if (!inp.files.length) return; importFiles(inp.files, dest, function (m) { toast(m); if (after) after(m); }); };
    inp.click();
  }
  function deskNew(kind) {
    var dd = deskDir(), base = kind === 'folder' ? 'New folder' : 'New Text Document.txt', n = base, i = 2;
    while (dd.kids[n]) { n = kind === 'folder' ? base + ' (' + i + ')' : 'New Text Document (' + i + ').txt'; i++; }
    dd.kids[n] = kind === 'folder' ? { kids: {} } : { text: '' };
    if (!vsave()) { delete dd.kids[n]; toast('Not enough browser storage space.'); }
  }
  function renderDesk() {
    var d = $('#desktop'), old = d.querySelectorAll('.dfile'), i;
    for (i = 0; i < old.length; i++) old[i].remove();
    var dd = vfs.kids.Desktop; if (!dd || !dd.kids) return;
    Object.keys(dd.kids).sort(function (a, b) { return (!!dd.kids[b].kids - !!dd.kids[a].kids) || a.localeCompare(b); }).forEach(function (name) {
      var n = dd.kids[name], ic = iconFor(name, n);
      var it = el('div', 'icon dfile'), s = el('span'); s.textContent = ic; it.title = n.size ? name + ' (' + fmtSize(n.size) + ')' : name; it.append(s, document.createTextNode(name));
      function open() { if (n.kids) openApp('explorer', { path: ['Desktop', name] }); else openFileNode(name, n, dd.kids); }
      it.addEventListener('click', function (e) { clearSel(); it.classList.add('sel'); e.stopPropagation(); });
      it.addEventListener('dblclick', open);
      it.addEventListener('contextmenu', function (e) {
        e.stopPropagation(); clearSel(); it.classList.add('sel');
        var items = [['Open', open]];
        if (n.data) items.push(['Edit with Paint', function () { editInPaint(name, n); }]);
        if (!n.kids) items.push(['Save a copy to this computer', function () { exportNode(name, n); }]);
        items.push('-', ['Cut', function () { fsCopy(['Desktop', name], true); }], ['Copy', function () { fsCopy(['Desktop', name], false); }]);
        if (n.kids) items.push(['Paste', function () { fsPaste(['Desktop', name]); }, !fileClip]);
        items.push('-', ['Rename', function () {
          var nn = (prompt('New name:', name) || '').trim(); if (!nn || nn === name) return;
          if (/[\\\/:*?"<>|]/.test(nn) || dd.kids[nn]) { toast('That name is not valid or already exists.'); return; }
          dd.kids[nn] = dd.kids[name]; delete dd.kids[name]; vsave();
        }], ['Delete', function () { if (confirm('Move "' + name + '" to the Recycle Bin?')) { trashItem(dd.kids, name); vsave(); } }]);
        menu(e, items);
      });
      d.appendChild(it);
    });
  }

  /* ---------- file clipboard (copy, cut, paste) and Explorer refresh ---------- */
  var fileClip = null, fsWatchers = [];
  function fsWatch(fn) { fsWatchers.push(fn); }
  function fsRefresh() { fsWatchers = fsWatchers.filter(function (f) { try { return f() !== false; } catch (e) { return false; } }); }
  function fsCopy(parts, cut) { fileClip = { parts: parts.slice(), cut: !!cut }; toast((cut ? 'Cut: ' : 'Copied: ') + parts[parts.length - 1]); }
  function fsPaste(dest) {
    if (!fileClip) return;
    var sp = fileClip.parts, name = sp[sp.length - 1], src = vfind(sp), dir = vfind(dest);
    if (!src) { toast('The original item no longer exists.'); fileClip = null; return; }
    if (!dir || !dir.kids) { toast('That folder no longer exists.'); return; }
    if (src.kids && dest.length >= sp.length && sp.every(function (x, i) { return dest[i] === x; })) { toast('You cannot paste a folder into itself.'); return; }
    var same = sp.length - 1 === dest.length && dest.every(function (x, i) { return sp[i] === x; });
    if (fileClip.cut && same) { fileClip = null; return; }
    var m = /^(.*?)(\.[^.]*)?$/.exec(name), n = name, k = 0;
    while (dir.kids[n]) { k++; n = m[1] + ' - Copy' + (k > 1 ? ' (' + k + ')' : '') + (m[2] || ''); }
    var parent = vfind(sp.slice(0, -1)), cut = fileClip.cut;
    dir.kids[n] = cut ? src : JSON.parse(JSON.stringify(src)); if (cut) delete parent.kids[name];
    if (!vsave()) { delete dir.kids[n]; if (cut) parent.kids[name] = src; toast('Not enough browser storage space.'); return; }
    if (cut) fileClip = null; toast('Pasted ' + n);
  }
  function editInPaint(name, node) { openApp('paint', { name: name, data: node.data, save: vsaveFn(node, 'data') }); }

  APPS.photoviewer = {
    title: 'Windows Photo Viewer', icon: '\uD83D\uDDBC\uFE0F', w: 740, h: 520,
    build: function (body, self, opts) {
      var bar = el('div', 'bar'), box = el('div', 'pvbox'), st = el('div', 'bar'), img = document.createElement('img'), list = [], idx = 0, z = 0, timer = null;
      function add(kids) {
        Object.keys(kids).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); }).forEach(function (k) { if (kids[k].data || (kids[k].file && /^image\//.test(kids[k].type || ''))) list.push({ name: k, node: kids[k], parent: kids }); });
      }
      if (opts && opts.dir) add(opts.dir);
      else if (opts && opts.node) list.push({ name: opts.name, node: opts.node, parent: null });
      else (function walk(nd) { add(nd.kids); Object.keys(nd.kids).sort().forEach(function (k) { if (nd.kids[k].kids) walk(nd.kids[k]); }); })(vfs.kids.Pictures && vfs.kids.Pictures.kids ? vfs.kids.Pictures : { kids: {} });
      if (opts && opts.node) { var at = list.map(function (p) { return p.node; }).indexOf(opts.node); idx = at < 0 ? 0 : at; }
      function fit() {
        if (!img.naturalWidth) return;
        if (z === 0) { img.style.width = ''; img.style.maxWidth = '100%'; img.style.maxHeight = '100%'; }
        else { img.style.maxWidth = 'none'; img.style.maxHeight = 'none'; img.style.width = Math.round(img.naturalWidth * z) + 'px'; }
      }
      function info() { var p = list[idx]; st.textContent = p.name + '   (' + img.naturalWidth + ' x ' + img.naturalHeight + ')   ' + (idx + 1) + ' of ' + list.length; }
      var objUrl = null, tok = 0;
      function loadSrc(n) {
        var t = ++tok; if (n.data) { img.src = n.data; return; }
        idbGet(n.file).then(function (b) {
          if (t !== tok) return; if (!b) { st.textContent = 'The picture data is missing.'; return; }
          if (objUrl) URL.revokeObjectURL(objUrl); objUrl = URL.createObjectURL(b); img.src = objUrl;
        }, function () { st.textContent = 'The picture could not be read.'; });
      }
      function show() {
        if (!list.length) { img.style.display = 'none'; st.textContent = 'There are no pictures to show. Import pictures, or save one from Paint into C:\\Pictures.'; return; }
        var p = list[idx]; img.style.display = ''; z = 0; loadSrc(p.node);
        $('.t', self.el).textContent = 'Windows Photo Viewer - ' + p.name; self.btn.textContent = APPS.photoviewer.icon + ' ' + p.name;
      }
      img.onload = function () { fit(); info(); };
      function step(d) { if (list.length) { idx = (idx + d + list.length) % list.length; show(); } }
      function zoom(f) { if (!img.naturalWidth) return; z = Math.max(0.1, Math.min(8, (z || (img.clientWidth / img.naturalWidth) || 1) * f)); fit(); }
      function stopShow() { clearInterval(timer); timer = null; ss.textContent = 'Slide show'; }
      tbtn(bar, 'Previous', function () { step(-1); }); tbtn(bar, 'Next', function () { step(1); });
      tbtn(bar, 'Fit', function () { z = 0; fit(); }); tbtn(bar, 'Actual size', function () { z = 1; fit(); });
      tbtn(bar, 'Zoom in', function () { zoom(1.25); }); tbtn(bar, 'Zoom out', function () { zoom(0.8); });
      var ss = tbtn(bar, 'Slide show', function () {
        if (timer) { stopShow(); return; }
        timer = setInterval(function () { if (!self.el.isConnected) { stopShow(); return; } if (list.length > 1) step(1); }, 3000); ss.textContent = 'Stop slide show';
      });
      tbtn(bar, 'Edit with Paint', function () { if (!list.length) return; if (!list[idx].node.data) { st.textContent = 'Only pictures under 1 MB can be edited in Paint.'; return; } editInPaint(list[idx].name, list[idx].node); });
      tbtn(bar, 'Delete', function () {
        if (!list.length) return; var p = list[idx];
        if (!p.parent) { st.textContent = 'This picture cannot be deleted from here. Use File Explorer.'; return; }
        if (!confirm('Move "' + p.name + '" to the Recycle Bin?')) return;
        trashItem(p.parent, p.name); list.splice(idx, 1); if (idx >= list.length) idx = 0; vsave(); show();
      });
      function key(e) {
        if (!self.el.isConnected) { document.removeEventListener('keydown', key); return; }
        if (active !== self || e.altKey || e.ctrlKey) return;
        if (e.key === 'ArrowRight') { step(1); e.preventDefault(); } else if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); }
        else if (e.key === '+' || e.key === '=') zoom(1.25); else if (e.key === '-') zoom(0.8);
      }
      document.addEventListener('keydown', key);
      box.appendChild(img); body.append(bar, box, st); show();
    }
  };

  /* ---------- draws the desktop (everything on the page) into a canvas, without any library ---------- */
  function renderPage(done) {
    var W = innerWidth, H = innerHeight, fr = document.createElement('iframe'), defs = {};
    fr.style.cssText = 'position:absolute;left:-9999px;top:0;width:10px;height:10px;border:0';
    document.body.appendChild(fr);
    var fd = fr.contentDocument, fw = fr.contentWindow;
    fd.open(); fd.write('<!DOCTYPE html><html><body></body></html>'); fd.close();
    function defaultsFor(tag) {
      if (defs[tag]) return defs[tag];
      var e = fd.createElement(tag); fd.body.appendChild(e);
      var cs = fw.getComputedStyle(e), o = {}, i; for (i = 0; i < cs.length; i++) o[cs[i]] = cs.getPropertyValue(cs[i]);
      fd.body.removeChild(e); defs[tag] = o; return o;
    }
    function copy(src) {
      if (src === fr) return null;
      if (src.nodeType === 3) return document.createTextNode(src.nodeValue);
      if (src.nodeType !== 1) return null;
      var tag = src.tagName.toLowerCase(), cs = getComputedStyle(src), out, i, k, st = '';
      if (cs.display === 'none' || tag === 'script' || tag === 'style' || tag === 'link' || tag === 'video') return null;
      var kind = tag === 'body' ? 'div' : tag === 'iframe' ? 'div' : tag === 'canvas' ? 'img' : tag;
      out = document.createElement(kind);
      var def = defaultsFor(kind);
      for (i = 0; i < cs.length; i++) { var p = cs[i], v = cs.getPropertyValue(p); if (v !== def[p]) st += p + ':' + v + ';'; }
      out.setAttribute('style', st);
      if (tag === 'canvas') { try { out.setAttribute('src', src.toDataURL()); } catch (e) {} return out; }
      if (tag === 'iframe') { out.textContent = '(web page not captured)'; return out; }
      if (tag === 'img') { out.setAttribute('src', src.getAttribute('src') || ''); return out; }
      if (tag === 'input') { out.setAttribute('type', src.type); out.setAttribute('value', src.value); if (src.checked) out.setAttribute('checked', 'checked'); return out; }
      if (tag === 'textarea') { out.textContent = src.value; return out; }
      if (tag === 'option' && src.selected) out.setAttribute('selected', 'selected');
      for (k = src.firstChild; k; k = k.nextSibling) { var c = copy(k); if (c) out.appendChild(c); }
      return out;
    }
    var xml;
    try { xml = new XMLSerializer().serializeToString(copy(document.body)).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); }
    catch (e) { document.body.removeChild(fr); done(null); return; }
    document.body.removeChild(fr);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '"><foreignObject x="0" y="0" width="100%" height="100%">' + xml + '</foreignObject></svg>';
    var img = new Image();
    img.onload = function () { var c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').drawImage(img, 0, 0); done(c); };
    img.onerror = function () { done(null); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /* ---------- Snipping Tool (snips this desktop, or the real screen you pick in the browser's own prompt) ---------- */
  APPS.snip = {
    title: 'Snipping Tool', icon: '\u2702\uFE0F', w: 660, h: 470,
    build: function (body, self) {
      var bar = el('div', 'bar'), box = el('div', 'snipbox'), st = el('div', 'bar', 'Click New to snip this desktop. Use the drop-downs to choose the snip type and a delay.');
      var wrap = el('div', 'snipwrap'), base = document.createElement('canvas'), ink = document.createElement('canvas'), bg = base.getContext('2d'), ig = ink.getContext('2d');
      var source = document.createElement('select'), mode = document.createElement('select'), delay = document.createElement('select'), color = document.createElement('input'), tool = 'pen', has = false, toolBtns = {};
      [['desktop', 'This desktop'], ['screen', 'Real screen (browser prompt)']].forEach(function (m) { var o = document.createElement('option'); o.value = m[0]; o.textContent = m[1]; source.appendChild(o); });
      [['rect', 'Rectangular snip'], ['free', 'Free-form snip'], ['full', 'Full-screen snip']].forEach(function (m) { var o = document.createElement('option'); o.value = m[0]; o.textContent = m[1]; mode.appendChild(o); });
      for (var d = 0; d <= 5; d++) { var o = document.createElement('option'); o.value = d; o.textContent = d ? 'Delay ' + d + ' s' : 'No delay'; delay.appendChild(o); }
      color.type = 'color'; color.value = '#dd0000'; wrap.style.display = 'none'; wrap.append(base, ink); box.appendChild(wrap);

      function setSnip(c) {
        base.width = ink.width = c.width; base.height = ink.height = c.height; bg.drawImage(c, 0, 0); ig.clearRect(0, 0, c.width, c.height);
        has = true; wrap.style.display = ''; st.textContent = c.width + ' x ' + c.height + '. Mark it with the pen, highlighter or eraser, then Save or Copy.';
      }
      function merged() { var m = document.createElement('canvas'); m.width = base.width; m.height = base.height; var x = m.getContext('2d'); x.drawImage(base, 0, 0); x.drawImage(ink, 0, 0); return m; }
      function freeCrop(c, pts) {
        var x0 = Infinity, y0 = Infinity, x1 = 0, y1 = 0; pts.forEach(function (p) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
        var w = Math.round(x1 - x0), h = Math.round(y1 - y0); if (w < 4 || h < 4) return null;
        var r = document.createElement('canvas'); r.width = w; r.height = h; var x = r.getContext('2d');
        x.translate(-x0, -y0); x.beginPath(); pts.forEach(function (p, i) { if (i) x.lineTo(p.x, p.y); else x.moveTo(p.x, p.y); }); x.closePath(); x.clip(); x.drawImage(c, 0, 0); return r;
      }
      function select(c) {
        var ov = el('div', 'snipov'), cv = document.createElement('canvas'), g = cv.getContext('2d'), dim = document.createElement('canvas'), start = null, cur = null, pts = [], raf = 0;
        cv.width = dim.width = c.width; cv.height = dim.height = c.height;
        var dg = dim.getContext('2d'); dg.drawImage(c, 0, 0); dg.fillStyle = 'rgba(255,255,255,.45)'; dg.fillRect(0, 0, c.width, c.height);
        ov.tabIndex = 0; ov.append(cv, el('div', 'sniphint', mode.value === 'free' ? 'Draw around the area to capture. Esc cancels.' : 'Drag to select the area to capture. Esc cancels.'));
        document.body.appendChild(ov); ov.focus(); g.drawImage(dim, 0, 0);
        function pos(e) { var r = cv.getBoundingClientRect(); return { x: Math.max(0, Math.min(c.width, (e.clientX - r.left) * c.width / r.width)), y: Math.max(0, Math.min(c.height, (e.clientY - r.top) * c.height / r.height)) }; }
        function path() { g.beginPath(); pts.forEach(function (q, i) { if (i) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); }); }
        function paint() {
          raf = 0; g.drawImage(dim, 0, 0); if (!start || !cur) return;
          if (mode.value === 'free') { path(); g.save(); g.clip(); g.drawImage(c, 0, 0); g.restore(); path(); g.strokeStyle = '#d00'; g.lineWidth = 2; g.stroke(); }
          else { var x = Math.min(start.x, cur.x), y = Math.min(start.y, cur.y), w = Math.abs(cur.x - start.x), h = Math.abs(cur.y - start.y); if (w > 0 && h > 0) g.drawImage(c, x, y, w, h, x, y, w, h); g.strokeStyle = '#d00'; g.lineWidth = 2; g.strokeRect(x, y, w, h); }
        }
        function finish(res, msg) { ov.remove(); focus(self); if (res) setSnip(res); else st.textContent = msg || 'Snip cancelled.'; }
        ov.onkeydown = function (e) { if (e.key === 'Escape') finish(null); e.stopPropagation(); };
        cv.onmousedown = function (e) { start = cur = pos(e); pts = [start]; e.preventDefault(); };
        ov.onmousemove = function (e) { if (!start) return; cur = pos(e); if (mode.value === 'free') pts.push(cur); if (!raf) raf = requestAnimationFrame(paint); };
        ov.onmouseup = function (e) {
          if (!start) return; var p = pos(e), res = null;
          if (mode.value === 'free') { if (pts.length > 3) res = freeCrop(c, pts); }
          else {
            var x = Math.round(Math.min(start.x, p.x)), y = Math.round(Math.min(start.y, p.y)), w = Math.round(Math.abs(p.x - start.x)), h = Math.round(Math.abs(p.y - start.y));
            if (w > 3 && h > 3) { res = document.createElement('canvas'); res.width = w; res.height = h; res.getContext('2d').drawImage(c, x, y, w, h, 0, 0, w, h); }
          }
          start = null; finish(res, 'That area was too small. Snip cancelled.');
        };
      }
      function capture() {
        if (source.value === 'screen') { realCapture(); return; }
        var secs = +delay.value || 0; minimize(self);
        if (secs) toast('Snipping in ' + secs + ' second' + (secs > 1 ? 's' : '') + '...');
        setTimeout(function () {
          $('#toast').hidden = true;
          renderPage(function (c) {
            if (!c) { focus(self); st.textContent = 'The browser could not draw the desktop. Try "Real screen" instead.'; return; }
            if (mode.value === 'full') { focus(self); setSnip(c); } else select(c);
          });
        }, secs * 1000 + 150);
      }
      function realCapture() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) { st.textContent = 'This browser cannot capture the screen.'; return; }
        navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }).then(function (stream) {
          var v = document.createElement('video'), secs = +delay.value || 0; v.muted = true; v.srcObject = stream; minimize(self);
          function grab() {
            var c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
            if (c.width) c.getContext('2d').drawImage(v, 0, 0);
            stream.getTracks().forEach(function (t) { t.stop(); });
            if (!c.width) { focus(self); st.textContent = 'Nothing was captured.'; return; }
            if (mode.value === 'full') { focus(self); setSnip(c); } else select(c);
          }
          v.onloadedmetadata = function () { v.play(); setTimeout(grab, secs * 1000 + 500); };
        }).catch(function (e) { st.textContent = e && e.name === 'NotAllowedError' ? 'Screen capture was cancelled or blocked.' : 'Could not capture: ' + (e && e.message); });
      }
      function stamp() { var t = new Date(); return 'Snip ' + t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()) + ' ' + pad(t.getHours()) + '-' + pad(t.getMinutes()) + '-' + pad(t.getSeconds()); }
      function saveSnip(asNew) {
        if (!has) { st.textContent = 'Take a snip first.'; return; }
        var m = merged(), url, jpeg = false, parts;
        try {
          url = m.toDataURL('image/png');
          if (url.length > 1200000) {
            var f = document.createElement('canvas'); f.width = m.width; f.height = m.height; var x = f.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, f.width, f.height); x.drawImage(m, 0, 0);
            url = f.toDataURL('image/jpeg', 0.85); jpeg = true;
          }
        } catch (e) { st.textContent = 'The browser blocked saving this picture. Try the "Real screen" source.'; return; }
        var ext = jpeg ? '.jpg' : '.png';
        if (asNew) { parts = askPath('C:\\Pictures\\' + stamp() + ext); if (!parts) return; if (jpeg) parts[parts.length - 1] = parts[parts.length - 1].replace(/\.png$/i, '.jpg'); }
        else {
          var pk = vfs.kids.Pictures && vfs.kids.Pictures.kids ? vfs.kids.Pictures.kids : {}, nm = stamp() + ext, n = 1;
          while (pk[nm]) { n++; nm = stamp() + ' (' + n + ')' + ext; } parts = ['Pictures', nm];
        }
        var err = vwrite(parts, url, 'data'); if (err) { if (err !== 'cancelled') st.textContent = err; return; }
        st.textContent = 'Saved to C:\\' + parts.join('\\') + (jpeg ? ' (as a JPEG to fit the storage limit)' : '') + '. Open it from Windows Photo Viewer.';
      }
      function copySnip() {
        if (!has) { st.textContent = 'Take a snip first.'; return; }
        if (!(window.ClipboardItem && navigator.clipboard && navigator.clipboard.write)) { st.textContent = 'This browser cannot copy pictures. Use Save instead.'; return; }
        var mc; try { mc = merged(); } catch (e) { st.textContent = 'The browser blocked copying this picture.'; return; }
        mc.toBlob(function (b) { navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]).then(function () { st.textContent = 'Copied to the clipboard.'; }, function () { st.textContent = 'The browser blocked copying.'; }); });
      }
      tbtn(bar, 'New', capture); bar.append(source, mode, delay);
      tbtn(bar, 'Save', function () { saveSnip(false); }); tbtn(bar, 'Save as...', function () { saveSnip(true); }); tbtn(bar, 'Copy', copySnip);
      [['pen', 'Pen'], ['hl', 'Highlighter'], ['eraser', 'Eraser']].forEach(function (t) {
        var b = tbtn(bar, t[1], function () { tool = t[0]; Object.keys(toolBtns).forEach(function (k) { toolBtns[k].classList.toggle('on', k === t[0]); }); });
        toolBtns[t[0]] = b; if (t[0] === tool) b.className = 'on';
      });
      bar.appendChild(color); tbtn(bar, 'Clear marks', function () { ig.clearRect(0, 0, ink.width, ink.height); });
      function ipos(e) { var r = ink.getBoundingClientRect(); return { x: (e.clientX - r.left) * ink.width / r.width, y: (e.clientY - r.top) * ink.height / r.height }; }
      ink.onmousedown = function (e) {
        if (!has) return; var p = ipos(e); e.preventDefault(); ig.lineJoin = 'round'; ig.lineCap = tool === 'hl' ? 'butt' : 'round';
        if (tool === 'eraser') { ig.globalCompositeOperation = 'destination-out'; ig.strokeStyle = '#000'; ig.lineWidth = 16; ig.globalAlpha = 1; }
        else if (tool === 'hl') { ig.globalCompositeOperation = 'source-over'; ig.strokeStyle = '#ffee00'; ig.lineWidth = 16; ig.globalAlpha = 0.35; }
        else { ig.globalCompositeOperation = 'source-over'; ig.strokeStyle = color.value; ig.lineWidth = 3; ig.globalAlpha = 1; }
        ig.beginPath(); ig.moveTo(p.x, p.y); ig.lineTo(p.x + 0.01, p.y); ig.stroke(); ig.beginPath(); ig.moveTo(p.x, p.y);
        function mv(ev) { var q = ipos(ev); ig.lineTo(q.x, q.y); ig.stroke(); ig.beginPath(); ig.moveTo(q.x, q.y); }
        function up() { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); }
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
      };
      body.append(bar, box, st);
    }
  };

  /* ---------- Recycle Bin ---------- */
  function findPath(kids) {
    if (vfs.kids === kids) return []; var out = null;
    (function w(n, p) { Object.keys(n.kids).forEach(function (k) { if (out) return; var c = n.kids[k]; if (c.kids) { if (c.kids === kids) out = p.concat(k); else w(c, p.concat(k)); } }); })(vfs, []);
    return out || [];
  }
  function trashItem(kids, name) {
    if (!kids[name]) return false;
    (vfs.bin = vfs.bin || []).push({ name: name, from: findPath(kids), node: kids[name], when: Date.now() }); delete kids[name]; return true;
  }
  function restoreEntry(e) {
    var par = vfs, i;
    for (i = 0; i < e.from.length; i++) {
      var c = par.kids[e.from[i]];
      if (c && !c.kids) return 'A file is in the way of the original folder "' + e.from[i] + '".';
      if (!c) par.kids[e.from[i]] = { kids: {} };
      par = par.kids[e.from[i]];
    }
    var n = e.name, m = /^(.*?)(\.[^.]*)?$/.exec(n), k = 1;
    while (par.kids[n]) { k++; n = m[1] + ' (' + k + ')' + (m[2] || ''); }
    par.kids[n] = e.node; vfs.bin.splice(vfs.bin.indexOf(e), 1); return '';
  }
  APPS.recycle = {
    title: 'Recycle Bin', icon: '\u267B\uFE0F', w: 620, h: 400,
    build: function (body, self) {
      var bar = el('div', 'bar'), box = el('div', 'tm'), st = el('div', 'bar'), sel = null;
      function pick(tr, e) { var o = box.querySelector('.sel'); if (o) o.classList.remove('sel'); tr.classList.add('sel'); sel = e; }
      function done(msg) { vsave(); if (msg) st.textContent = msg; }
      function restore(e) { var err = restoreEntry(e); if (err) { st.textContent = err; return; } done('Restored "' + e.name + '".'); }
      function purge(e) { if (confirm('Permanently delete "' + e.name + '"? This cannot be undone.')) { vfs.bin.splice(vfs.bin.indexOf(e), 1); done('Deleted "' + e.name + '" permanently.'); } }
      function render() {
        box.innerHTML = ''; sel = null; var bin = vfs.bin || [];
        if (!bin.length) { box.appendChild(el('div', 'empty', 'The Recycle Bin is empty.')); st.textContent = '0 items'; return; }
        var tbl = el('table', 'rbt'); tbl.appendChild(el('tr', '', '<th>Name</th><th>Original location</th><th>Date deleted</th>'));
        bin.slice().reverse().forEach(function (e) {
          var tr = el('tr'), a = el('td'), b = el('td'), c = el('td');
          a.textContent = iconFor(e.name, e.node) + ' ' + e.name; b.textContent = 'C:\\' + e.from.join('\\'); c.textContent = new Date(e.when).toLocaleString();
          tr.append(a, b, c); tr.onclick = function () { pick(tr, e); };
          tr.oncontextmenu = function (ev) { ev.stopPropagation(); pick(tr, e); menu(ev, [['Restore', function () { restore(e); }], ['Delete', function () { purge(e); }]]); };
          tbl.appendChild(tr);
        });
        box.appendChild(tbl); st.textContent = bin.length + ' item' + (bin.length === 1 ? '' : 's');
      }
      tbtn(bar, 'Restore the selected item', function () { if (!sel) { st.textContent = 'Select an item first.'; return; } restore(sel); });
      tbtn(bar, 'Restore all items', function () {
        var all = (vfs.bin || []).slice(), n = 0, err = ''; all.forEach(function (e) { if (!err) { err = restoreEntry(e); if (!err) n++; } });
        if (n) vsave(); st.textContent = err || (n ? 'Restored ' + n + ' item(s).' : 'The Recycle Bin is empty.');
      });
      tbtn(bar, 'Delete permanently', function () { if (!sel) { st.textContent = 'Select an item first.'; return; } purge(sel); });
      tbtn(bar, 'Empty the Recycle Bin', function () {
        var n = (vfs.bin || []).length; if (!n) { st.textContent = 'The Recycle Bin is empty.'; return; }
        if (confirm('Permanently delete all ' + n + ' item(s)? This cannot be undone.')) { vfs.bin = []; done('The Recycle Bin is empty.'); }
      });
      fsWatch(function () { if (!self.el.isConnected) return false; render(); return true; });
      body.append(bar, box, st); render();
    }
  };

  /* ---------- desktop icons ---------- */
  function buildIcons() {
    var d = $('#desktop');
    Object.keys(APPS).forEach(function (id) {
      if (APPS[id].group) return;
      var i = el('div', 'icon', '<span>' + APPS[id].icon + '</span>' + APPS[id].title);
      i.addEventListener('click', function (e) { clearSel(); i.classList.add('sel'); e.stopPropagation(); });
      i.addEventListener('dblclick', function () { openApp(id); });
      i.addEventListener('contextmenu', function (e) { e.stopPropagation(); clearSel(); i.classList.add('sel'); menu(e, [['Open', function () { openApp(id); }]]); });
      d.appendChild(i);
    });
    renderDesk();
  }
  function clearSel() { var s = document.querySelectorAll('.icon.sel'); for (var i = 0; i < s.length; i++) s[i].classList.remove('sel'); }

  /* ---------- start menu ---------- */
  function buildStart() {
    var list = $('#start-list'), q = $('#start-search');
    var folderOpen = false;
    function item(id, cls) {
      var li = el('li', cls || '', '<span>' + APPS[id].icon + '</span>' + APPS[id].title);
      li.onclick = function () { toggleStart(false); openApp(id); }; list.appendChild(li);
    }
    function fill(term) {
      list.innerHTML = ''; var t = (term || '').toLowerCase(), ids = Object.keys(APPS);
      ids.forEach(function (id) { if (!APPS[id].group && (!t || APPS[id].title.toLowerCase().indexOf(t) >= 0)) item(id); });
      if (t) { ids.forEach(function (id) { if (APPS[id].group && APPS[id].title.toLowerCase().indexOf(t) >= 0) item(id); }); }
      else {
        var f = el('li', '', '<span>\uD83D\uDCC1</span>Microsoft Office ' + (folderOpen ? '\u25BE' : '\u25B8'));
        f.onclick = function () { folderOpen = !folderOpen; fill(''); }; list.appendChild(f);
        if (folderOpen) ids.forEach(function (id) { if (APPS[id].group) item(id, 'sub'); });
      }
      if (!list.children.length) list.appendChild(el('li', '', 'No programs match your search'));
    }
    q.addEventListener('input', function () { fill(q.value); });
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') { var f = list.firstChild; if (f && f.onclick) f.onclick(); } });
    fill('');
    $('#start').addEventListener('click', function (e) {
      var a = e.target.getAttribute('data-app'); if (a) { toggleStart(false); openApp(a); }
    });
    $('#wall-btn').onclick = function () { nextWall(); };
    $('#shutdown-btn').onclick = function () { power('off'); };
    $('#power-arrow').onclick = function (e) { e.stopPropagation(); var m = $('#power-menu'); m.hidden = !m.hidden; };
    $('#power-menu').addEventListener('click', function (e) { var p = e.target.getAttribute('data-power'); if (p) power(p); });
    $('#orb').addEventListener('click', function (e) { e.stopPropagation(); toggleStart(); });
    $('#start').addEventListener('click', function (e) { e.stopPropagation(); });
    $('#start').__fill = fill;
  }
  function toggleStart(show) {
    var s = $('#start'); var v = (show === undefined) ? s.hidden : show;
    s.hidden = !v; $('#power-menu').hidden = true; $('#calendar').hidden = true; $('#volpanel').hidden = true; $('#netpanel').hidden = true;
    if (v) { $('#start-search').value = ''; s.__fill(''); $('#start-search').focus(); }
  }

  /* ---------- power screens ---------- */
  function power(kind) {
    toggleStart(false);
    var s = $('#screen'); s.hidden = false; s.className = ''; s.innerHTML = '';
    if (kind === 'lock') {
      s.className = 'lock';
      var t = new Date();
      s.innerHTML = '<div class="big">' + pad(t.getHours()) + ':' + pad(t.getMinutes()) + '</div><div>Locked. Click anywhere to unlock.</div>';
      s.onclick = function () { s.hidden = true; s.onclick = null; };
    } else if (kind === 'restart') {
      s.onclick = null; s.textContent = 'Restarting...';
      setTimeout(function () { location.reload(); }, 1200);
    } else {
      s.onclick = null; s.innerHTML = '<div>Shutting down...</div>';
      setTimeout(function () {
        s.innerHTML = '<button id="pon">Power on</button>';
        $('#pon').onclick = function () { location.reload(); };
      }, 1200);
    }
  }

  /* ---------- context menu ---------- */
  function menu(e, items) {
    e.preventDefault();
    var m = $('#ctx'); m.innerHTML = '';
    items.forEach(function (it) {
      if (it === '-') { m.appendChild(el('hr')); return; }
      var li = el('li', it[2] ? 'dis' : '', it[0]); if (!it[2]) li.onclick = function () { m.hidden = true; it[1](); }; m.appendChild(li);
    });
    m.hidden = false;
    m.style.left = Math.min(e.clientX, innerWidth - m.offsetWidth - 4) + 'px';
    m.style.top = Math.min(e.clientY, innerHeight - m.offsetHeight - 44) + 'px';
  }

  /* ---------- clock & calendar ---------- */
  var calY, calM;
  function tick() {
    var d = new Date();
    var h = cfg.clock24 ? pad(d.getHours()) : d.getHours() % 12 || 12, ap = cfg.clock24 ? '' : (d.getHours() < 12 ? 'AM' : 'PM');
    $('#clock').innerHTML = h + ':' + pad(d.getMinutes()) + ' ' + ap + '<br>' + (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
    if (!$('#calendar').hidden) {
      $('#cal-time').textContent = h + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ' ' + ap;
    }
  }
  function drawCal() {
    var g = $('#cal-grid'), now = new Date(), first = new Date(calY, calM, 1), days = new Date(calY, calM + 1, 0).getDate();
    $('#cal-title').textContent = first.toLocaleString(cfg.lang || 'en-US', { month: 'long', year: 'numeric' });
    var h = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(function (x) { return '<b>' + x + '</b>'; }).join('');
    for (var i = 0; i < first.getDay(); i++) h += '<i></i>';
    for (var d = 1; d <= days; d++) {
      var t = (d === now.getDate() && calM === now.getMonth() && calY === now.getFullYear()) ? ' class="today"' : '';
      h += '<i' + t + '>' + d + '</i>';
    }
    g.innerHTML = h;
  }
  function buildCalendar() {
    $('#clock').addEventListener('click', function (e) {
      e.stopPropagation();
      var c = $('#calendar'), was = c.hidden; toggleStart(false); c.hidden = !was;
      if (!c.hidden) { var n = new Date(); calY = n.getFullYear(); calM = n.getMonth(); $('#cal-date').textContent = n.toLocaleDateString(cfg.lang || 'en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); drawCal(); tick(); }
    });
    $('#calendar').addEventListener('click', function (e) { e.stopPropagation(); });
    $('#cal-prev').onclick = function () { calM--; if (calM < 0) { calM = 11; calY--; } drawCal(); };
    $('#cal-next').onclick = function () { calM++; if (calM > 11) { calM = 0; calY++; } drawCal(); };
  }

  /* ---------- tray: volume, network, notifications ---------- */
  var vol = load('vol', { v: 60, m: false }), ac = null;
  function beep(freq, dur) {
    if (vol.m || !vol.v) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      var o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = freq; g.gain.value = vol.v / 100 * 0.25;
      o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + dur);
    } catch (e) {}
  }
  function toast(m) {
    var t = $('#toast'); t.textContent = m; t.hidden = false;
    clearTimeout(toast.id); toast.id = setTimeout(function () { t.hidden = true; }, 3500);
  }
  function drawVol() {
    var level = (vol.m || !vol.v) ? 0 : vol.v < 34 ? 1 : vol.v < 67 ? 2 : 3;
    $('#vol').textContent = ['\uD83D\uDD07', '\uD83D\uDD08', '\uD83D\uDD09', '\uD83D\uDD0A'][level];
    $('#vol-range').value = vol.v; $('#vol-val').textContent = vol.m ? 'Muted' : 'Volume ' + vol.v + '%';
    $('#vol-mute').textContent = vol.m ? 'Unmute' : 'Mute';
  }
  function drawNet() {
    var on = navigator.onLine, c = navigator.connection, ul = $('#net-info'), rows = [];
    $('#net').textContent = on ? '\uD83D\uDCF6' : '\uD83D\uDEAB';
    $('#net-title').textContent = on ? 'The browser reports: online' : 'The browser reports: no network';
    if (c) {
      if (c.effectiveType) rows.push('Connection quality: ' + c.effectiveType);
      if (c.downlink) rows.push('Estimated speed: ' + c.downlink + ' Mbps');
      if (c.rtt !== undefined) rows.push('Estimated delay: ' + c.rtt + ' ms');
    } else { rows.push('This browser gives no detailed connection information.'); }
    ul.innerHTML = ''; rows.forEach(function (r) { ul.appendChild(el('li', '', r)); });
  }
  function trayPanel(btn, id) {
    $(btn).addEventListener('click', function (e) {
      e.stopPropagation();
      var p = $(id), open = p.hidden; toggleStart(false); p.hidden = !open;
      if (open) { var r = $(btn).getBoundingClientRect(); p.style.right = Math.max(4, innerWidth - (r.left + r.width / 2) - 120) + 'px'; }
    });
    $(id).addEventListener('click', function (e) { e.stopPropagation(); });
  }
  function buildTray() {
    trayPanel('#vol', '#volpanel'); trayPanel('#net', '#netpanel');
    $('#vol-range').oninput = function () { vol.v = +this.value; vol.m = false; save('vol', vol); drawVol(); };
    $('#vol-mute').onclick = function () { vol.m = !vol.m; save('vol', vol); drawVol(); };
    $('#vol-test').onclick = function () { beep(660, 0.2); };
    $('#net-test').onclick = function () {
      var r = $('#net-result'), t0 = performance.now(), ctl = window.AbortController ? new AbortController() : null;
      r.textContent = 'Testing...';
      var to = setTimeout(function () { if (ctl) ctl.abort(); }, 5000);
      fetch('https://www.gstatic.com/generate_204?' + Date.now(), { mode: 'no-cors', cache: 'no-store', signal: ctl ? ctl.signal : undefined })
        .then(function () { clearTimeout(to); r.textContent = 'Reached the internet in ' + Math.round(performance.now() - t0) + ' ms.'; })
        .catch(function () { clearTimeout(to); r.textContent = 'Could not reach the internet.'; });
    };
    window.addEventListener('online', function () { drawNet(); toast('Network connection restored'); });
    window.addEventListener('offline', function () { drawNet(); toast('Network connection lost'); });
    if (navigator.connection && navigator.connection.addEventListener) navigator.connection.addEventListener('change', drawNet);
    drawVol(); drawNet();
  }

  /* ---------- Flip 3D ---------- */
  var flip = null;
  function flipDraw() {
    var cards = $('#f3-stage').children, n = flip.list.length;
    for (var i = 0; i < n; i++) {
      var pos = (i - flip.sel + n) % n, s = cards[i].style;
      s.transform = 'translate3d(' + (pos * 70 - 100) + 'px,' + (-pos * 16) + 'px,' + (-pos * 120) + 'px) rotateY(-40deg)';
      s.opacity = pos < 7 ? 1 : 0; s.pointerEvents = pos < 7 ? 'auto' : 'none';
      cards[i].classList.toggle('sel', pos === 0);
    }
    $('#f3-label').textContent = flip.list[flip.sel].btn.textContent;
  }
  function flipOpen(mod) {
    if (flip) return;
    var list = wins.slice().sort(function (a, b) { return (+b.el.style.zIndex || 0) - (+a.el.style.zIndex || 0); });
    if (!list.length) { toast('There are no open windows to flip through.'); return; }
    var stage = $('#f3-stage'); stage.innerHTML = '';
    list.forEach(function (w, i) {
      var c = el('div', 'f3-card', '<div class="tb"></div><div class="bd"></div>');
      $('.tb', c).textContent = w.btn.textContent; $('.bd', c).textContent = w.app.icon;
      c.onclick = function (e) { e.stopPropagation(); flip.sel = i; flipClose(true); };
      stage.appendChild(c);
    });
    flip = { list: list, sel: list.length > 1 ? 1 : 0, mod: mod };
    $('#flip').hidden = false; flipDraw();
  }
  function flipStep(d) { var n = flip.list.length; flip.sel = (flip.sel + d + n) % n; flipDraw(); }
  function flipClose(apply) {
    var f = flip; if (!f) return;
    flip = null; $('#flip').hidden = true; $('#f3-stage').innerHTML = '';
    if (apply) focus(f.list[f.sel]);
  }
  function buildFlip() {
    $('#flip-btn').addEventListener('click', function (e) { e.stopPropagation(); toggleStart(false); flipOpen(null); });
    $('#flip').addEventListener('click', function (e) { if (e.target === this) flipClose(false); });
    document.addEventListener('keyup', function (e) { if (flip && flip.mod && e.key === flip.mod) flipClose(true); });
  }

  /* ---------- init ---------- */
  applyWall(); applyTheme(); buildIcons(); buildStart(); buildCalendar(); buildTray(); buildFlip(); tick(); bootVfs();
  setInterval(tick, 1000);
  $('#show-desktop').onclick = showDesktop;
  ['dragover', 'drop'].forEach(function (t) { document.addEventListener(t, function (e) { e.preventDefault(); }); });
  $('#desktop').addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files.length) importFiles(e.dataTransfer.files, ['Desktop'], function (m) { toast(m); });
  });

  $('#desktop').addEventListener('contextmenu', function (e) {
    menu(e, [
      ['Import files...', function () { pickFiles(['Desktop'], null); }],
      ['New folder', function () { deskNew('folder'); }],
      ['New text document', function () { deskNew('text'); }],
      ['Paste', function () { fsPaste(['Desktop']); }, !fileClip],
      '-',
      ['Personalize', function () { openApp('personalize'); }],
      ['Next wallpaper', nextWall],
      ['Open Notepad', function () { openApp('notepad'); }],
      ['Open Calculator', function () { openApp('calc'); }],
      '-',
      ['Refresh', function () { location.reload(); }]
    ]);
  });
  document.addEventListener('contextmenu', function (e) { if (!e.defaultPrevented) e.preventDefault(); });
  document.addEventListener('click', function () {
    $('#ctx').hidden = true; $('#calendar').hidden = true; $('#power-menu').hidden = true; toggleStart(false); clearSel();
  });
  document.addEventListener('keydown', function (e) {
    if (flip) {
      var k = e.key; e.preventDefault();
      if (k === 'Escape') flipClose(false);
      else if (k === 'Enter') flipClose(true);
      else if (k === 'ArrowLeft' || k === 'ArrowUp') flipStep(-1);
      else if (k === 'Tab' || k === 'ArrowRight' || k === 'ArrowDown' || e.code === 'Backquote') flipStep(e.shiftKey ? -1 : 1);
      return;
    }
    if ((e.key === 'Tab' && e.metaKey) || (e.altKey && e.code === 'Backquote')) { e.preventDefault(); flipOpen(e.metaKey ? 'Meta' : 'Alt'); return; }
    if (e.key === 'Escape') { toggleStart(false); $('#ctx').hidden = true; $('#calendar').hidden = true; }
    if (e.key === 'Meta' || (e.ctrlKey && e.key === 'Escape')) { toggleStart(); }
    if (e.altKey && e.key === 'F4' && active) { e.preventDefault(); closeWin(active); }
    if (e.altKey && e.key === 'd') { showDesktop(); }
  });
})();
