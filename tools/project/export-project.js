// 앱(http://127.0.0.1:5173 등)을 연 브라우저 DevTools 콘솔에 붙여넣어 실행하세요.
// IndexedDB 'ownchar/project/current'를 sample-project.json으로 내려받습니다.
// 받은 파일을 src/dev/sample-project.json 에 두면 tools/ 의 스크립트가 읽습니다.
(async () => {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('ownchar', 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const project = await new Promise((resolve, reject) => {
    const request = database.transaction('project', 'readonly').objectStore('project').get('current')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  // 생성된 폰트 바이너리는 측정에 필요 없으므로 제외합니다.
  const { generatedFont, ...rest } = project
  const blob = new Blob([JSON.stringify(rest)], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = 'sample-project.json'
  link.click()
})()
