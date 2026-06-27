/* ============================================================
   ГЕНЕРАТОР ЗАДАЧ  «Бесконечная практика»
   Создаёт случайные задачи в нужном диапазоне для каждой темы.
   Возвращает объект задачи того же формата, что и в data.js.
   ============================================================ */
function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const CAR_THINGS = ["машин", "колёс", "мячей", "лунок", "литров", "очков"];

const GENERATORS = {
  /* Старт сезона: сложение/вычитание до 20 */
  start(level) {
    const max = level === "easy" ? 10 : level === "medium" ? 20 : 20;
    if (Math.random() < 0.5) {
      const a = rnd(2, max), b = rnd(1, max - a < 1 ? 1 : max - a);
      return numTask(`${a} + ${b} = ?`, a + b, `Прибавь ${b} к ${a}.`, `${a} + ${b} = ${a + b}.`);
    }
    const a = rnd(5, max), b = rnd(1, a);
    return numTask(`${a} − ${b} = ?`, a - b, `От ${a} убери ${b}.`, `${a} − ${b} = ${a - b}.`);
  },

  /* Первая сотня: сложение/вычитание до 100, сравнение */
  hundred(level) {
    if (level !== "easy" && Math.random() < 0.3) {
      const a = rnd(10, 99), b = rnd(10, 99);
      const ans = a > b ? ">" : a < b ? "<" : "=";
      return { type: "choice", q: `Какой знак: ${a} ... ${b} ?`, options: [">", "<", "="], answer: ans,
        hint: "Сравни сначала десятки.", explain: `${a} ${ans} ${b}.` };
    }
    const step = level === "easy" ? 10 : 1;
    if (Math.random() < 0.5) {
      const a = rnd(2, 6) * (level === "easy" ? 10 : 1) + (level === "easy" ? 0 : rnd(0, 40));
      const b = rnd(1, 9) * (level === "easy" ? 10 : 1) + (level === "easy" ? 0 : rnd(0, 30));
      return numTask(`${a} + ${b} = ?`, a + b, "Складывай десятки с десятками, единицы с единицами.", `${a} + ${b} = ${a + b}.`);
    }
    const a = rnd(40, 99), b = rnd(10, a);
    return numTask(`${a} − ${b} = ?`, a - b, "Вычитай десятки и единицы по отдельности.", `${a} − ${b} = ${a - b}.`);
  },

  /* Гонка с иксом: уравнения */
  x(level) {
    const max = level === "easy" ? 10 : level === "medium" ? 30 : 50;
    const kind = pick(["add1", "add2", "sub_min", "sub_subtr"]);
    if (kind === "add1" || kind === "add2") {
      const x = rnd(1, max), b = rnd(1, max);
      const left = kind === "add1" ? `х + ${b}` : `${b} + х`;
      return numTask(`${left} = ${x + b}. Чему равен х?`, x, `${x + b} − ${b}.`, `х = ${x + b} − ${b} = ${x}.`);
    }
    if (kind === "sub_min") { // х − b = c
      const xx = rnd(max, max + 30), bb = rnd(1, max), cc = xx - bb;
      return numTask(`х − ${bb} = ${cc}. Чему равен х?`, xx, `${cc} + ${bb}.`, `х = ${cc} + ${bb} = ${xx}.`);
    }
    // a − х = c
    const a = rnd(max, max + 30), x = rnd(1, a), c = a - x;
    return numTask(`${a} − х = ${c}. Чему равен х?`, x, `${a} − ${c}.`, `х = ${a} − ${c} = ${x}.`);
  },

  /* Турбо-умножение: таблица, увеличить/уменьшить в раз */
  mult(level) {
    const maxFactor = level === "easy" ? 5 : level === "medium" ? 7 : 9;
    const r = Math.random();
    if (r < 0.5) {
      const a = rnd(2, maxFactor), b = rnd(2, maxFactor);
      return numTask(`${a} × ${b} = ?`, a * b, `По ${a} ${b} раз(а).`, `${a} × ${b} = ${a * b}.`);
    }
    if (r < 0.8) {
      const b = rnd(2, maxFactor), q = rnd(2, maxFactor), a = b * q;
      return numTask(`${a} : ${b} = ?`, q, `Сколько раз по ${b} в ${a}?`, `${a} : ${b} = ${q}.`);
    }
    const n = rnd(2, 10), k = rnd(2, maxFactor);
    if (Math.random() < 0.5) return numTask(`Увеличь ${n} в ${k} раза(раз).`, n * k, `${n} × ${k}.`, `${n} × ${k} = ${n * k}.`);
    const big = n * k;
    return numTask(`Уменьши ${big} в ${k} раза(раз).`, n, `${big} : ${k}.`, `${big} : ${k} = ${n}.`);
  },

  /* Приборная панель: меры */
  measures(level) {
    const kind = pick(["hour", "len", "weight"]);
    if (kind === "hour") { const h = rnd(1, level === "hard" ? 6 : 4); return numTask(`${h} ч — сколько минут?`, h * 60, `${h} × 60.`, `${h} × 60 = ${h * 60} мин.`); }
    if (kind === "len") { const m = rnd(1, level === "hard" ? 9 : 5); return numTask(`${m} м — сколько см?`, m * 100, `${m} × 100.`, `${m} м = ${m * 100} см.`); }
    const kg = rnd(1, level === "hard" ? 9 : 4); return numTask(`${kg} кг — сколько граммов?`, kg * 1000, `${kg} × 1000.`, `${kg} кг = ${kg * 1000} г.`);
  },

  /* Финал: смешанные */
  final(level) {
    const t = pick(["mult", "hundred", "x", "measures"]);
    return GENERATORS[t](level);
  }
};

function numTask(q, answer, hint, explain) {
  return { type: "number", q, answer: String(answer), hint, explain, generated: true };
}

/* Публичная функция */
function generateTask(topicId, level) {
  const gen = GENERATORS[topicId] || GENERATORS.start;
  const t = gen(level);
  t.id = "gen_" + Math.random().toString(36).slice(2, 8);
  return t;
}
