/* Small helpers shared by the site, the staff panels and the viewer. */
export const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());
export function strongPass(p) { if (p.length < 8) return 'At least 8 characters.'; if (!/[A-Z]/.test(p) || !/[0-9]/.test(p)) return 'Add a capital letter and a number.'; return ''; }
/* staff demo accounts only — never used for customer passwords (those are scrypt-hashed on the server) */
export const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return 'p' + h.toString(36); };
export const dateOf = ms => new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
export const dateTimeOf = ms => new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });
export const flagOf = code => code === 'OTHER' ? '🌐' : String.fromCodePoint(...code.split('').map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
export const shortClass = label => label.replace('Kindergarten', 'KG').replace('Class ', 'C');
