// ========== Radio Browser API Mirrors ==========
const API_MIRRORS = [
  "https://de1.api.radio-browser.info/json",
  "https://nl1.api.radio-browser.info/json",
  "https://fr1.api.radio-browser.info/json",
  "https://us1.api.radio-browser.info/json"
];
let currentMirrorIndex = 0;

async function fetchWithFallback(url, options) {
  for (let i = 0; i < API_MIRRORS.length; i++) {
    const mirror = API_MIRRORS[(currentMirrorIndex + i) % API_MIRRORS.length];
    const fullUrl = mirror + url;
    try {
      const res = await fetch(fullUrl, options);
      if (res.ok) {
        currentMirrorIndex = (currentMirrorIndex + i) % API_MIRRORS.length;
        return res;
      }
    } catch (e) { console.warn(`Mirror ${mirror} failed`); }
  }
  throw new Error("All API mirrors unavailable");
}

const UA_LIST = [
  "GlobalRadioHub/1.0 (Contact: wcqyt@163.com)",
  "RadioHubWeb/1.0",
  "GlobalFMHub/1.0"
];
function getRandomUA() { return UA_LIST[Math.floor(Math.random() * UA_LIST.length)]; }
const fetchOption = { headers: { "User-Agent": getRandomUA() } };
let fetchLock = false;
const pageSize = 60;
const HIST_MAX = 50;
const STORAGE_FAV_KEY = "radio_favorites";
const STORAGE_HIST_KEY = "radio_history";
const STORAGE_THEME_KEY = "radio_theme";
const blockWords = ["bbc", "voa", "rfa", "radio free asia", "cnn news", "nhk world news"];

function isSafeStation(item) {
  if (!item.url) return false;
  const lowerUrl = item.url.toLowerCase();
  return !blockWords.some(w => lowerUrl.includes(w));
}
function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}
async function safeFetch(urlPath, opt) {
  if (fetchLock) return [];
  fetchLock = true;
  try {
    const res = await Promise.race([fetchWithFallback(urlPath, opt), new Promise((_, rej) => setTimeout(() => rej("timeout"), 8000))]);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("Fetch fail:", e);
    showEmptyTip("Unable to load stations, please try again later");
    return [];
  } finally { setTimeout(() => fetchLock = false, 1000); }
}

// DOM elements
const dom = {
  stationList: document.getElementById("stationList"),
  audioPlayer: document.getElementById("audioPlayer"),
  playTitle: document.getElementById("playTitle"),
  favBtnTop: document.getElementById("favBtnTop"),
  historyBtnTop: document.getElementById("historyBtnTop"),
  themeBtn: document.getElementById("themeBtn"),
  loadingTip: document.getElementById("loadingTip"),
  emptyTip: document.getElementById("emptyTip"),
  mainNavBtns: document.querySelectorAll(".main-nav-btn"),
  typeFilter: document.getElementById("typeFilter"),
  typeBtns: document.querySelectorAll(".type-btn"),
  countryFilter: document.getElementById("countryFilter"),
  countryBtnWrap: document.getElementById("countryBtnWrap"),
  langFilter: document.getElementById("langFilter"),
  langBtnWrap: document.getElementById("langBtnWrap"),
  pageBox: document.getElementById("pageBox"),
  prevPage: document.getElementById("prevPage"),
  nextPage: document.getElementById("nextPage"),
  pageNumText: document.getElementById("pageNum"),
  aiRecommendBox: document.getElementById("aiRecommendBox"),
  aiRecommendList: document.getElementById("aiRecommendList"),
  spectrumContainer: document.getElementById("spectrumContainer")
};

let state = {
  currentPage: 1,
  nowView: "hot",
  fullCountryList: [],
  currentStation: null,
  eqMode: "normal",
  audioCtx: null,
  sourceNode: null,
  eqBiquad: null
};

function showLoading() { dom.loadingTip.style.display = "block"; dom.emptyTip.style.display = "none"; }
function hideLoading() { dom.loadingTip.style.display = "none"; }
function showEmptyTip(text) { dom.emptyTip.textContent = text; dom.emptyTip.style.display = "block"; dom.stationList.innerHTML = ""; }
function hideAllFilter() { 
  dom.pageBox.style.display = "none";
  dom.typeFilter.style.display = "none";
  dom.countryFilter.style.display = "none";
  dom.langFilter.style.display = "none";
}

// Theme
function initTheme() {
  let saved = "light";
  try { saved = localStorage.getItem(STORAGE_THEME_KEY) || "light"; } catch {}
  document.documentElement.className = saved;
}
function toggleTheme() {
  const html = document.documentElement;
  const newTheme = html.classList.contains("light") ? "dark" : "light";
  html.className = newTheme;
  try { localStorage.setItem(STORAGE_THEME_KEY, newTheme); } catch {}
}

// Favorites
function getFavorites() { try { return JSON.parse(localStorage.getItem(STORAGE_FAV_KEY) || "[]"); } catch { return []; } }
function saveFavorites(list) { localStorage.setItem(STORAGE_FAV_KEY, JSON.stringify(list)); }
function isFav(uuid) { return getFavorites().some(s => s.stationuuid === uuid); }
function toggleFav(stationObj) {
  let favs = getFavorites();
  const idx = favs.findIndex(s => s.stationuuid === stationObj.stationuuid);
  if (idx > -1) favs.splice(idx, 1);
  else favs.push(stationObj);
  saveFavorites(favs);
  return idx === -1;
}
function loadFavList() { hideAllFilter(); const favs = getFavorites(); if (!favs.length) return showEmptyTip("No favorite stations yet. Click ☆ to add."); renderStationList(favs); }

// History
function getHistory() { try { return JSON.parse(localStorage.getItem(STORAGE_HIST_KEY) || "[]"); } catch { return []; } }
function saveHistory(list) { localStorage.setItem(STORAGE_HIST_KEY, JSON.stringify(list)); }
function addHistory(stationObj) {
  let hist = getHistory().filter(s => s.stationuuid !== stationObj.stationuuid);
  hist.unshift(stationObj);
  if (hist.length > HIST_MAX) hist.pop();
  saveHistory(hist);
  updateAIRecommendation();
}
function loadHistoryList() { hideAllFilter(); const hist = getHistory(); if (!hist.length) return showEmptyTip("No listening history"); renderStationList(hist); }

// Render stations
function renderStationList(rawList) {
  dom.stationList.innerHTML = "";
  dom.emptyTip.style.display = "none";
  const safe = rawList.filter(isSafeStation);
  if (!safe.length) return showEmptyTip("No stations found, try another category");
  safe.forEach(station => {
    const div = document.createElement("div");
    div.className = "station-item";
    const favStatus = isFav(station.stationuuid);
    div.innerHTML = `
      <button class="fav-card-btn ${favStatus ? 'active' : ''}" data-uuid="${escapeHtml(station.stationuuid)}">${favStatus ? '★' : '☆'}</button>
      <h4>${escapeHtml(station.name)}</h4>
      <p>Country: ${escapeHtml(station.country || "Unknown")}</p>
      <p>Language: ${escapeHtml(station.language || "Unknown")}</p>
      <small>Tags: ${escapeHtml((station.tags || "").slice(0, 60))}</small>
    `;
    div.dataset.station = JSON.stringify(station);
    dom.stationList.appendChild(div);
  });
  dom.stationList.onclick = (e) => {
    const item = e.target.closest(".station-item");
    if (!item) return;
    const favBtn = e.target.closest(".fav-card-btn");
    const station = JSON.parse(item.dataset.station);
    if (favBtn) {
      e.stopPropagation();
      const newState = toggleFav(station);
      favBtn.textContent = newState ? "★" : "☆";
      favBtn.classList.toggle("active", newState);
      return;
    }
    playStation(station);
  };
}

// Equalizer (Web Audio)
async function setupEqualizer() {
  if (state.audioCtx) return;
  const audioEl = dom.audioPlayer;
  if (!audioEl) return;
  state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  state.sourceNode = state.audioCtx.createMediaElementSource(audioEl);
  state.eqBiquad = state.audioCtx.createBiquadFilter();
  state.eqBiquad.type = "lowshelf";
  state.eqBiquad.frequency.value = 200;
  state.eqBiquad.gain.value = 0;
  state.sourceNode.connect(state.eqBiquad);
  state.eqBiquad.connect(state.audioCtx.destination);
  applyEQMode(state.eqMode);
}
function applyEQMode(mode) {
  if (!state.eqBiquad) return;
  if (mode === "bass") state.eqBiquad.gain.value = 12;
  else if (mode === "vocal") state.eqBiquad.gain.value = -4;
  else state.eqBiquad.gain.value = 0;
}
function bindEQButtons() {
  document.querySelectorAll(".eq-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".eq-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.eqMode = btn.dataset.eq;
      applyEQMode(state.eqMode);
    };
  });
}

// AI Recommendation
async function updateAIRecommendation() {
  const history = getHistory();
  if (history.length === 0) {
    if (dom.aiRecommendBox) dom.aiRecommendBox.style.display = "none";
    return;
  }
  let tagCount = new Map();
  let countryCount = new Map();
  history.forEach(station => {
    if (station.tags) {
      station.tags.split(',').forEach(t => {
        let tt = t.trim().toLowerCase();
        if (tt) tagCount.set(tt, (tagCount.get(tt) || 0) + 1);
      });
    }
    if (station.country) countryCount.set(station.country, (countryCount.get(station.country) || 0) + 1);
  });
  let topTags = [...tagCount.entries()].sort((a,b) => b[1] - a[1]).slice(0, 3).map(v => v[0]);
  let topCountry = [...countryCount.entries()].sort((a,b) => b[1] - a[1])[0]?.[0];
  if (topTags.length === 0 && !topCountry) {
    dom.aiRecommendBox.style.display = "none";
    return;
  }
  let allStations = await safeFetch("/stations/topclick/200", fetchOption);
  if (!allStations.length) return;
  let recommended = [];
  if (topTags.length) {
    recommended = allStations.filter(s => s.tags && topTags.some(t => s.tags.toLowerCase().includes(t)));
  }
  if (recommended.length < 5 && topCountry) {
    let byCountry = allStations.filter(s => s.country === topCountry);
    recommended = [...recommended, ...byCountry];
  }
  recommended = recommended.filter(s => s.stationuuid !== state.currentStation?.stationuuid).slice(0, 6);
  if (recommended.length === 0) {
    dom.aiRecommendBox.style.display = "none";
    return;
  }
  dom.aiRecommendBox.style.display = "block";
  dom.aiRecommendList.innerHTML = "";
  recommended.forEach(rec => {
    const card = document.createElement("div");
    card.className = "station-item";
    card.style.minWidth = "180px";
    card.style.margin = "0";
    card.innerHTML = `<h5>${escapeHtml(rec.name)}</h5><small>${escapeHtml(rec.country || "")}</small>`;
    card.dataset.station = JSON.stringify(rec);
    card.onclick = (e) => { e.stopPropagation(); playStation(rec); };
    dom.aiRecommendList.appendChild(card);
  });
}

// Play core
async function playStation(station) {
  if (dom.spectrumContainer) dom.spectrumContainer.style.display = "none";
  dom.audioPlayer.pause();
  dom.audioPlayer.src = "";
  dom.audioPlayer.load();
  try {
    dom.playTitle.innerText = escapeHtml(station.name);
    dom.audioPlayer.src = station.url;
    await dom.audioPlayer.play();
    addHistory(station);
    state.currentStation = station;
    if (dom.spectrumContainer) dom.spectrumContainer.style.display = "flex";
    await setupEqualizer();
    if (state.audioCtx && state.audioCtx.state === 'suspended') await state.audioCtx.resume();
  } catch (err) {
    dom.playTitle.innerText = "❌ This station cannot be played, try another";
    console.error("Play failed:", err);
    if (dom.spectrumContainer) dom.spectrumContainer.style.display = "none";
  }
}

// Data loading
async function loadHot() { showLoading(); hideAllFilter(); const data = await safeFetch("/stations/topclick/100", fetchOption); renderStationList(data); hideLoading(); }
async function loadAllStations() { showLoading(); dom.pageBox.style.display = "flex"; const offset = (state.currentPage - 1) * pageSize; const data = await safeFetch(`/stations?limit=${pageSize}&offset=${offset}`, fetchOption); renderStationList(data); updatePageText(); hideLoading(); }
async function loadByTag(tag) { showLoading(); hideAllFilter(); const data = await safeFetch(`/stations/search?tag=${encodeURIComponent(tag)}&limit=120`, fetchOption); renderStationList(data); hideLoading(); }
async function loadByCountryCode(countryCode) { showLoading(); hideAllFilter(); let stations = await safeFetch(`/stations/search?countrycode=${encodeURIComponent(countryCode)}&limit=120`, fetchOption); if (!stations.length) { const topData = await safeFetch("/stations/topclick/500", fetchOption); stations = topData.filter(s => (s.countrycode || "").toLowerCase() === countryCode.toLowerCase()); } renderStationList(stations); hideLoading(); }
async function loadByLanguageKey(langKey) { showLoading(); hideAllFilter(); let stations = await safeFetch(`/stations/search?language=${encodeURIComponent(langKey)}&limit=120`, fetchOption); if (!stations.length) { const topData = await safeFetch("/stations/topclick/500", fetchOption); stations = topData.filter(s => (s.language || "").toLowerCase().includes(langKey)); } renderStationList(stations); hideLoading(); }

const FALLBACK_COUNTRIES = [{ name: "United States", code: "US" }, { name: "United Kingdom", code: "GB" }, { name: "Canada", code: "CA" }, { name: "Australia", code: "AU" }, { name: "Germany", code: "DE" }, { name: "France", code: "FR" }];
async function loadCachedCountries() {
  let data = await safeFetch("/countries", fetchOption);
  if (!data.length) data = FALLBACK_COUNTRIES;
  else data = data.map(c => ({ name: c.name, code: c.iso_3166_1 }));
  data.sort((a, b) => a.name.localeCompare(b.name));
  state.fullCountryList = data;
  renderCountryButtons(data);
}
function renderCountryButtons(list) {
  dom.countryBtnWrap.innerHTML = "";
  const select = document.createElement("select");
  select.className = "country-select";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "-- Select Country --";
  defaultOption.disabled = true;
  defaultOption.selected = true;
  select.appendChild(defaultOption);
  list.forEach(ct => {
    const opt = document.createElement("option");
    opt.value = ct.code;
    opt.textContent = ct.name;
    select.appendChild(opt);
  });
  select.addEventListener("change", e => { if (e.target.value) loadByCountryCode(e.target.value); });
  dom.countryBtnWrap.appendChild(select);
}
function renderLanguageButtons() {
  const MAJOR_LANGUAGES = [{ display: "English", searchKey: "english" }, { display: "Chinese", searchKey: "chinese" }, { display: "Spanish", searchKey: "spanish" }, { display: "French", searchKey: "french" }, { display: "German", searchKey: "german" }];
  dom.langBtnWrap.innerHTML = "";
  MAJOR_LANGUAGES.forEach(lang => {
    const btn = document.createElement("button");
    btn.className = "lang-btn";
    btn.textContent = lang.display;
    btn.dataset.searchkey = lang.searchKey;
    dom.langBtnWrap.appendChild(btn);
  });
}
function bindLanguageEvents() {
  dom.langBtnWrap.addEventListener('click', (e) => {
    const btn = e.target.closest('.lang-btn');
    if (btn) loadByLanguageKey(btn.dataset.searchkey);
  });
}
function updatePageText() { dom.pageNumText.textContent = `Page ${state.currentPage}`; }

// Navigation
function bindNavEvents() {
  dom.mainNavBtns.forEach(btn => {
    btn.onclick = async () => {
      dom.mainNavBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.nowView = btn.dataset.view;
      state.currentPage = 1;
      switch (state.nowView) {
        case "hot": await loadHot(); break;
        case "all": await loadAllStations(); break;
        case "type": hideAllFilter(); dom.typeFilter.style.display = "flex"; showEmptyTip("Click genre above to browse"); break;
        case "country": hideAllFilter(); dom.countryFilter.style.display = "flex"; await loadCachedCountries(); showEmptyTip("Select a country from dropdown"); break;
        case "lang": hideAllFilter(); dom.langFilter.style.display = "flex"; renderLanguageButtons(); bindLanguageEvents(); showEmptyTip("Click a language to load stations"); break;
      }
    };
  });
}
function bindPageEvents() {
  dom.prevPage.onclick = async () => { if (state.nowView !== "all" || state.currentPage <= 1) return; state.currentPage--; await loadAllStations(); };
  dom.nextPage.onclick = async () => { if (state.nowView !== "all") return; state.currentPage++; await loadAllStations(); };
}
function bindVisibilityPause() {
  document.addEventListener("visibilitychange", () => { if (document.hidden && !dom.audioPlayer.paused) dom.audioPlayer.pause(); });
  window.addEventListener('beforeunload', () => { dom.audioPlayer.pause(); dom.audioPlayer.src = ""; });
}

// Spectrum bars init
function initSpectrum() {
  if (!dom.spectrumContainer) return;
  for (let i = 0; i < 30; i++) {
    const bar = document.createElement("div");
    bar.className = "spectrum-bar";
    dom.spectrumContainer.appendChild(bar);
  }
}

// Initialize App
async function initApp() {
  initTheme();
  bindNavEvents();
  bindPageEvents();
  bindVisibilityPause();
  bindEQButtons();
  initSpectrum();
  dom.favBtnTop.onclick = loadFavList;
  dom.historyBtnTop.onclick = loadHistoryList;
  dom.themeBtn.onclick = toggleTheme;
  await loadHot();
}

window.addEventListener("DOMContentLoaded", initApp);