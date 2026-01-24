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
