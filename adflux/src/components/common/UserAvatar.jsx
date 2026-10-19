// src/components/common/UserAvatar.jsx - ONE avatar: the person's uploaded photo if they have one, else initials.
// Use this everywhere a person is shown (section 71): pass the photo URL straight from users.profile_image_url.
import { useState } from 'react'
import { useUserPhoto } from '../../hooks/useUserPhotos'

export function initialsFrom(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'
}

export default function UserAvatar({ name, url: urlProp, userId, size, className = '', style, title }) {
  const [broken, setBroken] = useState(false)
  const cached = useUserPhoto(urlProp ? null : userId)
  const url = urlProp || cached
  const box = size ? { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) } : {}
  const showImg = url && !broken
  return (
    // Phase 433: always a true circle. The box is square (aspect-ratio) and the photo is pinned to fill it (absolute), so a photo can
    // never stretch into an oval inside a grid / flex / overlapped stack. The look (colours, size) still comes from className / size / style.
    <span className={className || (style || size ? '' : 'ua-default')} title={title || name || undefined}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: '50%', flexShrink: 0, aspectRatio: '1 / 1', boxSizing: 'border-box', ...box, ...style }}>
      {showImg
        ? <img src={url} alt="" onError={() => setBroken(true)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top', display: 'block', borderRadius: '50%' }} />
        : initialsFrom(name)}
    </span>
  )
}
