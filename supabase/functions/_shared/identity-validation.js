// Syntax checks only. Ownership/existence requires email/SMS/provider verification.
export function normalizeCPF(value) {
  const text = String(value ?? '').trim();
  if (!/^[\d.\-\s]+$/.test(text)) return '';
  return text.replace(/\D/g, '');
}
export function validCPF(value) {
  const cpf = normalizeCPF(value);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let length = 9; length <= 10; length++) {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(cpf[i]) * (length + 1 - i);
    const digit = (sum * 10 % 11) % 10;
    if (digit !== Number(cpf[length])) return false;
  }
  return true;
}
const areaCodes = new Set('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' '));
export function normalizePhone(value) {
  const text = String(value ?? '').trim();
  if (!/^[+\d()\s.\-]+$/.test(text)) return '';
  let phone = text.replace(/\D/g, '');
  if (phone.length === 13 && phone.startsWith('55')) phone = phone.slice(2);
  if (!/^\d{2}9\d{8}$/.test(phone) || !areaCodes.has(phone.slice(0, 2))) return '';
  if (/^(\d)\1{7}$/.test(phone.slice(3))) return '';
  return '+55' + phone;
}
export function normalizeName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}
export function validName(value) {
  const name = normalizeName(value);
  return name.length >= 3 && name.length <= 120 && /^[\p{L}\p{M}][\p{L}\p{M}\s.'’-]+$/u.test(name) && name.split(' ').length >= 2;
}
export function formatBirthDate(value) {
  const text = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const date = new Date(text + 'T12:00:00Z');
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== text || date > new Date() || date.getUTCFullYear() < 1900) return '';
  return text.slice(8) + text.slice(5, 7) + text.slice(0, 4);
}
