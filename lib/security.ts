function parseCsv(value: string | undefined) {
  return (value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function getAllowedStaffDomains() {
  return parseCsv(process.env.ALLOWED_STAFF_EMAIL_DOMAINS);
}

export function isAllowedStaffDomain(email: string) {
  const allowedDomains = getAllowedStaffDomains();

  if (!allowedDomains.length) {
    return true;
  }

  const [, domain = ''] = normalizeEmail(email).split('@');
  return allowedDomains.includes(domain);
}
