/* ============================================================
   app.js — สคริปต์กลางของเว็บไซต์สภานักเรียนโรงเรียนร้องกวางอนุสรณ์
   • ชั้นข้อมูล (localStorage + fallback ในหน่วยความจำ)
   • แถบเมนูด้านบน (30px)
   • กราฟแท่ง SVG (ไม่พึ่งไลบรารีภายนอก ใช้งานออฟไลน์ได้)
   • ระบบล็อกอินแอดมิน + ล็อก 1 ชั่วโมงเมื่อผิดเกิน 3 ครั้ง
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------- 0. ค่าคงที่ ---------- */
  var NS = 'sapara2569.';
  var ADMIN_PASSWORD = 'SaPaRa2569';       // <<< รหัสผ่านแอดมิน
  var MAX_ATTEMPTS = 3;                    // ผิดได้ 3 ครั้ง
  var LOCK_MS = 60 * 60 * 1000;            // ล็อก 1 ชั่วโมง
  var SCHOOL = 'โรงเรียนร้องกวางอนุสรณ์';
  var COUNCIL = 'สภานักเรียน ' + SCHOOL;

  /* ---------- 1. ชั้นเก็บข้อมูล ---------- */
  var memory = {};              // สำรองเมื่อเบราว์เซอร์ปิด localStorage
  var storageOK = (function () {
    try { var k = NS + '__t'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; }
    catch (e) { return false; }
  })();

  /* ตัวเชื่อมฐานข้อมูลออนไลน์ (db.js) — ถ้าไม่ได้ตั้งค่าไว้จะเป็น null */
  var DB = global.SPDB || null;
  function online(key) {
    return !!(DB && DB.on() && (key === undefined || DB.handles(key)));
  }

  function read(key, fallback) {
    if (online(key)) return DB.get(key, fallback);
    try {
      var raw = storageOK ? localStorage.getItem(NS + key) : memory[key];
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    if (online(key)) return DB.put(key, value);
    var raw = JSON.stringify(value);
    try {
      if (storageOK) localStorage.setItem(NS + key, raw); else memory[key] = raw;
      return true;
    } catch (e) { memory[key] = raw; return false; }
  }
  function list(key) { var v = read(key, []); return Array.isArray(v) ? v : []; }
  function push(key, rec) { var a = list(key); a.push(rec); write(key, a); return rec; }

  var KEY = {
    VOTE: 'votes', MENTAL: 'mental', PROBLEM: 'problems', BUDGET: 'budget',
    VOTE_EXTRA: 'voteExtra', GATE: 'adminGate',
    STUDENT: 'students', SESSION: 'studentSession',
    ROSTER: 'roster', RATING: 'ratings', SETTINGS: 'settings'
  };

  /* ============================================================
     ช่องทางติดต่อ + เครดิต (แสดงที่ท้ายทุกหน้า) — แก้ที่นี่ที่เดียว
     ============================================================ */
  var CONTACT = {
    place: 'โรงเรียนร้องกวางอนุสรณ์ อำเภอร้องกวาง จังหวัดแพร่',
    room: 'ห้องสภานักเรียน อาคาร 1',
    phone: '0XX-XXX-XXXX',                       // <<< ใส่เบอร์โทรจริง
    email: 'saparaschool2569@gmail.com',         // <<< ใส่อีเมลจริง
    facebook: '',                                // <<< ใส่ลิงก์เพจ เช่น https://www.facebook.com/xxxx
    facebookName: 'สภานักเรียนโรงเรียนร้องกวางอนุสรณ์',
    line: '',                                    // <<< ใส่ Line ID หรือลิงก์ (ถ้ามี)
    hours: 'เปิดรับเรื่องทุกวันทำการ 08.00 - 16.30 น.',
    credits: ['นาย สราวุฒิ  วุฒิเจริญ', 'นาย ธนพัฒน์  หมดกลม', 'คณะกรรมการสภานักเรียน ปีการศึกษา 2568']
  };

  /* ============================================================
     ตั้งค่าการส่ง OTP ทางอีเมล
     ------------------------------------------------------------
     ค่าเริ่มต้น enabled:false = โหมดสาธิต ระบบจะแสดงรหัส OTP บนหน้าจอ
     ใช้งานได้ทันทีโดยไม่ต้องสมัครหรือติดตั้งอะไร

     ถ้าต้องการส่งอีเมลจริง (ไม่ต้องมีเซิร์ฟเวอร์):
       1) สมัครฟรีที่ https://www.emailjs.com
       2) สร้าง Email Service และ Email Template
          ในเทมเพลตให้ใส่ตัวแปร {{to_email}} {{to_name}} {{otp_code}} {{expire_min}}
       3) นำค่ามาใส่ 3 บรรทัดด้านล่าง แล้วเปลี่ยน enabled เป็น true
     ============================================================ */
  var EMAILJS = {
    enabled: false,
    publicKey: '',      // เช่น 'AbCdEf123456'
    serviceId: '',      // เช่น 'service_xxxxxxx'
    templateId: ''      // เช่น 'template_xxxxxxx'
  };

  /* สถานะการดำเนินการของปัญหา (3 ขั้น) */
  var STATUSES = [
    { k: 'wait', name: 'รอดำเนินการ', cls: 'st-wait', ico: '🕒' },
    { k: 'doing', name: 'กำลังดำเนินการ', cls: 'st-doing', ico: '🔧' },
    { k: 'done', name: 'เสร็จสิ้น', cls: 'st-done', ico: '✅' }
  ];
  function statusOf(k) {
    for (var i = 0; i < STATUSES.length; i++) if (STATUSES[i].k === k) return STATUSES[i];
    return STATUSES[0];
  }

  /* ระดับความร้ายแรงของปัญหา (5 ระดับ) */
  var SEVERITIES = [
    { n: 1, name: 'น้อยมาก', cls: 'sv-1', hint: 'ไม่กระทบการเรียน แก้ไขได้ภายหลัง' },
    { n: 2, name: 'น้อย', cls: 'sv-2', hint: 'สร้างความไม่สะดวกเล็กน้อย' },
    { n: 3, name: 'ปานกลาง', cls: 'sv-3', hint: 'กระทบการเรียนหรือการใช้ชีวิตในโรงเรียน' },
    { n: 4, name: 'มาก', cls: 'sv-4', hint: 'กระทบหลายคน ควรแก้ไขโดยเร็ว' },
    { n: 5, name: 'ร้ายแรงมาก', cls: 'sv-5', hint: 'เสี่ยงต่อความปลอดภัย ต้องแก้ไขทันที' }
  ];
  function severityOf(n) {
    n = +n || 3;
    return SEVERITIES[Math.min(5, Math.max(1, n)) - 1];
  }

  var OTP_LEN = 6;
  var OTP_TTL = 5 * 60 * 1000;    // OTP หมดอายุใน 5 นาที
  var OTP_MAX_TRY = 5;            // ใส่ OTP ผิดได้ 5 ครั้ง
  var OTP_RESEND = 60 * 1000;     // ขอรหัสใหม่ได้ทุก 60 วินาที
  var SESSION_TTL = 12 * 60 * 60 * 1000;   // ล็อกอินค้างไว้ 12 ชั่วโมง

  /* โครงสร้างชั้นเรียน — แก้ที่นี่ที่เดียว ใช้ทุกหน้า */
  var GRADES = 6;              // ม.1 ถึง ม.6
  var ROOMS_PER_GRADE = 5;     // ห้อง 1 ถึง 5

  /* ---------- 2. วันเวลา (พ.ศ.) ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function thaiDate(d) {
    d = d || new Date();
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + (d.getFullYear() + 543);
  }
  function thaiTime(d) { d = d || new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' น.'; }
  function stamp() {
    var d = new Date();
    return { iso: d.toISOString(), date: thaiDate(d), time: thaiTime(d) };
  }
  function fmtNum(n) {
    n = Number(n) || 0;
    return n.toLocaleString('th-TH', { maximumFractionDigits: 2 });
  }
  function fmtBaht(n) { return fmtNum(n) + ' ฿'; }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------- 3. แถบเมนูด้านบน ---------- */
  var NAV_STUDENT = [
    { id: 'intex1', href: 'intex1.html', label: 'หน้าหลัก' },
    { id: 'intex2', href: 'intex2.html', label: 'โหวตกิจกรรม' },
    { id: 'intex3', href: 'intex3.html', label: 'ประเมินสภาพจิตใจ' },
    { id: 'intex4', href: 'intex4.html', label: 'แจ้งปัญหา' },
    { id: 'intex9', href: 'intex9.html', label: 'สถานะการแจ้ง' },
    { id: 'intex5', href: 'intex5.html', label: 'แอดมิน' }
  ];
  var NAV_ADMIN = [
    { id: 'intex6', href: 'intex6.html', label: 'หน้าหลัก' },
    { id: 'intex6.1', href: 'intex6.1.html', label: 'งบประมาณ' },
    { id: 'intex6.2', href: 'intex6.2.html', label: 'คลังปัญหา' },
    { id: 'intex6.3', href: 'intex6.3.html', label: 'ผลประเมินจิตใจ' },
    { id: 'intex6.4', href: 'intex6.4.html', label: 'ผลโหวต' },
    { id: 'intex6.6', href: 'intex6.6.html', label: 'รายชื่อนักเรียน' },
    { id: 'intex6.5', href: 'intex6.5.html', label: 'สรุป' }
  ];

  function buildTopbar() {
    var host = document.getElementById('topbar');
    if (!host) return;
    var mode = host.getAttribute('data-nav') || 'student';
    var active = host.getAttribute('data-active') || '';
    var items = mode === 'admin' ? NAV_ADMIN : NAV_STUDENT;
    var home = mode === 'admin' ? 'intex6.html' : 'intex1.html';

    var html = '<div class="topbar-inner">' +
      '<a class="brand" href="' + home + '" title="' + esc(COUNCIL) + '">' +
      '<img class="brand-logo" src="assets/logo-school.jpg" alt="ตราโรงเรียนร้องกวางอนุสรณ์">' +
      '<img class="brand-logo" src="assets/logo-council.jpg" alt="ตราสภานักเรียน">' +
      '</a>' +
      '<nav class="topnav" aria-label="เมนูหลัก">';
    for (var i = 0; i < items.length; i++) {
      html += '<a href="' + items[i].href + '"' +
        (items[i].id === active ? ' class="is-active" aria-current="page"' : '') +
        '>' + esc(items[i].label) + '</a>';
    }
    if (mode === 'admin') {
      html += '<a href="#" class="nav-exit" id="navLogout">ออกจากระบบ</a>';
    } else if (mode === 'student') {
      var me = Student.current();
      if (me) {
        html += '<span class="nav-sep"></span>' +
          '<a href="intex8.html"' + (active === 'intex8' ? ' class="is-active"' : '') + ' title="โปรไฟล์ของฉัน">' +
          (me.photo ? '<img class="nav-ava" data-photo="' + esc(me.photo) + '" alt="">' : '👤 ') +
          esc(shortName(me.name)) + '</a>' +
          '<a href="#" class="nav-exit" id="navStudentOut">ออก</a>';
      } else if (mode === 'student' && active !== 'intex7') {
        html += '<span class="nav-sep"></span><a href="intex7.html" class="nav-in">เข้าสู่ระบบ</a>';
      }
    }
    html += '</nav></div>';
    host.className = 'topbar';
    host.innerHTML = html;

    Img.paintAll(host);

    var out = document.getElementById('navLogout');
    if (out) out.addEventListener('click', function (e) {
      e.preventDefault();
      if (confirm('ต้องการออกจากโหมดแอดมินใช่หรือไม่?')) {
        Admin.logout();
        location.href = online() ? 'intex5.html?out=1' : 'intex1.html';
      }
    });
    var sout = document.getElementById('navStudentOut');
    if (sout) sout.addEventListener('click', function (e) {
      e.preventDefault();
      if (confirm('ต้องการออกจากระบบใช่หรือไม่?')) { Student.logout(); location.href = 'intex7.html'; }
    });
  }
  /* ---------- ฟุตเตอร์กลาง (ช่องทางติดต่อ + เครดิต) ---------- */
  function buildFooter() {
    var host = document.getElementById('siteFooter');
    if (!host) return;
    var year = new Date().getFullYear() + 543;
    var c = CONTACT;
    var items = [];
    if (c.place) items.push('<li><span class="ic">📍</span><span>' + esc(c.place) + (c.room ? ' · ' + esc(c.room) : '') + '</span></li>');
    if (c.phone) items.push('<li><span class="ic">☎️</span><a href="tel:' + esc(String(c.phone).replace(/[^0-9+]/g, '')) + '">' + esc(c.phone) + '</a></li>');
    if (c.email) items.push('<li><span class="ic">✉️</span><a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a></li>');
    if (c.facebook) items.push('<li><span class="ic">📘</span><a href="' + esc(c.facebook) + '" target="_blank" rel="noopener">' + esc(c.facebookName || 'Facebook') + '</a></li>');
    if (c.line) items.push('<li><span class="ic">💬</span><span>LINE: ' + esc(c.line) + '</span></li>');
    if (c.hours) items.push('<li><span class="ic">🕘</span><span>' + esc(c.hours) + '</span></li>');

    host.className = 'site-footer';
    host.innerHTML =
      '<div class="footer-grid">' +
        '<div class="f-brand">' +
          '<img src="assets/logo-council.jpg" alt="">' +
          '<div>' +
            '<strong>สภานักเรียนโรงเรียนร้องกวางอนุสรณ์</strong>' +
            '<span>ปีการศึกษา ' + year + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="f-col">' +
          '<h4>ช่องทางการติดต่อ</h4>' +
          '<ul class="f-contact">' + items.join('') + '</ul>' +
        '</div>' +
        '<div class="f-col f-credit">' +
          '<h4>จัดทำโดย</h4>' +
          c.credits.map(function (x) { return '<p>' + esc(x) + '</p>'; }).join('') +
        '</div>' +
      '</div>' +
      '<div class="footer-bottom">© ' + year + ' สภานักเรียนโรงเรียนร้องกวางอนุสรณ์ · ' +
        'ข้อมูลที่ส่งเข้ามาใช้เพื่อพัฒนาโรงเรียนเท่านั้น</div>';
  }

  function shortName(n) {
    n = String(n || '').trim();
    var parts = n.split(/\s+/);
    var first = parts[0] || '';
    first = first.replace(/^(เด็กชาย|เด็กหญิง|นาย|นางสาว|นาง|ด\.ช\.|ด\.ญ\.|น\.ส\.)/, '');
    return first || n.slice(0, 12);
  }

  /* ============================================================
     3.4 คลังรูปภาพ (IndexedDB)
     ------------------------------------------------------------
     localStorage มีพื้นที่แค่ประมาณ 5 MB และเก็บรูปแบบ base64
     ซึ่งกินพื้นที่มากกว่าไฟล์จริง 33%
     ที่เก็บนี้ใช้ IndexedDB เก็บรูปเป็นไฟล์ (Blob) โดยตรง
     พื้นที่ที่ได้ขึ้นกับเบราว์เซอร์และพื้นที่ว่างในเครื่อง
     โดยทั่วไปหลักร้อย MB ถึงหลาย GB
     ------------------------------------------------------------
     ในข้อมูล เราเก็บเป็น "ref" ซึ่งเป็นได้ 2 แบบ
       • 'img...'  = รหัสรูปใน IndexedDB (แบบใหม่)
       • 'data:...' = รูปฝังในข้อมูลโดยตรง (แบบเก่า ยังอ่านได้ปกติ)
     ============================================================ */
  var Img = (function () {
    var DBNAME = 'sapara2569-images', STORE = 'images', VER = 1;
    var dbPromise = null;
    var urlCache = {};      /* ref -> objectURL (กันสร้างซ้ำ) */

    function supported() { return !!global.indexedDB; }

    function open() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise(function (res, rej) {
        if (!supported()) { rej(new Error('เบราว์เซอร์นี้ไม่รองรับ IndexedDB')); return; }
        var rq;
        try { rq = global.indexedDB.open(DBNAME, VER); }
        catch (e) { rej(e); return; }
        rq.onupgradeneeded = function () {
          var db = rq.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { rej(rq.error || new Error('เปิดคลังรูปไม่สำเร็จ')); };
        rq.onblocked = function () { rej(new Error('คลังรูปถูกใช้งานอยู่ในแท็บอื่น')); };
      });
      return dbPromise;
    }

    function newId() {
      return 'img' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    /* บันทึกรูป (Blob) แล้วคืนรหัสรูป */
    function put(blob) {
      if (DB && DB.on()) return DB.putPhoto(blob);
      var id = newId();
      return open().then(function (db) {
        return new Promise(function (res, rej) {
          var t = db.transaction(STORE, 'readwrite');
          t.objectStore(STORE).put({ id: id, blob: blob, size: blob.size, type: blob.type, created: Date.now() });
          t.oncomplete = function () { res(id); };
          t.onerror = function () { rej(t.error || new Error('บันทึกรูปไม่สำเร็จ')); };
          t.onabort = function () { rej(t.error || new Error('พื้นที่จัดเก็บไม่พอ')); };
        });
      });
    }

    function getRec(id) {
      return open().then(function (db) {
        return new Promise(function (res, rej) {
          var t = db.transaction(STORE, 'readonly');
          var rq = t.objectStore(STORE).get(id);
          rq.onsuccess = function () { res(rq.result || null); };
          rq.onerror = function () { rej(rq.error); };
        });
      });
    }

    function del(id) {
      if (DB && DB.isPhotoRef && DB.isPhotoRef(id)) return DB.delPhoto(id);
      if (urlCache[id]) { try { URL.revokeObjectURL(urlCache[id]); } catch (e) { } delete urlCache[id]; }
      return open().then(function (db) {
        return new Promise(function (res, rej) {
          var t = db.transaction(STORE, 'readwrite');
          t.objectStore(STORE)['delete'](id);
          t.oncomplete = function () { res(true); };
          t.onerror = function () { rej(t.error); };
        });
      })['catch'](function () { return false; });
    }

    /* รายการรหัสรูปทั้งหมด + ขนาดรวม */
    function all() {
      return open().then(function (db) {
        return new Promise(function (res, rej) {
          var t = db.transaction(STORE, 'readonly');
          var out = [];
          var rq = t.objectStore(STORE).openCursor();
          rq.onsuccess = function () {
            var c = rq.result;
            if (!c) { res(out); return; }
            out.push({ id: c.value.id, size: c.value.size || 0, type: c.value.type, created: c.value.created });
            c['continue']();
          };
          rq.onerror = function () { rej(rq.error); };
        });
      })['catch'](function () { return []; });
    }

    /* URL สำหรับใส่ใน <img src> */
    function url(ref) {
      if (!ref) return Promise.resolve('');
      if (String(ref).indexOf('data:') === 0) return Promise.resolve(String(ref));
      if (DB && DB.isPhotoRef && DB.isPhotoRef(ref)) return DB.getPhoto(ref);
      if (urlCache[ref]) return Promise.resolve(urlCache[ref]);
      return getRec(ref).then(function (rec) {
        if (!rec || !rec.blob) return '';
        var u = URL.createObjectURL(rec.blob);
        urlCache[ref] = u;
        return u;
      })['catch'](function () { return ''; });
    }

    /* แปลงกลับเป็น data URL (ใช้ตอนสำรองข้อมูล) */
    function toDataUrl(ref) {
      if (!ref) return Promise.resolve('');
      if (String(ref).indexOf('data:') === 0) return Promise.resolve(String(ref));
      if (DB && DB.isPhotoRef && DB.isPhotoRef(ref)) {
        return DB.getPhoto(ref).then(function (u) {
          if (!u) return '';
          return fetch(u).then(function (r) { return r.blob(); }).then(function (b) {
            return new Promise(function (res) {
              var fr = new FileReader();
              fr.onload = function () { res(String(fr.result)); };
              fr.onerror = function () { res(''); };
              fr.readAsDataURL(b);
            });
          })['catch'](function () { return ''; });
        });
      }
      return getRec(ref).then(function (rec) {
        if (!rec || !rec.blob) return '';
        return new Promise(function (res) {
          var fr = new FileReader();
          fr.onload = function () { res(String(fr.result)); };
          fr.onerror = function () { res(''); };
          fr.readAsDataURL(rec.blob);
        });
      })['catch'](function () { return ''; });
    }

    /* บันทึกจาก data URL (ใช้ตอนกู้คืนข้อมูล) */
    function putDataUrl(d) {
      return fetch(d).then(function (r) { return r.blob(); }).then(put);
    }

    /* ใส่รูปลงใน element <img> ให้เลย */
    function paint(el, ref) {
      if (!el) return Promise.resolve('');
      return url(ref).then(function (u) {
        if (u) { el.src = u; el.removeAttribute('data-missing'); }
        else { el.removeAttribute('src'); el.setAttribute('data-missing', '1'); el.alt = 'ไม่พบรูป'; }
        return u;
      });
    }
    /* ใส่รูปให้ทุก element ที่มี data-photo ในบล็อกที่กำหนด */
    function paintAll(root) {
      var els = (root || document).querySelectorAll('img[data-photo]');
      return Promise.all(Array.prototype.map.call(els, function (el) {
        var ref = el.getAttribute('data-photo');
        el.removeAttribute('data-photo');
        return paint(el, ref);
      }));
    }

    function releaseAll() {
      for (var k in urlCache) if (urlCache.hasOwnProperty(k)) {
        try { URL.revokeObjectURL(urlCache[k]); } catch (e) { }
      }
      urlCache = {};
    }
    global.addEventListener('pagehide', releaseAll);

    return {
      supported: supported, put: put, get: getRec, del: del, all: all,
      url: url, toDataUrl: toDataUrl, putDataUrl: putDataUrl,
      paint: paint, paintAll: paintAll, release: releaseAll
    };
  })();

  /* ---------- 3.5 รูปภาพ: ย่อขนาด + แปลงเป็น data URL ---------- */
  var MAX_UPLOAD = 20 * 1024 * 1024;   // ไฟล์ต้นทางไม่เกิน 20 MB
  function readImageFile(file, maxSide, quality) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('ไม่พบไฟล์'));
      if (!/^image\//.test(file.type)) return reject(new Error('กรุณาเลือกไฟล์รูปภาพ (jpg, png, webp)'));
      if (file.size > MAX_UPLOAD) return reject(new Error('ไฟล์ใหญ่เกิน 20 MB กรุณาย่อรูปก่อน'));
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('อ่านไฟล์ไม่สำเร็จ')); };
      fr.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('ไฟล์รูปเสียหายหรือเปิดไม่ได้')); };
        img.onload = function () {
          try {
            var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
            var sc = Math.min(1, (maxSide || 1000) / Math.max(w, h));
            var cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(h * sc));
            var c = document.createElement('canvas');
            c.width = cw; c.height = ch;
            var ctx = c.getContext('2d');
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch);
            ctx.drawImage(img, 0, 0, cw, ch);
            resolve(c.toDataURL('image/jpeg', quality || 0.72));
          } catch (e) { reject(new Error('ย่อรูปไม่สำเร็จ: ' + e.message)); }
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  /* ย่อรูปแล้วคืนเป็นไฟล์ (Blob) + URL สำหรับพรีวิว — ประหยัดกว่า data URL 33% */
  function prepareImage(file, maxSide, quality) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('ไม่พบไฟล์'));
      if (!/^image\//.test(file.type)) return reject(new Error('กรุณาเลือกไฟล์รูปภาพ (jpg, png, webp)'));
      if (file.size > MAX_UPLOAD) return reject(new Error('ไฟล์ใหญ่เกิน 20 MB กรุณาย่อรูปก่อน'));
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('อ่านไฟล์ไม่สำเร็จ')); };
      fr.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('ไฟล์รูปเสียหายหรือเปิดไม่ได้')); };
        img.onload = function () {
          try {
            var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
            var sc = Math.min(1, (maxSide || 1400) / Math.max(w, h));
            var cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(h * sc));
            var c = document.createElement('canvas');
            c.width = cw; c.height = ch;
            var ctx = c.getContext('2d');
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch);
            ctx.drawImage(img, 0, 0, cw, ch);
            var done = function (blob) {
              if (!blob) return reject(new Error('ย่อรูปไม่สำเร็จ'));
              resolve({ blob: blob, url: URL.createObjectURL(blob), w: cw, h: ch, size: blob.size });
            };
            if (c.toBlob) c.toBlob(done, 'image/jpeg', quality || 0.75);
            else {
              /* เบราว์เซอร์เก่าที่ไม่มี toBlob */
              var d = c.toDataURL('image/jpeg', quality || 0.75);
              fetch(d).then(function (r) { return r.blob(); }).then(done)['catch'](function () {
                reject(new Error('ย่อรูปไม่สำเร็จ'));
              });
            }
          } catch (e) { reject(new Error('ย่อรูปไม่สำเร็จ: ' + e.message)); }
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  /* ขนาดโดยประมาณของ data URL (ไบต์) */
  function dataUrlSize(d) { return d ? Math.round((String(d).length - 22) * 0.75) : 0; }
  function fmtBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
  }
  /* พื้นที่ที่ใช้ไปทั้งหมดใน localStorage ของเว็บนี้ */
  function storageUsed() {
    var total = 0;
    try {
      for (var k in localStorage) if (k.indexOf(NS) === 0 && localStorage.hasOwnProperty(k)) {
        total += (localStorage.getItem(k) || '').length;
      }
    } catch (e) { }
    return total;
  }

  /* ข้อมูลพื้นที่จัดเก็บที่แท้จริงจากเบราว์เซอร์
     คืน { ls, images, imageCount, usage, quota, persisted } */
  function storageInfo() {
    var ls = storageUsed();
    return Img.all().then(function (list) {
      var imgBytes = list.reduce(function (a, x) { return a + (x.size || 0); }, 0);
      var base = { ls: ls, images: imgBytes, imageCount: list.length, usage: ls + imgBytes, quota: 0, persisted: false };
      var jobs = [];
      if (global.navigator && navigator.storage && navigator.storage.estimate) {
        jobs.push(navigator.storage.estimate().then(function (e) {
          base.quota = e.quota || 0;
          if (e.usage) base.usage = e.usage;
        })['catch'](function () { }));
      }
      if (global.navigator && navigator.storage && navigator.storage.persisted) {
        jobs.push(navigator.storage.persisted().then(function (v) { base.persisted = !!v; })['catch'](function () { }));
      }
      return Promise.all(jobs).then(function () { return base; });
    });
  }

  /* ขอให้เบราว์เซอร์เก็บข้อมูลแบบถาวร (ลดโอกาสถูกลบอัตโนมัติเมื่อพื้นที่เครื่องใกล้เต็ม) */
  function requestPersist() {
    if (!(global.navigator && navigator.storage && navigator.storage.persist)) {
      return Promise.resolve(false);
    }
    return navigator.storage.persist()['catch'](function () { return false; });
  }

  /* รวบรวม ref รูปทั้งหมดที่ถูกใช้งานอยู่ (ไว้หารูปกำพร้า) */
  function usedPhotoRefs() {
    var set = {};
    list(KEY.PROBLEM).forEach(function (r) {
      (r.photos || []).forEach(function (x) { if (x) set[x] = true; });
    });
    list(KEY.STUDENT).forEach(function (s0) { if (s0.photo) set[s0.photo] = true; });
    return set;
  }

  /* ---------- 4. Toast ---------- */
  function toast(msg) {
    var el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  /* ---------- 5. ระบบแอดมิน ---------- */
  var Admin = {
    password: ADMIN_PASSWORD,
    gate: function () {
      var g = read(KEY.GATE, { fails: 0, lockUntil: 0 });
      if (typeof g !== 'object' || g === null) g = { fails: 0, lockUntil: 0 };
      return g;
    },
    lockLeft: function () {
      var g = this.gate();
      var left = (g.lockUntil || 0) - Date.now();
      return left > 0 ? left : 0;
    },
    attemptsLeft: function () { return Math.max(0, MAX_ATTEMPTS - (this.gate().fails || 0)); },
    tryLogin: function (pw) {
      if (this.lockLeft() > 0) return { ok: false, locked: true, left: this.lockLeft() };
      if (pw === ADMIN_PASSWORD) {
        write(KEY.GATE, { fails: 0, lockUntil: 0 });
        try { sessionStorage.setItem(NS + 'session', String(Date.now())); } catch (e) { memory.session = '1'; }
        return { ok: true };
      }
      var g = this.gate();
      g.fails = (g.fails || 0) + 1;
      if (g.fails >= MAX_ATTEMPTS) { g.lockUntil = Date.now() + LOCK_MS; g.fails = MAX_ATTEMPTS; }
      write(KEY.GATE, g);
      return { ok: false, locked: g.fails >= MAX_ATTEMPTS, left: this.lockLeft(), remain: MAX_ATTEMPTS - g.fails };
    },
    isIn: function () {
      if (DB && DB.on()) return DB.isAdmin();
      try { return !!sessionStorage.getItem(NS + 'session'); } catch (e) { return !!memory.session; }
    },
    logout: function () {
      if (DB && DB.enabled) { try { DB.signOut(); } catch (e) { } }
      try { sessionStorage.removeItem(NS + 'session'); } catch (e) { }
      delete memory.session;
    },
    guard: function () {
      if (!this.isIn()) { location.replace('intex5.html?need=1'); return false; }
      return true;
    },
    fmtLeft: function (ms) {
      var m = Math.ceil(ms / 60000);
      if (m >= 60) return Math.floor(m / 60) + ' ชั่วโมง ' + (m % 60) + ' นาที';
      return m + ' นาที';
    }
  };

  /* ---------- 5.5 ระบบนักเรียน (ลงทะเบียน + เข้าสู่ระบบ + OTP) ---------- */
  function normEmail(e) { return String(e || '').trim().toLowerCase(); }
  function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normEmail(e)); }
  function randomCode(len) {
    var digits = '0123456789', out = '';
    try {
      var buf = new Uint32Array(len);
      (global.crypto || global.msCrypto).getRandomValues(buf);
      for (var i = 0; i < len; i++) out += digits[buf[i] % 10];
    } catch (e) {
      for (var j = 0; j < len; j++) out += digits[Math.floor(Math.random() * 10)];
    }
    return out;
  }

  var Student = {
    all: function () { return list(KEY.STUDENT); },
    bySid: function (sid) {
      var a = this.all(), k = String(sid || '').trim();
      for (var i = 0; i < a.length; i++) if (String(a[i].sid) === k) return a[i];
      return null;
    },
    byEmail: function (email) {
      var a = this.all(), k = normEmail(email);
      for (var i = 0; i < a.length; i++) if (normEmail(a[i].email) === k) return a[i];
      return null;
    },
    save: function (rec) {
      var a = this.all(), found = false;
      for (var i = 0; i < a.length; i++) if (String(a[i].sid) === String(rec.sid)) { a[i] = rec; found = true; break; }
      if (!found) a.push(rec);
      write(KEY.STUDENT, a);
      return rec;
    },
    remove: function (sid) {
      write(KEY.STUDENT, this.all().filter(function (x) { return String(x.sid) !== String(sid); }));
    },

    /* --- เซสชัน --- */
    login: function (sid) {
      if (online()) return this.current();
      write(KEY.SESSION, { sid: String(sid), exp: Date.now() + SESSION_TTL });
      return this.current();
    },
    logout: function () {
      if (DB && DB.enabled) { try { DB.signOut(); } catch (e) { } }
      write(KEY.SESSION, null);
    },
    current: function () {
      if (online()) {
        var sid = DB.mySid();
        if (!sid) return null;
        return this.bySid(sid);
      }
      var s0 = read(KEY.SESSION, null);
      if (!s0 || !s0.sid) return null;
      if (s0.exp && s0.exp < Date.now()) { this.logout(); return null; }
      var rec = this.bySid(s0.sid);
      if (!rec) { this.logout(); return null; }
      return rec;
    },
    isIn: function () { return !!this.current(); },
    /* เรียกที่ต้นสคริปต์ของหน้าที่ต้องล็อกอินก่อน */
    guard: function () {
      if (this.isIn()) return true;
      var here = location.pathname.split('/').pop() || 'intex1.html';
      location.replace('intex7.html?need=1&next=' + encodeURIComponent(here));
      return false;
    },
    touch: function () {   /* ต่ออายุเซสชันเมื่อมีการใช้งาน (เฉพาะโหมดเครื่องเดียว) */
      if (online()) return;
      var s0 = read(KEY.SESSION, null);
      if (s0 && s0.sid) write(KEY.SESSION, { sid: s0.sid, exp: Date.now() + SESSION_TTL });
    }
  };

  /* --- คลังรายชื่อนักเรียนทั้งโรงเรียน --- */
  function normSid(v) { return String(v == null ? '' : v).trim(); }
  function normName(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }

  var Roster = {
    all: function () { return list(KEY.ROSTER); },
    save: function (a) { return write(KEY.ROSTER, a); },
    bySid: function (sid) {
      var a = this.all(), k = normSid(sid);
      for (var i = 0; i < a.length; i++) if (normSid(a[i].sid) === k) return a[i];
      return null;
    },
    add: function (rec) {
      var a = this.all(), k = normSid(rec.sid), found = false;
      for (var i = 0; i < a.length; i++) if (normSid(a[i].sid) === k) {
        a[i] = { sid: k, name: normName(rec.name), room: rec.room, no: String(rec.no) };
        found = true; break;
      }
      if (!found) a.push({ sid: k, name: normName(rec.name), room: rec.room, no: String(rec.no) });
      this.save(a);
      return !found;   // true = เพิ่มใหม่, false = ทับของเดิม
    },
    remove: function (sid) {
      this.save(this.all().filter(function (x) { return normSid(x.sid) !== normSid(sid); }));
    },
    /* เปิด/ปิดการบังคับตรวจสอบกับคลังรายชื่อ */
    strict: function () {
      var st = read(KEY.SETTINGS, null) || {};
      if (typeof st.strictRoster === 'boolean') return st.strictRoster;
      return true;   // ค่าเริ่มต้น: ตรวจสอบ (จะมีผลก็ต่อเมื่อคลังรายชื่อไม่ว่าง)
    },
    setStrict: function (on) {
      var st = read(KEY.SETTINGS, null) || {};
      st.strictRoster = !!on;
      write(KEY.SETTINGS, st);
    },
    /* ตรวจสอบข้อมูลที่กรอกกับคลังรายชื่อ
       คืน {ok:true} หรือ {ok:false, reason, field, expect} */
    check: function (d) {
      var all = this.all();
      if (!all.length || !this.strict()) return { ok: true, skipped: true };
      var rec = this.bySid(d.sid);
      if (!rec) return { ok: false, reason: 'notfound', field: 'sid' };
      if (normName(rec.name) !== normName(d.name)) return { ok: false, reason: 'name', field: 'name', expect: rec.name };
      if (String(rec.room).trim() !== String(d.room).trim()) return { ok: false, reason: 'room', field: 'room', expect: rec.room };
      if (String(rec.no).trim() !== String(d.no).trim()) return { ok: false, reason: 'no', field: 'no', expect: rec.no };
      return { ok: true, rec: rec };
    },
    /* ข้อความอธิบายผลตรวจสอบ */
    message: function (r) {
      if (r.ok) return '';
      if (r.reason === 'notfound') return 'ไม่พบรหัสนักเรียนนี้ในคลังรายชื่อของโรงเรียน กรุณาตรวจสอบรหัสอีกครั้ง หรือแจ้งคณะกรรมการสภานักเรียนให้เพิ่มรายชื่อ';
      if (r.reason === 'name') return 'ชื่อ - นามสกุล ไม่ตรงกับคลังรายชื่อของโรงเรียน';
      if (r.reason === 'room') return 'ชั้นเรียนไม่ตรงกับคลังรายชื่อของโรงเรียน';
      if (r.reason === 'no') return 'เลขที่ไม่ตรงกับคลังรายชื่อของโรงเรียน';
      return 'ข้อมูลไม่ตรงกับคลังรายชื่อของโรงเรียน';
    }
  };

  /* --- คะแนนความพึงพอใจเว็บไซต์ --- */
  var Rating = {
    all: function () { return list(KEY.RATING); },
    mine: function (sid) {
      var a = this.all();
      for (var i = 0; i < a.length; i++) if (normSid(a[i].sid) === normSid(sid)) return a[i];
      return null;
    },
    put: function (rec) {
      var a = this.all().filter(function (x) { return normSid(x.sid) !== normSid(rec.sid); });
      a.push(rec);
      return write(KEY.RATING, a);
    },
    remove: function (sid) {
      write(KEY.RATING, this.all().filter(function (x) { return normSid(x.sid) !== normSid(sid); }));
    },
    stats: function () {
      var a = this.all();
      var counts = [0, 0, 0, 0, 0], sum = 0;
      a.forEach(function (r) {
        var v = Math.min(5, Math.max(1, +r.stars || 0));
        if (v) { counts[v - 1]++; sum += v; }
      });
      return { n: a.length, avg: a.length ? sum / a.length : 0, counts: counts };
    }
  };

  /* --- OTP --- */
  var Otp = {
    KEYNAME: 'otp',
    get: function () {
      try {
        var raw = sessionStorage.getItem(NS + this.KEYNAME);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return memory.otp ? JSON.parse(memory.otp) : null; }
    },
    set: function (v) {
      var raw = JSON.stringify(v);
      try { sessionStorage.setItem(NS + this.KEYNAME, raw); } catch (e) { memory.otp = raw; }
    },
    clear: function () {
      try { sessionStorage.removeItem(NS + this.KEYNAME); } catch (e) { }
      delete memory.otp;
    },
    /* สร้าง OTP ใหม่ — purpose: 'register' | 'login' | 'email' */
    issue: function (purpose, payload) {
      var rec = {
        code: randomCode(OTP_LEN), purpose: purpose, payload: payload || {},
        email: normEmail((payload || {}).email), name: (payload || {}).name || '',
        exp: Date.now() + OTP_TTL, tries: 0, sentAt: Date.now(), delivered: false
      };
      this.set(rec);
      return rec;
    },
    canResend: function () {
      var r = this.get();
      if (!r) return 0;
      var left = (r.sentAt + OTP_RESEND) - Date.now();
      return left > 0 ? left : 0;
    },
    resend: function () {
      var r = this.get();
      if (!r) return null;
      r.code = randomCode(OTP_LEN);
      r.exp = Date.now() + OTP_TTL;
      r.tries = 0; r.sentAt = Date.now(); r.delivered = false;
      this.set(r);
      return r;
    },
    /* ตรวจรหัส — คืน {ok} หรือ {ok:false, reason:'none'|'expired'|'locked'|'wrong', left} */
    verify: function (code) {
      var r = this.get();
      if (!r) return { ok: false, reason: 'none' };
      if (Date.now() > r.exp) { return { ok: false, reason: 'expired' }; }
      if (r.tries >= OTP_MAX_TRY) return { ok: false, reason: 'locked' };
      if (String(code).trim() !== r.code) {
        r.tries++; this.set(r);
        return { ok: false, reason: r.tries >= OTP_MAX_TRY ? 'locked' : 'wrong', left: OTP_MAX_TRY - r.tries };
      }
      return { ok: true, rec: r };
    },
    ttlLeft: function () {
      var r = this.get();
      return r ? Math.max(0, r.exp - Date.now()) : 0;
    }
  };

  /* ส่ง OTP ทางอีเมล — คืน Promise<{sent:boolean, reason?:string}> */
  function sendOtpEmail(rec) {
    if (!EMAILJS.enabled) return Promise.resolve({ sent: false, reason: 'demo' });
    if (!global.emailjs) return Promise.resolve({ sent: false, reason: 'no-lib' });
    try {
      if (!sendOtpEmail._init) { global.emailjs.init({ publicKey: EMAILJS.publicKey }); sendOtpEmail._init = true; }
      return global.emailjs.send(EMAILJS.serviceId, EMAILJS.templateId, {
        to_email: rec.email, to_name: rec.name || 'นักเรียน',
        otp_code: rec.code, expire_min: Math.round(OTP_TTL / 60000),
        school: SCHOOL
      }).then(function () {
        var r = Otp.get(); if (r) { r.delivered = true; Otp.set(r); }
        return { sent: true };
      })['catch'](function (err) {
        return { sent: false, reason: (err && (err.text || err.message)) || 'error' };
      });
    } catch (e) { return Promise.resolve({ sent: false, reason: e.message }); }
  }

  /* ---------- 6. กราฟแท่ง SVG ---------- */
  var PALETTE = ['#2a78d6', '#eb6834', '#1baf7a'];   // ตรวจ CVD/contrast ผ่านแล้ว
  var SOLO = '#5b21b6';
  var GRID = '#e6e3f0', AXIS = '#c9c4dc', INK = '#12101a', MUTED = '#7a7889';
  var SVGNS = 'http://www.w3.org/2000/svg';

  function el(name, attrs, text) {
    var n = document.createElementNS(SVGNS, name);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
  function niceStep(range, ticks) {
    var raw = range / ticks;
    if (!isFinite(raw) || raw <= 0) return 1;
    var exp = Math.floor(Math.log(raw) / Math.LN10);
    var base = Math.pow(10, exp);
    var f = raw / base;
    var m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return m * base;
  }
  /* หาช่วงแกน Y ที่ลงตัวสวยงาม รองรับค่าติดลบ และมีเส้น 0 เสมอ */
  function niceScale(minV, maxV) {
    var lo = Math.min(0, minV), hi = Math.max(0, maxV);
    if (hi === lo) hi = lo + 1;
    var step = niceStep(hi - lo, 5);
    var min = Math.floor(lo / step) * step, max = Math.ceil(hi / step) * step;
    var n = Math.round((max - min) / step);
    var guard = 0;
    while (n > 8 && guard++ < 20) {
      step *= 2;
      min = Math.floor(lo / step) * step; max = Math.ceil(hi / step) * step;
      n = Math.round((max - min) / step);
    }
    var dec = Math.max(0, -Math.floor(Math.log(step) / Math.LN10));
    var rnd = function (v) { return Number(v.toFixed(Math.min(10, dec + 2))); };
    return { min: rnd(min), max: rnd(max), step: step, ticks: Math.max(1, n), rnd: rnd };
  }
  function topRoundPath(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h));
    return 'M' + x + ' ' + (y + h) + ' V' + (y + r) +
      ' A' + r + ' ' + r + ' 0 0 1 ' + (x + r) + ' ' + y +
      ' H' + (x + w - r) + ' A' + r + ' ' + r + ' 0 0 1 ' + (x + w) + ' ' + (y + r) +
      ' V' + (y + h) + ' Z';
  }
  /* แท่งค่าติดลบ — มนที่ปลายล่าง (ด้านที่ห่างจากเส้นศูนย์) */
  function bottomRoundPath(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h));
    return 'M' + x + ' ' + y + ' V' + (y + h - r) +
      ' A' + r + ' ' + r + ' 0 0 0 ' + (x + r) + ' ' + (y + h) +
      ' H' + (x + w - r) + ' A' + r + ' ' + r + ' 0 0 0 ' + (x + w) + ' ' + (y + h - r) +
      ' V' + y + ' Z';
  }
  function textW(s, size) {   // ประมาณความกว้างข้อความไทย
    return String(s).length * size * 0.56;
  }
  function clip(s, max) {
    s = String(s);
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  /**
   * สร้างกราฟแท่ง
   * host: element ที่จะใส่กราฟ (จะถูกเคลียร์)
   * o: { title, subtitle, categories:[], series:[{name,color,values:[]}],
   *      fmt: fn(v)->string, height, emptyText }
   */
  function barChart(host, o) {
    if (!host) return;
    o = o || {};
    var cats = o.categories || [];
    var series = (o.series || []).filter(function (s) { return s && s.values; });
    var fmt = o.fmt || fmtNum;
    host.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'chart-head';
    head.innerHTML = '<p class="chart-title">' + esc(o.title || '') + '</p>' +
      (o.subtitle ? '<p class="chart-sub">' + esc(o.subtitle) + '</p>' : '');
    host.appendChild(head);

    if (!cats.length || !series.length) {
      var em = document.createElement('div');
      em.className = 'empty-state';
      em.innerHTML = '<span class="big">📊</span>' + esc(o.emptyText || 'ยังไม่มีข้อมูลสำหรับสร้างกราฟ');
      host.appendChild(em);
      return;
    }

    series.forEach(function (s, i) { if (!s.color) s.color = series.length > 1 ? PALETTE[i % PALETTE.length] : SOLO; });

    if (series.length > 1) {
      var lg = document.createElement('div');
      lg.className = 'chart-legend';
      lg.innerHTML = series.map(function (s) {
        return '<span class="lg"><span class="sw" style="background:' + s.color + '"></span>' + esc(s.name) + '</span>';
      }).join('');
      host.appendChild(lg);
    }

    var holder = document.createElement('div');
    holder.className = 'chart-holder';
    var tip = document.createElement('div');
    tip.className = 'chart-tip';
    holder.appendChild(tip);
    host.appendChild(holder);

    function draw() {
      var W = Math.max(320, holder.clientWidth || host.clientWidth || 640);
      var H = o.height || (W < 520 ? 300 : 360);
      var maxV = 0, minV = 0;
      series.forEach(function (s) {
        s.values.forEach(function (v) { v = +v || 0; if (v > maxV) maxV = v; if (v < minV) minV = v; });
      });
      var sc = niceScale(minV, maxV);              /* รองรับค่าติดลบ เช่น งบเกิน */
      var yMin = sc.min, yMax = sc.max;
      var span = yMax - yMin || 1;
      var TICKS = sc.ticks;

      var mL = Math.max(46, textW(fmt(yMax), 11) + 16, textW(fmt(yMin), 11) + 16), mR = 14, mT = 14;
      var band0 = (W - mL - mR) / cats.length;
      var labelSize = W < 520 ? 10 : 11;
      var longest = 0;
      cats.forEach(function (c) { longest = Math.max(longest, textW(clip(c, 20), labelSize)); });
      var rotate = longest > band0 - 8;
      var mB = rotate ? Math.min(96, 30 + longest * 0.72) : 44;

      var plotW = W - mL - mR, plotH = H - mT - mB;
      var band = plotW / cats.length;
      var groupPad = Math.min(band * 0.22, 22);
      var inner = band - groupPad;
      var gap = series.length > 1 ? 2 : 0;
      var barW = Math.max(3, (inner - gap * (series.length - 1)) / series.length);
      barW = Math.min(barW, 84);                       /* กันแท่งอ้วนเกินไปเมื่อมีข้อมูลน้อย */
      var groupW = barW * series.length + gap * (series.length - 1);

      var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': o.title || 'กราฟแท่ง' });

      var zeroY = mT + plotH * (yMax / span);   /* ตำแหน่งเส้นศูนย์ */

      /* แกน Y + เส้นกริด */
      for (var t = 0; t <= TICKS; t++) {
        var val = sc.rnd(yMin + sc.step * t);
        var y = mT + plotH - (plotH * t / TICKS);
        var isZero = Math.abs(val) < span / 10000;
        svg.appendChild(el('line', {
          x1: mL, y1: y, x2: W - mR, y2: y,
          stroke: (t === 0 || isZero) ? AXIS : GRID, 'stroke-width': (t === 0 || isZero) ? 1.4 : 1
        }));
        svg.appendChild(el('text', { x: mL - 9, y: y + 3.8, 'text-anchor': 'end', fill: MUTED, 'font-size': 11, 'font-family': 'inherit' }, fmt(val)));
      }
      if (yMin < 0) {
        svg.appendChild(el('line', { x1: mL, y1: zeroY, x2: W - mR, y2: zeroY, stroke: AXIS, 'stroke-width': 1.4 }));
      }

      /* แท่ง */
      cats.forEach(function (cat, ci) {
        var bx = mL + band * ci + (band - groupW) / 2;   /* จัดกลุ่มแท่งให้อยู่กลางช่อง */
        series.forEach(function (s, si) {
          var v = Number(s.values[ci]) || 0;
          var h = Math.abs(v) / span * plotH;
          var x = bx + si * (barW + gap);
          var neg = v < 0;
          var y = neg ? zeroY : zeroY - h;
          if (h > 0.4) {
            var p = el('path', {
              d: neg ? bottomRoundPath(x, y, barW, h, 4) : topRoundPath(x, y, barW, h, 4),
              fill: s.color, class: 'bar-rect', 'data-ci': ci
            });
            p.appendChild(el('title', {}, cat + ' — ' + s.name + ': ' + fmt(v)));
            svg.appendChild(p);
          }
          /* ป้ายค่าบนแท่ง (เมื่อพื้นที่พอ) */
          if (barW >= 26 && v !== 0) {
            svg.appendChild(el('text', {
              x: x + barW / 2, y: neg ? y + h + 13 : y - 6, 'text-anchor': 'middle',
              fill: neg ? '#8c1f1f' : INK,
              'font-size': Math.min(11, barW * 0.42), 'font-weight': 700, 'font-family': 'inherit'
            }, fmt(v)));
          }
        });

        /* ป้ายแกน X */
        var cx = mL + band * ci + band / 2;
        var label = clip(cat, 20);
        var tEl;
        if (rotate) {
          tEl = el('text', {
            x: cx, y: mT + plotH + 13, fill: MUTED, 'font-size': labelSize,
            'text-anchor': 'end', 'font-family': 'inherit',
            transform: 'rotate(-38 ' + cx + ' ' + (mT + plotH + 13) + ')'
          }, label);
        } else {
          tEl = el('text', {
            x: cx, y: mT + plotH + 17, fill: MUTED, 'font-size': labelSize,
            'text-anchor': 'middle', 'font-family': 'inherit'
          }, label);
        }
        tEl.appendChild(el('title', {}, cat));
        svg.appendChild(tEl);
      });

      /* พื้นที่ hover */
      cats.forEach(function (cat, ci) {
        var hit = el('rect', {
          x: mL + band * ci, y: mT, width: band, height: plotH,
          fill: 'transparent', style: 'cursor:pointer'
        });
        hit.addEventListener('mouseenter', function () {
          holder.classList.add('dim');
          holder.querySelectorAll('.bar-rect').forEach(function (b) {
            b.classList.toggle('hot', b.getAttribute('data-ci') === String(ci));
          });
          tip.innerHTML = '<span class="t-cat">' + esc(cat) + '</span>' + series.map(function (s) {
            return '<span class="t-row"><span class="sw" style="background:' + s.color + '"></span>' +
              esc(s.name) + '<b>' + esc(fmt(Number(s.values[ci]) || 0)) + '</b></span>';
          }).join('');
          tip.classList.add('show');
          var scale = (holder.clientWidth || W) / W;
          tip.style.left = ((mL + band * ci + band / 2) * scale) + 'px';
          tip.style.top = Math.max(58, (mT + plotH * 0.35) * scale) + 'px';
        });
        hit.addEventListener('mouseleave', function () {
          holder.classList.remove('dim');
          tip.classList.remove('show');
          holder.querySelectorAll('.bar-rect').forEach(function (b) { b.classList.remove('hot'); });
        });
        svg.appendChild(hit);
      });

      holder.querySelectorAll('svg').forEach(function (n) { n.remove(); });
      holder.appendChild(svg);
    }

    draw();
    var raf;
    var ro = global.ResizeObserver ? new ResizeObserver(function () {
      cancelAnimationFrame(raf); raf = requestAnimationFrame(draw);
    }) : null;
    if (ro) ro.observe(holder); else global.addEventListener('resize', function () { clearTimeout(raf); raf = setTimeout(draw, 150); });
  }

  /* ---------- 7. ตัวช่วยตาราง ---------- */
  function countBy(arr, fn) {
    var m = {};
    arr.forEach(function (x) { var k = fn(x); if (k == null || k === '') return; m[k] = (m[k] || 0) + 1; });
    return m;
  }
  function sortedEntries(obj, desc) {
    return Object.keys(obj).map(function (k) { return [k, obj[k]]; })
      .sort(function (a, b) { return desc === false ? a[1] - b[1] : b[1] - a[1]; });
  }
  function exportCSV(filename, headers, rows) {
    var q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    var csv = '﻿' + [headers.map(q).join(',')].concat(rows.map(function (r) { return r.map(q).join(','); })).join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------- 8. คะแนนสภาพจิตใจ ---------- */
  var LEVELS = [
    { n: 1, min: 10, max: 17, name: 'ดีมาก', cls: 'level-1', short: 'ระดับ 1 · ดีมาก' },
    { n: 2, min: 18, max: 25, name: 'ดี', cls: 'level-2', short: 'ระดับ 2 · ดี' },
    { n: 3, min: 26, max: 33, name: 'ปานกลาง', cls: 'level-3', short: 'ระดับ 3 · ปานกลาง' },
    { n: 4, min: 34, max: 41, name: 'ควรเฝ้าระวัง', cls: 'level-4', short: 'ระดับ 4 · ควรเฝ้าระวัง' },
    { n: 5, min: 42, max: 50, name: 'ควรพบผู้เชี่ยวชาญ', cls: 'level-5', short: 'ระดับ 5 · ควรพบผู้เชี่ยวชาญ' }
  ];
  function levelOf(score) {
    for (var i = 0; i < LEVELS.length; i++) if (score <= LEVELS[i].max) return LEVELS[i];
    return LEVELS[LEVELS.length - 1];
  }

  /* ---------- 9. เริ่มทำงาน ---------- */
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }
  function domReady() {
    return new Promise(function (res) { ready(res); });
  }

  /* บอกผู้ใช้ว่ากำลังเชื่อมต่อฐานข้อมูลอยู่ */
  function showLoading(on) {
    var el = document.getElementById('spLoading');
    if (on) {
      if (el) return;
      el = document.createElement('div');
      el.id = 'spLoading';
      el.className = 'sp-loading';
      el.innerHTML = '<div class="sp-spin"></div><span>กำลังเชื่อมต่อฐานข้อมูล...</span>';
      document.body.appendChild(el);
    } else if (el) { el.remove(); }
  }

  /* SP.boot(fn) — รอให้ทั้ง DOM และข้อมูลพร้อมก่อนค่อยเรียก fn
     โหมดเครื่องเดียวจะเรียกทันที โหมดออนไลน์จะรอโหลดข้อมูลชุดแรกให้เสร็จก่อน */
  var bootPromise = null;
  function bootAll() {
    if (bootPromise) return bootPromise;
    bootPromise = domReady().then(function () {
      if (!(DB && DB.enabled)) return null;
      showLoading(true);
      return DB.start()['catch'](function () { return null; });
    }).then(function () {
      showLoading(false);
      Student.touch();
      buildTopbar();
      buildFooter();
      if (!storageOK && !(DB && DB.on())) {
        var note = document.querySelector('.no-storage-note');
        if (note) note.classList.add('show');
      }
      var y = document.getElementById('yearNow');
      if (y) y.textContent = String(new Date().getFullYear() + 543);
      if (DB && DB.enabled) {
        DB.onSync(function () { buildTopbar(); });
      }
    });
    return bootPromise;
  }
  function boot(fn) {
    return bootAll().then(function () {
      try { fn(); } catch (e) { console.error(e); }
    });
  }
  /* วาดหน้าใหม่เมื่อมีคนอื่นแก้ข้อมูล (โหมดออนไลน์เท่านั้น) */
  function onSync(fn) {
    if (DB && DB.enabled) DB.onSync(fn);
  }

  bootAll();

  /* ---------- 10. ส่งออก ---------- */
  global.SP = {
    KEY: KEY, read: read, write: write, list: list, push: push, storageOK: storageOK,
    DB: DB, online: online, boot: boot, onSync: onSync, ready: ready,
    flush: function () { return (DB && DB.on()) ? DB.flush() : Promise.resolve(); },
    go: function (url) { return (DB && DB.on() ? DB.flush() : Promise.resolve())
      .then(function () { location.href = url; }); },
    stamp: stamp, thaiDate: thaiDate, thaiTime: thaiTime, fmtNum: fmtNum, fmtBaht: fmtBaht, esc: esc,
    toast: toast, Admin: Admin, Student: Student, Otp: Otp,
    Roster: Roster, Rating: Rating, CONTACT: CONTACT,
    STATUSES: STATUSES, statusOf: statusOf, SEVERITIES: SEVERITIES, severityOf: severityOf,
    readImageFile: readImageFile, prepareImage: prepareImage, Img: Img,
    dataUrlSize: dataUrlSize, fmtBytes: fmtBytes, storageUsed: storageUsed,
    storageInfo: storageInfo, requestPersist: requestPersist, usedPhotoRefs: usedPhotoRefs,
    sendOtpEmail: sendOtpEmail, EMAILJS: EMAILJS, validEmail: validEmail, normEmail: normEmail,
    OTP_LEN: OTP_LEN, OTP_TTL: OTP_TTL, OTP_MAX_TRY: OTP_MAX_TRY, OTP_RESEND: OTP_RESEND,
    barChart: barChart, PALETTE: PALETTE, SOLO: SOLO,
    countBy: countBy, sortedEntries: sortedEntries, exportCSV: exportCSV,
    LEVELS: LEVELS, levelOf: levelOf, SCHOOL: SCHOOL, COUNCIL: COUNCIL,
    ACTIVITIES: [
      'กีฬาสีภายใน', 'กิจกรรมวันไหว้ครู', 'กิจกรรมวันสุนทรภู่', 'กิจกรรมวันวิทยาศาสตร์',
      'กิจกรรมวันแม่แห่งชาติ', 'กิจกรรมวันพ่อแห่งชาติ', 'กิจกรรมวันลอยกระทง',
      'กิจกรรมวันคริสต์มาส', 'กิจกรรมวันปีใหม่', 'กิจกรรมวันเด็กแห่งชาติ',
      'ค่ายลูกเสือ-เนตรนารี', 'ทัศนศึกษานอกสถานที่', 'ตลาดนัดนักเรียน',
      'ประกวดดนตรีและร้องเพลง', 'แข่งขันทักษะวิชาการ', 'กิจกรรมจิตอาสาพัฒนาโรงเรียน',
      'กีฬาต้านยาเสพติด', 'งานปัจฉิมนิเทศ'
    ],
    PROBLEMS: [
      'ห้องน้ำไม่สะอาด', 'ขยะล้น / ไม่มีถังขยะ', 'น้ำดื่มไม่เพียงพอ',
      'พัดลม / เครื่องปรับอากาศชำรุด', 'ไฟฟ้าและหลอดไฟชำรุด', 'โต๊ะ-เก้าอี้ชำรุด',
      'อินเทอร์เน็ต / Wi-Fi ใช้งานไม่ได้', 'เสียงดังรบกวนการเรียน',
      'การกลั่นแกล้ง (Bullying)', 'อาหารในโรงอาหารไม่เพียงพอ',
      'ความปลอดภัยบริเวณโรงเรียน', 'สัตว์จรจัดในโรงเรียน',
      'พื้นลื่น / ทางเดินชำรุด', 'แสงสว่างไม่เพียงพอ', 'ต้นไม้ / กิ่งไม้เสี่ยงหักโค่น',
      'อื่น ๆ'
    ],
    PLACES: [
      'อาคาร 1', 'อาคาร 2', 'อาคาร 3', 'อาคาร 4', 'อาคาร 5', 'ห้องน้ำนักเรียนชาย', 'ห้องน้ำนักเรียนหญิง',
      'โรงอาหาร', 'สนามกีฬา', 'หอประชุม', 'ห้องสมุด', 'ห้องคอมพิวเตอร์', 'ห้องวิทยาศาสตร์',
      'ลานอเนกประสงค์', 'ลานจอดรถ', 'สวนหย่อม / พื้นที่สีเขียว', 'ประตูทางเข้าโรงเรียน', 'อื่น ๆ'
    ],
    ROOMS: (function () {
      var out = [];
      for (var g = 1; g <= GRADES; g++) for (var r = 1; r <= ROOMS_PER_GRADE; r++) out.push('ม.' + g + '/' + r);
      return out;
    })(),
    LEVEL_SCALE: [
      { v: 1, t: 'ไม่เลย' }, { v: 2, t: 'นาน ๆ ครั้ง' }, { v: 3, t: 'บางครั้ง' },
      { v: 4, t: 'บ่อยครั้ง' }, { v: 5, t: 'เกือบทุกวัน' }
    ],
    LIKE_SCALE: [
      { v: 1, t: 'ไม่ชอบมาก' }, { v: 2, t: 'ไม่ชอบ' }, { v: 3, t: 'เฉย ๆ' },
      { v: 4, t: 'ชอบ' }, { v: 5, t: 'ชอบมากที่สุด' }
    ],
    QUESTIONS: [
      'ในช่วง 2 สัปดาห์ที่ผ่านมา ฉันรู้สึกเบื่อหน่าย ไม่อยากทำอะไร แม้แต่สิ่งที่เคยชอบ',
      'ฉันรู้สึกเศร้า ท้อแท้ หรือหมดหวังกับสิ่งที่เป็นอยู่',
      'ฉันนอนหลับยาก หลับ ๆ ตื่น ๆ หรือนอนมากเกินไป',
      'ฉันรู้สึกอ่อนเพลีย ไม่มีแรง แม้จะได้พักผ่อนแล้ว',
      'ฉันเบื่ออาหาร หรือกินมากผิดปกติจนน้ำหนักเปลี่ยนแปลง',
      'ฉันรู้สึกกังวล ใจสั่น หรือหงุดหงิดง่ายกว่าปกติ',
      'ฉันไม่มีสมาธิกับการเรียนหรือสิ่งที่กำลังทำอยู่',
      'ฉันรู้สึกว่าตัวเองไม่มีคุณค่า หรือทำให้คนอื่นผิดหวัง',
      'ฉันรู้สึกโดดเดี่ยว ไม่มีใครเข้าใจ หรือไม่กล้าปรึกษาใคร',
      'ฉันรู้สึกกดดันจากการเรียน ครอบครัว หรือเพื่อน จนรับมือได้ยาก'
    ]
  };
})(window);
