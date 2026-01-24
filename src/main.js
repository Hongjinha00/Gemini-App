const { app, BaseWindow, BrowserWindow, WebContentsView, globalShortcut, ipcMain, Tray, Menu, screen, nativeImage, shell, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const sharp = require('sharp');

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
    // 새 설정들
    runInBackground: true, // 닫기 시 백그라운드 실행
    windowSize: 'slim', // slim(442x589) 또는 wide(900x625)
    rememberWindowSize: false, // 마지막 창 크기 기억
    rememberLastPage: false, // 마지막 페이지 URL 기억
    savedWindowSize: null, // 저장된 창 크기
    lastGeminiUrl: null, // 마지막 Gemini URL
    lastAIStudioUrl: null, // 마지막 AI Studio URL
  }
});

// 앱 상태
let mainWindow = null;
let contentView = null;
let loadingView = null;
let settingsWindow = null;
let tray = null;
let isQuitting = false;
let currentMode = 'gemini';
let isScreenshotMode = false;

// 기본 창 설정 (프리셋)
const WINDOW_PRESETS = {
  slim: { width: 442, height: 589 },
  wide: { width: 900, height: 625 }
};
const TITLEBAR_HEIGHT = 32;

// 창 상태 (세션 중에만 유지)
let windowState = {
  width: WINDOW_PRESETS.slim.width,
  height: WINDOW_PRESETS.slim.height,
  x: null,
  y: null
};

// URL 정의 (기본)
const BASE_URLS = {
  gemini: 'https://gemini.google.com/app',
  aistudio: 'https://aistudio.google.com/'
};

// 언어 설정이 적용된 URL 가져오기
function getURL(mode, useSavedUrl = false) {
  const lang = store.get('language');
  const baseUrl = BASE_URLS[mode];
  const actualLang = lang === 'auto' ? getSystemLanguage() : lang;
  
  // 마지막 페이지 기억이 켜져있고 저장된 URL이 있으면 사용
  if (useSavedUrl && store.get('rememberLastPage')) {
    const savedUrlKey = mode === 'gemini' ? 'lastGeminiUrl' : 'lastAIStudioUrl';
    const savedUrl = store.get(savedUrlKey);
    if (savedUrl) {
      return savedUrl;
    }
  }
  
  return `${baseUrl}?hl=${actualLang}`;
}

// 현재 URL 저장
function saveCurrentUrl() {
  if (contentView) {
    const currentUrl = contentView.webContents.getURL();
    if (currentUrl) {
      if (currentMode === 'gemini') {
        store.set('lastGeminiUrl', currentUrl);
      } else if (currentMode === 'aistudio') {
        store.set('lastAIStudioUrl', currentUrl);
      }
    }
  }
}

// 초기 창 크기 계산
function getInitialWindowSize() {
  // 마지막 창 크기 기억이 켜져있고 저장된 크기가 있으면 사용
  if (store.get('rememberWindowSize')) {
    const savedSize = store.get('savedWindowSize');
    if (savedSize && savedSize.width && savedSize.height) {
      return savedSize;
    }
  }
  
  // 아니면 프리셋 사용
  const preset = store.get('windowSize') || 'slim';
  return WINDOW_PRESETS[preset] || WINDOW_PRESETS.slim;
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
  
  // 초기 창 크기 결정
  const initialSize = getInitialWindowSize();
  windowState.width = initialSize.width;
  windowState.height = initialSize.height;
  
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
      partition: 'persist:gemini',
      preload: path.join(__dirname, 'preload-content.js')
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

  // 설정 창 표시/숨기기
  mainWindow.showSettings = () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.focus();
      return;
    }
    
    const mainBounds = mainWindow.getBounds();
    
    // 앱 창이 900x625 이상이면 설정 창도 크게
    const isLargeWindow = mainBounds.width >= 900 && mainBounds.height >= 625;
    const settingsWidth = isLargeWindow ? 500 : 400;
    const settingsHeight = isLargeWindow ? 600 : 500;
    
    settingsWindow = new BrowserWindow({
      width: settingsWidth,
      height: settingsHeight,
      minWidth: 360,
      minHeight: 400,
      x: Math.round(mainBounds.x + (mainBounds.width - settingsWidth) / 2),
      y: Math.round(mainBounds.y + (mainBounds.height - settingsHeight) / 2),
      parent: mainWindow,
      modal: false,
      frame: false,
      resizable: true,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      alwaysOnTop: store.get('alwaysOnTop'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    
    settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
    
    settingsWindow.on('closed', () => {
      settingsWindow = null;
    });
  };

  mainWindow.hideSettings = () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.close();
    }
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
  
  // 초기 URL 로드 (저장된 URL 사용 가능)
  currentMode = store.get('lastMode');
  contentView.webContents.loadURL(getURL(currentMode, true));

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
  language: store.get('language'),
  windowSize: store.get('windowSize'),
  runInBackground: store.get('runInBackground'),
  rememberWindowSize: store.get('rememberWindowSize'),
  rememberLastPage: store.get('rememberLastPage'),
  showScreenshotButton: store.get('showScreenshotButton', false)
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
  
  // 새 설정들
  if (settings.windowSize !== undefined) {
    store.set('windowSize', settings.windowSize);
  }
  if (settings.runInBackground !== undefined) {
    store.set('runInBackground', settings.runInBackground);
  }
  if (settings.rememberWindowSize !== undefined) {
    store.set('rememberWindowSize', settings.rememberWindowSize);
    // 끄면 저장된 창 크기도 초기화
    if (!settings.rememberWindowSize) {
      store.set('savedWindowSize', null);
    }
  }
  if (settings.rememberLastPage !== undefined) {
    store.set('rememberLastPage', settings.rememberLastPage);
    // 끄면 저장된 URL도 초기화
    if (!settings.rememberLastPage) {
      store.set('lastGeminiUrl', null);
      store.set('lastAIStudioUrl', null);
    }
  }
  if (settings.showScreenshotButton !== undefined) {
    store.set('showScreenshotButton', settings.showScreenshotButton);
    // 렌더러에게 스크린샷 버튼 표시 상태 알림
    if (mainWindow?.titlebarView) {
      mainWindow.titlebarView.webContents.send('screenshot-button-visibility-changed', settings.showScreenshotButton);
    }
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

// 스크린샷 모드 시작
ipcMain.on('start-screenshot-mode', async () => {
  if (!contentView) return;
  
  isScreenshotMode = !isScreenshotMode;
  
  // 타이틀바에 모드 변경 알림
  if (mainWindow?.titlebarView) {
    mainWindow.titlebarView.webContents.send('screenshot-mode-changed', isScreenshotMode);
  }
  
  if (isScreenshotMode) {
    try {
      // 스크린샷 선택 UI 주입 (외부 파일에서 읽기)
      const screenshotScript = fs.readFileSync(path.join(__dirname, 'screenshot-inject.js'), 'utf8');
      await contentView.webContents.executeJavaScript(screenshotScript);
    } catch (err) {
      console.error('Screenshot script injection failed:', err);
      isScreenshotMode = false;
      if (mainWindow?.titlebarView) {
        mainWindow.titlebarView.webContents.send('screenshot-mode-changed', false);
      }
    }
  } else {
    // 스크린샷 모드 종료 - UI 정리
    await contentView.webContents.executeJavaScript(`
      (function() {
        document.querySelectorAll('.screenshot-checkbox-container').forEach(el => el.remove());
        document.querySelectorAll('.screenshot-message-wrapper').forEach(el => {
          el.classList.remove('screenshot-message-wrapper', 'selected');
          el.style.outline = '';
          el.style.position = '';
        });
        document.getElementById('screenshot-toolbar')?.remove();
        document.getElementById('screenshot-styles')?.remove();
      })();
    `);
  }
});

// 스크린샷 캡처 (단일)
ipcMain.handle('capture-screenshot', async (event, options) => {
  if (!contentView) return { success: false };
  
  try {
    // 전체 페이지 캡처
    const image = await contentView.webContents.capturePage({
      x: options.x,
      y: options.y,
      width: options.width,
      height: options.height
    });
    
    // 저장 다이얼로그 표시
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: t('screenshot.saveTitle') || 'Save Screenshot',
      defaultPath: path.join(app.getPath('pictures'), 'gemini-screenshot-' + Date.now() + '.png'),
      filters: [{ name: 'PNG Image', extensions: ['png'] }]
    });
    
    if (filePath) {
      fs.writeFileSync(filePath, image.toPNG());
      return { success: true, path: filePath };
    }
    
    return { success: false, cancelled: true };
  } catch (error) {
    console.error('Screenshot capture error:', error);
    return { success: false, error: error.message };
  }
});

// 스크린샷 영역 캡처 (데이터만 반환)
ipcMain.handle('capture-screenshot-area', async (event, options) => {
  if (!contentView) return null;
  
  try {
    const image = await contentView.webContents.capturePage({
      x: options.x,
      y: options.y,
      width: options.width,
      height: options.height
    });
    
    // Base64로 반환
    return image.toPNG().toString('base64');
  } catch (error) {
    console.error('Screenshot area capture error:', error);
    return null;
  }
});

// 여러 스크린샷 합치기
ipcMain.handle('merge-screenshots', async (event, captures) => {
  if (!captures || captures.length === 0) return { success: false };
  
  try {
    // 각 캡처를 Buffer로 변환
    const images = captures.map(c => ({
      buffer: Buffer.from(c.data, 'base64'),
      height: c.height
    }));
    
    // 첫 이미지로 너비 확인
    const firstMeta = await sharp(images[0].buffer).metadata();
    const width = firstMeta.width;
    
    // 전체 높이 계산
    let totalHeight = 0;
    const metadatas = [];
    for (const img of images) {
      const meta = await sharp(img.buffer).metadata();
      metadatas.push(meta);
      totalHeight += meta.height;
    }
    
    // 이미지 합치기
    const compositeImages = [];
    let currentY = 0;
    
    for (let i = 0; i < images.length; i++) {
      compositeImages.push({
        input: images[i].buffer,
        top: currentY,
        left: 0
      });
      currentY += metadatas[i].height;
    }
    
    // 합쳐진 이미지 생성
    const mergedImage = await sharp({
      create: {
        width: width,
        height: totalHeight,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      }
    })
    .composite(compositeImages)
    .png()
    .toBuffer();
    
    // 저장 다이얼로그
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: t('screenshot.saveTitle') || 'Save Screenshot',
      defaultPath: path.join(app.getPath('pictures'), 'gemini-screenshot-' + Date.now() + '.png'),
      filters: [{ name: 'PNG Image', extensions: ['png'] }]
    });
    
    if (filePath) {
      fs.writeFileSync(filePath, mergedImage);
      return { success: true, path: filePath };
    }
    
    return { success: false, cancelled: true };
  } catch (error) {
    console.error('Screenshot merge error:', error);
    return { success: false, error: error.message };
  }
});

// 스크린샷 모드 종료
ipcMain.on('end-screenshot-mode', () => {
  isScreenshotMode = false;
  if (mainWindow?.titlebarView) {
    mainWindow.titlebarView.webContents.send('screenshot-mode-changed', false);
  }
});

// 스크린샷용 창 상태 저장
let captureWindowState = null;

// 캡처용 창 최대화
ipcMain.handle('maximize-for-capture', async () => {
  if (!mainWindow) return { success: false };
  
  try {
    // 현재 상태 저장
    captureWindowState = {
      bounds: mainWindow.getBounds(),
      isMaximized: mainWindow.isMaximized()
    };
    
    // 화면 크기 가져오기
    const { workArea } = screen.getPrimaryDisplay();
    
    // 창 최대화 (전체 화면 작업 영역)
    mainWindow.setBounds({
      x: workArea.x,
      y: workArea.y,
      width: workArea.width,
      height: workArea.height
    });
    
    // 렌더링 대기
    await new Promise(r => setTimeout(r, 300));
    
    return { 
      success: true, 
      width: workArea.width, 
      height: workArea.height - 32 // 타이틀바 높이 제외
    };
  } catch (error) {
    console.error('Maximize for capture error:', error);
    return { success: false, error: error.message };
  }
});

// 캡처 후 창 복원
ipcMain.handle('restore-after-capture', async () => {
  if (!mainWindow || !captureWindowState) return { success: false };
  
  try {
    if (captureWindowState.isMaximized) {
      mainWindow.maximize();
    } else {
      mainWindow.setBounds(captureWindowState.bounds);
    }
    captureWindowState = null;
    return { success: true };
  } catch (error) {
    console.error('Restore after capture error:', error);
    return { success: false, error: error.message };
  }
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
  console.log('switch-mode called:', mode);
  if (contentView && BASE_URLS[mode]) {
    // 현재 URL 저장 (모드 전환 전)
    saveCurrentUrl();
    
    currentMode = mode;
    store.set('lastMode', mode);
    mainWindow.showLoading(mode);
    mainWindow.titlebarView.webContents.send('mode-switched', mode);
    
    // 저장된 URL 사용해서 로드
    const targetUrl = getURL(mode, true);
    console.log('Loading URL:', targetUrl);
    contentView.webContents.loadURL(targetUrl);
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
    
    // 마지막 창 크기 저장 (설정이 켜져있을 경우)
    if (store.get('rememberWindowSize')) {
      store.set('savedWindowSize', { width: bounds.width, height: bounds.height });
    }
    
    // 마지막 URL 저장 (설정이 켜져있을 경우)
    if (store.get('rememberLastPage')) {
      saveCurrentUrl();
    }
    
    // 백그라운드 실행 설정에 따라 처리
    if (store.get('runInBackground')) {
      mainWindow.hide();
    } else {
      isQuitting = true;
      app.quit();
    }
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
