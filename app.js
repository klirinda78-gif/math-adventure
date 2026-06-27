/* ============================================================
   ЛОГИКА  «Математическое приключение»
   Чистый JavaScript, без сборки. Работает из file://.
   Прогресс хранится в localStorage.
   ============================================================ */

const STORE_KEY = "mathAdventure_v2";   // { activeId, profiles:{id:state} }
const OLD_KEY = "mathAdventure_v1";     // для миграции
const SETTINGS_KEY = "mathAdventure_settings";

/* ----------  Настройки приложения (общие)  ---------- */
function defaultSettings() {
  return { audio: true, unlockMode: "sequential" }; // sequential | open
}
let settings = (() => {
  try { return Object.assign(defaultSettings(), JSON.parse(localStorage.getItem(SETTINGS_KEY))); }
  catch (e) { return defaultSettings(); }
})();
function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }

/* ----------  Состояние одного профиля по умолчанию  ---------- */
function newId() { return "p" + Date.now().toString(36) + Math.floor(Math.random() * 1000); }
function defaultState(name = "Чемпион", grade = "2 класс") {
  return {
    id: newId(),
    name, grade,
    avatar: "🏎️",
    points: 0,
    coins: 0,
    stars: 0,
    streak: 0,
    lastActive: null,            // дата последнего занятия (YYYY-MM-DD)
    completedLessons: [],        // id пройденных уроков
    lessonScores: {},            // id -> процент верных в уроке
    topicStats: {},              // topicId -> {correct, wrong}
    topicSolved: {},             // topicId -> сколько задач решено верно
    topicRecent: {},             // topicId -> [1,0,1...] последние ответы (для адаптива)
    weakTopics: [],              // id слабых тем
    achievements: [],            // id полученных достижений
    totalCorrect: 0,
    totalWrong: 0,
    fiveMinDone: 0,
    reviewQueue: [],             // [{topicId, due:'YYYY-MM-DD', stage}]
    onboarded: false
  };
}

/* ----------  Мультипрофильное хранилище  ---------- */
let store = loadStore();
let state = store.profiles[store.activeId];

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.profiles && s.profiles[s.activeId]) {
        // дозаполняем недостающие поля у каждого профиля
        for (const id in s.profiles) s.profiles[id] = Object.assign(defaultState(), s.profiles[id]);
        return s;
      }
    }
    // миграция со старой версии (один профиль)
    const old = localStorage.getItem(OLD_KEY);
    if (old) {
      const st = Object.assign(defaultState(), JSON.parse(old));
      return { activeId: st.id, profiles: { [st.id]: st } };
    }
  } catch (e) { /* ignore */ }
  const st = defaultState();
  return { activeId: st.id, profiles: { [st.id]: st } };
}
function saveState() {
  store.profiles[state.id] = state;
  store.activeId = state.id;
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
  cloudPushDebounced();
}

/* ----------  Облако: отложенная отправка  ---------- */
let _cloudTimer = null;
let cloudLastSync = null;
function cloudPushDebounced() {
  if (!window.Cloud || !Cloud.ready || !Cloud.user) return;
  clearTimeout(_cloudTimer);
  _cloudTimer = setTimeout(() => {
    Cloud.push(store).then(() => { cloudLastSync = new Date(); }).catch(() => {});
  }, 1500);
}
/* Слияние локальных и облачных профилей (при конфликте id берём свежий) */
function mergeStores(local, cloud) {
  const profiles = Object.assign({}, local.profiles);
  for (const id in cloud.profiles) {
    const c = cloud.profiles[id], l = profiles[id];
    profiles[id] = (!l) ? c : (lastActiveScore(c) >= lastActiveScore(l) ? c : l);
  }
  const activeId = profiles[local.activeId] ? local.activeId : Object.keys(profiles)[0];
  return { activeId, profiles };
}
function lastActiveScore(p) {
  // чем больше пройдено/решено — тем «свежее»
  return (p.completedLessons ? p.completedLessons.length : 0) * 100 + (p.totalCorrect || 0) + (p.totalWrong || 0);
}
function switchProfile(id) {
  if (!store.profiles[id]) return;
  state = store.profiles[id];
  store.activeId = id;
  saveState();
  navigate("home");
}
function createProfile(name, grade) {
  const st = defaultState(name || "Игрок", grade || "2 класс");
  st.onboarded = true;
  store.profiles[st.id] = st;
  state = st; store.activeId = st.id;
  touchStreak(); saveState();
  navigate("home");
}
function deleteProfile(id) {
  const ids = Object.keys(store.profiles);
  if (ids.length <= 1) { alert("Нельзя удалить единственный профиль."); return; }
  delete store.profiles[id];
  if (state.id === id) { state = store.profiles[Object.keys(store.profiles)[0]]; }
  store.activeId = state.id;
  saveState();
  render();
}

/* ----------  Экспорт / импорт прогресса (офлайн-синхронизация)  ---------- */
function exportCode() {
  return btoa(unescape(encodeURIComponent(JSON.stringify(state))));
}
function importCode(code) {
  try {
    const obj = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
    if (!obj || !obj.name) throw new Error("bad");
    obj.id = obj.id || newId();
    if (store.profiles[obj.id]) obj.id = newId(); // не затираем существующий
    obj.onboarded = true;
    store.profiles[obj.id] = Object.assign(defaultState(), obj);
    state = store.profiles[obj.id]; store.activeId = obj.id;
    saveState();
    return true;
  } catch (e) { return false; }
}

/* ----------  Утилиты дат и серий  ---------- */
function today() { return new Date().toISOString().slice(0, 10); }
function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}
function touchStreak() {
  const t = today();
  if (state.lastActive === t) return;
  if (state.lastActive && daysBetween(state.lastActive, t) === 1) {
    state.streak += 1;
  } else if (!state.lastActive) {
    state.streak = 1;
  } else if (daysBetween(state.lastActive, t) > 1) {
    state.streak = 1;            // серия прервалась
  }
  state.lastActive = t;
  saveState();
  refreshTopBar();
}

/* ----------  Интервальное повторение  ---------- */
const REVIEW_DAYS = [1, 3, 7, 14];
function scheduleReview(topicId, stage = 0) {
  const due = new Date();
  due.setDate(due.getDate() + REVIEW_DAYS[Math.min(stage, REVIEW_DAYS.length - 1)]);
  const existing = state.reviewQueue.find(r => r.topicId === topicId);
  const item = { topicId, due: due.toISOString().slice(0, 10), stage };
  if (existing) Object.assign(existing, item);
  else state.reviewQueue.push(item);
  saveState();
}
function dueReviews() {
  const t = today();
  return state.reviewQueue.filter(r => r.due <= t);
}

/* ----------  Помощник Пиф: реплики  ---------- */
const PIF = {
  cheer: ["Отличный заезд! 🏁", "Ты молодец! ⭐", "Чисто сработано! 🏎️", "Так держать, чемпион!", "Вот это точность! ⛳"],
  oops:  ["Ничего страшного, давай разберём вместе.", "Это просто пит-стоп. Сейчас починим!", "Ошибка — часть тренировки. Смотри подсказку.", "Почти! Давай ещё раз, я помогу."],
  hello: ["Готов к заезду?", "Поехали покорять математику!", "Я твой штурман Пиф. Подскажу дорогу!"]
};
function pifSay(kind) {
  const arr = PIF[kind] || PIF.hello;
  return arr[Math.floor(Math.random() * arr.length)];
}

/* ----------  Озвучка (чтение вслух) ---------- */
function canSpeak() { return "speechSynthesis" in window; }
function speak(text) {
  if (!settings.audio || !canSpeak()) return;
  try {
    speechSynthesis.cancel();
    const clean = String(text).replace(/[🔊🏁🏎️⛳⚙️⏱️🏆🚗💡📝🎯✅🧩🔁⚡🪙⭐🔥🏅×÷•›‹]/g, " ")
      .replace(/×/g, " умножить ").replace(/:/g, " разделить ");
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = "ru-RU"; u.rate = 0.95; u.pitch = 1.05;
    const v = speechSynthesis.getVoices().find(x => /ru/i.test(x.lang));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch (e) { /* ignore */ }
}
function speakBtn(text) {
  if (!canSpeak()) return "";
  return `<button class="speak-btn" title="Прочитать вслух" onclick='speak(${JSON.stringify(text)})'>🔊</button>`;
}
function toggleAudio() { settings.audio = !settings.audio; saveSettings(); if (!settings.audio && canSpeak()) speechSynthesis.cancel(); render(); }

/* ----------  Награды и достижения  ---------- */
function addReward(coins = 0, stars = 0, points = 0) {
  state.coins += coins;
  state.stars += stars;
  state.points += points + coins;     // очки растут вместе с монетами
  saveState();
  refreshTopBar();
}
function refreshTopBar() {
  if (state.onboarded && document.getElementById("topbar")) renderTopBar();
}
function recordAnswer(topicId, correct) {
  const st = state.topicStats[topicId] || { correct: 0, wrong: 0 };
  if (correct) { st.correct++; state.totalCorrect++; state.topicSolved[topicId] = (state.topicSolved[topicId] || 0) + 1; }
  else { st.wrong++; state.totalWrong++; }
  state.topicStats[topicId] = st;
  // история последних ответов для адаптивной сложности
  const rec = state.topicRecent[topicId] || [];
  rec.push(correct ? 1 : 0);
  while (rec.length > 6) rec.shift();
  state.topicRecent[topicId] = rec;
  updateWeakTopics();
  saveState();
}

/* ----------  Адаптивная сложность  ---------- */
function adaptiveLevel(topicId) {
  const rec = state.topicRecent[topicId] || [];
  if (rec.length < 2) return "easy";
  const acc = rec.reduce((a, b) => a + b, 0) / rec.length;
  if (acc >= 0.8) return "hard";
  if (acc >= 0.5) return "medium";
  return "easy";
}
function updateWeakTopics() {
  state.weakTopics = [];
  for (const t of TOPICS) {
    const st = state.topicStats[t.id];
    if (st && st.wrong >= 2 && st.wrong >= st.correct) {
      state.weakTopics.push(t.id);
    }
  }
}
function checkAchievements() {
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (!state.achievements.includes(a.id) && a.check(state)) {
      state.achievements.push(a.id);
      fresh.push(a);
    }
  }
  saveState();
  if (fresh.length) showAchievementToast(fresh);
}

/* ----------  Уровень ребёнка  ---------- */
function levelInfo() {
  const ranks = [
    { min: 0,   name: "Новичок трассы",  icon: "🚲" },
    { min: 50,  name: "Юный гонщик",     icon: "🛵" },
    { min: 120, name: "Пилот",           icon: "🚗" },
    { min: 250, name: "Гонщик",          icon: "🏎️" },
    { min: 450, name: "Чемпион сезона",  icon: "🏆" }
  ];
  let cur = ranks[0], next = null;
  for (let i = 0; i < ranks.length; i++) {
    if (state.points >= ranks[i].min) { cur = ranks[i]; next = ranks[i + 1] || null; }
  }
  const lvl = ranks.indexOf(cur) + 1;
  return { lvl, name: cur.name, icon: cur.icon, next };
}

/* ----------  Общий прогресс по курсу  ---------- */
function courseProgress() {
  const totalLessons = TOPICS.reduce((n, t) => n + t.lessons.length, 0);
  return Math.round((state.completedLessons.length / totalLessons) * 100);
}

/* ============================================================
   РЕНДЕР: точка входа
   ============================================================ */
const app = () => document.getElementById("app");
let route = { view: "home" };

function navigate(view, params = {}) {
  route = Object.assign({ view }, params);
  window.scrollTo(0, 0);
  render();
}

function render() {
  if (!state.onboarded) { renderOnboarding(); return; }
  renderTopBar();
  const views = {
    home: renderHome, map: renderMap, lesson: renderLesson,
    trainer: renderTrainer, five: renderFive, weak: renderWeak,
    profile: renderProfile, parent: renderParent
  };
  (views[route.view] || renderHome)();
  renderNav();
}

/* ----------  Аватары  ---------- */
const AVATARS = ["🏎️", "🚗", "🏁", "⛳", "🏆", "🚀", "🛵", "🤖", "🦊", "🐱", "🦁", "🐯"];
let obAvatar = "🏎️";
function pickAvatar(a) { obAvatar = a; renderOnboarding(); }
function avatarGrid(selected, onclickName) {
  return `<div class="avatar-grid">` + AVATARS.map(a =>
    `<button class="avatar-opt ${a === selected ? "sel" : ""}" onclick="${onclickName}('${a}')">${a}</button>`).join("") + `</div>`;
}

/* ----------  Онбординг (имя, класс, аватар)  ---------- */
function renderOnboarding() {
  const nameVal = document.getElementById("ob-name") ? document.getElementById("ob-name").value : "";
  const gradeVal = document.getElementById("ob-grade") ? document.getElementById("ob-grade").value : "2 класс";
  app().innerHTML = `
    <div class="onboard">
      <div class="mascot big">${mascotSVG()}</div>
      <h1>Привет! Я Пиф 🏁</h1>
      <p class="lead">Твой штурман в мире математики. Будем тренироваться понемногу каждый день — как настоящие гонщики и гольфисты!</p>
      <label class="field">Как тебя зовут?
        <input id="ob-name" placeholder="Имя" maxlength="20" value="${escapeAttr(nameVal)}">
      </label>
      <label class="field">В каком ты классе?
        <input id="ob-grade" placeholder="например, 2 класс" maxlength="12" value="${escapeAttr(gradeVal || "2 класс")}">
      </label>
      <div class="field">Выбери аватар:
        ${avatarGrid(obAvatar, "pickAvatar")}
      </div>
      <button class="btn primary big" onclick="finishOnboarding()">Поехали! ${obAvatar}</button>
    </div>`;
}
function finishOnboarding() {
  const name = document.getElementById("ob-name").value.trim();
  const grade = document.getElementById("ob-grade").value.trim();
  state.name = name || "Чемпион";
  state.grade = grade || "2 класс";
  state.avatar = obAvatar;
  state.onboarded = true;
  touchStreak();
  saveState();
  navigate("home");
}
function changeAvatar(a) { state.avatar = a; saveState(); closeSheet(); render(); }
function openAvatarPicker() {
  showSheet(`<div class="sheet-body">
    <h3>Выбери аватар</h3>
    ${avatarGrid(state.avatar, "changeAvatar")}
  </div>`);
}

/* ----------  Верхняя панель (статы)  ---------- */
function renderTopBar() {
  const li = levelInfo();
  document.getElementById("topbar").innerHTML = `
    <div class="tb-left" onclick="navigate('profile')">
      <span class="tb-level">${li.icon} Ур.${li.lvl}</span>
    </div>
    <div class="tb-stats">
      <span class="stat coin" title="Монеты">🪙 ${state.coins}</span>
      <span class="stat star" title="Звёзды">⭐ ${state.stars}</span>
      <span class="stat fire" title="Серия дней">🔥 ${state.streak}</span>
    </div>`;
}

/* ----------  Нижняя навигация  ---------- */
function renderNav() {
  const items = [
    ["home", "🏠", "Главная"],
    ["map", "🗺️", "Карта"],
    ["five", "⏱️", "5 минут"],
    ["weak", "🎯", "Слабые"],
    ["profile", "👤", "Профиль"]
  ];
  document.getElementById("nav").innerHTML = items.map(([v, ic, label]) =>
    `<button class="nav-btn ${route.view === v ? "active" : ""}" onclick="navigate('${v}')">
       <span class="nav-ic">${ic}</span><span class="nav-label">${label}</span>
     </button>`).join("");
}

/* ============================================================
   ГЛАВНАЯ
   ============================================================ */
function renderHome() {
  const li = levelInfo();
  const prog = courseProgress();
  const phrase = MOTIVATION[new Date().getDate() % MOTIVATION.length];
  const nextLesson = findNextLesson();
  const reviews = dueReviews();

  app().innerHTML = `
    <section class="hero card">
      <div class="hero-row">
        <div class="mascot">${mascotSVG()}</div>
        <div>
          <h1>${state.avatar || ""} Привет, ${escapeHTML(state.name)}! 👋</h1>
          <p class="muted">${li.icon} ${li.name} • ${state.grade}</p>
        </div>
      </div>
      <div class="speech">${pifSay("hello")}</div>
    </section>

    <section class="card">
      <div class="row-between">
        <strong>Прогресс по курсу</strong><span class="muted">${prog}%</span>
      </div>
      <div class="progress"><div class="progress-fill" style="width:${prog}%"></div></div>
    </section>

    <div class="grid2">
      <button class="action-card green" onclick="continueLesson()">
        <span class="ac-ic">▶️</span><b>Продолжить занятие</b>
        <small>${nextLesson ? escapeHTML(nextLesson.lesson.title) : "Все уроки пройдены!"}</small>
      </button>
      <button class="action-card orange" onclick="navigate('weak')">
        <span class="ac-ic">🎯</span><b>Повторить слабые темы</b>
        <small>${state.weakTopics.length ? state.weakTopics.length + " тем(ы)" : "Пока всё ровно!"}</small>
      </button>
      <button class="action-card blue" onclick="navigate('five')">
        <span class="ac-ic">⏱️</span><b>Тренировка на 5 минут</b>
        <small>7 быстрых вопросов</small>
      </button>
      <button class="action-card purple" onclick="navigate('map')">
        <span class="ac-ic">🗺️</span><b>Карта курса</b>
        <small>Выбери остров</small>
      </button>
    </div>

    ${reviews.length ? `
    <section class="card review-banner">
      🔁 Пора повторить: ${reviews.map(r => topicById(r.topicId).title).join(", ")}.
      <button class="btn small" onclick="startReview()">Повторить</button>
    </section>` : ""}

    <section class="card motivation">
      <span class="quote-mark">“</span>${phrase}
    </section>

    <section class="card">
      <strong>Награды</strong>
      <div class="reward-row">
        <div class="reward-pill">🪙 <b>${state.coins}</b><small>монет</small></div>
        <div class="reward-pill">⭐ <b>${state.stars}</b><small>звёзд</small></div>
        <div class="reward-pill">🏅 <b>${state.achievements.length}</b><small>наград</small></div>
      </div>
    </section>`;
}

function findNextLesson() {
  for (const t of TOPICS) {
    for (const l of t.lessons) {
      if (!state.completedLessons.includes(l.id)) return { topic: t, lesson: l };
    }
  }
  return null;
}
function continueLesson() {
  const nl = findNextLesson();
  if (nl) navigate("lesson", { topicId: nl.topic.id, lessonId: nl.lesson.id });
  else navigate("map");
}

/* ============================================================
   КАРТА КУРСА
   ============================================================ */
function isTopicUnlocked(i) {
  if (settings.unlockMode === "open") return true;
  if (i === 0) return true;
  // открыт, если в предыдущей теме пройден хотя бы один урок
  const prev = TOPICS[i - 1];
  return prev.lessons.some(l => state.completedLessons.includes(l.id));
}
function renderMap() {
  const html = TOPICS.map((t, i) => {
    const pct = topicPercent(state, t.id);
    const unlocked = isTopicUnlocked(i);
    const done = pct === 100;
    const side = i % 2 === 0 ? "left" : "right";
    return `
      <div class="map-node ${side} ${done ? "done" : ""} ${unlocked ? "" : "locked"}"
           onclick="${unlocked ? `openTopic('${t.id}')` : `lockedHint()`}" style="--c:${t.color}">
        <div class="node-circle" style="background:${unlocked ? t.color : '#c7cdd8'}">
          <span class="node-ic">${unlocked ? t.icon : "🔒"}</span>
          ${done ? '<span class="node-check">✓</span>' : ""}
        </div>
        <div class="node-info">
          <b>${t.title}</b>
          <small>${unlocked ? t.subtitle : "Сначала начни предыдущий остров"}</small>
          ${unlocked ? `<div class="mini-progress"><div style="width:${pct}%;background:${t.color}"></div></div>
          <span class="muted">${pct}%</span>` : ""}
        </div>
      </div>`;
  }).join('<div class="map-line"></div>');

  app().innerHTML = `
    <section class="card head-card">
      <h1>🗺️ Карта сезона</h1>
      <p class="muted">${settings.unlockMode === "open" ? "Все острова открыты — выбирай любой!" : "Острова открываются по очереди. Начни занятие — откроется следующий!"}</p>
    </section>
    <div class="map">${html}</div>`;
}
function lockedHint() {
  const t = document.getElementById("toast");
  t.innerHTML = `<div class="toast-card"><span class="t-ic">🔒</span><div><b>Остров закрыт</b><br>Начни предыдущий остров — этот откроется!</div></div>`;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}

function openTopic(topicId) {
  const t = topicById(topicId);
  const lessons = t.lessons.map(l => {
    const done = state.completedLessons.includes(l.id);
    const score = state.lessonScores[l.id];
    return `
      <button class="list-item" onclick="navigate('lesson',{topicId:'${t.id}',lessonId:'${l.id}'})">
        <span class="li-ic">${done ? "✅" : "📘"}</span>
        <span class="li-main"><b>${l.title}</b>${done && score != null ? `<small>результат ${score}%</small>` : ""}</span>
        <span class="li-go">›</span>
      </button>`;
  }).join("");

  showSheet(`
    <div class="sheet-head" style="background:${t.color}">
      <span class="sheet-ic">${t.icon}</span>
      <div><h2>${t.title}</h2><p>${t.blurb}</p></div>
    </div>
    <div class="sheet-body">
      <h3>Уроки</h3>
      ${lessons}
      <button class="btn primary big" onclick="closeSheet();navigate('trainer',{topicId:'${t.id}'})">🎮 Тренажёр задач</button>
    </div>`);
}

/* ============================================================
   УРОК
   ============================================================ */
function renderLesson() {
  const t = topicById(route.topicId);
  const lesson = t.lessons.find(l => l.id === route.lessonId);
  const ex = lesson.example;

  app().innerHTML = `
    <section class="card lesson-head" style="border-top:5px solid ${t.color}">
      <button class="back" onclick="navigate('map')">‹ Назад</button>
      <h1>${lesson.title}</h1>
      <p class="muted">${t.icon} ${t.title}</p>
    </section>

    <section class="card block">
      <h3>💡 Объяснение ${speakBtn(lesson.explanation)}</h3>
      <p>${lesson.explanation}</p>
    </section>

    <section class="card block">
      <h3>📝 Пример ${speakBtn(ex.problem + ". " + ex.steps.join(". "))}</h3>
      <p class="problem">${ex.problem}</p>
      <button class="btn outline" id="showSteps" onclick="toggleSteps()">Показать решение по шагам</button>
      <ol class="steps hidden" id="steps">
        ${ex.steps.map(s => `<li>${s}</li>`).join("")}
      </ol>
    </section>

    <section class="card block">
      <h3>🎯 Мини-тренировка</h3>
      <div id="practiceArea"></div>
    </section>

    <section class="card block hidden" id="checkBlock">
      <h3>✅ Быстрая проверка</h3>
      <div id="checkArea"></div>
    </section>

    <section class="card block hidden" id="summaryBlock">
      <h3>🏁 Итог урока</h3>
      <p>${lesson.summary}</p>
      <div id="lessonResult"></div>
    </section>`;

  startPractice(lesson, t);
}

function toggleSteps() {
  document.getElementById("steps").classList.toggle("hidden");
  const b = document.getElementById("showSteps");
  b.textContent = document.getElementById("steps").classList.contains("hidden")
    ? "Показать решение по шагам" : "Скрыть решение";
}

let practiceState = null;
function startPractice(lesson, topic) {
  practiceState = { lesson, topic, idx: 0, correct: 0 };
  showPracticeTask();
}
function showPracticeTask() {
  const { lesson } = practiceState;
  const task = lesson.practice[practiceState.idx];
  document.getElementById("practiceArea").innerHTML = taskHTML(task, "prac");
}
function answerPractice(taskIdx) {
  const { lesson, topic } = practiceState;
  const task = lesson.practice[practiceState.idx];
  const res = evaluate(task, "prac");
  if (res.correct === null) return;
  recordAnswer(topic.id, res.correct);
  if (res.correct) practiceState.correct++;
  renderFeedback(task, res, "prac", () => {
    practiceState.idx++;
    if (practiceState.idx < lesson.practice.length) {
      showPracticeTask();
    } else {
      runQuickCheck();
    }
  });
  checkAchievements();
}

function runQuickCheck() {
  const { lesson } = practiceState;
  document.getElementById("checkBlock").classList.remove("hidden");
  document.getElementById("checkArea").innerHTML = taskHTML(lesson.check, "chk");
  document.getElementById("checkArea").scrollIntoView({ behavior: "smooth" });
}
function answerCheck() {
  const { lesson, topic } = practiceState;
  const res = evaluate(lesson.check, "chk");
  if (res.correct === null) return;
  recordAnswer(topic.id, res.correct);
  if (res.correct) practiceState.correct++;
  renderFeedback(lesson.check, res, "chk", finishLesson);
  checkAchievements();
}

function finishLesson() {
  const { lesson, topic } = practiceState;
  const totalQ = lesson.practice.length + 1;
  const pct = Math.round((practiceState.correct / totalQ) * 100);
  const firstTime = !state.completedLessons.includes(lesson.id);

  if (firstTime) state.completedLessons.push(lesson.id);
  state.lessonScores[lesson.id] = pct;
  touchStreak();
  scheduleReview(topic.id, 0);

  if (firstTime) addReward(lesson.reward.coins, lesson.reward.stars, 0);
  saveState();
  checkAchievements();

  document.getElementById("summaryBlock").classList.remove("hidden");
  document.getElementById("lessonResult").innerHTML = `
    <div class="result-box">
      <div class="big-emoji">${pct >= 60 ? "🎉" : "💪"}</div>
      <p><b>Твой результат: ${pct}%</b></p>
      <p class="speech">${pct >= 60 ? pifSay("cheer") : "Хорошая попытка! Эту тему добавим в повторение."}</p>
      ${firstTime ? `<p class="reward-line">+${lesson.reward.coins} 🪙 &nbsp; +${lesson.reward.stars} ⭐</p>` : '<p class="muted">Повторное прохождение — награда уже получена.</p>'}
      <div class="result-actions">
        <button class="btn primary" onclick="navigate('map')">К карте 🗺️</button>
        <button class="btn outline" onclick="navigate('trainer',{topicId:'${topic.id}'})">Ещё потренироваться 🎮</button>
      </div>
    </div>`;
  document.getElementById("summaryBlock").scrollIntoView({ behavior: "smooth" });
}

/* ============================================================
   ТРЕНАЖЁР ЗАДАЧ (3 уровня)
   ============================================================ */
function renderTrainer() {
  const t = topicById(route.topicId);
  const autoLvl = adaptiveLevel(t.id);
  app().innerHTML = `
    <section class="card head-card" style="border-top:5px solid ${t.color}">
      <button class="back" onclick="navigate('map')">‹ Назад</button>
      <h1>🎮 Тренажёр: ${t.title}</h1>
      <p class="muted">Выбери уровень сложности</p>
      <div class="level-pick">
        <button class="lvl-btn easy" onclick="startTrainer('${t.id}','easy')">🟢 Лёгкий</button>
        <button class="lvl-btn medium" onclick="startTrainer('${t.id}','medium')">🟡 Средний</button>
        <button class="lvl-btn hard" onclick="startTrainer('${t.id}','hard')">🔴 Сложный</button>
      </div>
      <div class="level-pick">
        <button class="lvl-btn auto" onclick="startTrainer('${t.id}','auto')">🤖 Авто-подбор <small>(${levelLabel(autoLvl)})</small></button>
        <button class="lvl-btn infinite" onclick="startTrainer('${t.id}','infinite')">♾️ Бесконечная практика</button>
      </div>
    </section>
    <div id="trainerArea"></div>`;
}

let trainerState = null;
function startTrainer(topicId, level) {
  const t = topicById(topicId);
  let mode = "fixed";
  if (level === "auto") mode = "auto";
  else if (level === "infinite") mode = "infinite";
  let tasks = [];
  if (mode === "fixed") {
    tasks = (t.trainer[level] || []).slice();
    if (!tasks.length) tasks = [generateTask(topicId, level), generateTask(topicId, level), generateTask(topicId, level)];
  }
  const target = mode === "auto" ? 8 : mode === "infinite" ? Infinity : tasks.length;
  trainerState = { topic: t, level, mode, tasks, target, idx: 0, correct: 0, current: null };
  showTrainerTask();
}
function showTrainerTask() {
  const ts = trainerState;
  if (ts.idx >= ts.target) { finishTrainer(); return; }
  let task, lvlNow = ts.level;
  if (ts.mode === "fixed") {
    task = ts.tasks[ts.idx];
  } else if (ts.mode === "auto") {
    lvlNow = adaptiveLevel(ts.topic.id);
    task = generateTask(ts.topic.id, lvlNow);
  } else { // infinite — лёгкие→сложные по кругу
    lvlNow = ["easy", "medium", "hard"][ts.idx % 3];
    task = generateTask(ts.topic.id, lvlNow);
  }
  ts.current = task; ts.lvlNow = lvlNow;
  const counter = ts.mode === "infinite" ? `Решено: ${ts.correct}` : `Задача ${ts.idx + 1} из ${ts.target}`;
  const stopBtn = ts.mode === "infinite" ? `<button class="btn ghost small" onclick="finishTrainer()">Стоп ⏹</button>` : "";
  document.getElementById("trainerArea").innerHTML = `
    <section class="card block">
      <div class="row-between"><span class="muted">${counter}</span>
        <span class="lvl-tag ${lvlNow}">${levelLabel(lvlNow)}${ts.mode === "auto" ? " 🤖" : ""}</span></div>
      <div id="trTask">${taskHTML(task, "tr")}</div>
      ${stopBtn ? `<div style="text-align:center;margin-top:10px">${stopBtn}</div>` : ""}
    </section>`;
  document.getElementById("trainerArea").scrollIntoView({ behavior: "smooth" });
}
function answerTrainer() {
  const ts = trainerState;
  const task = ts.current;
  const res = evaluate(task, "tr");
  if (res.correct === null) return;
  recordAnswer(ts.topic.id, res.correct);
  if (res.correct) ts.correct++;
  renderFeedback(task, res, "tr", () => { ts.idx++; showTrainerTask(); }, /*offerSimilar*/ true);
  checkAchievements();
  if (res.correct) addReward(2, 0, 0);
}
function finishTrainer() {
  const ts = trainerState;
  const attempted = ts.mode === "infinite" ? ts.idx : ts.target;
  const pct = attempted ? Math.round((ts.correct / attempted) * 100) : 0;
  touchStreak();
  scheduleReview(ts.topic.id, 0);
  saveState();
  checkAchievements();
  document.getElementById("trainerArea").innerHTML = `
    <section class="card block">
      <div class="result-box">
        <div class="big-emoji">${pct >= 60 ? "🏆" : "💪"}</div>
        <p><b>Решено верно: ${ts.correct} из ${attempted} (${pct}%)</b></p>
        <p class="speech">${pct >= 60 ? pifSay("cheer") : "Эту тему добавим в «Слабые места» — повторим и станет легко!"}</p>
        <div class="result-actions">
          <button class="btn primary" onclick="navigate('trainer',{topicId:'${ts.topic.id}'})">Ещё раунд 🔁</button>
          <button class="btn outline" onclick="navigate('map')">К карте 🗺️</button>
        </div>
      </div>
    </section>`;
}

/* ============================================================
   РЕЖИМ «5 МИНУТ»
   ============================================================ */
function buildFivePack() {
  // 5 коротких вопросов из новых тем + 1 мини-задача + 1 на повторение старой темы
  const pool = [];
  TOPICS.forEach(t => t.trainer.easy.concat(t.trainer.medium).forEach(q => pool.push({ q, topicId: t.id })));
  shuffle(pool);
  const quick = pool.slice(0, 5);
  const mini = pool.find(p => p.q.q.length > 30) || pool[5];
  // вопрос на повторение: из пройденной/слабой темы
  const reviewTopic = state.weakTopics[0] || (state.completedLessons.length ? TOPICS[0].id : TOPICS[0].id);
  const rt = topicById(reviewTopic);
  const reviewQ = { q: rt.trainer.easy[0], topicId: rt.id };
  return [...quick, { ...mini, mini: true }, { ...reviewQ, review: true }];
}
let fiveState = null;
function renderFive() {
  fiveState = { pack: buildFivePack(), idx: 0, correct: 0 };
  app().innerHTML = `
    <section class="card head-card">
      <h1>⏱️ Тренировка на 5 минут</h1>
      <p class="muted">7 быстрых заданий, чтобы держать форму каждый день.</p>
    </section>
    <div id="fiveArea"></div>`;
  showFiveTask();
}
function showFiveTask() {
  const fs = fiveState;
  if (fs.idx >= fs.pack.length) { finishFive(); return; }
  const item = fs.pack[fs.idx];
  const tag = item.mini ? "🧩 Мини-задача" : item.review ? "🔁 Повторение" : "⚡ Быстрый вопрос";
  document.getElementById("fiveArea").innerHTML = `
    <section class="card block">
      <div class="row-between"><span class="muted">${fs.idx + 1} / ${fs.pack.length}</span><span class="lvl-tag">${tag}</span></div>
      <div id="fiveTask">${taskHTML(item.q, "fv")}</div>
    </section>`;
}
function answerFive() {
  const fs = fiveState;
  const item = fs.pack[fs.idx];
  const res = evaluate(item.q, "fv");
  if (res.correct === null) return;
  recordAnswer(item.topicId, res.correct);
  if (res.correct) fs.correct++;
  renderFeedback(item.q, res, "fv", () => { fs.idx++; showFiveTask(); });
  checkAchievements();
}
function finishFive() {
  const fs = fiveState;
  state.fiveMinDone = (state.fiveMinDone || 0) + 1;
  touchStreak();
  addReward(8, 1, 0);
  saveState();
  checkAchievements();
  document.getElementById("fiveArea").innerHTML = `
    <section class="card block">
      <div class="result-box">
        <div class="big-emoji">⭐</div>
        <p><b>Готово! ${fs.correct} из ${fs.pack.length} верно.</b></p>
        <p class="reward-line">+8 🪙 &nbsp; +1 ⭐</p>
        <p class="speech">${pifSay("cheer")} Возвращайся завтра — серия растёт! 🔥</p>
        <button class="btn primary" onclick="navigate('home')">На главную 🏠</button>
      </div>
    </section>`;
}

/* ============================================================
   РЕЖИМ «СЛАБЫЕ МЕСТА»
   ============================================================ */
function renderWeak() {
  updateWeakTopics();
  if (!state.weakTopics.length) {
    app().innerHTML = `
      <section class="card head-card"><h1>🎯 Слабые места</h1></section>
      <section class="card empty">
        <div class="big-emoji">🌟</div>
        <p>Пока слабых тем нет — ты молодец!</p>
        <p class="muted">Если где-то будет много ошибок, тема появится здесь, и мы вместе её прокачаем.</p>
        <button class="btn primary" onclick="navigate('map')">К карте</button>
      </section>`;
    return;
  }
  const cards = state.weakTopics.map(id => {
    const t = topicById(id);
    const st = state.topicStats[id] || { correct: 0, wrong: 0 };
    return `
      <section class="card block" style="border-left:5px solid ${t.color}">
        <h3>${t.icon} ${t.title}</h3>
        <p class="muted">Ошибок: ${st.wrong} • Верно: ${st.correct}</p>
        <p>${t.blurb}</p>
        <button class="btn primary" onclick="navigate('trainer',{topicId:'${id}'})">Прокачать тему 🎯</button>
      </section>`;
  }).join("");
  app().innerHTML = `
    <section class="card head-card">
      <h1>🎯 Слабые места</h1>
      <p class="muted">Здесь темы, где пока бывают ошибки. Потренируйся — и они исчезнут!</p>
    </section>${cards}`;
}
function startReview() {
  const r = dueReviews()[0];
  if (r) navigate("trainer", { topicId: r.topicId });
}

/* ============================================================
   ПРОФИЛЬ
   ============================================================ */
function renderProfile() {
  const li = levelInfo();
  const prog = courseProgress();
  const doneTopics = TOPICS.filter(t => topicPercent(state, t.id) === 100);
  const ach = ACHIEVEMENTS.map(a => {
    const got = state.achievements.includes(a.id);
    return `<div class="ach ${got ? "got" : "locked"}" title="${a.desc}">
      <span class="ach-ic">${got ? a.icon : "🔒"}</span>
      <small>${a.title}</small></div>`;
  }).join("");
  const recs = recommendations();

  app().innerHTML = `
    <section class="card profile-head">
      <button class="avatar-big" onclick="openAvatarPicker()" title="Сменить аватар">${state.avatar || "🏎️"}<span class="avatar-edit">✏️</span></button>
      <h1>${escapeHTML(state.name)}</h1>
      <p class="muted">${li.icon} ${li.name} • ${state.grade}</p>
    </section>

    <section class="card">
      <div class="row-between"><strong>Общий прогресс</strong><span class="muted">${prog}%</span></div>
      <div class="progress"><div class="progress-fill" style="width:${prog}%"></div></div>
      <div class="reward-row" style="margin-top:14px">
        <div class="reward-pill">🪙 <b>${state.coins}</b><small>монет</small></div>
        <div class="reward-pill">⭐ <b>${state.stars}</b><small>звёзд</small></div>
        <div class="reward-pill">🔥 <b>${state.streak}</b><small>дней подряд</small></div>
        <div class="reward-pill">🏅 <b>${state.achievements.length}</b><small>наград</small></div>
      </div>
    </section>

    <section class="card">
      <strong>Рекомендации на сегодня</strong>
      <ul class="recs">${recs.map(r => `<li>${r}</li>`).join("")}</ul>
    </section>

    <section class="card">
      <strong>Пройденные темы (${doneTopics.length}/${TOPICS.length})</strong>
      <div class="chips">${TOPICS.map(t => `<span class="chip ${topicPercent(state,t.id)===100?'on':''}">${t.icon} ${t.title}</span>`).join("")}</div>
    </section>

    ${state.weakTopics.length ? `<section class="card">
      <strong>Слабые темы</strong>
      <div class="chips">${state.weakTopics.map(id=>`<span class="chip warn">${topicById(id).icon} ${topicById(id).title}</span>`).join("")}</div>
    </section>` : ""}

    <section class="card">
      <strong>Достижения</strong>
      <div class="ach-grid">${ach}</div>
    </section>

    <section class="card">
      <strong>👦 Профили детей</strong>
      <div class="profiles">
        ${Object.values(store.profiles).map(p => `
          <button class="profile-item ${p.id === state.id ? "active" : ""}" onclick="switchProfile('${p.id}')">
            <span class="pi-av">${p.avatar || "🙂"}</span>
            <span class="pi-name">${escapeHTML(p.name)}<small>${escapeHTML(p.grade)}</small></span>
            ${p.id === state.id ? '<span class="pi-cur">✓</span>' : ""}
          </button>`).join("")}
      </div>
      <button class="btn outline" onclick="addProfilePrompt()">➕ Добавить ребёнка</button>
    </section>

    <section class="card">
      <strong>⚙️ Настройки</strong>
      <label class="switch-row">
        <span>🔊 Озвучка объяснений</span>
        <input type="checkbox" ${settings.audio ? "checked" : ""} onchange="toggleAudio()">
      </label>
      <label class="switch-row">
        <span>🔓 Открыть все острова сразу</span>
        <input type="checkbox" ${settings.unlockMode === "open" ? "checked" : ""} onchange="toggleUnlock()">
      </label>
    </section>

    <section class="card">
      <strong>☁️ Перенос прогресса на другое устройство</strong>
      <p class="muted">Скопируй код и вставь его на другом устройстве — прогресс переедет.</p>
      <button class="btn outline" onclick="showExport()">📤 Получить код</button>
      <button class="btn outline" onclick="showImport()">📥 Ввести код</button>
    </section>

    ${cloudSection()}

    <section class="card">
      <strong>Для родителей и учителя</strong>
      <button class="btn outline" onclick="navigate('parent')">Открыть отчёт 👨‍👩‍👧</button>
      <button class="btn ghost danger" onclick="resetProgress()">Сбросить прогресс</button>
    </section>`;
}

function toggleUnlock() { settings.unlockMode = settings.unlockMode === "open" ? "sequential" : "open"; saveSettings(); }

function addProfilePrompt() {
  const name = prompt("Имя ребёнка:");
  if (name === null) return;
  const grade = prompt("Класс:", "2 класс");
  if (grade === null) return;
  createProfile(name, grade);
}
function showExport() {
  const code = exportCode();
  showSheet(`<div class="sheet-body">
    <h3>📤 Код прогресса</h3>
    <p class="muted">Скопируй этот код и введи его в приложении на другом устройстве.</p>
    <textarea class="code-area" readonly onclick="this.select()">${code}</textarea>
    <button class="btn primary big" onclick="navigator.clipboard && navigator.clipboard.writeText('${code}');this.textContent='Скопировано ✅'">Скопировать</button>
  </div>`);
}
function showImport() {
  showSheet(`<div class="sheet-body">
    <h3>📥 Ввести код прогресса</h3>
    <p class="muted">Вставь код с другого устройства. Создастся новый профиль с этим прогрессом.</p>
    <textarea class="code-area" id="importArea" placeholder="Вставь код сюда"></textarea>
    <button class="btn primary big" onclick="doImport()">Загрузить прогресс</button>
  </div>`);
}
function doImport() {
  const code = document.getElementById("importArea").value;
  if (importCode(code)) { closeSheet(); navigate("home"); }
  else alert("Не получилось прочитать код. Проверь, что скопировал его целиком.");
}

function recommendations() {
  const r = [];
  if (state.weakTopics.length) r.push(`Повторить тему «${topicById(state.weakTopics[0]).title}» в режиме «Слабые места».`);
  const nl = findNextLesson();
  if (nl) r.push(`Пройти урок «${nl.lesson.title}».`);
  if (state.streak === 0 || state.lastActive !== today()) r.push("Сделать тренировку на 5 минут, чтобы продолжить серию.");
  if (!r.length) r.push("Ты молодец! Можно пройти «Финал сезона» для закрепления.");
  return r;
}

/* ============================================================
   РОДИТЕЛЬСКИЙ / УЧИТЕЛЬСКИЙ РЕЖИМ
   ============================================================ */
function renderParent() {
  const rows = TOPICS.map(t => {
    const st = state.topicStats[t.id] || { correct: 0, wrong: 0 };
    const pct = topicPercent(state, t.id);
    const total = st.correct + st.wrong;
    const acc = total ? Math.round((st.correct / total) * 100) : null;
    let status = "—";
    if (acc !== null) status = acc >= 75 ? "😀 легко" : acc >= 50 ? "🙂 нормально" : "🤔 трудно";
    return `<tr>
      <td>${t.icon} ${t.title}</td>
      <td>${pct}%</td>
      <td>${total ? st.correct + "/" + total : "—"}</td>
      <td>${status}</td></tr>`;
  }).join("");

  const easy = TOPICS.filter(t => { const s = state.topicStats[t.id]; const tot = s ? s.correct + s.wrong : 0; return tot && s.correct / tot >= 0.75; });
  const hard = state.weakTopics.map(topicById);

  const allProfiles = Object.values(store.profiles);
  const classBlock = allProfiles.length > 1 ? `
    <section class="card">
      <strong>👨‍🏫 Кабинет: все дети (${allProfiles.length})</strong>
      <p class="muted">Нажми на ребёнка, чтобы открыть его отчёт.</p>
      <table class="ptable">
        <tr><th>Ребёнок</th><th>Уроки</th><th>Верно</th><th>Серия</th></tr>
        ${allProfiles.map(p => {
          const tot = p.totalCorrect + p.totalWrong;
          const acc = tot ? Math.round(p.totalCorrect / tot * 100) : 0;
          return `<tr class="clickable-row" onclick="switchProfile('${p.id}');navigate('parent')">
            <td>${p.avatar || "🙂"} ${escapeHTML(p.name)} ${p.id === state.id ? "<small>(сейчас)</small>" : ""}</td>
            <td>${p.completedLessons.length}</td><td>${tot ? acc + "%" : "—"}</td><td>🔥 ${p.streak}</td></tr>`;
        }).join("")}
      </table>
    </section>` : "";

  app().innerHTML = `
    <section class="card head-card">
      <button class="back" onclick="navigate('profile')">‹ Назад</button>
      <h1>👨‍👩‍👧 Отчёт для взрослых</h1>
      <p class="muted">Ученик: <b>${escapeHTML(state.name)}</b> • ${state.grade}</p>
    </section>
    ${classBlock}
    <section class="card">
      <div class="reward-row">
        <div class="reward-pill"><b>${state.completedLessons.length}</b><small>уроков пройдено</small></div>
        <div class="reward-pill"><b>${state.totalCorrect + state.totalWrong}</b><small>задач решено</small></div>
        <div class="reward-pill"><b>${accuracy()}%</b><small>верных ответов</small></div>
        <div class="reward-pill"><b>${state.streak}</b><small>дней подряд</small></div>
      </div>
    </section>

    <section class="card">
      <strong>По темам</strong>
      <table class="ptable">
        <tr><th>Тема</th><th>Пройдено</th><th>Верно</th><th>Как даётся</th></tr>
        ${rows}
      </table>
    </section>

    <section class="card">
      <strong>Что даётся легко</strong>
      <p>${easy.length ? easy.map(t => t.title).join(", ") : "Пока копим данные."}</p>
      <strong>Что вызывает трудности</strong>
      <p>${hard.length ? hard.map(t => t.title).join(", ") : "Явных трудностей нет."}</p>
    </section>

    <section class="card">
      <strong>Рекомендации</strong>
      <ul class="recs">
        ${(hard.length ? hard.map(t => `<li>Повторить «${t.title}»: короткое объяснение + 3–5 задач.</li>`) : ["<li>Поддерживать ежедневную привычку: режим «5 минут».</li>"]).join("")}
      </ul>
    </section>`;
}
function accuracy() {
  const tot = state.totalCorrect + state.totalWrong;
  return tot ? Math.round((state.totalCorrect / tot) * 100) : 0;
}

/* ============================================================
   ОБЩИЙ РЕНДЕР ЗАДАЧ И ПРОВЕРКА
   ============================================================ */
function levelLabel(l) { return { easy: "🟢 Лёгкий", medium: "🟡 Средний", hard: "🔴 Сложный" }[l] || ""; }

/* Уникальный input id по контексту (prac/chk/tr/fv) */
function answerHandler(ctx) {
  return { prac: "answerPractice()", chk: "answerCheck()", tr: "answerTrainer()", fv: "answerFive()" }[ctx];
}

function taskHTML(task, ctx) {
  let input = "";
  if (task.type === "choice") {
    input = `<div class="options">` + task.options.map((o, i) =>
      `<label class="opt"><input type="radio" name="${ctx}_opt" value="${escapeAttr(o)}"> <span>${o}</span></label>`).join("") + `</div>`;
  } else if (task.type === "truefalse") {
    input = `<div class="options">
      <label class="opt"><input type="radio" name="${ctx}_opt" value="верно"> <span>✅ Верно</span></label>
      <label class="opt"><input type="radio" name="${ctx}_opt" value="неверно"> <span>❌ Неверно</span></label>
    </div>`;
  } else if (task.type === "match") {
    // сопоставление: для каждого левого — выпадающий список правых
    const rights = shuffle(task.pairs.map(p => p[1]));
    input = `<div class="match">` + task.pairs.map((p, i) => `
      <div class="match-row">
        <span class="match-left">${p[0]}</span>
        <span class="match-arrow">→</span>
        <select class="match-sel" id="${ctx}_m${i}">
          <option value="">— выбери —</option>
          ${rights.map(r => `<option value="${escapeAttr(r)}">${r}</option>`).join("")}
        </select>
      </div>`).join("") + `</div>`;
  } else if (task.type === "fill") {
    // задача с пропуском: показываем фразу, пропуск ___ заменяем полем
    const parts = String(task.q).split("___");
    input = `<p class="q fill-q">${parts[0] || ""}<input class="fill-input" id="${ctx}_input"
              autocomplete="off" onkeydown="if(event.key==='Enter'){${answerHandler(ctx)}}">${parts[1] || ""}</p>`;
  } else { // number / text input
    input = `<input class="num-input" id="${ctx}_input" inputmode="numeric" placeholder="Твой ответ"
              onkeydown="if(event.key==='Enter'){${answerHandler(ctx)}}">`;
  }
  const qLine = task.type === "fill" ? "" : `<p class="q">${task.q} ${speakBtn(task.q)}</p>`;
  return `
    ${qLine}
    ${input}
    <div class="task-actions">
      <button class="btn ghost" onclick="showHint('${ctx}','${escapeAttr(task.hint || "Подумай ещё разок!")}')">💡 Подсказка</button>
      <button class="btn primary" onclick="${answerHandler(ctx)}">Проверить</button>
    </div>
    <div class="hint hidden" id="${ctx}_hint"></div>
    <div class="feedback hidden" id="${ctx}_fb"></div>`;
}

function getAnswer(task, ctx) {
  if (task.type === "choice" || task.type === "truefalse") {
    const el = document.querySelector(`input[name="${ctx}_opt"]:checked`);
    return el ? el.value : null;
  }
  if (task.type === "match") {
    const chosen = task.pairs.map((p, i) => {
      const sel = document.getElementById(`${ctx}_m${i}`);
      return sel ? sel.value : "";
    });
    return chosen.some(c => c === "") ? null : chosen;
  }
  const el = document.getElementById(`${ctx}_input`);
  return el ? el.value.trim() : null;
}
function evaluate(task, ctx) {
  const given = getAnswer(task, ctx);
  if (given === null || given === "") {
    flashNeedAnswer(ctx);
    return { correct: null };
  }
  const norm = s => String(s).toLowerCase().replace(",", ".").replace(/\s+/g, "");
  if (task.type === "match") {
    const correct = task.pairs.every((p, i) => norm(given[i]) === norm(p[1]));
    return { correct, given };
  }
  const correct = norm(given) === norm(task.answer);
  return { correct, given };
}
function flashNeedAnswer(ctx) {
  const fb = document.getElementById(`${ctx}_fb`);
  if (fb) { fb.className = "feedback warn"; fb.textContent = "Сначала выбери или впиши ответ 🙂"; }
}

function showHint(ctx, hint) {
  const el = document.getElementById(`${ctx}_hint`);
  el.classList.remove("hidden");
  el.innerHTML = `<span class="mascot-mini">${mascotSVG(true)}</span> ${hint}`;
}

function renderFeedback(task, res, ctx, onNext, offerSimilar = false) {
  const fb = document.getElementById(`${ctx}_fb`);
  fb.classList.remove("hidden");
  const correctAnswer = task.type === "match"
    ? task.pairs.map(p => `${p[0]} → ${p[1]}`).join("; ")
    : task.answer;
  if (res.correct) {
    const cheer = pifSay("cheer");
    burstConfetti();
    speak(cheer);
    fb.className = "feedback ok";
    fb.innerHTML = `<b>✅ Верно!</b> ${cheer} <br><small>${task.explain || ""}</small>
      <div class="task-actions"><button class="btn primary" id="${ctx}_next">Дальше ›</button></div>`;
  } else {
    const oops = pifSay("oops");
    speak(oops);
    fb.className = "feedback bad";
    fb.innerHTML = `<b>${oops}</b>
      <p>Правильный ответ: <b>${correctAnswer}</b>.</p>
      <p class="explain">${task.explain || ""}</p>
      ${offerSimilar ? `<p class="muted">Похожая задача появится в тренажёре — закрепим!</p>` : ""}
      <div class="task-actions"><button class="btn primary" id="${ctx}_next">Понятно, дальше ›</button></div>`;
  }
  // привязываем next надёжно (без зависимости от имени функции)
  const nextBtn = document.getElementById(`${ctx}_next`);
  if (nextBtn) nextBtn.onclick = () => onNext();
  // блокируем повторную проверку
  fb.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ============================================================
   ВСПЛЫВАШКИ (sheet / toast)
   ============================================================ */
function showSheet(html) {
  let s = document.getElementById("sheet");
  s.innerHTML = `<div class="sheet-backdrop" onclick="closeSheet()"></div>
    <div class="sheet-panel">${html}<button class="sheet-close" onclick="closeSheet()">✕</button></div>`;
  s.classList.add("open");
}
function closeSheet() { document.getElementById("sheet").classList.remove("open"); }

function showAchievementToast(list) {
  const t = document.getElementById("toast");
  t.innerHTML = list.map(a => `<div class="toast-card"><span class="t-ic">${a.icon}</span>
    <div><b>Новая награда!</b><br>${a.title}</div></div>`).join("");
  t.classList.add("show");
  burstConfetti(true);
  setTimeout(() => t.classList.remove("show"), 3500);
}

/* ----------  Анимация наград: конфетти  ---------- */
function burstConfetti(big = false) {
  const layer = document.getElementById("confetti");
  if (!layer) return;
  const colors = ["#34c759", "#0a84ff", "#ff9500", "#bf5af2", "#ff375f", "#ffd60a"];
  const n = big ? 40 : 18;
  for (let i = 0; i < n; i++) {
    const p = document.createElement("i");
    p.className = "confetti-piece";
    p.style.left = (40 + Math.random() * 20) + "%";
    p.style.background = colors[i % colors.length];
    p.style.setProperty("--dx", (Math.random() * 240 - 120) + "px");
    p.style.setProperty("--dy", (160 + Math.random() * 220) + "px");
    p.style.setProperty("--rot", (Math.random() * 720 - 360) + "deg");
    p.style.animationDelay = (Math.random() * 0.15) + "s";
    layer.appendChild(p);
    setTimeout(() => p.remove(), 1400);
  }
}

/* ============================================================
   МАСКОТ ПИФ (SVG)
   ============================================================ */
function mascotSVG(small = false) {
  const s = small ? 34 : 72;
  return `<svg width="${s}" height="${s}" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg" aria-label="Пиф">
    <circle cx="36" cy="38" r="26" fill="#34c759"/>
    <circle cx="36" cy="38" r="26" fill="url(#g)" opacity="0.15"/>
    <ellipse cx="36" cy="46" rx="18" ry="14" fill="#eafff0"/>
    <circle cx="28" cy="34" r="7" fill="#fff"/><circle cx="44" cy="34" r="7" fill="#fff"/>
    <circle cx="29" cy="35" r="3.4" fill="#1b1b2f"/><circle cx="43" cy="35" r="3.4" fill="#1b1b2f"/>
    <circle cx="30" cy="34" r="1.1" fill="#fff"/><circle cx="44" cy="34" r="1.1" fill="#fff"/>
    <path d="M30 46 q6 6 12 0" stroke="#1b1b2f" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <path d="M14 22 l10 6 M58 22 l-10 6" stroke="#2aa14b" stroke-width="3" stroke-linecap="round"/>
    <!-- кепка гонщика -->
    <path d="M16 26 q20 -20 40 0 z" fill="#0a84ff"/>
    <rect x="14" y="24" width="18" height="5" rx="2" fill="#0a84ff"/>
    <circle cx="36" cy="16" r="3" fill="#ffd60a"/>
    <defs><radialGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient></defs>
  </svg>`;
}

/* ============================================================
   ХЕЛПЕРЫ
   ============================================================ */
function topicById(id) { return TOPICS.find(t => t.id === id); }
function escapeHTML(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function escapeAttr(s) { return escapeHTML(s).replace(/'/g, "&#39;"); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function resetProgress() {
  if (confirm("Сбросить прогресс текущего ребёнка? Это нельзя отменить.")) {
    const fresh = defaultState(state.name, state.grade);
    fresh.avatar = state.avatar; fresh.onboarded = true; fresh.id = state.id;
    store.profiles[state.id] = fresh; state = fresh;
    saveState();
    navigate("home");
  }
}

/* ============================================================
   ОБЛАКО (Firebase) — UI и обработчики
   ============================================================ */
function cloudSection() {
  if (!window.Cloud) return "";
  if (!Cloud.configured) {
    return `<section class="card">
      <strong>☁️ Облако (Firebase)</strong>
      <p class="muted">Чтобы прогресс синхронизировался между устройствами через интернет, заполни свои данные Firebase в файле <b>js/firebase-config.js</b> (инструкция внутри файла). Пока этого нет — можно пользоваться переносом по коду выше.</p>
    </section>`;
  }
  if (Cloud.status === "error") {
    return `<section class="card">
      <strong>☁️ Облако (Firebase)</strong>
      <p class="muted">⚠️ ${escapeHTML(Cloud.lastError || "Ошибка подключения")}</p>
    </section>`;
  }
  if (!Cloud.ready) {
    return `<section class="card"><strong>☁️ Облако (Firebase)</strong><p class="muted">Подключаемся…</p></section>`;
  }
  if (Cloud.user) {
    return `<section class="card">
      <strong>☁️ Облако (Firebase)</strong>
      <p>Вы вошли как <b>${escapeHTML(Cloud.user.email || "пользователь")}</b>. Прогресс сохраняется автоматически.</p>
      ${cloudLastSync ? `<p class="muted">Последняя синхронизация: ${cloudLastSync.toLocaleTimeString()}</p>` : ""}
      <button class="btn outline" onclick="cloudSyncNow()">🔄 Синхронизировать сейчас</button>
      <button class="btn ghost" onclick="cloudSignOut()">Выйти из облака</button>
    </section>`;
  }
  return `<section class="card">
    <strong>☁️ Облако (Firebase)</strong>
    <p class="muted">Войди, чтобы прогресс сохранялся в облаке и был на всех устройствах.</p>
    <label class="field">Эл. почта<input id="cl-email" type="email" placeholder="email@example.com"></label>
    <label class="field">Пароль<input id="cl-pass" type="password" placeholder="не меньше 6 символов"></label>
    <div class="task-actions">
      <button class="btn primary" onclick="cloudSignIn()">Войти</button>
      <button class="btn outline" onclick="cloudSignUp()">Регистрация</button>
    </div>
    <div id="cl-msg" class="muted"></div>
  </section>`;
}
function cloudMsg(text, bad) {
  const el = document.getElementById("cl-msg");
  if (el) { el.textContent = text; el.style.color = bad ? "var(--bad)" : "var(--muted)"; }
}
function cloudCreds() {
  return { email: (document.getElementById("cl-email") || {}).value || "", pass: (document.getElementById("cl-pass") || {}).value || "" };
}
async function cloudSignIn() {
  const { email, pass } = cloudCreds();
  cloudMsg("Входим…");
  try { await Cloud.signIn(email.trim(), pass); }
  catch (e) { cloudMsg(cloudErr(e), true); }
}
async function cloudSignUp() {
  const { email, pass } = cloudCreds();
  if (pass.length < 6) { cloudMsg("Пароль должен быть не короче 6 символов.", true); return; }
  cloudMsg("Создаём аккаунт…");
  try { await Cloud.signUp(email.trim(), pass); }
  catch (e) { cloudMsg(cloudErr(e), true); }
}
async function cloudSignOut() { try { await Cloud.signOut(); } catch (e) {} renderProfile(); }
async function cloudSyncNow() {
  try { await Cloud.push(store); cloudLastSync = new Date(); renderProfile(); }
  catch (e) { alert("Не удалось синхронизировать: " + cloudErr(e)); }
}
function cloudErr(e) {
  const m = (e && e.message) || "";
  if (/password/i.test(m)) return "Неверный пароль.";
  if (/user-not-found|invalid-credential/i.test(m)) return "Пользователь не найден или неверные данные.";
  if (/email-already/i.test(m)) return "Эта почта уже зарегистрирована — нажми «Войти».";
  if (/invalid-email/i.test(m)) return "Проверь адрес почты.";
  return m || "Ошибка.";
}

/* Срабатывает при входе/выходе из облака */
window.onCloudChange = async function (user) {
  if (user) {
    try {
      const cloudData = await Cloud.pull();
      if (cloudData && cloudData.store && cloudData.store.profiles) {
        store = mergeStores(store, cloudData.store);
        state = store.profiles[store.activeId] || store.profiles[Object.keys(store.profiles)[0]];
        localStorage.setItem(STORE_KEY, JSON.stringify(store));
      }
      await Cloud.push(store);
      cloudLastSync = new Date();
    } catch (e) { /* ignore */ }
  }
  refreshTopBar();
  if (route.view === "profile") renderProfile();
};

/* ----------  Старт  ---------- */
window.addEventListener("DOMContentLoaded", () => {
  if (state.onboarded) touchStreak();
  obAvatar = state.avatar || "🏎️";
  render();
  if (window.Cloud) Cloud.init();
});
