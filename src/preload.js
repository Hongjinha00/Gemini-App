const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 설정
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  restartApp: () => ipcRenderer.invoke('restart-app'),
  
  // 번역
  getTranslations: () => ipcRenderer.invoke('get-translations'),
  
  // 외부 브라우저
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  
  // 네비게이션
  navBack: () => ipcRenderer.send('nav-back'),
  navForward: () => ipcRenderer.send('nav-forward'),
  navRefresh: () => ipcRenderer.send('nav-refresh'),
  switchMode: (mode) => ipcRenderer.send('switch-mode', mode),
  
  // 설정 모달
  openSettings: () => ipcRenderer.send('open-settings'),
  closeSettings: () => ipcRenderer.send('close-settings'),
  
  // 단축키 녹음
  startShortcutRecording: () => ipcRenderer.send('start-shortcut-recording'),
  stopShortcutRecording: () => ipcRenderer.send('stop-shortcut-recording'),
  
  // 창 제어
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  
  // 이벤트 리스너
  onOpenSettings: (callback) => ipcRenderer.on('open-settings', callback),
  onNavState: (callback) => ipcRenderer.on('nav-state', (event, state) => callback(state)),
  onContentLoaded: (callback) => ipcRenderer.on('content-loaded', callback),
  onThemeChanged: (callback) => ipcRenderer.on('theme-changed', (event, theme) => callback(theme)),
  onModeSwitched: (callback) => ipcRenderer.on('mode-switched', (event, mode) => callback(mode))
});
