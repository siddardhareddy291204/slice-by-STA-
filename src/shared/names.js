// Player names: tidy what was typed, and build a key for duplicate detection
// ("  asha   RAO " and "Asha Rao" are the same person; "Ásha" matches "Asha").

export function cleanName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim();
}

export function nameKey(name) {
  return cleanName(name).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.'’]/g, '').toLowerCase();
}
