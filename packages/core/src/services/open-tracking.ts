import type { Config } from '../config.js'

export function injectTrackingPixel(
  html: string,
  emailId: string,
  config: Config,
): string {
  if (!config.openTracking || !config.baseUrl) return html

  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  const pixelUrl = `${baseUrl}/v1/t/${emailId}`
  const pixel = `<img src="${pixelUrl}" alt="" width="1" height="1" style="display:none!important;width:1px!important;height:1px!important" />`

  const bodyCloseIndex = html.lastIndexOf('</body>')
  if (bodyCloseIndex !== -1) {
    return html.slice(0, bodyCloseIndex) + pixel + html.slice(bodyCloseIndex)
  }

  return html + pixel
}

export function shouldTrackOpens(
  perEmail: boolean | undefined,
  config: Config,
): boolean {
  if (perEmail !== undefined) return perEmail
  return config.openTracking
}
