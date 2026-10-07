/* 校园跑模块：目标 / 手动里程记录 / 进度可视化 */
(function () {
  'use strict';
  var MOD = 'run';
  var C = Panel.el, U = Panel.util;

  var D = null;   // {target, entries}
  var host = null, ctx = null;

  function totalKm() {
    return (D.entries || []).reduce(function (a, x) { return a + (Number(x.km) || 0); }, 0);
  }
  function round2(n) { return Math.round(n * 100) / 100; }

  function sumBy(pred) {
    return round2((D.entries || []).filter(pred).reduce(function (a, x) { return a + (Number(x.km) || 0); }, 0));
  }

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
      C('button', {
        class: 'chip', type: 'button', style: { marginTop: '10px' },
        onclick: editTarget
      }, Panel.icon('pencil'), '调整目标')));
    page.appendChild(card);

    /* ---- 近 14 天柱状图 ---- */
    var chart = C('div', { class: 'card' });
    chart.appendChild(C('div', { class: 'card-title' }, C('span', { text: '近 14 天' }), C('span', { class: 'sub', text: '公里' })));
    var bars = C('div', { class: 'run-chart' });
    var max = 0;
    var days = [];
    for (var i = 13; i >= 0; i--) {
      var d = U.addDays(new Date(), -i);
      var key = U.today(d);
      var km = sumBy(function (x) { return x.date === key; });
      if (km > max) max = km;
      days.push({ key: key, km: km, d: d, isToday: i === 0 });
    }
    days.forEach(function (day) {
      var h = max > 0 ? Math.max(day.km > 0 ? 8 : 2, (day.km / max) * 100) : (day.km > 0 ? 8 : 2);
      bars.appendChild(C('div', {
        class: 'run-bar-col' + (day.isToday ? ' is-today' : '') + (day.km > 0 ? ' has' : ''),
        title: day.key + '：' + day.km + ' km'
      },
        C('i', { style: { height: h + '%' } }),
        C('span', { text: day.d.getDate() + '' })));
    });
    chart.appendChild(bars);
    page.appendChild(chart);

    /* ---- 添加记录 ---- */
    var addCard = C('div', { class: 'card' });
    addCard.appendChild(C('div', { class: 'card-title' },
      C('span', { text: '添加记录' }),
      C('span', { class: 'sub', text: '手动录入每次跑步' })));

    var inDate = C('input', { class: 'input', type: 'date', value: today });
    var inKm = C('input', { class: 'input', type: 'number', step: '0.01', min: '0.01', placeholder: '例如 3.2' });
    var inNote = C('input', { class: 'input', type: 'text', placeholder: '备注：操场 / 晨跑（可选）', maxlength: '40' });

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
            setTimeout(function () { inKm.focus(); }, 60);
          }).catch(function (e) { Panel.ui.toast(e.message, 'error'); });
        }
      }, Panel.icon('plus'), '记录一次')));
    page.appendChild(addCard);

    /* ---- 记录列表 ---- */
    var listCard = C('div', { class: 'card' });
    var entries = (D.entries || []).slice().sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || '');
    });
    listCard.appendChild(C('div', { class: 'card-title' },
      C('span', { text: '跑步记录' }),
      entries.length ? C('button', {
        class: 'chip', type: 'button',
        onclick: function () {
          Panel.ui.confirm('清空所有跑步记录？', { danger: true, okText: '清空' }).then(function (ok) {
            if (!ok) return;
            ctx.api.set(MOD, 'entries', []).then(function (v) {
              D.entries = v || []; render(); Panel.ui.toast('已清空', 'success');
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
          listCard.appendChild(C('div', { class: 'run-day' },
            C('b', { text: e.date }),
            C('span', { text: '当日合计 ' + dk + ' km' })));
        }
        listCard.appendChild(C('div', { class: 'run-item' },
          C('span', { class: 'run-item-km', text: e.km + '' }),
          C('span', { class: 'run-item-unit', text: 'km' }),
          C('span', { class: 'run-item-note', text: e.note || '—' }),
          C('button', {
            class: 'mini-btn', type: 'button', title: '删除', html: Panel.iconHtml('trash'),
            onclick: function () {
              Panel.ui.confirm('删除这条 ' + e.km + ' km 的记录？', { danger: true, okText: '删除' })
                .then(function (ok) {
                  if (!ok) return;
                  ctx.api.remove(MOD, 'entries', e.id).then(function () {
                    D.entries = D.entries.filter(function (x) { return x.id !== e.id; });
                    render(); Panel.ui.toast('已删除', 'success');
                  }).catch(function (err) { Panel.ui.toast(err.message, 'error'); });
                });
            }
          })));
      });
    }
    page.appendChild(listCard);
    host.appendChild(page);
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

  Panel.registerModule({
    id: MOD,
    mount: function (el, context) {
      ctx = context; host = el;
      el.appendChild(ctx.ui.loading('正在加载校园跑…'));
      return ctx.api.get(MOD).then(function (data) {
        D = data || {};
        D.target = Number(D.target) || 100;
        D.entries = Array.isArray(D.entries) ? D.entries : [];
        render();
      });
    },
    activate: function () {
      if (!D) return;
      ctx.api.get(MOD).then(function (data) {
        if (data) { D = data; D.entries = Array.isArray(D.entries) ? D.entries : []; }
        render();
      }).catch(function () {});
    }
  });
})();
