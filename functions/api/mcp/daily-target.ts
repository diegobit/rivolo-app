import { refreshDropboxAccessToken, type DropboxOAuthEnv } from '../../_lib/dropboxOAuth'
import { refreshGoogleAccessToken, type GoogleOAuthEnv } from '../../_lib/googleOAuth'
import { mcpAllowedOrigins, mcpProfileRepository, readMcpProfileSession, type McpAgentAccessEnv } from '../../_lib/mcpAgentAccess'
import { jsonResponse, validateMutationRequest } from '../../_lib/tokenCookie'
import { ProviderAccessError, verifyDropboxDailyTarget, verifyGoogleDailyTarget } from '../../_lib/providerAccess'

type Env = DropboxOAuthEnv & GoogleOAuthEnv & McpAgentAccessEnv

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const invalid = validateMutationRequest(request, mcpAllowedOrigins(env))
  if (invalid) return jsonResponse({ message: invalid }, 403)
  const body = await request.json().catch(() => null) as { provider?: unknown; folder?: unknown } | null
  const folder = body?.folder
  if (typeof folder !== 'string' || folder.length > 512 || !/^(?:id:)?[A-Za-z0-9_-]+$/.test(folder)) {
    return jsonResponse({ message: 'A daily notebook folder is required.' }, 400)
  }
  try {
    const profileId = await readMcpProfileSession(request, env)
    const repository = mcpProfileRepository(env)
    const profile = profileId ? await repository.getMetadata(profileId) : null
    if (!profile || profile.revokedAt || profile.provider !== body?.provider) return jsonResponse({ message: 'Agent access is not enabled for this provider.' }, 403)
    if (profile.dailyFolderId === folder) return jsonResponse({ enabled: true, profile })
    if (profile.provider === 'onedrive') {
      return jsonResponse({ message: 'OneDrive Agent access already uses the daily notebook.' }, 409)
    }
    const refreshToken = await repository.decryptCredential(profile.profileId)
    if (!refreshToken) return jsonResponse({ message: 'Agent access is not connected.' }, 401)
    if (profile.provider === 'dropbox') {
      const token = await refreshDropboxAccessToken(refreshToken, env)
      await verifyDropboxDailyTarget(token.access_token, folder, profile.target.path)
    } else {
      const token = await refreshGoogleAccessToken(refreshToken, env)
      await verifyGoogleDailyTarget(token.access_token, folder, profile.target)
    }
    if (!await repository.setDailyFolder(profile, folder)) {
      return jsonResponse({ message: 'Agent access was changed in another session. Refresh its settings before retrying.' }, 409)
    }
    return jsonResponse({ enabled: true, profile: { ...profile, dailyFolderId: folder } })
  } catch (error) {
    if (error instanceof ProviderAccessError) return jsonResponse({ message: error.message }, error.status)
    return jsonResponse({ message: 'Could not move Agent access to the daily notebook. Retry from sync settings.' }, 503)
  }
}
