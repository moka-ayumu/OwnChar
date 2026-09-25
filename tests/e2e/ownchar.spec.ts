import { expect, test } from '@playwright/test'
import fs from 'node:fs/promises'
import opentype from 'opentype.js'
import { strokePolygon } from '../../src/font/stroke-outline'
import { learnGaps } from '../../src/font/gap-learning'

const groups = [
  ['consonant', [...'ㄱㄲㄳㄴㄵㄶㄷㄸㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅃㅄㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ']],
  ['vowel', [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ']],
  ['uppercase', [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']],
  ['lowercase', [...'abcdefghijklmnopqrstuvwxyz']],
  ['number', [...'0123456789']],
] as const

function makeProjectFixture() {
  const drawings: Record<string, unknown> = {}
  for (const [group, characters] of groups) {
    for (const char of characters) {
      const codePoint = char.codePointAt(0)!
      const promptId = `${group}-${codePoint}`
      drawings[promptId] = {
        promptId,
        codePoint,
        elements: [],
        paths: [{ d: 'M 0 0 L 100 0 L 100 100 L 0 100 Z', x: 0, y: 0, width: 100, height: 100 }],
        previewSvg: '<svg viewBox="0 0 100 100"><path d="M0 0L100 0L100 100L0 100Z"/></svg>',
        updatedAt: Date.now(),
      }
    }
  }
  return {
    schemaVersion: 7,
    hydrated: true,
    status: 'writing',
    currentPrompt: 26,
    drawings,
    writingSessions: {},
    metadata: { familyName: 'OwnChar Test', styleName: 'Regular', designer: 'Playwright', version: '1.0' },
    globalMetrics: { left: 0, right: 0, y: 0 },
    compositionSettings: {
      singleInitialScale: 0.8,
      vowelScale: 0.92,
      finalScale: 0.9,
    },
    glyphOverrides: {},
    history: { past: [], future: [] },
    generation: { stage: 'idle', progress: 0, message: '', error: null },
    generatedFont: null,
    fontDirty: false,
    sourceDirty: false,
    fontRevision: 0,
    lastSavedAt: null,
  }
}

async function seedProject(page: import('@playwright/test').Page, fixture = makeProjectFixture()) {
  await page.evaluate(async (project) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('ownchar', 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('project')) request.result.createObjectStore('project')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('project', 'readwrite')
      transaction.objectStore('project').put(project, 'current')
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }, fixture)
}

test('starts a new local handwriting project', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /예시 문장을 자연스럽게 쓰고/ })).toBeVisible()
  await page.getByRole('button', { name: /새 폰트 시작하기/ }).click()
  await expect(page).toHaveURL(/\/write$/)
  await expect(page.getByRole('heading', { name: '우리 한글은 마음과 소리를 아름답게 담아요' })).toBeVisible()
  await expect(page.getByText('0 / 359')).toBeVisible()
  const writingCanvas = page.getByTestId('writing-canvas')
  await expect(writingCanvas).toBeVisible()
  await expect(writingCanvas).toHaveAttribute('data-cell-size', '148')
  await expect.poll(async () => Number(await writingCanvas.getAttribute('data-rows'))).toBeGreaterThan(1)
  const canvasSize = page.getByRole('slider', { name: '글자 칸 크기' })
  await canvasSize.press('ArrowRight')
  await expect(writingCanvas).toHaveAttribute('data-cell-size', '152')
  await expect(page.getByText('이 문장에서 수집된 자모')).toBeVisible()
  await expect(page.getByRole('slider', { name: '획 굵기' })).toHaveAttribute('aria-valuenow', '3')
  await expect(page.getByRole('slider', { name: '끝점 보정' })).toHaveAttribute('aria-valuenow', '1')
})

test('maps continuous stroke settings to saved pen widths', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /새 폰트 시작하기/ }).click()
  const slider = page.getByRole('slider', { name: '획 굵기' })
  const frame = page.getByTestId('writing-canvas')
  const box = await frame.boundingBox()
  expect(box).toBeTruthy()
  const draw = async (offset: number) => {
    await page.mouse.move(box!.x + 25, box!.y + 25 + offset)
    await page.mouse.down()
    await page.mouse.move(box!.x + 65, box!.y + 25 + offset, { steps: 3 })
    await page.mouse.up()
  }
  await draw(0)
  await slider.focus()
  await slider.press('Home')
  await expect(slider).toHaveAttribute('aria-valuenow', '1')
  await draw(15)
  await slider.focus()
  await slider.press('End')
  await expect(slider).toHaveAttribute('aria-valuenow', '5')
  await draw(30)
  await slider.focus()
  await slider.press('Home')
  await slider.press('ArrowRight')
  await expect(slider).toHaveAttribute('aria-valuenow', '1.1')
  await draw(45)
  const readWidths = () => page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('ownchar', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const project = await new Promise<any>((resolve, reject) => {
      const request = database.transaction('project', 'readonly').objectStore('project').get('current')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return (project?.writingSessions?.['hangul-base-0']?.elements ?? []).filter((element: any) => element.type === 'freedraw').map((element: any) => element.strokeWidth)
  })
  await expect.poll(async () => (await readWidths()).length).toBe(4)
  const widths = await readWidths()
  expect(widths).toHaveLength(4)
  expect(widths[0]).toBeCloseTo(1)
  expect(widths[1]).toBeCloseTo(1 / 3)
  expect(widths[2]).toBeCloseTo(5 / 3)
  expect(widths[3]).toBeCloseTo(1.1 / 3)
})

test('context exercises put only target syllables on the canvas', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /새 폰트 시작하기/ }).click()
  await page.locator('.exercise-chip').filter({ hasText: '초성 조합 모양 1' }).first().click()
  await expect(page.getByRole('heading', { name: '가까나다따라마바빠사싸아자짜차카타파하', exact: true })).toBeVisible()
  await expect(page.getByTestId('writing-canvas')).toHaveAttribute('data-rows', /[2-9]/)
  await expect(page.getByText('가, 까, 나, 다, 따, 라, 마, 바, 빠, 사, 싸, 아, 자, 짜, 차, 카, 타, 파, 하에서 초성을 앞에서부터 써주세요. 이미 수집된 자모는 고정 표시되고, 빈 자모를 함께 쓰면 자동으로 분리합니다.')).toBeVisible()
})

test('collects a missing medial written in a later cell and backfills earlier matching cells', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /새 폰트 시작하기/ }).click()
  await page.locator('.exercise-chip').filter({ hasText: '초성 조합 모양 1' }).first().click()
  const frame = page.getByTestId('writing-canvas')
  const cellSize = Number(await frame.getAttribute('data-cell-size'))
  const columns = Number(await frame.getAttribute('data-columns'))
  const cellIndex = 15 // 카: initial-0-ㅋ + medial-0-ㅏ
  const cellX = (cellIndex % columns) * cellSize
  const cellY = Math.floor(cellIndex / columns) * cellSize
  await frame.scrollIntoViewIfNeeded()
  await frame.evaluate((node, rowY) => {
    const viewport = node.closest('.sentence-canvas-region')
    if (viewport) viewport.scrollTop = rowY
  }, cellY)
  const stroke = async (fromX: number, fromY: number, toX: number, toY: number, expectedCount: number) => {
    const box = await frame.boundingBox()
    expect(box).toBeTruthy()
    await page.mouse.move(box!.x + cellX + fromX, box!.y + cellY + fromY)
    await page.mouse.down()
    await page.mouse.move(box!.x + cellX + toX, box!.y + cellY + toY, { steps: 4 })
    await page.mouse.up()
    await expect.poll(async () => (await frame.getAttribute('data-assignment-prompts'))?.split(',').filter(Boolean).length).toBe(expectedCount)
  }
  await stroke(25, 28, 74, 28, 1)
  await stroke(52, 28, 52, 68, 2)
  await stroke(88, 24, 88, 112, 3)
  await stroke(88, 68, 116, 68, 4)

  const medialAId = `medial-0-${'ㅏ'.codePointAt(0)}`
  await expect(page.getByText('카 · ㅏ')).toBeVisible()
  for (const earlierCell of [0, 1, 2, 9]) {
    await expect(page.locator(`path[data-prompt-id="${medialAId}"][data-cell-index="${earlierCell}"]`).first()).toBeAttached()
  }
  await page.waitForTimeout(900)

  const assignments = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('ownchar', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return await new Promise<any[]>((resolve, reject) => {
      const request = database.transaction('project', 'readonly').objectStore('project').get('current')
      request.onsuccess = () => resolve(request.result.writingSessions['hangul-initial-0'].assignments.filter((item: any) => item.cellIndex === 15))
      request.onerror = () => reject(request.error)
    })
  })
  expect(assignments.map((item) => item.promptId)).toEqual([
    `initial-0-${'ㅋ'.codePointAt(0)}`,
    `initial-0-${'ㅋ'.codePointAt(0)}`,
    medialAId,
    medialAId,
  ])
})

test('collects each complete medial such as ㅏ and ㅐ separately', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /새 폰트 시작하기/ }).click()
  await page.locator('.exercise-chip').filter({ hasText: '중성 조합 모양 1' }).first().click()
  await expect(page.getByRole('heading', { name: /^가개갸걔거게겨계/ })).toBeVisible()
  const frame = page.getByTestId('writing-canvas')
  const box = await frame.boundingBox()
  const cellSize = Number(await frame.getAttribute('data-cell-size'))
  const columns = Number(await frame.getAttribute('data-columns'))
  expect(box).toBeTruthy()
  const stroke = async (cellIndex: number, fromX: number, fromY: number, toX: number, toY: number) => {
    const cellX = (cellIndex % columns) * cellSize
    const cellY = Math.floor(cellIndex / columns) * cellSize
    await page.mouse.move(box!.x + cellX + fromX, box!.y + cellY + fromY)
    await page.mouse.down()
    await page.mouse.move(box!.x + cellX + toX, box!.y + cellY + toY, { steps: 4 })
    await page.mouse.up()
  }
  await stroke(0, 25, 30, 70, 30) // 초성 ㄱ
  await stroke(0, 88, 24, 88, 112) // 중성 ㅏ
  await stroke(0, 88, 68, 116, 68)
  await expect(page.getByText('가 · ㅏ')).toBeVisible()
  await page.waitForTimeout(600)
  await stroke(1, 78, 24, 78, 112) // 중성 ㅐ
  await stroke(1, 78, 68, 100, 68)
  await stroke(1, 112, 24, 112, 112)
  await expect(page.getByText('개 · ㅐ')).toBeVisible()
  await page.waitForTimeout(900)

  const saved = await page.evaluate(async () => {
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
  expect(saved.drawings[`medial-0-${'ㅏ'.codePointAt(0)}`]).toBeTruthy()
  expect(saved.drawings[`medial-0-${'ㅐ'.codePointAt(0)}`]).toBeTruthy()
  expect(saved.drawings[`medial-0-${'ㅐ'.codePointAt(0)}`].derivedFromPromptId).toBeUndefined()
})

test('collects single and double consonants as separate complete glyphs', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /새 폰트 시작하기/ }).click()
  await page.locator('.exercise-chip').filter({ hasText: '초성 조합 모양 1' }).first().click()
  await expect(page.getByRole('heading', { name: /^가까나다따/ })).toBeVisible()
  const frame = page.getByTestId('writing-canvas')
  const box = await frame.boundingBox()
  const cellSize = Number(await frame.getAttribute('data-cell-size'))
  const columns = Number(await frame.getAttribute('data-columns'))
  expect(box).toBeTruthy()
  const stroke = async (cellIndex: number, fromX: number, fromY: number, toX: number, toY: number) => {
    const cellX = (cellIndex % columns) * cellSize
    const cellY = Math.floor(cellIndex / columns) * cellSize
    await page.mouse.move(box!.x + cellX + fromX, box!.y + cellY + fromY)
    await page.mouse.down()
    await page.mouse.move(box!.x + cellX + toX, box!.y + cellY + toY, { steps: 4 })
    await page.mouse.up()
  }
  await stroke(0, 24, 30, 70, 30)
  await stroke(0, 88, 24, 88, 112)
  await stroke(0, 88, 68, 116, 68)
  await expect(page.getByText('가 · ㄱ')).toBeVisible()
  await page.waitForTimeout(600)
  await stroke(1, 24, 30, 58, 30)
  await stroke(1, 70, 30, 104, 30)
  await expect(page.getByText('까 · ㄲ')).toBeVisible()
  await page.waitForTimeout(900)

  const drawings = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('ownchar', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = database.transaction('project', 'readonly').objectStore('project').get('current')
      request.onsuccess = () => resolve(request.result.drawings)
      request.onerror = () => reject(request.error)
    })
  })
  expect(drawings[`initial-0-${'ㄱ'.codePointAt(0)}`]).toBeTruthy()
  expect(drawings[`initial-0-${'ㄲ'.codePointAt(0)}`]).toBeTruthy()
})

test('splits a syllable into ordered jamo while keeping raw strokes', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByRole('button', { name: /새 폰트 시작하기/ }).click()
  const frame = page.getByTestId('writing-canvas')
  const box = await frame.boundingBox()
  expect(box).toBeTruthy()

  const stroke = async (fromX: number, fromY: number, toX: number, toY: number) => {
    await page.mouse.move(box!.x + fromX, box!.y + fromY)
    await page.mouse.down()
    await page.mouse.move(box!.x + toX, box!.y + toY, { steps: 4 })
    await page.mouse.up()
  }
  await stroke(30, 35, 72, 35) // 우의 초성 ㅇ에 들어갈 첫 획
  await stroke(32, 82, 78, 82) // 중성 ㅜ의 가로획
  await stroke(55, 82, 55, 118) // 중성 ㅜ의 세로획

  await expect(page.getByText('우 · ㅇ')).toBeVisible()
  await expect(page.getByText('우 · ㅜ')).toBeVisible()
  await expect(page.getByText('작성한 획의 칸 위치를 보존하기 위해 크기가 고정됐어요.')).toBeVisible()
  await page.waitForTimeout(900)

  const saved = await page.evaluate(async () => {
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
  const session = saved.writingSessions['hangul-base-0']
  expect(session.elements).toHaveLength(3)
  expect(session.assignments.map((item: any) => item.promptId)).toEqual([
    `initial-2-${'ㅇ'.codePointAt(0)}`,
    `medial-0-${'ㅜ'.codePointAt(0)}`,
    `medial-0-${'ㅜ'.codePointAt(0)}`,
  ])
  expect(session.boundaries).toEqual({})
  expect(saved.drawings[`initial-2-${'ㅇ'.codePointAt(0)}`].previewSvg).toContain('fill-rule="nonzero"')

  if (testInfo.project.name === 'chromium') {
    await frame.hover()
    await page.mouse.wheel(0, 500)
  }
  await expect(page.getByText('콘텐츠 영역으로 스크롤하기')).toHaveCount(0)
  await page.getByRole('button', { name: '다음 문장' }).click()
  await page.getByRole('button', { name: '이전 문장' }).click()
  await expect(page.getByText('우 · ㅇ')).toBeVisible()
  await expect(page.getByText('우 · ㅜ')).toBeVisible()
  await expect(page.getByText('콘텐츠 영역으로 스크롤하기')).toHaveCount(0)
})

test('keeps the writing position while a pen draws and permits later scrolling', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Pen pointer events use Chromium CDP.')
  await page.goto('/')
  await page.getByRole('button', { name: /새 폰트 시작하기/ }).click()
  const region = page.locator('.sentence-canvas-region')
  const frame = page.getByTestId('writing-canvas')
  await region.evaluate((element) => { element.scrollTop = 180 })
  const expectedTop = await region.evaluate((element) => element.scrollTop)
  expect(expectedTop).toBeGreaterThan(0)
  const box = await frame.boundingBox()
  expect(box).toBeTruthy()
  const client = await page.context().newCDPSession(page)
  const x = box!.x + 35
  const y = Math.max(box!.y + 35, 120)
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, pointerType: 'pen' })
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: 0.05 })
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 35, y, button: 'left', buttons: 1, pointerType: 'pen', force: 0.5 })
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 35, y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' })
  await expect.poll(async () => (await frame.getAttribute('data-assignment-prompts'))?.length ?? 0).toBeGreaterThan(0)
  let pressures: number[] = []
  await expect.poll(async () => {
    pressures = await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('ownchar', 1)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const project = await new Promise<any>((resolve, reject) => {
        const request = database.transaction('project', 'readonly').objectStore('project').get('current')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      return project?.writingSessions?.['hangul-base-0']?.elements?.[0]?.pressures ?? []
    })
    return pressures.length
  }).toBe(2)
  expect(pressures[0]).toBeCloseTo(0.05, 3)
  expect(pressures[1]).toBeCloseTo(0.5, 3)
  await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBe(expectedTop)
  await frame.hover({ position: { x: 35, y: 35 } })
  await page.mouse.wheel(0, 80)
  await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBeGreaterThan(expectedTop)
})

test('collects only the target role without using base glyphs as contextual guides', async ({ page }) => {
  await page.goto('/')
  const fixture = makeProjectFixture()
  fixture.currentPrompt = 3
  await seedProject(page, fixture)
  await page.reload()
  await page.goto('/write')
  await expect(page.getByRole('heading', { name: '가까나다따라마바빠사싸아자짜차카타파하', exact: true })).toBeVisible()
  const frame = page.getByTestId('writing-canvas')
  const box = await frame.boundingBox()
  const cellSize = Number(await frame.getAttribute('data-cell-size'))
  expect(box).toBeTruthy()
  const stroke = async (cell: number, fromX: number, fromY: number, toX: number, toY: number) => {
    await page.mouse.move(box!.x + cell * cellSize + fromX, box!.y + fromY)
    await page.mouse.down()
    await page.mouse.move(box!.x + cell * cellSize + toX, box!.y + toY, { steps: 4 })
    await page.mouse.up()
  }
  const fixedLayer = page.getByLabel('이미 수집되어 고정된 자모')
  await expect(fixedLayer).toHaveCount(0)

  await stroke(0, 25, 35, 72, 35)
  await expect(page.getByText('가 · ㄱ')).toBeVisible()
  await stroke(1, 28, 38, 72, 38)
  await expect(page.getByText('까 · ㄲ')).toBeVisible()
  await expect(page.getByText('까 · ㅏ')).toHaveCount(0)
  await page.waitForTimeout(900)

  const assignments = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('ownchar', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return await new Promise<string[]>((resolve, reject) => {
      const request = database.transaction('project', 'readonly').objectStore('project').get('current')
      request.onsuccess = () => resolve(request.result.writingSessions['hangul-initial-0'].assignments.map((item: any) => item.promptId))
      request.onerror = () => reject(request.error)
    })
  })
  expect(assignments).toEqual([
    `initial-0-${'ㄱ'.codePointAt(0)}`,
    `initial-0-${'ㄲ'.codePointAt(0)}`,
  ])
})

test('never reuses an initial consonant as a final consonant guide', async ({ page }) => {
  await page.goto('/')
  const fixture = makeProjectFixture()
  fixture.currentPrompt = 8 // initial variant 5: vertical vowel with a final consonant
  const initialGiyeokId = `initial-0-${'ㄱ'.codePointAt(0)}`
  const medialAId = `medial-1-${'ㅏ'.codePointAt(0)}`
  fixture.drawings[initialGiyeokId] = {
    promptId: initialGiyeokId,
    codePoint: 'ㄱ'.codePointAt(0),
    elements: [],
    paths: [{ d: 'M 0 0 L 100 0 L 100 100', x: 0, y: 0, width: 100, height: 100 }],
    previewSvg: '<svg viewBox="0 0 100 100"><path d="M0 0L100 0L100 100"/></svg>',
    updatedAt: Date.now(),
  }
  fixture.drawings[medialAId] = {
    promptId: medialAId,
    codePoint: 'ㅏ'.codePointAt(0),
    elements: [],
    paths: [{ d: 'M 50 0 L 50 100', x: 0, y: 0, width: 100, height: 100 }],
    previewSvg: '<svg viewBox="0 0 100 100"><path d="M50 0L50 100"/></svg>',
    updatedAt: Date.now(),
  }
  await seedProject(page, fixture)
  await page.reload()
  await page.goto('/write')

  const fixedPaths = page.getByLabel('이미 수집되어 고정된 자모').locator('path')
  await expect.poll(() => fixedPaths.count()).toBeGreaterThan(0)
  await expect(fixedPaths.first()).toHaveAttribute('fill-rule', 'nonzero')
  expect(await fixedPaths.evaluateAll((paths) => [...new Set(paths.map((path) => path.getAttribute('data-prompt-id')))])).toEqual([medialAId])
  await expect(page.locator(`path[data-prompt-id="${initialGiyeokId}"]`)).toHaveCount(0)
  await expect(page.locator(`path[data-prompt-id="consonant-${'ㄱ'.codePointAt(0)}"]`)).toHaveCount(0)
})

test('keeps 리 and 를 initials as separate contextual variants', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /새 폰트 시작하기/ }).click()
  const frame = page.getByTestId('writing-canvas')
  const box = await frame.boundingBox()
  const cellSize = Number(await frame.getAttribute('data-cell-size'))
  const columns = Number(await frame.getAttribute('data-columns'))
  expect(box).toBeTruthy()
  const stroke = async (cellIndex: number, fromX: number, fromY: number, toX: number, toY: number) => {
    const cellX = (cellIndex % columns) * cellSize
    const cellY = Math.floor(cellIndex / columns) * cellSize
    await page.mouse.move(box!.x + cellX + fromX, box!.y + cellY + fromY)
    await page.mouse.down()
    await page.mouse.move(box!.x + cellX + toX, box!.y + cellY + toY, { steps: 4 })
    await page.mouse.up()
  }
  await stroke(1, 28, 34, 72, 34)
  await expect(page.getByText('리 · ㄹ')).toBeVisible()
  await page.waitForTimeout(350)
  const fixedLayer = page.getByLabel('이미 수집되어 고정된 자모')
  await expect(fixedLayer).toBeVisible()
  await stroke(13, 30, 36, 75, 36)
  await expect(page.getByText('를 · ㄹ')).toBeVisible()
  await page.waitForTimeout(900)

  const saved = await page.evaluate(async () => {
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
  const rieul = 'ㄹ'.codePointAt(0)
  const assignments = saved.writingSessions['hangul-base-0'].assignments.map((item: any) => item.promptId)
  expect(assignments).toContain(`initial-0-${rieul}`)
  expect(assignments).toContain(`initial-6-${rieul}`)
  expect(saved.drawings[`initial-0-${rieul}`].capture.cellIndex).toBe(1)
  expect(saved.drawings[`initial-6-${rieul}`].capture.cellIndex).toBe(13)
  expect(saved.drawings[`consonant-${rieul}`].derivedFromPromptId).toBe(`initial-0-${rieul}`)
})

test('allows a one-stroke rieul boundary to be completed and undone', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /새 폰트 시작하기/ }).click()
  const frame = page.getByTestId('writing-canvas')
  let box = await frame.boundingBox()
  const cellSize = Number(await frame.getAttribute('data-cell-size'))
  const columns = Number(await frame.getAttribute('data-columns'))
  const cellX = (1 % columns) * cellSize
  const cellY = Math.floor(1 / columns) * cellSize
  expect(box).toBeTruthy()
  const stroke = async (fromX: number, fromY: number, toX: number, toY: number) => {
    await page.mouse.move(box!.x + cellX + fromX, box!.y + cellY + fromY)
    await page.mouse.down()
    await page.mouse.move(box!.x + cellX + toX, box!.y + cellY + toY, { steps: 4 })
    await page.mouse.up()
  }
  await stroke(25, 34, 74, 34)
  await page.getByRole('button', { name: '리 · 초성 ㄹ 완료' }).click()
  box = await frame.boundingBox()
  await stroke(82, 34, 82, 112)
  await expect(frame).toHaveAttribute('data-assignment-prompts', new RegExp(`medial-0-${'ㅣ'.codePointAt(0)}`))
  await expect(page.getByText('리 · ㅣ')).toBeVisible()
  await page.waitForTimeout(900)
  await page.reload()
  await expect(page.getByText('리 · ㅣ')).toBeVisible()
  await page.getByRole('button', { name: '경계 되돌리기' }).click()
  await expect(page.getByText('리 · ㅣ')).toHaveCount(0)
  await expect(page.getByText('리 · ㄹ')).toBeVisible()
})

test('warns before generating with missing characters', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'The incomplete generation flow runs once.')
  test.setTimeout(120_000)
  await page.goto('/')
  await page.getByRole('button', { name: /새 폰트 시작하기/ }).click()
  await page.getByRole('button', { name: '지금 폰트 만들기' }).click()

  await expect(page.getByRole('dialog')).toContainText('아직 수집하지 않은 글자가 있어요')
  await expect(page.getByRole('dialog')).toContainText('기본 글자 113개, 문맥형 221개, 기호 25개')
  await page.getByRole('button', { name: '그래도 생성하기' }).click()
  await expect(page).toHaveURL(/\/preview$/, { timeout: 90_000 })

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /OTF 다운로드/ }).click()
  const download = await downloadPromise
  const filePath = await download.path()
  const data = await fs.readFile(filePath!)
  const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  const font = opentype.parse(arrayBuffer)
  const fallbackA = font.charToGlyph('A')
  expect(fallbackA.advanceWidth).toBe(680)
  expect(fallbackA.path.commands).toHaveLength(0)
  expect(font.charToGlyph('가').advanceWidth).toBe(1000)
})

test('uses complete 좋 overlap samples but excludes incomplete ones', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Font geometry is checked once.')
  test.setTimeout(120_000)
  const stroke = (id: string, x: number, y: number, points: [number, number][]) => ({
    id, type: 'freedraw', x, y, width: 0, height: 0, points,
    pressures: points.map(() => 1), strokeWidth: 1, version: 1, simulatePressure: false,
  })
  const elements = [
    stroke('i1', 30, 25, [[0, 0], [50, 0]]),
    stroke('i2', 30, 25, [[0, 0], [25, 35]]),
    stroke('i3', 80, 25, [[0, 0], [-25, 35]]),
    stroke('m1', 20, 56, [[0, 0], [80, 0]]),
    stroke('m2', 60, 56, [[0, 0], [0, 35]]),
    stroke('f1', 35, 108, [[0, 0], [45, 0]]),
    stroke('f2', 42, 111, [[0, 0], [30, 20]]),
    stroke('f3', 68, 111, [[0, 0], [-24, 20]]),
  ]
  const assignments = elements.map((element, index) => ({
    elementId: element.id, cellIndex: 0, slotIndex: index < 3 ? 0 : index < 5 ? 1 : 2, promptId: `sample-${index}`,
  }))
  const makeFixture = (complete: boolean) => {
    const fixture = makeProjectFixture()
    fixture.writingSessions['hangul-base-3'] = {
      exerciseId: 'hangul-base-3', text: '좋은 글씨로 조화를 이루며 써요', elements,
      assignments: complete ? assignments : assignments.filter((assignment) => assignment.elementId !== 'm2'),
      boundaries: {}, cellSize: 148, columns: 6, updatedAt: Date.now(),
    }
    const initialId = `initial-6-${'ㅈ'.codePointAt(0)}`
    const medialId = `medial-1-${'ㅗ'.codePointAt(0)}`
    fixture.drawings[initialId] = {
      promptId: initialId, codePoint: 'ㅈ'.codePointAt(0), elements: [],
      paths: [{ d: 'M 0 0 L 20 0 L 10 42 Z', x: 45, y: 20, width: 20, height: 42 }],
      previewSvg: '<svg/>', updatedAt: Date.now(),
      capture: { exerciseId: 'hangul-base-3', cellIndex: 0, slotIndex: 0 },
    }
    fixture.drawings[medialId] = {
      promptId: medialId, codePoint: 'ㅗ'.codePointAt(0), elements: [],
      paths: [{ d: 'M 0 0 L 60 0 L 60 8 L 0 8 Z', x: 25, y: 70, width: 60, height: 8 }],
      previewSvg: '<svg/>', updatedAt: Date.now(),
      capture: { exerciseId: 'hangul-base-3', cellIndex: 1, slotIndex: 1 },
    }
    return fixture
  }
  const generatedGap = async (complete: boolean) => {
    const fixture = makeFixture(complete)
    const profile = learnGaps(fixture.writingSessions)
    await page.goto('/')
    await seedProject(page, fixture)
    await page.goto('/generate')
    await expect(page).toHaveURL(/\/preview$/, { timeout: 90_000 })
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /OTF 다운로드/ }).click()
    const filePath = await (await downloadPromise).path()
    const data = await fs.readFile(filePath!)
    const font = opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
    expect(font.charToGlyph('좋').path.commands.length).toBeGreaterThan(0)
    return {
      upper: profile.syllables['좋'],
      final: profile.finalSyllables['좋'],
      pair: profile.finalPairs['ㅗ:ㅎ'],
      context: profile.finalContexts['horizontalUp:single'],
    }
  }
  const completeGap = await generatedGap(true)
  const incompleteGap = await generatedGap(false)
  expect(completeGap.upper).toBeLessThan(0)
  expect(completeGap.final).toBeDefined()
  expect(completeGap.pair).toBe(completeGap.final)
  expect(completeGap.context).toBe(completeGap.final)
  expect(incompleteGap.upper).toBeUndefined()
  expect(incompleteGap.final).toBeUndefined()
})

test('overlaps upward vowels and separates 루 and 늘 even with shared source cells', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Font geometry is checked once.')
  test.setTimeout(120_000)
  const fixture = makeProjectFixture()
  const addShape = (role: string, variant: number, char: string, d: string, x: number, y: number, width: number, height: number, cellIndex: number) => {
    const id = `${role}-${variant}-${char.codePointAt(0)}`
    fixture.drawings[id] = {
      promptId: id, codePoint: char.codePointAt(0), elements: [],
      paths: [{ d, x, y, width, height }], previewSvg: '<svg/>', updatedAt: Date.now(),
      capture: { exerciseId: 'hangul-base-0', cellIndex, slotIndex: role === 'initial' ? 0 : role === 'medial' ? 1 : 2 },
    }
  }
  const triangle = 'M 0 60 L 0 0 L 60 0 L 60 60 L 50 60 L 50 10 L 10 10 L 10 60 Z'
  const bar = 'M 0 50 L 27 50 L 27 0 L 33 0 L 33 50 L 60 50 L 60 60 L 0 60 Z'
  for (const char of ['ㅅ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㄱ']) addShape('initial', 1, char, triangle, 45, 20, 20, 42, char.codePointAt(0)!)
  addShape('initial', 1, 'ㅁ', 'M 0 0 L 60 0 L 60 42 L 0 42 Z', 25, 20, 60, 42, 24)
  addShape('medial', 0, 'ㅗ', bar, 25, 70, 60, 8, 25)
  addShape('medial', 0, 'ㅛ', bar, 25, 70, 60, 8, 26)
  addShape('initial', 6, 'ㅈ', triangle, 45, 20, 20, 42, 27)
  addShape('medial', 1, 'ㅗ', bar, 25, 70, 60, 8, 28)
  addShape('initial', 2, 'ㄹ', triangle, 45, 20, 20, 42, 0)
  addShape('medial', 0, 'ㅜ', bar, 25, 63, 60, 8, 0)
  addShape('initial', 6, 'ㄴ', triangle, 45, 20, 20, 42, 1)
  addShape('medial', 1, 'ㅡ', bar, 25, 63, 60, 8, 1)
  addShape('final', 0, 'ㄹ', bar, 25, 73, 60, 8, 1)
  await page.goto('/')
  await seedProject(page, fixture)
  await page.goto('/generate')
  await expect(page).toHaveURL(/\/preview$/, { timeout: 90_000 })
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /OTF 다운로드/ }).click()
  const filePath = await (await downloadPromise).path()
  const data = await fs.readFile(filePath!)
  const font = opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
  const yBox = (commands: opentype.Path['commands']) => {
    const values = commands.flatMap((command) => 'y' in command ? [command.y] : [])
    return { bottom: Math.min(...values), top: Math.max(...values) }
  }
  const gaps = (char: string) => {
    const commands = font.charToGlyph(char).path.commands
    const firstEnd = commands.findIndex((command) => command.type === 'Z')
    const secondRelative = commands.slice(firstEnd + 1).findIndex((command) => command.type === 'Z')
    const secondEnd = secondRelative < 0 ? commands.length : firstEnd + 1 + secondRelative
    const initial = yBox(commands.slice(0, firstEnd + 1))
    const medial = yBox(commands.slice(firstEnd + 1, secondEnd + 1))
    const final = yBox(commands.slice(secondEnd + 1))
    return { upper: initial.bottom - medial.top, final: final.top === -Infinity ? Infinity : Math.min(initial.bottom, medial.bottom) - final.top }
  }
  for (const char of ['소', '조', '초', '코', '쇼', '좋', '고']) expect(gaps(char).upper, char).toBeLessThan(0)
  expect(gaps('모').upper).toBeGreaterThanOrEqual(40)
  expect(gaps('루').upper).toBeGreaterThanOrEqual(40)
  expect(gaps('늘').upper).toBeGreaterThanOrEqual(40)
  expect(gaps('늘').final).toBeGreaterThanOrEqual(40)
})

test('normalizes Hangul, jamo, Latin, and digits by their own controls', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Font geometry is checked once.')
  test.setTimeout(120_000)
  const generate = async (strength: number, initialHeightRatio = 1) => {
    await page.goto('/')
    const fixture = makeProjectFixture()
    Object.assign(fixture, { settingsVersion: 4 })
    Object.assign(fixture.compositionSettings, {
      hangulNormalization: strength, jamoNormalization: strength,
      latinNormalization: strength, numberNormalization: strength, widthMode: 'proportional',
      standaloneJamoMaxHeight: initialHeightRatio,
    })
    for (const [group, char] of [['consonant', 'ㄱ'], ['uppercase', 'A'], ['number', '1']]) {
      const id = `${group}-${char.codePointAt(0)}`
      fixture.drawings[id] = {
        promptId: id, codePoint: char.codePointAt(0), elements: [],
        paths: [{ d: 'M 0 0 L 100 0 L 100 20 L 0 20 Z', x: 0, y: 0, width: 100, height: 20 }],
        previewSvg: '<svg/>', updatedAt: Date.now(),
      }
    }
    const hieutId = `consonant-${'ㅎ'.codePointAt(0)}`
    fixture.drawings[hieutId] = {
      promptId: hieutId, codePoint: 'ㅎ'.codePointAt(0), paths: [], previewSvg: '<svg/>', updatedAt: Date.now(),
      elements: [{ id: 'hieut-line', type: 'freedraw', x: 70, y: 15, width: 0, height: 100,
        points: [[0, 0], [0, 100]], pressures: [1, 1], strokeWidth: 1, version: 1, simulatePressure: false }],
    }
    const sampleStroke = (id: string, x: number, y: number, points: [number, number][]) => ({
      id, type: 'freedraw', x, y, width: 0, height: 0, points,
      pressures: points.map(() => 1), strokeWidth: 1, version: 1, simulatePressure: false,
    })
    fixture.writingSessions['hangul-base-0'] = {
      exerciseId: 'hangul-base-0', text: '우리', cellSize: 148, columns: 6, boundaries: {}, updatedAt: Date.now(),
      elements: [
        sampleStroke('sample-initial', 45, 20, [[0, 0], [20, 30]]),
        sampleStroke('sample-medial-a', 30, 70, [[0, 0], [50, 0]]),
        sampleStroke('sample-medial-b', 55, 70, [[0, 0], [0, 20]]),
      ],
      assignments: [
        { elementId: 'sample-initial', cellIndex: 0, slotIndex: 0, promptId: 'sample-initial' },
        { elementId: 'sample-medial-a', cellIndex: 0, slotIndex: 1, promptId: 'sample-medial' },
        { elementId: 'sample-medial-b', cellIndex: 0, slotIndex: 1, promptId: 'sample-medial' },
      ],
    }
    await seedProject(page, fixture)
    await page.goto('/generate')
    await expect(page).toHaveURL(/\/preview$/, { timeout: 90_000 })
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /OTF 다운로드/ }).click()
    const filePath = await (await downloadPromise).path()
    const data = await fs.readFile(filePath!)
    const font = opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
    const heights = Object.fromEntries(['ㄱ', 'ㅎ', 'ㅜ', 'A', '1', '가', '고', '각'].map((char) => {
      const box = font.charToGlyph(char).getBoundingBox()
      return [char, box.y2 - box.y1]
    }))
    const hieutBox = font.charToGlyph('ㅎ').getBoundingBox()
    const uBox = font.charToGlyph('ㅜ').getBoundingBox()
    const gaBox = font.charToGlyph('가').getBoundingBox()
    return { ...heights, hieutStrokeDiameter: hieutBox.x2 - hieutBox.x1, uWidth: uBox.x2 - uBox.x1, gaWidth: gaBox.x2 - gaBox.x1 }
  }
  const original = await generate(0)
  const partial = await generate(0.6)
  const normalized = await generate(1)
  const capped = await generate(0, 0.8)
  for (const char of ['ㄱ', 'A', '1']) expect(normalized[char], JSON.stringify({ char, original, normalized })).toBeGreaterThan(original[char])
  for (const char of ['ㅎ', 'ㅜ']) expect(normalized[char], char).toBeLessThanOrEqual(normalized['가'] + 1)
  expect(normalized.uWidth).toBeLessThanOrEqual(normalized.gaWidth + 1)
  expect(partial['ㅎ']).toBeGreaterThanOrEqual(original['ㅎ'])
  expect(partial['ㅎ']).toBeLessThanOrEqual(normalized['ㅎ'] + 1)
  expect(normalized.hieutStrokeDiameter).toBeGreaterThanOrEqual(original.hieutStrokeDiameter)
  expect(capped['ㅎ']).toBeLessThanOrEqual(original['ㅎ'] * 0.8 + 1)
  expect(capped['ㅎ']).toBeLessThan(original['ㅎ'])
  expect(capped.hieutStrokeDiameter).toBeLessThan(original.hieutStrokeDiameter)
  expect(['가', '고', '각'].some((char) => Math.abs(normalized[char] - original[char]) > 1), JSON.stringify({ original, normalized })).toBe(true)
})

test('uses a bounded final consonant only until an initial sample exists, and links to its source cell', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Source and font geometry are checked once.')
  test.setTimeout(120_000)
  const fixture = makeProjectFixture()
  const finalId = `final-0-${'ㄴ'.codePointAt(0)}`
  fixture.drawings[finalId] = {
    promptId: finalId, codePoint: 'ㄴ'.codePointAt(0),
    elements: [{ id: 'final-n', type: 'freedraw', x: 20, y: 100, width: 100, height: 0,
      points: [[0, 0], [100, 0]], pressures: [1, 1], strokeWidth: 1, version: 1, simulatePressure: false }],
    paths: [],
    previewSvg: '<svg/>', updatedAt: Date.now(), capture: { exerciseId: 'hangul-base-0', cellIndex: 3, slotIndex: 2 },
  }
  fixture.drawings[`consonant-${'ㄴ'.codePointAt(0)}`] = {
    ...fixture.drawings[finalId] as object, promptId: `consonant-${'ㄴ'.codePointAt(0)}`,
    derivedFromPromptId: finalId,
  }
  Object.assign(fixture.compositionSettings, { hangulNormalization: 0, verticalAlignment: 0 })
  Object.assign(fixture, { settingsVersion: 4 })
  await page.goto('/')
  await seedProject(page, fixture)
  await page.goto('/generate')
  await expect(page).toHaveURL(/\/preview$/, { timeout: 90_000 })
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /OTF 다운로드/ }).click()
  const filePath = await (await downloadPromise).path()
  const data = await fs.readFile(filePath!)
  const font = opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
  const allCommands = font.charToGlyph('내').path.commands
  const initialCommands = allCommands.slice(0, allCommands.findIndex((command) => command.type === 'Z') + 1)
  const initialX = initialCommands.flatMap((command) => 'x' in command ? [command.x] : [])
  const initialY = initialCommands.flatMap((command) => 'y' in command ? [command.y] : [])
  expect(Math.max(...initialX) - Math.min(...initialX)).toBeLessThan(370)
  // The borrowed two-point stroke keeps its real pen thickness. The previous
  // normalized-coordinate bug inflated this into a 56–150 unit semicircle.
  expect(Math.max(...initialY) - Math.min(...initialY)).toBeGreaterThan(10)
  expect(Math.max(...initialY) - Math.min(...initialY)).toBeLessThan(50)
  await page.getByRole('link', { name: /고급 편집/ }).click()
  await page.getByPlaceholder('문자 검색').fill('내')
  await page.getByRole('button', { name: '내' }).click()
  const sourceButton = page.getByRole('button', { name: '초성 ㄴ' })
  await expect(sourceButton).toHaveText('초성 ㄴ')
  await sourceButton.click()
  await expect(page).toHaveURL(/\/write\?exerciseId=hangul-base-0&cellIndex=3&returnGlyph=45236/)
  expect(new URL(page.url()).searchParams.get('returnQuery')).toBe('내')
  await expect(page.locator('[data-source-cell="true"]')).toContainText('한')
  await page.getByRole('button', { name: '기존 폰트 미리보기 · 편집' }).click()
  await expect(page).toHaveURL(/\/edit\?glyph=45236/)
  await expect(page.getByPlaceholder('문자 검색')).toHaveValue('내')
  await expect(page.getByRole('button', { name: '초성 ㄴ' })).toBeVisible()
  await page.getByPlaceholder('문자 검색').fill('')
  await page.getByRole('button', { name: '초성 ㄴ' }).click()
  expect(new URL(page.url()).searchParams.has('returnQuery')).toBe(false)
  await page.getByRole('button', { name: '기존 폰트 미리보기 · 편집' }).click()
  await expect(page.getByPlaceholder('문자 검색')).toHaveValue('')
  await expect(page.getByRole('button', { name: '초성 ㄴ' })).toBeVisible()

  const initialId = `initial-0-${'ㄴ'.codePointAt(0)}`
  fixture.drawings[initialId] = {
    promptId: initialId, codePoint: 'ㄴ'.codePointAt(0), elements: [],
    paths: [{ d: 'M 0 0 L 35 0 L 35 40 Z', x: 30, y: 30, width: 35, height: 40 }],
    previewSvg: '<svg/>', updatedAt: Date.now(), capture: { exerciseId: 'hangul-initial-0', cellIndex: 2, slotIndex: 0 },
  }
  await seedProject(page, fixture)
  await page.goto('/generate')
  await expect(page).toHaveURL(/\/preview$/, { timeout: 90_000 })
  await page.getByRole('link', { name: /고급 편집/ }).click()
  await page.getByPlaceholder('문자 검색').fill('내')
  await page.getByRole('button', { name: '내' }).click()
  await page.getByRole('button', { name: '초성 ㄴ' }).click()
  await expect(page).toHaveURL(/\/write\?exerciseId=hangul-initial-0&cellIndex=2&returnGlyph=45236/)
  await page.getByRole('button', { name: '기존 폰트 미리보기 · 편집' }).click()
  await page.getByPlaceholder('문자 검색').fill('가')
  await page.getByRole('button', { name: '가' }).click({ modifiers: ['Control'] })
  await expect(page.getByText('글자 하나를 선택하면 출처를 볼 수 있어요.')).toBeVisible()
  await page.getByPlaceholder('문자 검색').fill('+')
  await page.getByRole('button', { name: '+', exact: true }).click()
  await expect(page.getByText('작성된 원본이 없습니다.')).toBeVisible()
})

test('writes punctuation as independent glyphs and leaves unwritten symbols out of OTF', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Symbol font geometry is checked once.')
  test.setTimeout(120_000)
  const fixture = makeProjectFixture()
  const point = `symbol-${'.'.codePointAt(0)}`
  fixture.drawings[point] = {
    promptId: point, codePoint: '.'.codePointAt(0), paths: [], previewSvg: '<svg/>', updatedAt: Date.now(),
    elements: [{ id: 'period', type: 'freedraw', x: 75, y: 95, width: 0, height: 0,
      points: [[0, 0]], pressures: [1], strokeWidth: 1, version: 1, simulatePressure: false }],
    capture: { exerciseId: 'symbols-punctuation', cellIndex: 0, slotIndex: 0 },
  }
  const addSymbol = (char: string, d: string, exerciseId: string, cellIndex: number) => {
    const id = `symbol-${char.codePointAt(0)}`
    fixture.drawings[id] = {
      promptId: id, codePoint: char.codePointAt(0), elements: [],
      paths: [{ d, x: 50, y: 60, width: 40, height: 45 }], previewSvg: '<svg/>', updatedAt: Date.now(),
      capture: { exerciseId, cellIndex, slotIndex: 0 },
    }
  }
  addSymbol(',', 'M 0 0 L 20 0 L 10 25 Z', 'symbols-punctuation', 1)
  addSymbol('!', 'M 0 0 L 10 0 L 10 60 L 0 60 Z', 'symbols-punctuation', 2)
  addSymbol('?', 'M 0 0 L 35 0 L 35 60 L 0 60 Z', 'symbols-punctuation', 3)
  addSymbol("'", 'M 0 0 L 12 0 L 12 28 L 0 28 Z', 'symbols-punctuation', 6)
  addSymbol('+', 'M 0 0 L 40 0 L 40 10 L 0 10 Z', 'symbols-operators', 0)
  Object.assign(fixture, { settingsVersion: 4 })
  Object.assign(fixture.compositionSettings, { verticalAlignment: 0 })
  await page.goto('/')
  await seedProject(page, fixture)
  await page.goto('/generate')
  await expect(page).toHaveURL(/\/preview$/, { timeout: 90_000 })
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /OTF 다운로드/ }).click()
  const filePath = await (await downloadPromise).path()
  const data = await fs.readFile(filePath!)
  const font = opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
  expect(font.charToGlyph('.').index).toBeGreaterThan(0)
  expect(font.charToGlyph('=').index).toBe(0)
  expect(font.charToGlyph('.').getBoundingBox().y1).toBeGreaterThan(40)
  expect(font.charToGlyph('.').getBoundingBox().y1).toBeLessThan(100)
  expect(Math.abs(font.charToGlyph('.').getBoundingBox().y1 - font.charToGlyph('요').getBoundingBox().y1)).toBeLessThan(180)
  expect(font.charToGlyph('.').advanceWidth).toBeLessThan(300)
  expect(font.charToGlyph(',').getBoundingBox().y2).toBeCloseTo(140, 0)
  expect(font.charToGlyph("'").getBoundingBox().y2).toBeCloseTo(780, 0)
  for (const char of ['!', '?']) {
    const box = font.charToGlyph(char).getBoundingBox()
    expect(box.y2 - box.y1, char).toBeGreaterThanOrEqual(690)
    expect(box.y2 - box.y1, char).toBeLessThanOrEqual(760)
  }
  const plusBox = font.charToGlyph('+').getBoundingBox()
  expect((plusBox.y1 + plusBox.y2) / 2).toBeCloseTo(450, 0)
  Object.assign(fixture.compositionSettings, { verticalAlignment: 1, hangulNormalization: 1, latinNormalization: 1 })
  await seedProject(page, fixture)
  await page.goto('/generate')
  await expect(page).toHaveURL(/\/preview$/, { timeout: 90_000 })
  const secondDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: /OTF 다운로드/ }).click()
  const secondFilePath = await (await secondDownload).path()
  const secondData = await fs.readFile(secondFilePath!)
  const secondFont = opentype.parse(secondData.buffer.slice(secondData.byteOffset, secondData.byteOffset + secondData.byteLength))
  for (const char of ['.', ',', '!', '?', "'", '+']) {
    const first = font.charToGlyph(char).getBoundingBox()
    const second = secondFont.charToGlyph(char).getBoundingBox()
    expect(Math.abs(first.y1 - second.y1), char).toBeLessThanOrEqual(1)
    expect(Math.abs(first.y2 - second.y2), char).toBeLessThanOrEqual(1)
  }
  await page.getByRole('link', { name: /고급 편집/ }).click()
  await page.getByPlaceholder('문자 검색').fill('.')
  await page.getByRole('button', { name: '.', exact: true }).click()
  await expect(page.getByRole('button', { name: '기호 .' })).toHaveText('기호 .')
})

test('collects a symbol in its own exercise and restores its source', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /새 폰트 시작하기/ }).click()
  await page.locator('.exercise-chip').filter({ hasText: '문장부호' }).click()
  await expect(page.getByRole('heading', { name: '.,!?;:\'"()[]' })).toBeVisible()
  const frame = page.getByTestId('writing-canvas')
  const box = await frame.boundingBox()
  expect(box).toBeTruthy()
  await page.mouse.move(box!.x + 70, box!.y + 104)
  await page.mouse.down()
  await page.mouse.move(box!.x + 72, box!.y + 105, { steps: 2 })
  await page.mouse.up()
  await expect(page.getByText('. · .')).toBeVisible()
  await page.waitForTimeout(700)
  await page.reload()
  await expect(page.getByText('. · .')).toBeVisible()
  await expect(page.locator('.exercise-chip').filter({ hasText: '문장부호' })).toHaveClass(/current/)
})

test('moves Hangul toward its vertical reference without changing its ink size', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Font vertical metrics are checked once.')
  test.setTimeout(120_000)
  const generate = async (verticalAlignment: number) => {
    const fixture = makeProjectFixture()
    Object.assign(fixture, { settingsVersion: 4 })
    Object.assign(fixture.compositionSettings, { verticalAlignment, hangulNormalization: 0 })
    for (const [role, char, x] of [['initial', 'ㄱ', 20], ['medial', 'ㅏ', 90]] as const) {
      const id = `${role}-0-${char.codePointAt(0)}`
      fixture.drawings[id] = {
        promptId: id, codePoint: char.codePointAt(0), elements: [],
        paths: [{ d: 'M 0 0 L 28 0 L 28 28 L 0 28 Z', x, y: 8, width: 28, height: 28 }],
        previewSvg: '<svg/>', updatedAt: Date.now(),
        capture: { exerciseId: 'hangul-base-0', cellIndex: 0, slotIndex: role === 'initial' ? 0 : 1 },
      }
    }
    fixture.drawings[`lowercase-${'g'.codePointAt(0)}`] = {
      promptId: `lowercase-${'g'.codePointAt(0)}`, codePoint: 'g'.codePointAt(0), elements: [],
      paths: [{ d: 'M 0 0 L 100 0 L 100 100 L 0 100 Z', x: 0, y: 0, width: 100, height: 100 }],
      previewSvg: '<svg/>', updatedAt: Date.now(),
    }
    fixture.drawings[`lowercase-${'a'.codePointAt(0)}`] = {
      promptId: `lowercase-${'a'.codePointAt(0)}`, codePoint: 'a'.codePointAt(0), elements: [],
      paths: [{ d: 'M 0 0 L 100 0 L 100 20 L 0 20 Z', x: 0, y: 0, width: 100, height: 20 }],
      previewSvg: '<svg/>', updatedAt: Date.now(),
    }
    await page.goto('/')
    await seedProject(page, fixture)
    await page.goto('/generate')
    await expect(page).toHaveURL(/\/preview$/, { timeout: 90_000 })
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /OTF 다운로드/ }).click()
    const filePath = await (await downloadPromise).path()
    const data = await fs.readFile(filePath!)
    const font = opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
    const box = font.charToGlyph('가').getBoundingBox()
    return { center: (box.y1 + box.y2) / 2, height: box.y2 - box.y1,
      gBottom: font.charToGlyph('g').getBoundingBox().y1, aBottom: font.charToGlyph('a').getBoundingBox().y1 }
  }
  const zero = await generate(0)
  const partial = await generate(0.8)
  const full = await generate(1)
  expect(Math.abs(partial.center - 500)).toBeLessThan(Math.abs(zero.center - 500))
  expect(Math.abs(full.center - 500)).toBeLessThanOrEqual(Math.abs(partial.center - 500))
  expect(Math.abs(partial.height - zero.height)).toBeLessThanOrEqual(1)
  expect(Math.abs(full.height - zero.height)).toBeLessThanOrEqual(1)
  expect(full.gBottom).toBeLessThan(full.aBottom)
})

test('restores a sentence-writing project', async ({ page }) => {
  await page.goto('/')
  const fixture = makeProjectFixture()
  Object.assign(fixture.compositionSettings, { jamoNormalization: 0 })
  await seedProject(page, fixture)
  await page.reload()
  await expect.poll(() => page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('ownchar', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const project = await new Promise<any>((resolve, reject) => {
      const request = database.transaction('project', 'readonly').objectStore('project').get('current')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return `${project?.settingsVersion}:${project?.compositionSettings?.jamoNormalization}:${project?.compositionSettings?.standaloneJamoMaxHeight}:${project?.compositionSettings?.endpointStabilization}:${project?.fontDirty}`
  })).toBe('6:1:1:1:true')
  await page.goto('/write')
  await expect(page.getByText('113 / 359')).toBeVisible()
  await expect(page.getByRole('heading', { name: '0123456789' })).toBeVisible()
  await expect(page.getByRole('button', { name: '폰트 만들기' })).toBeEnabled()
  await expect(page.getByLabel('문장 진행 상황')).toBeVisible()
  await expect(page.getByText('획을 시작한 칸과 작성 순서를 기준으로 자동 분리됩니다.')).toBeVisible()
})

test('migrates vertical alignment while preserving an explicitly chosen zero jamo normalization', async ({ page }) => {
  const fixture = makeProjectFixture()
  Object.assign(fixture, { settingsVersion: 2 })
  Object.assign(fixture.compositionSettings, { jamoNormalization: 0, standaloneInitialMaxHeight: 0.7 })
  await page.goto('/')
  await seedProject(page, fixture)
  await page.reload()
  await expect.poll(() => page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('ownchar', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const project = await new Promise<any>((resolve, reject) => {
      const request = database.transaction('project', 'readonly').objectStore('project').get('current')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return `${project?.settingsVersion}:${project?.compositionSettings?.jamoNormalization}:${project?.compositionSettings?.standaloneJamoMaxHeight}:${project?.compositionSettings?.verticalAlignment}:${project?.compositionSettings?.endpointStabilization}:${project?.fontDirty}`
  })).toBe('6:0:0.7:0.8:1:true')
})

test('asks whether to retain advanced edits before recomposition', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'The recomposition conflict flow runs once.')
  test.setTimeout(120_000)
  const fixture = makeProjectFixture()
  fixture.sourceDirty = true
  fixture.glyphOverrides = { 44032: { left: 12, right: 0, y: 0, scale: 1, rotation: 0 } }
  await page.goto('/')
  await seedProject(page, fixture)
  await page.reload()
  await page.goto('/write')
  await page.getByRole('button', { name: '폰트 만들기' }).click()
  await expect(page.getByRole('dialog')).toContainText('문맥형 221개')
  await page.getByRole('button', { name: '그래도 생성하기' }).click()
  await expect(page.getByRole('dialog')).toContainText('기존 글리프 보정을 어떻게 할까요?')
  await expect(page.getByRole('dialog')).toContainText('1개 글리프')
  await page.getByRole('button', { name: '기존 보정 삭제 후 재합성' }).click()
  await expect(page).toHaveURL(/\/preview$/, { timeout: 90_000 })
})

test('generates a complete Hangul OTF', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'The full font generation assertion runs once.')
  test.setTimeout(180_000)
  await page.goto('/')
  const fixture = makeProjectFixture()
  const mixedInitialId = `initial-3-${'ㄱ'.codePointAt(0)}`
  fixture.drawings[mixedInitialId] = {
    promptId: mixedInitialId,
    codePoint: 'ㄱ'.codePointAt(0),
    elements: [],
    paths: [{ d: 'M 0 0 L 200 0 L 100 100 Z', x: 0, y: 0, width: 200, height: 100 }],
    previewSvg: '<svg viewBox="0 0 200 100"><path d="M0 0L200 0L100 100Z"/></svg>',
    updatedAt: Date.now(),
  }
  const denseMedialId = `medial-0-${'ㅏ'.codePointAt(0)}`
  const denseCommands = Array.from({ length: 90 }, (_, index) => `C ${index + 0.2} 0 ${index + 0.8} 100 ${index + 1} 50`).join(' ')
  fixture.drawings[denseMedialId] = {
    promptId: denseMedialId,
    codePoint: 'ㅏ'.codePointAt(0),
    elements: [{ deliberatelyLargeRawInput: 'x'.repeat(250_000) }],
    paths: [{ d: `M 0 50 ${denseCommands} Z`, x: 0, y: 0, width: 90, height: 100 }],
    previewSvg: `<svg>${'unused-preview-data'.repeat(10_000)}</svg>`,
    updatedAt: Date.now(),
  }
  const initialId = `initial-0-${'ㄱ'.codePointAt(0)}`
  fixture.drawings[initialId] = {
    promptId: initialId,
    codePoint: 'ㄱ'.codePointAt(0),
    elements: [],
    paths: [{ d: 'M 0 0 L 30 0 L 30 30 Z', x: 20, y: 30, width: 30, height: 30 }],
    capture: { exerciseId: 'hangul-base-0', cellIndex: 0, slotIndex: 0 },
    previewSvg: '<svg/>',
    updatedAt: Date.now(),
  }
  const medialId = `medial-0-${'ㅓ'.codePointAt(0)}`
  fixture.drawings[medialId] = {
    promptId: medialId,
    codePoint: 'ㅓ'.codePointAt(0),
    elements: [],
    paths: [{ d: 'M 0 0 L 0 70 L 20 35 Z', x: 85, y: 20, width: 20, height: 70 }],
    capture: { exerciseId: 'hangul-base-0', cellIndex: 0, slotIndex: 1 },
    previewSvg: '<svg/>',
    updatedAt: Date.now(),
  }
  const sampleStroke = (id: string, x: number, y: number, points: [number, number][]) => ({
    id, type: 'freedraw', x, y, width: 0, height: 0, points, pressures: points.map(() => 1), strokeWidth: 1, version: 1, simulatePressure: false,
  })
  const ieungId = `consonant-${'ㅇ'.codePointAt(0)}`
  const ieungPoints: [number, number][] = [[0, -20], [14, -14], [20, 0], [14, 14], [0, 20], [-14, 14], [-20, 0], [-14, -14], [0, -20]]
  fixture.drawings[ieungId] = {
    promptId: ieungId, codePoint: 'ㅇ'.codePointAt(0),
    elements: [sampleStroke('ieung-loop', 74, 70, ieungPoints)], paths: [], previewSvg: '<svg/>', updatedAt: Date.now(),
  }
  const euId = `vowel-${'ㅡ'.codePointAt(0)}`
  fixture.drawings[euId] = {
    promptId: euId, codePoint: 'ㅡ'.codePointAt(0),
    elements: [sampleStroke('eu-line', 44, 74, [[0, 0], [60, 0]])], paths: [], previewSvg: '<svg/>', updatedAt: Date.now(),
  }
  fixture.writingSessions['hangul-base-0'] = {
    exerciseId: 'hangul-base-0', text: '우리',
    elements: [
      sampleStroke('initial-complete', 35, 20, [[0, 0], [20, 40]]),
      sampleStroke('medial-complete-a', 25, 83, [[0, 0], [55, 0]]),
      sampleStroke('medial-complete-b', 52, 83, [[0, 0], [0, 20]]),
      sampleStroke('initial-incomplete', 200, 15, [[0, 0], [30, 0]]),
    ],
    assignments: [
      { elementId: 'initial-complete', cellIndex: 0, slotIndex: 0, promptId: 'sample-initial' },
      { elementId: 'medial-complete-a', cellIndex: 0, slotIndex: 1, promptId: 'sample-medial' },
      { elementId: 'medial-complete-b', cellIndex: 0, slotIndex: 1, promptId: 'sample-medial' },
      { elementId: 'initial-incomplete', cellIndex: 1, slotIndex: 0, promptId: 'sample-incomplete' },
    ],
    boundaries: {}, cellSize: 148, columns: 6, updatedAt: Date.now(),
  }
  fixture.drawings[`initial-3-${'ㄹ'.codePointAt(0)}`] = {
    promptId: `initial-3-${'ㄹ'.codePointAt(0)}`, codePoint: 'ㄹ'.codePointAt(0), elements: [],
    paths: [{ d: 'M 0 0 L 60 0 L 60 60 Z', x: 35, y: 20, width: 60, height: 60 }],
    previewSvg: '<svg/>', updatedAt: Date.now(), capture: { exerciseId: 'hangul-base-0', cellIndex: 0, slotIndex: 0 },
  }
  fixture.drawings[`medial-0-${'ㅜ'.codePointAt(0)}`] = {
    promptId: `medial-0-${'ㅜ'.codePointAt(0)}`, codePoint: 'ㅜ'.codePointAt(0), elements: [],
    paths: [{ d: 'M 0 0 L 60 0 L 30 30 Z', x: 35, y: 75, width: 60, height: 30 }],
    previewSvg: '<svg/>', updatedAt: Date.now(), capture: { exerciseId: 'hangul-base-0', cellIndex: 0, slotIndex: 1 },
  }
  const rieulFromRiId = `initial-0-${'ㄹ'.codePointAt(0)}`
  fixture.drawings[rieulFromRiId] = {
    promptId: rieulFromRiId, codePoint: 'ㄹ'.codePointAt(0), elements: [],
    paths: [{ d: 'M 0 0 L 55 0 L 55 45 Z', x: 22, y: 20, width: 55, height: 45 }],
    previewSvg: '<svg/>', updatedAt: Date.now(), capture: { exerciseId: 'hangul-base-0', cellIndex: 1, slotIndex: 0 },
  }
  fixture.drawings[`consonant-${'ㄹ'.codePointAt(0)}`] = {
    ...fixture.drawings[rieulFromRiId] as object,
    promptId: `consonant-${'ㄹ'.codePointAt(0)}`,
    derivedFromPromptId: rieulFromRiId,
  }
  fixture.drawings[`initial-2-${'ㄴ'.codePointAt(0)}`] = {
    promptId: `initial-2-${'ㄴ'.codePointAt(0)}`, codePoint: 'ㄴ'.codePointAt(0), elements: [],
    paths: [{ d: 'M 0 0 L 30 0 L 30 35 Z', x: 20, y: 20, width: 30, height: 35 }],
    previewSvg: '<svg/>', updatedAt: Date.now(), capture: { exerciseId: 'hangul-base-0', cellIndex: 0, slotIndex: 0 },
  }
  await seedProject(page, fixture)
  await page.goto('/generate')
  await expect(page.getByRole('heading', { name: '폰트를 만들고 있어요' })).toBeVisible()
  await expect(page).toHaveURL(/\/preview$/, { timeout: 120_000 })
  await expect(page.getByRole('heading', { name: '손글씨가 폰트가 되었어요.' })).toBeVisible()
  const preview = page.getByLabel('직접 입력해 보세요')
  await expect(preview).toHaveCSS('font-size', '80px')
  const sizeSlider = page.getByRole('slider', { name: '미리보기 글자 크기' })
  await expect(sizeSlider).toHaveAttribute('aria-valuenow', '80')
  await sizeSlider.press('ArrowRight')
  await expect(preview).toHaveCSS('font-size', '82px')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /OTF 다운로드/ }).click()
  const download = await downloadPromise
  const filePath = await download.path()
  expect(filePath).toBeTruthy()
  const data = await fs.readFile(filePath!)
  const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  const font = opentype.parse(arrayBuffer)

  expect(font.glyphs.length).toBeGreaterThanOrEqual(11_260)
  const referenceBox = font.charToGlyph('우').getBoundingBox()
  expect(referenceBox.y2 - referenceBox.y1).toBeGreaterThan(760)
  expect(referenceBox.y2 - referenceBox.y1).toBeLessThan(840)
  const visibleHeights = await page.evaluate(async () => {
    await document.fonts.load('36px OwnCharPreview')
    const context = document.createElement('canvas').getContext('2d')!
    return [36, 72, 144].map((size) => {
      context.font = `${size}px OwnCharPreview`
      const metrics = context.measureText('우')
      return metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent
    })
  })
  expect(visibleHeights[0]).toBeGreaterThan(26)
  expect(visibleHeights[0]).toBeLessThan(32)
  expect(visibleHeights[1]).toBeGreaterThan(52)
  expect(visibleHeights[2]).toBeGreaterThan(104)
  const rasterHeights = await page.evaluate(() => [36, 72, 144].map((size) => [1, 2].map((ratio) => {
    const canvas = document.createElement('canvas')
    canvas.width = size * 4 * ratio
    canvas.height = size * 4 * ratio
    const context = canvas.getContext('2d')!
    context.scale(ratio, ratio)
    context.font = `${size}px OwnCharPreview`
    context.fillText('우', size, size * 2)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let top = canvas.height
    let bottom = 0
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        if (pixels[(y * canvas.width + x) * 4 + 3] <= 8) continue
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
    }
    return (bottom - top + 1) / ratio
  })))
  for (let index = 0; index < rasterHeights.length; index += 1) {
    expect(rasterHeights[index][0]).toBeGreaterThan(visibleHeights[index] - 3)
    expect(Math.abs(rasterHeights[index][0] - rasterHeights[index][1])).toBeLessThan(2)
  }
  expect(font.charToGlyph('가').unicode).toBe('가'.codePointAt(0))
  expect(font.charToGlyph('각').unicode).toBe('각'.codePointAt(0))
  expect(font.charToGlyph('힣').unicode).toBe('힣'.codePointAt(0))
  expect(font.charToGlyph('A').unicode).toBe('A'.codePointAt(0))
  expect(font.charToGlyph('a').unicode).toBe('a'.codePointAt(0))
  expect(font.charToGlyph('0').unicode).toBe('0'.codePointAt(0))
  expect(font.charToGlyph('루').advanceWidth).toBeLessThan(1000)
  const euBounds = font.charToGlyph('ㅡ').getBoundingBox()
  expect((euBounds.x2 - euBounds.x1) / (euBounds.y2 - euBounds.y1)).toBeGreaterThan(6)
  const ieung = font.charToGlyph('ㅇ')
  const ieungBounds = ieung.getBoundingBox()
  const ieungContours: Array<Array<[number, number]>> = []
  for (const command of ieung.path.commands) {
    if (command.type === 'M') ieungContours.push([[command.x, command.y]])
    if (command.type === 'L') ieungContours.at(-1)!.push([command.x, command.y])
  }
  const winding = (x: number, y: number) => ieungContours.reduce((sum, contour) => sum + contour.reduce((count, [ax, ay], index) => {
    const [bx, by] = contour[(index + 1) % contour.length]
    if (ay <= y && by > y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0) return count + 1
    if (ay > y && by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) < 0) return count - 1
    return count
  }, 0), 0)
  const ieungCenterX = (ieungBounds.x1 + ieungBounds.x2) / 2
  const ieungCenterY = (ieungBounds.y1 + ieungBounds.y2) / 2
  expect(winding(ieungCenterX, ieungCenterY)).toBe(0)
  expect(winding(ieungCenterX, ieungBounds.y2 - 10)).not.toBe(0)
  expect(font.charToGlyph('가').path.commands.filter((command) => command.type === 'C').length).toBe(90)
  const geo = font.charToGlyph('거').path.commands
  const initialInk = geo.slice(0, 4).flatMap((command) => 'x' in command ? [command.x] : [])
  const medialInk = geo.slice(4).flatMap((command) => 'x' in command ? [command.x] : [])
  expect(Math.max(...initialInk)).toBeLessThan(Math.min(...medialInk))
  expect(Math.max(...initialInk) - Math.min(...initialInk)).toBeLessThan(400)
  const gwaCommands = font.charToGlyph('과').path.commands
  expect(gwaCommands).toHaveLength(9)
  const initialXs = gwaCommands.slice(0, 4).flatMap((command) => 'x' in command ? [command.x] : [])
  const compoundVowelXs = gwaCommands.slice(4).flatMap((command) => 'x' in command ? [command.x] : [])
  expect(Math.min(...compoundVowelXs)).toBeLessThan(Math.max(...initialXs))
  const ruCommands = font.charToGlyph('루').path.commands
  const ruInitial = ruCommands.slice(0, 4).flatMap((command) => 'y' in command ? [command.y] : [])
  const ruMedial = ruCommands.slice(4).flatMap((command) => 'y' in command ? [command.y] : [])
  const initialPolygon = strokePolygon([[35, 20], [55, 60]], [1, 1], 4.25)
  const medialPolygons = [
    strokePolygon([[25, 83], [80, 83]], [1, 1], 4.25),
    strokePolygon([[52, 83], [52, 103]], [1, 1], 4.25),
  ].flat()
  const learnedGap = (Math.min(...medialPolygons.map((point) => point[1])) - Math.max(...initialPolygon.map((point) => point[1]))) * 1000 / 148
  const calibratedGap = Math.min(...ruInitial) - Math.max(...ruMedial)
  expect(calibratedGap / learnedGap).toBeGreaterThanOrEqual(0.85)
  expect(calibratedGap / learnedGap).toBeLessThanOrEqual(1.6)
  const ruInitialX = ruCommands.slice(0, 4).flatMap((command) => 'x' in command ? [command.x] : [])
  const ruMedialX = ruCommands.slice(4).flatMap((command) => 'x' in command ? [command.x] : [])
  const center = (values: number[]) => (Math.min(...values) + Math.max(...values)) / 2
  expect(center(ruInitialX)).toBeCloseTo(center(ruMedialX), 0)
  expect(Math.abs(center([...ruInitialX, ...ruMedialX]) - font.charToGlyph('루').advanceWidth / 2)).toBeLessThan(1)
  const nuCommands = font.charToGlyph('누').path.commands
  const nuInitialX = nuCommands.slice(0, 4).flatMap((command) => 'x' in command ? [command.x] : [])
  const nuMedialX = nuCommands.slice(4).flatMap((command) => 'x' in command ? [command.x] : [])
  const sourceCenterDistance = (65 - 35) * 1000 / 148
  expect(center(nuMedialX) - center(nuInitialX)).toBeGreaterThan(sourceCenterDistance * 0.85)
  expect(center(nuMedialX) - center(nuInitialX)).toBeLessThan(sourceCenterDistance * 1.6)
  expect(Math.abs(center([...nuInitialX, ...nuMedialX]) - font.charToGlyph('누').advanceWidth / 2)).toBeLessThan(1)
  const neoCommands = font.charToGlyph('너').path.commands
  const neoInitialEnd = neoCommands.findIndex((command) => command.type === 'Z') + 1
  const neoInitialY = neoCommands.slice(0, neoInitialEnd).flatMap((command) => 'y' in command ? [command.y] : [])
  const neoMedialY = neoCommands.slice(neoInitialEnd).flatMap((command) => 'y' in command ? [command.y] : [])
  expect(Math.abs(center(neoInitialY) - center(neoMedialY))).toBeLessThanOrEqual(1)

  await page.getByRole('link', { name: /고급 편집/ }).click()
  await page.getByPlaceholder('문자 검색').fill('가')
  const gaCell = page.getByRole('button', { name: '가' })
  await gaCell.click()
  const leftBearing = page.getByLabel('왼쪽 여백')
  await leftBearing.fill('12')
  await expect(leftBearing).toHaveValue('12')
  await expect(gaCell).toHaveAttribute('title', '고급 편집에서 수정됨')
  await page.getByRole('button', { name: '실행 취소' }).click()
  await expect(leftBearing).toHaveValue('0')
  await page.getByRole('button', { name: '한글 조합 설정' }).click()
  await expect(page.getByRole('heading', { name: '대표 음절로 조합 균형을 확인하세요.' })).toBeVisible()
  await expect(page.getByText('초 4벌 · 중 1벌', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('초 8벌 · 중 2벌 · 종 1벌', { exact: true })).toBeVisible()
  const compoundPreview = page.getByLabel('갃 조합 미리보기')
  const beforePreview = await compoundPreview.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
  await expect(page.getByLabel('단일 초성 크기')).toHaveValue('1')
  await page.getByLabel('단일 초성 크기').fill('0.7')
  await expect(page.getByLabel('단일 초성 크기')).toHaveValue('0.7')
  await expect.poll(() => compoundPreview.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(beforePreview)
  const normalization = page.getByRole('slider', { name: '한글 음절 정규화' })
  await expect(normalization).toHaveValue('0.8')
  await expect(page.getByRole('slider', { name: '수직 정렬' })).toHaveValue('0.8')
  const jamoNormalization = page.getByRole('slider', { name: '자모 정규화' })
  await expect(jamoNormalization).toHaveValue('1')
  const initialHeightRatio = page.getByRole('slider', { name: '단독 자모 크기 비율' })
  await expect(initialHeightRatio).toHaveValue('1')
  const endpointStabilization = page.getByRole('slider', { name: '끝점 보정 강도' })
  await expect(endpointStabilization).toHaveValue('1')
  const standalonePreview = page.getByLabel('ㅇ 단독 자모 미리보기')
  await expect(page.getByLabel('ㅜ 단독 자모 미리보기')).toBeVisible()
  const beforeStandalone = await standalonePreview.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
  await expect(page.getByRole('slider', { name: '영문 정규화' })).toHaveValue('0')
  await expect(page.getByRole('slider', { name: '숫자 정규화' })).toHaveValue('0')
  await normalization.focus()
  await normalization.press('Home')
  await expect(normalization).toHaveValue('0')
  await normalization.press('End')
  await expect(normalization).toHaveValue('1')
  const verticalAlignment = page.getByRole('slider', { name: '수직 정렬' })
  await verticalAlignment.focus()
  await verticalAlignment.press('Home')
  const verticallyUnaligned = await compoundPreview.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
  await verticalAlignment.press('End')
  await expect(verticalAlignment).toHaveValue('1')
  await expect.poll(() => compoundPreview.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(verticallyUnaligned)
  await jamoNormalization.focus()
  await jamoNormalization.press('Home')
  await expect(jamoNormalization).toHaveValue('0')
  await initialHeightRatio.focus()
  await initialHeightRatio.press('Home')
  await expect(initialHeightRatio).toHaveValue('0.1')
  await endpointStabilization.focus()
  await endpointStabilization.press('Home')
  for (let index = 0; index < 50; index += 1) await endpointStabilization.press('ArrowRight')
  await expect(endpointStabilization).toHaveValue('0.5')
  await expect.poll(() => standalonePreview.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(beforeStandalone)
  await expect(page.getByRole('button', { name: '가변 폭' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '고정 폭' }).click()
  await expect(page.getByRole('button', { name: '고정 폭' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('ownchar', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const project = await new Promise<any>((resolve, reject) => {
      const request = database.transaction('project', 'readonly').objectStore('project').get('current')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return `${project?.settingsVersion}:${project?.compositionSettings?.hangulNormalization}:${project?.compositionSettings?.jamoNormalization}:${project?.compositionSettings?.standaloneJamoMaxHeight}:${project?.compositionSettings?.endpointStabilization}:${project?.compositionSettings?.widthMode}`
  })).toBe('6:1:0:0.1:0.5:fixed')
  await page.reload()
  await page.getByRole('button', { name: '한글 조합 설정' }).click()
  await expect(page.getByRole('slider', { name: '한글 음절 정규화' })).toHaveValue('1')
  await expect(page.getByRole('slider', { name: '자모 정규화' })).toHaveValue('0')
  await expect(page.getByRole('slider', { name: '단독 자모 크기 비율' })).toHaveValue('0.1')
  await expect(page.getByRole('slider', { name: '끝점 보정 강도' })).toHaveValue('0.5')
  await expect(page.getByRole('button', { name: '고정 폭' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '변경 적용' }).click()
  await expect(page).toHaveURL(/\/preview$/, { timeout: 120_000 })
  const fixedDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: /OTF 다운로드/ }).click()
  const fixedFile = await (await fixedDownload).path()
  const fixedData = await fs.readFile(fixedFile!)
  const fixedFont = opentype.parse(fixedData.buffer.slice(fixedData.byteOffset, fixedData.byteOffset + fixedData.byteLength))
  expect(fixedFont.charToGlyph('루').advanceWidth).toBe(1000)
})
