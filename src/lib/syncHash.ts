const encoder = new TextEncoder()

// Stable content fingerprint used to skip redundant pushes: if the exported
// Markdown is byte-identical to what we last pushed, there is nothing to send.
export const hashSyncContent = async (content: string) => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(content))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
