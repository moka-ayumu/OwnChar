// 앱(http://127.0.0.1:5173 등)을 연 브라우저 DevTools 콘솔에 붙여넣어 실행하세요.
// IndexedDB 'ownchar/records'의 프로젝트를 project.json으로 내려받습니다.
(async () => {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('ownchar')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const store = database.transaction('records', 'readonly').objectStore('records')
  const read = (request) => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const [keys, values] = await Promise.all([read(store.getAllKeys()), read(store.getAll())])
  // 생성된 폰트 바이너리('font')는 측정에 필요 없으므로 제외합니다.
  const project = { meta: undefined, sessions: {}, drawings: {} }
  keys.forEach((key, index) => {
    if (key === 'meta') project.meta = values[index]
    else if (key.startsWith('session:')) project.sessions[key.slice('session:'.length)] = values[index]
    else if (key.startsWith('drawing:')) project.drawings[key.slice('drawing:'.length)] = values[index]
  })
  const blob = new Blob([JSON.stringify(project)], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = 'project.json'
  link.click()
})()
