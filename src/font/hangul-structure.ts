import type { GapKind } from './gap-profile'
export const INITIALS = [...'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ']
export const MEDIALS = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ']
export const FINALS = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ']
export function vowelKind(index: number): GapKind {
  return index <= 7 || index === 20 ? 'vertical' : [8, 12].includes(index) ? 'horizontalUp' : [13, 17, 18].includes(index) ? 'horizontalDown' : 'mixed'
}
const openVariants = [0, 0, 0, 0, 0, 0, 0, 0, 1, 3, 3, 3, 1, 2, 4, 4, 4, 2, 1, 3, 0]
export function decomposeHangul(codePoint: number) {
  const offset = codePoint - 0xac00
  const initialIndex = Math.floor(offset / 588)
  const vowelIndex = Math.floor(offset % 588 / 28)
  const finalIndex = offset % 28
  const kind = vowelKind(vowelIndex)
  return { initialIndex, vowelIndex, finalIndex, kind,
    chars: { initial: INITIALS[initialIndex], medial: MEDIALS[vowelIndex], final: FINALS[finalIndex] },
    variants: { initial: finalIndex ? kind === 'vertical' ? 5 : kind === 'mixed' ? 7 : 6 : openVariants[vowelIndex], medial: finalIndex ? 1 : 0, final: 0 },
  }
}
