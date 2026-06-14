// ========== 可用的 Radio Browser 镜像服务器列表 ==========
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
    } catch (e) {
      console.warn(`镜像 ${mirror} 失败，尝试下一个...`);
    }
  }
  throw new Error("所有 API 镜像均不可用");
}

const UA_LIST = [
  "GlobalRadioHub/1.0 (Contact: wcqyt@163.com)",
  "RadioHubWeb/1.0 (Contact: wcqyt@163.com)",
  "GlobalFMHub/1.0 (Contact: wcqyt@163.com)"
];
function getRandomUA() { return UA_LIST[Math.floor(Math.random() * UA_LIST.length)]; }

const fetchOption = { headers: { "User-Agent": getRandomUA() } };
let fetchLock = false;
const pageSize = 60;
const RECENT_MAX = 20;
const CACHE_EXPIRE = 86400000;
const STORAGE_FAV_KEY = "radio_favorites";
const STORAGE_RECENT_KEY = "radio_recent";
const STORAGE_THEME_KEY = "radio_theme";
const STORAGE_MEMBER_KEY = "radio_member";
const STORAGE_COUNTRY_CACHE = "radio_country_cache";
const blockWords = ["bbc", "voa", "rfa", "radio free asia", "cnn news", "nhk world news"];

function isSafeStation(item) {
  if (!item.url) return false;
  const lowerUrl = item.url.toLowerCase();
  return !blockWords.some(w => lowerUrl.includes(w));
}
function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function debounce(fn, delay = 300) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), delay); };
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
    showEmptyTip("无法加载电台，请稍后重试");
    return [];
  } finally { setTimeout(() => fetchLock = false, 1000); }
}

// DOM 元素
const dom = {
  searchInput: document.getElementById("searchInput"),
  searchBtn: document.getElementById("searchBtn"),
  audioPlayer: document.getElementById("audioPlayer"),
  nowPlayingName: document.getElementById("nowPlayingName"),
  nowPlayingCountry: document.getElementById("nowPlayingCountry"),
  nowPlayingTags: document.getElementById("nowPlayingTags"),
  recentList: document.getElementById("recentList"),
  stationList: document.getElementById("stationList"),
  pageBox: document.getElementById("pageBox"),
  prevPage: document.getElementById("prevPage"),
  nextPage: document.getElementById("nextPage"),
  pageNumText: document.getElementById("pageNum"),
  typeFilter: document.getElementById("typeFilter"),
  typeBtns: document.querySelectorAll(".type-btn"),
  countryFilter: document.getElementById("countryFilter"),
  countryBtnWrap: document.getElementById("countryBtnWrap"),
  langFilter: document.getElementById("langFilter"),
  langBtnWrap: document.getElementById("langBtnWrap"),
  mainNavBtns: document.querySelectorAll(".main-nav-btn"),
  themeBtn: document.getElementById("themeBtn"),
  favBtnTop: document.getElementById("favBtnTop"),
  memberBtn: document.getElementById("memberBtn"),
  loadingTip: document.getElementById("loadingTip"),
  emptyTip: document.getElementById("emptyTip"),
  modal: document.getElementById("memberModal"),
  closeModal: document.querySelector(".closeModal"),
  paypalWrap: document.getElementById("paypal-button-container"),
  toggleBrowse: document.getElementById("toggleBrowse"),
  browseContent: document.getElementById("browseContent")
};

let state = { currentPage: 1, nowView: "hot", fullCountryList: [], paypalRetries: 0 };

// ========== 最近播放管理 ==========
function getRecent() {
  try { const raw = localStorage.getItem(STORAGE_RECENT_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; }
}
function saveRecent(list) {
  try { localStorage.setItem(STORAGE_RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); } catch {}
}
function addToRecent(station) {
  let recent = getRecent();
  recent = recent.filter(s => s.stationuuid !== station.stationuuid);
  recent.unshift(station);
  if (recent.length > RECENT_MAX) recent.pop();
  saveRecent(recent);
  renderRecentlyPlayed();
}
function renderRecentlyPlayed() {
  if (!dom.recentList) return;
  const recent = getRecent();
  if (recent.length === 0) {
    dom.recentList.innerHTML = '<div class="empty-recent">No recent stations</div>';
    return;
  }
  dom.recentList.innerHTML = recent.map(s => `
    <div class="recent-item" data-uuid="${escapeHtml(s.stationuuid)}">
      <div class="recent-info">
        <div class="recent-name">${escapeHtml(s.name)}</div>
        <div class="recent-country">${escapeHtml(s.country || "Unknown")}</div>
      </div>
      <button class="recent-play-btn">Play</button>
    </div>
  `).join('');
  // 绑定播放事件
  document.querySelectorAll('.recent-item').forEach(item => {
    const uuid = item.dataset.uuid;
    const station = recent.find(s => s.stationuuid === uuid);
    if (station) {
      const btn = item.querySelector('.recent-play-btn');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        playStation(station);
      });
      item.addEventListener('click', () => playStation(station));
    }
  });
}

// ========== Now Playing 更新 ==========
function updateNowPlaying(station) {
  if (dom.nowPlayingName) dom.nowPlayingName.innerText = escapeHtml(station.name);
  if (dom.nowPlayingCountry) dom.nowPlayingCountry.innerText = station.country ? `📍 ${escapeHtml(station.country)}` : '';
  if (dom.nowPlayingTags) dom.nowPlayingTags.innerText = station.tags ? `🏷️ ${escapeHtml(station.tags.slice(0, 80))}` : '';
}

// ========== 播放核心 ==========
async function playStation(station) {
  if (!station.url) return;
  dom.audioPlayer.pause();
  dom.audioPlayer.src = "";
  dom.audioPlayer.load();
  try {
    updateNowPlaying(station);
    dom.audioPlayer.src = station.url;
    await dom.audioPlayer.play();
    addToRecent(station);
  } catch (err) {
    dom.nowPlayingName.innerText = "Stream unavailable";
    console.error("播放失败:", err);
  }
}

// ========== 收藏 ==========
function getFavorites() { try { const raw = localStorage.getItem(STORAGE_FAV_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; } }
function saveFavorites(list) { try { localStorage.setItem(STORAGE_FAV_KEY, JSON.stringify(list)); } catch {} }
function isFav(uuid) { return getFavorites().some(s => s.stationuuid === uuid); }
function toggleFav(stationObj) {
  let favs = getFavorites();
  const idx = favs.findIndex(s => s.stationuuid === stationObj.stationuuid);
  if (idx > -1) favs.splice(idx, 1); else favs.push(stationObj);
  saveFavorites(favs);
  return idx === -1;
}
function loadFavList() {
  const favs = getFavorites();
  if (!favs.length) { dom.stationList.innerHTML = '<div class="empty-recent">No favorites yet</div>'; return; }
  renderStationList(favs);
}

// ========== 渲染浏览区电台列表 ==========
function renderStationList(rawList) {
  if (!dom.stationList) return;
  dom.stationList.innerHTML = "";
  const safe = rawList.filter(isSafeStation);
  if (!safe.length) { dom.stationList.innerHTML = "<div>No stations found</div>"; return; }
  safe.forEach(station => {
    const div = document.createElement("div");
    div.className = "station-item";
    const favStatus = isFav(station.stationuuid);
    div.innerHTML = `
      <button class="fav-card-btn ${favStatus ? 'active' : ''}" data-uuid="${escapeHtml(station.stationuuid)}">${favStatus ? '★' : '☆'}</button>
      <h4>${escapeHtml(station.name)}</h4>
      <p>${escapeHtml(station.country || "Unknown")}</p>
      <small>${escapeHtml((station.tags || "").slice(0, 60))}</small>
    `;
    div.dataset.station = JSON.stringify(station);
    div.addEventListener('click', (e) => {
      if (e.target.classList.contains('fav-card-btn')) return;
      playStation(station);
    });
    const favBtn = div.querySelector('.fav-card-btn');
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const newState = toggleFav(station);
      favBtn.textContent = newState ? "★" : "☆";
      favBtn.classList.toggle('active', newState);
    });
    dom.stationList.appendChild(div);
  });
}

// ========== 数据加载接口 ==========
async function loadHot() { showLoading(); hideAllFilter(); const data = await safeFetch("/stations/topclick/100", fetchOption); renderStationList(data); hideLoading(); }
async function loadAllStations() { showLoading(); hideAllFilter(); const offset = (state.currentPage - 1) * pageSize; const data = await safeFetch(`/stations?limit=${pageSize}&offset=${offset}`, fetchOption); renderStationList(data); updatePageText(); hideLoading(); }
async function loadByTag(tag) { showLoading(); hideAllFilter(); const data = await safeFetch(`/stations/search?tag=${encodeURIComponent(tag)}&limit=120`, fetchOption); renderStationList(data); hideLoading(); }
async function loadByCountry(name) { showLoading(); hideAllFilter(); const data = await safeFetch(`/stations/search?country=${encodeURIComponent(name)}&limit=120`, fetchOption); renderStationList(data); hideLoading(); }
async function loadByLang(name) { showLoading(); hideAllFilter(); const data = await safeFetch(`/stations/search?language=${encodeURIComponent(name)}&limit=120`, fetchOption); renderStationList(data); hideLoading(); }

function updatePageText() { if (dom.pageNumText) dom.pageNumText.textContent = `Page ${state.currentPage}`; }
function showLoading() { if (dom.loadingTip) dom.loadingTip.style.display = "block"; }
function hideLoading() { if (dom.loadingTip) dom.loadingTip.style.display = "none"; }
function showEmptyTip(text) { if (dom.emptyTip) { dom.emptyTip.textContent = text; dom.emptyTip.style.display = "block"; } }
function hideAllFilter() {
  if (dom.pageBox) dom.pageBox.style.display = "none";
  if (dom.typeFilter) dom.typeFilter.style.display = "none";
  if (dom.countryFilter) dom.countryFilter.style.display = "none";
  if (dom.langFilter) dom.langFilter.style.display = "none";
}

// ========== 国家下拉框 ==========
const FALLBACK_COUNTRIES = [
  { name: "United States", code: "US" }, { name: "United Kingdom", code: "GB" },
  { name: "Canada", code: "CA" }, { name: "Australia", code: "AU" },
  { name: "Germany", code: "DE" }, { name: "France", code: "FR" },
  { name: "Italy", code: "IT" }, { name: "Spain", code: "ES" },
  { name: "Japan", code: "JP" }, { name: "China", code: "CN" },
  { name: "India", code: "IN" }, { name: "Brazil", code: "BR" },
  { name: "Mexico", code: "MX" }, { name: "Netherlands", code: "NL" },
  { name: "Sweden", code: "SE" }, { name: "Norway", code: "NO" },
  { name: "Poland", code: "PL" }, { name: "Russia", code: "RU" }
];
async function loadCachedCountries() {
  let data = await safeFetch("/countries", fetchOption);
  if (!data || data.length === 0) data = FALLBACK_COUNTRIES;
  else data = data.map(c => ({ name: c.name, code: c.iso_3166_1 }));
  data.sort((a, b) => a.name.localeCompare(b.name));
  state.fullCountryList = data;
  renderCountryButtons(data);
}
function renderCountryButtons(list) {
  if (!dom.countryBtnWrap) return;
  dom.countryBtnWrap.innerHTML = "";
  const wrapper = document.createElement("div");
  wrapper.className = "country-select-wrapper";
  const select = document.createElement("select");
  select.className = "country-select";
  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = "-- Select Country --";
  defaultOpt.disabled = true;
  defaultOpt.selected = true;
  select.appendChild(defaultOpt);
  list.forEach(ct => {
    const opt = document.createElement("option");
    opt.value = ct.code;
    opt.textContent = ct.name;
    select.appendChild(opt);
  });
  select.addEventListener("change", (e) => {
    if (e.target.value) loadByCountryCode(e.target.value);
  });
  wrapper.appendChild(select);
  dom.countryBtnWrap.appendChild(wrapper);
}
async function loadByCountryCode(code) {
  showLoading();
  hideAllFilter();
  if (dom.countryFilter) dom.countryFilter.style.display = "flex";
  const data = await safeFetch(`/stations/search?countrycode=${encodeURIComponent(code)}&limit=120`, fetchOption);
  renderStationList(data);
  hideLoading();
}

// ========== 语言按钮 ==========
const MAJOR_LANGUAGES = [
  { display: "🇬🇧 English", searchKey: "english" },
  { display: "🇨🇳 Chinese", searchKey: "chinese" },
  { display: "🇪🇸 Spanish", searchKey: "spanish" },
  { display: "🇫🇷 French", searchKey: "french" },
  { display: "🇩🇪 German", searchKey: "german" },
  { display: "🇯🇵 Japanese", searchKey: "japanese" },
  { display: "🇰🇷 Korean", searchKey: "korean" },
  { display: "🇸🇦 Arabic", searchKey: "arabic" },
  { display: "🇷🇺 Russian", searchKey: "russian" },
  { display: "🇵🇹 Portuguese", searchKey: "portuguese" },
  { display: "🇮🇹 Italian", searchKey: "italian" }
];
function renderLanguageButtons() {
  if (!dom.langBtnWrap) return;
  dom.langBtnWrap.innerHTML = "";
  MAJOR_LANGUAGES.forEach(lang => {
    const btn = document.createElement("button");
    btn.className = "lang-btn";
    btn.textContent = lang.display;
    btn.dataset.searchkey = lang.searchKey;
    btn.addEventListener("click", () => loadByLanguageKey(lang.searchKey));
    dom.langBtnWrap.appendChild(btn);
  });
}
async function loadByLanguageKey(key) {
  showLoading();
  hideAllFilter();
  if (dom.langFilter) dom.langFilter.style.display = "flex";
  const data = await safeFetch(`/stations/search?language=${encodeURIComponent(key)}&limit=120`, fetchOption);
  renderStationList(data);
  hideLoading();
}

// ========== 搜索 ==========
const handleSearch = debounce(async () => {
  const q = dom.searchInput?.value.trim();
  if (!q) { showEmptyTip("Enter search keyword"); return; }
  showLoading();
  hideAllFilter();
  let stations = [];
  for (const mirror of API_MIRRORS) {
    const url = `${mirror}/stations/search?q=${encodeURIComponent(q)}&limit=100`;
    try {
      const res = await fetch(url, fetchOption);
      if (res.ok) { const data = await res.json(); if (data.length) { stations = data; break; } }
    } catch(e) { console.warn(e); }
  }
  if (!stations.length) { showEmptyTip(`No results for "${q}"`); hideLoading(); return; }
  renderStationList(stations);
  hideLoading();
});

// ========== 导航 ==========
function bindNavEvents() {
  dom.mainNavBtns.forEach(btn => {
    btn.onclick = async () => {
      dom.mainNavBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.nowView = btn.dataset.view;
      state.currentPage = 1;
      hideAllFilter();
      switch (state.nowView) {
        case "hot": await loadHot(); break;
        case "all": if (dom.pageBox) dom.pageBox.style.display = "flex"; await loadAllStations(); break;
        case "type": if (dom.typeFilter) dom.typeFilter.style.display = "flex"; break;
        case "country": if (dom.countryFilter) dom.countryFilter.style.display = "flex"; if (!state.fullCountryList.length) await loadCachedCountries(); break;
        case "lang": if (dom.langFilter) dom.langFilter.style.display = "flex"; renderLanguageButtons(); break;
      }
    };
  });
}
function bindPageEvents() {
  if (dom.prevPage) dom.prevPage.onclick = async () => { if (state.nowView === "all" && state.currentPage > 1) { state.currentPage--; await loadAllStations(); } };
  if (dom.nextPage) dom.nextPage.onclick = async () => { if (state.nowView === "all") { state.currentPage++; await loadAllStations(); } };
}

// ========== 主题 & 会员 ==========
function initTheme() { let saved = "light"; try { saved = localStorage.getItem(STORAGE_THEME_KEY) || "light"; } catch {} document.documentElement.className = saved + (isMember() ? " no-ad" : ""); }
function toggleTheme() { const html = document.documentElement; const adClass = html.classList.contains("no-ad") ? " no-ad" : ""; const newTheme = html.classList.contains("light") ? "dark" : "light"; html.className = newTheme + adClass; try { localStorage.setItem(STORAGE_THEME_KEY, newTheme); } catch {} }
function isMember() { try { return localStorage.getItem(STORAGE_MEMBER_KEY) === "paid"; } catch { return false; } }
function setMemberPaid() { try { localStorage.setItem(STORAGE_MEMBER_KEY, "paid"); } catch {} document.documentElement.classList.add("no-ad"); }
function initAdState() { if (isMember()) document.documentElement.classList.add("no-ad"); }
function loadPayPal() { if (document.querySelector('#paypal-sdk')) return; const script = document.createElement('script'); script.id = 'paypal-sdk'; script.src = 'https://www.paypal.com/sdk/js?client-id=YOUR_PAYPAL_CLIENT_ID&currency=USD'; script.defer = true; document.head.appendChild(script); }
function initPayPal() {
  state.paypalRetries++;
  if (state.paypalRetries > 8) { if (dom.memberBtn) dom.memberBtn.style.display = "none"; return; }
  if (typeof paypal === "undefined") { loadPayPal(); setTimeout(initPayPal, 800); return; }
  paypal.Buttons({ createOrder: (_, actions) => actions.order.create({ purchase_units: [{ amount: { value: "1.99" } }] }), onApprove: async (_, actions) => { try { await actions.order.capture(); setMemberPaid(); alert("Payment success! Refresh to activate ad-free."); location.reload(); } catch (err) { alert("Payment failed"); console.error(err); } }, onError: () => { if (state.paypalRetries > 4) dom.memberBtn.style.display = "none"; } }).render(dom.paypalWrap);
}
function bindModalEvent() { if (dom.memberBtn) dom.memberBtn.onclick = () => dom.modal.style.display = "block"; if (dom.closeModal) dom.closeModal.onclick = () => dom.modal.style.display = "none"; window.onclick = (e) => { if (e.target === dom.modal) dom.modal.style.display = "none"; }; }
function bindVisibilityPause() { document.addEventListener("visibilitychange", () => { if (document.hidden && !dom.audioPlayer.paused) dom.audioPlayer.pause(); }); window.addEventListener('beforeunload', () => { dom.audioPlayer.pause(); dom.audioPlayer.src = ""; }); }

// ========== 折叠浏览区 ==========
if (dom.toggleBrowse) {
  dom.toggleBrowse.addEventListener('click', () => {
    const isVisible = dom.browseContent.style.display !== 'none';
    dom.browseContent.style.display = isVisible ? 'none' : 'block';
    dom.toggleBrowse.querySelector('.toggle-icon').textContent = isVisible ? '▼' : '▲';
  });
}

function bindAllEvents() {
  dom.favBtnTop.onclick = loadFavList;
  dom.themeBtn.onclick = toggleTheme;
  dom.searchBtn.onclick = handleSearch;
  dom.searchInput.addEventListener("keydown", e => e.key === "Enter" && handleSearch());
  dom.typeBtns.forEach(btn => btn.onclick = () => loadByTag(btn.dataset.tag));
  bindNavEvents();
  bindPageEvents();
  bindModalEvent();
  bindVisibilityPause();
}

async function initApp() {
  initTheme();
  initAdState();
  bindAllEvents();
  await loadHot();
  renderRecentlyPlayed();
  setTimeout(initPayPal, 1200);
}
window.addEventListener("DOMContentLoaded", initApp);
