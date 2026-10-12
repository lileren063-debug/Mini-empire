export function NavIcon({ name }: { name: 'kingdom' | 'army' | 'world' | 'clan' | 'season' }) {
  const c = 'currentColor';
  const common = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: c, strokeWidth: 2, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  if (name === 'kingdom') return <svg {...common}><path d="M3 21V10l3 2V6l3 3 3-5 3 5 3-3v6l3-2v11z" /><path d="M10 21v-5h4v5" /></svg>;
  if (name === 'army') return <svg {...common}><path d="M5 19 19 5M14 5h5v5M5 5l14 14M10 5H5v5" /></svg>;
  if (name === 'world') return <svg {...common}><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" /><path d="M9 4v14M15 6v14" /></svg>;
  if (name === 'clan') return <svg {...common}><path d="M12 2 20 5v7c0 5-4 8-8 10-4-2-8-5-8-10V5z" /><path d="M9 11l2 2 4-4" /></svg>;
  return <svg {...common}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2M9 2h6" /></svg>;
}
