// Puts a tiny hosted-trails folder (the real Rattlesnake Ledge cell slice) into dist/trails so the built app has data to serve. No network.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const cells = JSON.parse(readFileSync(new URL('../src/lib/fixtures/wa-cells.json', import.meta.url), 'utf8'));
const dir = new URL('../dist/trails/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('232_549.json', dir), JSON.stringify(cells.ledge[0]));
writeFileSync(new URL('index.json', dir), JSON.stringify({ v: 1, built: '2026-11-06T00:00:00Z', source: 'e2e fixture', elevation: 'Copernicus DEM GLO-90', cell: 0.25, bbox: [-122, 47.25, -121.5, 47.5], cells: ['232_549'] }));
writeFileSync(new URL('names.json', dir), '[]');
