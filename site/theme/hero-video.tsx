import { useEffect, useRef, useState } from 'react'
import { normalizeImagePath } from '@rspress/core/runtime'

export interface HeroVideoData {
  src: string
  poster?: string
  title?: string
  badge?: string
}

export function HeroVideo({ video }: { video: HeroVideoData }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isMuted, setIsMuted] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion && videoRef.current) {
      videoRef.current.pause()
    }
  }, [])

  const toggleSound = () => {
    const el = videoRef.current
    if (!el) return
    if (el.muted) {
      el.muted = false
      if (el.volume === 0) el.volume = 1
      setIsMuted(false)
    } else {
      el.muted = true
      setIsMuted(true)
    }
  }

  const handleVolumeChange = () => {
    const el = videoRef.current
    if (!el) return
    setIsMuted(el.muted || el.volume === 0)
  }

  const videoSrc = normalizeImagePath(video.src)
  const posterSrc = video.poster ? normalizeImagePath(video.poster) : undefined

  return (
    <div className="hero-video-container" aria-label={video.title || 'Product overview video'}>
      <div className="hero-video-frame">
        <video
          ref={videoRef}
          src={videoSrc}
          poster={posterSrc}
          autoPlay
          loop
          muted
          playsInline
          controls
          aria-label={video.title || 'Product overview video'}
          className="hero-video-player"
          onVolumeChange={handleVolumeChange}
        />
        {video.badge && (
          <div className="hero-video-badge" aria-hidden="true">
            {video.badge}
          </div>
        )}
        <button
          type="button"
          className={`hero-video-sound ${isMuted ? 'is-muted' : 'is-unmuted'}`}
          onClick={toggleSound}
          aria-label={isMuted ? 'Unmute video' : 'Mute video'}
          title={isMuted ? 'Unmute video' : 'Mute video'}
        >
          {isMuted ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          )}
          <span>{isMuted ? 'Sound on' : 'Mute'}</span>
        </button>
      </div>
    </div>
  )
}
