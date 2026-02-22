const { contextBridge, ipcRenderer } = require('electron');

// contentView용 스크린샷 API
contextBridge.exposeInMainWorld('electronScreenshot', {
  capture: (options) => ipcRenderer.invoke('capture-screenshot', options),
  captureArea: (options) => ipcRenderer.invoke('capture-screenshot-area', options),
  mergeAndSave: (captures) => ipcRenderer.invoke('merge-screenshots', captures),
  maximizeForCapture: () => ipcRenderer.invoke('maximize-for-capture'),
  restoreAfterCapture: () => ipcRenderer.invoke('restore-after-capture'),
  endMode: () => ipcRenderer.send('end-screenshot-mode')
});

// 줌 레벨 표시 오버레이
let zoomOverlay = null;
let zoomHideTimeout = null;

function showZoomLevel(level) {
  // 오버레이가 없으면 생성
  if (!zoomOverlay) {
    zoomOverlay = document.createElement('div');
    zoomOverlay.id = 'zoom-level-overlay';
    zoomOverlay.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(32, 33, 36, 0.9);
      color: #e3e3e3;
      padding: 8px 16px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      font-weight: 500;
      z-index: 999999;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s ease;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.1);
      zoom: 1;
      -webkit-text-size-adjust: none;
      transform-origin: top center;
    `;
    document.body.appendChild(zoomOverlay);
  }
  
  // 텍스트 업데이트
  zoomOverlay.textContent = `${level}%`;
  
  // 페이지 줌에 관계없이 오버레이 고정 크기 유지
  const currentZoom = window.visualViewport ? window.visualViewport.scale : 1;
  const computedZoom = 1 / (level / 100);
  zoomOverlay.style.transform = `translateX(-50%) scale(${computedZoom})`;
  
  // 표시
  zoomOverlay.style.opacity = '1';
  
  // 기존 타이머 취소
  if (zoomHideTimeout) {
    clearTimeout(zoomHideTimeout);
  }
  
  // 1.5초 후 숨기기
  zoomHideTimeout = setTimeout(() => {
    if (zoomOverlay) {
      zoomOverlay.style.opacity = '0';
    }
  }, 1500);
}

// 줌 레벨 변경 시 표시
ipcRenderer.on('zoom-level-updated', (event, level) => {
  showZoomLevel(level);
});

// Ctrl+휠 줌 기능
document.addEventListener('wheel', (e) => {
  if (e.ctrlKey) {
    e.preventDefault();
    if (e.deltaY < 0) {
      ipcRenderer.send('zoom-change', 'in');
    } else if (e.deltaY > 0) {
      ipcRenderer.send('zoom-change', 'out');
    }
  }
}, { passive: false });

// Ctrl+0으로 줌 리셋
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === '0') {
    e.preventDefault();
    ipcRenderer.send('zoom-change', 'reset');
  }
});
