/* ============================================================
   db.js — ตัวเชื่อม Supabase (ฐานข้อมูล + ล็อกอิน + รูปภาพ)
   ------------------------------------------------------------
   แนวคิด: ดึงข้อมูลจาก Supabase มาเก็บไว้ใน "แคชในหน่วยความจำ"
   แล้วให้โค้ดเดิมที่เรียกแบบทันที (SP.list / SP.read) อ่านจากแคชนั้น
   เมื่อมีใครแก้ข้อมูล Realtime จะแจ้งมา ระบบดึงใหม่แล้ววาดหน้าใหม่ให้เอง

   ถ้ายังไม่ได้ใส่ค่าใน config.js ไฟล์นี้จะปิดตัวเองเงียบ ๆ
   แล้วเว็บกลับไปทำงานโหมดเครื่องเดียวเหมือนเดิมทุกอย่าง
   ============================================================ */
(function (global) {
  'use strict';

  var CFG = global.SUPABASE_CONFIG || {};
  var SDK = global.SUPABASE_SDK || 'https://esm.sh/@supabase/supabase-js@2.49.9';
  var ENABLED = !!(CFG.url && CFG.anonKey);
  var BUCKET = 'photos';

  var sb = null;
  var cache = {};        /* ข้อมูลที่หน้าเว็บอ่าน (แก้ไขได้) */
  var mirror = {};       /* สำเนาตรงกับเซิร์ฟเวอร์ ใช้เทียบว่ามีอะไรเปลี่ยน */
  var listeners = [];
  var signedUrls = {};     /* ref -> {url, exp} */
  var channel = null;
  var pending = {};
  var inflight = Promise.resolve();     /* คิวงานเขียนที่ยังไม่เสร็จ */

  /* รอให้การบันทึกที่ค้างอยู่เสร็จก่อน (ใช้ก่อนเปลี่ยนหน้า) */
  function flush() { return inflight['catch'](function () { }); }
  function track(pr) {
    inflight = inflight['catch'](function () { }).then(function () { return pr; });
    return inflight;
  }

  var state = {
    enabled: ENABLED, online: false, ready: false,
    user: null, email: null, sid: null, isAdmin: false,
    error: null
  };

  function clone(v) { try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; } }
  function log(m) { try { console.info('[Supabase] ' + m); } catch (e) { } }
  function fire() { listeners.forEach(function (f) { try { f(); } catch (e) { console.error(e); } }); }
  function onSync(fn) { if (typeof fn === 'function') listeners.push(fn); }

  /* ---------- วันเวลาไทย ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function thDate(iso) {
    var d = iso ? new Date(iso) : new Date();
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + (d.getFullYear() + 543);
  }
  function thTime(iso) {
    var d = iso ? new Date(iso) : new Date();
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' น.';
  }
  function low(v) { return String(v == null ? '' : v).toLowerCase(); }
  function str(v) { return v == null ? '' : String(v); }
  function num(v) { return Number(v) || 0; }

  /* ---------- ผังการแปลงข้อมูล JS <-> ตารางฐานข้อมูล ---------- */
  var SPEC = {
    roster: {
      table: 'roster', key: 'sid',
      from: function (w) { return { sid: w.sid, name: w.name, room: w.room, no: str(w.number) }; },
      to: function (r) { return { sid: str(r.sid), name: r.name, room: r.room, number: str(r.no) }; }
    },
    students: {
      table: 'students', key: 'sid',
      from: function (w) {
        return {
          sid: w.sid, name: w.name, room: w.room, no: str(w.number), email: w.email,
          photo: w.photo || undefined, verified: true, authId: w.auth_id || undefined,
          rowId: w.id, createdAt: w.created_at, updatedAt: w.updated_at,
          createdDate: thDate(w.created_at), createdTime: thTime(w.created_at)
        };
      },
      to: function (r) {
        var o = {
          sid: str(r.sid), name: r.name, room: r.room, number: str(r.no),
          email: low(r.email), photo: r.photo || null,
          updated_at: new Date().toISOString()
        };
        if (r.rowId) o.id = r.rowId;
        if (r.authId) o.auth_id = r.authId;
        return o;
      }
    },
    votes: {
      table: 'votes', key: 'sid',
      from: function (w) {
        return {
          id: w.id, sid: w.sid, name: w.name, room: w.room, no: str(w.number),
          activity: w.activity, like: w.like_level, suggest: w.suggest || '',
          iso: w.created_at, date: thDate(w.created_at), time: thTime(w.created_at)
        };
      },
      to: function (r) {
        return {
          id: r.id, sid: str(r.sid), name: r.name, room: r.room, number: str(r.no),
          activity: r.activity, like_level: num(r.like), suggest: r.suggest || ''
        };
      }
    },
    mental: {
      table: 'mental_results', key: 'id',
      from: function (w) {
        return {
          id: w.id, sid: w.sid, name: w.name, room: w.room, no: str(w.number),
          answers: w.answers || [], score: w.score, level: w.level,
          levelName: '', iso: w.created_at, date: thDate(w.created_at), time: thTime(w.created_at)
        };
      },
      to: function (r) {
        return {
          id: r.id, sid: str(r.sid), name: r.name, room: r.room, number: str(r.no),
          answers: r.answers || [], score: r.score == null ? null : num(r.score), level: num(r.level) || 1
        };
      }
    },
    problems: {
      table: 'problems', key: 'id',
      from: function (w) {
        return {
          id: w.id, sid: w.sid || undefined, name: w.name || undefined,
          room: w.room || undefined, no: w.number ? str(w.number) : undefined,
          by: w.reported_by || '', problem: w.problem, place: w.place,
          severity: w.severity, detail: w.detail || '', photos: w.photos || [],
          status: w.status || 'wait', history: w.history || [],
          iso: w.created_at, date: thDate(w.created_at), time: thTime(w.created_at)
        };
      },
      to: function (r) {
        return {
          id: r.id, sid: r.sid || null, name: r.name || null,
          room: r.room || null, number: r.no ? str(r.no) : null,
          reported_by: r.by || '', problem: r.problem, place: r.place,
          severity: num(r.severity) || 3, detail: r.detail || '',
          photos: r.photos || [], status: r.status || 'wait',
          history: r.history || [], updated_at: new Date().toISOString()
        };
      }
    },
    budget: {
      table: 'budget', key: 'id',
      from: function (w) {
        return {
          id: w.id, item: w.item, total: num(w.total), actual: num(w.actual),
          recorder: w.recorder, note: w.note || '',
          iso: w.created_at, date: thDate(w.created_at), time: thTime(w.created_at)
        };
      },
      to: function (r) {
        return {
          id: r.id, item: r.item, total: num(r.total), actual: num(r.actual),
          recorder: r.recorder, note: r.note || ''
        };
      }
    },
    voteExtra: {
      table: 'vote_extra', key: 'id',
      from: function (w) {
        return {
          id: w.id, activity: w.activity, count: num(w.count),
          iso: w.created_at, date: thDate(w.created_at), time: thTime(w.created_at)
        };
      },
      to: function (r) { return { id: r.id, activity: r.activity, count: num(r.count) }; }
    },
    ratings: {
      table: 'ratings', key: 'sid',
      from: function (w) {
        return {
          id: w.sid, sid: w.sid, name: w.name, room: w.room, stars: w.stars,
          comment: w.comment || '', iso: w.created_at,
          date: thDate(w.created_at), time: thTime(w.created_at)
        };
      },
      to: function (r) {
        return {
          sid: str(r.sid), name: r.name || null, room: r.room || null,
          stars: num(r.stars) || 1, comment: r.comment || ''
        };
      }
    }
  };
  var SETTINGS = 'settings';

  function handles(key) { return !!SPEC[key] || key === SETTINGS; }

  /* ---------- โหลด SDK ---------- */
  function loadSdk() {
    return import(SDK).then(function (m) {
      sb = m.createClient(CFG.url, CFG.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    });
  }

  /* ---------- ดึงข้อมูล ---------- */
  function fetchOne(key) {
    var spec = SPEC[key];
    if (!spec) return Promise.resolve();
    return sb.from(spec.table).select('*').then(function (res) {
      if (res.error) {
        log('ดึง ' + spec.table + ' ไม่สำเร็จ: ' + res.error.message);
        if (cache[key] === undefined) { cache[key] = []; mirror[key] = []; }
        return;
      }
      cache[key] = (res.data || []).map(spec.from);
      mirror[key] = clone(cache[key]);
    });
  }
  function fetchSettings() {
    return sb.from('app_settings').select('value').eq('key', 'settings').maybeSingle()
      .then(function (res) {
        cache[SETTINGS] = res && res.data ? res.data.value : null;
        mirror[SETTINGS] = clone(cache[SETTINGS]);
      })['catch'](function () { cache[SETTINGS] = null; mirror[SETTINGS] = null; });
  }
  function fetchAll() {
    var jobs = Object.keys(SPEC).map(fetchOne);
    jobs.push(fetchSettings());
    return Promise.all(jobs);
  }

  /* ดึงเฉพาะตารางที่เปลี่ยน (รวบหลายเหตุการณ์ที่มาติด ๆ กัน) */
  function refetch(key) {
    if (pending[key]) return;
    pending[key] = setTimeout(function () {
      delete pending[key];
      (key === SETTINGS ? fetchSettings() : fetchOne(key)).then(fire);
    }, 220);
  }

  /* ---------- อ่าน / เขียน ---------- */
  function get(key, fallback) {
    var v = cache[key];
    return v === undefined ? fallback : v;
  }

  function indexBy(arr, k) {
    var m = {};
    (arr || []).forEach(function (r) { var i = r && r[k]; if (i != null) m[String(i)] = r; });
    return m;
  }
  function same(a, b) {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
  }
  function report(err) {
    var msg = (err && (err.message || err.error_description)) || 'ไม่ทราบสาเหตุ';
    state.error = msg;
    log('บันทึกไม่สำเร็จ: ' + msg);
    if (global.SP && global.SP.toast) {
      global.SP.toast(/policy|permission|row-level/i.test(msg)
        ? 'ไม่มีสิทธิ์บันทึกข้อมูลนี้'
        : 'บันทึกขึ้นเซิร์ฟเวอร์ไม่สำเร็จ');
    }
  }

  function put(key, value) {
    if (key === SETTINGS) {
      cache[key] = value; mirror[key] = clone(value); fire();
      track(sb.from('app_settings')
        .upsert({ key: 'settings', value: value || {}, updated_at: new Date().toISOString() },
                { onConflict: 'key' })
        .then(function (r) { if (r.error) report(r.error); }));
      return true;
    }
    var spec = SPEC[key];
    if (!spec) return false;

    /* เทียบกับสำเนาต้นฉบับ ไม่ใช่ตัวแคชที่หน้าเว็บอาจแก้ไปแล้ว */
    var before = indexBy(mirror[key] || [], spec.key);
    var after = indexBy(value || [], spec.key);
    cache[key] = (value || []).slice();
    mirror[key] = clone(cache[key]);
    fire();

    var dels = Object.keys(before).filter(function (k) { return !after[k]; });
    var ups = Object.keys(after)
      .filter(function (k) { return !before[k] || !same(before[k], after[k]); })
      .map(function (k) { return spec.to(after[k]); });

    var chain = Promise.resolve();
    if (dels.length) {
      chain = chain.then(function () {
        return sb.from(spec.table)['delete']().in(spec.key, dels);
      }).then(function (r) { if (r && r.error) report(r.error); });
    }
    if (ups.length) {
      chain = chain.then(function () {
        return sb.from(spec.table).upsert(ups, { onConflict: spec.key });
      }).then(function (r) { if (r && r.error) report(r.error); });
    }
    track(chain['catch'](report));
    return true;
  }

  /* ---------- รูปภาพ (Supabase Storage) ---------- */
  var PREFIX = 'sb:';
  function isPhotoRef(ref) { return String(ref || '').indexOf(PREFIX) === 0; }
  function pathOf(ref) { return String(ref).slice(PREFIX.length); }

  function putPhoto(blob) {
    var who = state.sid || (state.user && state.user.id) || 'anon';
    var path = who + '/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '.jpg';
    return sb.storage.from(BUCKET).upload(path, blob, {
      contentType: blob.type || 'image/jpeg', upsert: false
    }).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      return PREFIX + path;
    });
  }
  function getPhoto(ref) {
    if (!ref) return Promise.resolve('');
    var c = signedUrls[ref];
    if (c && c.exp > Date.now()) return Promise.resolve(c.url);
    return sb.storage.from(BUCKET).createSignedUrl(pathOf(ref), 3600).then(function (r) {
      if (r.error || !r.data) return '';
      signedUrls[ref] = { url: r.data.signedUrl, exp: Date.now() + 50 * 60 * 1000 };
      return r.data.signedUrl;
    })['catch'](function () { return ''; });
  }
  function delPhoto(ref) {
    delete signedUrls[ref];
    return sb.storage.from(BUCKET).remove([pathOf(ref)])
      .then(function () { return true; })['catch'](function () { return false; });
  }

  /* ---------- ล็อกอิน ---------- */
  function signUp(email, password) {
    return sb.auth.signUp({ email: low(email), password: password }).then(function (r) {
      if (r.error) throw r.error;
      return r.data;
    });
  }
  function signIn(email, password) {
    return sb.auth.signInWithPassword({ email: low(email), password: password }).then(function (r) {
      if (r.error) throw r.error;
      return r.data;
    });
  }
  function signOutNow() { return sb.auth.signOut(); }
  function resendConfirm(email) {
    return sb.auth.resend({ type: 'signup', email: low(email) });
  }
  function resetPassword(email) {
    return sb.auth.resetPasswordForEmail(low(email), {
      redirectTo: location.origin + '/intex7.html?reset=1'
    });
  }

  /* เพิ่มแถวนักเรียนของตัวเอง (RLS จะตรวจกับคลังรายชื่อให้อีกชั้น) */
  function createMyStudent(rec) {
    return sb.from('students').insert({
      auth_id: state.user.id,
      sid: str(rec.sid), name: rec.name, room: rec.room,
      number: str(rec.no), email: low(rec.email)
    }).then(function (r) {
      if (r.error) throw r.error;
      return true;
    });
  }

  /* อ่านคลังรายชื่อทีละคน (ใช้ตอนสมัคร ก่อนมีสิทธิ์เห็นทั้งตาราง) */
  function rosterOnce(sid) {
    return sb.from('roster').select('*').eq('sid', str(sid)).maybeSingle()
      .then(function (r) { return r && r.data ? SPEC.roster.from(r.data) : null; })
      ['catch'](function () { return null; });
  }

  function refreshRole() {
    var u = state.user;
    if (!u) { state.isAdmin = false; state.sid = null; return Promise.resolve(state); }
    return Promise.all([
      sb.from('admins').select('id').eq('id', u.id).maybeSingle(),
      sb.from('students').select('sid').eq('auth_id', u.id).maybeSingle()
    ]).then(function (res) {
      state.isAdmin = !!(res[0] && res[0].data);
      state.sid = res[1] && res[1].data ? String(res[1].data.sid) : null;
      return state;
    })['catch'](function () { return state; });
  }

  /* ---------- Realtime ---------- */
  function subscribe() {
    if (channel) { try { sb.removeChannel(channel); } catch (e) { } channel = null; }
    channel = sb.channel('sapara-live');
    Object.keys(SPEC).forEach(function (key) {
      channel.on('postgres_changes',
        { event: '*', schema: 'public', table: SPEC[key].table },
        function () { refetch(key); });
    });
    channel.on('postgres_changes',
      { event: '*', schema: 'public', table: 'app_settings' },
      function () { refetch(SETTINGS); });
    channel.subscribe();
  }

  /* ---------- เริ่มระบบ ---------- */
  var startPromise = null;
  function start() {
    if (!ENABLED) return Promise.resolve(state);
    if (startPromise) return startPromise;

    startPromise = loadSdk().then(function () {
      state.online = true;
      log('เชื่อมต่อ ' + CFG.url + ' แล้ว');

      sb.auth.onAuthStateChange(function (evt, session) {
        var uid = session && session.user ? session.user.id : null;
        var had = state.user ? state.user.id : null;
        state.user = session ? session.user : null;
        state.email = state.user ? low(state.user.email) : null;
        if (uid === had) return;
        if (!uid) { cache = {}; mirror = {}; state.isAdmin = false; state.sid = null; fire(); return; }
        refreshRole().then(fetchAll).then(function () { subscribe(); fire(); });
      });

      return sb.auth.getSession().then(function (r) {
        var session = r && r.data ? r.data.session : null;
        state.user = session ? session.user : null;
        state.email = state.user ? low(state.user.email) : null;
        if (!state.user) { state.ready = true; return state; }
        return refreshRole().then(fetchAll).then(function () {
          subscribe();
          state.ready = true;
          return state;
        });
      });
    })['catch'](function (err) {
      state.online = false;
      state.error = err.message;
      log('เริ่มระบบไม่สำเร็จ: ' + err.message + ' — กลับไปโหมดเครื่องเดียว');
      return state;
    });

    return startPromise;
  }

  /* ---------- ส่งออก ---------- */
  global.SPDB = {
    enabled: ENABLED,
    state: state,
    SETTINGS_KEY: SETTINGS,
    start: start,
    on: function () { return ENABLED && state.online && !!state.user; },
    live: function () { return ENABLED && state.online; },
    handles: handles,
    get: get, put: put, onSync: onSync, fire: fire, refetchAll: fetchAll, flush: flush,
    isPhotoRef: isPhotoRef, putPhoto: putPhoto, getPhoto: getPhoto, delPhoto: delPhoto,
    signUp: signUp, signIn: signIn, signOut: signOutNow,
    resendConfirm: resendConfirm, resetPassword: resetPassword,
    createMyStudent: createMyStudent, rosterOnce: rosterOnce, refreshRole: refreshRole,
    user: function () { return state.user; },
    isAdmin: function () { return state.isAdmin; },
    mySid: function () { return state.sid; },
    client: function () { return sb; }
  };
})(window);
