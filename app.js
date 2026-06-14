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
const HIST_MAX = 50;
const CACHE_EXPIRE = 86400000;
const STORAGE_FAV_KEY = "radio_favorites";
const STORAGE_HIST_KEY = "radio_history";
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

const dom = {
  searchInput: document.getElementById("searchInput"), searchBtn: document.getElementById("searchBtn"),
  stationList: document.getElementById("stationList"), audioPlayer: document.getElementById("audioPlayer"),
  playTitle: document.getElementById("playTitle"), favBtnTop: document.getElementById("favBtnTop"),
  historyBtnTop: document.getElementById("historyBtnTop"), themeBtn: document.getElementById("themeBtn"),
  memberBtn: document.getElementById("memberBtn"), loadingTip: document.getElementById("loadingTip"),
  emptyTip: document.getElementById("emptyTip"), modal: document.getElementById("memberModal"),
  closeModal: document.querySelector(".closeModal"), paypalWrap: document.getElementById("paypal-button-container"),
  mainNavBtns: document.querySelectorAll(".main-nav-btn"), typeFilter: document.getElementById("typeFilter"),
  typeBtns: document.querySelectorAll(".type-btn"), countryFilter: document.getElementById("countryFilter"),
  countryBtnWrap: document.getElementById("countryBtnWrap"), countrySearchInput: document.getElementById("countrySearch"),
  langFilter: document.getElementById("langFilter"), langBtnWrap: document.getElementById("langBtnWrap"),
  pageBox: document.getElementById("pageBox"), prevPage: document.getElementById("prevPage"),
  nextPage: document.getElementById("nextPage"), pageNumText: document.getElementById("pageNum"),
  adWrappers: document.querySelectorAll(".ad-wrapper")
};
let state = { currentPage: 1, nowView: "hot", fullCountryList: [], paypalRetries: 0 };

function isMember() { try { return localStorage.getItem(STORAGE_MEMBER_KEY) === "paid"; } catch { return false; } }
function setMemberPaid() { try { localStorage.setItem(STORAGE_MEMBER_KEY, "paid"); } catch {} document.documentElement.classList.add("no-ad"); }
function initAdState() { if (isMember()) document.documentElement.classList.add("no-ad"); }
function showLoading() { dom.loadingTip.style.display = "block"; dom.emptyTip.style.display = "none"; }
function hideLoading() { dom.loadingTip.style.display = "none"; }
function showEmptyTip(text) { dom.emptyTip.textContent = text; dom.emptyTip.style.display = "block"; dom.stationList.innerHTML = ""; }
function hideAllFilter() { dom.pageBox.style.display = "none"; dom.typeFilter.style.display = "none"; dom.countryFilter.style.display = "none"; dom.langFilter.style.display = "none"; }

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
function loadFavList() { hideAllFilter(); const favs = getFavorites(); if (!favs.length) return showEmptyTip("暂无收藏电台，点击 ☆ 添加"); renderStationList(favs); }

function getHistory() { try { const raw = localStorage.getItem(STORAGE_HIST_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; } }
function saveHistory(list) { try { localStorage.setItem(STORAGE_HIST_KEY, JSON.stringify(list)); } catch {} }
function addHistory(stationObj) {
  let hist = getHistory().filter(s => s.stationuuid !== stationObj.stationuuid);
  hist.unshift(stationObj);
  if (hist.length > HIST_MAX) hist.pop();
  saveHistory(hist);
}
function loadHistoryList() { hideAllFilter(); const hist = getHistory(); if (!hist.length) return showEmptyTip("暂无播放历史"); renderStationList(hist); }

function initTheme() { let saved = "light"; try { saved = localStorage.getItem(STORAGE_THEME_KEY) || "light"; } catch {} document.documentElement.className = saved + (isMember() ? " no-ad" : ""); }
function toggleTheme() { const html = document.documentElement; const adClass = html.classList.contains("no-ad") ? " no-ad" : ""; const newTheme = html.classList.contains("light") ? "dark" : "light"; html.className = newTheme + adClass; try { localStorage.setItem(STORAGE_THEME_KEY, newTheme); } catch {} }

function loadPayPal() { if (document.querySelector('#paypal-sdk')) return; const script = document.createElement('script'); script.id = 'paypal-sdk'; script.src = 'https://www.paypal.com/sdk/js?client-id=YOUR_PAYPAL_CLIENT_ID&currency=USD'; script.defer = true; document.head.appendChild(script); }
function initPayPal() {
  state.paypalRetries++;
  if (state.paypalRetries > 8) { dom.memberBtn.style.display = "none"; return; }
  if (typeof paypal === "undefined") { loadPayPal(); setTimeout(initPayPal, 800); return; }
  paypal.Buttons({ createOrder: (_, actions) => actions.order.create({ purchase_units: [{ amount: { value: "1.99" } }] }), onApprove: async (_, actions) => { try { await actions.order.capture(); setMemberPaid(); alert("支付成功！页面将刷新，广告已移除。"); location.reload(); } catch (err) { alert("支付验证失败，请刷新后重试"); console.error(err); } }, onError: () => { if (state.paypalRetries > 4) dom.memberBtn.style.display = "none"; } }).render(dom.paypalWrap);
}
function bindModalEvent() { dom.memberBtn.onclick = () => dom.modal.style.display = "block"; dom.closeModal.onclick = () => dom.modal.style.display = "none"; window.onclick = (e) => e.target === dom.modal && (dom.modal.style.display = "none"); document.addEventListener("keydown", (e) => { if (e.key === "Escape" && dom.modal.style.display === "block") dom.modal.style.display = "none"; }); }

function renderStationList(rawList) {
  dom.stationList.innerHTML = ""; dom.emptyTip.style.display = "none";
  const safe = rawList.filter(isSafeStation);
  if (!safe.length) return showEmptyTip("没有找到电台，请尝试其他分类");
  safe.forEach(station => {
    const div = document.createElement("div"); div.className = "station-item";
    const favStatus = isFav(station.stationuuid);
    div.innerHTML = `<button class="fav-card-btn ${favStatus ? 'active' : ''}" data-uuid="${escapeHtml(station.stationuuid)}">${favStatus ? '★' : '☆'}</button><h4>${escapeHtml(station.name)}</h4><p>国家: ${escapeHtml(station.country || "未知")}</p><p>语言: ${escapeHtml(station.language || "未知")}</p><small>标签: ${escapeHtml((station.tags || "").slice(0, 60))}</small>`;
    div.dataset.station = JSON.stringify(station);
    dom.stationList.appendChild(div);
  });
  dom.stationList.onclick = (e) => {
    const item = e.target.closest(".station-item"); if (!item) return;
    const favBtn = e.target.closest(".fav-card-btn"); const station = JSON.parse(item.dataset.station);
    if (favBtn) { e.stopPropagation(); const newState = toggleFav(station); favBtn.textContent = newState ? "★" : "☆"; favBtn.classList.toggle("active", newState); return; }
    playStation(station);
  };
}
async function playStation(station) {
  dom.audioPlayer.pause(); dom.audioPlayer.src = ""; dom.audioPlayer.load();
  try { dom.playTitle.innerText = escapeHtml(station.name); dom.audioPlayer.src = station.url; await dom.audioPlayer.play(); addHistory(station); } catch (err) { dom.playTitle.innerText = "该电台无法播放，试试其他的吧"; console.error("播放失败:", err); }
}
function updatePageText() { dom.pageNumText.textContent = `第 ${state.currentPage} 页`; }

// ========== 国家列表（强制显示后备列表） ==========
const FALLBACK_COUNTRIES = [
  "United States", "United Kingdom", "Canada", "Australia", "Germany", "France", "Italy", "Spain",
  "Japan", "China", "India", "Brazil", "Mexico", "Netherlands", "Sweden", "Norway", "Poland", "Russia"
];
async function loadCachedCountries() {
  try {
    const cacheStr = localStorage.getItem(STORAGE_COUNTRY_CACHE);
    if (cacheStr) {
      const cache = JSON.parse(cacheStr);
      if (Date.now() - cache.time < CACHE_EXPIRE) {
        state.fullCountryList = cache.data;
        renderCountryButtons(state.fullCountryList);
        return;
      }
    }
  } catch {}
  
  let data = await safeFetch("/countries", fetchOption);
  let useFallback = false;
  if (!data || data.length === 0) {
    useFallback = true;
    data = FALLBACK_COUNTRIES.map(name => ({ name, stationcount: 0 }));
  }
  state.fullCountryList = data;
  try { localStorage.setItem(STORAGE_COUNTRY_CACHE, JSON.stringify({ time: Date.now(), data })); } catch {}
  renderCountryButtons(data);
  if (useFallback) {
    showEmptyTip("国家列表加载失败，使用内置列表（仍可正常使用）");
  }
}
function renderCountryButtons(list) {
  dom.countryBtnWrap.innerHTML = "";
  if (!list || list.length === 0) {
    dom.countryBtnWrap.innerHTML = "<p style='padding:10px;text-align:center;'>暂无国家数据</p>";
    return;
  }
  list.forEach(ct => {
    const btn = document.createElement("button");
    btn.className = "country-btn";
    btn.textContent = `${escapeHtml(ct.name)} (${ct.stationcount || 0})`;
    btn.dataset.country = ct.name;
    btn.onclick = () => loadByCountry(ct.name);
    dom.countryBtnWrap.appendChild(btn);
  });
}

async function loadByCountry(countryName) {
  showLoading();
  hideAllFilter();
  dom.countryFilter.style.display = "flex";

  let stations = [];
  const variants = [countryName, countryName.toLowerCase(), countryName.charAt(0).toUpperCase() + countryName.slice(1).toLowerCase()];
  for (const v of variants) {
    const url = `/stations/search?country=${encodeURIComponent(v)}&limit=120`;
    const data = await safeFetch(url, fetchOption);
    if (data && data.length > 0) {
      stations = data;
      break;
    }
  }
  if (stations.length === 0) {
    const topData = await safeFetch("/stations/topclick/500", fetchOption);
    if (topData && topData.length) {
      const lowerName = countryName.toLowerCase();
      stations = topData.filter(station => {
        const c = (station.country || "").toLowerCase();
        return c.includes(lowerName);
      });
    }
  }
  if (stations.length === 0) {
    showEmptyTip(`未找到 ${countryName} 的电台，请稍后重试或选择其他国家。`);
    hideLoading();
    return;
  }
  renderStationList(stations);
  hideLoading();
}

// ========== 主要语言列表 ==========
const MAJOR_LANGUAGES = [
  { name: "English", code: "en", keywords: ["english", "en"] },
  { name: "Chinese", code: "zh", keywords: ["chinese", "zh", "chi", "zho"] },
  { name: "Spanish", code: "es", keywords: ["spanish", "es"] },
  { name: "French", code: "fr", keywords: ["french", "fr"] },
  { name: "German", code: "de", keywords: ["german", "de"] },
  { name: "Japanese", code: "ja", keywords: ["japanese", "ja"] },
  { name: "Korean", code: "ko", keywords: ["korean", "ko"] },
  { name: "Arabic", code: "ar", keywords: ["arabic", "ar"] },
  { name: "Russian", code: "ru", keywords: ["russian", "ru"] },
  { name: "Portuguese", code: "pt", keywords: ["portuguese", "pt"] },
  { name: "Italian", code: "it", keywords: ["italian", "it"] }
];

function renderLanguageButtons() {
  dom.langBtnWrap.innerHTML = "";
  const displays = {
    English: "🇬🇧 English (英语)", Chinese: "🇨🇳 Chinese (汉语)", Spanish: "🇪🇸 Spanish (西班牙语)",
    French: "🇫🇷 French (法语)", German: "🇩🇪 German (德语)", Japanese: "🇯🇵 Japanese (日语)",
    Korean: "🇰🇷 Korean (韩语)", Arabic: "🇸🇦 Arabic (阿拉伯语)", Russian: "🇷🇺 Russian (俄语)",
    Portuguese: "🇵🇹 Portuguese (葡萄牙语)", Italian: "🇮🇹 Italian (意大利语)"
  };
  MAJOR_LANGUAGES.forEach(lang => {
    const btn = document.createElement("button");
    btn.className = "lang-btn";
    btn.textContent = displays[lang.name];
    btn.dataset.lang = lang.name;
    btn.dataset.code = lang.code;
    btn.onclick = () => loadByLanguage(lang);
    dom.langBtnWrap.appendChild(btn);
  });
}

async function loadByLanguage(lang) {
  showLoading();
  hideAllFilter();
  dom.langFilter.style.display = "flex";

  let stations = [];
  const queries = [];
  queries.push(`language=${encodeURIComponent(lang.name)}`);
  queries.push(`language=${encodeURIComponent(lang.name.toLowerCase())}`);
  queries.push(`language=${encodeURIComponent(lang.code)}`);
  queries.push(`languagecode=${encodeURIComponent(lang.code)}`);
  for (let kw of lang.keywords) {
    if (kw !== lang.name.toLowerCase() && kw !== lang.code) {
      queries.push(`language=${encodeURIComponent(kw)}`);
    }
  }
  for (const q of queries) {
    const url = `/stations/search?${q}&limit=120`;
    const data = await safeFetch(url, fetchOption);
    if (data && data.length > 0) {
      stations = data;
      break;
    }
  }
  if (stations.length === 0) {
    const topData = await safeFetch("/stations/topclick/500", fetchOption);
    if (topData && topData.length) {
      const lowerKeywords = lang.keywords.map(k => k.toLowerCase());
      stations = topData.filter(station => {
        const langField = (station.language || "").toLowerCase();
        return lowerKeywords.some(kw => langField.includes(kw));
      });
      if (stations.length === 0) {
        stations = topData.filter(station => {
          const countryField = (station.country || "").toLowerCase();
          return countryField.includes(lang.name.toLowerCase()) || countryField.includes(lang.code);
        });
      }
    }
  }
  if (stations.length === 0) {
    showEmptyTip(`未找到 ${lang.name} 语言的电台，请稍后重试或选择其他语言。`);
    hideLoading();
    return;
  }
  renderStationList(stations);
  hideLoading();
}

async function loadHot() { showLoading(); hideAllFilter(); const data = await safeFetch("/stations/topclick/100", fetchOption); renderStationList(data); hideLoading(); }
async function loadAllStations() { showLoading(); dom.typeFilter.style.display = "none"; dom.countryFilter.style.display = "none"; dom.langFilter.style.display = "none"; dom.pageBox.style.display = "flex"; const offset = (state.currentPage - 1) * pageSize; const data = await safeFetch(`/stations?limit=${pageSize}&offset=${offset}`, fetchOption); renderStationList(data); updatePageText(); hideLoading(); }
async function loadByTag(tag) { showLoading(); hideAllFilter(); dom.typeFilter.style.display = "flex"; const data = await safeFetch(`/stations/search?tag=${encodeURIComponent(tag)}&limit=120`, fetchOption); renderStationList(data); hideLoading(); }

const handleSearch = debounce(async () => {
  const q = dom.searchInput.value.trim();
  if (!q) {
    showEmptyTip("请输入搜索关键词");
    return;
  }
  showLoading();
  hideAllFilter();
  dom.pageBox.style.display = "none";

  let stations = [];
  for (const mirror of API_MIRRORS) {
    const url = `${mirror}/stations/search?q=${encodeURIComponent(q)}&limit=100`;
    try {
      const res = await fetch(url, fetchOption);
      if (res.ok) {
        const data = await res.json();
        if (data && data.length) {
          stations = data;
          break;
        }
      }
    } catch (e) {
      console.warn(`搜索镜像 ${mirror} 失败`, e);
    }
  }
  if (stations.length === 0) {
    showEmptyTip(`没有找到与“${q}”相关的电台，请尝试其他关键词`);
    hideLoading();
    return;
  }
  renderStationList(stations);
  hideLoading();
});

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
        case "type": hideAllFilter(); dom.typeFilter.style.display = "flex"; showEmptyTip("点击上方标签浏览"); break;
        case "country": hideAllFilter(); dom.countryFilter.style.display = "flex"; showEmptyTip("点击下方国家加载电台"); await loadCachedCountries(); break;
        case "lang": hideAllFilter(); dom.langFilter.style.display = "flex"; renderLanguageButtons(); showEmptyTip("点击下方语言加载电台"); break;
      }
    };
  });
}
function bindPageEvents() { dom.prevPage.onclick = async () => { if (state.nowView !== "all" || state.currentPage <= 1) return; state.currentPage--; await loadAllStations(); }; dom.nextPage.onclick = async () => { if (state.nowView !== "all") return; state.currentPage++; await loadAllStations(); }; }
function bindVisibilityPause() { document.addEventListener("visibilitychange", () => { if (document.hidden && !dom.audioPlayer.paused) dom.audioPlayer.pause(); }); window.addEventListener('beforeunload', () => { dom.audioPlayer.pause(); dom.audioPlayer.src = ""; }); }
function bindAllEvents() {
  dom.favBtnTop.onclick = loadFavList; dom.historyBtnTop.onclick = loadHistoryList; dom.themeBtn.onclick = toggleTheme;
  dom.searchBtn.onclick = handleSearch; dom.searchInput.addEventListener("keydown", e => e.key === "Enter" && handleSearch());
  dom.typeBtns.forEach(btn => btn.onclick = () => loadByTag(btn.dataset.tag));
  bindNavEvents(); bindPageEvents(); bindModalEvent(); bindVisibilityPause();
}
async function initApp() { initTheme(); initAdState(); bindAllEvents(); await loadHot(); setTimeout(initPayPal, 1200); }
window.addEventListener("DOMContentLoaded", initApp);
