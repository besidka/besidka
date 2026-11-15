import { describe, expect, it } from 'vitest'
import {
  XLSX_FORMULA_FUNCTION_ALLOWLIST,
  checkFormula,
} from '@besidka/doc-renderer/validate'

function codeOf(formula: string): string | null {
  const result = checkFormula(formula)

  return result.ok ? null : result.code
}

describe('checkFormula', () => {
  it('allows every function on the allowlist', () => {
    for (const name of XLSX_FORMULA_FUNCTION_ALLOWLIST) {
      expect(codeOf(`${name}(A1)`), name).toBeNull()
    }

    expect(XLSX_FORMULA_FUNCTION_ALLOWLIST.size).toBe(52)
  })

  it('returns the functions used, uppercased', () => {
    const result = checkFormula('=sum(A1:A3)+Round(B1,2)')

    expect(result).toEqual({ ok: true, functions: ['SUM', 'ROUND'] })
  })

  it('handles nesting and operators', () => {
    expect(codeOf('IF(AND(A1>0,OR(B1<=2,NOT(C1<>3))),SUM(A1:A3)*2^2%,0)'))
      .toBeNull()
    expect(codeOf('IFERROR(VLOOKUP(A2,Data!$A$1:$C$10,3,FALSE),"n/a")'))
      .toBeNull()
    expect(codeOf('{1,2;3,4}')).toBeNull()
    expect(codeOf('1.5E+3+.5')).toBeNull()
  })

  it('does not look inside quoted strings', () => {
    expect(codeOf('IF(A1="WEBSERVICE(x)","HYPERLINK(""y"")","[1]a|b")'))
      .toBeNull()
    expect(codeOf('"unterminated')).toBe('formula_syntax')
    expect(codeOf('"a""b"&A1')).toBeNull()
  })

  it('allows sheet references, quoted and unquoted, including Unicode', () => {
    expect(codeOf('Sheet1!A1+Data!B2')).toBeNull()
    expect(codeOf('\'My Sheet\'!A1:B2')).toBeNull()
    expect(codeOf('\'It\'\'s\'!A1')).toBeNull()
    expect(codeOf('SUM(\'Продажі\'!F2:F501)')).toBeNull()
    expect(codeOf('Продажі!A1')).toBeNull()
  })

  it('allows whole column and row ranges', () => {
    expect(codeOf('SUM(A:A)')).toBeNull()
    expect(codeOf('SUM($A:$C)')).toBeNull()
    expect(codeOf('SUM(1:1)')).toBeNull()
  })

  it('accepts the _xlfn. prefix for allowlisted future functions only', () => {
    expect(codeOf('_xlfn.XLOOKUP(A1,A:A,B:B)')).toBeNull()
    expect(codeOf('_xlfn.IFS(A1>1,1,TRUE,0)')).toBeNull()
    expect(codeOf('_xlfn.WEBSERVICE("x")')).toBe('formula_not_allowed')
  })

  describe('denials', () => {
    it.each([
      'HYPERLINK("https://x","y")',
      'WEBSERVICE("https://x")',
      'FILTERXML(A1,"//a")',
      'IMPORTXML("https://x","//a")',
      'IMPORTDATA("https://x")',
      'IMPORTRANGE("id","A1")',
      'IMAGE("https://x")',
      'CALL("a","b")',
      'REGISTER.ID("a","b")',
      'EXEC("calc")',
      'INDIRECT("A1")',
      'SUM(A1)+HYPERLINK("x")',
      'IF(1,WEBSERVICE("x"),0)',
      'Sum.Ifs(A1)',
    ])('denies the function in %s', (formula) => {
      expect(codeOf(formula)).toBe('formula_not_allowed')
    })

    it('denies DDE syntax', () => {
      expect(codeOf('cmd|\'/c calc\'!A1')).toBe('formula_not_allowed')
      expect(codeOf('1+cmd|calc')).toBe('formula_not_allowed')
    })

    it('denies external workbook references', () => {
      expect(codeOf('[1]Sheet1!A1')).toBe('formula_not_allowed')
      expect(codeOf('\'[book.xlsx]Sheet1\'!A1')).toBe('formula_not_allowed')
      expect(codeOf('\'C:\\Users\\x\\[book.xlsx]Sheet1\'!A1'))
        .toBe('formula_not_allowed')
      expect(codeOf('\'file:///x/y\'!A1')).toBe('formula_not_allowed')
      expect(codeOf('\'a:b\'!A1')).toBe('formula_not_allowed')
    })

    it('denies R1C1 strings and unknown names', () => {
      expect(codeOf('R1C1')).toBe('formula_not_allowed')
      expect(codeOf('SUM(R[1]C[1])')).toBe('formula_not_allowed')
      expect(codeOf('R2C3+1')).toBe('formula_not_allowed')
      expect(codeOf('DefinedName+1')).toBe('formula_not_allowed')
      expect(codeOf('C+1')).toBe('formula_not_allowed')
    })

    it('denies implicit intersection and stray characters', () => {
      expect(codeOf('@A1:A3')).toBe('formula_not_allowed')
      expect(codeOf('A1\\B1')).toBe('formula_not_allowed')
      expect(codeOf('A1`B1')).toBe('formula_syntax')
    })

    it('denies unbalanced parentheses', () => {
      expect(codeOf('SUM(A1')).toBe('formula_syntax')
      expect(codeOf('SUM(A1))')).toBe('formula_syntax')
    })

    it('denies malformed sheet qualifiers and oversize formulas', () => {
      expect(codeOf('\'unterminated!A1')).toBe('formula_syntax')
      expect(codeOf('\'Sheet\'A1')).toBe('formula_syntax')
      expect(codeOf(`SUM(${'A1,'.repeat(4000)}A1)`)).toBe('formula_syntax')
    })
  })
})
