import { useRef } from 'react';
import type { Entry } from '../lib/types.ts';
import { domain, mediaUrl, posterFile } from '../lib/media.ts';
import { useReducedMotion } from '../hooks.ts';
import styles from './Card.module.css';

export function Card({ entry, categoryName }: { entry: Entry; categoryName: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const reduced = useReducedMotion();
  const first = entry.media[0];

  const play = () => {
    if (!reduced) void video.current?.play().catch(() => {});
  };
  const pause = () => video.current?.pause();

  return (
    <a
      className={styles.card}
      href={`#${entry.id}`}
      data-category={entry.category}
      onMouseEnter={play}
      onMouseLeave={pause}
      onFocus={play}
      onBlur={pause}
    >
      <div className={styles.media} data-kind={first?.type ?? 'link'}>
        {first?.type === 'video' && (
          <video
            ref={video}
            src={mediaUrl(first.file)}
            poster={mediaUrl(posterFile(first.file))}
            muted
            loop
            playsInline
            preload="none"
            aria-hidden="true"
            tabIndex={-1}
          />
        )}
        {first?.type === 'image' && <img src={mediaUrl(first.file)} alt="" loading="lazy" />}
        {!first && <LinkFace title={entry.title} url={entry.source.url} />}
        {entry.media.length > 1 && <span className={styles.count}>{entry.media.length} clips</span>}
      </div>
      <div className={styles.body}>
        <span className={styles.title}>{entry.title}</span>
        <span className={styles.meta}>
          <span>{categoryName}</span>
          {entry.tags.slice(0, 2).map((t) => (
            <span key={t} className={styles.tag}>
              #{t}
            </span>
          ))}
        </span>
      </div>
    </a>
  );
}

/** Typographic face for link-only entries (no media). */
export function LinkFace({ title, url }: { title: string; url: string }) {
  return (
    <div className={styles.link}>
      <span className={styles.linkTitle}>{title}</span>
      <span className={styles.linkDomain}>{domain(url)}</span>
    </div>
  );
}
