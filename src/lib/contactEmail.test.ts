import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const MAILTO = '<a href="mailto:machinemisha@gmail.com">machinemisha@gmail.com</a>'

describe('public contact email', () => {
  it('support page leads with email, keeps the GitHub caveat', () => {
    const html = read('public/support/index.html')
    expect(html).toContain(`Email us at ${MAILTO}`)
    expect(html).toContain("issues there are public, so please don't post your location or personal details")
  })
  it('privacy page names the email and the support page as contact', () => {
    expect(read('public/privacy/index.html')).toContain(`Contact: ${MAILTO} or <a href="../support/">our support page</a>.`)
  })
  it('privacy page date reflects the changed contact line', () => {
    expect(read('public/privacy/index.html')).toContain('Last updated 13 November 2026')
  })
  it('release doc names the review and Play listing contact', () => {
    const doc = read('docs/NATIVE_RELEASE.md')
    expect(doc).toContain('App Review contact email: machinemisha@gmail.com')
    expect(doc).toContain('Store listing contact email')
  })
})
