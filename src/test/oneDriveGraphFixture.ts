import { vi } from 'vitest'
import type { DriveItem } from '../lib/oneDriveGraph'

export const createGraphFixture = () => {
  const items = new Map<string, DriveItem>()
  const texts = new Map<string, string>()
  const sessions = new Map<string, { address: string; name: string; text: string }>()
  const counters = { bytes: 0, downloads: [] as string[], commits: [] as string[] }
  const folder = '/drives/drive/items/notebook'
  const addFolder = (id: string, name: string, parent: string) => {
    const item = { id, name, eTag: 'v1', folder: {}, parentReference: { driveId: 'drive', id: parent } }
    items.set(`/drives/drive/items/${id}`, item)
    return item
  }
  addFolder('root', 'root', '')
  addFolder('notebook', 'Rivolo', 'root')
  const addDay = (dayId: string, content: string, eTag = 'v1', uploadParent?: string) => {
    const yearId = [...items.values()].find((item) => item.folder && item.name === dayId.slice(0, 4) && item.parentReference?.id === 'notebook')?.id ?? `year-${dayId.slice(0, 4)}`
    const monthId = [...items.values()].find((item) => item.folder && item.name === dayId.slice(5, 7) && item.parentReference?.id === yearId)?.id ?? `month-${dayId.slice(0, 7)}`
    if (!uploadParent) {
      addFolder(yearId, dayId.slice(0, 4), 'notebook')
      addFolder(monthId, dayId.slice(5, 7), yearId)
    }
    const id = `file-${dayId}`
    const item = { id, name: `${dayId}.md`, eTag, file: {}, parentReference: { driveId: 'drive', id: uploadParent ?? monthId }, '@microsoft.graph.downloadUrl': `https://download.test/${id}` }
    items.set(`/drives/drive/items/${id}`, item)
    texts.set(id, content)
    return item
  }
  const lookupPath = (address: string) => {
    const [base, rawPath] = address.split(':/')
    let item = items.get(base.replace('/me/drive/root', '/drives/drive/items/root'))
    if (!rawPath) return item
    for (const name of rawPath.replace(/:$/, '').split('/').map(decodeURIComponent)) {
      item = [...items.values()].find((candidate) => candidate.parentReference?.id === item?.id && candidate.name === name)
      if (!item) return undefined
    }
    return item
  }
  let failDay: string | null = null
  let driveType = 'personal'
  let ignoreConditions = false
  let afterBytes: (() => Promise<void>) | null = null
  const handle = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const headers = new Headers(init?.headers)
    if (url.startsWith('https://download.test/')) {
      const id = url.split('/').pop()!
      counters.downloads.push(id)
      const text = texts.get(id)
      if (text === undefined) return new Response(null, { status: 404 })
      counters.bytes += new TextEncoder().encode(text).length
      return new Response(text)
    }
    if (url.startsWith('https://upload.test/')) {
      const session = sessions.get(url)!
      if (method === 'DELETE') { sessions.delete(url); return new Response(null, { status: 204 }) }
      session.text += new TextDecoder().decode(init?.body as Uint8Array)
      counters.bytes += (init?.body as Uint8Array).byteLength
      await afterBytes?.()
      afterBytes = null
      return Response.json({ nextExpectedRanges: [] }, { status: 202 })
    }
    const address = url.replace('https://graph.microsoft.com/v1.0', '').split('?')[0]
    if (address === '/drives/drive') return Response.json({ driveType })
    if (method === 'PUT' && address.endsWith('/content')) {
      const target = address.slice(0, -'/content'.length).replace(/:$/, '')
      const before = lookupPath(target)
      const name = before?.name ?? decodeURIComponent(target.split(':/')[1])
      if (/^\d{4}-\d{2}-\d{2}\.md$/.test(name)) { await afterBytes?.(); afterBytes = null }
      const current = lookupPath(target)
      if (!ignoreConditions && current && headers.get('If-None-Match') === '*') return new Response(null, { status: 409 })
      if (!ignoreConditions && current && headers.get('If-Match') && headers.get('If-Match') !== current.eTag) return new Response(null, { status: 412 })
      if (!current && headers.has('If-Match')) return new Response(null, { status: 404 })
      const content = init!.body as string
      const parent = current?.parentReference?.id ?? lookupPath(target.split(':/')[0])!.id
      const eTag = `v${Number(current?.eTag.slice(1) ?? 0) + 1}`
      if (name.endsWith('.md')) {
        const updated = addDay(name.slice(0, -3), content, eTag, parent)
        counters.commits.push(name.slice(0, -3)); return Response.json(updated)
      }
      const id = current?.id ?? `probe-${items.size}`
      const item = { id, name, eTag, file: {}, parentReference: { driveId: 'drive', id: parent }, '@microsoft.graph.downloadUrl': `https://download.test/${id}` }
      items.set(`/drives/drive/items/${id}`, item); texts.set(id, content)
      return Response.json(item)
    }
    if (address.endsWith('/createUploadSession')) {
      const body = JSON.parse(init?.body as string)
      const target = address.replace('/createUploadSession', '')
      const current = lookupPath(target)
      if (current && headers.get('If-Match') && current.eTag !== headers.get('If-Match')) return new Response(null, { status: 412 })
      const sessionUrl = `https://upload.test/${sessions.size + 1}`
      sessions.set(sessionUrl, { address: target, name: body.item.name, text: '' })
      return Response.json({ uploadUrl: sessionUrl })
    }
    if (method === 'PUT') {
      const body = JSON.parse(init?.body as string)
      const session = sessions.get(body['@microsoft.graph.sourceUrl'])!
      if (session.name.includes(failDay ?? 'no-failure')) return new Response(null, { status: 500 })
      const current = lookupPath(address)
      if (current && (headers.get('If-None-Match') === '*' || current.eTag !== headers.get('If-Match'))) return new Response(null, { status: 412 })
      if (!current && headers.has('If-Match')) return new Response(null, { status: 404 })
      const dayId = session.name.slice(0, -3)
      const updated = addDay(dayId, session.text, `v${Number(current?.eTag.slice(1) ?? 0) + 1}`, current?.parentReference?.id ?? lookupPath(address.split(':/')[0])?.id)
      counters.commits.push(dayId)
      return Response.json(updated)
    }
    if (method === 'DELETE') {
      const item = items.get(address)
      if (!item) return new Response(null, { status: 404 })
      if (headers.get('If-Match') !== item.eTag) return new Response(null, { status: 412 })
      items.delete(address)
      texts.delete(item.id)
      return new Response(null, { status: 204 })
    }
    if (address.endsWith('/children')) {
      const parent = lookupPath(address.replace('/children', ''))!
      if (method === 'POST') {
        const { name } = JSON.parse(init?.body as string)
        if ([...items.values()].some((item) => item.parentReference?.id === parent.id && item.name === name)) return new Response(null, { status: 409 })
        return Response.json(addFolder(`folder-${items.size}`, name, parent.id), { status: 201 })
      }
      return Response.json({ value: [...items.values()].filter((item) => item.parentReference?.id === parent.id) })
    }
    const item = lookupPath(address)
    return item ? Response.json(item) : new Response(null, { status: 404 })
  })
  return { folder, addDay, addFolder, items, texts, counters, fetch: handle,
    setDriveType: (type: string) => { driveType = type }, ignoreConditions: () => { ignoreConditions = true },
    setFailure: (dayId: string | null) => { failDay = dayId },
    afterBytes: (callback: () => Promise<void>) => { afterBytes = callback } }
}
