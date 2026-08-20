const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('xiaoyu', {
  generateText: (payload) => ipcRenderer.invoke('deepseek:generate-text', payload),
  generateCharacter: (payload) => ipcRenderer.invoke('deepseek:generate-character', payload),
  generateImage: (payload) => ipcRenderer.invoke('ark:generate-image', payload),
  selectCustomImage: () => ipcRenderer.invoke('file:select-custom-image'),
  generateAudio: (payload) => ipcRenderer.invoke('mimo:generate-audio', payload),
  previewVoice: (payload) => ipcRenderer.invoke('mimo:preview-voice', payload),
  generateVideo: (payload) => ipcRenderer.invoke('video:generate', payload),
  showInFolder: (filePath) => ipcRenderer.invoke('file:show-in-folder', filePath),
  onTaskProgress: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('task:progress', listener)
    return () => ipcRenderer.removeListener('task:progress', listener)
  },
  getApiStatus: () => ipcRenderer.invoke('config:get-api-status'),
  saveApiKeys: (payload) => ipcRenderer.invoke('config:save-api-keys', payload),
})
