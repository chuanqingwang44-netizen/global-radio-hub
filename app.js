const API_BASE = "https://api.radio-browser.info/json";
const UA_LIST = [
    "GlobalRadioHub/1.0 (Contact: your-email@xxx.com)",
    "RadioHubWeb/1.0; contact wcqyt@163.com",
    "GlobalFMHub StaticSite/CloudflarePages"
];
function getRandomUA(){ return UA_LIST[Math.floor(Math.random()*UA_LIST.length)]; }
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
const STORAGE_LANG_CACHE = "radio_lang_cache";
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
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

async function safeFetch(url, opt) {
    if (fetchLock) return [];
    fetchLock = true;
    try {
        const res = await Promise.race([
            fetch(url, opt),
            new Promise((_, rej) => setTimeout(() => rej("timeout"), 8000))
        ]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.error("Fetch fail:", e);
        showEmptyTip("Failed to load stations, please try again later");
        return [];
    } finally {
        setTimeout(() => fetchLock = false, 1000);
    }
}

const dom = {
    searchInput: document.getElementById("searchInput"),
    searchBtn: document.getElementById("searchBtn"),
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
    countrySearchInput: document.getElementById("countrySearch"),
    langFilter: document.getElementById("langFilter"),
    langBtnWrap: document.getElementById("langBtnWrap"),
    langSearchInput: document.getElementById("langSearch"),
    pageBox: document.getElementById("pageBox"),
    prevPage: document.getElementById("prevPage"),
    nextPage: document.getElementById("nextPage"),
    pageNumText: document.getElementById("pageNum"),
    adWrappers: document.querySelectorAll(".ad-wrapper")
};

let state = {
    currentPage: 1,
    nowView: "hot",
    fullCountryList: [],
    fullLangList: [],
    paypalRetries: 0
};

function isMember() {
    try { return localStorage.getItem(STORAGE_MEMBER_KEY) === "paid"; }
    catch { return false; }
}
function setMemberPaid() {
    try { localStorage.setItem(STORAGE_MEMBER_KEY, "paid"); }
    catch {}
    document.documentElement.classList.add("no-ad");
}
function initAdState() {
    if (isMember()) document.documentElement.classList.add("no-ad");
}

function showLoading() { dom.loadingTip.style.display = "block"; dom.emptyTip.style.display = "none"; }
function hideLoading() { dom.loadingTip.style.display = "none"; }
function showEmptyTip(text) { dom.emptyTip.textContent = text; dom.emptyTip.style.display = "block"; dom.stationList.innerHTML = ""; }

function hideAllFilter() {
    dom.pageBox.style.display = "none";
    dom.typeFilter.style.display = "none";
    dom.countryFilter.style.display = "none";
    dom.langFilter.style.display = "none";
}

function getFavorites() {
    try { const raw = localStorage.getItem(STORAGE_FAV_KEY); return raw ? JSON.parse(raw) : []; }
    catch { return []; }
}
function saveFavorites(list) {
    try { localStorage.setItem(STORAGE_FAV_KEY, JSON.stringify(list)); }
    catch {}
}
function isFav(uuid) {
    return getFavorites().some(s => s.stationuuid === uuid);
}
function toggleFav(stationObj) {
    let favs = getFavorites();
    const idx = favs.findIndex(s => s.stationuuid === stationObj.stationuuid);
    if (idx > -1) favs.splice(idx,1); else favs.push(stationObj);
    saveFavorites(favs);
    return idx === -1;
}
function loadFavList() {
    hideAllFilter();
    const favs = getFavorites();
    if (!favs.length) return showEmptyTip("No favorite stations yet. Click ☆ on stations to save.");
    renderStationList(favs);
}

function getHistory() {
    try { const raw = localStorage.getItem(STORAGE_HIST_KEY); return raw ? JSON.parse(raw) : []; }
    catch { return []; }
}
function saveHistory(list) {
    try { localStorage.setItem(STORAGE_HIST_KEY, JSON.stringify(list)); }
    catch {}
}
function addHistory(stationObj) {
    let hist = getHistory().filter(s => s.stationuuid !== stationObj.stationuuid);
    hist.unshift(stationObj);
    if (hist.length > HIST_MAX) hist.pop();
    saveHistory(hist);
}
function loadHistoryList() {
    hideAllFilter();
    const hist = getHistory();
    if (!hist.length) return showEmptyTip("No play history yet.");
    renderStationList(hist);
}

function initTheme() {
    let saved = "light";
    try { saved = localStorage.getItem(STORAGE_THEME_KEY) || "light"; }
    catch {}
    document.documentElement.className = saved + (isMember() ? " no-ad" : "");
}
function toggleTheme() {
    const html = document.documentElement;
    const adClass = html.classList.contains("no-ad") ? " no-ad" : "";
    const newTheme = html.classList.contains("light") ? "dark" : "light";
    html.className = newTheme + adClass;
    try { localStorage.setItem(STORAGE_THEME_KEY, newTheme); }
    catch {}
}

function loadPayPal() {
    if (document.querySelector('#paypal-sdk')) return;
    const script = document.createElement('script');
    script.id = 'paypal-sdk';
    script.src = 'https://www.paypal.com/sdk/js?client-id=YOUR_PAYPAL_CLIENT_ID&currency=USD';
    script.defer = true;
    document.head.appendChild(script);
}

function initPayPal() {
    state.paypalRetries++;
    if (state.paypalRetries > 8) { dom.memberBtn.style.display = "none"; return; }
    if (typeof paypal === "undefined") { loadPayPal(); setTimeout(initPayPal, 800); return; }
    paypal.Buttons({
        createOrder: (_, actions) => actions.order.create({
            purchase_units: [{ amount: { value: "1.99" } }]
        }),
        onApprove: async (_, actions) => {
            try {
                await actions.order.capture();
                setMemberPaid();
                alert("Payment success! Refreshing to enable ad-free mode.");
                location.reload();
            } catch (err) {
                alert("Payment verify failed, please refresh and try again");
                console.error(err);
            }
        },
        onError: () => {
            if(state.paypalRetries>4) dom.memberBtn.style.display="none";
        }
    }).render(dom.paypalWrap);
}

function bindModalEvent() {
    dom.memberBtn.onclick = () => dom.modal.style.display = "block";
    dom.closeModal.onclick = () => dom.modal.style.display = "none";
    window.onclick = (e) => e.target === dom.modal && (dom.modal.style.display = "none");
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && dom.modal.style.display === "block") dom.modal.style.display = "none";
    });
}

function renderStationList(rawList) {
    dom.stationList.innerHTML = "";
    dom.emptyTip.style.display = "none";
    const safe = rawList.filter(isSafeStation);
    if (!safe.length) return showEmptyTip("No matching radio stations found");
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

async function playStation(station) {
    dom.audioPlayer.pause();
    dom.audioPlayer.src = "";
    dom.audioPlayer.load();
    try {
        dom.playTitle.innerText = escapeHtml(station.name);
        dom.audioPlayer.src = station.url;
        await dom.audioPlayer.play();
        addHistory(station);
    } catch (err) {
        dom.playTitle.innerText = "Stream unavailable, try another station";
        console.error("Play fail:", err);
    }
}

function updatePageText() { dom.pageNumText.textContent = `Page ${state.currentPage}`; }

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
    const data = await safeFetch(`${API_BASE}/countries`, fetchOption);
    state.fullCountryList = data;
    try { localStorage.setItem(STORAGE_COUNTRY_CACHE, JSON.stringify({time: Date.now(), data})); } catch {}
    renderCountryButtons(data);
}
async function loadCachedLanguages() {
    try {
        const cacheStr = localStorage.getItem(STORAGE_LANG_CACHE);
        if (cacheStr) {
            const cache = JSON.parse(cacheStr);
            if (Date.now() - cache.time < CACHE_EXPIRE) {
                state.fullLangList = cache.data;
                renderLangButtons(state.fullLangList);
                return;
            }
        }
    } catch {}
    const data = await safeFetch(`${API_BASE}/languages`, fetchOption);
    state.fullLangList = data;
    try { localStorage.setItem(STORAGE_LANG_CACHE, JSON.stringify({time: Date.now(), data})); } catch {}
    renderLangButtons(data);
}

function renderCountryButtons(list) {
    dom.countryBtnWrap.innerHTML = "";
    list.forEach(ct => {
        const btn = document.createElement("button");
        btn.className = "country-btn";
        btn.textContent = `${escapeHtml(ct.name)} (${ct.stationcount})`;
        btn.dataset.country = ct.name;
        btn.onclick = () => loadByCountry(ct.name);
        dom.countryBtnWrap.appendChild(btn);
    });
}
function renderLangButtons(list) {
    dom.langBtnWrap.innerHTML = "";
    list.forEach(lg => {
        const btn = document.createElement("button");
        btn.className = "lang-btn";
        btn.textContent = `${escapeHtml(lg.name)} (${lg.stationcount})`;
        btn.dataset.lang = lg.name;
        btn.onclick = () => loadByLang(lg.name);
        dom.langBtnWrap.appendChild(btn);
    });
}

async function loadHot() {
    showLoading();
    hideAllFilter();
    const data = await safeFetch(`${API_BASE}/stations/topclick/100`, fetchOption);
    renderStationList(data);
    hideLoading();
}
async function loadAllStations() {
    showLoading();
    dom.typeFilter.style.display = "none";
    dom.countryFilter.style.display = "none";
    dom.langFilter.style.display = "none";
    dom.pageBox.style.display = "flex";
    const offset = (state.currentPage - 1) * pageSize;
    const data = await safeFetch(`${API_BASE}/stations?limit=${pageSize}&offset=${offset}`, fetchOption);
    renderStationList(data);
    updatePageText();
    hideLoading();
}
async function loadByTag(tag) {
    showLoading();
    hideAllFilter();
    dom.typeFilter.style.display = "flex";
    const data = await safeFetch(`${API_BASE}/stations/search?tag=${encodeURIComponent(tag)}&limit=120`, fetchOption);
    renderStationList(data);
    hideLoading();
}
async function loadByCountry(name) {
    showLoading();
    hideAllFilter();
    dom.countryFilter.style.display = "flex";
    const data = await safeFetch(`${API_BASE}/stations/search?country=${encodeURIComponent(name)}&limit=120`, fetchOption);
    renderStationList(data);
    hideLoading();
}
async function loadByLang(name) {
    showLoading();
    hideAllFilter();
    dom.langFilter.style.display = "flex";
    const data = await safeFetch(`${API_BASE}/stations/search?language=${encodeURIComponent(name)}&limit=120`, fetchOption);
    renderStationList(data);
    hideLoading();
}

const handleSearch = debounce(async () => {
    const q = dom.searchInput.value.trim();
    if (!q) return;
    showLoading();
    hideAllFilter();
    const data = await safeFetch(`${API_BASE}/stations/search?q=${encodeURIComponent(q)}`, fetchOption);
    renderStationList(data);
    hideLoading();
});

const filterCountry = debounce(() => {
    const kw = dom.countrySearchInput.value.trim().toLowerCase();
    const filtered = state.fullCountryList.filter(ct => ct.name.toLowerCase().includes(kw));
    renderCountryButtons(filtered);
});
const filterLang = debounce(() => {
    const kw = dom.langSearchInput.value.trim().toLowerCase();
    const filtered = state.fullLangList.filter(lg => lg.name.toLowerCase().includes(kw));
    renderLangButtons(filtered);
});

function bindNavEvents() {
    dom.mainNavBtns.forEach(btn => {
        btn.onclick = async () => {
            dom.mainNavBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            state.nowView = btn.dataset.view;
            state.currentPage = 1;
            switch(state.nowView) {
                case "hot": await loadHot(); break;
                case "all": await loadAllStations(); break;
                case "type":
                    hideAllFilter();
                    dom.typeFilter.style.display = "flex";
                    showEmptyTip("Pick a genre tag above");
                    break;
                case "country":
                    hideAllFilter();
                    dom.countryFilter.style.display = "flex";
                    showEmptyTip("Search or click a country to load stations");
                    if (!state.fullCountryList.length) await loadCachedCountries();
                    break;
                case "lang":
                    hideAllFilter();
                    dom.langFilter.style.display = "flex";
                    showEmptyTip("Search or click a language to load stations");
                    if (!state.fullLangList.length) await loadCachedLanguages();
                    break;
            }
        };
    });
}

function bindPageEvents() {
    dom.prevPage.onclick = async () => {
        if (state.nowView !== "all" || state.currentPage <=1) return;
        state.currentPage--;
        await loadAllStations();
    };
    dom.nextPage.onclick = async () => {
        if (state.nowView !== "all") return;
        state.currentPage++;
        await loadAllStations();
    };
}

function bindVisibilityPause() {
    document.addEventListener("visibilitychange", () => {
        if (document.hidden && !dom.audioPlayer.paused) {
            dom.audioPlayer.pause();
        }
    });
    window.addEventListener('beforeunload',()=>{
        dom.audioPlayer.pause();
        dom.audioPlayer.src="";
    })
}

function bindAllEvents() {
    dom.favBtnTop.onclick = loadFavList;
    dom.historyBtnTop.onclick = loadHistoryList;
    dom.themeBtn.onclick = toggleTheme;
    dom.searchBtn.onclick = handleSearch;
    dom.searchInput.addEventListener("keydown", e => e.key === "Enter" && handleSearch());
    dom.countrySearchInput.addEventListener("input", filterCountry);
    dom.langSearchInput.addEventListener("input", filterLang);
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
    setTimeout(initPayPal, 1200);
}

window.addEventListener("DOMContentLoaded", initApp);
