import { expect, type Page } from '@playwright/test'

export async function startProject(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /새 폰트 시작하기/ }).click()
  await expect(page).toHaveURL(/\/write$/)
}

/** The sentence canvas, once its column count has settled to the available width. */
export async function writingCanvas(page: Page) {
  const frame = page.getByTestId('writing-canvas')
  await expect.poll(async () => {
    const before = await frame.getAttribute('data-columns')
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    return before === await frame.getAttribute('data-columns')
  }).toBe(true)
  const cellSize = Number(await frame.getAttribute('data-cell-size'))
  const columns = Number(await frame.getAttribute('data-columns'))
  /** Draws a straight stroke inside cell `cellIndex`, in cell pixels. */
  const stroke = async (cellIndex: number, fromX: number, fromY: number, toX: number, toY: number) => {
    await frame.locator('.writing-grid > div').nth(cellIndex).scrollIntoViewIfNeeded()
    const box = (await frame.boundingBox())!
    const x = box.x + (cellIndex % columns) * cellSize
    const y = box.y + Math.floor(cellIndex / columns) * cellSize
    await page.mouse.move(x + fromX, y + fromY)
    await page.mouse.down()
    await page.mouse.move(x + toX, y + toY, { steps: 4 })
    await page.mouse.up()
  }
  return { frame, stroke }
}

/** The project as saved in the browser, put back together from its records. Null when nothing is saved. */
export async function storedProject(page: Page) {
  return await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('ownchar')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const store = database.transaction('records', 'readonly').objectStore('records')
    const read = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const [keys, values] = await Promise.all([read(store.getAllKeys()), read(store.getAll())])
    const project: any = { writingSessions: {}, drawings: {} }
    let found = false
    keys.forEach((key, index) => {
      const name = String(key)
      if (name === 'meta') { Object.assign(project, values[index]); found = true }
      else if (name === 'font') project.generatedFont = values[index]
      else if (name.startsWith('session:')) project.writingSessions[name.slice('session:'.length)] = values[index]
      else if (name.startsWith('drawing:')) project.drawings[name.slice('drawing:'.length)] = values[index]
    })
    return found ? project : null
  })
}

/** The project as saved in the browser, once `ready` accepts it. */
export async function savedProject(page: Page, ready: (project: any) => boolean = Boolean) {
  let project: any
  await expect.poll(async () => {
    project = await storedProject(page)
    return Boolean(project) && ready(project)
  }).toBe(true)
  return project
}
