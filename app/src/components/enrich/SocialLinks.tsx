// Social-Profile als Symbol-Links (nur Links, keine eingebetteten Inhalte oder Tracker).

const NETS: Record<string, { label: string; short: string }> = {
  linkedin: { label: "LinkedIn", short: "in" },
  xing: { label: "XING", short: "X̲" },
  instagram: { label: "Instagram", short: "IG" },
  facebook: { label: "Facebook", short: "f" },
  youtube: { label: "YouTube", short: "▶" },
  x: { label: "X (Twitter)", short: "𝕏" },
  tiktok: { label: "TikTok", short: "♪" },
  github: { label: "GitHub", short: "GH" },
  kununu: { label: "kununu", short: "k" },
};

export function SocialLinks({ links }: { links: Record<string, string> }) {
  const entries = Object.entries(links).filter(([, url]) => typeof url === "string" && /^https:\/\//.test(url));
  if (!entries.length) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Öffentliche Profile">
      {entries.map(([net, url]) => {
        const n = NETS[net] ?? { label: net, short: net.slice(0, 2) };
        return (
          <li key={net}>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              title={`${n.label}: ${url}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 px-2.5 py-1 text-sm hover:bg-sand-100 dark:border-white/15 dark:hover:bg-white/10"
            >
              <span aria-hidden className="font-semibold">{n.short}</span>
              {n.label}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
