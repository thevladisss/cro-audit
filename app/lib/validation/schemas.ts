import {z} from 'zod'

export const createRunBodySchema = z.object({
  url: z.string().url(),
})
