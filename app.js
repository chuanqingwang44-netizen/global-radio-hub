// ========== Radio Browser 镜像列表 ==========
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
    } catch (e) { console.warn(`镜像 ${mirror} 失败`); }
  }
  throw new Error("所有 API 镜像均不可用");
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
const STORAGE_MEMBER_KEY = "radio_member";
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
    showEmptyTip("无法加载电台，请稍后重试");
    return [];
  } finally { setTimeout(() => fetchLock = false, 1000); }
}

// DOM 元素
const dom = {
  stationList: document.getElementById("stationList"),
  audioPlayer: document.getElementById("audioPlayer"),
  playTitle: document.getElementById("playTitle"),
  favBtnTop: document.getElementById("favBtnTop"),
  historyBtnTop: document.getElementById("historyBtnTop"),
  themeBtn: document.getElementById("themeBtn"),
  memberBtn: document.getElementById("memberBtn"),
  loadingTip: document.getElementById("loadingTip"),
  emptyTip: document.getElementById("emptyTip"),
  modal: document.getElementById("memberModal"),
  closeModal: document.querySelector(".closeModal"),
  paypalWrap: document.getElementById("paypal-button-container"),
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
  danmakuLayer: document.getElementById("danmakuLayer"),
  danmakuToggleBtn: document.getElementById("danmakuToggleBtn"),
  danmakuInput: document.getElementById("danmakuInput"),
  sendDanmakuBtn: document.getElementById("sendDanmakuBtn"),
  shareStationBtn: document.getElementById("shareStationBtn"),
  spectrumContainer: document.getElementById("spectrumContainer")
};

// 全局状态
let state = {
  currentPage: 1,
  nowView: "hot",
  fullCountryList: [],
  paypalRetries: 0,
  currentStation: null,
  eqMode: "normal",
  audioCtx: null,
  sourceNode: null,
  eqBiquad: null,
  danmakuEnabled: true,
  danmakuTimer: null
};

// ========== 通用 UI 函数 ==========
function showLoading() { dom.loadingTip.style.display = "block"; dom.emptyTip.style.display = "none"; }
function hideLoading() { dom.loadingTip.style.display = "none"; }
function showEmptyTip(text) { dom.emptyTip.textContent = text; dom.emptyTip.style.display = "block"; dom.stationList.innerHTML = ""; }
function hideAllFilter() { 
  dom.pageBox.style.display = "none";
  dom.typeFilter.style.display = "none";
  dom.countryFilter.style.display = "none";
  dom.langFilter.style.display = "none";
}

// ========== 会员 & 主题 ==========
function isMember() { try { return localStorage.getItem(STORAGE_MEMBER_KEY) === "paid"; } catch { return false; } }
function setMemberPaid() { try { localStorage.setItem(STORAGE_MEMBER_KEY, "paid"); } catch {} document.documentElement.classList.add("no-ad"); }
function initAdState() { if (isMember()) document.documentElement.classList.add("no-ad"); }
function initTheme() {
  let saved = "light";
  try { saved = localStorage.getItem(STORAGE_THEME_KEY) || "light"; } catch {}
  document.documentElement.className = saved + (isMember() ? " no-ad" : "");
}
function toggleTheme() {
  const html = document.documentElement;
  const adClass = html.classList.contains("no-ad") ? " no-ad" : "";
  const newTheme = html.classList.contains("light") ? "dark" : "light";
  html.className = newTheme + adClass;
  try { localStorage.setItem(STORAGE_THEME_KEY, newTheme); } catch {}
}

// ========== 收藏 & 历史 ==========
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
function loadFavList() { hideAllFilter(); const favs = getFavorites(); if (!favs.length) return showEmptyTip("暂无收藏电台，点击 ☆ 添加"); renderStationList(favs); }

function getHistory() { try { return JSON.parse(localStorage.getItem(STORAGE_HIST_KEY) || "[]"); } catch { return []; } }
function saveHistory(list) { localStorage.setItem(STORAGE_HIST_KEY, JSON.stringify(list)); }
function addHistory(stationObj) {
  let hist = getHistory().filter(s => s.stationuuid !== stationObj.stationuuid);
  hist.unshift(stationObj);
  if (hist.length > HIST_MAX) hist.pop();
  saveHistory(hist);
  // 每次播放新电台后更新 AI 推荐
  updateAIRecommendation();
}
function loadHistoryList() { hideAllFilter(); const hist = getHistory(); if (!hist.length) return showEmptyTip("暂无播放历史"); renderStationList(hist); }

// ========== 渲染电台列表 ==========
function renderStationList(rawList) {
  dom.stationList.innerHTML = "";
  dom.emptyTip.style.display = "none";
  const safe = rawList.filter(isSafeStation);
  if (!safe.length) return showEmptyTip("没有找到电台，请尝试其他分类");
  safe.forEach(station => {
    const div = document.createElement("div");
    div.className = "station-item";
    const favStatus = isFav(station.stationuuid);
    div.innerHTML = `
      <button class="fav-card-btn ${favStatus ? 'active' : ''}" data-uuid="${escapeHtml(station.stationuuid)}">${favStatus ? '★' : '☆'}</button>
      <h4>${escapeHtml(station.name)}</h4>
      <p>国家: ${escapeHtml(station.country || "未知")}</p>
      <p>语言: ${escapeHtml(station.language || "未知")}</p>
      <small>标签: ${escapeHtml((station.tags || "").slice(0, 60))}</small>
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

// ========== 动态均衡器 (Web Audio API) ==========
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
  if (mode === "bass") {
    state.eqBiquad.gain.value = 12;   // 低音增强
  } else if (mode === "vocal") {
    state.eqBiquad.gain.value = -4;   // 衰减低频使人声突出
    // 实际可增加中高频，简化版
  } else {
    state.eqBiquad.gain.value = 0;
  }
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

// ========== AI 推荐 (基于历史记录) ==========
async function updateAIRecommendation() {
  const history = getHistory();
  if (history.length === 0) {
    if (dom.aiRecommendBox) dom.aiRecommendBox.style.display = "none";
    return;
  }
  // 统计偏好标签和国家
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
  // 获取热门电台候选
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
  // 去重、排除当前正在播放的电台
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

// ========== 弹幕系统 ==========
function addDanmaku(text) {
  if (!state.danmakuEnabled) return;
  const danmakuDiv = document.createElement("div");
  danmakuDiv.textContent = text;
  danmakuDiv.style.position = "absolute";
  danmakuDiv.style.whiteSpace = "nowrap";
  danmakuDiv.style.left = "100%";
  danmakuDiv.style.top = Math.random() * 35 + "px";
  danmakuDiv.style.fontSize = "14px";
  danmakuDiv.style.background = "rgba(0,0,0,0.7)";
  danmakuDiv.style.color = "#fff";
  danmakuDiv.style.padding = "4px 16px";
  danmakuDiv.style.borderRadius = "40px";
  danmakuDiv.style.animation = "danmakuMove 8s linear forwards";
  dom.danmakuLayer.appendChild(danmakuDiv);
  setTimeout(() => danmakuDiv.remove(), 8000);
}
// 注入弹幕动画样式
if (!document.querySelector("#danmakuStyle")) {
  const style = document.createElement("style");
  style.id = "danmakuStyle";
  style.textContent = `@keyframes danmakuMove { 0% { transform: translateX(0); } 100% { transform: translateX(-120vw); } }`;
  document.head.appendChild(style);
}
function toggleDanmaku() {
  state.danmakuEnabled = !state.danmakuEnabled;
  dom.danmakuToggleBtn.textContent = state.danmakuEnabled ? "💬 弹幕开" : "💬 弹幕关";
}
function sendDanmaku() {
  let text = dom.danmakuInput.value.trim();
  if (!text) return;
  addDanmaku(text);
  dom.danmakuInput.value = "";
}

// ========== 分享电台功能 ==========
function shareCurrentStation() {
  if (!state.currentStation) {
    alert("请先播放一个电台再分享");
    return;
  }
  const stationName = state.currentStation.name;
  const stationUrl = state.currentStation.url;
  const shareText = `我正在用 Global Radio Hub 收听《${stationName}》，一起来听吧！ ${stationUrl}`;
  // 尝试使用 Web Share API
  if (navigator.share) {
    navigator.share({
      title: stationName,
      text: shareText,
      url: stationUrl
    }).catch(err => console.log("分享取消", err));
  } else {
    // 降级：复制到剪贴板
    navigator.clipboard.writeText(shareText).then(() => {
      alert("✅ 分享文本已复制到剪贴板，可粘贴给好友！");
    }).catch(() => alert("无法复制，请手动复制"));
  }
}

// ========== 播放核心 ==========
async function playStation(station) {
  // 隐藏频谱动画（稍后播放成功再显示）
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
    // 显示频谱
    if (dom.spectrumContainer) dom.spectrumContainer.style.display = "flex";
    // 初始化均衡器（如果未初始化）
    await setupEqualizer();
    if (state.audioCtx && state.audioCtx.state === 'suspended') await state.audioCtx.resume();
  } catch (err) {
    dom.playTitle.innerText = "❌ 该电台无法播放，试试其他的吧";
    console.error("播放失败:", err);
    if (dom.spectrumContainer) dom.spectrumContainer.style.display = "none";
  }
}

// ========== 电台数据加载（保留原有逻辑） ==========
async function loadHot() { showLoading(); hideAllFilter(); const data = await safeFetch("/stations/topclick/100", fetchOption); renderStationList(data); hideLoading(); }
async function loadAllStations() { showLoading(); dom.pageBox.style.display = "flex"; const offset = (state.currentPage - 1) * pageSize; const data = await safeFetch(`/stations?limit=${pageSize}&offset=${offset}`, fetchOption); renderStationList(data); updatePageText(); hideLoading(); }
async function loadByTag(tag) { showLoading(); hideAllFilter(); const data = await safeFetch(`/stations/search?tag=${encodeURIComponent(tag)}&limit=120`, fetchOption); renderStationList(data); hideLoading(); }
async function loadByCountryCode(countryCode) { showLoading(); hideAllFilter(); let stations = await safeFetch(`/stations/search?countrycode=${encodeURIComponent(countryCode)}&limit=120`, fetchOption); if (!stations.length) { const topData = await safeFetch("/stations/topclick/500", fetchOption); stations = topData.filter(s => (s.countrycode || "").toLowerCase() === countryCode.toLowerCase()); } renderStationList(stations); hideLoading(); }
async function loadByLanguageKey(langKey) { showLoading(); hideAllFilter(); let stations = await safeFetch(`/stations/search?language=${encodeURIComponent(langKey)}&limit=120`, fetchOption); if (!stations.length) { const topData = await safeFetch("/stations/topclick/500", fetchOption); stations = topData.filter(s => (s.language || "").toLowerCase().includes(langKey)); } renderStationList(stations); hideLoading(); }

// 国家列表（下拉框）
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
  defaultOption.textContent = "-- 选择国家 --";
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
function updatePageText() { dom.pageNumText.textContent = `第 ${state.currentPage} 页`; }

// 导航事件
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
        case "country": hideAllFilter(); dom.countryFilter.style.display = "flex"; await loadCachedCountries(); showEmptyTip("从下拉框选择国家"); break;
        case "lang": hideAllFilter(); dom.langFilter.style.display = "flex"; renderLanguageButtons(); bindLanguageEvents(); showEmptyTip("点击语言加载电台"); break;
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

// 简单 PayPal 演示
function loadPayPal() { if (document.querySelector('#paypal-sdk')) return; const script = document.createElement('script'); script.id = 'paypal-sdk'; script.src = 'https://www.paypal.com/sdk/js?client-id=YOUR_PAYPAL_CLIENT_ID&currency=USD'; script.defer = true; document.head.appendChild(script); }
function initPayPal() {
  state.paypalRetries++;
  if (state.paypalRetries > 8) { dom.memberBtn.style.display = "none"; return; }
  if (typeof paypal === "undefined") { loadPayPal(); setTimeout(initPayPal, 800); return; }
  paypal.Buttons({
    createOrder: (_, actions) => actions.order.create({ purchase_units: [{ amount: { value: "1.99" } }] }),
    onApprove: async (_, actions) => { await actions.order.capture(); setMemberPaid(); alert("支付成功！页面将刷新，广告已移除。"); location.reload(); },
    onError: () => { if (state.paypalRetries > 4) dom.memberBtn.style.display = "none"; }
  }).render(dom.paypalWrap);
}
function bindModalEvent() {
  dom.memberBtn.onclick = () => dom.modal.style.display = "block";
  dom.closeModal.onclick = () => dom.modal.style.display = "none";
  window.onclick = (e) => e.target === dom.modal && (dom.modal.style.display = "none");
}

// ========== 生成频谱柱 (纯视觉) ==========
function initSpectrum() {
  if (!dom.spectrumContainer) return;
  for (let i = 0; i < 30; i++) {
    const bar = document.createElement("div");
    bar.className = "spectrum-bar";
    dom.spectrumContainer.appendChild(bar);
  }
  // 添加简单动画样式模拟频谱跳动（纯CSS）
  const style = document.createElement("style");
  style.textContent = `
    .spectrum-container { display: flex; align-items: flex-end; gap: 2px; height: 60px; margin-top: 12px; }
    .spectrum-bar { flex: 1; background: linear-gradient(180deg, #1e90ff, #8b5cf6); border-radius: 2px; animation: bounce 0.4s infinite alternate ease-in-out; transform-origin: bottom; }
    @keyframes bounce { 0% { height: 8px; } 100% { height: 55px; } }
    .spectrum-bar:nth-child(odd) { animation-duration: 0.3s; }
    .spectrum-bar:nth-child(even) { animation-duration: 0.5s; }
  `;
  document.head.appendChild(style);
}

// ========== 应用初始化 ==========
async function initApp() {
  initTheme();
  initAdState();
  bindNavEvents();
  bindPageEvents();
  bindModalEvent();
  bindVisibilityPause();
  bindEQButtons();
  initSpectrum();
  // 弹幕按钮和发送
  if (dom.danmakuToggleBtn) dom.danmakuToggleBtn.onclick = toggleDanmaku;
  if (dom.sendDanmakuBtn) dom.sendDanmakuBtn.onclick = sendDanmaku;
  if (dom.danmakuInput) dom.danmakuInput.addEventListener("keypress", e => { if (e.key === "Enter") sendDanmaku(); });
  if (dom.shareStationBtn) dom.shareStationBtn.onclick = shareCurrentStation;
  // 类型按钮绑定
  dom.typeBtns.forEach(btn => btn.onclick = () => loadByTag(btn.dataset.tag));
  dom.favBtnTop.onclick = loadFavList;
  dom.historyBtnTop.onclick = loadHistoryList;
  dom.themeBtn.onclick = toggleTheme;
  await loadHot();
  setTimeout(initPayPal, 1200);
}

window.addEventListener("DOMContentLoaded", initApp);
