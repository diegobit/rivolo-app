const FOOTER = /(?:\r?\n){2}<!-- rivolo:authors:v1 ([A-Za-z0-9+/=]+) -->\s*$/
export const isAuthorsMetadataLine = (line: string) => /^<!-- rivolo:authors:v1 [A-Za-z0-9+/=]+ -->$/.test(line)
export const notebookText = (source: string) => source.replace(FOOTER, '')

export const readAuthorsMetadata = (source: string): unknown => {
  const encoded = source.match(FOOTER)?.[1]
  if (!encoded || encoded.length > 4_000_000) return null
  try {
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))))
  } catch { return null }
}

export const appendAuthorsMetadata = (source: string, metadata: unknown) => {
  const bytes = new TextEncoder().encode(JSON.stringify(metadata))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `${notebookText(source)}\n\n<!-- rivolo:authors:v1 ${btoa(binary)} -->`
}
