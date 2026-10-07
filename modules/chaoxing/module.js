/* 学习通课程学习进度模块（手动记录） */
(function () {
  'use strict';
  var MOD = 'chaoxing';
  var C = Panel.el, U = Panel.util;

  var D = null;   // {courses: []}
  var host = null, ctx = null;
  var sortMode = 'low';   // low | high | recent

  function sorted() {
    var arr = (D.courses || []).slice();
    if (sortMode === 'low') arr.sort(function (a, b) { return (a.percent || 0) - (b.percent || 0); });
    else if (sortMode === 'high') arr.sort(function (a, b) { return (b.percent || 0) - (a.percent || 0); });
    else arr.sort(function (a, b) { return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')); });
    return arr;
  }

  function avg() {
    var arr = D.courses || [];
    if (!arr.length) return 0;
    return arr.reduce(function (a, x) { return a + (Number(x.percent) || 0); }, 0) / arr.length;
  }

  function level(p) {
    if (p >= 100) return { cls: 'lv-max', text: '已完成' };
    if (p >= 70) return { cls: 'lv-hi', text: '进展顺利' };
    if (p >= 30) return { cls: 'lv-mid', text: '进行中' };
    if (p > 0) return { cls: 'lv-low', text: '刚刚开始' };
    return { cls: 'lv-low', text: '未开始' };
  }

  function render() {
    if (!host) return;
    host.textContent = '';
    var page = C('div', { class: 'page' });
    var courses = D.courses || [];
    var a = avg();
    var lv = level(a);

    /* ---- 总览 ---- */
    var hero = C('div', { class: 'card cx-hero' },
      C('div', { class: 'cx-hero-left' },
        C('div', { class: 'cx-hero-label', text: '学习通总体进度' }),
        C('div', { class: 'cx-hero-num' },
          C('b', { text: a.toFixed(1) + '%' }),
          C('span', { class: 'badge ' + (a >= 100 ? 'badge-ok' : 'badge-brand'), text: lv.text })),
        C('div', { class: 'progress', style: { marginTop: '10px', height: '11px' } },
          C('i', { style: { width: a.toFixed(1) + '%' } })),
        C('div', { class: 'cx-hero-hint', text: '共 ' + courses.length + ' 门课程 · ' +
          courses.filter(function (c) { return (c.percent || 0) >= 100; }).length + ' 门已完成' })),
      C('button', { class: 'btn btn-primary', type: 'button', onclick: function () { editCourse(null); } }, Panel.icon('plus'), '添加课程'));
    page.appendChild(hero);

    /* ---- 排序 ---- */
    var bar = C('div', { class: 'row' },
      [['low', '进度从低到高'], ['high', '进度从高到低'], ['recent', '最近更新']].map(function (x) {
        return C('button', {
          class: 'chip' + (sortMode === x[0] ? ' active' : ''), type: 'button',
          onclick: function () { sortMode = x[0]; render(); }
        }, x[1]);
      }));
    page.appendChild(bar);

    /* ---- 课程卡片 ---- */
    if (!courses.length) {
      page.appendChild(C('div', { class: 'card' },
        Panel.ui.empty('book', '还没有课程', '点击「添加课程」手动录入学习通进度')));
      host.appendChild(page);
      return;
    }

    var grid = C('div', { class: 'grid grid-2' });
    sorted().forEach(function (c) {
      var p = Math.max(0, Math.min(100, Number(c.percent) || 0));
      var l = level(p);
      grid.appendChild(C('div', { class: 'card cx-card' },
        C('div', { class: 'cx-head' },
          C('div', { class: 'cx-name', text: c.name || '未命名课程' }),
          C('span', { class: 'cx-badge ' + l.cls, text: l.text })),
        C('div', { class: 'cx-percent' },
          C('b', { text: p + '%' }),
          C('span', { text: c.note ? c.note : '更新于 ' + String(c.updatedAt || '').slice(0, 10) })),
        C('div', { class: 'progress' }, C('i', { style: { width: p + '%' } })),
        C('div', { class: 'cx-actions' },
          C('button', {
            class: 'mini-btn', type: 'button', title: '减少 5%',
            onclick: function () { bump(c, -5); }
          }, '−5%'),
          C('button', {
            class: 'mini-btn', type: 'button', title: '增加 5%',
            onclick: function () { bump(c, 5); }
          }, '+5%'),
          C('span', { style: { flex: '1' } }),
          C('button', { class: 'mini-btn', type: 'button', title: '编辑', html: Panel.iconHtml('pencil'), onclick: function () { editCourse(c); } }),
          C('button', { class: 'mini-btn', type: 'button', title: '删除', html: Panel.iconHtml('trash'), onclick: function () { removeCourse(c); } }))));
    });
    page.appendChild(grid);
    host.appendChild(page);
  }

  function persist(item) {
    return ctx.api.save(MOD, 'courses', item).then(function (saved) {
      var idx = -1;
      D.courses.forEach(function (x, i) { if (x.id === saved.id) idx = i; });
      if (idx >= 0) D.courses[idx] = saved; else D.courses.push(saved);
      render();
      return saved;
    });
  }

  function bump(c, delta) {
    var p = Math.max(0, Math.min(100, (Number(c.percent) || 0) + delta));
    if (p === (Number(c.percent) || 0)) { Panel.ui.toast(p >= 100 ? '已经是 100%' : '已经是 0%', 'info'); return; }
    persist(Object.assign({}, c, { percent: p, updatedAt: new Date().toISOString() }))
      .then(function (s) { Panel.ui.toast(s.name + ' → ' + s.percent + '%', 'success'); })
      .catch(function (e) { Panel.ui.toast(e.message, 'error'); });
  }

  function removeCourse(c) {
    Panel.ui.confirm('删除课程「' + c.name + '」？', { danger: true, okText: '删除' }).then(function (ok) {
      if (!ok) return;
      ctx.api.remove(MOD, 'courses', c.id).then(function () {
        D.courses = D.courses.filter(function (x) { return x.id !== c.id; });
        render(); Panel.ui.toast('已删除', 'success');
      }).catch(function (e) { Panel.ui.toast(e.message, 'error'); });
    });
  }

  function editCourse(c) {
    var isNew = !c;
    var model = c || { id: '', name: '', percent: 0, note: '', updatedAt: '' };
    Panel.ui.form({
      title: isNew ? '添加课程进度' : '编辑课程进度',
      fields: [
        { name: 'name', label: '课程名称', type: 'text', required: true, value: model.name, placeholder: '例如：高等数学1（学习通）' },
        {
          name: 'percent', label: '学习进度（0-100%）', type: 'number', required: true,
          value: model.percent, min: 0, max: 100, step: 1
        },
        { name: 'note', label: '备注', type: 'text', value: model.note, placeholder: '例如：已完成 12/20 章（可选）' }
      ],
      onSubmit: function (data) {
        var p = Number(data.percent);
        if (isNaN(p) || p < 0 || p > 100) { Panel.ui.toast('进度需在 0-100 之间', 'error'); return false; }
        var item = Object.assign({}, model, {
          name: String(data.name).trim(),
          percent: Math.round(p * 10) / 10,
          note: String(data.note || '').trim(),
          updatedAt: new Date().toISOString()
        });
        if (!item.id) item.id = U.uid();
        return persist(item).then(function () {
          Panel.ui.toast(isNew ? '课程已添加' : '课程已更新', 'success');
        });
      }
    });
  }

  Panel.registerModule({
    id: MOD,
    mount: function (el, context) {
      ctx = context; host = el;
      el.appendChild(ctx.ui.loading('正在加载学习通进度…'));
      return ctx.api.get(MOD).then(function (data) {
        D = data || {};
        D.courses = Array.isArray(D.courses) ? D.courses : [];
        render();
      });
    },
    activate: function () {
      if (!D) return;
      ctx.api.get(MOD).then(function (data) {
        if (data) { D = data; D.courses = Array.isArray(D.courses) ? D.courses : []; }
        render();
      }).catch(function () {});
    }
  });
})();
