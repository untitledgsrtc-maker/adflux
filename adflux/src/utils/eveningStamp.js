// src/utils/eveningStamp.js - record "this person shared today's evening report" (best effort).
// Same column the sales day summary stamps (work_sessions.evening_summary_sent_at), so the admin
// dashboard Evening report card sees ops people too.
import { supabase } from '../lib/supabase'
import { istTodayISO } from './istDate'

export async function stampEveningShared(userId) {
  if (!userId) return
  try {
    await supabase.from('work_sessions').upsert({
      user_id: userId,
      work_date: istTodayISO(),
      evening_summary_sent_at: new Date().toISOString(),
    }, { onConflict: 'user_id,work_date' })
  } catch { /* the share already happened; never block it */ }
}
