import { type DropboxOAuthEnv } from '../../_lib/dropboxOAuth'
import { jsonResponse } from '../../_lib/tokenCookie'

export const onRequestGet: PagesFunction<DropboxOAuthEnv> = async ({ env }) => {
  if (!env.DROPBOX_CLIENT_ID || !env.DROPBOX_TOKEN_ENCRYPTION_KEY) {
    return jsonResponse({ code: 'NOT_CONFIGURED', message: 'Dropbox sync is not configured.' }, 503)
  }
  return jsonResponse({ clientId: env.DROPBOX_CLIENT_ID })
}
