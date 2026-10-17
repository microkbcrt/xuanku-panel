/* 设置模块：个人信息 / 学期作息 / 外观 / 数据管理 / 扩展接口说明 */
(function () {
  'use strict';
  var MOD = 'settings';
  var C = Panel.el, U = Panel.util;

  var host = null, ctx = null;
  var tt = null;      // 课表模块文档（个人信息 / 学期 / 作息）
  var theme = 'light', accent = 'aurora';
  var periodsRestoreToastShown = false;
  var DATA_IDS = ['todos', 'pomodoro', 'run', 'chaoxing', 'timetable'];

  var ACCENTS = [
    ['aurora', '极光蓝'], ['sunset', '日落橙'], ['emerald', '翡翠绿'], ['violet', '星紫']
  ];

  function render() {
    if (!host) return;
    host.textContent = '';
    var page = C('div', { class: 'page' });
    var s = tt.settings || {};
    var week = calcWeek(s);

    /* ---------- 个人与学期 ---------- */
    var info = C('div', { class: 'card' });
    info.appendChild(C('div', { class: 'card-title' }, C('span', { text: '个人信息与学期' }),
      C('span', { class: 'sub', text: '用于课表页展示' })));

    var fName = C('input', { class: 'input', value: s.student || '' });
    var fNo = C('input', { class: 'input', value: s.studentNo || '' });
    var fTerm = C('input', { class: 'input', value: s.term || '' });
    var fStart = C('input', { class: 'input', type: 'date', value: s.termStart || '' });
    var fWeek = C('input', { class: 'input', type: 'number', min: '0', max: '60', value: s.weekOverride || 0 });
    var weekTip = C('div', { class: 'set-tip', text: '按学期开始日期自动计算：当前为第 ' + week + ' 周（填 0 表示自动）' });

    info.appendChild(C('div', { class: 'set-grid' },
      C('div', { class: 'field' }, C('label', { text: '姓名' }), fName),
      C('div', { class: 'field' }, C('label', { text: '学号' }), fNo),
      C('div', { class: 'field set-span' }, C('label', { text: '学期' }), fTerm),
      C('div', { class: 'field' }, C('label', { text: '学期开始日期（周一）' }), fStart),
      C('div', { class: 'field' }, C('label', { text: '指定当前周（0=自动）' }), fWeek)));

    info.appendChild(weekTip);
    info.appendChild(C('div', { class: 'row', style: { marginTop: '12px' } },
      C('button', {
        class: 'btn btn-primary btn-sm', type: 'button',
        onclick: function () {
          var patch = {
            student: fName.value.trim(), studentNo: fNo.value.trim(),
            term: fTerm.value.trim(), termStart: fStart.value,
            weekOverride: Number(fWeek.value) || 0
          };
          saveSettings(patch, '个人信息已保存');
        }
      }, '保存'),
      C('button', {
        class: 'btn btn-sm', type: 'button',
        onclick: function () {
          fWeek.value = 0;
          saveSettings({ weekOverride: 0 }, '已切换为自动计算周次');
        }
      }, '恢复自动周次')));
    page.appendChild(info);

    /* ---------- 作息时间 ---------- */
    var pc = C('div', { class: 'card' });
    pc.appendChild(C('div', { class: 'card-title' },
      C('span', { text: '作息时间（节次）' }),
      C('span', { class: 'sub', text: '影响课表高亮与今日课程' })));

    var table = C('div', { class: 'set-periods' });
    var inputs = [];
    /* 草稿保护：正在调整作息时若页面被意外刷新/回收，重新打开设置仍能恢复未保存的时间 */
    var pDraft = Panel.util.draft.get('timetable.periods');
    (s.periods || []).forEach(function (p, i) {
      var dv = (pDraft && pDraft[i]) ? pDraft[i] : null;
      var st = C('input', { class: 'input', type: 'time', value: (dv && dv.start) || p.start });
      var en = C('input', { class: 'input', type: 'time', value: (dv && dv.end) || p.end });
      inputs.push({ st: st, en: en });
      table.appendChild(C('div', { class: 'set-period-row' },
        C('b', { text: '第 ' + p.n + ' 节' }), st, C('span', { text: '—' }), en));
    });
    table.addEventListener('input', function () {
      Panel.util.draft.set('timetable.periods', inputs.map(function (x, i) {
        return { n: i + 1, start: x.st.value, end: x.en.value };
      }));
    });
    if (pDraft && !periodsRestoreToastShown) {
      periodsRestoreToastShown = true;
      Panel.ui.toast('已恢复未保存的作息修改', 'info');
    }
    pc.appendChild(table);
    pc.appendChild(C('div', { class: 'row', style: { marginTop: '12px' } },
      C('button', {
        class: 'btn btn-primary btn-sm', type: 'button',
        onclick: function () {
          var periods = inputs.map(function (x, i) {
            return { n: i + 1, start: x.st.value, end: x.en.value };
          });
          saveSettings({ periods: periods }, '作息时间已保存').then(function () {
            Panel.util.draft.clear('timetable.periods');
          });
        }
      }, '保存作息')));
    page.appendChild(pc);

    /* ---------- 调休补课与放假 ---------- */
    var ac = C('div', { class: 'card' });
    ac.appendChild(C('div', { class: 'card-title' },
      C('span', { text: '调休补课与放假' }),
      C('span', { class: 'sub', text: '某天按别天的课表显示 / 某天放假不显示课表' })));

    var WD = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    function wdOf(dateStr) { return WD[(U.parseDate(dateStr).getDay() + 6) % 7]; }
    function mdOf(dateStr) { var d = U.parseDate(dateStr); return (d.getMonth() + 1) + '月' + d.getDate() + '日'; }
    function curSwaps() { return Array.isArray(s.swaps) ? s.swaps : []; }

    var adjMode = 'swap';
    var fAdjDate = C('input', { class: 'input', type: 'date' });
    var fAdjFrom = C('input', { class: 'input', type: 'date' });
    var adjFromField = C('div', { class: 'field' }, C('label', { text: '补哪天的课（来源日期）' }), fAdjFrom);
    var modeRow = C('div', { class: 'row' });
    var modeChips = [];
    [['swap', '对调补课'], ['add', '仅补课'], ['off', '放假']].forEach(function (m) {
      var chip = C('button', {
        class: 'chip' + (adjMode === m[0] ? ' active' : ''), type: 'button',
        onclick: function () {
          adjMode = m[0];
          modeChips.forEach(function (x) { x.el.classList.toggle('active', x.k === adjMode); });
          adjFromField.style.display = adjMode === 'off' ? 'none' : '';
        }
      }, m[1]);
      modeChips.push({ k: m[0], el: chip });
      modeRow.appendChild(chip);
    });

    ac.appendChild(C('div', { class: 'set-grid' },
      C('div', { class: 'field' }, C('label', { text: '安排日期' }), fAdjDate),
      adjFromField,
      C('div', { class: 'field set-span' }, C('label', { text: '模式' }), modeRow)));
    ac.appendChild(C('div', { class: 'row', style: { marginTop: '12px' } },
      C('button', {
        class: 'btn btn-primary btn-sm', type: 'button',
        onclick: function () {
          if (!fAdjDate.value) { Panel.ui.toast('请选择日期', 'error'); return; }
          if (adjMode !== 'off') {
            if (!fAdjFrom.value) { Panel.ui.toast('请选择「补哪天的课」日期', 'error'); return; }
            if (fAdjFrom.value === fAdjDate.value) { Panel.ui.toast('两个日期不能相同', 'error'); return; }
          }
          var arr = curSwaps().filter(function (e) { return !e || e.date !== fAdjDate.value; });
          arr.push(adjMode === 'off'
            ? { date: fAdjDate.value, mode: 'off' }
            : { date: fAdjDate.value, from: fAdjFrom.value, mode: adjMode });
          arr.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
          saveSettings({ swaps: arr }, adjMode === 'off' ? '已设置放假' : '已添加调休安排');
        }
      }, '添加安排')));

    var adjList = C('div', { class: 'set-swap-list' });
    (function renderAdjList() {
      var arr = curSwaps();
      if (!arr.length) {
        adjList.appendChild(C('div', { class: 'set-tip', text: '暂无调休安排。例如：把本周六设为「补本周三的课」，课表页周六列就会显示周三的课表。' }));
        return;
      }
      arr.forEach(function (e) {
        if (!e || !e.date) return;
        var text = e.mode === 'off'
          ? mdOf(e.date) + ' ' + wdOf(e.date) + ' · 放假（不显示课表）'
          : mdOf(e.date) + ' ' + wdOf(e.date) + ' ← 补 ' + mdOf(e.from) + ' ' + wdOf(e.from) +
            (e.mode === 'swap' ? ' · 对调' : ' · 仅补课');
        adjList.appendChild(C('div', { class: 'set-swap-row' },
          C('span', { text: text }),
          C('button', {
            class: 'mini-btn', type: 'button', title: '删除',
            onclick: function () {
              saveSettings({ swaps: curSwaps().filter(function (x) { return !x || x.date !== e.date; }) },
                '已删除调休安排');
            }
          }, '🗑️')));
      });
    })();
    ac.appendChild(adjList);
    page.appendChild(ac);

    /* ---------- 外观 ---------- */
    var look = C('div', { class: 'card' });
    look.appendChild(C('div', { class: 'card-title' }, C('span', { text: '外观' })));

    var themeRow = C('div', { class: 'row' });
    [['dark', '深色'], ['light', '浅色']].forEach(function (t) {
      themeRow.appendChild(C('button', {
        class: 'chip' + (theme === t[0] ? ' active' : ''), type: 'button',
        onclick: function () {
          theme = t[0];
          if (Panel.util.applyTheme) Panel.util.applyTheme(theme);
          else document.documentElement.dataset.theme = theme;
          try { localStorage.setItem('panel.theme', theme); } catch (e) {}
          render();
        }
      }, Panel.icon(t[0] === 'dark' ? 'moon' : 'sun'), t[1]));
    });
    look.appendChild(themeRow);

    var accentRow = C('div', { class: 'row', style: { marginTop: '10px' } });
    ACCENTS.forEach(function (a) {
      accentRow.appendChild(C('button', {
        class: 'chip accent-chip' + (accent === a[0] ? ' active' : ''), type: 'button',
        dataset: { accent: a[0] },
        onclick: function () {
          accent = a[0];
          document.documentElement.dataset.accent = accent;
          try { localStorage.setItem('panel.accent', accent); } catch (e) {}
          render();
        }
      }, C('i', { class: 'accent-dot', dataset: { accent: a[0] } }), a[1]));
    });
    look.appendChild(accentRow);
    page.appendChild(look);

    /* ---------- 数据管理 ---------- */
    var dc = C('div', { class: 'card' });
    dc.appendChild(C('div', { class: 'card-title' }, C('span', { text: '数据管理' }),
      C('span', { class: 'sub', text: 'JSON 存储于 data/ 目录' })));

    var file = C('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var parsed = JSON.parse(String(reader.result));
          var payload = parsed && parsed.modules ? parsed.modules : parsed;
          Panel.ui.confirm('导入将覆盖当前数据，确定继续？', { danger: true, okText: '导入' })
            .then(function (ok) {
              if (!ok) return;
              ctx.api.custom(MOD, 'import', { body: { data: payload } })
                .then(function (r) {
                  Panel.ui.toast('已导入 ' + ((r && r.restored) || []).length + ' 个模块', 'success');
                  Panel.reload(MOD);
                })
                .catch(function (e) { Panel.ui.toast(e.message, 'error'); });
            });
        } catch (e) {
          Panel.ui.toast('JSON 解析失败', 'error');
        }
      };
      reader.readAsText(f, 'utf-8');
      file.value = '';
    });

    dc.appendChild(C('div', { class: 'row' },
      C('button', {
        class: 'btn', type: 'button',
        onclick: function () {
          ctx.api.custom(MOD, 'export', { method: 'GET', body: undefined }).then(function (data) {
            try {
              Panel.util.saveFile('panel-backup-' + U.today() + '.json',
                JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
              Panel.ui.toast('已导出全部数据', 'success');
            } catch (e) {
              Panel.ui.toast('导出失败：' + e.message + '（刚更新过请卸载重装新版）', 'error');
            }
          }).catch(function (e) { Panel.ui.toast(e.message, 'error'); });
        }
      }, '⬇ 导出全部数据'),
      C('button', { class: 'btn', type: 'button', onclick: function () { file.click(); } }, '⬆ 导入备份'),
      file));

    var resetRow = C('div', { class: 'row', style: { marginTop: '12px' } });
    resetRow.appendChild(C('span', { class: 'set-tip-inline', text: '恢复默认：' }));
    DATA_IDS.forEach(function (id) {
      resetRow.appendChild(C('button', {
        class: 'chip', type: 'button',
        onclick: function () {
          Panel.ui.confirm('将「' + id + '」恢复为初始数据？当前内容会丢失。', { danger: true, okText: '恢复' })
            .then(function (ok) {
              if (!ok) return;
              ctx.api.reset(id).then(function () {
                Panel.ui.toast(id + ' 已恢复默认', 'success');
                if (id === 'timetable') loadTimetable();
              }).catch(function (e) { Panel.ui.toast(e.message, 'error'); });
            });
        }
      }, '↺ ' + id));
    });
    dc.appendChild(resetRow);
    page.appendChild(dc);

    /* ---------- GitHub 数据备份（所有端） ---------- */
    if (Panel.github.available()) {
      page.appendChild(buildGitHubCard());
      page.appendChild(buildPublicCard());
    }

/* ---------- GitHub 数据同步（手动上传 / 拉取） ---------- */
  function buildGitHubCard() {
    var cfg = Panel.github.config() || {};
    var card = C('div', { class: 'card' });
    card.appendChild(C('div', { class: 'card-title' },
      C('span', { text: 'GitHub 数据备份' }),
      C('span', { class: 'sub', text: '上传保存本端数据 / 拉取云端数据（上传手动，启动时自动检查云端更新）' })));

    var fTok = C('input', { class: 'input', type: 'password', value: cfg.token || '', placeholder: 'GitHub Personal Access Token（PAT，需 repo 写权限）' });
    var status = C('div', { class: 'set-tip', text: '本端数据独立保存在设备上；GitHub 仅作为备份仓库（' + (cfg.owner || '') + '/' + (cfg.repo || '') + '@' + (cfg.branch || 'main') + '）。启动时自动检查：云端有新推送且本端无未上传修改 → 自动拉取；有差异 → 弹窗询问，不会静默覆盖。' });

    function fmt(ts) {
      if (!ts) return '从未上传';
      var d = new Date(ts);
      var p = function (n) { return (n < 10 ? '0' : '') + n; };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    function pushBtn() {
      return C('button', {
        class: 'btn btn-primary btn-sm', type: 'button',
        onclick: function () {
          var btn = this;
          Panel.ui.confirm('上传会将本机全部模块数据写入 GitHub 并覆盖云端旧副本，继续？', { okText: '上传' })
            .then(function (ok) {
              if (!ok) return;
              btn.disabled = true; btn.textContent = '上传中…';
              Panel.github.push().then(function (r) {
                Panel.ui.toast('已上传 ' + r.pushed.length + ' 个模块到 GitHub', 'success');
                status.textContent = '上次上传：' + fmt(Panel.github.lastPush());
                btn.disabled = false; btn.textContent = '⬆ 上传到 GitHub';
                render();
              }).catch(function (e) {
                status.textContent = e.message; status.style.color = '#e5484d';
                Panel.ui.toast('上传失败：' + e.message, 'error');
                btn.disabled = false; btn.textContent = '⬆ 上传到 GitHub';
              });
            });
        }
      }, '⬆ 上传到 GitHub');
    }

    function pullBtn() {
      return C('button', {
        class: 'btn btn-sm', type: 'button',
        onclick: function () {
          var btn = this;
          Panel.ui.confirm('拉取会用 GitHub 上的数据覆盖本机当前数据（本机改动将丢失），确定继续？', { danger: true, okText: '拉取' })
            .then(function (ok) {
              if (!ok) return;
              btn.disabled = true; btn.textContent = '拉取中…';
              Panel.github.pull().then(function (r) {
                var msg = '已从 GitHub 拉取 ' + r.pulled.length + ' 个模块并覆盖本机数据';
                if (r.missing && r.missing.length) msg += '（云端无：' + r.missing.join('、') + '）';
                Panel.ui.toast(msg, 'success');
                btn.disabled = false; btn.textContent = '⬇ 从 GitHub 拉取';
                render();
                (r.pulled || []).forEach(function (id) { Panel.reload(id); });
              }).catch(function (e) {
                status.textContent = e.message; status.style.color = '#e5484d';
                Panel.ui.toast('拉取失败：' + e.message, 'error');
                btn.disabled = false; btn.textContent = '⬇ 从 GitHub 拉取';
              });
            });
        }
      }, '⬇ 从 GitHub 拉取');
    }

    card.appendChild(C('div', { class: 'set-grid' },
      C('div', { class: 'field set-span' }, C('label', { text: '访问令牌（PAT）' }), fTok)));
    card.appendChild(status);
    card.appendChild(C('div', { class: 'row', style: { marginTop: '12px' } },
      C('button', {
        class: 'btn btn-sm', type: 'button',
        onclick: function () {
          Panel.github.setToken(fTok.value);
          var btn = this;
          btn.disabled = true; btn.textContent = '检测中…';
          Panel.github.test().then(function (j) {
            status.textContent = '令牌有效：' + (j.canWrite ? '可读写 ✓' : '只读（缺 repo 写权限）') + ' · 仓库' + (j.private ? '私有' : '公开') + ' · ' + (cfg.owner || '') + '/' + (cfg.repo || '');
            status.style.color = '';
            Panel.ui.toast('GitHub 令牌有效', 'success');
            btn.disabled = false; btn.textContent = '保存并检测';
          }).catch(function (e) {
            status.textContent = e.message; status.style.color = '#e5484d';
            Panel.ui.toast('连接失败：' + e.message, 'error');
            btn.disabled = false; btn.textContent = '保存并检测';
          });
        }
      }, '保存并检测'),
      C('button', {
        class: 'btn btn-sm', type: 'button',
        onclick: function () {
          Panel.github.clearToken();
          fTok.value = '';
          status.textContent = '已清除本地令牌。'; status.style.color = '';
          Panel.ui.toast('已清除 GitHub 令牌', 'success');
        }
      }, '清除令牌')));
    card.appendChild(C('div', { class: 'row', style: { marginTop: '12px' } },
      pushBtn(), pullBtn()));
    card.appendChild(C('div', { class: 'set-tip', style: { color: 'var(--text-dim, #909399)' }, text: '上次上传：' + fmt(Panel.github.lastPush()) }));
    return card;
  }

  /* ---------- 公共课表发布（推送到班级公共站仓库） ---------- */
  function buildPublicCard() {
    var card = C('div', { class: 'card' });
    card.appendChild(C('div', { class: 'card-title' },
      C('span', { text: '公共课表发布' }),
      C('span', { class: 'sub', text: '把课表（含调休补课）推送到班级公共站，同学刷新即见' })));

    var def = { owner: 'microkbcrt', repo: 'class-timetable' };
    try {
      var saved = JSON.parse(localStorage.getItem('panel.publicRepo') || 'null');
      if (saved && saved.owner && saved.repo) def = saved;
    } catch (e) {}
    var fRepo = C('input', { class: 'input', value: def.owner + '/' + def.repo, placeholder: 'owner/repo' });
    var tip = C('div', { class: 'set-tip', text: '发布走 GitHub 令牌（上方卡片保存，PAT 需对公共仓库有写权限）；同学端打开公共站自动读取最新数据。' });

    function fmtTime(ts) {
      var d = new Date(ts), p = function (n) { return (n < 10 ? '0' : '') + n; };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
    function parseRepo(v) {
      var m = String(v || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '').split('/');
      return (m.length === 2 && m[0] && m[1]) ? { owner: m[0], repo: m[1] } : null;
    }

    try {
      var last = Number(localStorage.getItem('panel.publicLastPush')) || 0;
      if (last) tip.textContent = '上次发布：' + fmtTime(last) + ' · ' + def.owner + '/' + def.repo;
    } catch (e) {}

    card.appendChild(C('div', { class: 'set-grid' },
      C('div', { class: 'field set-span' }, C('label', { text: '公共仓库（owner/repo）' }), fRepo)));
    card.appendChild(tip);
    card.appendChild(C('div', { class: 'row', style: { marginTop: '12px' } },
      C('button', {
        class: 'btn btn-primary btn-sm', type: 'button',
        onclick: function () {
          var r = parseRepo(fRepo.value);
          if (!r) { Panel.ui.toast('仓库格式应为 owner/repo', 'error'); return; }
          if (!tt || !tt.courses) { Panel.ui.toast('课表数据未加载', 'error'); return; }
          var btn = this;
          btn.disabled = true; btn.textContent = '发布中…';
          var doc = JSON.parse(JSON.stringify(tt));
          if (Array.isArray(doc.courses)) doc.courses = doc.courses.filter(function (c) { return c && c.shared !== false; });
          Panel.github.putTo(r.owner, r.repo, 'main', 'data/timetable.json', JSON.stringify(doc, null, 2), 'panel: 发布公共课表')
            .then(function () {
              try {
                localStorage.setItem('panel.publicRepo', JSON.stringify(r));
                localStorage.setItem('panel.publicLastPush', String(Date.now()));
              } catch (e) {}
              Panel.ui.toast('已发布课表到 ' + r.owner + '/' + r.repo, 'success');
              tip.textContent = '上次发布：' + fmtTime(Date.now()) + ' · ' + r.owner + '/' + r.repo;
              tip.style.color = '';
              btn.disabled = false; btn.textContent = '📤 发布课表数据';
            })
            .catch(function (e) {
              Panel.ui.toast('发布失败：' + e.message, 'error');
              tip.textContent = e.message; tip.style.color = '#e5484d';
              btn.disabled = false; btn.textContent = '📤 发布课表数据';
            });
        }
      }, '📤 发布课表数据')));
    return card;
  }

  /* ---------- 云端同步（仅本地 PHP 服务器模式） ---------- */
    if (Panel.github.mode() === 'php') page.appendChild(buildSyncCard());

    /* ---------- 扩展接口 ---------- */
    page.appendChild(buildDevCard());

    host.appendChild(page);
  }

  function calcWeek(s) {
    if (s.weekOverride > 0) return s.weekOverride;
    var start = U.parseDate(s.termStart || U.today());
    if (isNaN(start.getTime())) return 1;
    return Math.max(1, Math.round((U.mondayOf(new Date()) - U.mondayOf(start)) / 604800000) + 1);
  }

  function saveSettings(patch, msg) {
    var next = Object.assign({}, tt.settings, patch);
    return ctx.api.set('timetable', 'settings', next).then(function (v) {
      tt.settings = v || next;
      render();
      Panel.ui.toast(msg, 'success');
      return tt.settings;
    }).catch(function (e) { Panel.ui.toast(e.message, 'error'); });
  }

  function loadTimetable(silent) {
    return ctx.api.get('timetable').then(function (d) {
      tt = d || { settings: {}, courses: [] };
      if (!silent) render();
      return tt;
    });
  }

  /* ---------- 云端同步 ---------- */
  function buildSyncCard() {
    var st = Panel.sync.remoteState();
    var card = C('div', { class: 'card' });
    card.appendChild(C('div', { class: 'card-title' },
      C('span', { text: '云端同步' }),
      C('span', { class: 'sub', text: '把数据同步到你的服务器（如 InfinityFree）' })));

    var fUrl = C('input', { class: 'input', value: st.url, placeholder: 'https://your-domain.gd' });
    var fTok = C('input', { class: 'input', value: st.token, placeholder: '面板令牌（留空用默认）' });
    var status = C('div', { class: 'set-tip', text: buildSyncStatus(st) });

    function refreshStatus() {
      status.textContent = buildSyncStatus(Panel.sync.remoteState());
    }
    function buildSyncStatus(s) {
      var parts = [];
      if (s.url) parts.push('云端：' + s.url);
      else parts.push('云端：未配置（仅在浏览器访问服务器时自动生效）');
      if (s.dirty && s.dirty.length) parts.push('待同步：' + s.dirty.length + ' 个模块（' + s.dirty.join('、') + '）');
      else parts.push('待同步：0');
      return parts.join('　');
    }

    card.appendChild(C('div', { class: 'set-grid' },
      C('div', { class: 'field set-span' }, C('label', { text: '云端地址' }), fUrl),
      C('div', { class: 'field set-span' }, C('label', { text: '令牌（X-Panel-Token）' }), fTok)));
    card.appendChild(status);
    card.appendChild(C('div', { class: 'row', style: { marginTop: '12px' } },
      C('button', {
        class: 'btn btn-primary btn-sm', type: 'button',
        onclick: function () {
          Panel.sync.setRemote(fUrl.value, fTok.value);
          Panel.ui.toast('云端配置已保存', 'success');
          render();
        }
      }, '保存配置'),
      C('button', {
        class: 'btn btn-sm', type: 'button',
        onclick: function () {
          if (!fUrl.value.trim()) { Panel.ui.toast('请先填写云端地址', 'error'); return; }
          var btn = this;
          btn.disabled = true; btn.textContent = '同步中…';
          Panel.sync.setRemote(fUrl.value, fTok.value);
          Panel.sync.remote().then(function (r) {
            var n = 0, pushed = 0, pulled = 0;
            Object.keys(r).forEach(function (k) {
              n++;
              if (r[k].pushed) pushed++;
              if (r[k].pulled) pulled++;
            });
            Panel.ui.toast('同步完成：推送 ' + pushed + '，拉取 ' + pulled + '，共 ' + n + ' 个模块', 'success');
            btn.disabled = false; btn.textContent = '立即同步';
            refreshStatus();
            Panel.reload(MOD);
          }).catch(function (e) {
            Panel.ui.toast('同步失败：' + e.message, 'error');
            btn.disabled = false; btn.textContent = '立即同步';
          });
        }
      }, '立即同步')));
    return card;
  }

  /* ---------- 扩展接口说明 ---------- */
  function buildDevCard() {
    var card = C('div', { class: 'card' });
    card.appendChild(C('div', { class: 'card-title' },
      C('span', { text: '扩展接口 · 快速添加新功能' }),
      C('span', { class: 'sub', text: 'modules/ 目录自动发现' })));

    card.appendChild(C('div', { class: 'set-dev-list' },
      C('div', { class: 'set-dev-item' },
        C('b', { text: '1. 建目录' }),
        C('code', { text: 'modules/my-module/module.json' })),
      C('div', { class: 'set-dev-item' },
        C('b', { text: '2. 写界面' }),
        C('code', { text: 'modules/my-module/module.js' })),
      C('div', { class: 'set-dev-item' },
        C('b', { text: '3. 默认数据（可选）' }),
        C('code', { text: 'modules/my-module/default.json' })),
      C('div', { class: 'set-dev-item' },
        C('b', { text: '4. 自定义接口（可选）' }),
        C('code', { text: 'modules/my-module/api.php' }))));

    var sample =
      '// module.json\n' +
      '{ "id": "my-module", "name": "新功能", "icon": "calendar", "order": 10 }\n\n' +
      '// module.js\n' +
      'Panel.registerModule({\n' +
      '  id: "my-module",\n' +
      '  mount: function (el, ctx) {\n' +
      '    ctx.api.get("my-module").then(function (doc) {\n' +
      '      el.appendChild(ctx.el("div", { class: "card" },\n' +
      '        "Hello " + (doc.msg || "World")));\n' +
      '    });\n' +
      '  }\n' +
      '});\n\n' +
      '// 数据接口（无需写 PHP）\n' +
      'ctx.api.get(mod, path)        // GET  a=get\n' +
      'ctx.api.set(mod, path, value) // POST a=set    {value}\n' +
      'ctx.api.save(mod, path, item) // POST a=save   {value}  按 id 增改\n' +
      'ctx.api.remove(mod, path, id) // POST a=remove {id}\n' +
      'ctx.api.reset(mod)            // POST a=reset  恢复默认\n' +
      'ctx.api.custom(mod, "act", { body: {...} });';

    card.appendChild(C('pre', { class: 'set-code' }, C('code', { text: sample })));

    var loaded = C('div', { class: 'row', style: { marginTop: '10px' } });
    (Panel.boot.modules || []).forEach(function (m) {
      loaded.appendChild(C('span', { class: 'badge badge-brand' }, Panel.icon(m.icon), m.name));
    });
    card.appendChild(C('div', { class: 'set-tip', text: '已发现模块：把新目录放进 modules/ 后刷新页面即可生效。' }));
    card.appendChild(loaded);
    return card;
  }

  Panel.registerModule({
    id: MOD,
    mount: function (el, context) {
      ctx = context; host = el;
      el.appendChild(ctx.ui.loading('正在加载设置…'));
      try {
        theme = document.documentElement.dataset.theme || 'dark';
        accent = document.documentElement.dataset.accent || 'aurora';
      } catch (e) {}
      return loadTimetable().catch(function (e) {
        tt = { settings: {}, courses: [] };
        throw e;
      });
    },
    activate: function () {
      if (!tt) return;
      loadTimetable().catch(function () {});
    }
  });
})();
