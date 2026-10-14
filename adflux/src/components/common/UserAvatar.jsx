// src/components/common/UserAvatar.jsx - ONE avatar: the person's uploaded photo if they have one, else initials.
// Use this everywhere a person is shown (section 71): pass the photo URL straight from users.profile_image_url.
import { useState } from 'react'

export function initialsFrom(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'
}

export default function UserAvatar({ name, url, size, className = '', style, title }) {
  const [broken, setBroken] = useState(false)
  const box = size ? { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) } : {}
  const showImg = url && !broken
  return (
    <span className={className} title={title || name || undefined}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: '50%', flexShrink: 0, ...box, ...style }}>
      {showImg
        ? <img src={url} alt="" onError={() => setBroken(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        : initialsFrom(name)}
    </span>
  )
}
