export const MIN_WRITE_OPERATION_ID_CHARS = 8
export const MAX_WRITE_OPERATION_ID_CHARS = 128
export const WRITE_OPERATION_ID_PATTERN =
  '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'

const WRITE_OPERATION_ID = new RegExp(WRITE_OPERATION_ID_PATTERN)

export const isValidWriteOperationId = (value: string) =>
  WRITE_OPERATION_ID.test(value)
