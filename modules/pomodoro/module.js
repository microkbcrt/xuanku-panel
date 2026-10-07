/* 番茄钟模块：专注计时 / 休息切换 / 会话记录 / 提示音 */
(function () {
  'use strict';
  var MOD = 'pomodoro';
  var C = Panel.el, U = Panel.util;

  var D = null;                 // {settings, sessions}
  var host = null, ctx = null;
  var mode = 'work';            // work | short | long
  var remaining = 0;
  var running = false;
  var round = 1;
  var endAt = 0;
  var timer = null;
  var taskName = '';
  var todos = [];
  var audioCtx = null;

  // DOM 引用
  var timeEl, ringEl, modeEl, roundEl, ctrlBtn, statToday, statTotal, sessionBox, titleBase;

  var MODE_CN = { work: '专注', short: '短休息', long: '长休息' };

  function dur(m) {
    var s = D.settings || {};
    var v = m === 'work' ? s.work : m === 'short' ? s.short : s.long;
    return Math.max(1, Number(v) || 25) * 60;
  }

  function total() { return dur(mode); }

  function beep(times) {
    if (!D.settings.sound) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = audioCtx || new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var n = times || 3, t0 = audioCtx.currentTime + 0.05;
      for (var i = 0; i < n; i++) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine';
        o.frequency.value = i % 2 ? 988 : 784;
        var t = t0 + i * 0.3;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.3, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(t); o.stop(t + 0.28);
      }
    } catch (e) {}
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    if (!host) return;
    host.textContent = '';
    var page = C('div', { class: 'page' });

    var card = C('div', { class: 'card pomo-card' });
    var s = D.settings;

    var presets = C('div', { class: 'row', style: { justifyContent: 'center' } },
      ['work', 'short', 'long'].map(function (m) {
        return C('button', {
          class: 'chip pomo-mode' + (mode === m ? ' active' : ''), type: 'button', dataset: { mode: m },
          onclick: function () { switchMode(m); }
        }, MODE_CN[m] + ' ' + (m === 'work' ? s.work : m === 'short' ? s.short : s.long) + '′');
      }));

    ringEl = C('div', { class: 'pomo-ring' });
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 260 260');
    svg.innerHTML =
      '<circle class="pomo-track" cx="130" cy="130" r="112"></circle>' +
      '<circle class="pomo-bar" cx="130" cy="130" r="112"></circle>';
    ringEl.appendChild(svg);
    timeEl = C('div', { class: 'pomo-time', text: '00:00' });
    modeEl = C('div', { class: 'pomo-mode-label', text: MODE_CN[mode] });
    roundEl = C('div', { class: 'pomo-rounds' });
    ringEl.appendChild(C('div', { class: 'pomo-center' }, timeEl, modeEl, roundEl));
    card.appendChild(presets);
    card.appendChild(ringEl);

    var taskRow = C('div', { class: 'field', style: { maxWidth: '340px', margin: '0 auto' } },
      C('label', { text: '本次任务（可从待办中选择）' }));
    var sel = C('select', { class: 'input', onchange: function () { taskName = sel.value; } });
    sel.appendChild(C('option', { value: '', text: '不关联任务' }));
    todos.filter(function (t) { return !t.done; }).forEach(function (t) {
      sel.appendChild(C('option', { value: t.title, text: t.title }));
    });
    sel.value = taskName || '';
    taskRow.appendChild(sel);
    card.appendChild(taskRow);

    ctrlBtn = C('button', { class: 'btn btn-primary pomo-main-btn', type: 'button', onclick: toggle },
      running ? '⏸ 暂停' : '▶ 开始');
    card.appendChild(C('div', { class: 'row', style: { justifyContent: 'center', marginTop: '4px' } },
      C('button', { class: 'btn', type: 'button', onclick: reset }, '↺ 重置'),
      ctrlBtn,
      C('button', { class: 'btn', type: 'button', onclick: function () { nextPhase(true); } }, '⏭ 跳过'),
      C('button', { class: 'btn', type: 'button', onclick: openSettings }, '⚙ 设置')));

    page.appendChild(card);

    /* ---- 统计 ---- */
    var grid = C('div', { class: 'grid grid-3' });
    statToday = C('div', {});
    statTotal = C('div', {});
    grid.appendChild(statToday);
    grid.appendChild(statTotal);
    grid.appendChild(C('div', { class: 'stat' },
      C('span', { class: 'stat-label', text: '今日目标' }),
      C('span', { class: 'stat-value', text: (s.work * (s.rounds || 4)) + ' 分' }),
      C('span', { class: 'stat-hint', text: '每轮 ' + s.work + ' 分钟 × ' + (s.rounds || 4) + ' 轮' })));
    page.appendChild(grid);

    var rec = C('div', { class: 'card' });
    sessionBox = C('div', {});
    rec.appendChild(C('div', { class: 'card-title' },
      C('span', {}, '专注记录'),
      C('button', {
        class: 'chip', type: 'button',
        onclick: function () {
          Panel.ui.confirm('清空全部番茄钟记录？', { danger: true, okText: '清空' }).then(function (ok) {
            if (!ok) return;
            ctx.api.set(MOD, 'sessions', []).then(function (v) {
              D.sessions = v || []; refreshStats();
              Panel.ui.toast('记录已清空', 'success');
            });
          });
        }
      }, '清空')));
    rec.appendChild(sessionBox);
    page.appendChild(rec);

    host.appendChild(page);

    // 初始化
    remaining = dur(mode);
    paint();
    refreshStats();
  }

  function paint() {
    var t = total();
    var progress = t > 0 ? (t - remaining) / t : 0;
    var circ = 2 * Math.PI * 112;
    var bar = ringEl && ringEl.querySelector('.pomo-bar');
    if (bar) {
      bar.style.strokeDasharray = circ;
      bar.style.strokeDashoffset = circ * (1 - progress);
      bar.classList.toggle('work', mode === 'work');
    }
    timeEl.textContent = U.mmss(remaining);
    modeEl.textContent = MODE_CN[mode] + (running ? '中' : '');
    ctrlBtn.textContent = running ? '⏸ 暂停' : '▶ 开始';
    ctrlBtn.classList.toggle('is-pause', running);

    var s = D.settings;
    clear(roundEl);
    var n = Math.max(1, s.rounds || 4);
    for (var i = 1; i <= n; i++) {
      var cls = 'pomo-dot';
      if (mode === 'long') { if (i < round) cls += ' done'; }
      else if (i < round) cls += ' done';
      else if (i === round) cls += ' cur';
      roundEl.appendChild(C('i', { class: cls }));
    }
    document.querySelectorAll('.pomo-mode').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === mode);
    });

    document.title = running ? U.mmss(remaining) + ' · ' + MODE_CN[mode] + ' | ' + (titleBase || document.title)
      : (titleBase || document.title);
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  function refreshStats() {
    var today = U.today();
    var todayList = D.sessions.filter(function (x) { return (x.date || '') === today && x.mode === 'work'; });
    var mins = todayList.reduce(function (a, x) { return a + (Number(x.minutes) || 0); }, 0);
    var all = D.sessions.filter(function (x) { return x.mode === 'work'; });

    clear(statToday);
    statToday.appendChild(C('div', { class: 'stat' },
      C('span', { class: 'stat-label', text: '今日专注' }),
      C('span', { class: 'stat-value', text: mins + ' 分' }),
      C('span', { class: 'stat-hint', text: '完成 ' + todayList.length + ' 个番茄' })));

    clear(statTotal);
    statTotal.appendChild(C('div', { class: 'stat' },
      C('span', { class: 'stat-label', text: '累计专注' }),
      C('span', { class: 'stat-value', text: all.reduce(function (a, x) { return a + (Number(x.minutes) || 0); }, 0) + ' 分' }),
      C('span', { class: 'stat-hint', text: all.length + ' 个番茄' })));

    clear(sessionBox);
    var recent = D.sessions.slice().reverse().slice(0, 8);
    if (!recent.length) {
      sessionBox.appendChild(Panel.ui.empty('timer', '还没有专注记录', '点击「开始」进入第一个番茄钟'));
      return;
    }
    recent.forEach(function (x) {
      sessionBox.appendChild(C('div', { class: 'pomo-rec' },
        C('span', { class: 'pomo-rec-icon', html: Panel.iconHtml(x.mode === 'work' ? 'timer' : 'check') }),
        C('div', { class: 'pomo-rec-main' },
          C('div', { class: 'pomo-rec-title', text: (x.task ? x.task : MODE_CN[x.mode] || '专注') }),
          C('div', { class: 'pomo-rec-sub', text: (x.date || '') + ' ' + (x.at || '').slice(11, 16) })),
        C('span', { class: 'badge badge-brand', text: (x.minutes || 0) + ' 分' })));
    });
  }

  /* ---------------- 计时逻辑 ---------------- */
  function toggle() {
    if (running) pause();
    else start();
  }

  function start() {
    if (running) return;
    running = true;
    endAt = Date.now() + remaining * 1000;
    if (timer) clearInterval(timer);
    timer = setInterval(tick, 250);
    paint();
  }

  function pause() {
    if (!running) return;
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
    remaining = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    paint();
  }

  function reset() {
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
    remaining = dur(mode);
    paint();
  }

  function tick() {
    if (!running) return;
    remaining = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    if (remaining <= 0) {
      running = false;
      if (timer) { clearInterval(timer); timer = null; }
      finish();
    }
    paint();
  }

  function finish() {
    beep(3);
    if (mode === 'work') {
      var session = {
        id: U.uid(),
        date: U.today(),
        at: new Date().toISOString(),
        minutes: D.settings.work,
        mode: 'work',
        task: taskName || ''
      };
      ctx.api.save(MOD, 'sessions', session).then(function (saved) {
        D.sessions.push(saved);
        refreshStats();
      }).catch(function (e) { Panel.ui.toast(e.message, 'error'); });
      Panel.ui.toast('一个番茄完成！休息一下吧', 'success');
    } else {
      Panel.ui.toast('休息结束，准备开始下一轮', 'success');
    }
    nextPhase(false);
    if (D.settings.autoNext) start();
  }

  function nextPhase(manual) {
    if (mode === 'work') {
      if (!manual) round++;
      if (round > (D.settings.rounds || 4)) { round = 1; mode = 'long'; }
      else mode = 'short';
    } else {
      mode = 'work';
    }
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
    remaining = dur(mode);
    paint();
  }

  function switchMode(m) {
    mode = m;
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
    remaining = dur(m);
    paint();
  }

  function openSettings() {
    var s = D.settings;
    Panel.ui.form({
      title: '番茄钟设置',
      fields: [
        { name: 'work', label: '专注时长（分钟）', type: 'number', value: s.work, min: 1, max: 180, required: true },
        { name: 'short', label: '短休息（分钟）', type: 'number', value: s.short, min: 1, max: 60, required: true },
        { name: 'long', label: '长休息（分钟）', type: 'number', value: s.long, min: 1, max: 90, required: true },
        { name: 'rounds', label: '每轮番茄数', type: 'number', value: s.rounds, min: 1, max: 12, required: true },
        {
          name: 'sound', label: '完成提示音', type: 'select', value: s.sound ? '1' : '0',
          options: [{ value: '1', label: '开启' }, { value: '0', label: '关闭' }]
        },
        {
          name: 'autoNext', label: '结束后自动开始下一段', type: 'select', value: s.autoNext ? '1' : '0',
          options: [{ value: '0', label: '关闭' }, { value: '1', label: '开启' }]
        }
      ],
      onSubmit: function (data) {
        var next = {
          work: Number(data.work) || 25, short: Number(data.short) || 5,
          long: Number(data.long) || 15, rounds: Number(data.rounds) || 4,
          sound: data.sound === '1', autoNext: data.autoNext === '1'
        };
        return ctx.api.set(MOD, 'settings', next).then(function (v) {
          D.settings = v || next;
          if (!running) { round = 1; mode = 'work'; remaining = dur(mode); }
          render();
          Panel.ui.toast('设置已保存', 'success');
        });
      }
    });
  }

  /* ---------------- 模块注册 ---------------- */
  Panel.registerModule({
    id: MOD,
    mount: function (el, context) {
      ctx = context; host = el;
      titleBase = document.title;
      el.appendChild(ctx.ui.loading('正在加载番茄钟…'));
      return Promise.all([ctx.api.get(MOD), ctx.api.get('todos').catch(function () { return []; })])
        .then(function (res) {
          D = res[0] || {};
          D.settings = D.settings || { work: 25, short: 5, long: 15, rounds: 4, sound: true, autoNext: false };
          D.sessions = Array.isArray(D.sessions) ? D.sessions : [];
          todos = Array.isArray(res[1]) ? res[1] : [];
          render();
        });
    },
    activate: function () {
      if (!D) return;
      Promise.all([ctx.api.get(MOD), ctx.api.get('todos').catch(function () { return []; })])
        .then(function (res) {
          var keep = { mode: mode, remaining: remaining, running: running, round: round };
          D = res[0] || D;
          if (!D.settings) D.settings = { work: 25, short: 5, long: 15, rounds: 4, sound: true, autoNext: false };
          if (!Array.isArray(D.sessions)) D.sessions = [];
          todos = Array.isArray(res[1]) ? res[1] : todos;
          render();
          mode = keep.mode; remaining = keep.remaining; round = keep.round;
          if (keep.running && !running) start(); else paint();
          refreshStats();
        }).catch(function () {});
    }
  });
})();
