# 성능

쓰기 페이지의 문장 전환과 획 입력을 빠르게 만든 작업에서 얻은 지식이다. 코드를 바꾸거나 기능을 추가하기 전에 읽는다. 바꾼 뒤에는 이 문서의 해당 항목을 갱신한다.

## 목표

| 동작 | 목표 | 2026-10-09 측정값 (dev 모드) |
|---|---|---|
| 문장 전환 | 프레임 하나(16 ms) 안 | 이전 427에서 511 ms, 이후 15에서 23 ms |
| 획을 그리는 중 포인터 이동 1회 | 5 ms 이하 | 이전 7 ms, 이후 3에서 4 ms |
| 획을 저장한 직후 | 20 ms를 넘는 멈춤이 없다 | 이전 22에서 75 ms, 이후 없음 |
| 자동 저장 | 20 ms를 넘는 멈춤이 없다 | 이전 약 300 ms, 이후 없음 |

측정 조건: 샘플 프로젝트(문장 9개, 그림 192개, 약 6 MB)를 사용했다. 목표는 dev 모드 수치로 잰다. 프로덕션은 React 개발 모드의 부담이 없어서 더 빠르다.

## 느렸던 원인

원인은 하나가 아니었다. 아래 여섯 가지가 겹쳐 있었다.

| # | 원인 | 해법 | 코드 위치 |
|---|---|---|---|
| 1 | 문장을 바꾸면 `WriteSentence`가 key로 다시 마운트된다. 마운트마다 같은 입력으로 글자 모양, 학습 프로필, 보정 배율, 칸별 가이드, 획 윤곽을 처음부터 다시 계산했다. | 입력 객체의 정체성(identity)이 같으면 이전 결과를 쓴다. 쓰기 페이지가 쓰지 않는 보정 배율 계산은 뺐다. | `src/lib/latest-only.ts`, `src/generation/use-composition-context.ts`, `src/generation/inputs.ts`, `src/font/stroke/outline.ts` |
| 2 | 저장할 때마다 문장의 모든 `DrawingRecord`를 새 객체로 바꿨다. 정체성으로 키를 만든 캐시가 전부 무효가 되었다. | 저장하는 값이 이미 저장된 값과 같으면 이전 객체를 유지한다. | `keepIfSame`, `src/collection/drawing-selection.ts` |
| 3 | 저장할 때마다 학습이 완성된 모든 칸을 다시 측정했다. | 칸의 획, 격자, 획 보정 설정이 같으면 이전 측정값을 쓴다. | `cellMemo`, `src/generation/learning/samples.ts` |
| 4 | 포인터가 움직일 때마다 쓰기 페이지 전체를 렌더했다. 이동 1회에 렌더가 약 8 ms였다. | 레일, 칸 그리드, 고정 레이어, 도구 레일을 `memo` 컴포넌트로 나눴다. | `write-rail.tsx`, `writing-grid.tsx`, `fixed-capture-layer.tsx`, `tool-rail.tsx` |
| 5 | 저장 직후 렌더에서 칸 31개의 가이드를 모두 동기로 다시 계산했다. 한가한 시간의 미리 계산은 문장 하나에 75에서 99 ms를 한 번에 썼다. | 화면의 가이드를 유지하고 새 가이드를 한가한 시간에 칸 단위로 만든다. | `src/lib/idle.ts`, `src/features/writing/use-writing-session.ts` |
| 6 | 프로젝트 전체를 IndexedDB 값 하나로 저장했다. 상태가 바뀔 때마다 약 6 MB를 메인 스레드에서 복제했다. | 프로젝트를 기록 단위로 저장하고 바뀐 기록만 쓴다. | `src/project/persistence.ts`, `src/project/saved-format.ts` |

## 규칙

### 캐시와 정체성

- 캐시 키는 입력 객체의 정체성이다. 상태 객체를 제자리에서 바꾸지 않는다. 바꿀 때는 새 객체를 만든다.
- 저장할 때 내용이 같은 레코드는 같은 객체로 둔다. 새 레코드 필드를 추가하면 `keepIfSame`의 비교 항목에도 추가한다.
- `latestOnly`는 마지막 입력 하나만 기억한다. 서로 다른 입력을 번갈아 쓰는 호출에는 쓰지 않는다. 그런 경우에는 입력마다 보관하는 `WeakMap`을 쓴다.
- 캐시한 글자 모양을 여러 곳에 그대로 나눠 주지 않는다. 펜 윤곽 캐시가 중심선(`centerline`) 객체별로 쌓이기 때문이다. `normalizedSource`는 모양마다 중심선을 새 객체로 복사한다.

WARNING: 모양을 공유하는 변경을 하기 전에 폰트 골든 해시를 비교한다. 얕은 복사로 모양을 공유했을 때 단독 자모 5개의 윤곽이 달라졌다. 눈으로는 알기 어렵다.

### 렌더

- 포인터 이동마다 바뀌는 값을 `memo` 컴포넌트의 prop으로 직접 넘기지 않는다. 문자열이나 플래그로 바꿔서 넘긴다. 예: `finishedKey`, `writtenRoles`.
- `memo` 컴포넌트에 넘기는 콜백은 `useStableCallback`으로 감싼다. 인라인 함수는 매 렌더에 새 객체가 된다.
- 측정 없이 `memo`나 `useMemo`를 넣지 않는다. 이 작업에서는 렌더 시간이 이동당 8 ms였을 때만 효과가 있었다.

### 한가한 시간의 작업

- 한가한 시간의 작업은 `whenIdle`, `cancelIdle`, `stopWhenBusy`(`src/lib/idle.ts`)로 쓴다. `requestIdleCallback`이 없는 브라우저에서는 `setTimeout`으로 대신한다.
- 단계로 나눌 수 있는 작업은 한 호출에 한 단계 이상 하고 한가한 시간이 4 ms 아래로 내려가면 멈춘다.
- 멈춘 작업은 진행 위치를 기억해야 한다. 기억하지 않으면 매번 0번부터 다시 시작하고 진행하지 못한다. 예: `outlineProgress`, `GuideJob.next`.
- 저장 직후 가이드는 지연해서 갱신한다. 단, 고정 자모 구성이 바뀐 칸과 저장된 가이드가 생기거나 사라진 칸은 즉시 새로 만든다. 옛 가이드는 쓸 자모를 잘못 보여 준다.
- 가이드가 쓰는 학습 프로필은 문장을 열 때 고정한다. 완성 음절이 3개가 되면 한 번 다시 학습한다(`sizeKnown`). 그 전에는 글씨 높이의 기본값 760을 쓰므로 가이드가 실제 글씨보다 약 1.4배 크다. 다시 학습하면 안 쓴 칸의 가이드가 한가한 시간에 새 크기로 바뀐다. 쓰기 시작한 칸은 저장된 가이드를 유지한다. `sizeKnown`은 한 번 참이 되면 문장을 닫을 때까지 유지한다. 획을 지워 개수가 줄어도 가이드가 다시 바뀌지 않는다.

### 저장

- 프로젝트는 기록 단위로 저장한다. 키는 `meta`, `font`, `session:<id>`, `drawing:<promptId>`이다.
- 쓰기는 저장된 객체와 정체성이 다른 기록만 한다. 사라진 기록은 지운다. 저장 구조를 바꾸면 이 비교 방식도 맞춘다.
- 한 문장의 `session` 기록은 `captures`(그 문장에서 쓴 모든 그림)를 가진다. 프로젝트의 `drawings`는 모든 문장의 `captures` 중 자모마다 점수가 가장 좋은 것이다(`selectDrawings`). 저장 직후 `selectDrawings`는 모든 자모를 다시 고르지만 안 바뀐 그림은 `keepIfSame`으로 같은 객체로 둔다. 중앙값 0.2 ms, 최대 0.8 ms(문장 43칸, 그림 70개, dev 모드)였다.
- 쓴 칸의 `guides`는 고정 자모가 없어도 빈 가이드 항목을 가진다. 그 칸은 쓸 때의 고정 구성으로 읽는다. 모드(`guideMode`)를 바꿔도 이미 쓴 획의 해석이 바뀌지 않는다.
- 새 상태 필드는 `meta`에 들어간다. `meta`는 얕은 비교를 한다. 필드를 제자리에서 바꾸면 저장되지 않는다.
- 저장 형식(`.ownchar`, 샘플 프로젝트)은 `{ meta, sessions, drawings }`이다. 형식을 바꾸면 `tools/lib/project.mjs`, `tools/project/export-project.js`, `tests/e2e/helpers.ts`를 같이 바꾼다.

## 변경할 때 확인할 것

1. 입력으로 쓰는 객체를 새로 만드는 코드를 추가했는가? 그렇다면 캐시가 무효가 되는지 확인한다.
2. 포인터 이동마다 실행되는 경로(`WritingSurface`의 `onChange`, `useWritingSession`의 `save`)에 계산을 넣었는가? 그렇다면 5 ms 아래인지 측정한다.
3. 저장 경로(`saveSentenceCapture`)에 계산을 넣었는가? 그렇다면 저장 직후 멈춤을 측정한다.
4. 글리프에 영향이 있는가? 그렇다면 `node tools/verify/golden.mjs`의 해시를 변경 전후로 비교한다.
5. 저장하는 데이터를 바꿨는가? 그렇다면 `pnpm test:e2e`를 실행한다.

## 측정 방법

브라우저 측정은 개발 서버가 열린 탭에서 `javascript_tool`이나 DevTools 콘솔로 실행한다. 샘플 프로젝트는 개발용 샘플 버튼으로 채운다.

문장 전환 시간: 칩을 누른 뒤 다음 매크로태스크까지 시간을 잰다.

```js
const macro = () => new Promise((resolve) => { const c = new MessageChannel(); c.port1.onmessage = () => resolve(); c.port2.postMessage(0) })
const switchTo = async (index) => {
  const start = performance.now()
  document.querySelectorAll('.exercise-chip')[index].click()
  await macro()
  return performance.now() - start
}
```

멈춤 탐침: 10 ms 타이머가 늦게 도는 정도로 메인 스레드 멈춤을 잰다.

```js
let last = performance.now()
const stalls = []
setInterval(() => { const now = performance.now(); const gap = now - last - 10; if (gap > 20) stalls.push(Math.round(gap)); last = now }, 10)
```

획 입력: 합성 포인터 이벤트를 `svg.writing-surface`에 보낸다. 합성 이벤트에서는 `Element.prototype.setPointerCapture = () => {}`로 포인터 캡처를 끈다. 이동마다 `await macro()`를 하고 시간을 잰다.

Node 측정: `tools/lib/vite.mjs`의 `startVite()`로 모듈을 읽고 순수 함수의 시간을 잰다. 예: `shapesFromRequestDrawings`, `captureRecords`, `learnCompositionProfile`.

### 측정의 함정

- 브라우저 창이 가려져 있으면 `requestAnimationFrame`과 `requestIdleCallback`이 실행되지 않는다. 그래서 전환 시간은 `MessageChannel`로 잰다. 한가한 시간의 작업은 `timeout: 1000`으로 늦어도 1초 안에 실행되게 한다.
- `Profiler` API(JS Self-Profiling)는 Document Policy 때문에 쓸 수 없다. 렌더 시간은 React의 `Profiler` 컴포넌트(`onRender`의 `actualDuration`)로 잰다. 계측 코드는 측정 뒤에 지운다.
- 같은 방법으로 전후를 잰다. 방법이 다르면 숫자를 비교할 수 없다. 이 작업에서 `requestAnimationFrame` 기준 전환 시간(630 ms)은 매크로태스크 기준(430에서 510 ms)보다 컸다.
- Node 측정 중에 Vite 의존성 캐시의 `EBUSY` 오류가 나면 잠시 기다린 뒤 다시 실행한다.

## 시도했고 채택하지 않은 것

| 시도 | 결과 | 이유 |
|---|---|---|
| 캐시한 글자 모양을 얕은 복사로 나눠 줌 | 되돌림 | 단독 자모 5개의 윤곽이 달라졌다. 중심선 객체별 윤곽 캐시가 공유되었다. |
| 캐시한 글자 모양을 `structuredClone`으로 복사 | 되돌림 | 출력은 같았지만 안 바뀐 모양 205개를 매번 복사해서 약 28 ms가 들었다. |
| 미리 계산 범위를 앞뒤 문장으로 제한 | 확장 | 저장 직후 먼 문장으로 가면 58에서 132 ms가 걸렸다. 모든 문장을 가까운 순서로 미리 계산한다. |

## 남은 한계

- 완성 음절이 3개여도 잉크 높이가 200 이하이거나 1000 이상이면 측정에서 빠진다. 유효한 측정이 없으면 기본값 760을 쓴다.
- 완성 음절이 3개가 되는 저장 직후 렌더에서 학습 프로필을 한 번 다시 계산한다. Node에서 처음 실행한 `learnCompositionProfile`은 샘플 1개 문장에서 64 ms였다. 브라우저의 멈춤은 측정하지 못했다. 문장마다 한 번만 일어난다.
- `sizeKnown` 계산(`completedHangulCells`)은 저장 직후 렌더마다 한 번 실행한다. 샘플 1개 문장, 완성 칸 10개에서 중앙값 0.1 ms다.
- 처음 가는 먼 문장은 캐시가 비어 있으면 50에서 100 ms가 걸린다. 한가한 시간에 미리 계산하기 전에 가면 그렇다.
- 저장 직후 다른 칸의 가이드는 한가한 시간에 갱신된다. 화면에 반영되는 시점이 늦어질 수 있다.
- 한 문장에만 있는 자모를 쓴 뒤 같은 자모가 있는 칸에 고정 가이드가 바로 뜨는지는 브라우저에서 확인하지 못했다. 코드 검토와 e2e로만 확인했다.
- 옛 빌드를 연 탭이 열려 있으면 IndexedDB 버전 업그레이드가 막힌다. 배포 뒤에 저장 구조를 바꿀 때는 `onblocked`와 `onversionchange`를 처리한다.
