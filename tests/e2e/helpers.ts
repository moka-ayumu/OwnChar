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

/** The project as saved in the browser, once `ready` accepts it. */
export async function savedProject(page: Page, ready: (project: any) => boolean = Boolean) {
  let project: any
  await expect.poll(async () => {
    project = await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('ownchar', 1)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      return await new Promise<any>((resolve, reject) => {
        const request = database.transaction('project', 'readonly').objectStore('project').get('current')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    })
    return Boolean(project) && ready(project)
  }).toBe(true)
  return project
}
