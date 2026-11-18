"use strict";

const DATA_URL = "dane_studenci.json";
const RATINGS_KEY = "kns_ratings_v1";
const PAGE_SIZE = 10;

const state = {
  loaded: false,
  universities: [],
  records: [],
  uniPage: 1,
  majPage: 1,
  majFilters: { q: "", city: "", woj: "", uni: "", deg: "" },
  rankTab: "majors",
  mapTab: "woj",
  selectedRegion: null,
  rating: 0,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const collator = new Intl.Collator("pl", { sensitivity: "base" });
const fmt = new Intl.NumberFormat("pl-PL");

const pick = (obj, keys, fallback = "") => {
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  return fallback;
};

const toNum = (v) => {
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

function normaliseRecord(r) {
  return {
    uczelnia: String(pick(r, ["uczelnia", "nazwa_uczelni", "university", "nazwa"])).trim(),
    miasto: String(pick(r, ["miasto", "city"])).trim(),
    wojewodztwo: String(pick(r, ["wojewodztwo", "województwo", "region"])).trim(),
    kierunek: String(pick(r, ["kierunek_studiów", "kierunek", "nazwa_kierunku", "major"])).trim(),
    stopien: String(pick(r, ["rodzaj_studiów", "stopien", "stopień", "poziom", "degree"])).trim(),
    studenci: toNum(pick(r, ["wartość", "studenci", "liczba_studentow", "liczba_studentów", "students"], 0)),
  };
}

function normaliseUniversity(u) {
  return {
    nazwa: String(pick(u, ["nazwa", "uczelnia", "nazwa_uczelni", "name"])).trim(),
    miasto: String(pick(u, ["miasto", "city"])).trim(),
    wojewodztwo: String(pick(u, ["wojewodztwo", "województwo", "region"])).trim(),
    studenci: toNum(pick(u, ["liczba_studentow", "liczba_studentów", "studenci", "students"], 0)),
  };
}

function aggregateUniversities(records) {
  const map = new Map();
  for (const r of records) {
    if (!r.uczelnia) continue;
    const key = `${r.uczelnia}|${r.miasto}`;
    const u = map.get(key) || { nazwa: r.uczelnia, miasto: r.miasto, wojewodztwo: r.wojewodztwo, studenci: 0 };
    u.studenci += r.studenci;
    map.set(key, u);
  }
  return [...map.values()];
}

async function loadData() {
  try {
    const res = await fetch(DATA_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    const rawRecords = Array.isArray(json) ? json : json.kierunki || json.records || [];
    state.records = rawRecords.map(normaliseRecord).filter((r) => r.uczelnia || r.kierunek);

    const rawUnis = !Array.isArray(json) && Array.isArray(json.uczelnie) ? json.uczelnie : null;
    state.universities = rawUnis
      ? rawUnis.map(normaliseUniversity).filter((u) => u.nazwa)
      : aggregateUniversities(state.records);

    state.loaded = state.universities.length > 0 || state.records.length > 0;
  } catch (err) {
    console.error("Błąd podczas ładowania danych:", err);
    state.loaded = false;
  }
}

const unique = (arr) => [...new Set(arr.filter(Boolean))].sort(collator.compare);

function fillSelect(select, values, placeholder) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = "";
  select.append(new Option(placeholder, ""));
  values.forEach((v) => select.append(new Option(v, v)));
  if (values.includes(current)) select.value = current;
}

function fillDatalist(list, values) {
  if (!list) return;
  list.replaceChildren(...values.map((value) => {
    const option = document.createElement("option");
    option.value = value;
    return option;
  }));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function renderPager(name, page, total, onChange) {
  const el = $(`[data-pager="${name}"]`);
  if (!el) return 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  el.innerHTML = `
    <span>Strona ${page} z ${pages}</span>
    <div class="pager-btns">
      <button type="button" data-p="${page - 1}" aria-label="Poprzednia strona" ${page <= 1 ? "disabled" : ""}><svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>
      <button type="button" aria-current="page" disabled style="opacity:1;cursor:default">${page}</button>
      <button type="button" data-p="${page + 1}" aria-label="Następna strona" ${page >= pages ? "disabled" : ""}><svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button>
    </div>`;
  $$("button[data-p]", el).forEach((b) => b.addEventListener("click", () => onChange(Number(b.dataset.p))));
  return pages;
}

function rankingMarkup(items, unit = "studentów") {
  const max = Math.max(1, ...items.map((i) => i.value));
  return items
    .map(
      (it, idx) => `
      <li class="rank-item">
        <span class="rank-pos">${idx + 1}</span>
        <div class="rank-main">
          <p class="rank-name" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</p>
          ${it.meta ? `<p class="rank-meta">${escapeHtml(it.meta)}</p>` : ""}
        </div>
        <div class="rank-bar" role="img" aria-label="${escapeHtml(it.name)}: ${fmt.format(it.value)} ${unit}"><span aria-hidden="true" style="height:${(it.value / max) * 100}%"></span></div>
        <span class="rank-value" title="${unit}">${fmt.format(it.value)}</span>
      </li>`
    )
    .join("");
}

function topMajors(limit) {
  const totals = new Map();
  for (const r of state.records) {
    if (!r.kierunek) continue;
    totals.set(r.kierunek, (totals.get(r.kierunek) || 0) + r.studenci);
  }
  return [...totals.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function renderAlerts() {
  const tpl = $("#alert-template");
  $$(".data-alert").forEach((el) => {
    el.hidden = state.loaded;
    if (!state.loaded && tpl && !el.childElementCount) el.append(tpl.content.cloneNode(true));
  });
}

function renderStats() {
  if (!state.loaded) return;
  const students = state.universities.reduce((s, u) => s + u.studenci, 0);
  if ($("#stat-uni")) $("#stat-uni").textContent = fmt.format(state.universities.length);
  if ($("#stat-students")) $("#stat-students").textContent = fmt.format(students);
  if ($("#stat-majors")) $("#stat-majors").textContent = fmt.format(unique(state.records.map((r) => r.kierunek)).length);
  if ($("#uni-sub")) $("#uni-sub").textContent = `${fmt.format(state.universities.length)} uczelni w zbiorze`;

  const top3 = topMajors(3);
  const top3List = $("#top3-list");
  if (top3List) {
    top3List.classList.add("rank-chart");
    top3List.innerHTML = rankingMarkup(top3);
  }
  if ($("#top3-empty")) $("#top3-empty").hidden = top3.length > 0;
}

function initUniversities() {
  const q = $("#uni-q"), woj = $("#uni-woj"), city = $("#uni-city"), sort = $("#uni-sort");
  if (!q || !woj || !city || !sort) return;

  fillSelect(woj, unique(state.universities.map((u) => u.wojewodztwo)), "Wszystkie");
  const refreshCities = () => {
    const src = woj.value ? state.universities.filter((u) => u.wojewodztwo === woj.value) : state.universities;
    fillDatalist($("#uni-city-options"), unique(src.map((u) => u.miasto)));
  };
  refreshCities();

  const update = () => { state.uniPage = 1; renderUniversities(); };
  q.addEventListener("input", update);
  woj.addEventListener("change", () => { refreshCities(); update(); });
  city.addEventListener("input", update);
  sort.addEventListener("change", update);
  
  const clearBtn = $("#uni-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      q.value = ""; woj.value = ""; city.value = ""; refreshCities(); sort.value = "name-asc"; update();
    });
  }

  const heroSearch = $("#hero-search");
  if (heroSearch) {
    const heroInput = $("#hero-search-input");
    const syncHeroSearch = () => {
      if (heroInput) q.value = heroInput.value.trim();
      update();
    };
    heroInput?.addEventListener("input", syncHeroSearch);
    heroSearch.addEventListener("submit", (e) => {
      e.preventDefault();
      syncHeroSearch();
      q.closest(".card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  renderUniversities();
}

function renderUniversities() {
  const qEl = $("#uni-q"), wojEl = $("#uni-woj"), cityEl = $("#uni-city"), sortEl = $("#uni-sort");
  if (!qEl || !wojEl || !cityEl || !sortEl) return;

  const q = qEl.value.trim().toLowerCase();
  const woj = wojEl.value, city = cityEl.value, sort = sortEl.value;

  let list = state.universities.filter(
    (u) => (!q || u.nazwa.toLowerCase().includes(q)) && (!woj || u.wojewodztwo === woj) &&
      (!city || u.miasto.toLocaleLowerCase("pl-PL").includes(city.toLocaleLowerCase("pl-PL")))
  );
  const sorters = {
    "name-asc": (a, b) => collator.compare(a.nazwa, b.nazwa),
    "name-desc": (a, b) => collator.compare(b.nazwa, a.nazwa),
    "students-desc": (a, b) => b.studenci - a.studenci,
    "students-asc": (a, b) => a.studenci - b.studenci,
  };
  if (sorters[sort]) list.sort(sorters[sort]);

  const pages = renderPager("uni", state.uniPage, list.length, (p) => { state.uniPage = p; renderUniversities(); });
  state.uniPage = Math.min(state.uniPage, pages);
  const slice = list.slice((state.uniPage - 1) * PAGE_SIZE, state.uniPage * PAGE_SIZE);

  const tbody = $("#uni-tbody");
  if (tbody) {
    tbody.innerHTML = slice
      .map((u) => `<tr><td class="strong">${escapeHtml(u.nazwa)}</td><td>${escapeHtml(u.miasto)}</td><td>${escapeHtml(u.wojewodztwo)}</td><td class="num">${fmt.format(u.studenci)}</td></tr>`)
      .join("");
  }
  const emptyEl = $("#uni-empty");
  if (emptyEl) emptyEl.hidden = slice.length > 0;
}

function initMajors() {
  const r = state.records;
  fillDatalist($("#list-miasta"), unique(r.map((x) => x.miasto)));
  fillSelect($("#maj-woj"), unique(r.map((x) => x.wojewodztwo)), "Wszystkie");
  fillDatalist($("#list-uczelnie"), unique(r.map((x) => x.uczelnia)));
  fillSelect($("#maj-deg"), unique(r.map((x) => x.stopien)), "Wszystkie");

  const form = $("#major-form");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      state.majFilters = {
        q: ($("#input-kierunek")?.value || "").trim().toLowerCase(),
        city: $("#maj-city")?.value || "",
        woj: $("#maj-woj")?.value || "",
        uni: $("#maj-uni")?.value || "",
        deg: $("#maj-deg")?.value || "",
      };
      state.majPage = 1;
      renderMajors();
    });
  }

  const clearBtn = $("#maj-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (form) form.reset();
      state.majFilters = { q: "", city: "", woj: "", uni: "", deg: "" };
      state.majPage = 1;
      renderMajors();
    });
  }

  const sortEl = $("#maj-sort");
  if (sortEl) {
    sortEl.addEventListener("change", () => { state.majPage = 1; renderMajors(); });
  }

  renderMajors();
}

function renderMajors() {
  const f = state.majFilters;
  const sort = $("#maj-sort")?.value || "students-desc";
  let list = state.records.filter(
    (r) =>
      (!f.q || r.kierunek.toLowerCase().includes(f.q)) &&
      (!f.city || r.miasto.toLocaleLowerCase("pl-PL").includes(f.city.toLocaleLowerCase("pl-PL"))) &&
      (!f.woj || r.wojewodztwo === f.woj) &&
      (!f.uni || r.uczelnia.toLocaleLowerCase("pl-PL").includes(f.uni.toLocaleLowerCase("pl-PL"))) &&
      (!f.deg || r.stopien === f.deg)
  );
  const sorters = {
    "students-desc": (a, b) => b.studenci - a.studenci,
    "students-asc": (a, b) => a.studenci - b.studenci,
    "name-asc": (a, b) => collator.compare(a.kierunek, b.kierunek),
    "city-asc": (a, b) => collator.compare(a.miasto, b.miasto),
  };
  if (sorters[sort]) list.sort(sorters[sort]);

  const countEl = $("#maj-count");
  if (countEl) countEl.textContent = state.loaded ? `${fmt.format(list.length)} pasujących rekordów` : "Brak wczytanych rekordów";

  const pages = renderPager("maj", state.majPage, list.length, (p) => { state.majPage = p; renderMajors(); });
  state.majPage = Math.min(state.majPage, pages);
  const slice = list.slice((state.majPage - 1) * PAGE_SIZE, state.majPage * PAGE_SIZE);

  const tbody = $("#maj-tbody");
  if (tbody) {
    tbody.innerHTML = slice
      .map((r) => `<tr><td>${escapeHtml(r.miasto)}</td><td>${escapeHtml(r.uczelnia)}</td><td class="strong">${escapeHtml(r.kierunek)}</td><td>${escapeHtml(r.stopien)}</td><td class="num">${fmt.format(r.studenci)}</td></tr>`)
      .join("");
  }
  const emptyEl = $("#maj-empty");
  if (emptyEl) emptyEl.hidden = slice.length > 0;
}

function initMap() {
  $$("[data-map-tab]").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.mapTab = btn.dataset.mapTab;
      state.selectedRegion = null;
      $$("[data-map-tab]").forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
      const hintTitle = $("#region-hint-title");
      if (hintTitle) hintTitle.textContent = state.mapTab === "woj" ? "Wybierz województwo" : "Wybierz miasto";
      renderMap();
    })
  );
  renderMap();
}

function groupUniversities(key) {
  const groups = new Map();
  for (const u of state.universities) {
    const k = u[key] || "—";
    const g = groups.get(k) || { name: k, unis: [], students: 0 };
    g.unis.push(u);
    g.students += u.studenci;
    groups.set(k, g);
  }
  return [...groups.values()].sort((a, b) => b.students - a.students);
}

function renderMap() {
  const list = $("#region-list");
  if (!list) return;

  if (!state.loaded) {
    list.hidden = true;
    if ($("#map-placeholder")) $("#map-placeholder").hidden = false;
    return;
  }
  if ($("#map-placeholder")) $("#map-placeholder").hidden = true;
  list.hidden = false;

  const groups = groupUniversities(state.mapTab === "woj" ? "wojewodztwo" : "miasto");
  list.innerHTML = groups
    .map(
      (g) => `<li><button type="button" aria-pressed="${state.selectedRegion === g.name}" data-region="${escapeHtml(g.name)}">
        <strong>${escapeHtml(g.name)}</strong>
        <span>${g.unis.length} uczelni · ${fmt.format(g.students)} studentów</span>
      </button></li>`
    )
    .join("");

  $$("button[data-region]", list).forEach((btn) =>
    btn.addEventListener("click", () => {
      state.selectedRegion = btn.dataset.region;
      renderMap();
      renderRegionDetail(groups.find((g) => g.name === state.selectedRegion));
    })
  );
}

function renderRegionDetail(group) {
  if (!group || !$("#region-detail")) return;
  const unis = [...group.unis].sort((a, b) => b.studenci - a.studenci);
  $("#region-detail").innerHTML = `
    <p class="eyebrow">${state.mapTab === "woj" ? "Województwo" : "Miasto"}</p>
    <h2>${escapeHtml(group.name)}</h2>
    <div class="detail-stats">
      <div><p>Uczelnie</p><p>${fmt.format(unis.length)}</p></div>
      <div><p>Studenci</p><p>${fmt.format(group.students)}</p></div>
    </div>
    <ul class="detail-list">
      ${unis.map((u) => `<li><span>${escapeHtml(u.nazwa)}</span><strong>${fmt.format(u.studenci)}</strong></li>`).join("")}
    </ul>`;
}

const getRatings = () => {
  try { return JSON.parse(localStorage.getItem(RATINGS_KEY)) || []; } catch { return []; }
};

function initRanking() {
  $$("[data-rank-tab]").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.rankTab = btn.dataset.rankTab;
      $$("[data-rank-tab]").forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
      renderRanking();
    })
  );
  renderRanking();
}

function renderRanking() {
  const list = $("#rank-list");
  if (!list) return;
  list.classList.toggle("rank-chart", state.rankTab !== "ratings");
  const emptyTitle = $("#rank-empty-title"), emptyText = $("#rank-empty-text");
  let html = "";

  if (state.rankTab === "majors") {
    if ($("#rank-eyebrow")) $("#rank-eyebrow").textContent = "Top 5";
    if ($("#rank-title")) $("#rank-title").textContent = "Kierunki według liczby absolwentów";
    html = rankingMarkup(topMajors(5));
    if (emptyTitle) emptyTitle.textContent = "Brak danych do utworzenia rankingu";
    if (emptyText) emptyText.textContent = "Ranking zostanie obliczony automatycznie po dodaniu JSON-u.";
  } else if (state.rankTab === "unis") {
    if ($("#rank-eyebrow")) $("#rank-eyebrow").textContent = "Top 5";
    if ($("#rank-title")) $("#rank-title").textContent = "Uczelnie według liczby absolwentów";
    const top = [...state.universities].sort((a, b) => b.studenci - a.studenci).slice(0, 5)
      .map((u) => ({ name: u.nazwa, meta: [u.miasto, u.wojewodztwo].filter(Boolean).join(", "), value: u.studenci }));
    html = rankingMarkup(top);
    if (emptyTitle) emptyTitle.textContent = "Brak danych do utworzenia rankingu";
    if (emptyText) emptyText.textContent = "Ranking zostanie obliczony automatycznie po dodaniu JSON-u.";
  } else {
    if ($("#rank-eyebrow")) $("#rank-eyebrow").textContent = "Lokalnie";
    if ($("#rank-title")) $("#rank-title").textContent = "Oceny użytkowników";
    const ratings = getRatings().slice().reverse();
    html = ratings
      .map(
        (r) => `<li class="rating-entry">
          <header>
            <div><strong>${escapeHtml(r.uni)}</strong><p class="rank-meta">${escapeHtml(r.major)} · ${escapeHtml(r.degree)} · ${escapeHtml(r.city)}</p></div>
            <span class="stars-static" aria-label="Ocena ${r.rating} na 5">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</span>
          </header>
          <p>${escapeHtml(r.opinion)}</p>
          <p class="rank-meta">${escapeHtml(r.name)} · ${escapeHtml(r.status)} · ${new Date(r.date).toLocaleDateString("pl-PL")}</p>
        </li>`
      )
      .join("");
    if (emptyTitle) emptyTitle.textContent = "Brak ocen";
    if (emptyText) emptyText.textContent = "Dodaj pierwszą ocenę za pomocą formularza poniżej.";
  }

  list.innerHTML = html;
  if ($("#rank-empty")) $("#rank-empty").hidden = html.length > 0;
}

function initRatingForm() {
  const form = $("#rating-form");
  if (!form) return;
  const city = $("#r-city"), uni = $("#r-uni"), major = $("#r-major");
  const degree = $("#r-deg");
  const opinion = $("#r-opinion"), counter = $("#r-counter");
  form.addEventListener("input", (event) => {
    if (event.target.id) setError(event.target.id, "");
  });
  form.addEventListener("change", (event) => {
    const key = event.target.name === "status" ? "status" : event.target.id;
    if (key) setError(key, "");
  });
  const normaliseValue = (value) => value.trim().toLocaleLowerCase("pl-PL");
  const cityMatches = (record) => normaliseValue(record.miasto) === normaliseValue(city.value);

  fillDatalist($("#r-city-options"), unique(state.records.map((r) => r.miasto)));
  const refreshUnis = () => {
    const src = city.value ? state.records.filter(cityMatches) : state.records;
    fillSelect(uni, unique(src.map((r) => r.uczelnia)), "Wybierz uczelnię");
  };
  const refreshDegrees = () => {
    const src = state.records.filter((r) => (!city.value || cityMatches(r)) && r.uczelnia === uni.value && r.kierunek === major.value);
    fillSelect(degree, unique(src.map((r) => r.stopien).filter((value) => value !== "Brak danych")), "Wybierz stopień");
    degree.disabled = !major.value || src.length === 0;
  };
  const refreshMajors = () => {
    if (!uni.value) {
      major.innerHTML = "";
      major.append(new Option("Najpierw wybierz uczelnię", ""));
      major.disabled = true;
      refreshDegrees();
      return;
    }
    major.disabled = false;
    const src = state.records.filter((r) => (!city.value || cityMatches(r)) && r.uczelnia === uni.value);
    fillSelect(major, unique(src.map((r) => r.kierunek)), "Wybierz kierunek");
    refreshDegrees();
  };
  refreshUnis();
  city.addEventListener("input", () => { refreshUnis(); refreshMajors(); });
  uni.addEventListener("change", refreshMajors);
  major.addEventListener("change", refreshDegrees);

  const stars = $$("#stars button");
  const paintStars = (n) => stars.forEach((s) => {
    const on = Number(s.dataset.v) <= n;
    s.classList.toggle("on", on);
    s.setAttribute("aria-checked", String(Number(s.dataset.v) === state.rating));
  });
  const starsValue = $("#stars-value");
  const updateStarsValue = (n) => {
    if (starsValue) starsValue.textContent = n ? `${n} ${n === 1 ? "gwiazdka" : "gwiazdki"} z 5` : "Nie wybrano oceny";
  };
  stars.forEach((s) => {
    s.addEventListener("click", () => { state.rating = Number(s.dataset.v); paintStars(state.rating); updateStarsValue(state.rating); setError("stars", ""); });
    s.addEventListener("mouseenter", () => { paintStars(Number(s.dataset.v)); updateStarsValue(Number(s.dataset.v)); });
  });
  if ($("#stars")) $("#stars").addEventListener("mouseleave", () => { paintStars(state.rating); updateStarsValue(state.rating); });

  if (opinion && counter) {
    opinion.addEventListener("input", () => { counter.textContent = `${opinion.value.length}/500`; });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if ($("#r-success")) $("#r-success").hidden = true;
    const data = {
      name: ($("#r-name")?.value || "").trim(),
      email: ($("#r-email")?.value || "").trim(),
      city: city.value,
      uni: uni.value,
      major: major.value,
      degree: $("#r-deg")?.value || "",
      rating: state.rating,
      status: (form.querySelector('input[name="status"]:checked') || {}).value || "",
      opinion: opinion ? opinion.value.trim() : "",
      date: new Date().toISOString(),
    };

    const cityRecords = state.records.filter((r) => normaliseValue(r.miasto) === normaliseValue(data.city));
    const universityRecords = cityRecords.filter((r) => r.uczelnia === data.uni);
    const majorRecords = universityRecords.filter((r) => r.kierunek === data.major);

    const errors = {
      "r-name": data.name.length < 2 ? "Podaj imię lub pseudonim (min. 2 znaki)." : "",
      "r-email": !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) ? "Podaj poprawny adres e-mail." : "",
      "r-city": !data.city ? (state.loaded ? "Wybierz miasto." : "Brak danych – dodaj plik JSON, aby wybrać miasto.") : !cityRecords.length ? "Wybierz miasto dostępne na liście." : "",
      "r-uni": !data.uni ? "Wybierz uczelnię." : !universityRecords.length ? "Wybierz uczelnię związaną z podanym miastem." : "",
      "r-major": !data.major ? "Wybierz kierunek." : !majorRecords.length ? "Wybierz kierunek dostępny na tej uczelni." : "",
      "r-deg": !data.degree ? "Wybierz stopień studiów." : !majorRecords.some((r) => r.stopien === data.degree) ? "Wybierz stopień dostępny dla tego kierunku." : "",
      stars: !data.rating ? "Wybierz ocenę od 1 do 5." : "",
      status: !data.status ? "Wybierz swój status." : "",
      "r-opinion": data.opinion.length < 20 ? "Opinia musi mieć minimum 20 znaków." : "",
      "r-terms": !$("#r-terms")?.checked ? "Musisz zaakceptować zasady publikowania opinii." : "",
    };
    Object.entries(errors).forEach(([k, msg]) => setError(k, msg));

    const firstInvalid = Object.keys(errors).find((k) => errors[k]);
    if (firstInvalid) {
      const el = firstInvalid === "status"
        ? form.querySelector('input[name="status"]')
        : firstInvalid === "stars"
          ? $("#stars button")
          : document.getElementById(firstInvalid);
      if (el) el.focus();
      return;
    }

    const { email, ...publicData } = data;
    const ratings = getRatings();
    ratings.push(publicData);
    localStorage.setItem(RATINGS_KEY, JSON.stringify(ratings));

    form.reset();
    state.rating = 0;
    paintStars(0);
    updateStarsValue(0);
    if (counter) counter.textContent = "0/500";
    refreshUnis();
    refreshMajors();
    if ($("#r-success")) $("#r-success").hidden = false;
    if (state.rankTab === "ratings") renderRanking();
  });
}

function setError(key, msg) {
  const out = document.querySelector(`[data-error-for="${key}"]`);
  if (out) out.textContent = msg;
  const input = document.getElementById(key) || (key === "status" ? document.querySelector('input[name="status"]') : null);
  if (input && input.matches("input, select, textarea")) {
    input.classList.toggle("invalid", Boolean(msg));
    input.setAttribute("aria-invalid", String(Boolean(msg)));
  }
  const group = key === "stars" ? $("#stars") : key === "status" ? $(".radio-group") : null;
  if (group) group.setAttribute("aria-invalid", String(Boolean(msg)));
}

const ROUTES = ["start", "mapa", "kierunki", "ranking", "o-projekcie"];

function route() {
  const hash = location.hash.replace("#", "");
  const current = ROUTES.includes(hash) ? hash : ($(".page")?.dataset.page || "start");
  $$(".page").forEach((p) => { p.hidden = p.dataset.page !== current; });
  $$(".main-nav a").forEach((a) => {
    const active = a.dataset.route === current;
    a.classList.toggle("active", active);
    if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  closeNav();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function closeNav() {
  const nav = $("#main-nav");
  if (nav) nav.classList.remove("open");
  const toggle = $(".nav-toggle");
  if (toggle) toggle.setAttribute("aria-expanded", "false");
}

function initNav() {
  const toggle = $(".nav-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const open = $("#main-nav").classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });
  }
  window.addEventListener("hashchange", route);
  route();
}

const A11Y_KEY = "kns_a11y_v1";
const TEXT_SIZES = ["small", "normal", "large"];

function readA11yPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(A11Y_KEY)) || {};
    return { size: TEXT_SIZES.includes(saved.size) ? saved.size : "normal", contrast: saved.contrast === true };
  } catch {
    return { size: "normal", contrast: false };
  }
}

function applyA11yPrefs(prefs) {
  const root = document.documentElement;
  if (prefs.size === "normal") root.removeAttribute("data-text-size");
  else root.setAttribute("data-text-size", prefs.size);
  root.classList.toggle("high-contrast", prefs.contrast);
  if (document.body) document.body.classList.toggle("high-contrast", prefs.contrast);
  const mapSvg = document.querySelector("#poland-map")?.contentDocument?.querySelector("svg");
  if (mapSvg) mapSvg.classList.toggle("high-contrast", prefs.contrast);

  $$(".text-size button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.size === prefs.size)));
  const contrastToggle = $("#contrast-toggle");
  if (contrastToggle) contrastToggle.setAttribute("aria-pressed", String(prefs.contrast));
  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme) theme.content = prefs.contrast ? "#242424" : "#2563eb";

  try { localStorage.setItem(A11Y_KEY, JSON.stringify(prefs)); } catch {}
}

function initA11y() {
  const prefs = readA11yPrefs();
  applyA11yPrefs(prefs);

  $$(".text-size button").forEach((b) =>
    b.addEventListener("click", () => {
      prefs.size = b.dataset.size;
      applyA11yPrefs(prefs);
    })
  );
  const contrastToggle = $("#contrast-toggle");
  if (contrastToggle) {
    contrastToggle.addEventListener("click", () => {
      prefs.contrast = !prefs.contrast;
      applyA11yPrefs(prefs);
    });
  }
}

function normalizeRegionName(name) {
  if (!name) return '';
  return String(name).trim().toLocaleLowerCase('pl-PL')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/^wojewodztwo\s+/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function capitalizeFirst(string) {
  if (!string) return '';
  return string.charAt(0).toUpperCase() + string.slice(1);
}

function renderRegionSidePanel(container, regionName, wojInfo) {
  if (!container) return;

  if (!wojInfo || Object.keys(wojInfo.cities).length === 0) {
    container.innerHTML = `
      <div class="empty">
        <span class="empty-icon"><svg class="icon"><use href="#i-file"/></svg></span>
        <p class="empty-title">Województwo ${capitalizeFirst(regionName)}</p>
        <p class="empty-text">Brak danych o szkołach wyższych w wybranym regionie.</p>
      </div>`;
    return;
  }

  let html = `
    <div class="region-detail-content">
      <p class="eyebrow">Szczegóły regionu</p>
      <h2 class="card-title" style="margin-bottom: 16px;">Województwo ${wojInfo.prettyName}</h2>
  `;

  for (const [cityName, uniSet] of Object.entries(wojInfo.cities)) {
    html += `
      <div class="city-group" style="margin-bottom: 12px;">
        <h3 style="font-size: 1rem; color: #2563eb; margin: 0 0 6px 0;">${escapeHtml(cityName)}</h3>
        <ul style="margin: 0; padding-left: 18px; color: #334155;">
    `;
    uniSet.forEach(uni => {
      html += `<li style="margin-bottom: 4px;">${escapeHtml(uni)}</li>`;
    });
    html += `</ul></div>`;
  }

  html += `</div>`;
  container.innerHTML = html;
}

function initMapModule() {
  const mapObject = document.getElementById('poland-map');
  const mapWrapper = document.getElementById('map-wrapper');
  const tooltip = document.getElementById('map-tooltip');
  const regionDetail = document.getElementById('region-detail');
  if (!mapObject) return;

  const mappedData = new Map();
  state.records.forEach((row) => {
    const rawWoj = row.wojewodztwo.trim();
    const uni = row.uczelnia.trim();
    if (!rawWoj || !uni) return;

    const key = normalizeRegionName(rawWoj);
    if (!mappedData.has(key)) mappedData.set(key, { prettyName: capitalizeFirst(rawWoj), cities: {} });
    const cities = mappedData.get(key).cities;
    const city = row.miasto.trim() || 'Inne miasta';
    if (!cities[city]) cities[city] = new Set();
    cities[city].add(uni);
  });

  const attachMapEvents = () => {
    const polandSvg = mapObject.contentDocument?.querySelector('svg');
    if (!polandSvg) return;
    polandSvg.classList.toggle('high-contrast', document.documentElement.classList.contains('high-contrast'));

    polandSvg.querySelectorAll('path.region').forEach((region) => {
      const regionId = region.getAttribute('data-region') || region.id;
      const normalizedId = normalizeRegionName(regionId);
      const wojInfo = mappedData.get(normalizedId);

      const showTooltip = (event) => {
        if (!tooltip || !mapWrapper) return;
        const title = wojInfo?.prettyName || capitalizeFirst(regionId);
        const entries = wojInfo
          ? Object.entries(wojInfo.cities).flatMap(([city, universities]) =>
              [...universities].map((university) => `<li><strong>${escapeHtml(city)}:</strong> ${escapeHtml(university)}</li>`)
            )
          : [];
        tooltip.innerHTML = `<h4>Województwo ${escapeHtml(title)}</h4>${entries.length
          ? `<ul>${entries.join('')}</ul>`
          : '<p>Brak uczelni w danych dla tego województwa.</p>'}`;
        tooltip.style.display = 'block';

        const rect = mapWrapper.getBoundingClientRect();
        const x = event?.clientX ? event.clientX - rect.left + 12 : 8;
        const y = event?.clientY ? event.clientY - rect.top + 12 : 8;
        tooltip.style.left = `${Math.max(8, Math.min(x, rect.width - tooltip.offsetWidth - 8))}px`;
        tooltip.style.top = `${Math.max(8, Math.min(y, rect.height - tooltip.offsetHeight - 8))}px`;
      };

      region.addEventListener('mouseenter', showTooltip);
      region.addEventListener('mousemove', (event) => {
        if (tooltip?.style.display === 'block') showTooltip(event);
      });
      region.addEventListener('mouseleave', () => {
        if (tooltip) tooltip.style.display = 'none';
      });
      region.addEventListener('focus', showTooltip);
      region.addEventListener('blur', () => {
        if (tooltip) tooltip.style.display = 'none';
      });

      const selectRegion = () => renderRegionSidePanel(regionDetail, wojInfo?.prettyName || regionId, wojInfo);
      region.addEventListener('click', selectRegion);
      region.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectRegion();
        }
      });
    });
  };

  if (mapObject.contentDocument?.querySelector('svg')) attachMapEvents();
  else mapObject.addEventListener('load', attachMapEvents, { once: true });
}

// Inicjalizacja DALEJ po pobraniu danych
initA11y();

document.addEventListener("DOMContentLoaded", async () => {
  initNav();
  await loadData();
  renderAlerts();
  renderStats();
  initUniversities();
  initMajors();
  initMap();
  initRanking();
  initRatingForm();
  initMapModule();
});