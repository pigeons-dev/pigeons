import { describe, it, expect } from 'vitest'
import { extractTextReply, extractHtmlReply } from '../services/reply-extractor.js'

describe('extractTextReply edge cases', () => {
  it('handles empty string', () => {
    expect(extractTextReply('')).toBe('')
  })

  it('handles text with only whitespace', () => {
    const result = extractTextReply('   \n  \n   ')
    expect(result.trim()).toBe('')
  })

  it('strips multiple levels of quoting', () => {
    const text = [
      'My third reply.',
      '',
      'On Oct 14, Alice wrote:',
      '> Second reply.',
      '>',
      '> On Oct 13, Bob wrote:',
      '>> First message.',
    ].join('\n')
    const result = extractTextReply(text)
    expect(result).toContain('My third reply')
    expect(result).not.toContain('Second reply')
    expect(result).not.toContain('First message')
  })

  it('strips "Sent from my Android" signature', () => {
    const text = 'OK sounds good\n\nSent from my Android device'
    const result = extractTextReply(text)
    expect(result).toContain('OK sounds good')
  })

  it('does not strip forwarded messages (known limitation of email-reply-parser)', () => {
    const text = [
      'FYI see below.',
      '',
      '---------- Forwarded message ----------',
      'From: someone@example.com',
      'Date: Oct 12, 2024',
      'Subject: Original topic',
      '',
      'This was the original email.',
    ].join('\n')
    const result = extractTextReply(text)
    expect(result).toContain('FYI see below')
    // email-reply-parser does not strip forwarded content — only quoted replies
    expect(result).toContain('Forwarded message')
  })

  it('preserves multiline reply before quoted text', () => {
    const text = [
      'Line one of my reply.',
      'Line two of my reply.',
      '',
      'Best regards,',
      'Alice',
      '',
      'On Oct 12, Bob wrote:',
      '> Some question',
    ].join('\n')
    const result = extractTextReply(text)
    expect(result).toContain('Line one')
    expect(result).toContain('Line two')
    expect(result).not.toContain('Some question')
  })

  it('handles reply with only quoted text (no new content)', () => {
    const text = [
      'On Oct 12, Bob wrote:',
      '> The entire email is a quote',
      '> with nothing new added',
    ].join('\n')
    const result = extractTextReply(text)
    // The library should return empty or minimal text
    expect(result).not.toContain('The entire email')
  })

  it('handles text with dash-separated signature', () => {
    const text = [
      'Thanks for letting me know.',
      '',
      '--',
      'John Smith',
      'Engineering Manager',
      'john@company.com',
    ].join('\n')
    const result = extractTextReply(text)
    expect(result).toContain('Thanks for letting me know')
    expect(result).not.toContain('Engineering Manager')
  })
})

describe('extractHtmlReply edge cases', () => {
  it('handles empty string', () => {
    expect(extractHtmlReply('')).toBe('')
  })

  it('handles plain text without HTML tags', () => {
    const text = 'Just plain text, no HTML'
    expect(extractHtmlReply(text)).toBe(text)
  })

  it('strips nested Gmail quotes (reply to a reply)', () => {
    const html = [
      '<div>Third reply</div>',
      '<div class="gmail_quote">',
      '  <div class="gmail_attr">On Oct 14 wrote:</div>',
      '  <blockquote>',
      '    <div>Second reply</div>',
      '    <div class="gmail_quote">',
      '      <blockquote>First message</blockquote>',
      '    </div>',
      '  </blockquote>',
      '</div>',
    ].join('')
    const result = extractHtmlReply(html)
    expect(result).toContain('Third reply')
    expect(result).not.toContain('Second reply')
    expect(result).not.toContain('First message')
  })

  it('strips Outlook reply followed by Gmail forward', () => {
    const html = [
      '<div>My reply</div>',
      '<div id="divRplyFwdMsg">',
      '  <b>From:</b> sender@example.com',
      '  <div class="gmail_quote"><blockquote>original</blockquote></div>',
      '</div>',
    ].join('')
    const result = extractHtmlReply(html)
    expect(result).toContain('My reply')
    expect(result).not.toContain('sender@example.com')
    expect(result).not.toContain('original')
  })

  it('strips Outlook border-top with alternate color #B5C4DF', () => {
    const html =
      '<div>Reply</div><div style="border:none;border-top:solid #B5C4DF 1.0pt;padding:3.0pt 0in 0in 0in"><p>quoted</p></div>'
    const result = extractHtmlReply(html)
    expect(result).toContain('Reply')
    expect(result).not.toContain('quoted')
  })

  it('handles Gmail gmail_extra class (older format)', () => {
    const html =
      '<div>Response</div><div class="gmail_extra"><br><div class="gmail_quote">On Oct 12 wrote:<blockquote>old</blockquote></div></div>'
    const result = extractHtmlReply(html)
    expect(result).toContain('Response')
    expect(result).not.toContain('old')
  })

  it('strips Zimbra divider', () => {
    const html =
      '<div>New content</div><hr data-marker="__DIVIDER__" /><div>Below the divider</div>'
    const result = extractHtmlReply(html)
    expect(result).toContain('New content')
    expect(result).not.toContain('Below the divider')
  })

  it('preserves HTML with inline images before quote', () => {
    const html = [
      '<div>See this screenshot:</div>',
      '<img src="cid:image001" />',
      '<div class="gmail_quote">',
      '  <blockquote>original question</blockquote>',
      '</div>',
    ].join('')
    const result = extractHtmlReply(html)
    expect(result).toContain('See this screenshot')
    expect(result).toContain('img')
    expect(result).not.toContain('original question')
  })

  it('handles HTML with only quoted content', () => {
    const html = '<div class="gmail_quote"><blockquote>Only a quote</blockquote></div>'
    const result = extractHtmlReply(html)
    expect(result).not.toContain('Only a quote')
  })

  it('handles deeply nested Outlook divs', () => {
    const html = [
      '<div><div><p>My actual reply here</p></div></div>',
      '<div id="divRplyFwdMsg">',
      '  <div><div><b>From:</b> old@sender.com</div></div>',
      '  <div>Lengthy quoted chain from multiple forwards</div>',
      '</div>',
    ].join('')
    const result = extractHtmlReply(html)
    expect(result).toContain('My actual reply here')
    expect(result).not.toContain('old@sender.com')
  })

  it('handles generic "On ... wrote:" with blockquote', () => {
    const html = [
      '<p>Thanks for the info.</p>',
      '<div>On October 12, 2024 at 3:45 PM, Alice Smith &lt;alice@example.com&gt; wrote:</div>',
      '<blockquote><p>Here is the original message</p></blockquote>',
    ].join('')
    const result = extractHtmlReply(html)
    expect(result).toContain('Thanks for the info')
    expect(result).not.toContain('original message')
  })

  it('preserves reply with multiple paragraphs', () => {
    const html = [
      '<p>First paragraph of reply.</p>',
      '<p>Second paragraph with more detail.</p>',
      '<p>Third paragraph closing thoughts.</p>',
      '<div class="gmail_quote"><blockquote>quoted</blockquote></div>',
    ].join('')
    const result = extractHtmlReply(html)
    expect(result).toContain('First paragraph')
    expect(result).toContain('Second paragraph')
    expect(result).toContain('Third paragraph')
    expect(result).not.toContain('quoted')
  })

  it('handles HTML with unicode and emoji', () => {
    const html =
      '<div>Great work! 🎉 Merci beaucoup!</div><div class="gmail_quote"><blockquote>original</blockquote></div>'
    const result = extractHtmlReply(html)
    expect(result).toContain('Great work!')
    expect(result).toContain('🎉')
    expect(result).not.toContain('original')
  })

  it('handles Apple Mail with nested cite blockquotes', () => {
    const html = [
      '<div>My Apple reply</div>',
      '<div><br></div>',
      '<div>On Oct 12, 2024, at 3:00 PM, Bob wrote:</div>',
      '<blockquote type="cite">',
      '  <div>Bob\'s message</div>',
      '  <blockquote type="cite">',
      '    <div>Alice\'s original</div>',
      '  </blockquote>',
      '</blockquote>',
    ].join('')
    const result = extractHtmlReply(html)
    expect(result).toContain('My Apple reply')
    expect(result).not.toContain("Bob's message")
    expect(result).not.toContain("Alice's original")
  })

  it('handles Thunderbird with moz-cite-prefix and nested cite', () => {
    const html = [
      '<p>My Thunderbird reply.</p>',
      '<div class="moz-cite-prefix">On 2024-10-12, Sender wrote:<br></div>',
      '<blockquote type="cite"><p>Quoted content from Thunderbird</p></blockquote>',
    ].join('')
    const result = extractHtmlReply(html)
    expect(result).toContain('My Thunderbird reply')
    expect(result).not.toContain('Quoted content')
  })
})
