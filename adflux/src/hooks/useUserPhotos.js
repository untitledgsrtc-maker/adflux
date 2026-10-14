// src/hooks/useUserPhotos.js - one shared lookup of users.profile_image_url (id -> url).
// Fetched ONCE per session (a single small query), so any avatar can show a person's photo
// from just their id, without every page selecting the column.
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

let map = null            // Map<id, url> once loaded
let inflight = null
const listeners = new Set()

function load() {
  if (map || inflight) return
  inflight = supabase.from('users').select('id, profile_image_url').not('profile_image_url', 'is', null).limit(1000)
    .then(({ data }) => {
      map = new Map((data || []).map((u) => [u.id, u.profile_image_url]))
      listeners.forEach((fn) => fn())
    })
    .catch(() => { map = new Map() })
    .finally(() => { inflight = null })
}

export function useUserPhoto(userId) {
  const [, bump] = useState(0)
  useEffect(() => {
    if (!userId) return undefined
    const fn = () => bump((n) => n + 1)
    listeners.add(fn)
    load()
    return () => { listeners.delete(fn) }
  }, [userId])
  return (userId && map && map.get(userId)) || null
}

// Call after a person uploads / removes their photo so avatars refresh.
export function resetUserPhotos() { map = null; load() }
