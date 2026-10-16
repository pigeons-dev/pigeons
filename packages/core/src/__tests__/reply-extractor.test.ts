import { describe, it, expect } from 'vitest'
import { extractTextReply, extractHtmlReply } from '../services/reply-extractor.js'

describe('extractTextReply', () => {
  it('strips quoted text with > prefix', () => {
    const text = 'Thanks for the update.\n\nOn Thu, Oct 12 wrote:\n> Original message here'
    const result = extractTextReply(text)
    expect(result).toContain('Thanks for the update')
    expect(result).not.toContain('Original message here')
  })

  it('strips "Sent from my iPhone" signatures', () => {
    const text = 'Got it, thanks!\n\nSent from my iPhone'
    const result = extractTextReply(text)
    expect(result).toContain('Got it')
    expect(result).not.toContain('Sent from my iPhone')
  })

  it('returns full text when no quotes found', () => {
    const text = 'Just a simple message with no quotes.'
    expect(extractTextReply(text)).toBe(text)
  })
})

describe('extractHtmlReply', () => {
  it('strips Gmail quoted content', () => {
    const html = '<div>New reply</div><div class="gmail_quote">On Oct 12 wrote:<blockquote>old stuff</blockquote></div>'
    const result = extractHtmlReply(html)
    expect(result).toContain('New reply')
    expect(result).not.toContain('old stuff')
  })

  it('strips Gmail container class', () => {
    const html = '<div>Reply here</div><div class="gmail_quote gmail_quote_container"><div class="gmail_attr">On Oct 12 wrote:</div><blockquote>quoted</blockquote></div>'
    const result = extractHtmlReply(html)
    expect(result).toContain('Reply here')
    expect(result).not.toContain('quoted')
  })

  it('strips Outlook divRplyFwdMsg', () => {
    const html = '<div>My response</div><div id="divRplyFwdMsg"><b>From:</b> sender@example.com<br><b>Sent:</b> Oct 12</div><div>original</div>'
    const result = extractHtmlReply(html)
    expect(result).toContain('My response')
    expect(result).not.toContain('sender@example.com')
  })

  it('strips Outlook border-top separator', () => {
    const html = '<div>Reply</div><div style="border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0in 0in 0in"><p>quoted</p></div>'
    const result = extractHtmlReply(html)
    expect(result).toContain('Reply')
    expect(result).not.toContain('quoted')
  })

  it('strips Apple Mail blockquote type=cite', () => {
    const html = '<div>My reply</div><div>On Oct 12 wrote:</div><blockquote type="cite"><div>original</div></blockquote>'
    const result = extractHtmlReply(html)
    expect(result).toContain('My reply')
    expect(result).not.toContain('original')
  })

  it('strips Thunderbird moz-cite-prefix', () => {
    const html = '<div>Response</div><div class="moz-cite-prefix">On 2024-10-12, Sender wrote:</div><blockquote type="cite">old</blockquote>'
    const result = extractHtmlReply(html)
    expect(result).toContain('Response')
    expect(result).not.toContain('old')
  })

  it('strips Yahoo quoted content', () => {
    const html = '<div>New text</div><div class="yahoo_quoted"><div>On Oct 12 wrote:</div>quoted content</div>'
    const result = extractHtmlReply(html)
    expect(result).toContain('New text')
    expect(result).not.toContain('quoted content')
  })

  it('returns full HTML when no quotes found', () => {
    const html = '<div>Just a clean message</div>'
    expect(extractHtmlReply(html)).toBe(html)
  })
})
