const { app, BaseWindow, WebContentsView, globalShortcut, ipcMain, Tray, Menu, screen, nativeImage, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

// Windows에서 작업 관리자/작업 표시줄에 앱 이름 표시
if (process.platform === 'win32') {
  app.setAppUserModelId('Gemini App');
}
app.setName('Gemini App');

// 번역 시스템
let translations = {};
let currentLang = 'en';

function loadTranslations(lang) {
  const langFile = path.join(__dirname, 'locales', `${lang}.json`);
  const defaultFile = path.join(__dirname, 'locales', 'en.json');
  
  try {
    // 기본 영어 번역 로드
    translations = JSON.parse(fs.readFileSync(defaultFile, 'utf8'));
    
    // 요청된 언어가 영어가 아니면 해당 언어 로드
    if (lang !== 'en' && fs.existsSync(langFile)) {
      const langTranslations = JSON.parse(fs.readFileSync(langFile, 'utf8'));
      translations = { ...translations, ...langTranslations };
    }
    
    currentLang = lang;
  } catch (error) {
    console.error('번역 파일 로드 오류:', error);
  }
}

function t(key) {
  const keys = key.split('.');
  let value = translations;
  for (const k of keys) {
    value = value?.[k];
  }
  return value || key;
}

// 시스템 언어 감지
function getSystemLanguage() {
  const locale = app.getLocale(); // 예: 'ko', 'ko-KR', 'en', 'en-US'
  const lang = locale.split('-')[0];
  // 지원하는 언어인지 확인
  if (['ko', 'en'].includes(lang)) {
    return lang;
  }
  return 'en'; // 기본값
}

// 설정 저장소
const store = new Store({
  defaults: {
    shortcut: 'Shift+Z',
    alwaysOnTop: true,
    startWithWindows: true,
    lastMode: 'gemini',
    language: 'auto', // 기본값: 시스템 언어
  }
});

// 앱 상태
let mainWindow = null;
let contentView = null;
let loadingView = null;
let settingsView = null;
let tray = null;
let isQuitting = false;
let currentMode = 'gemini';

// 기본 창 설정
const DEFAULT_WIDTH = 460;
const DEFAULT_HEIGHT = 670;
const TITLEBAR_HEIGHT = 32;

// 창 상태 (세션 중에만 유지)
let windowState = {
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
  x: null,
  y: null
};

// URL 정의 (기본)
const BASE_URLS = {
  gemini: 'https://gemini.google.com/app',
  aistudio: 'https://aistudio.google.com/'
};

// 언어 설정이 적용된 URL 가져오기
function getURL(mode) {
  const lang = store.get('language');
  const baseUrl = BASE_URLS[mode];
  // auto이면 시스템 언어 사용, 아니면 설정된 언어 사용
  const actualLang = lang === 'auto' ? getSystemLanguage() : lang;
  return `${baseUrl}?hl=${actualLang}`;
}

// 현재 앱 UI 언어 가져오기
function getAppLanguage() {
  const lang = store.get('language');
  return lang === 'auto' ? getSystemLanguage() : lang;
}

// Chrome User-Agent (최신 버전)
const CHROME_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function createWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  
  const x = windowState.x ?? Math.round((screenWidth - windowState.width) / 2);
  const y = windowState.y ?? Math.round((screenHeight - windowState.height) / 2 - 50);

  mainWindow = new BaseWindow({
    width: windowState.width,
    height: windowState.height,
    x: x,
    y: y,
    frame: false,
    alwaysOnTop: store.get('alwaysOnTop'),
    show: false,
    skipTaskbar: false,
    icon: path.join(__dirname, '..', 'assets', 'icon.ico')
  });

  // 타이틀바 WebContentsView 생성
  const titlebarView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  mainWindow.contentView.addChildView(titlebarView);

  // 콘텐츠 WebContentsView 생성 (Gemini/AI Studio용)
  contentView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'persist:gemini'
    }
  });
  mainWindow.contentView.addChildView(contentView);

  // 로딩 WebContentsView 생성
  loadingView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // 설정 모달 WebContentsView 생성
  settingsView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      transparent: true
    }
  });
  settingsView.setBackgroundColor('#00000000');

  // titlebarView를 mainWindow.webContents처럼 사용하기 위해 참조 저장
  mainWindow.titlebarView = titlebarView;

  // View 크기 조정
  const updateBounds = () => {
    const [width, height] = mainWindow.getSize();
    titlebarView.setBounds({
      x: 0,
      y: 0,
      width: width,
      height: TITLEBAR_HEIGHT
    });
    contentView.setBounds({
      x: 0,
      y: TITLEBAR_HEIGHT,
      width: width,
      height: height - TITLEBAR_HEIGHT
    });
    loadingView.setBounds({
      x: 0,
      y: TITLEBAR_HEIGHT,
      width: width,
      height: height - TITLEBAR_HEIGHT
    });
    settingsView.setBounds({
      x: 0,
      y: 0,
      width: width,
      height: height
    });
  };

  // 로딩 화면 HTML 생성 함수
  const getLoadingHTML = (mode) => {
    const text = mode === 'gemini' ? t('loading.switchingToGemini') : t('loading.switchingToAIStudio');
    return `data:text/html;charset=utf-8,<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { 
  background: %23131314; 
  display: flex; 
  align-items: center; 
  justify-content: center; 
  height: 100vh;
  opacity: 0;
  animation: fadeIn 0.25s ease forwards;
}
body.fade-out { animation: fadeOut 0.25s ease forwards; }
.loading-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  transform: scale(0.95);
  animation: scaleIn 0.25s ease forwards;
}
body.fade-out .loading-content { 
  animation: scaleOut 0.25s ease forwards;
}
.spinner { 
  width: 40px; 
  height: 40px; 
  border: 3px solid rgba(138, 180, 248, 0.2); 
  border-top-color: %238ab4f8; 
  border-radius: 50%25; 
  animation: spin 0.8s linear infinite; 
}
.loading-text {
  color: %23e3e3e3;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  font-weight: 500;
}
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
@keyframes scaleIn { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes scaleOut { from { transform: scale(1); opacity: 1; } to { transform: scale(0.95); opacity: 0; } }
@keyframes spin { to { transform: rotate(360deg); } }
</style></head>
<body>
  <div class="loading-content">
    <div class="spinner"></div>
    <div class="loading-text">${text}</div>
  </div>
</body></html>`;
  };

  // 로딩 화면 표시/숨기기
  mainWindow.showLoading = (mode) => {
    loadingView.webContents.loadURL(getLoadingHTML(mode || currentMode));
    try { mainWindow.contentView.removeChildView(loadingView); } catch(e) {}
    mainWindow.contentView.addChildView(loadingView);
  };

  mainWindow.hideLoading = () => {
    try {
      loadingView.webContents.executeJavaScript(`document.body.classList.add('fade-out');`);
      setTimeout(() => {
        try { mainWindow.contentView.removeChildView(loadingView); } catch(e) {}
      }, 250);
    } catch (e) {}
  };

  // 설정 모달 표시/숨기기
  mainWindow.showSettings = () => {
    settingsView.webContents.loadFile(path.join(__dirname, 'settings.html'));
    try { mainWindow.contentView.removeChildView(settingsView); } catch(e) {}
    mainWindow.contentView.addChildView(settingsView);
  };

  mainWindow.hideSettings = () => {
    try {
      mainWindow.contentView.removeChildView(settingsView);
    } catch (e) {}
  };

  // 초기 bounds 설정
  updateBounds();

  // 초기 로딩 화면 표시
  mainWindow.showLoading();

  // 타이틀바 로드
  titlebarView.webContents.loadFile(path.join(__dirname, 'index.html'));
  
  // 세션 설정 - Google 로그인 허용을 위한 User-Agent 설정
  const ses = session.fromPartition('persist:gemini');
  ses.setUserAgent(CHROME_USER_AGENT);
  
  // 초기 URL 로드
  currentMode = store.get('lastMode');
  contentView.webContents.loadURL(getURL(currentMode));

  // 타이틀바 로드 완료 시 창 표시
  titlebarView.webContents.once('did-finish-load', () => {
    mainWindow.show();
  });

  mainWindow.on('resize', () => {
    updateBounds();
    if (mainWindow && !mainWindow.isMinimized()) {
      const bounds = mainWindow.getBounds();
      windowState.width = bounds.width;
      windowState.height = bounds.height;
    }
  });

  mainWindow.on('move', () => {
    if (mainWindow && !mainWindow.isMinimized()) {
      const bounds = mainWindow.getBounds();
      windowState.x = bounds.x;
      windowState.y = bounds.y;
    }
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      const bounds = mainWindow.getBounds();
      windowState = {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y
      };
      mainWindow.hide();
    }
  });

  // 외부 링크 처리 - gemini.google.com과 aistudio.google.com만 앱 내에서 열기
  contentView.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes('gemini.google.com') || url.includes('aistudio.google.com')) {
      contentView.webContents.loadURL(url);
      return { action: 'deny' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  contentView.webContents.on('did-navigate', () => sendNavState());
  contentView.webContents.on('did-navigate-in-page', () => sendNavState());
  contentView.webContents.on('did-finish-load', () => {
    mainWindow.hideLoading();
    mainWindow.titlebarView.webContents.send('content-loaded');
    sendNavState();
    detectTheme();
  });
}

function sendNavState() {
  if (mainWindow && contentView && mainWindow.titlebarView) {
    mainWindow.titlebarView.webContents.send('nav-state', {
      canGoBack: contentView.webContents.navigationHistory.canGoBack(),
      canGoForward: contentView.webContents.navigationHistory.canGoForward()
    });
  }
}

function detectTheme() {
  if (!mainWindow || !contentView || !mainWindow.titlebarView) return;
  
  if (currentMode === 'aistudio') {
    mainWindow.titlebarView.webContents.send('theme-changed', 'dark');
    return;
  }
  
  contentView.webContents.executeJavaScript(`
    (function() {
      const body = document.body;
      const bgColor = window.getComputedStyle(body).backgroundColor;
      const rgb = bgColor.match(/\\d+/g);
      if (rgb) {
        const brightness = (parseInt(rgb[0]) * 299 + parseInt(rgb[1]) * 587 + parseInt(rgb[2]) * 114) / 1000;
        return brightness < 128 ? 'dark' : 'light';
      }
      return 'dark';
    })()
  `).then(theme => {
    mainWindow.titlebarView.webContents.send('theme-changed', theme);
  }).catch(() => {
    mainWindow.titlebarView.webContents.send('theme-changed', 'dark');
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.ico');
  const icon = nativeImage.createFromPath(iconPath);
  
  tray = new Tray(icon);
  updateTrayMenu();
  tray.setToolTip('Gemini App');
  tray.on('click', () => toggleWindow());
}

function updateTrayMenu() {
  if (!tray) return;
  
  const contextMenu = Menu.buildFromTemplate([
    { label: t('tray.show'), click: () => toggleWindow() },
    { label: t('tray.settings'), click: () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.showSettings();
      }
    }},
    { type: 'separator' },
    { label: t('tray.quit'), click: () => {
      isQuitting = true;
      app.quit();
    }}
  ]);

  tray.setContextMenu(contextMenu);
}

function toggleWindow() {
  if (mainWindow) {
    if (mainWindow.isVisible()) {
      const bounds = mainWindow.getBounds();
      windowState = { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y };
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  }
}

function registerShortcut() {
  const shortcut = store.get('shortcut');
  
  // 기존 단축키 모두 해제
  globalShortcut.unregisterAll();
  
  try {
    const success = globalShortcut.register(shortcut, () => {
      toggleWindow();
    });
    
    if (!success) {
      console.error('단축키 등록 실패:', shortcut);
    }
  } catch (error) {
    console.error('단축키 등록 오류:', error);
  }
}

function setAutoLaunch(enable) {
  app.setLoginItemSettings({ openAtLogin: enable, path: app.getPath('exe') });
}

// IPC 핸들러
ipcMain.handle('get-settings', () => ({
  shortcut: store.get('shortcut'),
  alwaysOnTop: store.get('alwaysOnTop'),
  startWithWindows: store.get('startWithWindows'),
  lastMode: store.get('lastMode'),
  language: store.get('language')
}));

ipcMain.handle('get-translations', () => {
  return { translations, lang: getAppLanguage() };
});

ipcMain.handle('save-settings', (event, settings) => {
  let languageChanged = false;
  
  if (settings.shortcut !== undefined) {
    store.set('shortcut', settings.shortcut);
    registerShortcut();
  }
  if (settings.alwaysOnTop !== undefined) {
    store.set('alwaysOnTop', settings.alwaysOnTop);
    if (mainWindow) mainWindow.setAlwaysOnTop(settings.alwaysOnTop);
  }
  if (settings.startWithWindows !== undefined) {
    store.set('startWithWindows', settings.startWithWindows);
    setAutoLaunch(settings.startWithWindows);
  }
  if (settings.lastMode !== undefined) {
    store.set('lastMode', settings.lastMode);
  }
  if (settings.language !== undefined && settings.language !== store.get('language')) {
    store.set('language', settings.language);
    languageChanged = true;
  }
  
  // 언어 변경 시 페이지 새로고침
  if (languageChanged && contentView) {
    contentView.webContents.loadURL(getURL(currentMode));
  }
  
  return languageChanged;
});

ipcMain.handle('open-external', async (event, url) => {
  await shell.openExternal(url);
  return true;
});

ipcMain.handle('clear-cache', async () => {
  try {
    const { session } = require('electron');
    const ses = session.fromPartition('persist:gemini');
    
    // 모든 캐시 데이터 삭제
    await ses.clearStorageData({
      storages: ['cookies', 'localstorage', 'sessionstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage']
    });
    await ses.clearCache();
    
    // 앱 재시작
    app.relaunch();
    app.exit(0);
    
    return true;
  } catch (error) {
    console.error('캐시 초기화 오류:', error);
    return false;
  }
});

ipcMain.handle('restart-app', () => {
  app.relaunch();
  app.exit(0);
});

ipcMain.on('nav-back', () => {
  if (contentView?.webContents.navigationHistory.canGoBack()) contentView.webContents.navigationHistory.goBack();
});

ipcMain.on('nav-forward', () => {
  if (contentView?.webContents.navigationHistory.canGoForward()) contentView.webContents.navigationHistory.goForward();
});

ipcMain.on('nav-refresh', () => {
  if (contentView) contentView.webContents.reload();
});

ipcMain.on('open-settings', () => {
  if (mainWindow) mainWindow.showSettings();
});

ipcMain.on('close-settings', () => {
  if (mainWindow) mainWindow.hideSettings();
});

// 단축키 녹음 시 전역 단축키 일시 해제/재등록
ipcMain.on('start-shortcut-recording', () => {
  globalShortcut.unregisterAll();
});

ipcMain.on('stop-shortcut-recording', () => {
  registerShortcut();
});

ipcMain.on('switch-mode', (event, mode) => {
  console.log('switch-mode called:', mode, 'URL:', getURL(mode));
  if (contentView && BASE_URLS[mode]) {
    currentMode = mode;
    store.set('lastMode', mode);
    mainWindow.showLoading(mode);
    mainWindow.titlebarView.webContents.send('mode-switched', mode);
    console.log('Loading URL:', getURL(mode));
    contentView.webContents.loadURL(getURL(mode));
  }
});

ipcMain.on('minimize-window', () => mainWindow?.minimize());
ipcMain.on('maximize-window', () => {
  if (mainWindow) {
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  }
});
ipcMain.on('close-window', () => {
  if (mainWindow) {
    const bounds = mainWindow.getBounds();
    windowState = { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y };
    mainWindow.hide();
  }
});

// 앱 시작
app.whenReady().then(() => {
  // 번역 로드
  loadTranslations(getAppLanguage());
  
  createWindow();
  createTray();
  registerShortcut();
  setAutoLaunch(store.get('startWithWindows'));
  
  setInterval(() => {
    if (mainWindow && contentView && currentMode === 'gemini') detectTheme();
  }, 3000);
});

app.on('window-all-closed', () => {});
app.on('activate', () => {
  if (BaseWindow.getAllWindows().length === 0) createWindow();
});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
app.on('before-quit', () => { isQuitting = true; });
