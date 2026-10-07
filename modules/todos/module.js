/* 待办事项模块：新增 / 编辑 / 完成 / 删除 / 筛选 */
(function () {
  'use strict';
  var MOD = 'todos';
  var C = Panel.el, U = Panel.util;

  var list = [];
  var filter = 'all';       // all | active | done
  var sortBy = 'due';       // due | created
  var host = null, ctx = null;

  var PRIO = {
    '3': { label: '高', cls: 'p-high' },
    '2': { label: '中', cls: 'p-mid' },
    '1': { label: '低', cls: 'p-low' }
  };

  function visible() {
    var out = list.filter(function (t) {
      if (filter === 'active') return !t.done;
      if (filter === 'done') return !!t.done;
      return true;
    });
    out.sort(function (a, b) {
      if (sortBy === 'due') {
        var ad = a.due || '9999-99-99', bd = b.due || '9999-99-99';
        if (ad !== bd) return ad < bd ? -1 : 1;
      }
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
    if (filter === 'all') {
      out.sort(function (x, y) { return (x.done ? 1 : 0) - (y.done ? 1 : 0); });
    }
    return out;
  }

  function stats() {
    var open = list.filter(function (t) { return !t.done; });
    var today = U.today();
    var over = open.filter(function (t) { return t.due && t.due < today; });
    var dueToday = open.filter(function (t) { return t.due === today; });
    return { open: open.length, done: list.length - open.length, over: over.length, dueToday: dueToday.length };
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
        C('span', { class: 'stat-hint', text: s.dueToday ? '今天到期 ' + s.dueToday + ' 项' : '保持节奏' })),
      C('div', { class: 'stat' },
        C('span', { class: 'stat-label', text: '今日到期' }),
        C('span', { class: 'stat-value', text: String(s.dueToday) }),
        C('span', { class: 'stat-hint', text: s.over ? '已逾期 ' + s.over + ' 项' : '无逾期 🎉' })),
      C('div', { class: 'stat' },
        C('span', { class: 'stat-label', text: '已完成' }),
        C('span', { class: 'stat-value', text: String(s.done) }),
        C('span', { class: 'stat-hint', text: '累计 ' + list.length + ' 项' }))));

    var card = C('div', { class: 'card' });
    card.appendChild(C('div', { class: 'card-title' },
      C('span', {}, '待办清单'),
      C('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: function () { editTodo(null); } }, Panel.icon('plus'), '新建待办')));

    card.appendChild(C('div', { class: 'row', style: { marginBottom: '12px' } },
      ['all:全部', 'active:进行中', 'done:已完成'].map(function (x) {
        var kv = x.split(':');
        return C('button', {
          class: 'chip' + (filter === kv[0] ? ' active' : ''), type: 'button',
          onclick: function () { filter = kv[0]; render(); }
        }, kv[1]);
      }),
      C('span', { style: { flex: '1' } }),
      C('button', {
        class: 'chip', type: 'button',
        onclick: function () { sortBy = sortBy === 'due' ? 'created' : 'due'; render(); }
      }, sortBy === 'due' ? '按截止排序 ⇅' : '按创建排序 ⇅')));

    var items = visible();
    if (!items.length) {
      card.appendChild(Panel.ui.empty(
        filter === 'done' ? 'list' : 'check',
        filter === 'active' ? '没有进行中的待办' : filter === 'done' ? '还没有完成记录' : '清单是空的',
        '点右上角「新建待办」添加第一条'));
    } else {
      var box = C('div', { class: 'todo-list' });
      items.forEach(function (t) { box.appendChild(todoItem(t)); });
      card.appendChild(box);
    }

    page.appendChild(card);
    host.appendChild(page);
  }

  function todoItem(t) {
    var rel = U.relDay(t.due);
    var p = PRIO[String(t.priority || 2)] || PRIO['2'];
    var overdue = !t.done && t.due && t.due < U.today();

    return C('div', { class: 'todo-item' + (t.done ? ' is-done' : '') + (overdue ? ' is-over' : '') },
      C('button', {
        class: 'todo-check', type: 'button', title: t.done ? '标记为未完成' : '标记为已完成',
        onclick: function () {
          var next = Object.assign({}, t, { done: !t.done, doneAt: !t.done ? new Date().toISOString() : '' });
          ctx.api.save(MOD, '', next).then(function (saved) {
            t.done = saved.done; t.doneAt = saved.doneAt;
            render();
            Panel.ui.toast(saved.done ? '已完成：' + t.title : '已恢复：' + t.title, 'success');
          }).catch(function (e) { Panel.ui.toast(e.message, 'error'); });
        }
      }, t.done ? Panel.icon('check') : ''),
      C('div', { class: 'todo-main', onclick: function () { editTodo(t); } },
        C('div', { class: 'todo-title', text: t.title || '（未命名）' }),
        C('div', { class: 'todo-meta' },
          C('span', { class: 'badge ' + p.cls }, '优先·' + p.label),
          rel ? C('span', { class: 'badge ' + (overdue ? 'badge-danger' : rel.cls), text: rel.text }) : null,
          t.note ? C('span', { class: 'todo-note', text: t.note }) : null)),
      C('div', { class: 'todo-actions' },
        C('button', { class: 'mini-btn', type: 'button', title: '编辑', html: Panel.iconHtml('pencil'), onclick: function () { editTodo(t); } }),
        C('button', {
          class: 'mini-btn', type: 'button', title: '删除',
          onclick: function () {
            Panel.ui.confirm('删除待办「' + t.title + '」？', { danger: true, okText: '删除' })
              .then(function (ok) {
                if (!ok) return;
                ctx.api.remove(MOD, '', t.id).then(function () {
                  list = list.filter(function (x) { return x.id !== t.id; });
                  render();
                  Panel.ui.toast('已删除', 'success');
                }).catch(function (e) { Panel.ui.toast(e.message, 'error'); });
              });
          }
        }, '🗑️')));
  }

  function editTodo(t) {
    var isNew = !t;
    var model = t || {
      id: '', title: '', note: '', due: '', priority: '2',
      done: false, createdAt: new Date().toISOString(), doneAt: ''
    };
    Panel.ui.form({
      title: isNew ? '新建待办' : '编辑待办',
      fields: [
        { name: 'title', label: '标题', type: 'text', required: true, value: model.title, placeholder: '要做什么？' },
        { name: 'note', label: '备注', type: 'textarea', rows: 3, value: model.note, placeholder: '补充说明（可选）' },
        { name: 'due', label: '截止日期', type: 'date', value: model.due },
        {
          name: 'priority', label: '优先级', type: 'select', value: String(model.priority || 2),
          options: [{ value: '3', label: '高' }, { value: '2', label: '中' }, { value: '1', label: '低' }]
        }
      ],
      onSubmit: function (data) {
        var item = Object.assign({}, model, data);
        if (!item.id) { item.id = U.uid(); item.createdAt = new Date().toISOString(); }
        return ctx.api.save(MOD, '', item).then(function (saved) {
          var idx = -1;
          list.forEach(function (x, i) { if (x.id === saved.id) idx = i; });
          if (idx >= 0) list[idx] = saved; else list.push(saved);
          render();
          Panel.ui.toast(isNew ? '待办已添加' : '待办已更新', 'success');
        });
      }
    });
  }

  Panel.registerModule({
    id: MOD,
    mount: function (el, context) {
      ctx = context; host = el;
      el.appendChild(ctx.ui.loading('正在加载待办…'));
      return ctx.api.get(MOD).then(function (data) {
        list = Array.isArray(data) ? data : [];
        render();
      });
    },
    activate: function () {
      ctx.api.get(MOD).then(function (data) {
        list = Array.isArray(data) ? data : list;
        render();
      }).catch(function () {});
    }
  });
})();
