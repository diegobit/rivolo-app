import { decryptWithPasscode, encryptWithPasscode } from './crypto'
import { exportMarkdownFromDb, importMarkdownToDb } from './importExport'
import { getDropboxState, updateDropboxState } from './dropboxState'

const DROPBOX_API = 'https://api.dropboxapi.com/2/files'
const DROPBOX_CONTENT = 'https://content.dropboxapi.com/2/files'

type DropboxMetadata = {
  rev: string
  server_modified: string
}

type DropboxAuth = {
  accessToken: string
}

const getAccessToken = async (passcode: string) => {
  const state = await getDropboxState()
  if (!state.encryptedAuth) {
    throw new Error('No Dropbox token saved.')
  }

  const decrypted = await decryptWithPasscode(passcode, state.encryptedAuth)
  const payload = JSON.parse(decrypted) as DropboxAuth
  return payload.accessToken
}

export const saveDropboxAuth = async (passcode: string, accessToken: string, filePath: string) => {
  const encryptedAuth = await encryptWithPasscode(passcode, JSON.stringify({ accessToken }))
  const state = await updateDropboxState({ encryptedAuth, filePath })
  console.info('[Dropbox] auth:save', { filePath: state.filePath })
  return state
}

const fetchMetadata = async (accessToken: string, path: string) => {
  const response = await fetch(`${DROPBOX_API}/get_metadata`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path }),
  })

  if (!response.ok) {
    throw new Error('Failed to fetch Dropbox metadata.')
  }

  return (await response.json()) as DropboxMetadata
}

const downloadFile = async (accessToken: string, path: string) => {
  const response = await fetch(`${DROPBOX_CONTENT}/download`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Dropbox-API-Arg': JSON.stringify({ path }),
    },
  })

  if (!response.ok) {
    throw new Error('Failed to download Dropbox file.')
  }

  return response.text()
}

const uploadFile = async (accessToken: string, path: string, content: string) => {
  const response = await fetch(`${DROPBOX_CONTENT}/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({
        path,
        mode: 'overwrite',
        autorename: false,
        mute: false,
      }),
    },
    body: content,
  })

  if (!response.ok) {
    throw new Error('Failed to upload Dropbox file.')
  }

  return (await response.json()) as DropboxMetadata
}

export const pullFromDropbox = async (passcode: string) => {
  const state = await getDropboxState()
  if (!state.filePath) throw new Error('Dropbox file path missing.')

  const accessToken = await getAccessToken(passcode)
  const metadata = await fetchMetadata(accessToken, state.filePath)

  if (metadata.rev === state.lastRemoteRev) {
    console.info('[Dropbox] pull:noop', { filePath: state.filePath, rev: metadata.rev })
    return { status: 'noop' as const, metadata }
  }

  const content = await downloadFile(accessToken, state.filePath)
  const result = await importMarkdownToDb(content, { replace: true })

  await updateDropboxState({
    lastRemoteRev: metadata.rev,
    lastSyncAt: Date.now(),
    localDirty: false,
  })

  console.info('[Dropbox] pull:ok', { filePath: state.filePath, rev: metadata.rev })
  return { status: 'pulled' as const, metadata, result }
}

export const pushToDropbox = async (passcode: string, force = false) => {
  const state = await getDropboxState()
  if (!state.filePath) throw new Error('Dropbox file path missing.')

  if (!state.localDirty && !force) {
    console.info('[Dropbox] push:clean', { filePath: state.filePath })
    return { status: 'clean' as const }
  }

  const accessToken = await getAccessToken(passcode)
  const metadata = await fetchMetadata(accessToken, state.filePath)

  if (!force && state.lastRemoteRev && metadata.rev !== state.lastRemoteRev) {
    console.warn('[Dropbox] push:blocked', {
      filePath: state.filePath,
      localRev: state.lastRemoteRev,
      remoteRev: metadata.rev,
    })
    return { status: 'blocked' as const, metadata }
  }

  const content = await exportMarkdownFromDb()
  const upload = await uploadFile(accessToken, state.filePath, content)

  await updateDropboxState({
    lastRemoteRev: upload.rev,
    lastSyncAt: Date.now(),
    localDirty: false,
  })

  console.info('[Dropbox] push:ok', { filePath: state.filePath, rev: upload.rev })
  return { status: 'pushed' as const, metadata: upload }
}
