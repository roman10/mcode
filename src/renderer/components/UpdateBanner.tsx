import { useUpdateStore } from '../stores/update-store';

function UpdateBanner(): React.JSX.Element | null {
  const phase = useUpdateStore((s) => s.phase);
  const version = useUpdateStore((s) => s.version);
  const bannerDismissed = useUpdateStore((s) => s.bannerDismissed);
  const dismissBanner = useUpdateStore((s) => s.dismissBanner);

  if (phase !== 'ready' || bannerDismissed || !version) return null;

  return (
    <div className="shrink-0 flex items-center justify-center gap-3 h-8 px-4 bg-accent/15 text-accent text-xs font-medium animate-slide-down">
      <span>
        A new version (v{version}) is ready.
      </span>
      <button
        type="button"
        className="px-2.5 py-0.5 rounded bg-accent text-bg-primary text-xs font-medium hover:bg-accent/80 transition-colors cursor-pointer"
        onClick={() => window.mcode.app.installUpdate()}
      >
        Restart to Update
      </button>
      <button
        type="button"
        className="text-accent/60 hover:text-accent transition-colors cursor-pointer"
        onClick={dismissBanner}
        aria-label="Dismiss update banner"
      >
        ×
      </button>
    </div>
  );
}

export default UpdateBanner;
