import * as z from 'zod'
import { F, tagged } from '@traversable/zod-types'
import { fn } from '@traversable/registry'

const DASH = new RegExp('[-_]', 'g')
const DASH_BOUNDARY = new RegExp('([-_][a-z])', 'g')
const WORD_BOUNDARY = new RegExp('([a-z])([A-Z])', 'g')

export function camelCase(x: string) {
  return x.replace(DASH_BOUNDARY, (c) => c.toUpperCase().replace(DASH, ''))
}

export function snakeCase(x: string) {
  return x.replace(WORD_BOUNDARY, "$1_$2").toLowerCase()
}

export type ConvertCase = {
  decodeKeys(k: string): string,
  encodeKeys(k: string): string
}

// Helper to check if a schema contains any user-defined pipes
function containsPipes(schema: z.core.$ZodType): boolean {
  if (tagged('pipe')(schema)) {
    return true
  }
  if (tagged('object')(schema)) {
    const shape = schema._zod.def.shape
    return Object.values(shape).some((v: any) => containsPipes(v))
  }
  if (tagged('array')(schema)) {
    return containsPipes(schema._zod.def.element)
  }
  return false
}

// Helper to recursively extract OUT schemas from pipes
function extractOut(schema: z.core.$ZodType): z.core.$ZodType {
  if (tagged('pipe')(schema)) {
    // Extract OUT and recursively process it
    const out = schema._zod.def.out
    return extractOut(out)
  }
  if (tagged('array')(schema)) {
    // For arrays, extract OUT from the element schema
    const element = extractOut(schema._zod.def.element)
    return z.array(element) as any
  }
  if (tagged('object')(schema)) {
    // For objects, recursively extract OUT from all fields
    const shape = schema._zod.def.shape
    const newShape = fn.map(shape, (v: any) => extractOut(v))
    const { catchall } = schema._zod.def
    if (catchall) {
      return z.object(newShape as any).catchall(catchall) as any
    }
    return z.object(newShape as any) as any
  }
  // For non-pipes/arrays/objects, return as-is
  return schema
}

export function convertCaseCodec({ decodeKeys, encodeKeys }: ConvertCase): <T extends z.ZodType>(type: T) => z.ZodType
export function convertCaseCodec({ decodeKeys, encodeKeys }: ConvertCase): <T extends z.core.$ZodType>(type: T) => z.core.$ZodType
export function convertCaseCodec({ decodeKeys, encodeKeys }: ConvertCase) {
  const decode = <T>(x: { [k: string]: T }) => Object.fromEntries(Object.entries(x).map(([k, v]) => [decodeKeys(k), v]))
  const encode = <T>(x: { [k: string]: T }) => Object.fromEntries(Object.entries(x).map(([k, v]) => [encodeKeys(k), v]))
  return F.fold<z.core.$ZodType>((x, _, original) => {
    switch (true) {
      case tagged('object')(x) && tagged('object', original): {
        const { shape, catchall } = original._zod.def
        const processedShape = x._zod.def.shape
        // For encoder: use processed schemas (full pipes) so transformations occur
        const encoderShape = fn.map(processedShape, (v) => v)
        // For decoder: recursively extract OUT from processed schemas
        const decoderShape = fn.map(processedShape, (v) => extractOut(v))
        const encoder = !catchall
          ? z.object(encode(encoderShape))
          : z.object(encode(encoderShape)).catchall(catchall)
        const decoder = !catchall
          ? z.object(decode(decoderShape))
          : z.object(decode(decoderShape)).catchall(catchall)
        return z.codec(encoder, decoder, { decode, encode })
      }
      case tagged('pipe')(x): return x as never
      case tagged('transform')(x): return x as never
      default: return z.clone(original, x._zod.def as z.core.$ZodTypeDef)
    }
  })
}

export const deepSnakeCaseCodec = convertCaseCodec({ decodeKeys: snakeCase, encodeKeys: camelCase })
export const deepCamelCaseCodec = convertCaseCodec({ decodeKeys: camelCase, encodeKeys: snakeCase })
