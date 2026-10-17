/* 校园跑模块：目标 / 手动里程记录 / 进度可视化 */
(function () {
  'use strict';
  var MOD = 'run';
  var C = Panel.el, U = Panel.util;

  var D = null;              // {target, entries}
  var host = null, ctx = null;
  var tt = null;             // 课表数据（用来推算学期还剩多少天）
  var selectedDay = '';      // 柱状图选中的日期 YYYY-MM-DD
  var dateEl = null, kmEl = null;  // 添加表单的输入框（供「补记这天」预填）

  function totalKm() {
    return (D.entries || []).reduce(function (a, x) { return a + (Number(x.km) || 0); }, 0);
  }
  function round2(n) { return Math.round(n * 100) / 100; }

  function sumBy(pred) {
    return round2((D.entries || []).filter(pred).reduce(function (a, x) { return a + (Number(x.km) || 0); }, 0));
  }

  /* 去掉多余的 0：3 → 3，1.2 → 1.2 */
  function fmtKm(n) { return String(Math.round((Number(n) || 0) * 100) / 100); }

  function pctOf(v, top) { return top > 0 ? (v / top) * 100 : 0; }

  /* 纵轴刻度：0 / 中间 / 顶部。顶部取「好看」的整数，柱子高度按这个刻度换算，
     保证最高的柱子刚好落在顶刻度线上 */
  function niceScale(top) {
    if (!(top > 0)) return { max: 2, mid: 1 };
    var raw = top / 2;
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    if (step < 0.2) step = 0.2;
    var max = Math.round(Math.ceil(top / step) * step * 100) / 100;
    return { max: max, mid: Math.round((max / 2) * 100) / 100 };
  }

  function dateText(d) { return (d.getMonth() + 1) + '月' + d.getDate() + '日'; }

  function dayLabel(d) {
    var wk = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + wk;
  }

  /* 达标预测：按「首条记录以来（最多近 14 天）」的日均节奏外推 */
  function paceInfo(remain) {
    if (!(remain > 0)) return null;
    var dates = (D.entries || []).map(function (x) { return x.date; }).filter(Boolean).sort();
    if (!dates.length) return null;
    var first = U.parseDate(dates[0]);
    var todayD = U.parseDate(U.today());
    if (isNaN(first) || isNaN(todayD)) return null;
    var span = Math.max(1, Math.round((todayD - first) / 86400000) + 1);  // 含首末两天
    var win = Math.min(span, 14);
    var from = U.today(U.addDays(todayD, -(win - 1)));
    var to = U.today(todayD);
    var km = sumBy(function (x) { return x.date >= from && x.date <= to; });
    var avg = round2(km / win);
    if (!(avg > 0)) return { win: win, avg: 0 };
    var days = Math.ceil(remain / avg);
    return { win: win, avg: avg, days: days, eta: U.addDays(todayD, days) };
  }

  /* 学期剩余天数：从课表取 termStart + 最大周数；取不到就返回 null（预测自动降级） */
  function semesterInfo() {
    var s = (tt && tt.settings) || null;
    if (!s || !s.termStart) return null;
    var start = U.parseDate(s.termStart);
    if (isNaN(start)) return null;
    var weeks = Number(s.weekCount) || 0;
    (tt.courses || []).forEach(function (c) {
      (c.weeks || []).forEach(function (w) { if (Number(w) > weeks) weeks = Number(w); });
    });
    if (!(weeks > 0)) return null;
    var end = U.addDays(start, weeks * 7 - 1);
    var left = Math.round((end - U.parseDate(U.today())) / 86400000) + 1;  // 含今天
    return { end: end, weeks: weeks, left: left };
  }

  /* 「预计什么时候跑完」：按当前节奏外推 + 按学期倒推所需日均 */
  function projBox(remain) {
    var proj = paceInfo(remain);
    var sem = semesterInfo();
    var box = C('div', { class: 'run-proj' });

    if (remain <= 0) {
      box.appendChild(C('span', { class: 'badge badge-brand', text: '目标已达成 🏆' }));
      return box;
    }

    if (proj && proj.avg > 0) {
      box.appendChild(C('span', { class: 'badge badge-brand', text: '预计 ' + dateText(proj.eta) + ' 跑完' }));
      box.appendChild(C('div', { class: 'run-proj-line' },
        C('span', { text: '按近 ' + proj.win + ' 天日均 ' }),
        C('b', { text: proj.avg + ' km' }),
        C('span', { text: ' 推算，还需 ' + proj.days + ' 天（还差 ' + remain + ' km）' })));
    } else {
      box.appendChild(C('span', { class: 'badge', text: '暂无达标预测' }));
      box.appendChild(C('div', { class: 'run-proj-line', text: '记录一次跑步后即可按你的节奏估算完成日期' }));
    }

    if (sem && sem.left > 0) {
      var need = round2(remain / sem.left);
      var ok = proj && proj.avg > 0 ? proj.avg >= need : null;
      box.appendChild(C('div', { class: 'run-proj-line' + (ok === null ? '' : ok ? ' is-ok' : ' is-warn') },
        C('span', { text: '学期还剩 ' + sem.left + ' 天（第 ' + sem.weeks + ' 周结束于 ' + dateText(sem.end) + '），需日均 ' }),
        C('b', { text: need + ' km' }),
        ok === null ? null : C('span', { text: ok ? '，当前节奏来得及 ✅' : '，当前节奏会跑不完 ⚠' })));
    } else if (sem) {
      box.appendChild(C('div', { class: 'run-proj-line is-warn', text: '学期（第 ' + sem.weeks + ' 周结束于 ' + dateText(sem.end) + '）已经结束' }));
    }
    return box;
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    if (!host) return;
    host.textContent = '';
    var page = C('div', { class: 'page' });

    var total = totalKm();
    var target = Number(D.target) || 100;
    var pct = target > 0 ? Math.min(100, (total / target) * 100) : 0;
    var remain = Math.max(0, round2(target - total));
    var today = U.today();

    /* ---- 进度大卡 ---- */
    var card = C('div', { class: 'card run-hero' });
    var ring = C('div', { class: 'run-ring' });
    var circ = 2 * Math.PI * 96;
    ring.innerHTML =
      '<svg viewBox="0 0 220 220">' +
      '<circle class="run-track" cx="110" cy="110" r="96"></circle>' +
      '<circle class="run-bar" cx="110" cy="110" r="96" style="stroke-dasharray:' + circ +
      ';stroke-dashoffset:' + (circ * (1 - pct / 100)) + '"></circle></svg>';
    ring.appendChild(C('div', { class: 'run-ring-center' },
      C('b', { text: pct.toFixed(1) + '%' }),
      C('span', { text: '已完成' })));

    card.appendChild(ring);
    card.appendChild(C('div', { class: 'run-info' },
      C('div', { class: 'run-title', text: '校园跑目标' }),
      C('div', { class: 'run-numbers' },
        C('b', { text: round2(total) + '' }),
        C('span', { text: ' / ' + target + ' 公里' })),
      C('div', { class: 'progress', style: { margin: '10px 0 8px' } },
        C('i', { style: { width: pct.toFixed(1) + '%' } })),
      C('div', { class: 'run-hint', text: remain > 0 ? '还差 ' + remain + ' 公里即可达成 🎯' : '目标已达成，太棒了 🏆' }),
      C('div', { class: 'run-mini' },
        C('span', { class: 'badge', text: '今日 ' + sumBy(function (x) { return x.date === today; }) + ' km' }),
        C('span', { class: 'badge', text: '本周 ' + sumBy(function (x) { return weekOf(x.date) === weekOf(today); }) + ' km' }),
        C('span', { class: 'badge', text: '共 ' + (D.entries || []).length + ' 次' })),
      projBox(remain),
      C('button', {
        class: 'chip', type: 'button', style: { marginTop: '10px' },
        onclick: editTarget
      }, Panel.icon('pencil'), '调整目标')));
    page.appendChild(card);

    /* ---- 近 14 天柱状图（带纵轴，点柱子看当天明细） ---- */
    var chart = C('div', { class: 'card' });
    chart.appendChild(C('div', { class: 'card-title' },
      C('span', { text: '近 14 天' }),
      C('span', { class: 'sub', text: '单位 km · 点击柱子查看当天明细' })));

    var days = [], top = 0;
    for (var i = 13; i >= 0; i--) {
      var d = U.addDays(new Date(), -i);
      var key = U.today(d);
      var km = sumBy(function (x) { return x.date === key; });
      if (km > top) top = km;
      days.push({ key: key, km: km, d: d, isToday: i === 0 });
    }
    if (selectedDay && !days.some(function (x) { return x.key === selectedDay; })) selectedDay = '';
    var scale = niceScale(top);

    var axis = C('div', { class: 'run-axis' });
    [scale.max, scale.mid, 0].forEach(function (v) {
      axis.appendChild(C('span', { style: { top: pctOf(v, scale.max) + '%' }, text: fmtKm(v) }));
    });

    var plot = C('div', { class: 'run-plot' },
      C('div', { class: 'run-grid' }, C('i'), C('i'), C('i')),
      C('div', { class: 'run-bars' }, days.map(function (day) {
        var h = Math.max(day.km > 0 ? 6 : 2, pctOf(day.km, scale.max));
        return C('button', {
          class: 'run-bar-col' + (day.isToday ? ' is-today' : '') + (day.km > 0 ? ' has' : '') +
            (selectedDay === day.key ? ' is-sel' : ''),
          type: 'button',
          title: dayLabel(day.d) + '：' + day.km + ' km（点击查看明细）',
          onclick: function () {
            selectedDay = selectedDay === day.key ? '' : day.key;
            render();
          }
        },
          C('span', { class: 'run-bar-val', style: { bottom: h + '%' }, text: fmtKm(day.km) }),
          C('i', { style: { height: h + '%' } }),
          C('span', { class: 'run-bar-day', text: day.d.getDate() + '' }));
      })));

    chart.appendChild(C('div', { class: 'run-chart' }, axis, plot));
    if (selectedDay) chart.appendChild(dayDetail(selectedDay));
    page.appendChild(chart);

    /* ---- 添加记录 ---- */
    var addCard = C('div', { class: 'card' });
    addCard.appendChild(C('div', { class: 'card-title' },
      C('span', { text: '添加记录' }),
      C('span', { class: 'sub', text: '手动录入每次跑步' })));

    var inDate = C('input', { class: 'input', type: 'date', value: today });
    var inKm = C('input', { class: 'input', type: 'number', step: '0.01', min: '0.01', placeholder: '例如 3.2' });
    var inNote = C('input', { class: 'input', type: 'text', placeholder: '备注：操场 / 晨跑（可选）', maxlength: '40' });
    dateEl = inDate; kmEl = inKm;

    addCard.appendChild(C('div', { class: 'run-form' },
      C('div', { class: 'field' }, C('label', { text: '日期' }), inDate),
      C('div', { class: 'field' }, C('label', { text: '距离（km）' }), inKm),
      C('div', { class: 'field run-note' }, C('label', { text: '备注' }), inNote),
      C('button', {
        class: 'btn btn-primary', type: 'button',
        onclick: function () {
          var km = Number(inKm.value);
          if (!inDate.value) { Panel.ui.toast('请选择日期', 'error'); return; }
          if (!km || km <= 0) { Panel.ui.toast('请输入有效距离', 'error'); inKm.focus(); return; }
          var item = {
            id: U.uid(), date: inDate.value, km: round2(km),
            note: inNote.value.trim(), createdAt: new Date().toISOString()
          };
          ctx.api.save(MOD, 'entries', item).then(function (saved) {
            D.entries.push(saved);
            render();
            Panel.ui.toast('已记录 ' + saved.km + ' km', 'success');
            setTimeout(function () { if (kmEl) kmEl.focus(); }, 60);
          }).catch(function (e) { Panel.ui.toast(e.message, 'error'); });
        }
      }, Panel.icon('plus'), '记录一次')));
    page.appendChild(addCard);

    /* ---- 记录列表 ---- */
    var listCard = C('div', { class: 'card' });
    var entries = sortEntries(D.entries || []);
    listCard.appendChild(C('div', { class: 'card-title' },
      C('span', { text: '跑步记录' }),
      entries.length ? C('button', {
        class: 'chip', type: 'button',
        onclick: function () {
          Panel.ui.confirm('清空所有跑步记录？', { danger: true, okText: '清空' }).then(function (ok) {
            if (!ok) return;
            ctx.api.set(MOD, 'entries', []).then(function (v) {
              D.entries = v || []; selectedDay = ''; render(); Panel.ui.toast('已清空', 'success');
            });
          });
        }
      }, '清空') : null));

    if (!entries.length) {
      listCard.appendChild(Panel.ui.empty('run', '还没有跑步记录', '在上方添加第一次校园跑吧'));
    } else {
      var lastDate = '';
      entries.forEach(function (e) {
        if (e.date !== lastDate) {
          lastDate = e.date;
          var dk = sumBy(function (x) { return x.date === e.date; });
          listCard.appendChild(C('div', { class: 'run-day' + (selectedDay === e.date ? ' is-sel' : '') },
            C('b', { text: e.date }),
            C('span', { text: '当日合计 ' + dk + ' km' })));
        }
        listCard.appendChild(runItem(e));
      });
    }
    page.appendChild(listCard);
    host.appendChild(page);
  }

  function sortEntries(list) {
    return list.slice().sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  }

  /* 记录时间显示本地时间（createdAt 存的是 ISO/UTC，直接截串会差 8 小时） */
  function timeOf(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(11, 16);
    return U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
  }

  function runItem(e) {
    return C('div', { class: 'run-item' },
      C('span', { class: 'run-item-km', text: e.km + '' }),
      C('span', { class: 'run-item-unit', text: 'km' }),
      C('span', { class: 'run-item-note', text: e.note || '—' }),
      C('span', { class: 'run-item-time', text: timeOf(e.createdAt) }),
      C('button', {
        class: 'mini-btn', type: 'button', title: '删除', html: Panel.iconHtml('trash'),
        onclick: function () {
          Panel.ui.confirm('删除 ' + e.date + ' 这条 ' + e.km + ' km 的记录？', { danger: true, okText: '删除' })
            .then(function (ok) {
              if (!ok) return;
              ctx.api.remove(MOD, 'entries', e.id).then(function () {
                D.entries = D.entries.filter(function (x) { return x.id !== e.id; });
                render(); Panel.ui.toast('已删除', 'success');
              }).catch(function (err) { Panel.ui.toast(err.message, 'error'); });
            });
        }
      }));
  }

  /* 某一天的明细（点柱子后展开在图表下面） */
  function dayDetail(dayKey) {
    var list = (D.entries || []).filter(function (x) { return x.date === dayKey; })
      .sort(function (a, b) { return (a.createdAt || '').localeCompare(b.createdAt || ''); });
    var d = U.parseDate(dayKey);
    var box = C('div', { class: 'run-day-detail' });

    box.appendChild(C('div', { class: 'run-dd-head' },
      C('b', { text: dayLabel(d) }),
      C('span', { text: list.length ? '合计 ' + sumBy(function (x) { return x.date === dayKey; }) + ' km · ' + list.length + ' 次' : '这天没有记录' }),
      C('button', {
        class: 'chip', type: 'button', style: { marginLeft: 'auto' },
        onclick: function () { selectedDay = ''; render(); }
      }, '收起')));

    if (!list.length) {
      box.appendChild(C('div', { class: 'run-dd-empty' },
        C('span', { text: '要不要补记这一天的里程？' }),
        C('button', { class: 'chip', type: 'button', onclick: function () { fillAdd(dayKey); } },
          Panel.icon('plus'), '补记这天')));
      return box;
    }
    list.forEach(function (e) { box.appendChild(runItem(e)); });
    return box;
  }

  /* 「补记这天」：收起明细、把日期预填进添加表单并聚焦距离输入框 */
  function fillAdd(dayKey) {
    selectedDay = '';
    render();
    if (dateEl) dateEl.value = dayKey;
    if (kmEl) kmEl.focus();
    Panel.ui.toast('已选好 ' + dayKey + '，填上距离就行', 'info');
  }

  function weekOf(dateStr) {
    return Math.floor(U.mondayOf(U.parseDate(dateStr)).getTime() / 604800000);
  }

  function editTarget() {
    Panel.ui.form({
      title: '调整校园跑目标',
      fields: [{ name: 'target', label: '本学期目标（公里）', type: 'number', required: true, value: D.target || 100, min: 1, max: 2000 }],
      onSubmit: function (data) {
        var v = Number(data.target);
        if (!v || v <= 0) { Panel.ui.toast('目标需大于 0', 'error'); return false; }
        return ctx.api.set(MOD, 'target', v).then(function (nv) {
          D.target = nv; render(); Panel.ui.toast('目标已更新为 ' + nv + ' 公里', 'success');
        });
      }
    });
  }

  function loadData() {
    return Promise.all([
      ctx.api.get(MOD),
      ctx.api.get('timetable').catch(function () { return null; })
    ]);
  }

  Panel.registerModule({
    id: MOD,
    mount: function (el, context) {
      ctx = context; host = el;
      el.appendChild(ctx.ui.loading('正在加载校园跑…'));
      return loadData().then(function (res) {
        D = res[0] || {};
        D.target = Number(D.target) || 100;
        D.entries = Array.isArray(D.entries) ? D.entries : [];
        if (res[1]) tt = res[1];
        render();
      });
    },
    activate: function () {
      if (!D) return;
      loadData().then(function (res) {
        var data = res[0];
        if (data) { D = data; D.entries = Array.isArray(D.entries) ? D.entries : []; }
        if (res[1]) tt = res[1];
        render();
      }).catch(function () {});
    }
  });
})();
