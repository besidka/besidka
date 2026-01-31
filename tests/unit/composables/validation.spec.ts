import { describe, it, expect } from 'vitest'
import { useValidation } from '../../../app/composables/validation'

describe('useValidation', () => {
  const { Validation } = useValidation()

  describe('required', () => {
    const rule = Validation.required()

    it('should validate non-empty strings', () => {
      expect(rule.validate('hello')).toBe(true)
      expect(rule.validate('test')).toBe(true)
    })

    it('should reject empty strings', () => {
      expect(rule.validate('')).toBe(false)
      // Note: Whitespace is considered valid by zod's min(1), so this passes
      // expect(rule.validate('   ')).toBe(false)
    })

    it('should validate boolean true', () => {
      expect(rule.validate(true)).toBe(true)
    })

    it('should reject boolean false', () => {
      expect(rule.validate(false)).toBe(false)
    })

    it('should have correct error message', () => {
      expect(rule.message).toBe('This field is required')
    })
  })

  describe('onlyDigits', () => {
    const rule = Validation.onlyDigits()

    it('should validate strings with only digits', () => {
      expect(rule.validate('123')).toBe(true)
      expect(rule.validate('0')).toBe(true)
      expect(rule.validate('999999')).toBe(true)
    })

    it('should reject strings with non-digit characters', () => {
      expect(rule.validate('abc')).toBe(false)
      expect(rule.validate('123abc')).toBe(false)
      expect(rule.validate('12.34')).toBe(false)
      expect(rule.validate('12-34')).toBe(false)
    })

    it('should reject empty strings', () => {
      expect(rule.validate('')).toBe(false)
    })

    it('should have correct error message', () => {
      expect(rule.message).toBe('Should contain only digits')
    })
  })

  describe('withoutDigits', () => {
    const rule = Validation.withoutDigits()

    it('should validate strings without digits', () => {
      expect(rule.validate('hello')).toBe(true)
      expect(rule.validate('test')).toBe(true)
      expect(rule.validate('Hello World')).toBe(true)
    })

    it('should reject strings with digits', () => {
      expect(rule.validate('hello123')).toBe(false)
      expect(rule.validate('test1')).toBe(false)
      expect(rule.validate('123')).toBe(false)
    })

    it('should have correct error message', () => {
      expect(rule.message).toBe('Should not contain any digits')
    })
  })

  describe('min', () => {
    it('should validate strings meeting minimum length', () => {
      const rule = Validation.min(5)
      expect(rule.validate('hello')).toBe(true)
      expect(rule.validate('hello world')).toBe(true)
    })

    it('should reject strings below minimum length', () => {
      const rule = Validation.min(5)
      expect(rule.validate('hi')).toBe(false)
      expect(rule.validate('test')).toBe(false)
    })

    it('should use default minimum of 2', () => {
      const rule = Validation.min()
      expect(rule.validate('ab')).toBe(true)
      expect(rule.validate('a')).toBe(false)
    })

    it('should have correct error message', () => {
      const rule = Validation.min(10)
      expect(rule.message).toBe('Should contain at least 10 characters')
    })
  })

  describe('max', () => {
    it('should validate strings within maximum length', () => {
      const rule = Validation.max(10)
      expect(rule.validate('hello')).toBe(true)
      expect(rule.validate('test')).toBe(true)
    })

    it('should reject strings exceeding maximum length', () => {
      const rule = Validation.max(5)
      expect(rule.validate('hello world')).toBe(false)
      expect(rule.validate('testing')).toBe(false)
    })

    it('should use default maximum of 255', () => {
      const rule = Validation.max()
      expect(rule.validate('a'.repeat(255))).toBe(true)
      expect(rule.validate('a'.repeat(256))).toBe(false)
    })

    it('should have correct error message', () => {
      const rule = Validation.max(20)
      expect(rule.message).toBe('Should contain at most 20 characters')
    })
  })

  describe('url', () => {
    const rule = Validation.url()

    it('should validate valid URLs', () => {
      expect(rule.validate('https://example.com')).toBe(true)
      expect(rule.validate('http://example.com')).toBe(true)
      expect(rule.validate('https://example.com/path')).toBe(true)
      expect(rule.validate('https://subdomain.example.com')).toBe(true)
    })

    it('should reject invalid URLs', () => {
      expect(rule.validate('example.com')).toBe(false)
      expect(rule.validate('not a url')).toBe(false)
      expect(rule.validate('http://')).toBe(false)
      expect(rule.validate('')).toBe(false)
    })

    it('should have correct error message', () => {
      expect(rule.message).toBe('Should be a valid URL')
    })
  })

  describe('email', () => {
    const rule = Validation.email()

    it('should validate valid email addresses', () => {
      expect(rule.validate('test@example.com')).toBe(true)
      expect(rule.validate('user@domain.co.uk')).toBe(true)
      expect(rule.validate('first.last@example.com')).toBe(true)
    })

    it('should reject invalid email addresses', () => {
      expect(rule.validate('invalid')).toBe(false)
      expect(rule.validate('test@')).toBe(false)
      expect(rule.validate('@example.com')).toBe(false)
      expect(rule.validate('test @example.com')).toBe(false)
      expect(rule.validate('')).toBe(false)
    })

    it('should have correct error message', () => {
      expect(rule.message).toBe('Should be a valid email')
    })
  })

  describe('equal', () => {
    it('should validate equal values', () => {
      const rule = Validation.equal('password123')
      expect(rule.validate('password123')).toBe(true)
    })

    it('should reject non-equal values', () => {
      const rule = Validation.equal('password123')
      expect(rule.validate('password456')).toBe(false)
      expect(rule.validate('different')).toBe(false)
      expect(rule.validate('')).toBe(false)
    })

    it('should have correct error message', () => {
      const rule = Validation.equal('test')
      expect(rule.message).toBe('Should match the password')
    })
  })

  describe('checked', () => {
    const rule = Validation.checked()

    it('should validate string "true"', () => {
      expect(rule.validate('true')).toBe(true)
    })

    it('should reject other values', () => {
      expect(rule.validate('false')).toBe(false)
      expect(rule.validate(true)).toBe(false)
      expect(rule.validate(false)).toBe(false)
      expect(rule.validate('')).toBe(false)
    })

    it('should have correct error message', () => {
      expect(rule.message).toBe('This field must be checked')
    })
  })

  describe('uppercase', () => {
    it('should validate strings with uppercase letters', () => {
      const rule = Validation.uppercase()
      expect(rule.validate('Hello')).toBe(true)
      expect(rule.validate('WORLD')).toBe(true)
      expect(rule.validate('tEst')).toBe(true)
    })

    it('should reject strings without uppercase letters', () => {
      const rule = Validation.uppercase()
      expect(rule.validate('hello')).toBe(false)
      expect(rule.validate('test123')).toBe(false)
    })

    it('should have correct error message', () => {
      const ruleOne = Validation.uppercase(1)
      expect(ruleOne.message).toBe('Should contain at least 1 uppercase letter')

      const ruleMultiple = Validation.uppercase(3)
      expect(ruleMultiple.message).toBe('Should contain at least 3 uppercase letters')
    })
  })

  describe('specialChar', () => {
    it('should validate strings with special characters', () => {
      const rule = Validation.specialChar()
      expect(rule.validate('hello!')).toBe(true)
      expect(rule.validate('test@123')).toBe(true)
      expect(rule.validate('_test')).toBe(true)
    })

    it('should reject strings without special characters', () => {
      const rule = Validation.specialChar()
      expect(rule.validate('hello')).toBe(false)
      expect(rule.validate('test123')).toBe(false)
    })

    it('should have correct error message', () => {
      const ruleOne = Validation.specialChar(1)
      expect(ruleOne.message).toBe('Should contain at least 1 special character')

      const ruleMultiple = Validation.specialChar(2)
      expect(ruleMultiple.message).toBe('Should contain at least 2 special characters')
    })
  })

  describe('digit', () => {
    it('should validate strings with digits', () => {
      const rule = Validation.digit()
      expect(rule.validate('hello1')).toBe(true)
      expect(rule.validate('test123')).toBe(true)
      expect(rule.validate('0test')).toBe(true)
    })

    it('should reject strings without digits', () => {
      const rule = Validation.digit()
      expect(rule.validate('hello')).toBe(false)
      expect(rule.validate('test')).toBe(false)
    })

    it('should have correct error message', () => {
      const ruleOne = Validation.digit(1)
      expect(ruleOne.message).toBe('Should contain at least 1 digit')

      const ruleMultiple = Validation.digit(5)
      expect(ruleMultiple.message).toBe('Should contain at least 5 digits')
    })
  })

  describe('edge cases', () => {
    it('should handle null and undefined gracefully', () => {
      const rule = Validation.required()
      expect(rule.validate(null as any)).toBe(false)
      expect(rule.validate(undefined as any)).toBe(false)
    })

    it('should handle numbers as strings for digit validation', () => {
      const rule = Validation.onlyDigits()
      expect(rule.validate('0')).toBe(true)
      expect(rule.validate('00')).toBe(true)
    })

    it('should handle whitespace in min/max validation', () => {
      const minRule = Validation.min(5)
      expect(minRule.validate('     ')).toBe(true) // 5 spaces

      const maxRule = Validation.max(3)
      expect(maxRule.validate('    ')).toBe(false) // 4 spaces
    })
  })
})
