const { contextBridge, ipcRenderer } = require('electron')

const send = (channel) => (...args) => ipcRenderer.send(channel, ...args)
const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args)
const listen = (channel) => (fn) => ipcRenderer.on(channel, (_e, ...args) => fn(...args))

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,

  minimize: send('win:minimize'),
  maximize: send('win:maximize'),
  close: send('win:close'),

  scan: invoke('library:scan'),
  openFolder: send('library:open'),
  chooseFolder: invoke('library:choose'),
  trash: invoke('library:trash'),
  setDuration: send('library:duration'),
  setWave: send('library:wave'),
  setTitle: invoke('library:title'),
  onLibraryChanged: listen('library:changed'),

  createList: invoke('lists:create'),
  renameList: invoke('lists:rename'),
  deleteList: invoke('lists:delete'),
  moveTo: invoke('lists:move'),

  get: invoke('store:get'),
  saveSettings: send('store:settings'),
  saveStats: send('store:stats'),
  saveFinal: (settings, stats) => ipcRenderer.sendSync('store:final', settings, stats),
  memory: invoke('app:memory'),

  search: invoke('dl:search'),
  resolve: invoke('dl:resolve'),
  download: invoke('dl:track'),
  onResolveProgress: listen('dl:progress'),

  setDiscord: send('discord:enabled'),
  setActivity: send('discord:activity'),
})
