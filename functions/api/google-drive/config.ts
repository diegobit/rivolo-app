import type { GoogleOAuthEnv } from '../../_lib/googleOAuth'
import { jsonResponse } from '../../_lib/tokenCookie'

export const onRequestGet: PagesFunction<GoogleOAuthEnv> = async ({ env }) => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_TOKEN_ENCRYPTION_KEY) {
    return jsonResponse({ code: 'NOT_CONFIGURED', message: 'Google Drive sync is not configured.' }, 503)
  }
  return jsonResponse({ clientId: env.GOOGLE_CLIENT_ID })
}
