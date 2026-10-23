import { z } from 'zod';
export const prospectInput=z.object({company:z.string().trim().min(2).max(160),contact_name:z.string().trim().min(2).max(160),email:z.email().max(254).transform(v=>v.toLowerCase()),phone:z.string().max(40).optional(),notes:z.string().max(3000).default(''),offer_id:z.uuid()});
export const ruleInput=z.object({commercial_id:z.uuid(),offer_id:z.uuid().nullable(),fixed_cents:z.number().int().min(0),percentage_bps:z.number().int().min(0).max(10000),applies_to:z.enum(['setup','monthly','both']),max_months:z.number().int().min(1).max(120),effective_at:z.iso.datetime()});
