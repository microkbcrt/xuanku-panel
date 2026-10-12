/* 死线模块：添加带截止期限的任务，倒计时红色警告线 */
(function () {
  'use strict';
  var MOD = 'deadline';
  var C = Panel.el, U = Panel.util;
  var MIN = 60000, HOUR = 3600000, DAY = 86400000;

  var list = [];
  var filter = 'all';       // all | active | done
  var host = null, ctx = null, ticker = null;

  function parse(str) {
    if (!str) return 0;
    var t = new Date(str).getTime();
    return isNaN(t) ? 0 : t;
  }

  function level(ms) {
    if (ms < 0) return { key: 'over', cls: 'dl-over', label: '已过死线', pct: 100 };
    if (ms <= DAY) return { key: 'hot', cls: 'dl-hot', label: '死亡倒计时', pct: 100 };
    if (ms <= 3 * DAY) return { key: 'warn', cls: 'dl-warn', label: '非常紧急', pct: 75 };
    if (ms <= 7 * DAY) return { key: 'soon', cls: 'dl-soon', label: '临近', pct: 45 };
    return { key: 'ok', cls: 'dl-ok', label: '从容', pct: 16 };
  }

  function countdown(ms) {
    ms = Math.abs(ms);
    var d = Math.floor(ms / DAY);
    var h = Math.floor((ms % DAY) / HOUR);
    var m = Math.floor((ms % HOUR) / MIN);
    if (d > 0) return d + '天' + (h > 0 ? h + '时' : '');
    if (h > 0) return h + '时' + m + '分';
    return m + '分钟';
  }

  function fmtDT(str) {
    if (!str) return '';
    var t = new Date(str);
    if (isNaN(t.getTime())) return str;
    return (t.getMonth() + 1) + '月' + t.getDate() + '日 ' + U.pad(t.getHours()) + ':' + U.pad(t.getMinutes());
  }

  function localInputValue(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + U.pad(d.getMonth() + 1) + '-' + U.pad(d.getDate()) +
      'T' + U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
  }

  function visible() {
    var out = list.filter(function (t) {
      if (filter === 'active') return !t.done;
      if (filter === 'done') return !!t.done;
      return true;
    });
    out.sort(function (a, b) {
      var ao = a.done ? 1 : 0, bo = b.done ? 1 : 0;
      if (ao !== bo) return ao - bo;
      if (!a.done && !b.done) {
        var ad = parse(a.deadline), bd = parse(b.deadline);
        return (ad || 9e15) - (bd || 9e15);
      }
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
    return out;
  }

  function stats() {
    var open = list.filter(function (t) { return !t.done; });
    var over = open.filter(function (t) { return parse(t.deadline) && parse(t.deadline) < Date.now(); });
    var urgent = open.filter(function (t) {
      var ms = parse(t.deadline) - Date.now();
      return ms >= 0 && ms <= 3 * DAY;
    });
    return { open: open.length, done: list.length - open.length, over: over.length, urgent: urgent.length };
  }

  function render() {
    if (!host) return;
    host.textContent = '';
    var s = stats();
    var page = C('div', { class: 'page' });

    page.appendChild(C('div', { class: 'grid grid-3' },
      C('div', { class: 'stat' },
        C('span', { class: 'stat-label', text: '未完成' }),
        C('span', { class: 'stat-value', text: String(s.open) }),
        C('span', { class: 'stat-hint', text: s.open ? '死线逼近中' : '暂无任务' })),
      C('div', { class: 'stat' },
        C('span', { class: 'stat-label', text: '3 天内到期' }),
        C('span', { class: 'stat-value' + (s.urgent ? ' dl-danger' : ''), text: String(s.urgent) }),
        C('span', { class: 'stat-hint', text: s.urgent ? '红色警告！' : '暂时安全' })),
      C('div', { class: 'stat' },
        C('span', { class: 'stat-label', text: '已过死线' }),
        C('span', { class: 'stat-value' + (s.over ? ' dl-danger' : ''), text: String(s.over) }),
        C('span', { class: 'stat-hint', text: s.over ? '尽快处理' : '无逾期' }))));

    var card = C('div', { class: 'card' });
    card.appendChild(C('div', { class: 'card-title' },
      C('div', {},
        C('span', {}, '死线清单'),
        C('span', { class: 'sub', text: '紧迫截止任务 · 红色倒计时警告' })),
      C('button', { class: 'chip', type: 'button', title: '日常小事项用「待办」模块', onclick: function () { Panel.navigate('todos'); } }, '去待办')));

    var qa = U.draft.get('deadline.quickadd') || {};
    var titleIn = C('input', { class: 'input', type: 'text', value: qa.title || '', placeholder: '任务（如：数学作业提交）' });
    var dtIn = C('input', { class: 'input', type: 'datetime-local', value: qa.deadline || localInputValue(new Date(Date.now() + DAY)) });
    function saveQuickDraft() { U.draft.set('deadline.quickadd', { title: titleIn.value, deadline: dtIn.value }); }
    titleIn.addEventListener('input', saveQuickDraft);
    dtIn.addEventListener('input', saveQuickDraft);
    dtIn.addEventListener('change', saveQuickDraft);
    card.appendChild(C('div', { class: 'dl-add' },
      titleIn,
      dtIn,
      C('button', {
        class: 'btn btn-danger btn-sm', type: 'button',
        onclick: function () {
          var t = titleIn.value.trim(), dl = dtIn.value;
          if (!t) { Panel.ui.toast('请填写任务名称', 'error'); return; }
          if (!dl) { Panel.ui.toast('请选择死线时间', 'error'); return; }
          ctx.api.save(MOD, 'tasks', {
            id: '', title: t, note: '', deadline: dl,
            done: false, createdAt: new Date().toISOString(), doneAt: ''
          }).then(function (saved) {
            list.push(saved);
            titleIn.value = '';
            dtIn.value = localInputValue(new Date(Date.now() + DAY));
            U.draft.clear('deadline.quickadd');
            render();
            Panel.ui.toast('死线已添加', 'success');
          }).catch(function (e) { Panel.ui.toast(e.message, 'error'); });
        }
      }, '添加死线')));

    card.appendChild(C('div', { class: 'row', style: { marginTop: '12px' } },
      ['all:全部', 'active:进行中', 'done:已完成'].map(function (x) {
        var kv = x.split(':');
        return C('button', {
          class: 'chip' + (filter === kv[0] ? ' active' : ''), type: 'button',
          onclick: function () { filter = kv[0]; render(); }
        }, kv[1]);
      }),
      C('span', { style: { flex: '1' } }),
      C('button', {
        class: 'chip', type: 'button', title: '最紧急的排最前',
        onclick: function () { render(); }
      }, '急在前 ⇅')));

    var items = visible();
    if (!items.length) {
      card.appendChild(Panel.ui.empty(
        'warn',
        filter === 'done' ? '还没有完成记录' : filter === 'active' ? '没有进行中的任务' : '没有死线任务',
        '在上方添加真正的截止任务；日常清单请用「待办」'));
    } else {
      var box = C('div', { class: 'dl-list' });
      items.forEach(function (t) { box.appendChild(item(t)); });
      card.appendChild(box);
    }

    page.appendChild(card);
    host.appendChild(page);
  }

  function item(t) {
    var done = !!t.done;
    var ms = parse(t.deadline) - Date.now();
    var lv = done ? null : level(ms);
    var countTxt = done ? '已完成'
      : (lv.key === 'over' ? '已过死线 ' + countdown(ms) : '距死线 ' + countdown(ms));

    return C('div', { class: 'dl-item' + (done ? ' is-done' : '') + (lv ? ' ' + lv.cls : '') },
      C('button', {
        class: 'dl-check', type: 'button', title: done ? '标记为未完成' : '标记为已完成',
        onclick: function () {
          var next = Object.assign({}, t, { done: !done, doneAt: !done ? new Date().toISOString() : '' });
          ctx.api.save(MOD, 'tasks', next).then(function (saved) {
            t.done = saved.done; t.doneAt = saved.doneAt;
            render();
            Panel.ui.toast(saved.done ? '完成：' + t.title : '已恢复：' + t.title, 'success');
          }).catch(function (e) { Panel.ui.toast(e.message, 'error'); });
        }
      }, done ? Panel.icon('check') : ''),
      C('div', { class: 'dl-main', onclick: function () { edit(t); } },
        C('div', { class: 'dl-head' },
          C('span', { class: 'dl-title', text: t.title || '（未命名）' }),
          C('span', { class: 'dl-count', text: countTxt })),
        C('div', { class: 'dl-dead-bar' }, C('i', { style: { width: (done ? 100 : lv.pct) + '%' } })),
        C('div', { class: 'dl-meta' },
          C('span', { text: t.deadline ? '死线 · ' + fmtDT(t.deadline) : '未设定时间' }),
          done ? C('span', { text: '已在 ' + fmtDT(t.doneAt ? new Date(t.doneAt) : '') + ' 完成' }) : null,
          lv ? C('span', { class: 'dl-tag', text: lv.label }) : null,
          t.note ? C('span', { class: 'dl-note', text: t.note }) : null)),
      C('div', { class: 'dl-actions' },
        C('button', { class: 'mini-btn', type: 'button', title: '编辑', html: Panel.iconHtml('pencil'), onclick: function () { edit(t); } }),
        C('button', {
          class: 'mini-btn', type: 'button', title: '删除',
          onclick: function () {
            Panel.ui.confirm('删除死线任务「' + t.title + '」？', { danger: true, okText: '删除' })
              .then(function (ok) {
                if (!ok) return;
                ctx.api.remove(MOD, 'tasks', t.id).then(function () {
                  list = list.filter(function (x) { return x.id !== t.id; });
                  render();
                  Panel.ui.toast('已删除', 'success');
                }).catch(function (e) { Panel.ui.toast(e.message, 'error'); });
              });
          }
        }, '🗑️')));
  }

  function edit(t) {
    var isNew = !t;
    var model = t || {
      id: '', title: '', note: '', deadline: localInputValue(new Date(Date.now() + DAY)),
      done: false, createdAt: new Date().toISOString(), doneAt: ''
    };
    Panel.ui.form({
      title: isNew ? '新建死线任务' : '编辑死线任务',
      draftKey: 'deadline:' + (model.id || 'new'),
      fields: [
        { name: 'title', label: '任务', type: 'text', required: true, value: model.title, placeholder: '要交什么？' },
        { name: 'deadline', label: '死线时间', type: 'datetime-local', required: true, value: model.deadline },
        { name: 'note', label: '备注', type: 'textarea', rows: 3, value: model.note, placeholder: '补充说明（可选）' }
      ],
      onSubmit: function (data) {
        var item = Object.assign({}, model, data);
        if (!item.id) { item.id = U.uid(); item.createdAt = new Date().toISOString(); }
        return ctx.api.save(MOD, 'tasks', item).then(function (saved) {
          var idx = -1;
          list.forEach(function (x, i) { if (x.id === saved.id) idx = i; });
          if (idx >= 0) list[idx] = saved; else list.push(saved);
          render();
          Panel.ui.toast(isNew ? '死线任务已添加' : '死线任务已更新', 'success');
        });
      }
    });
  }

  function isActive() {
    if (!host) return false;
    var view = document.querySelector('.view.active');
    return !!view && view.contains(host);
  }

  /* 是否正在本模块的输入框内编辑（用于跳过自动刷新，避免打字/编辑时内容被覆盖） */
  function editingInHost() {
    var a = document.activeElement;
    return !!(a && host && host.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  }

  Panel.registerModule({
    id: MOD,
    mount: function (el, context) {
      ctx = context; host = el;
      el.appendChild(ctx.ui.loading('正在加载死线任务…'));
      ticker = ticker || U.ticker(function () {
        if (isActive() && !Panel.ui.hasOpenModal() && !editingInHost()) render();
      }, 60000);
      return ctx.api.get(MOD).then(function (data) {
        list = (data && Array.isArray(data.tasks)) ? data.tasks : [];
        render();
      });
    },
    activate: function () {
      ctx.api.get(MOD).then(function (data) {
        list = (data && Array.isArray(data.tasks)) ? data.tasks : list;
        render();
      }).catch(function () {});
    }
  });
})();