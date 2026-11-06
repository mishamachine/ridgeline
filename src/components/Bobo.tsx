import url from '../assets/trail-bobo.svg';

/** The static Trail Bobo mark (no animation). Decorative unless `label` is given. */
export function Bobo({ size = 44, label }: { size?: number; label?: string }) {
  return <img src={url} width={size} height={size} alt={label ?? ''} aria-hidden={label ? undefined : true} className="bobo" />;
}

/** Loading and empty states: the mark and one plain line. */
export function Placeholder({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="placeholder" role="status">
      <Bobo size={72} />
      <div className="placeholder-title">{title}</div>
      {children && <div className="placeholder-body">{children}</div>}
    </div>
  );
}
