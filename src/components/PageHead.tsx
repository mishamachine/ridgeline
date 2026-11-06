import { Bobo } from './Bobo';

/** The one header every tab uses: title on the left, the small static Trail Bobo mark on the right. */
export function PageHead({ title, byline = false, sub, children }: { title: string; byline?: boolean; sub?: string; children?: React.ReactNode }) {
  return (
    <header className="head">
      {byline && <div className="head-by">Ridgeline · by B&amp;B Project Factory</div>}
      <div className="head-row">
        <h1 className="page-title">{title}</h1>
        <div className="head-right">{children}<Bobo size={24} /></div>
      </div>
      {sub && <div className="fine">{sub}</div>}
    </header>
  );
}
