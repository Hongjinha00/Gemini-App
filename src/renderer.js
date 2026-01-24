// DOM elements
const titlebar = document.getElementById('titlebar');

// Buttons
const btnBack = document.getElementById('btn-back');
const btnForward = document.getElementById('btn-forward');
const btnRefresh = document.getElementById('btn-refresh');
const btnScreenshot = document.getElementById('btn-screenshot');
const btnModeToggle = document.getElementById('btn-mode-toggle');
const iconGemini = document.getElementById('icon-gemini');
const iconAistudio = document.getElementById('icon-aistudio');
const btnSettings = document.getElementById('btn-settings');
const btnMinimize = document.getElementById('btn-minimize');
const btnMaximize = document.getElementById('btn-maximize');
const btnClose = document.getElementById('btn-close');

// State
let currentMode = 'gemini';
let translations = {};

// Get translation by key
function t(key) {
  const keys = key.split('.');
  let value = translations;
  for (const k of keys) {
    value = value?.[k];
  }
  return value || key;
}

// Apply translations to elements with data-i18n attributes
function applyTranslations() {
  // Apply title translations
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.title = t(key);
  });
}

// Initialize
async function init() {
  // Load translations
  const result = await window.electronAPI.getTranslations();
  translations = result.translations || {};
  applyTranslations();
  
  const settings = await window.electronAPI.getSettings();
  currentMode = settings.lastMode;
  updateModeIcons();
  
  // 스크린샷 버튼 표시 설정
  updateScreenshotButtonVisibility(settings.showScreenshotButton);
}

// 스크린샷 버튼 표시/숨김
function updateScreenshotButtonVisibility(show) {
  if (btnScreenshot) {
    btnScreenshot.style.display = show ? 'flex' : 'none';
  }
}

// Update mode icons
function updateModeIcons() {
  if (currentMode === 'gemini') {
    iconGemini.style.display = 'none';
    iconAistudio.style.display = 'block';
    btnModeToggle.title = t('titlebar.switchToAIStudio');
  } else {
    iconGemini.style.display = 'block';
    iconAistudio.style.display = 'none';
    btnModeToggle.title = t('titlebar.switchToGemini');
  }
}

// Event listeners
btnBack.addEventListener('click', () => window.electronAPI.navBack());
btnForward.addEventListener('click', () => window.electronAPI.navForward());
btnRefresh.addEventListener('click', () => window.electronAPI.navRefresh());

btnModeToggle.addEventListener('click', () => {
  const newMode = currentMode === 'gemini' ? 'aistudio' : 'gemini';
  currentMode = newMode;
  updateModeIcons();
  window.electronAPI.switchMode(newMode);
});

btnScreenshot.addEventListener('click', () => window.electronAPI.startScreenshotMode());
btnSettings.addEventListener('click', () => window.electronAPI.openSettings());

btnMinimize.addEventListener('click', () => window.electronAPI.minimizeWindow());
btnMaximize.addEventListener('click', () => window.electronAPI.maximizeWindow());
btnClose.addEventListener('click', () => window.electronAPI.closeWindow());

// IPC events
window.electronAPI.onNavState((state) => {
  btnBack.disabled = !state.canGoBack;
  btnForward.disabled = !state.canGoForward;
});

window.electronAPI.onThemeChanged((theme) => {
  if (theme === 'light') {
    titlebar.classList.add('light-theme');
  } else {
    titlebar.classList.remove('light-theme');
  }
});

window.electronAPI.onModeSwitched((mode) => {
  currentMode = mode;
  updateModeIcons();
});

// 스크린샷 모드 상태 변경
window.electronAPI.onScreenshotModeChanged((isActive) => {
  if (isActive) {
    btnScreenshot.classList.add('screenshot-active');
  } else {
    btnScreenshot.classList.remove('screenshot-active');
  }
});

// 스크린샷 버튼 표시 상태 변경
window.electronAPI.onScreenshotButtonVisibilityChanged((show) => {
  updateScreenshotButtonVisibility(show);
});

// Initialize
init();
