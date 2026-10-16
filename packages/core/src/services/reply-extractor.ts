import EmailReplyParser from 'email-reply-parser'

export function extractTextReply(text: string): string {
  const parser = new EmailReplyParser()
  return parser.read(text).getVisibleText()
}

export function extractHtmlReply(html: string): string {
  let result = html

  // Gmail: <div class="gmail_quote"> or <div class="gmail_quote gmail_quote_container">
  result = removeFromSelector(result, /<div[^>]*class="[^"]*gmail_quote[^"]*"[^>]*>[\s\S]*$/i)

  // Gmail older: <div class="gmail_extra">
  result = removeFromSelector(result, /<div[^>]*class="[^"]*gmail_extra[^"]*"[^>]*>[\s\S]*$/i)

  // Outlook: <div id="divRplyFwdMsg">
  result = removeFromSelector(result, /<div[^>]*id="divRplyFwdMsg"[^>]*>[\s\S]*$/i)

  // Outlook: border-top separator with known colors
  result = removeFromSelector(
    result,
    /<div[^>]*style="[^"]*border-top:\s*solid\s+#(?:E1E1E1|B5C4DF|e1e1e1|b5c4df)\s+1\.0pt[^"]*"[^>]*>[\s\S]*$/i,
  )

  // Outlook: <hr> with specific styling
  result = removeFromSelector(
    result,
    /<hr[^>]*style="[^"]*display:\s*inline-block[^"]*width:\s*98%[^"]*"[^>]*\/?>\s*<div[^>]*id="divRplyFwdMsg"[\s\S]*$/i,
  )

  // Apple Mail / Thunderbird: <blockquote type="cite">
  result = removeFromSelector(result, /<blockquote[^>]*type="cite"[^>]*>[\s\S]*$/i)

  // Thunderbird: <div class="moz-cite-prefix">
  result = removeFromSelector(result, /<div[^>]*class="[^"]*moz-cite-prefix[^"]*"[^>]*>[\s\S]*$/i)

  // Yahoo: <div class="yahoo_quoted">
  result = removeFromSelector(result, /<div[^>]*class="[^"]*yahoo_quoted[^"]*"[^>]*>[\s\S]*$/i)

  // Zimbra: <hr data-marker="__DIVIDER__">
  result = removeFromSelector(result, /<hr[^>]*data-marker="__DIVIDER__"[^>]*\/?>\s*[\s\S]*$/i)

  // Generic: "On ... wrote:" pattern followed by blockquote
  result = removeFromSelector(
    result,
    /<div[^>]*>On\s[\s\S]{0,500}wrote:\s*<\/div>\s*<blockquote[\s\S]*$/i,
  )

  return result.trim()
}

function removeFromSelector(html: string, pattern: RegExp): string {
  return html.replace(pattern, '').trim()
}
