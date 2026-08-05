export type QrErrorCorrectionLevel = 'L' | 'M'

interface QrBlockGroup {
  blockCount: number
  dataCodewordsPerBlock: number
}

interface QrVersionEccSpec {
  errorCorrectionCodewordsPerBlock: number
  blockGroups: QrBlockGroup[]
}

const minimumSupportedVersion = 1
const maximumSupportedVersion = 10

const qrVersionEccSpecs: Record<
  number,
  Record<QrErrorCorrectionLevel, QrVersionEccSpec>
> = {
  1: {
    L: {
      errorCorrectionCodewordsPerBlock: 7,
      blockGroups: [{ blockCount: 1, dataCodewordsPerBlock: 19 }],
    },
    M: {
      errorCorrectionCodewordsPerBlock: 10,
      blockGroups: [{ blockCount: 1, dataCodewordsPerBlock: 16 }],
    },
  },
  2: {
    L: {
      errorCorrectionCodewordsPerBlock: 10,
      blockGroups: [{ blockCount: 1, dataCodewordsPerBlock: 34 }],
    },
    M: {
      errorCorrectionCodewordsPerBlock: 16,
      blockGroups: [{ blockCount: 1, dataCodewordsPerBlock: 28 }],
    },
  },
  3: {
    L: {
      errorCorrectionCodewordsPerBlock: 15,
      blockGroups: [{ blockCount: 1, dataCodewordsPerBlock: 55 }],
    },
    M: {
      errorCorrectionCodewordsPerBlock: 26,
      blockGroups: [{ blockCount: 1, dataCodewordsPerBlock: 44 }],
    },
  },
  4: {
    L: {
      errorCorrectionCodewordsPerBlock: 20,
      blockGroups: [{ blockCount: 1, dataCodewordsPerBlock: 80 }],
    },
    M: {
      errorCorrectionCodewordsPerBlock: 18,
      blockGroups: [{ blockCount: 2, dataCodewordsPerBlock: 32 }],
    },
  },
  5: {
    L: {
      errorCorrectionCodewordsPerBlock: 26,
      blockGroups: [{ blockCount: 1, dataCodewordsPerBlock: 108 }],
    },
    M: {
      errorCorrectionCodewordsPerBlock: 24,
      blockGroups: [{ blockCount: 2, dataCodewordsPerBlock: 43 }],
    },
  },
  6: {
    L: {
      errorCorrectionCodewordsPerBlock: 18,
      blockGroups: [{ blockCount: 2, dataCodewordsPerBlock: 68 }],
    },
    M: {
      errorCorrectionCodewordsPerBlock: 16,
      blockGroups: [{ blockCount: 4, dataCodewordsPerBlock: 27 }],
    },
  },
  7: {
    L: {
      errorCorrectionCodewordsPerBlock: 20,
      blockGroups: [{ blockCount: 2, dataCodewordsPerBlock: 78 }],
    },
    M: {
      errorCorrectionCodewordsPerBlock: 18,
      blockGroups: [{ blockCount: 4, dataCodewordsPerBlock: 31 }],
    },
  },
  8: {
    L: {
      errorCorrectionCodewordsPerBlock: 24,
      blockGroups: [{ blockCount: 2, dataCodewordsPerBlock: 97 }],
    },
    M: {
      errorCorrectionCodewordsPerBlock: 22,
      blockGroups: [
        { blockCount: 2, dataCodewordsPerBlock: 38 },
        { blockCount: 2, dataCodewordsPerBlock: 39 },
      ],
    },
  },
  9: {
    L: {
      errorCorrectionCodewordsPerBlock: 30,
      blockGroups: [{ blockCount: 2, dataCodewordsPerBlock: 116 }],
    },
    M: {
      errorCorrectionCodewordsPerBlock: 22,
      blockGroups: [
        { blockCount: 3, dataCodewordsPerBlock: 36 },
        { blockCount: 2, dataCodewordsPerBlock: 37 },
      ],
    },
  },
  10: {
    L: {
      errorCorrectionCodewordsPerBlock: 18,
      blockGroups: [
        { blockCount: 2, dataCodewordsPerBlock: 68 },
        { blockCount: 2, dataCodewordsPerBlock: 69 },
      ],
    },
    M: {
      errorCorrectionCodewordsPerBlock: 26,
      blockGroups: [
        { blockCount: 4, dataCodewordsPerBlock: 43 },
        { blockCount: 1, dataCodewordsPerBlock: 44 },
      ],
    },
  },
}

const qrAlignmentPatternPositions: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
}

const qrVersionInformationBits: Record<number, number> = {
  7: 0x07c94,
  8: 0x085bc,
  9: 0x09a99,
  10: 0x0a4d3,
}

const errorCorrectionLevelIndicatorBits: Record<
  QrErrorCorrectionLevel,
  number
> = {
  L: 0b01,
  M: 0b00,
}

const formatInformationMask = 0b101010000010010

const galoisFieldExponentTable = new Uint8Array(256)
const galoisFieldLogarithmTable = new Uint8Array(256)

function initializeGaloisField(): void {
  let value = 1

  for (let exponent = 0; exponent < 255; exponent++) {
    galoisFieldExponentTable[exponent] = value
    galoisFieldLogarithmTable[value] = exponent
    value <<= 1

    if (value & 0x100) {
      value ^= 0x11d
    }
  }
}

initializeGaloisField()

function galoisFieldMultiply(left: number, right: number): number {
  if (left === 0 || right === 0) {
    return 0
  }

  const exponent
    = (galoisFieldLogarithmTable[left]! + galoisFieldLogarithmTable[right]!)
      % 255

  return galoisFieldExponentTable[exponent]!
}

function buildReedSolomonGeneratorPolynomial(
  errorCorrectionCodewordCount: number,
): number[] {
  let generator = [1]

  for (
    let rootIndex = 0;
    rootIndex < errorCorrectionCodewordCount;
    rootIndex++
  ) {
    const rootValue = galoisFieldExponentTable[rootIndex]!
    const nextGenerator = new Array<number>(generator.length + 1).fill(0)

    for (let index = 0; index < generator.length; index++) {
      nextGenerator[index] = nextGenerator[index]! ^ generator[index]!
      nextGenerator[index + 1] = nextGenerator[index + 1]!
        ^ galoisFieldMultiply(generator[index]!, rootValue)
    }

    generator = nextGenerator
  }

  return generator
}

function computeErrorCorrectionCodewords(
  dataCodewords: number[],
  errorCorrectionCodewordCount: number,
): number[] {
  const generator = buildReedSolomonGeneratorPolynomial(
    errorCorrectionCodewordCount,
  )
  const remainder = new Array<number>(errorCorrectionCodewordCount).fill(0)

  for (const dataCodeword of dataCodewords) {
    const factor = dataCodeword ^ remainder[0]!

    remainder.shift()
    remainder.push(0)

    for (let index = 0; index < errorCorrectionCodewordCount; index++) {
      remainder[index] = remainder[index]!
        ^ galoisFieldMultiply(generator[index + 1]!, factor)
    }
  }

  return remainder
}

class QrBitBuffer {
  private bits: number[] = []

  get length(): number {
    return this.bits.length
  }

  appendBits(value: number, bitCount: number): void {
    for (let bitIndex = bitCount - 1; bitIndex >= 0; bitIndex--) {
      this.bits.push((value >>> bitIndex) & 1)
    }
  }

  toBytes(): number[] {
    const bytes: number[] = []

    for (let index = 0; index < this.bits.length; index += 8) {
      let byte = 0

      for (let bitOffset = 0; bitOffset < 8; bitOffset++) {
        byte = (byte << 1) | (this.bits[index + bitOffset] ?? 0)
      }

      bytes.push(byte)
    }

    return bytes
  }
}

function getCharacterCountIndicatorBitLength(version: number): number {
  return version <= 9 ? 8 : 16
}

function getTotalDataCodewords(spec: QrVersionEccSpec): number {
  return spec.blockGroups.reduce((sum, group) => {
    return sum + group.blockCount * group.dataCodewordsPerBlock
  }, 0)
}

function getByteModeCapacity(
  version: number,
  errorCorrectionLevel: QrErrorCorrectionLevel,
): number {
  const spec = qrVersionEccSpecs[version]![errorCorrectionLevel]
  const totalDataBits = getTotalDataCodewords(spec) * 8
  const headerBits = 4 + getCharacterCountIndicatorBitLength(version)

  return Math.floor((totalDataBits - headerBits) / 8)
}

function selectSmallestFittingVersion(
  byteLength: number,
  errorCorrectionLevel: QrErrorCorrectionLevel,
): number {
  for (
    let version = minimumSupportedVersion;
    version <= maximumSupportedVersion;
    version++
  ) {
    if (byteLength <= getByteModeCapacity(version, errorCorrectionLevel)) {
      return version
    }
  }

  const maximumCapacity = getByteModeCapacity(
    maximumSupportedVersion,
    errorCorrectionLevel,
  )

  throw new Error(
    `Input is too long to encode as a QR code: ${byteLength} bytes `
    + `exceeds the ${maximumCapacity}-byte capacity of the largest `
    + `supported version (${maximumSupportedVersion}, level `
    + `${errorCorrectionLevel}).`,
  )
}

function buildDataCodewords(
  bytes: Uint8Array,
  version: number,
  totalDataCodewords: number,
): number[] {
  const buffer = new QrBitBuffer()
  const characterCountBits = getCharacterCountIndicatorBitLength(version)

  buffer.appendBits(0b0100, 4)
  buffer.appendBits(bytes.length, characterCountBits)

  for (const byte of bytes) {
    buffer.appendBits(byte, 8)
  }

  const totalDataBits = totalDataCodewords * 8
  const terminatorBits = Math.min(4, totalDataBits - buffer.length)

  if (terminatorBits > 0) {
    buffer.appendBits(0, terminatorBits)
  }

  while (buffer.length % 8 !== 0) {
    buffer.appendBits(0, 1)
  }

  const dataCodewords = buffer.toBytes()
  const padCodewords = [0xec, 0x11]
  let padIndex = 0

  while (dataCodewords.length < totalDataCodewords) {
    dataCodewords.push(padCodewords[padIndex % 2]!)
    padIndex++
  }

  return dataCodewords
}

function splitIntoBlocks(
  dataCodewords: number[],
  spec: QrVersionEccSpec,
): number[][] {
  const blocks: number[][] = []
  let offset = 0

  for (const group of spec.blockGroups) {
    for (let blockIndex = 0; blockIndex < group.blockCount; blockIndex++) {
      blocks.push(
        dataCodewords.slice(offset, offset + group.dataCodewordsPerBlock),
      )
      offset += group.dataCodewordsPerBlock
    }
  }

  return blocks
}

function interleaveBlocks(
  dataBlocks: number[][],
  errorCorrectionBlocks: number[][],
): number[] {
  const interleaved: number[] = []
  const longestDataBlockLength = Math.max(
    ...dataBlocks.map(block => block.length),
  )

  for (let index = 0; index < longestDataBlockLength; index++) {
    for (const block of dataBlocks) {
      if (index < block.length) {
        interleaved.push(block[index]!)
      }
    }
  }

  const errorCorrectionCodewordsPerBlock = errorCorrectionBlocks[0]!.length

  for (let index = 0; index < errorCorrectionCodewordsPerBlock; index++) {
    for (const block of errorCorrectionBlocks) {
      interleaved.push(block[index]!)
    }
  }

  return interleaved
}

interface QrMatrixBuild {
  matrix: boolean[][]
  isFunctionModule: boolean[][]
  size: number
}

function createEmptyMatrixBuild(size: number): QrMatrixBuild {
  const matrix: boolean[][] = []
  const isFunctionModule: boolean[][] = []

  for (let row = 0; row < size; row++) {
    matrix.push(new Array<boolean>(size).fill(false))
    isFunctionModule.push(new Array<boolean>(size).fill(false))
  }

  return { matrix, isFunctionModule, size }
}

function setFunctionModule(
  build: QrMatrixBuild,
  row: number,
  column: number,
  isDark: boolean,
): void {
  if (row < 0 || row >= build.size || column < 0 || column >= build.size) {
    return
  }

  build.matrix[row]![column] = isDark
  build.isFunctionModule[row]![column] = true
}

function drawFinderPattern(
  build: QrMatrixBuild,
  centerRow: number,
  centerColumn: number,
): void {
  for (let rowOffset = -4; rowOffset <= 4; rowOffset++) {
    for (let columnOffset = -4; columnOffset <= 4; columnOffset++) {
      const distance = Math.max(Math.abs(rowOffset), Math.abs(columnOffset))

      setFunctionModule(
        build,
        centerRow + rowOffset,
        centerColumn + columnOffset,
        distance !== 2 && distance !== 4,
      )
    }
  }
}

function drawAlignmentPattern(
  build: QrMatrixBuild,
  centerRow: number,
  centerColumn: number,
): void {
  for (let rowOffset = -2; rowOffset <= 2; rowOffset++) {
    for (let columnOffset = -2; columnOffset <= 2; columnOffset++) {
      const distance = Math.max(Math.abs(rowOffset), Math.abs(columnOffset))

      setFunctionModule(
        build,
        centerRow + rowOffset,
        centerColumn + columnOffset,
        distance !== 1,
      )
    }
  }
}

function drawTimingPatterns(build: QrMatrixBuild): void {
  for (let index = 0; index < build.size; index++) {
    setFunctionModule(build, 6, index, index % 2 === 0)
    setFunctionModule(build, index, 6, index % 2 === 0)
  }
}

function drawAlignmentPatterns(build: QrMatrixBuild, version: number): void {
  const positions = qrAlignmentPatternPositions[version]!
  const lastIndex = positions.length - 1

  for (let rowIndex = 0; rowIndex <= lastIndex; rowIndex++) {
    for (let columnIndex = 0; columnIndex <= lastIndex; columnIndex++) {
      const isTopLeftCorner = rowIndex === 0 && columnIndex === 0
      const isTopRightCorner = rowIndex === 0 && columnIndex === lastIndex
      const isBottomLeftCorner = rowIndex === lastIndex && columnIndex === 0

      if (isTopLeftCorner || isTopRightCorner || isBottomLeftCorner) {
        continue
      }

      drawAlignmentPattern(
        build,
        positions[rowIndex]!,
        positions[columnIndex]!,
      )
    }
  }
}

function reserveFormatInformationAreas(build: QrMatrixBuild): void {
  const size = build.size

  for (let index = 0; index <= 5; index++) {
    setFunctionModule(build, 8, index, false)
  }

  setFunctionModule(build, 8, 7, false)
  setFunctionModule(build, 8, 8, false)
  setFunctionModule(build, 7, 8, false)

  for (let index = 0; index <= 5; index++) {
    setFunctionModule(build, index, 8, false)
  }

  for (let index = 0; index < 7; index++) {
    setFunctionModule(build, size - 1 - index, 8, false)
  }

  for (let index = 0; index < 8; index++) {
    setFunctionModule(build, 8, size - 8 + index, false)
  }

  setFunctionModule(build, size - 8, 8, true)
}

function drawVersionInformation(build: QrMatrixBuild, version: number): void {
  if (version < 7) {
    return
  }

  const bits = qrVersionInformationBits[version]!

  for (let bitIndex = 0; bitIndex < 18; bitIndex++) {
    const isDark = ((bits >>> bitIndex) & 1) === 1
    const rowOffset = build.size - 11 + (bitIndex % 3)
    const columnOffset = Math.floor(bitIndex / 3)

    setFunctionModule(build, rowOffset, columnOffset, isDark)
    setFunctionModule(build, columnOffset, rowOffset, isDark)
  }
}

function drawFunctionPatterns(
  build: QrMatrixBuild,
  version: number,
): void {
  drawTimingPatterns(build)
  drawFinderPattern(build, 3, 3)
  drawFinderPattern(build, build.size - 4, 3)
  drawFinderPattern(build, 3, build.size - 4)
  drawAlignmentPatterns(build, version)
  reserveFormatInformationAreas(build)
  drawVersionInformation(build, version)
}

function placeDataBits(
  build: QrMatrixBuild,
  codewords: number[],
): void {
  let bitIndex = 0
  const totalBits = codewords.length * 8

  const getNextBit = (): boolean => {
    if (bitIndex >= totalBits) {
      return false
    }

    const codeword = codewords[bitIndex >>> 3]!
    const bit = (codeword >>> (7 - (bitIndex & 7))) & 1

    bitIndex++

    return bit === 1
  }

  for (let right = build.size - 1; right >= 1; right -= 2) {
    if (right === 6) {
      right = 5
    }

    const isUpward = ((right + 1) & 2) === 0

    for (let vertical = 0; vertical < build.size; vertical++) {
      const row = isUpward ? build.size - 1 - vertical : vertical

      for (let columnOffset = 0; columnOffset < 2; columnOffset++) {
        const column = right - columnOffset

        if (build.isFunctionModule[row]![column]) {
          continue
        }

        if (bitIndex < totalBits) {
          build.matrix[row]![column] = getNextBit()
        } else {
          build.matrix[row]![column] = false
        }
      }
    }
  }
}

type QrMaskPatternFunction = (row: number, column: number) => boolean

const qrMaskPatternFunctions: QrMaskPatternFunction[] = [
  (row, column) => (row + column) % 2 === 0,
  row => row % 2 === 0,
  (_row, column) => column % 3 === 0,
  (row, column) => (row + column) % 3 === 0,
  (row, column) => {
    return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0
  },
  (row, column) => ((row * column) % 2) + ((row * column) % 3) === 0,
  (row, column) => {
    return (((row * column) % 2) + ((row * column) % 3)) % 2 === 0
  },
  (row, column) => {
    return (((row + column) % 2) + ((row * column) % 3)) % 2 === 0
  },
]

function cloneMatrix(matrix: boolean[][]): boolean[][] {
  return matrix.map(row => [...row])
}

function applyMask(
  build: QrMatrixBuild,
  matrix: boolean[][],
  maskPattern: number,
): void {
  const maskFunction = qrMaskPatternFunctions[maskPattern]!

  for (let row = 0; row < build.size; row++) {
    for (let column = 0; column < build.size; column++) {
      if (build.isFunctionModule[row]![column]) {
        continue
      }

      if (maskFunction(row, column)) {
        matrix[row]![column] = !matrix[row]![column]
      }
    }
  }
}

function computeFormatInformationBits(
  errorCorrectionLevel: QrErrorCorrectionLevel,
  maskPattern: number,
): number {
  const data
    = (errorCorrectionLevelIndicatorBits[errorCorrectionLevel] << 3)
      | maskPattern
  let remainder = data

  for (let step = 0; step < 10; step++) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537)
  }

  return ((data << 10) | remainder) ^ formatInformationMask
}

function drawFormatInformation(
  matrix: boolean[][],
  size: number,
  errorCorrectionLevel: QrErrorCorrectionLevel,
  maskPattern: number,
): void {
  const bits = computeFormatInformationBits(errorCorrectionLevel, maskPattern)
  const getBit = (placementIndex: number): boolean => {
    return ((bits >>> (14 - placementIndex)) & 1) === 1
  }

  for (let index = 0; index <= 5; index++) {
    matrix[8]![index] = getBit(index)
  }

  matrix[8]![7] = getBit(6)
  matrix[8]![8] = getBit(7)
  matrix[7]![8] = getBit(8)

  for (let index = 9; index <= 14; index++) {
    matrix[14 - index]![8] = getBit(index)
  }

  for (let index = 0; index < 7; index++) {
    matrix[size - 1 - index]![8] = getBit(index)
  }

  for (let index = 0; index < 8; index++) {
    matrix[8]![size - 8 + index] = getBit(index + 7)
  }

  matrix[size - 8]![8] = true
}

function computeRunPenalty(modules: boolean[]): number {
  let penalty = 0
  let runLength = 1

  for (let index = 1; index < modules.length; index++) {
    if (modules[index] === modules[index - 1]) {
      runLength++
      continue
    }

    if (runLength >= 5) {
      penalty += runLength - 5 + 3
    }

    runLength = 1
  }

  if (runLength >= 5) {
    penalty += runLength - 5 + 3
  }

  return penalty
}

function computeAdjacentModulesPenalty(matrix: boolean[][]): number {
  let penalty = 0

  for (const row of matrix) {
    penalty += computeRunPenalty(row)
  }

  for (let column = 0; column < matrix.length; column++) {
    const columnModules = matrix.map(row => row[column]!)

    penalty += computeRunPenalty(columnModules)
  }

  return penalty
}

function computeBlockPenalty(matrix: boolean[][]): number {
  let penalty = 0
  const size = matrix.length

  for (let row = 0; row < size - 1; row++) {
    for (let column = 0; column < size - 1; column++) {
      const topLeft = matrix[row]![column]

      if (
        topLeft === matrix[row]![column + 1]
        && topLeft === matrix[row + 1]![column]
        && topLeft === matrix[row + 1]![column + 1]
      ) {
        penalty += 3
      }
    }
  }

  return penalty
}

const finderLikePattern = '10111010000'
const finderLikePatternReversed = '00001011101'

function countFinderLikePatternOccurrences(bits: string): number {
  let count = 0

  for (let index = 0; index + 11 <= bits.length; index++) {
    const window = bits.slice(index, index + 11)

    if (window === finderLikePattern || window === finderLikePatternReversed) {
      count++
    }
  }

  return count
}

function computeFinderLikePatternPenalty(matrix: boolean[][]): number {
  let occurrences = 0
  const size = matrix.length

  for (const row of matrix) {
    const bits = row.map(module => module ? '1' : '0').join('')

    occurrences += countFinderLikePatternOccurrences(bits)
  }

  for (let column = 0; column < size; column++) {
    const bits = matrix
      .map(row => row[column] ? '1' : '0')
      .join('')

    occurrences += countFinderLikePatternOccurrences(bits)
  }

  return occurrences * 40
}

function computeDarkModuleRatioPenalty(matrix: boolean[][]): number {
  const size = matrix.length
  const totalModules = size * size
  let darkModuleCount = 0

  for (const row of matrix) {
    for (const module of row) {
      if (module) {
        darkModuleCount++
      }
    }
  }

  const darkPercentage = (darkModuleCount * 100) / totalModules
  const lowerMultipleOfFive = Math.floor(darkPercentage / 5) * 5
  const upperMultipleOfFive = lowerMultipleOfFive + 5
  const lowerDeviation = Math.abs(lowerMultipleOfFive - 50) / 5
  const upperDeviation = Math.abs(upperMultipleOfFive - 50) / 5

  return Math.min(lowerDeviation, upperDeviation) * 10
}

function computeMaskPenalty(matrix: boolean[][]): number {
  return (
    computeAdjacentModulesPenalty(matrix)
    + computeBlockPenalty(matrix)
    + computeFinderLikePatternPenalty(matrix)
    + computeDarkModuleRatioPenalty(matrix)
  )
}

function selectBestMaskedMatrix(
  build: QrMatrixBuild,
  errorCorrectionLevel: QrErrorCorrectionLevel,
): boolean[][] {
  let bestMatrix: boolean[][] | null = null
  let bestPenalty = Number.POSITIVE_INFINITY

  for (let maskPattern = 0; maskPattern < 8; maskPattern++) {
    const candidateMatrix = cloneMatrix(build.matrix)

    applyMask(build, candidateMatrix, maskPattern)
    drawFormatInformation(
      candidateMatrix,
      build.size,
      errorCorrectionLevel,
      maskPattern,
    )

    const penalty = computeMaskPenalty(candidateMatrix)

    if (penalty < bestPenalty) {
      bestPenalty = penalty
      bestMatrix = candidateMatrix
    }
  }

  if (!bestMatrix) {
    throw new Error('Failed to select a QR code mask pattern.')
  }

  return bestMatrix
}

/**
 * Encodes `text` into a QR code module matrix, entirely client-side.
 *
 * Scope is deliberately narrow: byte mode only (the input is always UTF-8
 * encoded, so alphanumeric/numeric/kanji mode selection is unnecessary),
 * error correction levels L and M only, and versions 1-10 only. The
 * smallest fitting version is auto-selected; an input too long for
 * version 10 throws instead of truncating.
 */
export function encodeQrCode(
  text: string,
  errorCorrectionLevel: QrErrorCorrectionLevel = 'M',
): boolean[][] {
  const bytes = new TextEncoder().encode(text)
  const version = selectSmallestFittingVersion(
    bytes.length,
    errorCorrectionLevel,
  )
  const spec = qrVersionEccSpecs[version]![errorCorrectionLevel]
  const totalDataCodewords = getTotalDataCodewords(spec)
  const dataCodewords = buildDataCodewords(bytes, version, totalDataCodewords)
  const dataBlocks = splitIntoBlocks(dataCodewords, spec)
  const errorCorrectionBlocks = dataBlocks.map((block) => {
    return computeErrorCorrectionCodewords(
      block,
      spec.errorCorrectionCodewordsPerBlock,
    )
  })
  const codewordSequence = interleaveBlocks(dataBlocks, errorCorrectionBlocks)
  const size = version * 4 + 17
  const build = createEmptyMatrixBuild(size)

  drawFunctionPatterns(build, version)
  placeDataBits(build, codewordSequence)

  return selectBestMaskedMatrix(build, errorCorrectionLevel)
}

export function qrMatrixToSvg(
  matrix: boolean[][],
  options?: { margin?: number },
): string {
  const size = matrix.length
  const margin = options?.margin ?? 4
  const dimension = size + margin * 2
  const rects: string[] = []

  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      if (!matrix[row]![column]) {
        continue
      }

      rects.push(
        `<rect x="${column + margin}" y="${row + margin}" `
        + 'width="1" height="1"/>',
      )
    }
  }

  return '<svg xmlns="http://www.w3.org/2000/svg" '
    + `viewBox="0 0 ${dimension} ${dimension}" shape-rendering="crispEdges">`
    + `<rect x="0" y="0" width="${dimension}" height="${dimension}" `
    + 'fill="#fff"/>'
    + `<g fill="#000">${rects.join('')}</g>`
    + '</svg>'
}
