import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = "https://razibuahkphatujoasif.supabase.co"
const SUPABASE_ANON_KEY = "sb_publishable_3BEHA5zT0eYW0FotmbcG3g_pmPcZTmE"

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
