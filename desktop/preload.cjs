const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('memoDesktop', {
  available: true,
  setTopmost: (value) => ipcRenderer.invoke('focus:topmost', value),
  openFocus: () => ipcRenderer.invoke('app:open-focus'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  openMain: (query) => ipcRenderer.invoke('app:open-main', query),
  openMemo: (id) => ipcRenderer.invoke('app:open-memo', id),
  setTheme: (theme) => ipcRenderer.invoke('app:set-theme', theme)
})
