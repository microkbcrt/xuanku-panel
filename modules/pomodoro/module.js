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
  var linked = null;            // 当前关联的任务 {mod,id,title,due,kind}
  var pickables = [];           // 可关联的任务池：待办 + 死线
  var todos = [], dlTasks = [];
  var audioCtx = null, audioReady = false, chimeUrl = null, alertTimer = null;

  // DOM 引用
  var timeEl, ringEl, modeEl, roundEl, ctrlBtn, statToday, statTotal, sessionBox, titleBase;
  var cardEl = null, linkEl = null, statusEl = null;

  var MODE_CN = { work: '专注', short: '短休息', long: '长休息' };

  function dur(m) {
    var s = D.settings || {};
    var v = m === 'work' ? s.work : m === 'short' ? s.short : s.long;
    return Math.max(1, Number(v) || 25) * 60;
  }

  function total() { return dur(mode); }

  /* ---------------- 提示音 ---------------- */
  /* 浏览器（含 Android WebView）有自动播放策略：AudioContext 若不在用户手势里创建/恢复，
     会一直停在 suspended —— 这正是「倒计时结束没声音」的根因。所以：
     ① 任意手势里提前解锁并播一个静音帧；② 播放时若仍未 running 就等 resume 再放；
     ③ 失败则退回 <audio> 播一段现生成的 WAV；④ 无论出声与否都给震动 + 闪烁提醒。 */
  function audioCtxGet() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = audioCtx || new AC();
      return audioCtx;
    } catch (e) { return null; }
  }

  function unlockAudio() {
    var c = audioCtxGet();
    if (!c) return;
    try {
      if (c.state === 'suspended') {
        var p = c.resume();
        if (p && p.catch) p.catch(function () {});
      }
      if (!audioReady) {
        var b = c.createBuffer(1, 1, 22050), s = c.createBufferSource();
        s.buffer = b; s.connect(c.destination); s.start(0);
        audioReady = true;
      }
    } catch (e) {}
  }

  function playNotes(c, n) {
    var notes = [784, 988, 1319];
    var t0 = c.currentTime + 0.04;
    for (var i = 0; i < n; i++) {
      var o = c.createOscillator(), g = c.createGain();
      o.type = 'sine';
      o.frequency.value = notes[i % notes.length];
      var t = t0 + i * 0.3;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + 0.28);
    }
  }

  /* 兜底提示音：现生成一段三声 WAV（data URI），不依赖 WebAudio 是否被解锁 */
  function makeChimeWav() {
    var rate = 22050, notes = [784, 988, 1319], dur = 0.26, gap = 0.04;
    var totalSec = notes.length * (dur + gap), len = Math.floor(rate * totalSec);
    var bytes = 44 + len * 2, buf = new ArrayBuffer(bytes), v = new DataView(buf);
    function tag(off, s) { for (var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); }
    tag(0, 'RIFF'); v.setUint32(4, bytes - 8, true); tag(8, 'WAVE');
    tag(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    tag(36, 'data'); v.setUint32(40, len * 2, true);
    for (var i = 0; i < len; i++) {
      var t = i / rate;
      var k = Math.min(notes.length - 1, Math.floor(t / (dur + gap)));
      var lt = t - k * (dur + gap);
      var env = lt < dur ? Math.min(1, lt / 0.02) * Math.exp(-3.4 * lt) : 0;
      var s = Math.sin(2 * Math.PI * notes[k] * t) * env * 0.5;
      v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 32767, true);
    }
    var u8 = new Uint8Array(buf), bin = '';
    for (var j = 0; j < u8.length; j++) bin += String.fromCharCode(u8[j]);
    return 'data:audio/wav;base64,' + btoa(bin);
  }

  function fallbackChime() {
    try {
      if (!chimeUrl) chimeUrl = makeChimeWav();
      var a = new Audio(chimeUrl);
      a.volume = 0.9;
      var p = a.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }

  /* 返回是否成功发出声音（供「试听提示音」按钮判断） */
  function beep(times, force) {
    if (!force && D && D.settings && D.settings.sound === false) return false;  // 仅显式关闭才静音
    var n = Math.max(1, times || 3);
    var c = audioCtxGet();
    if (c) {
      try {
        if (c.state === 'running') { playNotes(c, n); return true; }
        var p = c.resume();
        if (p && typeof p.then === 'function') {
          p.then(function () {
            if (c.state === 'running') playNotes(c, n);
            else fallbackChime();
          }).catch(function () { fallbackChime(); });
          return true;
        }
      } catch (e) {}
    }
    fallbackChime();
    return true;
  }

  /* 到点提醒：声音之外再给震动 + 卡片闪烁 + 标题闪（声音被系统静音也看得见） */
  function flashAlert() {
    if (cardEl) {
      cardEl.classList.add('pomo-alert');
      if (alertTimer) clearTimeout(alertTimer);
      alertTimer = setTimeout(function () { if (cardEl) cardEl.classList.remove('pomo-alert'); }, 4600);
    }
    if (navigator.vibrate) {
      try { navigator.vibrate([200, 100, 200, 100, 340]); } catch (e) {}
    }
    var base = titleBase || document.title, on = false, n = 0;
    var iv = setInterval(function () {
      on = !on; n++;
      document.title = on ? '⏰ 时间到！' : base;
      if (n >= 8) { clearInterval(iv); document.title = base; }
    }, 550);
  }

  ['pointerdown', 'touchstart', 'keydown'].forEach(function (ev) {
    window.addEventListener(ev, unlockAudio, true);
  });

  /* ---------------- 系统级到点响铃（Android 原生壳自排的闹钟） ----------------
     Capacitor 在 Activity 进入后台时会暂停 WebView 的 JS 定时器（黑屏 = 后台），只靠 ticker
     回前台补跑就成了「点亮屏幕才响」。之前用 LocalNotifications 插件踩了两个坑：① 插件渠道
     的声音走「通知」声道，手机一静音就永远不响；② 没有通知权限时 schedule() 直接 reject，
     被 catch 吞掉就变成静默失败。现在改成由 MainActivity 注入的 window.PanelAlarm 自己排：
     到点由广播拉起着前台服务，用闹钟声道播 res/raw/pomodoro_done.wav（静音/振动模式也听得见、
     不需要任何权限），有通知权限再顺带弹一条通知。开始计时就挂上；到点前 1 秒（页面可见 =
     前台）撤掉，改由应用内提示音，避免双重响铃。
     原生 v3 起：「挂闹钟（setAlarmClock）/ 广播触发 / 播放成败 / 报错」全部记进手机本地，
     网页状态行与「🩺 原生诊断」直接读——出问题能看出到底断在哪一步，不用猜。
     原生 v4 起：开始计时的同时拉起一个「锁屏守护」前台服务（常驻通知带倒计时），整个计时
     期间应用都算「正在运行」——ColorOS 这类 ROM 才不会把后台应用的闹钟代理/冻结
     （真机实测：没有守护时锁屏 10 秒后闹钟被 OplusAlarmAdjustment 代理接管，只有点亮屏幕
     的瞬间才响；系统设置「耗电管理 → 允许完全后台行为」也能关掉它，两条腿走路）。 */
  var NATIVE_MIN_VER = 4;      // 需要的主 APK 原生层版本（低于它 = 装的是旧 APK）
  var notifShown = 0;          // 已挂上原生闹钟的 endAt（0 = 没挂）
  var nativeStat = null;       // 原生自检：{ver, sdk, notif, exact, batt, vol, pi, lastRingAt, ...}
  var nativeWarned = false;    // 挂载失败/无权限的提示只弹一次
  var testAt = 0;              // 最近一次「测试响铃」的时刻（持久化：黑屏期间过了也能对账）
  var testTimer = null;        // 测试闹钟的「触发没触发」轮询
  var battAsked = false;       // 电池优化引导只问一次
  var visBound = false;        // 回前台刷新原生状态的钩子只绑一次
  try {
    testAt = Number(localStorage.getItem('panel.pomo.testAt')) || 0;
    battAsked = localStorage.getItem('panel.pomo.battAsked') === '1';
  } catch (e) {}

  function alarmApi() {
    try {
      var a = window.PanelAlarm;
      if (a && typeof a.arm === 'function' && typeof a.cancel === 'function') return a;
    } catch (e) {}
    return null;
  }

  /* 是不是跑在 Android 原生壳里（浏览器/桌面版没有原生闹钟，状态行整块不显示） */
  function isNativeShell() {
    try {
      var c = window.Capacitor;
      return !!(c && c.isNativePlatform && c.isNativePlatform());
    } catch (e) { return false; }
  }

  function refreshNativeStat() {
    var a = alarmApi();
    if (!a) { nativeStat = null; paintStatus(); return null; }
    try { nativeStat = JSON.parse(a.status() || 'null'); } catch (e) { nativeStat = null; }
    paintStatus();
    return nativeStat;
  }

  function notifBody(m) {
    return m === 'work' ? '这一轮完成，起来活动一下' : '休息结束，开始下一轮吧';
  }

  function notifTitle(m) { return m === 'work' ? '🍅 专注结束' : '☕ 休息结束'; }

  /* 挂原生闹钟（同步返回，失败可见）；返回是否挂上 */
  function armNative(at, ask) {
    var a = alarmApi();
    if (!a || !at) return false;
    try {
      var res = JSON.parse(a.arm(at, notifTitle(mode), notifBody(mode), !!ask) || '{}');
      nativeStat = res;
      if (!res.armed) {
        if (!nativeWarned) {
          nativeWarned = true;
          Panel.ui.toast('系统闹钟没挂上（' + (res.error || '未知原因') + '），锁屏到点可能不响', 'error');
        }
        return false;
      }
      if (res.notif === false && !nativeWarned) {
        nativeWarned = true;
        Panel.ui.toast('通知权限未开：到点会响，但通知栏不显示（可在系统设置里开启）', 'info');
      }
      return true;
    } catch (e) {
      return false;
    } finally {
      paintStatus();
    }
  }

  function cancelNative() {
    notifShown = 0;
    var a = alarmApi();
    if (!a) return;
    try { a.cancel(); } catch (e) {}
    paintStatus();
  }

  /* 清掉通知栏里已响过的那条（回前台结算后） */
  function clearNativeShade() {
    var a = alarmApi();
    if (!a) return;
    try { a.clearShade(); } catch (e) {}
  }

  /* 「测试响铃」：8 秒后响一次（独立闹钟，不影响正在计时的那个）。
     点完立刻锁屏才是真正要验证的场景——所以触发与否靠原生记的时间对账，不靠页面活着。 */
  function testRinging() {
    var a = alarmApi();
    if (!a || typeof a.test !== 'function') {
      Panel.ui.toast('当前环境没有系统闹钟（浏览器/桌面版只在页面开着时响）', 'info');
      return;
    }
    try {
      var res = JSON.parse(a.test(8) || '{}');
      refreshNativeStat();
      if (!res.armed) {
        Panel.ui.toast('测试闹钟没挂上：' + (res.error || '未知原因'), 'error');
        return;
      }
      testAt = Date.now();
      try { localStorage.setItem('panel.pomo.testAt', String(testAt)); } catch (e) {}
      watchTest();
      paintStatus();
      Panel.ui.toast(res.notif === false
        ? '8 秒后响铃（通知权限未开，只响不弹）；现在就锁屏试试'
        : '8 秒后响铃并弹通知，现在就锁屏试试', 'success');
    } catch (e) {
      Panel.ui.toast('测试闹钟调用失败：' + e.message, 'error');
    }
  }

  /* 测试闹钟有没有真的响：原生把「广播触发时刻」写进 lastRingAt，比 testAt 新即已触发 */
  function testFired() {
    return !!(nativeStat && testAt && Number(nativeStat.lastRingAt || 0) >= testAt);
  }

  /* 按下测试后轮询 30 秒更新状态行（页面在前台时）；锁屏中 JS 会冻结，
     解锁回前台由 visibilitychange / pageshow 钩子补一次刷新。 */
  function watchTest() {
    if (testTimer) { clearTimeout(testTimer); testTimer = null; }
    if (!testAt) return;
    var tries = 0;
    (function loop() {
      testTimer = setTimeout(function () {
        tries++;
        refreshNativeStat();
        if (testFired() || tries >= 15) { testTimer = null; paintStatus(); return; }
        loop();
      }, 2000);
    })();
  }

  /* 电池优化白名单：国产 ROM 冻结后台闹钟的头号原因，挂上闹钟后问一次 */
  function requestBattery() {
    var a = alarmApi();
    if (!a || typeof a.requestBattery !== 'function') {
      Panel.ui.toast('当前环境不支持（浏览器/桌面版）', 'info');
      return;
    }
    try {
      var res = JSON.parse(a.requestBattery() || '{}');
      Panel.ui.toast(res.ok === false
        ? '打开设置失败：' + (res.error || '未知原因')
        : res.already ? '已经关闭电池优化了' : '请在弹出的系统设置里选「允许」/「不限制」', res.ok === false ? 'error' : 'info');
    } catch (e) {}
    setTimeout(refreshNativeStat, 1500);
  }

  function maybeAskBattery() {
    if (battAsked || !nativeStat || nativeStat.batt !== false) return;
    if (typeof Panel.ui.confirm !== 'function') return;
    battAsked = true;
    try { localStorage.setItem('panel.pomo.battAsked', '1'); } catch (e) {}
    Panel.ui.confirm('为了锁屏后闹钟准点响，建议把本应用加入「电池优化白名单」（国产手机尤其需要）。现在去设置？',
      { okText: '去设置' }).then(function (ok) { if (ok) requestBattery(); });
  }

  /* 跳到本应用的系统设置页——从那儿进「电池 / 耗电管理」开「允许完全后台行为」 */
  function openAppSettings() {
    var a = alarmApi();
    if (!a || typeof a.appSettings !== 'function') {
      Panel.ui.toast('当前环境不支持（浏览器/桌面版）', 'info');
      return;
    }
    try {
      var res = JSON.parse(a.appSettings() || '{}');
      if (res.ok === false) Panel.ui.toast('打开系统设置失败：' + (res.error || '未知原因'), 'error');
    } catch (e) {}
  }

  /* 🩺 原生诊断：把手机本地记的每一步摊开给用户看（截图即报障） */
  function showDiag() {
    var a = alarmApi();
    var rows = [];
    function row(k, v, cls) { rows.push({ k: k, v: String(v), cls: cls || '' }); }

    if (!a) {
      row('注入状态', isNativeShell() ? '未注入（旧 APK / 桥没起来）' : '非原生环境（浏览器/桌面版）', 'warn');
    } else {
      var st = nativeStat || refreshNativeStat() || {};
      var ver = Number(st.ver || 0);
      row('APK 原生层', 'v' + (st.ver || '?') + (ver >= NATIVE_MIN_VER ? '（最新）' : '（旧版，请装新 APK）'),
        ver >= NATIVE_MIN_VER ? 'ok' : 'warn');
      row('系统', 'SDK ' + (st.sdk || '?'));
      row('通知权限', st.notif === false ? '未开（到点只响不弹）' : '已开', st.notif === false ? 'warn' : 'ok');
      row('精确闹钟', st.exact === false ? '受限（可能晚几分钟）' : '可用', st.exact === false ? 'warn' : 'ok');
      row('电池优化', st.batt === false ? '未关闭（国产 ROM 可能冻结闹钟）' : '已关闭', st.batt === false ? 'warn' : 'ok');
      row('锁屏守护', st.hold ? '运行中（前台服务护着，系统不会冻结本应用）'
        : (st.holdErr ? '未启动：' + st.holdErr : '未启动（开始计时后自动拉起）'),
        st.hold ? 'ok' : (st.holdErr ? 'warn' : ''));
      row('闹钟音量', st.vol === 0 ? '0（听不见！）' : String(st.vol), st.vol === 0 ? 'warn' : '');
      row('当前闹钟', st.pi ? '已挂上（' + Math.max(0, Math.round(((st.armedFor || 0) - Date.now()) / 60000)) + ' 分钟后）' : '未挂',
        st.pi ? 'ok' : '');
      row('挂表方式', st.mode === 'alarmClock' ? '闹钟级 setAlarmClock' : st.mode === 'inexact' ? '非精确（可能晚点）' : st.mode || '—',
        st.mode === 'alarmClock' ? 'ok' : '');
      if (st.lastRingAt) {
        row('上次响铃', new Date(st.lastRingAt).toLocaleString() + ' · ' + (st.lastRing || '?') + ' · 路径 ' + (st.lastPath || '?'),
          /^err/.test(st.lastRing || '') ? 'warn' : 'ok');
      } else {
        row('上次响铃', '从未（本机还没响过）', 'warn');
      }
      if (testAt) row('测试响铃', testFired() ? '已触发 ✓' : (Date.now() - testAt > 15000 ? '未触发 ✗（闹钟被系统拦了）' : '等待中…'),
        testFired() ? 'ok' : Date.now() - testAt > 15000 ? 'warn' : '');
      if (st.lastErr) row('原生报错', st.lastErr, 'warn');
      if (st.injectErr) row('注入错误', st.injectErr, 'warn');
    }

    var ico = C('div', { class: 'pomo-diag-ico' }, '🩺');
    var box = C('div', { class: 'pomo-diag' });
    rows.forEach(function (r) {
      box.appendChild(C('div', { class: 'pomo-diag-row' },
        C('span', { class: 'pomo-diag-k', text: r.k }),
        C('span', { class: 'pomo-diag-v ' + r.cls, text: r.v })));
    });
    if (rows.length === 1) box.appendChild(C('div', { class: 'pomo-diag-tip', text: '开始计时后会自动挂系统闹钟；先点「⏰ 测试锁屏响铃」验证。' }));

    Panel.ui.modal({
      title: '🩺 原生闹钟诊断',
      body: C('div', {}, ico, box,
        C('div', { class: 'pomo-diag-tip', text: '怀疑不响时：先点「⏰ 测试锁屏响铃」然后立刻锁屏，等 15 秒解锁回来看这页——「测试响铃」一行会直接告诉你是闹钟没触发，还是触发了没出声。' }),
        a ? C('div', { class: 'pomo-diag-tip', text: 'OPPO / 一加 / 真我：若黑屏到点仍被拖后，去「设置 → 电池 → 应用耗电管理 → 本应用」把「允许完全后台行为」「允许自启动」都打开（小米对应「无限制」）。' }) : null),
      actions: [
        { label: '🔋 关闭电池优化', class: 'btn-ghost', onClick: function () { requestBattery(); return false; } },
        { label: '📱 本应用设置', class: 'btn-ghost', onClick: function () { openAppSettings(); return false; } },
        { label: '🔄 重新检测', class: 'btn-ghost', onClick: function () { refreshNativeStat(); showDiag(); return false; } },
        { label: '知道了', class: 'btn-primary' }
      ]
    });
  }

  /* 卡片上的系统闹钟状态行（浏览器/桌面不显示）。可以有多行：
     主状态 + 电量优化/音量/测试对账等提醒，全部来自原生自检。 */
  var lastStatusText = '';
  function modeText(m) {
    return m === 'alarmClock' ? '闹钟级'
      : m === 'exact' ? '精确'
      : m === 'inexact' ? '非精确（可能晚几分钟）' : '';
  }

  function paintStatus() {
    if (!statusEl) return;
    var a = alarmApi();
    if (!a && !isNativeShell()) return;   // 浏览器/桌面：这块整块隐藏
    var st = nativeStat, lines = [];

    if (!a) {
      lines.push(['warn', '⚠ 原生闹钟接口未注入：黑屏 / 后台不会响，请安装最新 APK']);
    } else if (st && Number(st.ver || 0) < NATIVE_MIN_VER) {
      lines.push(['warn', '⚠ APK 是旧版（原生 v' + (st.ver || '?') + '，需要 v' + NATIVE_MIN_VER + '）：锁屏可能不响，请重新安装']);
    } else {
      if (st && st.exact === false) {
        lines.push(['warn', '⚠ 系统未允许精确闹钟：到点可能晚几分钟，可在系统设置里允许本应用「闹钟和提醒」']);
      } else if (st && st.notif === false) {
        lines.push(['warn', '⚠ 通知权限未开：锁屏到点会响，但通知栏不显示']);
      } else if (running && notifShown === endAt) {
        lines.push(['ok', '✓ 系统闹钟已挂：锁屏 / 后台到点也会响' + (st && st.mode ? '（' + modeText(st.mode) + '）' : '')]);
        if (st && st.hold) {
          lines.push(['ok', '✓ 锁屏守护中：计时期间挂着前台服务，系统不会冻结本应用']);
        } else if (st) {
          lines.push(['warn', '⚠ 锁屏守护没起来（被省电策略拦下）：黑屏到点可能被拖后，去系统设置的「耗电管理」里允许本应用完全后台行为']);
        }
      } else {
        lines.push(['', '锁屏 / 后台也能响：开始计时后自动挂系统闹钟（设置里有「测试响铃」）']);
      }
      if (st && st.batt === false) {
        lines.push(['warn', '⚠ 未关闭电池优化：国产手机可能冻结后台闹钟（⚙ 设置 →「🔋 关闭电池优化」）']);
      }
      if (st && Number(st.vol) === 0) {
        lines.push(['warn', '⚠ 闹钟音量为 0：到点会响但听不见，请调高「闹钟」音量']);
      }
      if (testAt && st) {
        if (testFired()) {
          lines.push(['ok', '✓ 上次「测试响铃」已触发：原生闹钟这条链路是通的' + (/^err/.test(st.lastRing || '') ? '（但放音出错：' + st.lastRing + '）' : '')]);
        } else if (Date.now() - testAt > 15000) {
          lines.push(['warn', '⚠ 上次「测试响铃」没有触发：闹钟被系统拦了或装的是旧 APK（设置 →「🩺 原生诊断」）']);
        } else {
          lines.push(['', '⏰ 测试闹钟已挂，等它响…（现在锁屏也来得及）']);
        }
      }
    }

    var txt = lines.map(function (l) { return l[0] + '|' + l[1]; }).join('\n');
    if (txt === lastStatusText) return;
    lastStatusText = txt;
    clear(statusEl);
    lines.forEach(function (l) {
      statusEl.appendChild(C('span', { class: 'pomo-native' + (l[0] ? ' ' + l[0] : ''), text: l[1] }));
    });
  }

  /* 计时快照：进程被系统回收后重开，还能继续走 / 对账 */
  var SNAP_KEY = 'panel.pomo.timer';
  function saveSnap() {
    try {
      if (running && endAt) {
        localStorage.setItem(SNAP_KEY, JSON.stringify({
          mode: mode, round: round, endAt: endAt,
          linked: linked ? linked.mod + '/' + linked.id : '',
          armed: notifShown === endAt
        }));
      } else {
        localStorage.removeItem(SNAP_KEY);
      }
    } catch (e) {}
  }

  function restoreSnap() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(SNAP_KEY) || 'null'); } catch (e) {}
    try { localStorage.removeItem(SNAP_KEY); } catch (e) {}
    if (!s || !s.endAt) return;
    var left = Math.round((s.endAt - Date.now()) / 1000);
    if (MODE_CN[s.mode]) mode = s.mode;
    round = Math.max(1, Number(s.round) || 1);
    linked = s.linked ? resolveLinked(s.linked) : null;
    if (left > 0) {                       // 计时还在进行：接着走
      remaining = left;
      start(true);
      Panel.ui.toast('番茄钟仍在计时，已继续', 'info');
      return;
    }
    if (-left > 2 * 3600) { paint(); return; }   // 隔了两小时以上，当没发生过
    endAt = s.endAt;
    notifShown = s.armed ? s.endAt : 0;
    finish();                             // 离开期间到点：安静结算（系统通知已提醒过）
  }

  /* ---------------- 任务关联（待办 + 死线） ---------------- */
  function parseDue(s) {
    if (!s) return Infinity;
    var t = new Date(s).getTime();
    return isNaN(t) ? Infinity : t;
  }

  function dueText(s) {
    if (!s) return '';
    var d = new Date(s);
    if (isNaN(d.getTime())) return String(s);
    var txt = (d.getMonth() + 1) + '月' + d.getDate() + '日';
    if (String(s).indexOf('T') > -1) txt += ' ' + U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
    return txt;
  }

  function relDue(s) {
    var t = parseDue(s);
    if (!isFinite(t)) return '';
    var ms = t - Date.now(), abs = Math.abs(ms);
    var dd = Math.floor(abs / 86400000), hh = Math.floor((abs % 86400000) / 3600000),
      mm = Math.floor((abs % 3600000) / 60000);
    var txt = dd > 0 ? dd + ' 天' + (hh > 0 ? ' ' + hh + ' 小时' : '')
      : hh > 0 ? hh + ' 小时 ' + mm + ' 分' : mm + ' 分钟';
    return (ms < 0 ? '已过 ' : '还剩 ') + txt;
  }

  function collectTasks() {
    var out = [];
    todos.filter(function (t) { return !t.done; }).forEach(function (t) {
      out.push({ mod: 'todos', id: t.id, title: t.title || '未命名待办', due: t.due || '', kind: '待办' });
    });
    dlTasks.filter(function (t) { return !t.done; }).forEach(function (t) {
      out.push({ mod: 'deadline', id: t.id, title: t.title || '未命名任务', due: t.deadline || '', kind: '死线' });
    });
    out.sort(function (a, b) {
      var ad = a.mod === 'deadline' ? 0 : 1, bd = b.mod === 'deadline' ? 0 : 1;
      if (ad !== bd) return ad - bd;                       // 死线排前面
      return parseDue(a.due) - parseDue(b.due);            // 越急越靠前
    });
    return out;
  }

  function resolveLinked(key) {
    if (!key) return null;
    for (var i = 0; i < pickables.length; i++) {
      if (pickables[i].mod + '/' + pickables[i].id === key) {
        var p = pickables[i];
        return { mod: p.mod, id: p.id, title: p.title, due: p.due, kind: p.kind };
      }
    }
    return null;
  }

  /* 关联信息行：性质徽标 + 标题 + 距截止时间 */
  function paintLink() {
    if (!linkEl) return;
    linkEl.textContent = '';
    if (!linked) {
      linkEl.appendChild(C('span', { class: 'pomo-link-hint', text: '可关联待办 / 死线，完成后写进专注记录' }));
      return;
    }
    linkEl.appendChild(C('span', {
      class: 'badge ' + (linked.mod === 'deadline' ? 'badge-danger' : 'badge-brand'),
      text: linked.kind
    }));
    linkEl.appendChild(C('span', { class: 'pomo-link-title', text: linked.title }));
    if (linked.due) {
      var over = parseDue(linked.due) < Date.now();
      linkEl.appendChild(C('span', {
        class: 'pomo-link-due' + (over ? ' is-over' : ''),
        text: (over ? '⚠ ' : '') + relDue(linked.due) + '（' + dueText(linked.due) + '）'
      }));
    }
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    if (!host) return;
    host.textContent = '';
    var page = C('div', { class: 'page' });

    var card = C('div', { class: 'card pomo-card' });
    cardEl = card;
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

    var taskRow = C('div', { class: 'field', style: { maxWidth: '380px', margin: '0 auto' } },
      C('label', { text: '本次任务（可关联待办 / 死线）' }));
    linked = linked ? resolveLinked(linked.mod + '/' + linked.id) : null;   // 任务被删/做完就自动解除
    var sel = C('select', {
      class: 'input',
      onchange: function () { linked = resolveLinked(sel.value); paintLink(); }
    });
    sel.appendChild(C('option', { value: '', text: '不关联任务' }));
    [['deadline', '死线 · 有截止期限'], ['todos', '待办 · 无期限清单']].forEach(function (grp) {
      var list = pickables.filter(function (p) { return p.mod === grp[0]; });
      if (!list.length) return;
      var og = document.createElement('optgroup');
      og.label = grp[1];
      list.forEach(function (p) {
        og.appendChild(C('option', {
          value: p.mod + '/' + p.id,
          text: p.title + (p.due ? '（' + dueText(p.due) + '）' : '')
        }));
      });
      sel.appendChild(og);
    });
    sel.value = linked ? linked.mod + '/' + linked.id : '';
    linkEl = C('div', { class: 'pomo-link' });
    taskRow.appendChild(sel);
    taskRow.appendChild(linkEl);
    card.appendChild(taskRow);
    paintLink();

    ctrlBtn = C('button', { class: 'btn btn-primary pomo-main-btn', type: 'button', onclick: toggle },
      running ? '⏸ 暂停' : '▶ 开始');
    card.appendChild(C('div', { class: 'row', style: { justifyContent: 'center', marginTop: '4px' } },
      C('button', { class: 'btn', type: 'button', onclick: reset }, '↺ 重置'),
      ctrlBtn,
      C('button', { class: 'btn', type: 'button', onclick: function () { nextPhase(true); } }, '⏭ 跳过'),
      C('button', { class: 'btn', type: 'button', onclick: openSettings }, '⚙ 设置')));
    statusEl = C('div', { class: 'pomo-native-wrap' });   // 系统闹钟状态行（paintStatus 填内容）
    lastStatusText = '';                                  // 新节点是空的，清缓存让 paintStatus 重填
    card.appendChild(statusEl);

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
    paintStatus();
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
          C('div', { class: 'pomo-rec-sub', text: recSub(x) })),
        C('span', { class: 'badge badge-brand', text: (x.minutes || 0) + ' 分' })));
    });
  }

  /* 记录副标题：日期 + 本地时间（历史记录存的是 ISO，直接截串会显示成 UTC），
     关联了任务时补上期限，死线用「死线」字样 */
  function recSub(x) {
    var line = x.date || '';
    if (x.at) {
      var d = new Date(x.at);
      if (!isNaN(d.getTime())) line += ' ' + U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
    }
    if (x.due) {
      line += (x.taskRef && x.taskRef.mod === 'deadline' ? ' · 死线 ' : ' · 截止 ') + dueText(x.due);
    }
    return line;
  }

  /* ---------------- 计时逻辑 ---------------- */
  function toggle() {
    if (running) pause();
    else start();
  }

  function stopTimer() {
    if (timer) { timer(); timer = null; }
  }

  function start(noAsk) {
    if (running) return;
    unlockAudio();   // 顺手在用户手势里解锁音频
    running = true;
    endAt = Date.now() + remaining * 1000;
    stopTimer();
    timer = U.ticker(tick, 250);   // 唤醒/回到前台时补跑，锁屏休眠也不停表
    notifShown = armNative(endAt, !noAsk) ? endAt : 0;   // 同时挂系统闹钟：黑屏/后台到点由闹钟声道响
    if (!noAsk) maybeAskBattery();   // 用户手动开始时：没关电池优化就问一次（国产 ROM 关键项）
    saveSnap();
    paint();
  }

  function pause() {
    if (!running) return;
    running = false;
    stopTimer();
    cancelNative();
    remaining = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    saveSnap();
    paint();
  }

  function reset() {
    running = false;
    stopTimer();
    cancelNative();
    remaining = dur(mode);
    saveSnap();
    paint();
  }

  function tick() {
    if (!running) return;
    remaining = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    if (remaining === 1 && notifShown === endAt && !document.hidden) cancelNative();   // 前台最后 1 秒：撤闹钟，改由应用内提示音响
    if (remaining <= 0) {
      running = false;
      stopTimer();
      finish();
    }
    paint();
  }

  function finish() {
    /* 只有到点前 1 秒 JS 还活着（tick 跑过）才会撤闹钟、把 notifShown 清零；
       finish 时闹钟还挂着 = 应用在后台/黑屏，系统通知已经响过 → 只结算，不再二次响铃/震动 */
    var quiet = notifShown === endAt;
    notifShown = 0;
    if (quiet) clearNativeShade();
    else { beep(3); flashAlert(); }
    var tip = quiet ? '（后台完成）' : '';
    if (mode === 'work') {
      var session = {
        id: U.uid(),
        date: U.today(),
        at: new Date().toISOString(),
        minutes: D.settings.work,
        mode: 'work',
        task: linked ? linked.title : '',
        taskRef: linked ? { mod: linked.mod, id: linked.id } : null,
        due: linked ? linked.due || '' : ''
      };
      ctx.api.save(MOD, 'sessions', session).then(function (saved) {
        D.sessions.push(saved);
        refreshStats();
      }).catch(function (e) { Panel.ui.toast(e.message, 'error'); });
      Panel.ui.toast(tip + (linked ? '一个番茄完成：' + linked.title : '一个番茄完成！休息一下吧'), 'success');
    } else {
      Panel.ui.toast(tip + '休息结束，准备开始下一轮', 'success');
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
    stopTimer();
    cancelNative();
    remaining = dur(mode);
    saveSnap();
    paint();
  }

  function switchMode(m) {
    mode = m;
    running = false;
    stopTimer();
    cancelNative();
    remaining = dur(m);
    saveSnap();
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
      actions: [
        {
          label: '⏰ 测试锁屏响铃', class: 'btn-ghost', closeOnClick: false,
          onClick: function () { testRinging(); return false; }   // 不关闭弹窗，方便对着锁屏测
        },
        {
          label: '🔋 关闭电池优化', class: 'btn-ghost', closeOnClick: false,
          onClick: function () { requestBattery(); return false; }
        },
        {
          label: '🩺 原生诊断', class: 'btn-ghost', closeOnClick: false,
          onClick: function () { showDiag(); return false; }
        },
        {
          label: '🔔 试听提示音', class: 'btn-ghost', closeOnClick: false,
          onClick: function () {
            unlockAudio();
            var ok = beep(3, true);   // 试听不受「完成提示音」开关影响
            Panel.ui.toast(ok ? '听到「叮-叮-叮」了吗？没听到请检查系统音量' : '浏览器不允许播放声音，先点一下页面再试',
              ok ? 'info' : 'error');
            return false;   // 不关闭弹窗
          }
        },
        { label: '取消', class: 'btn-ghost' }
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
  function loadData() {
    return Promise.all([
      ctx.api.get(MOD),
      ctx.api.get('todos').catch(function () { return []; }),
      ctx.api.get('deadline').catch(function () { return null; })
    ]);
  }

  function applyData(res) {
    D = res[0] || {};
    if (!D.settings) D.settings = { work: 25, short: 5, long: 15, rounds: 4, sound: true, autoNext: false };
    if (!Array.isArray(D.sessions)) D.sessions = [];
    todos = Array.isArray(res[1]) ? res[1] : [];
    var dl = res[2];
    dlTasks = dl && Array.isArray(dl.tasks) ? dl.tasks : [];
    pickables = collectTasks();
  }

  Panel.registerModule({
    id: MOD,
    mount: function (el, context) {
      ctx = context; host = el;
      titleBase = document.title;
      el.appendChild(ctx.ui.loading('正在加载番茄钟…'));
      if (!visBound) {
        visBound = true;
        var refreshSoon = function () { setTimeout(function () { refreshNativeStat(); }, 400); };
        // 锁屏期间 JS 冻结：回前台补读一次原生记录（测试闹钟到底响没响、到点广播触发没触发）
        document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshSoon(); });
        window.addEventListener('pageshow', refreshSoon);
      }
      return loadData().then(function (res) {
        applyData(res);
        render();
        refreshNativeStat();
        if (testAt) watchTest();   // 上次测试的结果还没对完账（比如中途重启过），继续对
        restoreSnap();
      });
    },
    activate: function () {
      if (!D) return;
      loadData().then(function (res) {
        var keep = { mode: mode, remaining: remaining, running: running, round: round };
        applyData(res);
        render();
        mode = keep.mode; remaining = keep.remaining; round = keep.round;
        if (keep.running && !running) start(); else paint();
        refreshStats();
      }).catch(function () {});
    }
  });
})();
