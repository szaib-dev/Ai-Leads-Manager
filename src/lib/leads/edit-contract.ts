import { z } from "zod";
export const editSchema = z
  .object({
    business_name: z.string().trim().min(1).max(300).optional(),
    phone: z.string().trim().max(80).optional(),
    website_url: z
      .string()
      .max(4096)
      .refine(
        (v) => !v || (/^https?:\/\//i.test(v) && z.url().safeParse(v).success),
      )
      .optional(),
    country: z.string().max(100).optional(),
    location: z.string().max(300).optional(),
    notes: z
      .string()
      .refine((v) => new TextEncoder().encode(v).length <= 16000)
      .optional(),
    scheduled_date: z.iso.date().optional(),
    scheduled_time: z
      .string()
      .regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    status: z
      .enum([
        "new",
        "whatsapp",
        "no_answer",
        "voicemail",
        "interested",
        "not_interested",
        "follow_up",
        "meeting_booked",
        "awaiting_callback",
      ])
      .optional(),
  })
  .strict();
